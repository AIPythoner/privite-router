const db = require('./db');

const mem = new Map();

async function init() {
  if (!db.isEnabled()) return;
  await db.getPool().query(`
    CREATE TABLE IF NOT EXISTS settings (
      \`key\` VARCHAR(64) PRIMARY KEY,
      \`value\` TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function get(key) {
  if (db.isEnabled()) {
    const [rows] = await db.getPool().execute(
      'SELECT `value` FROM settings WHERE `key` = ?',
      [key]
    );
    return rows[0] ? rows[0].value : null;
  }
  return mem.has(key) ? mem.get(key) : null;
}

async function set(key, value) {
  if (db.isEnabled()) {
    await db.getPool().execute(
      'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
      [key, value]
    );
    return;
  }
  mem.set(key, value);
}

module.exports = { init, get, set };
