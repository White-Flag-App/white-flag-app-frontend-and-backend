// ═══════════════════════════════════════════════════════════
// Cloudinary Configuration
// Cloud-based media storage for post images
// ═══════════════════════════════════════════════════════════

const { v2: cloudinary } = require('cloudinary');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

/**
 * Upload a file buffer to Cloudinary
 * @param {Buffer} buffer - File buffer
 * @param {object} options - Upload options
 * @returns {Promise<object>} Cloudinary upload result
 */
function uploadToCloudinary(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const uploadOptions = {
      folder: 'whiteflag/posts',
      resource_type: 'image',
      ...options
    };

    const stream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });

    stream.end(buffer);
  });
}

/**
 * Delete a file from Cloudinary by public_id
 * @param {string} publicId - Cloudinary public ID
 * @returns {Promise<object>} Deletion result
 */
function deleteFromCloudinary(publicId) {
  return cloudinary.uploader.destroy(publicId);
}

module.exports = { cloudinary, uploadToCloudinary, deleteFromCloudinary };
