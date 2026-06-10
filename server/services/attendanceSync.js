const XLSX = require('xlsx');
const db = require('./../db');
const { getSettings } = require('./settings');

function norm(h) {
  return String(h || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Map many possible column names to our internal fields.
const COL = {
  'emp code': 'code', 'employee code': 'code', code: 'code', 'emp id': 'code',
  'employee id': 'code', empid: 'code', 'staff id': 'code',
  email: 'email', 'email id': 'email', 'e-mail': 'email',
  name: 'name', 'employee name': 'name', employee: 'name',
  date: 'date', day: 'date', 'attendance date': 'date',
  status: 'status', attendance: 'status', 'attendance status': 'status',
  'check in': 'in', 'in': 'in', 'time in': 'in', 'in time': 'in', login: 'in',
  'check out': 'out', 'out': 'out', 'time out': 'out', 'out time': 'out', logout: 'out',
};

function normaliseStatus(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return null;
  if (['p', 'present', 'present (p)', 'working', 'wfh', 'wfo', 'full day', 'full', 'on duty'].includes(s)) return 'present';
  if (['a', 'absent', 'ab', 'lop', 'no show'].includes(s)) return 'absent';
  if (['h', 'hd', 'half', 'half day', 'half-day'].includes(s)) return 'half';
  if (['l', 'leave', 'on leave', 'pl', 'cl', 'sl'].includes(s)) return 'leave';
  return null;
}

function pad2(n) { return String(n).padStart(2, '0'); }

// Accepts 2026-05-19, 19/05/2026, 19-05-2026, a JS Date, or an Excel serial.
// Day/month order is assumed DD/MM/YYYY (Indian/most-of-world convention).
function parseDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) {
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  }
  if (typeof v === 'number') {
    const d = XLSX.SSF ? XLSX.SSF.parse_date_code(v) : null;
    if (d && d.y) return `${d.y}-${pad2(d.m)}-${pad2(d.d)}`;
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
  if (m) {
    // DD/MM/YYYY by default; if first number can't be a day but second can, swap.
    let day = parseInt(m[1], 10), mon = parseInt(m[2], 10);
    if (day > 12 && mon <= 12) { /* clearly DD/MM, keep */ }
    else if (mon > 12 && day <= 12) { const t = day; day = mon; mon = t; } // was MM/DD
    return `${m[3]}-${pad2(mon)}-${pad2(day)}`;
  }
  return null;
}

// '09:30', '9:30 AM', '18:00' -> 'HH:MM' (24h)
function parseTime(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2}):(\d{2})\s*([ap]m)?/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${min}`;
}

// Minimal RFC-4180-ish CSV parser. Keeps every cell as a literal string so
// dates like "01/08/2025" are never auto-converted to the wrong month.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  text = String(text).replace(/^﻿/, ''); // strip BOM
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch === '\r') { /* ignore */ }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Parses CSV text (literal) and upserts attendance. */
async function syncFromCsv(csvText) {
  return await processGrid(parseCsv(csvText));
}

/** Parses an uploaded .xlsx / .xls / .csv file (Buffer) and upserts attendance. */
async function syncFromBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  return await processGrid(aoa);
}

// Decides whether the sheet is a tidy list (one row per day) or a grid
// (one row per employee, one column per date) and routes accordingly.
// `aoa` is an array of arrays (rows of cells).
async function processGrid(aoa) {
  if (!aoa || !aoa.length) return { total: 0, synced: 0, unmatched: 0, errors: [], unmatchedKeys: [] };

  // Find the header row = the row with the most date-like cells.
  let headerIdx = -1, bestDates = 0;
  for (let i = 0; i < Math.min(aoa.length, 15); i++) {
    const dates = (aoa[i] || []).filter((c) => parseDate(c)).length;
    if (dates > bestDates) { bestDates = dates; headerIdx = i; }
  }

  // 3+ date columns in a header => grid/matrix sheet.
  if (headerIdx >= 0 && bestDates >= 3) return await processMatrix(aoa, headerIdx);

  // Otherwise treat as a tidy list using the first row as headers.
  const header = aoa[0] || [];
  const rows = aoa.slice(1).map((r) => {
    const o = {};
    header.forEach((h, i) => { o[h] = r[i] != null ? r[i] : ''; });
    return o;
  });
  return await processRows(rows);
}

function makeUpsert() {
  return db.prepare(`
    INSERT INTO attendance (employee_id, date, check_in, check_out, status)
    VALUES (@employee_id, @date, @check_in, @check_out, @status)
    ON CONFLICT(employee_id, date) DO UPDATE SET
      status = @status,
      check_in = COALESCE(@check_in, attendance.check_in),
      check_out = COALESCE(@check_out, attendance.check_out)`);
}

// Builds an employee resolver that matches by code, email, or (full) name.
async function buildLookup() {
  const employees = await db.prepare('SELECT id, emp_code, email, name FROM employees').all();
  const byCode = {}, byEmail = {}, byName = {};
  const clean = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  for (const e of employees) {
    if (e.emp_code) byCode[clean(e.emp_code)] = e.id;
    if (e.email) byEmail[clean(e.email)] = e.id;
    if (e.name) byName[clean(e.name)] = e.id;
  }
  return {
    resolve(rec) {
      if (rec.code && byCode[clean(rec.code)]) return byCode[clean(rec.code)];
      if (rec.email && byEmail[clean(rec.email)]) return byEmail[clean(rec.email)];
      if (rec.name && byName[clean(rec.name)]) return byName[clean(rec.name)];
      return null;
    },
  };
}

// Matrix layout: employee per row, date per column.
async function processMatrix(grid, headerIdx) {
  const header = grid[headerIdx];
  const lookup = await buildLookup();
  const upsert = makeUpsert();
  const result = { total: 0, synced: 0, unmatched: 0, errors: [], unmatchedKeys: [], mode: 'grid' };

  // Classify columns: which hold the name/code/email, which hold dates.
  let nameCol = -1, codeCol = -1, emailCol = -1;
  const dateCols = []; // { idx, date }
  header.forEach((h, idx) => {
    const f = COL[norm(h)];
    if (f === 'name' && nameCol === -1) nameCol = idx;
    else if (f === 'code' && codeCol === -1) codeCol = idx;
    else if (f === 'email' && emailCol === -1) emailCol = idx;
    const d = parseDate(h);
    if (d) dateCols.push({ idx, date: d });
  });
  if (nameCol === -1 && codeCol === -1 && emailCol === -1) nameCol = 1; // best guess

  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    const rec = {
      name: nameCol >= 0 ? row[nameCol] : '',
      code: codeCol >= 0 ? row[codeCol] : '',
      email: emailCol >= 0 ? row[emailCol] : '',
    };
    if (!String(rec.name || rec.code || rec.email).trim()) continue; // blank row
    result.total++;

    const empId = lookup.resolve(rec);
    if (!empId) {
      result.unmatched++;
      const key = rec.name || rec.code || rec.email || '(unknown)';
      if (!result.unmatchedKeys.includes(String(key))) result.unmatchedKeys.push(String(key));
      continue;
    }

    for (const dc of dateCols) {
      const status = normaliseStatus(row[dc.idx]);
      if (!status) continue; // blank / week-off / unknown -> leave as is
      await upsert.run({ employee_id: empId, date: dc.date, check_in: null, check_out: null, status });
      result.synced++;
    }
  }
  return result;
}

/**
 * Tidy layout: one row per employee per day.
 * Returns { total, synced, unmatched, errors:[], unmatchedKeys:[] }.
 */
async function processRows(rows) {
  const lookup = await buildLookup();
  const result = { total: rows.length, synced: 0, unmatched: 0, errors: [], unmatchedKeys: [], mode: 'list' };
  const upsert = makeUpsert();

  for (const raw of rows) {
    const rec = {};
    for (const k of Object.keys(raw)) {
      const field = COL[norm(k)];
      if (field) rec[field] = raw[k];
    }

    const date = parseDate(rec.date);
    if (!date) continue; // skip rows without a usable date silently

    const empId = lookup.resolve(rec);
    if (!empId) {
      result.unmatched++;
      const key = rec.code || rec.email || rec.name || '(unknown)';
      if (!result.unmatchedKeys.includes(String(key))) result.unmatchedKeys.push(String(key));
      continue;
    }

    const tIn = parseTime(rec.in);
    const tOut = parseTime(rec.out);
    let status = normaliseStatus(rec.status);
    if (!status) status = tIn ? 'present' : 'absent';

    await upsert.run({
      employee_id: empId,
      date,
      check_in: tIn ? `${date}T${tIn}:00` : null,
      check_out: tOut ? `${date}T${tOut}:00` : null,
      status,
    });
    result.synced++;
  }

  return result;
}

// Turns a normal Google Sheets link into a direct CSV export link.
// Accepts /spreadsheets/d/<ID>/edit#gid=123, ...?gid=123, and already-CSV links.
function toCsvUrl(url) {
  const u = String(url).trim();
  if (/output=csv|format=csv/i.test(u)) return u; // already a CSV link
  const gidMatch = u.match(/[#&?]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : null;

  // Published-to-web format: /spreadsheets/d/e/<token>/pubhtml (or /pub)
  let m = u.match(/spreadsheets\/d\/e\/([a-zA-Z0-9-_]+)/);
  if (m) {
    return `https://docs.google.com/spreadsheets/d/e/${m[1]}/pub?output=csv${gid ? '&gid=' + gid : ''}`;
  }
  // Normal share/edit link: /spreadsheets/d/<id>/edit
  m = u.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) {
    return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid || '0'}`;
  }
  return u; // some other CSV URL — try as-is
}

/** Fetches a Google Sheet / CSV URL (from settings or given) and syncs. */
async function syncFromUrl(url) {
  const raw = url || getSettings().attendanceSheetUrl;
  if (!raw) throw new Error('No Google Sheet link is set. Add it in Settings first.');
  const sheetUrl = toCsvUrl(raw);
  let res;
  try {
    res = await fetch(sheetUrl, { redirect: 'follow' });
  } catch (e) {
    throw new Error('Could not reach the sheet link. Check the URL and your internet.');
  }
  if (!res.ok) {
    throw new Error(`The sheet link returned an error (${res.status}). Make sure the sheet is shared as "Anyone with the link can view", or use File → Share → Publish to web → CSV.`);
  }
  const text = await res.text();
  if (/<html/i.test(text.slice(0, 200))) {
    throw new Error('That link returned a web page, not a sheet. Set the sheet to "Anyone with the link can view", or publish it to the web as CSV, then paste the link again.');
  }
  return await syncFromCsv(text);
}

module.exports = { syncFromCsv, syncFromBuffer, syncFromUrl };
