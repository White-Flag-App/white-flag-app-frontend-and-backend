// ═══════════════════════════════════════════════════════════
// Verification Routes
// User verification with Solana payment
// ═══════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const solana = require('../utils/solana');

/**
 * GET /verification/price
 * Get current verification price in SOL and USD
 */
router.get('/price', async (req, res) => {
  try {
    const solPrice = await solana.getSolPrice();
    const solAmount = solana.calculateSolAmount(solPrice);

    res.json({
      usd: solana.VERIFICATION_PRICE_USD,
      sol: solAmount,
      solPrice,
      platformCut: solana.PLATFORM_CUT_PERCENT,
      breakdown: {
        platform: solana.VERIFICATION_PRICE_USD * (solana.PLATFORM_CUT_PERCENT / 100),
        pool: solana.VERIFICATION_PRICE_USD * ((100 - solana.PLATFORM_CUT_PERCENT) / 100)
      }
    });
  } catch (error) {
    console.error('Get price error:', error);
    res.status(500).json({ error: 'Failed to fetch price' });
  }
});

/**
 * POST /verification/create-transaction
 * Create Solana verification payment transaction
 */
router.post('/create-transaction', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address required' });
    }

    // Check if already verified
    const user = await pool.query(
      'SELECT is_verified FROM users WHERE id = $1',
      [userId]
    );

    if (user.rows[0].is_verified) {
      return res.status(400).json({ error: 'Already verified' });
    }

    const txData = await solana.createVerificationTransaction(walletAddress);
    res.json({ ...txData, rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com' });
  } catch (error) {
    console.error('Create transaction error:', error);
    res.status(500).json({ error: 'Failed to create transaction' });
  }
});

/**
 * POST /verification/verify
 * Verify Solana payment and activate verification
 */
router.post('/verify', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { transactionSignature, walletAddress, referrerId } = req.body;

    if (!transactionSignature || !walletAddress) {
      return res.status(400).json({ error: 'Transaction signature and wallet required' });
    }

    // Check if already verified
    const user = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );

    if (user.rows[0].is_verified) {
      return res.status(400).json({ error: 'Already verified' });
    }

    // Verify transaction on Solana blockchain
    const verification = await solana.verifyTransaction(transactionSignature, walletAddress);

    if (!verification.valid) {
      return res.status(400).json({ 
        error: 'Transaction verification failed',
        details: verification.error 
      });
    }

    // Update user as verified
    const result = await pool.query(
      `UPDATE users 
       SET is_verified = true,
           verification_date = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [userId]
    );

    // Process referral bonus — use referrerId from request body or from user's referred_by field
    let referralResult = null;
    const effectiveReferrerId = referrerId || user.rows[0].referred_by;
    if (effectiveReferrerId) {
      referralResult = await solana.processReferralBonus(effectiveReferrerId, userId, pool);
    }

    res.json({
      success: true,
      user: result.rows[0],
      transaction: verification,
      referral: referralResult
    });

  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

/**
 * GET /verification/status
 * Check user's verification status
 */
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT 
        is_verified,
        verification_date,
        (SELECT COUNT(*) FROM referrals WHERE referrer_id = $1) as referral_count,
        (SELECT COUNT(*) FROM referrals WHERE referrer_id = $1 AND bonus_paid = true) as bonuses_earned,
        (SELECT COUNT(*) FROM referrals WHERE referrer_id = $1 AND bonus_paid = true) * ${parseFloat(process.env.REFERRAL_BONUS) || 1.00} as total_earned,
        (SELECT COUNT(*) FROM referrals WHERE referrer_id = $1 AND bonus_paid = true 
         AND created_at >= date_trunc('month', NOW())) as referrals_this_month,
        (SELECT COUNT(*) FROM referrals WHERE referrer_id = $1 AND bonus_paid = true 
         AND created_at >= date_trunc('month', NOW())) * ${parseFloat(process.env.REFERRAL_BONUS) || 1.00} as earned_this_month
      FROM users 
      WHERE id = $1`,
      [userId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

module.exports = router;
