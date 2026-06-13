// ---------------------------------------------------------------------------
// SQLite test adapter (node:sqlite, Node >= 22). Mirrors the pg.js surface
// (prepare(sql).get/all/run, exec, withTransaction, pool) so the REAL server
// code can run against an isolated local SQLite database for testing.
//
// This is ONLY used when DB_DRIVER=sqlite (see db.js). Production never sets
// that, so this file is inert in prod and there is ZERO risk to Supabase.
//
// The route-level SQL in this app is already written in SQLite dialect (the
// pg.js adapter translates it UP to Postgres). So here we only need to strip
// the couple of Postgres-only casts (::numeric) that one report query uses.
// ---------------------------------------------------------------------------
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'test-hr.db');
const sdb = new DatabaseSync(dbPath);
sdb.exec('PRAGMA journal_mode = WAL');
sdb.exec('PRAGMA foreign_keys = ON');

// Postgres-only bits → SQLite. Route SQL is otherwise SQLite-native
// (?, datetime('now', ?), ON CONFLICT(...) DO UPDATE SET x=excluded.x).
function translate(sql) {
  return String(sql).replace(/::\s*[a-z]+/gi, ''); // drop ::numeric / ::int casts
}

// Detect a named-parameter statement (@word that is OUTSIDE a string literal).
function isNamed(sql) {
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (inStr) { if (c === "'") { if (sql[i + 1] === "'") { i++; continue; } inStr = false; } continue; }
    if (c === "'") { inStr = true; continue; }
    if (c === '@' && /[a-zA-Z_]/.test(sql[i + 1] || '')) return true;
  }
  return false;
}

// Build the argument list node:sqlite expects.
function bindArgs(sql, params) {
  if (isNamed(sql)) {
    const obj = params[0] || {};
    const out = {};
    for (const k of Object.keys(obj)) { out[k] = obj[k]; out['@' + k] = obj[k]; }
    return [out];
  }
  return params.flat();
}

const toNum = (v) => (typeof v === 'bigint' ? Number(v) : v);
function normRow(r) {
  if (!r || typeof r !== 'object') return r;
  for (const k of Object.keys(r)) if (typeof r[k] === 'bigint') r[k] = Number(r[k]);
  return r;
}

// Prepared-statement cache keyed by translated SQL text.
const cache = new Map();
function stmt(text) {
  let s = cache.get(text);
  if (!s) {
    s = sdb.prepare(text);
    s.setAllowUnknownNamedParameters(true);
    cache.set(text, s);
  }
  return s;
}

function prepare(sql) {
  const text = translate(sql);
  return {
    get: async (...params) => normRow(stmt(text).get(...bindArgs(sql, params))),
    all: async (...params) => stmt(text).all(...bindArgs(sql, params)).map(normRow),
    run: async (...params) => {
      const r = stmt(text).run(...bindArgs(sql, params));
      return { changes: toNum(r.changes), lastInsertRowid: toNum(r.lastInsertRowid) };
    },
  };
}

async function exec(sql) { sdb.exec(translate(sql)); }

// Single synchronous connection → BEGIN/COMMIT wrap the whole callback.
async function withTransaction(fn) {
  sdb.exec('BEGIN');
  try {
    const tx = { prepare, exec: async (s) => { sdb.exec(translate(s)); } };
    const out = await fn(tx);
    sdb.exec('COMMIT');
    return out;
  } catch (e) {
    try { sdb.exec('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  }
}

module.exports = { pool: null, prepare, exec, withTransaction, _db: sdb };
