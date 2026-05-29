const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getSettings } = require('./settings');

function money(cur, n) {
  return `${cur}${Number(n || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function monthLabel(monthStr) {
  const [y, m] = monthStr.split('-');
  const d = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

/** Builds a payslip PDF and returns the absolute file path. */
function buildPayslipPdf(employee, slip) {
  const settings = getSettings();
  const cur = settings.currency || '₹';
  const fileName = `payslip-${employee.emp_code || employee.id}-${slip.month}.pdf`;
  const filePath = path.join(config.paths.uploads, fileName);

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  // Header
  if (settings.logoFile) {
    const logoPath = path.join(config.paths.uploads, settings.logoFile);
    if (fs.existsSync(logoPath)) {
      try {
        doc.image(logoPath, 50, 45, { fit: [90, 60] });
      } catch (e) {
        /* ignore bad image */
      }
    }
  }
  doc.fontSize(18).font('Helvetica-Bold').text(settings.companyName || 'Company', 150, 50, {
    align: 'right',
  });
  const headerLines = [settings.address, settings.gst ? 'GSTIN: ' + settings.gst : '', settings.email]
    .filter(Boolean).join('\n');
  doc.fontSize(9).font('Helvetica').fillColor('#555')
    .text(headerLines, 150, 75, { align: 'right' });
  doc.fillColor('#000');

  doc.moveTo(50, 115).lineTo(545, 115).stroke('#cccccc');
  doc.fontSize(14).font('Helvetica-Bold')
    .text(`Payslip - ${monthLabel(slip.month)}`, 50, 130);

  // Employee info table
  let y = 165;
  const rowsLeft = [
    ['Employee', employee.name],
    ['Employee Code', employee.emp_code || '-'],
    ['Department', employee.department || '-'],
    ['Designation', employee.designation || '-'],
  ];
  const rowsRight = [
    ['Email', employee.email || '-'],
    ['PAN', employee.pan || '-'],
    ['Bank A/C', employee.bank_account || '-'],
    ['IFSC', employee.ifsc || '-'],
  ];
  doc.fontSize(10);
  rowsLeft.forEach((r, i) => {
    doc.font('Helvetica-Bold').text(r[0], 50, y + i * 18, { width: 110 });
    doc.font('Helvetica').text(String(r[1]), 160, y + i * 18, { width: 130 });
  });
  rowsRight.forEach((r, i) => {
    doc.font('Helvetica-Bold').text(r[0], 310, y + i * 18, { width: 80 });
    doc.font('Helvetica').text(String(r[1]), 390, y + i * 18, { width: 155 });
  });

  y += 4 * 18 + 20;
  doc.moveTo(50, y).lineTo(545, y).stroke('#cccccc');
  y += 15;

  // Attendance summary
  doc.fontSize(11).font('Helvetica-Bold').text('Attendance Summary', 50, y);
  y += 20;
  doc.fontSize(10).font('Helvetica');
  const summary = [
    ['Working Days', slip.working_days],
    ['Present Days', slip.present_days],
    ['Paid Leave', slip.paid_leave],
    ['Loss of Pay Days', slip.unpaid_days],
    ['Paid Days', slip.paid_days],
  ];
  summary.forEach((r, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    doc.font('Helvetica-Bold').text(r[0], 50 + col * 260, y + row * 18, { width: 150 });
    doc.font('Helvetica').text(String(r[1]), 200 + col * 260, y + row * 18, { width: 60 });
  });
  y += Math.ceil(summary.length / 2) * 18 + 20;

  // Earnings / Deductions
  doc.moveTo(50, y).lineTo(545, y).stroke('#cccccc');
  y += 15;
  doc.fontSize(11).font('Helvetica-Bold');
  doc.text('Earnings', 50, y);
  doc.text('Amount', 230, y, { width: 90, align: 'right' });
  doc.text('Deductions', 330, y);
  doc.text('Amount', 470, y, { width: 75, align: 'right' });
  y += 18;
  doc.fontSize(10).font('Helvetica');

  // Build itemized lists from the stored breakup (falls back to simple values).
  let breakup = null;
  try { breakup = slip.breakup ? JSON.parse(slip.breakup) : null; } catch (e) { breakup = null; }
  const earnings = (breakup && breakup.earnings && breakup.earnings.length)
    ? breakup.earnings.map((e) => [e.name, e.amount])
    : [['Basic Salary (Gross)', slip.gross]];
  if (slip.reimbursements) earnings.push(['Reimbursements', slip.reimbursements]);
  const deductions = (breakup && breakup.deductions && breakup.deductions.length)
    ? breakup.deductions.map((d) => [d.name, d.amount])
    : (slip.deductions ? [['Loss of Pay', slip.deductions]] : []);

  const startY = y;
  const maxRows = Math.max(earnings.length, deductions.length);
  for (let i = 0; i < maxRows; i++) {
    if (earnings[i]) {
      doc.text(String(earnings[i][0]), 50, y, { width: 170 });
      doc.text(money(cur, earnings[i][1]), 230, y, { width: 90, align: 'right' });
    }
    if (deductions[i]) {
      doc.text(String(deductions[i][0]), 330, y, { width: 130 });
      doc.text(money(cur, deductions[i][1]), 470, y, { width: 75, align: 'right' });
    }
    y += 18;
  }

  // Column totals
  const totalEarnings = earnings.reduce((s, e) => s + (Number(e[1]) || 0), 0);
  const totalDeductions = deductions.reduce((s, d) => s + (Number(d[1]) || 0), 0);
  doc.font('Helvetica-Bold');
  doc.text('Total Earnings', 50, y, { width: 170 });
  doc.text(money(cur, totalEarnings), 230, y, { width: 90, align: 'right' });
  doc.text('Total Deductions', 330, y, { width: 130 });
  doc.text(money(cur, totalDeductions), 470, y, { width: 75, align: 'right' });
  doc.font('Helvetica');
  y += 24;

  doc.moveTo(50, y).lineTo(545, y).stroke('#cccccc');
  y += 12;
  doc.fontSize(12).font('Helvetica-Bold');
  doc.text('Net Salary', 50, y);
  doc.text(money(cur, slip.net_salary), 350, y, { width: 195, align: 'right' });

  y += 40;
  doc.fontSize(8).font('Helvetica').fillColor('#888')
    .text(
      settings.slipFooter || 'This is a computer-generated payslip and does not require a signature.',
      50,
      y,
      { align: 'center', width: 495 }
    );

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

module.exports = { buildPayslipPdf };
