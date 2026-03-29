// ═══════════════════════════════════════════════════════════
// Verification Middleware
// Restrict certain actions to verified users only
// ═══════════════════════════════════════════════════════════

const pool = require('../config/database');

/**
 * Require verified user for action
 * Must be used after authenticateToken middleware
 */
const requireVerified = async (req, res, next) => {
  try {
    const userId = req.user.userId;

    // Check verification status
    const result = await pool.query(
      'SELECT is_verified FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!result.rows[0].is_verified) {
      const fee = parseFloat(process.env.VERIFICATION_FEE) || 5.00;
      return res.status(403).json({ 
        error: 'Verification required',
        message: `You must be verified to create posts. Please verify your account for $${fee.toFixed(2)}.`,
        verificationRequired: true
      });
    }

    next();
  } catch (error) {
    console.error('Verification check error:', error);
    res.status(500).json({ error: 'Failed to verify user status' });
  }
};

/**
 * Optional verification check (doesn't block, just adds flag)
 */
const checkVerified = async (req, res, next) => {
  try {
    const userId = req.user?.userId;

    if (userId) {
      const result = await pool.query(
        'SELECT is_verified FROM users WHERE id = $1',
        [userId]
      );

      req.isVerified = result.rows[0]?.is_verified || false;
    } else {
      req.isVerified = false;
    }

    next();
  } catch (error) {
    console.error('Verification check error:', error);
    req.isVerified = false;
    next();
  }
};

module.exports = { requireVerified, checkVerified };
