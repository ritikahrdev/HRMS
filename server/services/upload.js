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

// MIME types allowed for document uploads (PDF, images, documents)
const allowedDocMimes = [
  'image/jpeg',
  'image/png',
  'application/pdf',
  'text/plain',
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

// Validate file type for document uploads
const documentFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();

  // Check MIME type
  if (!allowedDocMimes.includes(file.mimetype)) {
    return cb(new Error(`Invalid file type. Only PDF and images are allowed.`), false);
  }

  // Block dangerous extensions even if MIME type matches
  const dangerousExtensions = ['.exe', '.sh', '.bat', '.cmd', '.com', '.pif', '.zip', '.rar', '.7z'];
  if (dangerousExtensions.includes(ext)) {
    return cb(new Error(`File type not allowed.`), false);
  }

  cb(null, true);
};

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: logoFileFilter,
});

// For document uploads (more restrictive)
const documentUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
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
