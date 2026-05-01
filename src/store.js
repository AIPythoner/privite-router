const db = require('./db');

let cache = [];
let nextMemId = 1;

function normalizeRow(r) {
  return {
    id: r.id,
    path_prefix: r.path_prefix,
    target: r.target,
    strip_prefix: !!r.strip_prefix,
    preserve_host: !!r.preserve_host,
    enabled: !!r.enabled,
    note: r.note || null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function sortCache() {
  cache.sort((a, b) => {
    const d = b.path_prefix.length - a.path_prefix.length;
    return d !== 0 ? d : a.id - b.id;
  });
}

async function refresh() {
  if (!db.isEnabled()) return cache;
  const [rows] = await db.getPool().query(
    'SELECT * FROM routes ORDER BY CHAR_LENGTH(path_prefix) DESC, id ASC'
  );
  cache = rows.map(normalizeRow);
  return cache;
}

function findRoute(pathname) {
  for (const r of cache) {
    if (!r.enabled) continue;
    if (r.path_prefix === '/') return r;
    if (pathname === r.path_prefix || pathname.startsWith(r.path_prefix + '/')) {
      return r;
    }
  }
  return null;
}

function list() {
  return cache.slice();
}

function getById(id) {
  return cache.find((r) => r.id === id) || null;
}

const ALLOWED_FIELDS = ['path_prefix', 'target', 'strip_prefix', 'preserve_host', 'enabled', 'note'];
const BOOL_FIELDS = new Set(['strip_prefix', 'preserve_host', 'enabled']);

function coerce(field, value) {
  if (BOOL_FIELDS.has(field)) return value ? 1 : 0;
  if (field === 'note') return value == null || value === '' ? null : String(value);
  return value;
}

async function create(data) {
  const row = {
    path_prefix: data.path_prefix,
    target: data.target,
    strip_prefix: data.strip_prefix !== undefined ? !!data.strip_prefix : true,
    preserve_host: !!data.preserve_host,
    enabled: data.enabled !== undefined ? !!data.enabled : true,
    note: data.note || null,
  };

  if (db.isEnabled()) {
    const [result] = await db.getPool().execute(
      'INSERT INTO routes (path_prefix, target, strip_prefix, preserve_host, enabled, note) VALUES (?, ?, ?, ?, ?, ?)',
      [
        row.path_prefix,
        row.target,
        coerce('strip_prefix', row.strip_prefix),
        coerce('preserve_host', row.preserve_host),
        coerce('enabled', row.enabled),
        coerce('note', row.note),
      ]
    );
    await refresh();
    return result.insertId;
  }

  if (cache.some((r) => r.path_prefix === row.path_prefix)) {
    const err = new Error('path_prefix 已存在');
    err.code = 'ER_DUP_ENTRY';
    throw err;
  }
  const now = new Date();
  const id = nextMemId++;
  cache.push({ ...row, id, created_at: now, updated_at: now });
  sortCache();
  return id;
}

async function update(id, fields) {
  const keys = Object.keys(fields).filter((k) => ALLOWED_FIELDS.includes(k));
  if (keys.length === 0) return;

  if (db.isEnabled()) {
    const sets = keys.map((k) => `\`${k}\` = ?`).join(', ');
    const values = keys.map((k) => coerce(k, fields[k]));
    await db.getPool().execute(`UPDATE routes SET ${sets} WHERE id = ?`, [...values, id]);
    await refresh();
    return;
  }

  const row = cache.find((r) => r.id === id);
  if (!row) return;
  for (const k of keys) {
    let v = fields[k];
    if (BOOL_FIELDS.has(k)) v = !!v;
    if (k === 'note' && (v == null || v === '')) v = null;
    if (k === 'path_prefix' && cache.some((r) => r.id !== id && r.path_prefix === v)) {
      const err = new Error('path_prefix 已存在');
      err.code = 'ER_DUP_ENTRY';
      throw err;
    }
    row[k] = v;
  }
  row.updated_at = new Date();
  sortCache();
}

async function remove(id) {
  if (db.isEnabled()) {
    await db.getPool().execute('DELETE FROM routes WHERE id = ?', [id]);
    await refresh();
    return;
  }
  cache = cache.filter((r) => r.id !== id);
}

function mode() {
  return db.isEnabled() ? 'mysql' : 'memory';
}

module.exports = { refresh, findRoute, list, getById, create, update, remove, mode };
