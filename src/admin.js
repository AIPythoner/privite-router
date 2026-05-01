const express = require('express');
const path = require('path');
const http = require('http');
const https = require('https');
const store = require('./store');
const auth = require('./auth');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const RESERVED_PREFIXES = ['/__admin', '/healthz'];

function validateRoute(body) {
  const { path_prefix, target } = body;
  if (!path_prefix || typeof path_prefix !== 'string') return 'path_prefix 必填';
  if (!target || typeof target !== 'string') return 'target 必填';
  if (!path_prefix.startsWith('/')) return 'path_prefix 必须以 / 开头';
  if (path_prefix !== '/') {
    if (path_prefix.endsWith('/')) return 'path_prefix 不能以 / 结尾 (全量转发请用 /)';
    if (!/^\/[A-Za-z0-9_\-./]+$/.test(path_prefix)) return 'path_prefix 只能含字母数字 _ - . /';
  }
  for (const r of RESERVED_PREFIXES) {
    if (path_prefix === r || path_prefix.startsWith(r + '/')) {
      return `path_prefix 与保留路径 ${r} 冲突`;
    }
  }
  try {
    const u = new URL(target);
    if (!['http:', 'https:'].includes(u.protocol)) return 'target 必须是 http:// 或 https:// 开头';
  } catch {
    return 'target 不是合法的 URL';
  }
  return null;
}

function testConnection(target, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const lib = target.startsWith('https:') ? https : http;
    const started = Date.now();
    let finished = false;
    const done = (result) => {
      if (finished) return;
      finished = true;
      result.ms = Date.now() - started;
      resolve(result);
    };
    try {
      const req = lib.request(target, { method: 'HEAD', timeout: timeoutMs }, (resp) => {
        resp.resume();
        done({ ok: true, status: resp.statusCode });
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', (err) => done({ ok: false, error: err.message }));
      req.end();
    } catch (err) {
      done({ ok: false, error: err.message });
    }
  });
}

function build() {
  const router = express.Router();
  const jsonBody = express.json({ limit: '64kb' });

  // ===== Public endpoints (no auth) =====

  router.get('/login', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
  });

  router.post('/api/login', jsonBody, async (req, res) => {
    const { user, password } = req.body || {};
    if (!user || !password) {
      return res.status(400).json({ error: '用户名和密码必填' });
    }
    const ok = await auth.verifyCredentials(user, password);
    if (!ok) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    const token = auth.createSession(user);
    auth.setSessionCookie(res, req, token);
    res.json({ ok: true, user });
  });

  router.post('/api/logout', (req, res) => {
    const token = auth.getToken(req);
    auth.destroySession(token);
    auth.clearSessionCookie(res);
    res.json({ ok: true });
  });

  // Serve static assets (css/js/html). Safe: they contain no secrets;
  // UI calls API which is still protected.
  router.use(express.static(PUBLIC_DIR, { index: false, extensions: ['html'] }));

  router.get('/', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  // ===== Protected API =====
  const api = express.Router();
  api.use(auth.requireAuth);
  api.use(jsonBody);

  api.get('/me', async (req, res) => {
    res.json({
      user: req.user,
      mode: store.mode(),
      password_source: await auth.currentSource(),
    });
  });

  api.post('/change-password', async (req, res) => {
    const { old_password, new_password } = req.body || {};
    if (!old_password || !new_password) {
      return res.status(400).json({ error: '旧密码和新密码必填' });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ error: '新密码至少 6 位' });
    }
    const ok = await auth.verifyCredentials(req.user, old_password);
    if (!ok) {
      return res.status(401).json({ error: '旧密码错误' });
    }
    try {
      await auth.setPassword(new_password);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  api.get('/routes', (req, res) => {
    res.json({ routes: store.list(), mode: store.mode() });
  });

  api.post('/routes', async (req, res) => {
    const err = validateRoute(req.body || {});
    if (err) return res.status(400).json({ error: err });
    try {
      const id = await store.create(req.body);
      res.json({ id });
    } catch (e) {
      if (e && e.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'path_prefix 已存在' });
      }
      res.status(500).json({ error: e.message });
    }
  });

  api.put('/routes/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
    const current = store.getById(id);
    if (!current) return res.status(404).json({ error: 'not found' });
    const merged = { ...current, ...(req.body || {}) };
    if ((req.body || {}).path_prefix || (req.body || {}).target) {
      const err = validateRoute(merged);
      if (err) return res.status(400).json({ error: err });
    }
    try {
      await store.update(id, req.body || {});
      res.json({ ok: true });
    } catch (e) {
      if (e && e.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'path_prefix 已存在' });
      }
      res.status(500).json({ error: e.message });
    }
  });

  api.delete('/routes/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
    try {
      await store.remove(id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  api.post('/routes/:id/test', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const route = store.getById(id);
    if (!route) return res.status(404).json({ error: 'not found' });
    const result = await testConnection(route.target);
    res.json(result);
  });

  api.post('/test', async (req, res) => {
    const target = (req.body || {}).target;
    if (!target) return res.status(400).json({ error: 'target required' });
    try {
      new URL(target);
    } catch {
      return res.status(400).json({ error: 'invalid target' });
    }
    const result = await testConnection(target);
    res.json(result);
  });

  router.use('/api', api);

  return router;
}

module.exports = { build };
