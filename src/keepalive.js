const http = require('http');
const https = require('https');

// Rotate UA + randomize path so the ping looks like organic external traffic
// rather than a fixed-pattern self-loopback that platforms might filter.
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
];

function pickUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function rand(n) {
  return Math.random().toString(36).slice(2, 2 + n);
}

function start() {
  const base = (process.env.SELF_URL || '').trim().replace(/\/+$/, '');
  if (!base) {
    console.log('[keepalive] SELF_URL not set, self-ping disabled');
    return null;
  }
  const interval = parseInt(process.env.KEEPALIVE_INTERVAL_MS || '50000', 10);
  const lib = base.startsWith('https:') ? https : http;

  function ping() {
    const target = `${base}/healthz?_=${Date.now()}${rand(4)}`;
    const started = Date.now();
    const req = lib.get(target, {
      timeout: 10_000,
      headers: {
        'User-Agent': pickUA(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
    }, (res) => {
      const ms = Date.now() - started;
      console.log(`[keepalive] ${res.statusCode} (${ms}ms)`);
      res.resume();
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => console.warn('[keepalive] error:', err.message));
  }

  // Kick off an immediate first ping shortly after boot (verifies SELF_URL).
  const initial = setTimeout(ping, 3000);
  if (initial.unref) initial.unref();

  const handle = setInterval(ping, interval);
  if (handle.unref) handle.unref();
  console.log(`[keepalive] enabled, target=${base}/healthz, interval=${interval}ms`);
  return handle;
}

module.exports = { start };
