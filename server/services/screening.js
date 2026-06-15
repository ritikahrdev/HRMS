// Shared candidate-screening logic. Both the public apply flow (careers.js) and
// the bulk "Auto-screen all" button (recruitment.js) use this so every applicant
// is routed the same way against the job requirement — no manual effort:
//   strong fit (or strong keyword match) -> shortlisted
//   weak fit                             -> rejected
//   borderline                           -> maybe
// Nothing is left sitting in "applied" once screened.
const ai = require('./ai');

const SCREEN_SYSTEM = 'You are a fair, unbiased recruiter screening a candidate against a job. Score fit 0–100. Be objective; ignore name, gender, age, or anything unrelated to ability to do the job.';

function screenPrompt(job, c) {
  return `JOB:\nTitle: ${job.title}\nRequired skills: ${job.skills || '—'}\nMin experience: ${job.min_experience || 0} yrs\nDescription: ${(job.description || '').slice(0, 800)}\n\nCANDIDATE:\nExperience: ${c.experience_years || 0} yrs\nSkills: ${c.skills || '—'}\nNote: ${c.note || '—'}\n\nReturn JSON: {"score":0-100,"recommendation":"strong"|"maybe"|"weak","summary":"2-sentence summary"}`;
}

// Ask the AI to judge a candidate against the job. Returns null when AI is not
// configured or the call fails — the caller then falls back to the keyword score.
async function aiScreen(job, candidate) {
  if (!ai.isConfigured()) return null;
  try {
    const r = await ai.completeJSON(SCREEN_SYSTEM, screenPrompt(job, candidate), 400);
    return {
      score: Math.max(0, Math.min(100, Number(r.score) || 0)),
      recommendation: ['strong', 'maybe', 'weak'].includes(String(r.recommendation)) ? String(r.recommendation) : 'maybe',
      summary: String(r.summary || '').slice(0, 400),
    };
  } catch (e) {
    return null;
  }
}

// Decide the pipeline stage from the keyword score + the AI verdict.
function decideStage({ keywordScore = 0, ai: aiRes, aiConfigured = false }) {
  if (aiRes && aiRes.recommendation) {
    if (aiRes.recommendation === 'strong' || keywordScore >= 60) return 'shortlisted';
    if (aiRes.recommendation === 'weak') return 'rejected';
    return 'maybe';
  }
  if (aiConfigured) {
    // AI is on but returned nothing (transient failure) — never auto-reject a real
    // person on a flaky call. Shortlist clear keyword matches, otherwise hold as maybe.
    return keywordScore >= 60 ? 'shortlisted' : 'maybe';
  }
  // No AI at all: lean on the keyword score alone.
  if (keywordScore >= 60) return 'shortlisted';
  if (keywordScore < 30) return 'rejected';
  return 'maybe';
}

const STAGE_LABEL = { shortlisted: '⭐ Shortlisted', maybe: '🤔 Maybe', rejected: '🚫 Auto-rejected' };

module.exports = { aiScreen, decideStage, STAGE_LABEL, SCREEN_SYSTEM, screenPrompt };
