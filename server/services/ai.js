// AI copilot core — provider-agnostic. Supports a FREE LLM (Google Gemini or
// Groq) or paid Claude, picked in Settings → AI Assistant. The admin pastes
// their own API key (a free one for Gemini/Groq). All calls are raw HTTPS —
// same pattern this app already uses for Brevo/Slack, so no new dependency.
const { getSettings } = require('./settings');

// ---- Provider catalogue ----------------------------------------------------
const PROVIDERS = {
  google: {
    label: 'Google Gemini — FREE',
    free: true,
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'Free, no credit card — sign in with Google, click "Get API key".',
    models: [
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash — fast & free (recommended)' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash — smarter, free' },
      { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash — stable, free' },
    ],
  },
  groq: {
    label: 'Groq — FREE & very fast',
    free: true,
    keyUrl: 'https://console.groq.com/keys',
    keyHint: 'Free, no credit card — sign up and create a key.',
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B — capable, free' },
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B — fastest, free' },
    ],
  },
  azure: {
    label: 'Azure OpenAI — your Azure resource',
    free: false,
    needsEndpoint: true,
    keyUrl: 'https://portal.azure.com/',
    keyHint: 'Uses your own Azure OpenAI resource. Set the Endpoint, and put your DEPLOYMENT name in the Model field.',
    models: [
      { id: 'gpt-4o-mini', label: 'gpt-4o-mini (use your deployment name)' },
      { id: 'gpt-4o', label: 'gpt-4o' },
      { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini' },
      { id: 'gpt-35-turbo', label: 'gpt-35-turbo' },
    ],
  },
  anthropic: {
    label: 'Anthropic Claude — paid (most capable)',
    free: false,
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyHint: 'Paid — needs credit on your Anthropic account.',
    models: [
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — cheapest' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — balanced' },
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 — most capable' },
    ],
  },
};

function envKey(provider) {
  if (provider === 'google') return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
  if (provider === 'groq') return process.env.GROQ_API_KEY || '';
  if (provider === 'azure') return process.env.AZURE_OPENAI_API_KEY || '';
  return process.env.ANTHROPIC_API_KEY || '';
}

function aiConfig() {
  const ai = getSettings().ai || {};
  const provider = PROVIDERS[ai.provider] ? ai.provider : 'google';
  const p = PROVIDERS[provider];
  // Azure's "model" is a custom deployment name — accept whatever the admin typed.
  let model = ai.model;
  if (provider !== 'azure' && (!model || !p.models.some((m) => m.id === model))) model = p.models[0].id;
  if (provider === 'azure' && !model) model = p.models[0].id;
  return { enabled: ai.enabled !== false, provider, p, model, apiKey: ai.apiKey || envKey(provider), endpoint: ai.endpoint || process.env.AZURE_OPENAI_ENDPOINT || '' };
}

function isConfigured() {
  const c = aiConfig();
  return !!(c.enabled && c.apiKey);
}

// Public catalogue for the settings UI (no keys leaked).
function catalogue() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, free: p.free, needsEndpoint: !!p.needsEndpoint, keyUrl: p.keyUrl, keyHint: p.keyHint, models: p.models }));
}

// ---- Per-provider callers (each returns plain text, throws friendly errors) -
async function safeFetch(url, opts, providerName) {
  try { return await fetch(url, opts); }
  catch (e) { throw new Error(`Could not reach ${providerName}. Check the server's internet connection.`); }
}
function keyError(provider) { return new Error(`Your ${PROVIDERS[provider].label.split(' —')[0]} API key looks invalid. Check it in Settings → AI Assistant.`); }
function rateError() { return new Error('The AI is busy right now (free-tier rate limit). Please try again in a few seconds.'); }

// Google Gemini (generativelanguage API).
async function callGemini({ apiKey, model, system, messages, maxTokens }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const contents = messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content || '') }] }));
  const body = { contents, generationConfig: { maxOutputTokens: maxTokens } };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const r = await safeFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 'Google Gemini');
  if (!r.ok) {
    let d = ''; try { const j = await r.json(); d = (j.error && j.error.message) || ''; } catch (e) {}
    if (r.status === 400 && /api key not valid|api_key_invalid/i.test(d)) throw keyError('google');
    if (r.status === 429) throw rateError();
    if (r.status === 404) throw new Error(`That Gemini model isn't available. Pick another model in Settings → AI Assistant.`);
    throw new Error('Gemini error' + (d ? ': ' + d.slice(0, 160) : ` (HTTP ${r.status}).`));
  }
  const data = await r.json();
  const cand = (data.candidates || [])[0];
  return ((cand && cand.content && cand.content.parts) || []).map((p) => p.text || '').join('').trim();
}

// Groq (OpenAI-compatible chat completions).
async function callGroq({ apiKey, model, system, messages, maxTokens }) {
  const msgs = system ? [{ role: 'system', content: system }, ...messages] : messages;
  const r = await safeFetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: msgs, max_tokens: maxTokens }),
  }, 'Groq');
  if (!r.ok) {
    let d = ''; try { const j = await r.json(); d = (j.error && j.error.message) || ''; } catch (e) {}
    if (r.status === 401) throw keyError('groq');
    if (r.status === 429) throw rateError();
    if (r.status === 404 || /model.*(not found|decommission)/i.test(d)) throw new Error('That Groq model isn\'t available. Pick another model in Settings → AI Assistant.');
    throw new Error('Groq error' + (d ? ': ' + d.slice(0, 160) : ` (HTTP ${r.status}).`));
  }
  const data = await r.json();
  return (((data.choices || [])[0] || {}).message || {}).content ? data.choices[0].message.content.trim() : '';
}

// Anthropic Claude (Messages API).
async function callAnthropic({ apiKey, model, system, messages, maxTokens }) {
  const r = await safeFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system: system || undefined, messages }),
  }, 'Anthropic');
  if (!r.ok) {
    let d = ''; try { const j = await r.json(); d = (j.error && j.error.message) || ''; } catch (e) {}
    if (r.status === 401) throw keyError('anthropic');
    if (r.status === 429) throw rateError();
    if (r.status === 400 && /credit|balance|billing/i.test(d)) throw new Error('Your Claude account is out of credit. Top it up or switch to a free provider (Settings → AI Assistant).');
    throw new Error('Claude error' + (d ? ': ' + d.slice(0, 160) : ` (HTTP ${r.status}).`));
  }
  const data = await r.json();
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

// Azure OpenAI. Accepts either a v1 base (.../openai/v1) or a bare resource URL.
// The "model" is the Azure DEPLOYMENT name.
async function callAzure({ apiKey, model, endpoint, system, messages, maxTokens }) {
  if (!endpoint) throw new Error('Set your Azure OpenAI Endpoint in Settings → AI Assistant.');
  const base = String(endpoint).replace(/\/+$/, '');
  const url = /\/openai\/v1$/i.test(base)
    ? base + '/chat/completions'
    : base + `/openai/deployments/${encodeURIComponent(model)}/chat/completions?api-version=2024-08-01-preview`;
  const msgs = system ? [{ role: 'system', content: system }, ...messages] : messages;
  const post = (tokenKey) => safeFetch(url, {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: msgs, [tokenKey]: maxTokens }),
  }, 'Azure OpenAI');
  // Newer Azure models (gpt-5 / o-series reasoning models) reject `max_tokens`
  // and require `max_completion_tokens`. Send the classic param first, and if the
  // model rejects it, transparently retry with the new one (works for both).
  let r = await post('max_tokens');
  if (!r.ok && r.status === 400) {
    const t = await r.clone().text().catch(() => '');
    if (/max_completion_tokens/i.test(t)) r = await post('max_completion_tokens');
  }
  if (!r.ok) {
    let d = ''; try { const j = await r.json(); d = (j.error && j.error.message) || ''; } catch (e) {}
    if (r.status === 401) throw keyError('azure');
    if (r.status === 429) throw rateError();
    if (r.status === 404 || /deployment.*(not exist|not found)/i.test(d)) throw new Error('Azure: that deployment or endpoint wasn\'t found. Check the Endpoint and your deployment name (the Model field) in Settings.');
    throw new Error('Azure OpenAI error' + (d ? ': ' + d.slice(0, 160) : ` (HTTP ${r.status}).`));
  }
  const data = await r.json();
  return (((data.choices || [])[0] || {}).message || {}).content ? data.choices[0].message.content.trim() : '';
}

const CALLERS = { google: callGemini, groq: callGroq, azure: callAzure, anthropic: callAnthropic };

// ---- Unified interface -----------------------------------------------------
async function callLLM({ system, messages, maxTokens = 1024 }) {
  const c = aiConfig();
  if (!c.apiKey) { const e = new Error('AI is not set up yet. Add an API key in Settings → AI Assistant.'); e.notConfigured = true; throw e; }
  return CALLERS[c.provider]({ apiKey: c.apiKey, model: c.model, endpoint: c.endpoint, system, messages, maxTokens });
}

async function complete(system, userText, maxTokens) {
  return callLLM({ system, messages: [{ role: 'user', content: userText }], maxTokens });
}

async function completeJSON(system, userText, maxTokens) {
  const raw = await complete(system + '\n\nRespond with ONLY valid JSON — no markdown fences, no commentary.', userText, maxTokens);
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(cleaned); } catch (e) {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (e2) {} }
    throw new Error('The AI returned an unexpected response. Please try again.');
  }
}

module.exports = { PROVIDERS, catalogue, aiConfig, isConfigured, callLLM, complete, completeJSON };
