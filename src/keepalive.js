const http = require('http');
const https = require('https');

function start() {
  const base = (process.env.SELF_URL || '').trim().replace(/\/+$/, '');
  if (!base) {
    console.log('[keepalive] SELF_URL not set, self-ping disabled');
    return null;
  }
  const interval = parseInt(process.env.KEEPALIVE_INTERVAL_MS || '600000', 10);
  const target = base + '/healthz';
  const lib = target.startsWith('https:') ? https : http;

  function ping() {
    const started = Date.now();
    const req = lib.get(target, { timeout: 10_000 }, (res) => {
      const ms = Date.now() - started;
      console.log(`[keepalive] ${target} -> ${res.statusCode} (${ms}ms)`);
      res.resume();
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => console.warn('[keepalive] error:', err.message));
  }

  const handle = setInterval(ping, interval);
  if (handle.unref) handle.unref();
  console.log(`[keepalive] enabled, target=${target}, interval=${interval}ms`);
  return handle;
}

module.exports = { start };
