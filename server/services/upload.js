const multer = require('multer');
const path = require('path');
const config = require('../config');

// MIME types allowed for logo/branding uploads
const allowedMimes = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

// File extensions allowed (whitelist)
const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

// Documents people actually attach for onboarding: PDFs, photos (incl. iPhone
// HEIC), and Office files. We whitelist by FILE EXTENSION because browsers
// report unreliable MIME types for HEIC/Office files (often
// "application/octet-stream"), which was silently blocking valid uploads.
const allowedDocExtensions = [
  '.pdf',
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif',
  '.doc', '.docx', '.xls', '.xlsx',
  '.txt',
];

// In-memory storage: files are kept in req.file.buffer and persisted to
// Postgres (services/filestore) by each route, so nothing touches the disk.
const storage = multer.memoryStorage();

// Validate file type and extension for logo uploads
const logoFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();

  // Check MIME type
  if (!allowedMimes.includes(file.mimetype)) {
    return cb(new Error(`Invalid file type. Only images are allowed.`), false);
  }

  // Check file extension
  if (!allowedExtensions.includes(ext)) {
    return cb(new Error(`Invalid file extension. Only ${allowedExtensions.join(', ')} are allowed.`), false);
  }

  cb(null, true);
};

// Validate document uploads by extension whitelist. The whitelist already
// excludes executable/markup types (.exe/.html/.svg/.js …), so only safe
// document formats get through — while accepting HEIC photos and Office files.
const documentFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowedDocExtensions.includes(ext)) {
    return cb(new Error(`"${ext || 'This file'}" isn't a supported type. Please upload a PDF, an image (JPG, PNG, HEIC, WebP), or a Word/Excel file.`), false);
  }
  cb(null, true);
};

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: logoFileFilter,
});

// For document uploads (PDF/image/Office, up to 15 MB for high-res scans).
const documentUpload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: documentFileFilter,
});

// For Excel import we keep the file in memory (parsed, never stored).
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExcel = ['.xlsx', '.xls', '.csv'];
    if (!allowedExcel.includes(ext)) {
      return cb(new Error('Only Excel (.xlsx, .xls) and CSV files are allowed'), false);
    }
    cb(null, true);
  },
});

module.exports = { upload, documentUpload, memoryUpload };
