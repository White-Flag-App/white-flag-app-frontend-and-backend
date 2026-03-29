// ═══════════════════════════════════════════════════════════
// File Upload Middleware
// Multer configuration for image uploads with validation
// Uses memory storage for Cloudinary uploads
// ═══════════════════════════════════════════════════════════

const multer = require('multer');

// Allowed MIME types
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_FILES = 4;

// Memory storage — keeps file buffers in memory for Cloudinary upload
const storage = multer.memoryStorage();

// File filter — validate type
const fileFilter = (req, file, cb) => {
  if (ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES
  }
});

module.exports = { upload, MAX_FILES, MAX_FILE_SIZE, ALLOWED_TYPES };
