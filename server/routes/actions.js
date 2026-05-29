const express = require('express');
const { verifyToken } = require('../services/tokens');
const { applyLeaveDecision, applyReimbursementDecision } = require('../services/decisions');

const router = express.Router();

function page(title, message, ok) {
  const color = ok ? '#16a34a' : '#dc2626';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title}</title></head>
    <body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f4f6fb;margin:0;padding:40px;text-align:center;color:#1f2937">
      <div style="max-width:420px;margin:40px auto;background:#fff;border-radius:14px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.1)">
        <div style="font-size:40px;color:${color}">${ok ? '&#10003;' : '&#9888;'}</div>
        <h2 style="margin:8px 0">${title}</h2>
        <p style="color:#6b7280">${message}</p>
      </div>
    </body></html>`;
}

// One-click approve/reject from an email. No login; protected by a signed token.
// /api/actions/:type/:id/:decision?t=token   (type = leave | reimbursement)
router.get('/:type/:id/:decision', async (req, res) => {
  const { type, id, decision } = req.params;
  const token = req.query.t;

  if (!['leave', 'reimbursement'].includes(type) || !['approved', 'rejected'].includes(decision)) {
    return res.status(400).send(page('Invalid link', 'This action link is not valid.', false));
  }
  if (!verifyToken([type, String(id), decision], token)) {
    return res.status(403).send(page('Link expired or invalid', 'This approval link could not be verified. Please log in to the portal instead.', false));
  }

  try {
    const fn = type === 'leave' ? applyLeaveDecision : applyReimbursementDecision;
    const result = await fn(Number(id), decision, 'Decided via email link', null);
    if (result.notFound) return res.status(404).send(page('Not found', 'That request no longer exists.', false));
    if (result.already) return res.send(page('Already decided', 'This request was already handled earlier.', true));
    const word = decision === 'approved' ? 'approved' : 'rejected';
    return res.send(page(`Request ${word}`, `The ${type} request has been ${word}. The employee has been notified.`, true));
  } catch (e) {
    return res.status(500).send(page('Something went wrong', e.message, false));
  }
});

module.exports = router;
