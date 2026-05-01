(function () {
  'use strict';
  const form = document.getElementById('login-form');
  const errEl = document.getElementById('error');
  const btn = document.getElementById('btn-login');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.hidden = true;
    btn.disabled = true;
    const origText = btn.textContent;
    btn.textContent = '登录中...';
    try {
      const res = await fetch('/__admin/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          user: form.user.value.trim(),
          password: form.password.value,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        errEl.textContent = data.error || ('登录失败 (' + res.status + ')');
        errEl.hidden = false;
        return;
      }
      const next = new URLSearchParams(location.search).get('next') || '/__admin/';
      location.href = next.startsWith('/__admin') ? next : '/__admin/';
    } catch (err) {
      errEl.textContent = '网络错误: ' + err.message;
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  });
})();
