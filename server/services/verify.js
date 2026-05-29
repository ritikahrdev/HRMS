// Offline ID validation helpers. These confirm a number is well-formed /
// passes its checksum — they do NOT prove the document is genuine (that needs
// a government/KYC API). They reliably catch invalid, mistyped or fake numbers.

// ---- Verhoeff checksum (used by Aadhaar) ----
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

function verhoeffValid(num) {
  let c = 0;
  const digits = String(num).split('').reverse().map(Number);
  for (let i = 0; i < digits.length; i++) c = D[c][P[i % 8][digits[i]]];
  return c === 0;
}

// Aadhaar: 12 digits, not starting with 0/1, passing the Verhoeff checksum.
function validateAadhaar(value) {
  const s = String(value || '').replace(/\s+/g, '');
  if (!/^[2-9][0-9]{11}$/.test(s)) return { value, valid: false, reason: 'Not a valid 12-digit Aadhaar format' };
  if (!verhoeffValid(s)) return { value, valid: false, reason: 'Checksum failed — number is invalid/fake' };
  return { value, valid: true };
}

// PAN: 5 letters, 4 digits, 1 letter (the 4th char encodes holder type).
function validatePAN(value) {
  const s = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(s)) return { value, valid: false, reason: 'Not a valid PAN format (e.g. ABCDE1234F)' };
  if (!'PCHFATBLJG'.includes(s[3])) return { value, valid: false, reason: 'Invalid PAN holder-type character' };
  return { value, valid: true };
}

function validateIFSC(value) {
  const s = String(value || '').trim().toUpperCase();
  return { value, valid: /^[A-Z]{4}0[A-Z0-9]{6}$/.test(s) };
}

module.exports = { validateAadhaar, validatePAN, validateIFSC, verhoeffValid };
