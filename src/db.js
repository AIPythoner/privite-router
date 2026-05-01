const mysql = require('mysql2/promise');

let pool = null;
let enabled = false;

const REQUIRED = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'];

function hasConfig() {
  return REQUIRED.every((k) => {
    const v = process.env[k];
    return typeof v === 'string' && v.trim() !== '';
  });
}

function missingKeys() {
  return REQUIRED.filter((k) => !process.env[k] || !process.env[k].trim());
}

function createPool() {
  if (!hasConfig()) {
    enabled = false;
    pool = null;
    return null;
  }
  pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    connectionLimit: 10,
    waitForConnections: true,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    charset: 'utf8mb4',
  });
  enabled = true;
  return pool;
}

async function init() {
  if (!enabled) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS routes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      path_prefix VARCHAR(255) NOT NULL UNIQUE,
      target VARCHAR(500) NOT NULL,
      strip_prefix TINYINT(1) NOT NULL DEFAULT 1,
      preserve_host TINYINT(1) NOT NULL DEFAULT 0,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      note VARCHAR(255) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

function isEnabled() {
  return enabled;
}

function getPool() {
  return pool;
}

module.exports = { createPool, init, getPool, isEnabled, hasConfig, missingKeys };
