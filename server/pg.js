// ---------------------------------------------------------------------------
// Postgres adapter (Supabase). Mimics the small slice of the node:sqlite
// DatabaseSync API the app uses — db.prepare(sql).get/all/run and db.exec —
// but backed by async Postgres. prepare() stays synchronous (it just stores
// the SQL); get/all/run/exec are async, so every call site becomes `await`.
//
// It also translates the SQLite SQL dialect the app was written in into
// Postgres on the fly (placeholders, datetime/date(), RETURNING id, etc.).
// ---------------------------------------------------------------------------
const pglib = require('pg');
const { Pool } = pglib;

// Postgres returns BIGINT (incl. COUNT/SUM) as a STRING by default. SQLite
// returned numbers, and the app does truthiness/arithmetic on counts — so parse
// bigint as a JS number (safe: our counts/ids fit well within 2^53).
pglib.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

const connectionString =
  process.env.DATABASE_URL ||
  (process.env.SUPABASE_PASS
    ? `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_PASS)}@db.enauadozyselkiuaserd.supabase.co:5432/postgres`
    : null);

if (!connectionString) {
  console.warn('⚠️  No DATABASE_URL / SUPABASE_PASS set — Postgres connection will fail.');
}

const pool = new Pool({
  connectionString,
  // Supabase requires SSL; it presents a cert chain we don't pin here.
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX) || 8,
});

// ---- SQL dialect translation -------------------------------------------------
// Converts a single SQLite statement (with ? or @named params) into a Postgres
// statement with $1..$n placeholders, returning { text, order } where order is
// the list of named keys (for named-param statements) or null (positional).
function translate(sql) {
  let text = sql;

  // Date/time helpers — produce the SAME 'YYYY-MM-DD HH:MM:SS' (UTC) / 'YYYY-MM-DD'
  // text format SQLite's datetime()/date() returned, so stored values and string
  // comparisons behave identically across the app.
  const NOW = "(now() at time zone 'utc')";
  const FMT = "'YYYY-MM-DD HH24:MI:SS'";
  text = text.replace(/datetime\(\s*'now'\s*,\s*\?\s*\)/gi, `to_char(${NOW} + (?)::interval, ${FMT})`);
  text = text.replace(/datetime\(\s*'now'\s*,\s*'([^']*)'\s*\)/gi, `to_char(${NOW} + interval '$1', ${FMT})`);
  text = text.replace(/datetime\(\s*'now'\s*\)/gi, `to_char(${NOW}, ${FMT})`);
  text = text.replace(/date\(\s*'now'\s*\)/gi, `to_char(${NOW}, 'YYYY-MM-DD')`);

  return placeholderize(text);
}

// Convert ? (positional) or @named placeholders to Postgres $1..$n, while
// IGNORING any ? or @ that appears inside a single-quoted string literal
// (e.g. an email address or a '%@x%' pattern). A statement uses either named
// or positional placeholders, never both.
function placeholderize(sql) {
  const isWord = (ch) => ch && /[a-zA-Z0-9_]/.test(ch);
  // 1) Detect "named" mode: a bare @word that is OUTSIDE any string literal.
  let named = false;
  for (let i = 0, inStr = false; i < sql.length; i++) {
    const c = sql[i];
    if (inStr) { if (c === "'") { if (sql[i + 1] === "'") { i++; continue; } inStr = false; } continue; }
    if (c === "'") { inStr = true; continue; }
    if (c === '@' && /[a-zA-Z_]/.test(sql[i + 1] || '')) { named = true; break; }
  }
  const order = named ? [] : null;
  // 2) Replace placeholders outside string literals.
  let out = '', n = 0, inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (inStr) {
      out += c;
      if (c === "'") { if (sql[i + 1] === "'") { out += "'"; i++; continue; } inStr = false; }
      continue;
    }
    if (c === "'") { inStr = true; out += c; continue; }
    if (named && c === '@' && /[a-zA-Z_]/.test(sql[i + 1] || '')) {
      let j = i + 1, name = '';
      while (j < sql.length && isWord(sql[j])) { name += sql[j]; j++; }
      order.push(name); out += '$' + (++n); i = j - 1; continue;
    }
    if (!named && c === '?') { out += '$' + (++n); continue; }
    out += c;
  }
  return { text: out, order };
}

// Tables whose primary key is NOT an `id` column — never append RETURNING id.
const NO_ID_TABLES = new Set(['payroll_runs', 'settings', 'user_sessions', 'automation_markers']);

// Append RETURNING id to a bare INSERT so we can report lastInsertRowid.
function withReturning(text) {
  if (/\breturning\b/i.test(text)) return { text, hasReturning: true };
  const m = text.match(/^\s*insert\s+into\s+"?(\w+)"?/i);
  if (m && !NO_ID_TABLES.has(m[1].toLowerCase())) {
    return { text: text.replace(/;?\s*$/, '') + ' RETURNING id', hasReturning: true };
  }
  return { text, hasReturning: false };
}

function buildArgs(order, params) {
  if (order) {
    // Named: a single object argument.
    const obj = params[0] || {};
    return order.map((k) => obj[k]);
  }
  // Positional: flatten (callers sometimes spread).
  return params.flat();
}

async function runQuery(sql, params, mode) {
  const { text, order } = translate(sql);
  const args = buildArgs(order, params);

  if (mode === 'run') {
    const ret = withReturning(text);
    const res = await pool.query(ret.text, args);
    return {
      changes: res.rowCount,
      lastInsertRowid: ret.hasReturning && res.rows[0] ? res.rows[0].id : undefined,
    };
  }
  const res = await pool.query(text, args);
  if (mode === 'get') return res.rows[0];
  return res.rows;
}

// Mimics db.prepare(): synchronous, returns a statement with async accessors.
function prepare(sql) {
  return {
    get: (...params) => runQuery(sql, params, 'get'),
    all: (...params) => runQuery(sql, params, 'all'),
    run: (...params) => runQuery(sql, params, 'run'),
  };
}

// Runs raw SQL (DDL, BEGIN/COMMIT — though prefer withTransaction for those).
async function exec(sql) {
  // pg can run multiple statements in one query() call when there are no params.
  await pool.query(sql);
}

// Proper transaction on a single dedicated connection.
// Usage: await withTransaction(async (tx) => { await tx.prepare(sql).run(...) })
async function withTransaction(fn) {
  const client = await pool.connect();
  const tx = {
    prepare: (sql) => ({
      get: async (...p) => { const { text, order } = translate(sql); return (await client.query(text, buildArgs(order, p))).rows[0]; },
      all: async (...p) => { const { text, order } = translate(sql); return (await client.query(text, buildArgs(order, p))).rows; },
      run: async (...p) => {
        const { text, order } = translate(sql);
        const ret = withReturning(text);
        const res = await client.query(ret.text, buildArgs(order, p));
        return { changes: res.rowCount, lastInsertRowid: ret.hasReturning && res.rows[0] ? res.rows[0].id : undefined };
      },
    }),
    exec: (sql) => client.query(sql),
  };
  try {
    await client.query('BEGIN');
    const out = await fn(tx);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, prepare, exec, withTransaction };
