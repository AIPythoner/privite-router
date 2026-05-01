const crypto = require('crypto');
const settings = require('./settings');

// Hardcoded default password. Used only when ADMIN_PASSWORD env is NOT set
// AND no runtime-changed password is stored. Change via UI after first login.
const DEFAULT_PASSWORD = 'rP3nL9Kx2mQwT7';
const DEFAULT_USER = 'admin';
const COOKIE_NAME = 'pr_session';
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
const SETTING_KEY = 'admin_password_hash';

const sessions = new Map(); // token -> { user, expires }

function now() { return Date.now(); }

function adminUser() {
  return (process.env.ADMIN_USER || DEFAULT_USER).trim() || DEFAULT_USER;
}

function safeStrEq(a, b) {
  const ba = Buffer.from(String(a == null ? '' : a));
  const bb = Buffer.from(String(b == null ? '' : b));
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 32);
  return 'scrypt$' + salt.toString('hex') + '$' + derived.toString('hex');
}

function verifyHash(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const parts = stored.split('$');
  if (parts.length !== 3) return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  let derived;
  try {
    derived = crypto.scryptSync(password, salt, expected.length);
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

async function getStoredHash() {
  return await settings.get(SETTING_KEY);
}

async function verifyCredentials(user, password) {
  if (!safeStrEq(user, adminUser())) return false;
  const stored = await getStoredHash();
  if (stored) return verifyHash(password, stored);
  const envPass = (process.env.ADMIN_PASSWORD || '').trim();
  if (envPass) return safeStrEq(password, envPass);
  return safeStrEq(password, DEFAULT_PASSWORD);
}

async function setPassword(newPassword) {
  if (!newPassword || newPassword.length < 6) {
    throw new Error('密码至少 6 位');
  }
  const hash = hashPassword(newPassword);
  await settings.set(SETTING_KEY, hash);
}

async function currentSource() {
  const stored = await getStoredHash();
  if (stored) return 'stored';
  if ((process.env.ADMIN_PASSWORD || '').trim()) return 'env';
  return 'default';
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, { user, expires: now() + SESSION_TTL_MS });
  return token;
}

function validateSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expires < now()) {
    sessions.delete(token);
    return null;
  }
  return s;
}

function destroySession(token) {
  if (token) sessions.delete(token);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function getToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[COOKIE_NAME] || null;
}

function buildCookie(token, opts = {}) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const secure = opts.secure ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/__admin; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function clearCookie() {
  return `${COOKIE_NAME}=; Path=/__admin; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function requireAuth(req, res, next) {
  const token = getToken(req);
  const session = validateSession(token);
  if (!session) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  req.user = session.user;
  req.sessionToken = token;
  next();
}

function setSessionCookie(res, req, token) {
  res.setHeader('Set-Cookie', buildCookie(token, { secure: !!req.secure }));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', clearCookie());
}

function logStartupInfo(source) {
  const user = adminUser();
  if (source === 'stored') {
    console.log(`[auth] admin user: ${user} (password: runtime-changed via UI)`);
  } else if (source === 'env') {
    console.log(`[auth] admin user: ${user} (password: from ADMIN_PASSWORD env)`);
  } else {
    console.log(`[auth] admin user: ${user}`);
    console.log(`[auth] password: DEFAULT = "${DEFAULT_PASSWORD}"  (change via UI after login)`);
  }
}

module.exports = {
  DEFAULT_USER,
  DEFAULT_PASSWORD,
  adminUser,
  verifyCredentials,
  setPassword,
  currentSource,
  createSession,
  validateSession,
  destroySession,
  getToken,
  requireAuth,
  setSessionCookie,
  clearSessionCookie,
  logStartupInfo,
};
