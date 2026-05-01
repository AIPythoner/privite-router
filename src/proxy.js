const httpProxy = require('http-proxy');
const { findRoute } = require('./store');

const proxy = httpProxy.createProxyServer({
  xfwd: true,
  proxyTimeout: 60_000,
  timeout: 60_000,
});

proxy.on('error', (err, req, res) => {
  const url = req && req.url;
  console.error('[proxy error]', url, '->', err.code || '', err.message);
  if (res && typeof res.writeHead === 'function') {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    res.end('Bad Gateway');
  } else if (res && typeof res.destroy === 'function') {
    res.destroy();
  }
});

const LEAKY_HEADERS = ['server', 'x-powered-by', 'x-aspnet-version', 'x-aspnetmvc-version', 'x-backend-server', 'via'];

proxy.on('proxyRes', (proxyRes) => {
  for (const h of LEAKY_HEADERS) delete proxyRes.headers[h];
});

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitQuery(url) {
  const q = url.indexOf('?');
  if (q < 0) return [url, ''];
  return [url.slice(0, q), url.slice(q)];
}

function rewrite(url, prefix) {
  if (prefix === '/') return url;
  const [p, q] = splitQuery(url);
  const newPath = p.replace(new RegExp('^' + escapeRegex(prefix)), '') || '/';
  return newPath + q;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function pickRoute(url) {
  const [pathname] = splitQuery(url);
  return findRoute(pathname);
}

function handleRequest(req, res, next) {
  const route = pickRoute(req.url);
  if (!route) {
    const accepts = (req.headers.accept || '').toLowerCase();
    const wantsHtml = accepts.includes('text/html');
    if (wantsHtml) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(
        '<!doctype html><meta charset="utf-8"><title>404</title>' +
        '<div style="max-width:480px;margin:80px auto;font-family:system-ui,sans-serif;color:#24292f;">' +
        '<h1 style="margin:0 0 10px;font-size:22px;">404 · 无匹配路由</h1>' +
        '<p>路径 <code>' + escapeHtml(req.url) + '</code> 没有匹配到任何转发规则。</p>' +
        '<p>可能原因：<br>1. 该上游用的是绝对路径资源，请把前缀改成 <code>/</code> 做全量转发<br>' +
        '2. 规则被禁用或拼写不一致</p>' +
        '<p><a href="/__admin/">→ 前往管理页配置</a></p>' +
        '</div>'
      );
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('No route matched: ' + req.url);
  }
  if (route.strip_prefix) {
    req.url = rewrite(req.url, route.path_prefix);
  }
  const xfp = (req.headers['x-forwarded-proto'] || '').toLowerCase();
  const isHttps = xfp === 'https' || req.socket && req.socket.encrypted;
  proxy.web(req, res, {
    target: route.target,
    changeOrigin: !route.preserve_host,
    secure: false,
    autoRewrite: true,
    protocolRewrite: isHttps ? 'https' : 'http',
  });
}

function handleUpgrade(req, socket, head) {
  const route = pickRoute(req.url);
  if (!route) {
    socket.destroy();
    return;
  }
  if (route.strip_prefix) {
    req.url = rewrite(req.url, route.path_prefix);
  }
  proxy.ws(req, socket, head, {
    target: route.target,
    changeOrigin: !route.preserve_host,
    secure: false,
  });
}

module.exports = { handleRequest, handleUpgrade };
