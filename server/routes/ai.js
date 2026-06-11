const express = require('express');
const db = require('../db');
const { requireLogin, requirePerm } = require('../middleware/auth');
const { can } = require('../services/permissions');
const { getSettings } = require('../services/settings');
const ai = require('../services/ai');

const router = express.Router();

function todayStr() { return new Date().toISOString().slice(0, 10); }

// ---- Assemble role-scoped HRMS context for the assistant ------------------
// An employee only ever sees their own data + public/company info. Staff with
// the right permission additionally see org-wide aggregates.
async function buildContext(req) {
  const s = getSettings();
  const u = req.session.user;
  const role = u.role;
  const lines = [];
  lines.push(`Today is ${todayStr()}. Company: ${s.companyName || 'the company'}. Currency: ${s.currency || '₹'}.`);

  // Company policy snapshot (safe for everyone).
  lines.push('--- Company policy ---');
  lines.push(`Work hours: ${s.workStart || '?'}–${s.workEnd || '?'} (full day ${s.fullDayHours || 9}h, half day ${s.halfDayHours || 4.5}h, grace ${s.graceMinutes != null ? s.graceMinutes : 30} min).`);
  if (Array.isArray(s.leaveTypes) && s.leaveTypes.length) {
    lines.push('Leave types: ' + s.leaveTypes.map((t) => `${t.name} (${t.paid !== false ? 'paid' : 'unpaid'}${t.quota ? ', ' + t.quota + '/yr' : ''})`).join('; ') + '.');
  }
  if (s.leaveAccrual && s.leaveAccrual.enabled) lines.push('Leave accrues monthly (earned over the year), with year-end carry-forward caps.');
  if (s.birthdayEmails !== false) lines.push('Birthday wishes are sent automatically.');
  const holidayCount = (await db.prepare("SELECT COUNT(*) c FROM holidays WHERE substr(date,1,4)=?").get(String(new Date().getFullYear()))).c;
  lines.push(`Holidays configured this year: ${holidayCount}.`);

  // The asking user's own profile + balances.
  if (u.employeeId) {
    const e = await db.prepare('SELECT name, emp_code, department, designation, date_of_joining, (SELECT name FROM employees m WHERE m.id=employees.manager_id) AS manager_name FROM employees WHERE id=?').get(u.employeeId);
    if (e) {
      lines.push('--- The person you are helping ---');
      lines.push(`${e.name} — ${e.designation || 'employee'}, ${e.department || 'no dept'}. Joined ${e.date_of_joining || '?'}. Manager: ${e.manager_name || '—'}.`);
      const year = String(new Date().getFullYear());
      const used = await db.prepare("SELECT type, COALESCE(SUM(days),0) d FROM leave_requests WHERE employee_id=? AND status='approved' AND substr(from_date,1,4)=? GROUP BY type").all(u.employeeId, year);
      const usedMap = {}; for (const x of used) usedMap[x.type] = x.d;
      const bal = (s.leaveTypes || []).filter((t) => t.code !== 'unpaid').map((t) => `${t.name}: ${Math.max(0, (t.quota || 0) - (usedMap[t.code] || 0))} left of ${t.quota || 0}`).join('; ');
      if (bal) lines.push('Their leave balance this year — ' + bal + '.');
      const pend = await db.prepare("SELECT type, from_date, to_date FROM leave_requests WHERE employee_id=? AND status='pending'").all(u.employeeId);
      if (pend.length) lines.push('Their pending leave requests: ' + pend.map((p) => `${p.type} ${p.from_date}→${p.to_date}`).join(', ') + '.');
    }
  }

  // Org-wide aggregates for staff who may see everyone's data.
  if (can(role, 'attendance:viewAll') || can(role, 'reports:view')) {
    lines.push('--- Org snapshot (staff view) ---');
    const total = (await db.prepare("SELECT COUNT(*) c FROM employees WHERE status='active'").get()).c;
    lines.push(`Active employees: ${total}.`);
    const onLeave = await db.prepare("SELECT e.name FROM leave_requests lr JOIN employees e ON e.id=lr.employee_id WHERE lr.status='approved' AND lr.from_date<=? AND lr.to_date>=?").all(todayStr(), todayStr());
    lines.push(`On approved leave today (${onLeave.length}): ${onLeave.map((x) => x.name).join(', ') || 'nobody'}.`);
    const present = (await db.prepare("SELECT COUNT(*) c FROM attendance WHERE date=? AND (status='present' OR check_in IS NOT NULL)").get(todayStr())).c;
    lines.push(`Marked present today: ${present}.`);
    const byDept = await db.prepare("SELECT department, COUNT(*) c FROM employees WHERE status='active' GROUP BY department ORDER BY c DESC").all();
    lines.push('Headcount by department: ' + byDept.map((d) => `${d.department || 'None'}=${d.c}`).join(', ') + '.');
  }
  if (can(role, 'leave:approve')) {
    const p = (await db.prepare("SELECT COUNT(*) c FROM leave_requests WHERE status='pending'").get()).c;
    lines.push(`Pending leave approvals: ${p}.`);
  }
  return lines.join('\n');
}

const ASSISTANT_SYSTEM = `You are the friendly in-app HR assistant for an HRMS used by a small company. Answer questions using ONLY the context provided about this company and this user. Be concise, warm, and practical. Use the company currency symbol where relevant. If the answer isn't in the context (e.g. a private detail about another employee the user isn't allowed to see, or data the system doesn't track), say so plainly and suggest where in the HRMS they could look. Never invent numbers, names, or policy. Format short lists with bullet points.`;

// ---- Status (any logged-in user) ------------------------------------------
router.get('/status', requireLogin, (req, res) => {
  const c = ai.aiConfig();
  res.json({ configured: ai.isConfigured(), enabled: c.enabled, model: c.model, models: ai.MODELS });
});

// ---- Assistant chat -------------------------------------------------------
router.post('/chat', requireLogin, async (req, res) => {
  try {
    if (!ai.isConfigured()) return res.status(400).json({ error: 'AI is not set up yet. An admin can add a Claude API key in Settings → AI Assistant.', notConfigured: true });
    const history = Array.isArray(req.body && req.body.messages) ? req.body.messages : [];
    const question = (req.body && req.body.question || '').toString().trim();
    if (!question && !history.length) return res.status(400).json({ error: 'Ask a question first.' });
    const context = await buildContext(req);
    const messages = history.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-10);
    if (question) messages.push({ role: 'user', content: question });
    const system = `${ASSISTANT_SYSTEM}\n\n--- CONTEXT ---\n${context}`;
    const answer = await ai.callClaude({ system, messages, maxTokens: 1024 });
    res.json({ answer });
  } catch (e) { res.status(e.notConfigured ? 400 : 500).json({ error: e.message }); }
});

// ---- Draft content (auto-safe: returns text, user reviews before posting) --
const DRAFT_PROMPTS = {
  announcement: 'Write a clear, friendly internal company announcement. Keep it concise and professional.',
  job: 'Write a structured job description (role summary, key responsibilities as bullets, required skills, nice-to-haves). Concise and appealing.',
  review: 'Write balanced, specific, constructive performance-review feedback (strengths, areas to improve, suggested goals). Professional and encouraging.',
  email: 'Write a short, polite, professional email.',
  policy: 'Write a clear, concise HR policy statement in plain language.',
  general: 'Write helpful, well-structured content for an internal HR context.',
};
router.post('/draft', requireLogin, async (req, res) => {
  try {
    if (!ai.isConfigured()) return res.status(400).json({ error: 'AI is not set up yet. Add a Claude API key in Settings → AI Assistant.', notConfigured: true });
    const kind = (req.body && req.body.kind) || 'general';
    const brief = (req.body && req.body.brief || '').toString().trim();
    if (!brief) return res.status(400).json({ error: 'Tell the AI what to write about.' });
    const s = getSettings();
    const system = `${DRAFT_PROMPTS[kind] || DRAFT_PROMPTS.general}\nCompany: ${s.companyName || 'the company'}. Write in the company's voice. Output only the content itself — no preamble, no "Here is...".`;
    const text = await ai.complete(system, brief, 1500);
    res.json({ text });
  } catch (e) { res.status(e.notConfigured ? 400 : 500).json({ error: e.message }); }
});

// ---- Approval recommendations (suggest only — HR still confirms) ----------
router.get('/recommendations', requirePerm('leave:approve'), async (req, res) => {
  try {
    if (!ai.isConfigured()) return res.json({ configured: false, recommendations: {} });
    const type = req.query.type === 'reimbursement' ? 'reimbursement' : 'leave';
    let pending;
    if (type === 'leave') {
      pending = await db.prepare(`SELECT lr.id, lr.type, lr.from_date, lr.to_date, lr.days, lr.reason, e.name, e.department,
        (SELECT COALESCE(SUM(days),0) FROM leave_requests x WHERE x.employee_id=lr.employee_id AND x.status='approved' AND substr(x.from_date,1,4)=substr(lr.from_date,1,4)) AS used_this_year
        FROM leave_requests lr JOIN employees e ON e.id=lr.employee_id WHERE lr.status='pending' ORDER BY lr.applied_at LIMIT 20`).all();
    } else {
      pending = await db.prepare(`SELECT r.id, r.title, r.category, r.amount, e.name, e.department
        FROM reimbursements r JOIN employees e ON e.id=r.employee_id WHERE r.status='pending' ORDER BY r.applied_at LIMIT 20`).all();
    }
    if (!pending.length) return res.json({ configured: true, recommendations: {} });
    const s = getSettings();
    const quotas = (s.leaveTypes || []).map((t) => `${t.code}=${t.quota || 0}/yr`).join(', ');
    const system = `You help an HR manager triage pending ${type} requests. For EACH request, suggest "approve" or "reject" and a one-line reason (max 18 words). Be reasonable and lenient by default; flag only genuine concerns (e.g. exceeds yearly quota, missing reason, unusually large amount). This is advisory — a human will confirm. Leave quotas: ${quotas || 'n/a'}.`;
    const payload = JSON.stringify(pending);
    const out = await ai.completeJSON(system, `Requests:\n${payload}\n\nReturn a JSON object mapping each request id (as a string) to {"suggestion":"approve"|"reject","reason":"..."}.`, 900);
    res.json({ configured: true, recommendations: out || {} });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Resume / candidate screening -----------------------------------------
router.post('/screen/:applicantId', requirePerm('recruitment:manage'), async (req, res) => {
  try {
    if (!ai.isConfigured()) return res.status(400).json({ error: 'AI is not set up yet. Add a Claude API key in Settings → AI Assistant.', notConfigured: true });
    const a = await db.prepare('SELECT * FROM applicants WHERE id=?').get(req.params.applicantId);
    if (!a) return res.status(404).json({ error: 'Applicant not found.' });
    const job = a.job_id ? await db.prepare('SELECT title, description, skills, min_experience FROM jobs WHERE id=?').get(a.job_id) : null;
    const system = 'You are a fair, unbiased recruiter screening a candidate against a job. Score fit 0–100. Be objective; ignore name, gender, age, or anything unrelated to ability to do the job.';
    const prompt = `JOB:\n${job ? `Title: ${job.title}\nRequired skills: ${job.skills || '—'}\nMin experience: ${job.min_experience || 0} yrs\nDescription: ${(job.description || '').slice(0, 800)}` : '(no job details)'}\n\nCANDIDATE:\nName: ${a.name}\nExperience: ${a.experience_years || 0} yrs\nSkills: ${a.skills || '—'}\nNotes: ${a.notes || '—'}\n\nReturn JSON: {"score":0-100,"recommendation":"strong"|"maybe"|"weak","summary":"2-sentence summary","strengths":["..."],"concerns":["..."]}`;
    const out = await ai.completeJSON(system, prompt, 700);
    res.json({ screening: out });
  } catch (e) { res.status(e.notConfigured ? 400 : 500).json({ error: e.message }); }
});

module.exports = router;
