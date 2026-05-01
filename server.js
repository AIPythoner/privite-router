require('dotenv').config();
const http = require('http');
const express = require('express');

const db = require('./src/db');
const store = require('./src/store');
const settings = require('./src/settings');
const auth = require('./src/auth');
const admin = require('./src/admin');
const proxy = require('./src/proxy');
const keepalive = require('./src/keepalive');

async function main() {
  db.createPool();
  if (db.isEnabled()) {
    await db.init();
    await settings.init();
    await store.refresh();
    console.log(`[db] mysql connected, loaded ${store.list().length} route(s)`);
  } else {
    console.warn('[db] missing env:', db.missingKeys().join(', '));
    console.warn('[db] running in MEMORY mode — routes will NOT persist across restarts');
  }
  auth.logStartupInfo(await auth.currentSource());

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.get('/healthz', (req, res) => {
    res.json({
      ok: true,
      mode: store.mode(),
      routes: store.list().length,
      uptime: process.uptime(),
    });
  });

  app.use('/__admin', admin.build());

  app.get('/', (req, res, next) => {
    const route = store.findRoute('/');
    if (route) return next();
    res.redirect(302, '/__admin/');
  });

  app.use((req, res, next) => {
    proxy.handleRequest(req, res, next);
  });

  const server = http.createServer(app);

  server.on('upgrade', (req, socket, head) => {
    const url = req.url || '';
    if (url.startsWith('/__admin') || url === '/healthz') {
      socket.destroy();
      return;
    }
    proxy.handleUpgrade(req, socket, head);
  });

  const port = parseInt(process.env.PORT || '3000', 10);
  server.listen(port, () => {
    console.log(`[server] listening on :${port}`);
    console.log(`[server] admin UI at /__admin/  (user: ${process.env.ADMIN_USER || 'admin'})`);
    keepalive.start();
  });

  const shutdown = (sig) => {
    console.log(`[server] ${sig} received, closing`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
