const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getSettings } = require('./settings');

// Plain en-IN amount, 2 decimals, no symbol (matches the slip layout; the rupee
// glyph isn't in PDF core fonts, so amounts read as numbers + "Indian Rupee" words).
function fmt(n) {
  return Number(n || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function monthLabel(monthStr) {
  const [y, m] = String(monthStr || '').split('-');
  const d = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
  return isNaN(d.getTime()) ? String(monthStr || '') : d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function fmtDate(s) {
  if (!s) return '-';
  const d = new Date(String(s).replace(' ', 'T'));
  if (isNaN(d.getTime())) return '-';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// Whole-rupee amount → Indian-system words ("Fifty-Eight Thousand …").
function inWords(num) {
  num = Math.round(Number(num) || 0);
  if (num === 0) return 'Zero';
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (n) => (n < 20 ? a[n] : b[Math.floor(n / 10)] + (n % 10 ? '-' + a[n % 10] : ''));
  const three = (n) => {
    const h = Math.floor(n / 100), r = n % 100;
    return (h ? a[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? two(r) : '');
  };
  let w = '';
  const crore = Math.floor(num / 10000000); num %= 10000000;
  const lakh = Math.floor(num / 100000); num %= 100000;
  const thousand = Math.floor(num / 1000); num %= 1000;
  if (crore) w += three(crore) + ' Crore ';
  if (lakh) w += two(lakh) + ' Lakh ';
  if (thousand) w += two(thousand) + ' Thousand ';
  if (num) w += three(num);
  return w.trim();
}

/**
 * Builds a Zoho-style payslip PDF (Hrika / company-owned) and returns the path.
 * Layout: header → employee summary + net-pay card → earnings/deductions table
 * → total net payable → amount in words → system note → "Powered by Hrika".
 */
function buildPayslipPdf(employee, slip) {
  const s = getSettings();
  const L = 50, R = 545, W = R - L; // content box
  const fileName = `payslip-${employee.emp_code || employee.id}-${slip.month}.pdf`;
  const filePath = path.join(config.paths.uploads, fileName);

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  // ---- Header: company (left) + "Payslip For The Month" (right) ----
  let cx = L;
  if (s.logoFile) {
    const logoPath = path.join(config.paths.uploads, s.logoFile);
    if (fs.existsSync(logoPath)) {
      try { doc.image(logoPath, L, 46, { fit: [104, 46] }); cx = L + 116; } catch (e) { /* ignore */ }
    }
  }
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(16).text(s.companyName || 'Company', cx, 50, { width: 300 });
  const addr = [s.address, s.gst ? 'GSTIN: ' + s.gst : '', s.email].filter(Boolean).join('\n');
  doc.fillColor('#6b7280').font('Helvetica').fontSize(8.5).text(addr, cx, 73, { width: 300 });
  doc.fillColor('#6b7280').font('Helvetica-Bold').fontSize(9).text('PAYSLIP FOR THE MONTH', L, 50, { width: W, align: 'right', characterSpacing: 0.6 });
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(14).text(monthLabel(slip.month), L, 64, { width: W, align: 'right' });

  doc.moveTo(L, 110).lineTo(R, 110).lineWidth(1).strokeColor('#e5e7eb').stroke();

  // ---- Employee summary band + net-pay card ----
  const bT = 124, bH = 120;
  doc.roundedRect(L, bT, W, bH, 10).fill('#f8f9fc');
  doc.roundedRect(L, bT, W, bH, 10).lineWidth(1).strokeColor('#edeff5').stroke();
  doc.fillColor('#8a93a6').font('Helvetica-Bold').fontSize(8).text('EMPLOYEE SUMMARY', L + 18, bT + 16, { characterSpacing: 0.5 });
  const sumRows = [
    ['Employee Name', employee.name || '-'],
    ['Employee ID', employee.emp_code || '-'],
    ['Pay Period', monthLabel(slip.month)],
    ['Pay Date', fmtDate(slip.generated_at)],
  ];
  sumRows.forEach((r, i) => {
    const y = bT + 38 + i * 18;
    doc.fillColor('#6b7280').font('Helvetica').fontSize(9.5).text(r[0], L + 18, y, { width: 95 });
    doc.fillColor('#1f2937').font('Helvetica-Bold').fontSize(9.5).text(': ' + r[1], L + 118, y, { width: 190 });
  });
  // Net-pay card (right)
  const cX = 372, cY = bT + 16, cW = 158, cH = 64;
  doc.roundedRect(cX, cY, cW, cH, 8).fill('#eafaf1');
  doc.roundedRect(cX, cY, cW, cH, 8).lineWidth(1).strokeColor('#bfead0').stroke();
  doc.fillColor('#15803d').font('Helvetica-Bold').fontSize(19).text(fmt(slip.net_salary), cX + 14, cY + 13, { width: cW - 28 });
  doc.fillColor('#3f9e63').font('Helvetica').fontSize(8).text('Total Net Pay', cX + 14, cY + 42);
  doc.fillColor('#374151').font('Helvetica-Bold').fontSize(9).text(`Paid Days: ${slip.paid_days}     LOP Days: ${slip.unpaid_days || 0}`, cX, bT + 92, { width: cW + 8, align: 'left' });

  // ---- Earnings / Deductions table ----
  let breakup = null;
  try { breakup = slip.breakup ? JSON.parse(slip.breakup) : null; } catch (e) { breakup = null; }
  const earnings = (breakup && breakup.earnings && breakup.earnings.length)
    ? breakup.earnings.map((e) => [e.name, e.amount])
    : [['Basic', slip.gross]];
  if (slip.reimbursements) earnings.push(['Reimbursements', slip.reimbursements]);
  const deductions = (breakup && breakup.deductions && breakup.deductions.length)
    ? breakup.deductions.map((d) => [d.name, d.amount])
    : (slip.deductions ? [['Loss of Pay', slip.deductions]] : [['Income Tax', 0]]);

  const tT = bT + bH + 22;            // table top
  const eAmtR = 290, dLabel = 310, dAmtR = 533, mid = 300;
  doc.rect(L, tT, W, 24).fill('#eef1f8');
  doc.fillColor('#475467').font('Helvetica-Bold').fontSize(9)
    .text('EARNINGS', L + 12, tT + 8)
    .text('AMOUNT', 200, tT + 8, { width: eAmtR - 200, align: 'right' })
    .text('DEDUCTIONS', dLabel, tT + 8)
    .text('AMOUNT', 447, tT + 8, { width: dAmtR - 447, align: 'right' });

  const rowH = 18, bodyTop = tT + 24;
  const maxRows = Math.max(earnings.length, deductions.length);
  doc.font('Helvetica').fontSize(9.5);
  for (let i = 0; i < maxRows; i++) {
    const y = bodyTop + i * rowH;
    if (earnings[i]) {
      doc.fillColor('#344054').text(String(earnings[i][0]), L + 12, y, { width: 170 });
      doc.fillColor('#111827').text(fmt(earnings[i][1]), 200, y, { width: eAmtR - 200, align: 'right' });
    }
    if (deductions[i]) {
      doc.fillColor('#344054').text(String(deductions[i][0]), dLabel, y, { width: 140 });
      doc.fillColor('#111827').text(fmt(deductions[i][1]), 447, y, { width: dAmtR - 447, align: 'right' });
    }
  }
  // Totals row
  const totT = bodyTop + maxRows * rowH;
  const totE = earnings.reduce((a, e) => a + (Number(e[1]) || 0), 0);
  const totD = deductions.reduce((a, d) => a + (Number(d[1]) || 0), 0);
  doc.rect(L, totT, W, 24).fill('#f5f6fb');
  doc.fillColor('#1f2937').font('Helvetica-Bold').fontSize(9.5)
    .text('Gross Earnings', L + 12, totT + 7)
    .text(fmt(totE), 200, totT + 7, { width: eAmtR - 200, align: 'right' })
    .text('Total Deductions', dLabel, totT + 7)
    .text(fmt(totD), 447, totT + 7, { width: dAmtR - 447, align: 'right' });
  // Table border + middle divider
  const tBottom = totT + 24;
  doc.rect(L, tT, W, tBottom - tT).lineWidth(1).strokeColor('#e5e7eb').stroke();
  doc.moveTo(mid, tT).lineTo(mid, tBottom).strokeColor('#e9ebf2').stroke();

  // ---- Total net payable band ----
  let y = tBottom + 18;
  doc.roundedRect(L, y, W, 48, 8).fill('#eef2ff');
  doc.fillColor('#3730a3').font('Helvetica-Bold').fontSize(11).text('TOTAL NET PAYABLE', L + 16, y + 11);
  doc.fillColor('#6b7280').font('Helvetica').fontSize(7.5).text('Gross Earnings − Total Deductions', L + 16, y + 28);
  doc.fillColor('#3730a3').font('Helvetica-Bold').fontSize(16).text(fmt(slip.net_salary), 345, y + 14, { width: 184, align: 'right' });

  // ---- Amount in words + system note ----
  y += 48 + 16;
  doc.fillColor('#374151').font('Helvetica-Oblique').fontSize(9.5).text(`Amount In Words : Indian Rupee ${inWords(slip.net_salary)} Only`, L, y, { width: W });
  y += 28;
  doc.fillColor('#9ca3af').font('Helvetica').fontSize(8).text(s.slipFooter || '— This is a system-generated document and does not require a signature. —', L, y, { width: W, align: 'center' });

  // ---- Footer: Hrika branding ----
  doc.moveTo(L, 802).lineTo(R, 802).lineWidth(1).strokeColor('#eceef3').stroke();
  doc.fillColor('#9ca3af').font('Helvetica').fontSize(8).text('Powered by Hrika · your people, handled', L, 810, { width: W, align: 'center' });

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

module.exports = { buildPayslipPdf };
