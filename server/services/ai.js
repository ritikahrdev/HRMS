// AI copilot core. Calls the Claude (Anthropic) Messages API over HTTPS — same
// raw-fetch pattern this app already uses for Brevo and Slack, so there's no new
// dependency and nothing extra to install on deploy.
//
// The API key is NOT baked in — the admin pastes their own Claude key in
// Settings → AI (stored in settings.ai). Until that's set, every AI feature
// degrades gracefully with a "configure AI" message instead of erroring.
const { getSettings } = require('./settings');

const API_URL = 'https://api.anthropic.com/v1/messages';

// Models the admin can pick in Settings (id + friendly label + rough cost note).
const MODELS = [
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — fastest & cheapest (recommended)' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — balanced' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 — most capable (priciest)' },
];

function aiConfig() {
  const s = getSettings();
  const ai = s.ai || {};
  return {
    enabled: ai.enabled !== false,         // default on once a key exists
    apiKey: ai.apiKey || process.env.ANTHROPIC_API_KEY || '',
    model: ai.model || 'claude-haiku-4-5',
  };
}

function isConfigured() {
  const c = aiConfig();
  return !!(c.enabled && c.apiKey);
}

// Low-level call. messages = [{role:'user'|'assistant', content:'...'}].
// Returns the assistant's text. Throws a friendly Error on failure.
async function callClaude({ system, messages, maxTokens = 1024, model }) {
  const c = aiConfig();
  if (!c.apiKey) { const e = new Error('AI is not set up yet. Add your Claude API key in Settings → AI Assistant.'); e.notConfigured = true; throw e; }

  let r;
  try {
    r = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': c.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: model || c.model, max_tokens: maxTokens, system: system || undefined, messages }),
    });
  } catch (e) {
    throw new Error('Could not reach the AI service. Check the server\'s internet connection.');
  }

  if (!r.ok) {
    let detail = '';
    try { const j = await r.json(); detail = (j.error && j.error.message) || ''; } catch (e) {}
    if (r.status === 401) throw new Error('Your Claude API key looks invalid. Check it in Settings → AI Assistant.');
    if (r.status === 429) throw new Error('The AI is rate-limited right now. Please try again in a moment.');
    if (r.status === 400 && /credit|balance|billing/i.test(detail)) throw new Error('Your Claude account is out of credit. Top it up to keep using AI.');
    throw new Error('AI error' + (detail ? ': ' + detail.slice(0, 160) : ` (HTTP ${r.status}).`));
  }

  const data = await r.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  return text;
}

// Single-turn convenience: a system prompt + one user message → text.
async function complete(system, userText, maxTokens) {
  return callClaude({ system, messages: [{ role: 'user', content: userText }], maxTokens });
}

// Ask for JSON and parse it defensively (handles models that wrap it in prose).
async function completeJSON(system, userText, maxTokens) {
  const raw = await complete(system + '\n\nRespond with ONLY valid JSON, no markdown, no commentary.', userText, maxTokens);
  try { return JSON.parse(raw); } catch (e) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (e2) {} }
    throw new Error('The AI returned an unexpected response. Please try again.');
  }
}

module.exports = { MODELS, aiConfig, isConfigured, callClaude, complete, completeJSON };
