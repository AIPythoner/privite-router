(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const state = { routes: [] };

  function toast(msg, type = '') {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast' + (type ? ' ' + type : '');
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 2600);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function gotoLogin() {
    const next = encodeURIComponent(location.pathname + location.search);
    location.href = '/__admin/login?next=' + next;
  }

  async function api(method, path, body) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    if (res.status === 401) {
      gotoLogin();
      throw new Error('未登录');
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) {
      const err = (data && data.error) || res.statusText;
      throw new Error(err);
    }
    return data;
  }

  function renderBaseUrl() {
    const base = location.origin;
    $('#base-url').textContent = base;
    $$('.base-inline').forEach((el) => { el.textContent = base; });
  }

  function renderRoutes() {
    const tbody = $('#routes-body');
    const rows = state.routes;
    $('#empty').hidden = rows.length > 0;
    tbody.innerHTML = rows.map((r) => {
      const statusBadge = r.enabled
        ? '<span class="badge badge-on">启用</span>'
        : '<span class="badge badge-off">禁用</span>';
      const isRoot = r.path_prefix === '/';
      const stripBadge = isRoot
        ? '<span class="badge badge-off" title="全量转发时剥离前缀无意义">—</span>'
        : (r.strip_prefix
          ? '<span class="badge badge-yes">是</span>'
          : '<span class="badge badge-no">否</span>');
      const prefixCell = isRoot
        ? '<a href="/" target="_blank" rel="noopener">/</a> <span class="badge badge-yes" title="catch-all 全量转发">全局</span>'
        : '<a href="' + escapeHtml(r.path_prefix) + '/" target="_blank" rel="noopener">' + escapeHtml(r.path_prefix) + '</a>';
      return (
        '<tr data-id="' + r.id + '">' +
          '<td>' + statusBadge + '</td>' +
          '<td class="prefix">' + prefixCell + '</td>' +
          '<td class="target">' + escapeHtml(r.target) + '</td>' +
          '<td>' + stripBadge + '</td>' +
          '<td>' + escapeHtml(r.note || '') + '</td>' +
          '<td><div class="row-actions">' +
            '<button class="btn btn-small" data-act="toggle">' + (r.enabled ? '禁用' : '启用') + '</button>' +
            '<button class="btn btn-small" data-act="test">测试</button>' +
            '<button class="btn btn-small" data-act="edit">编辑</button>' +
            '<button class="btn btn-small btn-danger" data-act="delete">删除</button>' +
          '</div></td>' +
        '</tr>'
      );
    }).join('');
  }

  async function loadMe() {
    try {
      const me = await api('GET', '/__admin/api/me');
      const lbl = $('#user-label');
      lbl.textContent = me.user;
      lbl.hidden = false;
      state.passwordSource = me.password_source;
    } catch (_) { /* 401 already redirected */ }
  }

  async function loadRoutes() {
    try {
      const data = await api('GET', '/__admin/api/routes');
      state.routes = data.routes || [];
      state.mode = data.mode || 'mysql';
      $('#banner-memory').hidden = state.mode !== 'memory';
      renderRoutes();
    } catch (e) {
      if (e.message !== '未登录') toast('加载失败: ' + e.message, 'err');
    }
  }

  async function logout() {
    try { await api('POST', '/__admin/api/logout'); } catch (_) {}
    gotoLogin();
  }

  function openPwModal() {
    const f = $('#pw-form');
    f.reset();
    $('#pw-err').hidden = true;
    $('#pw-modal').hidden = false;
    setTimeout(() => f.elements.old_password.focus(), 50);
  }
  function closePwModal() { $('#pw-modal').hidden = true; }

  async function submitPw(ev) {
    ev.preventDefault();
    const f = ev.target;
    const old_password = f.elements.old_password.value;
    const new_password = f.elements.new_password.value;
    const confirm = f.elements.confirm.value;
    const err = $('#pw-err');
    err.hidden = true;
    if (new_password !== confirm) {
      err.textContent = '两次新密码不一致';
      err.hidden = false;
      return;
    }
    try {
      await api('POST', '/__admin/api/change-password', { old_password, new_password });
      closePwModal();
      toast('密码已更新', 'ok');
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    }
  }

  function openModal(route) {
    const form = $('#route-form');
    form.reset();
    $('#test-result').hidden = true;
    const isEdit = !!route;
    $('#modal-title').textContent = isEdit ? '编辑规则' : '新增规则';
    form.elements.id.value = isEdit ? route.id : '';
    form.elements.path_prefix.value = isEdit ? route.path_prefix : '';
    form.elements.target.value = isEdit ? route.target : '';
    form.elements.strip_prefix.checked = isEdit ? route.strip_prefix : true;
    form.elements.preserve_host.checked = isEdit ? route.preserve_host : false;
    form.elements.enabled.checked = isEdit ? route.enabled : true;
    form.elements.note.value = isEdit ? (route.note || '') : '';
    $('#modal').hidden = false;
    setTimeout(() => form.elements.path_prefix.focus(), 50);
  }

  function closeModal() {
    $('#modal').hidden = true;
  }

  async function saveRoute(ev) {
    ev.preventDefault();
    const form = ev.target;
    const id = form.elements.id.value;
    const payload = {
      path_prefix: form.elements.path_prefix.value.trim(),
      target: form.elements.target.value.trim(),
      strip_prefix: form.elements.strip_prefix.checked,
      preserve_host: form.elements.preserve_host.checked,
      enabled: form.elements.enabled.checked,
      note: form.elements.note.value.trim(),
    };
    try {
      if (id) {
        await api('PUT', '/__admin/api/routes/' + id, payload);
        toast('已保存', 'ok');
      } else {
        await api('POST', '/__admin/api/routes', payload);
        toast('已创建', 'ok');
      }
      closeModal();
      loadRoutes();
    } catch (e) {
      toast('保存失败: ' + e.message, 'err');
    }
  }

  async function onRowAction(ev) {
    const btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    const tr = btn.closest('tr[data-id]');
    if (!tr) return;
    const id = parseInt(tr.dataset.id, 10);
    const route = state.routes.find((r) => r.id === id);
    if (!route) return;
    const act = btn.dataset.act;

    if (act === 'edit') return openModal(route);

    if (act === 'delete') {
      if (!confirm('确定删除规则 ' + route.path_prefix + '?')) return;
      try {
        await api('DELETE', '/__admin/api/routes/' + id);
        toast('已删除', 'ok');
        loadRoutes();
      } catch (e) { toast('删除失败: ' + e.message, 'err'); }
      return;
    }

    if (act === 'toggle') {
      try {
        await api('PUT', '/__admin/api/routes/' + id, { enabled: !route.enabled });
        toast(!route.enabled ? '已启用' : '已禁用', 'ok');
        loadRoutes();
      } catch (e) { toast('操作失败: ' + e.message, 'err'); }
      return;
    }

    if (act === 'test') {
      btn.disabled = true; btn.textContent = '测试中';
      try {
        const r = await api('POST', '/__admin/api/routes/' + id + '/test');
        if (r.ok) toast('可达 HTTP ' + r.status + ' (' + r.ms + 'ms)', 'ok');
        else toast('不可达: ' + r.error, 'err');
      } catch (e) { toast('失败: ' + e.message, 'err'); }
      finally { btn.disabled = false; btn.textContent = '测试'; }
    }
  }

  async function onModalTest() {
    const target = $('#route-form').elements.target.value.trim();
    if (!target) { toast('请先填写 target', 'err'); return; }
    const result = $('#test-result');
    result.hidden = false;
    result.className = 'hint';
    result.textContent = '测试中...';
    try {
      const r = await api('POST', '/__admin/api/test', { target });
      if (r.ok) {
        result.className = 'hint ok';
        result.textContent = '✓ 可达，HTTP ' + r.status + '，耗时 ' + r.ms + 'ms';
      } else {
        result.className = 'hint err';
        result.textContent = '✗ 不可达：' + r.error + '（' + r.ms + 'ms）';
      }
    } catch (e) {
      result.className = 'hint err';
      result.textContent = '请求失败: ' + e.message;
    }
  }

  function bind() {
    $('#btn-add').addEventListener('click', () => openModal(null));
    $('#btn-refresh').addEventListener('click', loadRoutes);
    $('#btn-cancel').addEventListener('click', closeModal);
    $('#btn-test').addEventListener('click', onModalTest);
    $('#route-form').addEventListener('submit', saveRoute);
    $('#routes-body').addEventListener('click', onRowAction);
    $('#btn-logout').addEventListener('click', logout);
    $('#btn-password').addEventListener('click', openPwModal);
    $('#pw-form').addEventListener('submit', submitPw);
    $$('[data-close="pw"]').forEach((el) => el.addEventListener('click', closePwModal));
    $('#modal .modal-mask').addEventListener('click', closeModal);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('#modal').hidden) closeModal();
      if (!$('#pw-modal').hidden) closePwModal();
    });
  }

  renderBaseUrl();
  bind();
  loadMe();
  loadRoutes();
})();
