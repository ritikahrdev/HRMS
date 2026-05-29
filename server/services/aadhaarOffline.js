// Verifies a UIDAI "Offline e-KYC" XML: extracts the resident details and
// checks UIDAI's XML digital signature against the configured UIDAI public
// certificate. A valid signature proves the file is genuinely UIDAI-issued
// and untampered — no API or licence needed.
const { SignedXml } = require('xml-crypto');
const { DOMParser } = require('@xmldom/xmldom');
const xpath = require('xpath');

// Pull the resident fields out of the offline e-KYC XML.
function parseFields(xml) {
  const doc = new DOMParser({ onError: () => {} }).parseFromString(xml, 'text/xml');
  if (!doc || !doc.documentElement) throw new Error('Not a valid XML file.');
  const root = doc.documentElement;
  const referenceId = root.getAttribute('referenceId') || '';
  const poi = xpath.select("//*[local-name(.)='Poi']", doc)[0];
  const get = (n, a) => (n && n.getAttribute ? n.getAttribute(a) || '' : '');
  return {
    referenceId,
    last4: referenceId.slice(0, 4),
    name: get(poi, 'name'),
    dob: get(poi, 'dob'),
    gender: get(poi, 'gender'),
  };
}

// Verify the enveloped XML-DSig signature using the UIDAI public certificate.
function verifySignature(xml, certPem) {
  const doc = new DOMParser({ onError: () => {} }).parseFromString(xml, 'text/xml');
  const sigNode = xpath.select("//*[local-name(.)='Signature']", doc)[0];
  if (!sigNode) return { signatureValid: false, reason: 'No digital signature found in the file.' };
  if (!certPem) return { signatureValid: null, reason: 'UIDAI public certificate is not configured in Settings.' };
  try {
    const sig = new SignedXml({ publicCert: certPem });
    sig.loadSignature(sigNode);
    const ok = sig.checkSignature(xml);
    return { signatureValid: ok, reason: ok ? '' : (sig.getSignedReferences && '' || (sig.validationErrors || []).join('; ')) };
  } catch (e) {
    return { signatureValid: false, reason: e.message };
  }
}

// Full check: parse + verify. Returns combined result.
function check(xml, certPem) {
  const fields = parseFields(xml);
  const sig = verifySignature(xml, certPem);
  return { ...fields, ...sig };
}

module.exports = { parseFields, verifySignature, check };
