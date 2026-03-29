// ═══════════════════════════════════════════════════════════
// Solana Verification Integration
// Smart contract interaction for $5 verification payment
// ═══════════════════════════════════════════════════════════

const { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');

// Solana configuration
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PLATFORM_WALLET = process.env.PLATFORM_WALLET_ADDRESS;
const VERIFICATION_PRICE_USD = parseFloat(process.env.VERIFICATION_FEE) || 5.00;
const PLATFORM_CUT_PERCENT = parseFloat(process.env.PLATFORM_CUT) * 100 || 50;

/**
 * Initialize Solana connection
 */
const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

/**
 * Get SOL price in USD
 * @returns {Promise<number>} - SOL price in USD
 */
async function getSolPrice() {
  try {
    // In production, use a price oracle or API
    // For now, using a mock price
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const data = await response.json();
    return data.solana.usd;
  } catch (error) {
    console.error('Error fetching SOL price:', error);
    // Fallback price if API fails
    return 100; // Default to $100/SOL
  }
}

/**
 * Calculate SOL amount for verification
 * @param {number} solPrice - Current SOL price in USD
 * @returns {number} - Amount in SOL
 */
function calculateSolAmount(solPrice) {
  return VERIFICATION_PRICE_USD / solPrice;
}

/**
 * Verify Solana transaction
 * @param {string} signature - Transaction signature
 * @param {string} userWallet - User's wallet address
 * @returns {Promise<Object>} - Verification result
 */
async function verifyTransaction(signature, userWallet) {
  try {
    // Fetch transaction details
    const transaction = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0
    });

    if (!transaction) {
      return { valid: false, error: 'Transaction not found' };
    }

    // Check transaction status
    if (transaction.meta.err) {
      return { valid: false, error: 'Transaction failed' };
    }

    // Verify sender
    const fromPubkey = transaction.transaction.message.accountKeys[0].toString();
    if (fromPubkey !== userWallet) {
      return { valid: false, error: 'Transaction not from user wallet' };
    }

    // Verify receiver (platform wallet)
    const toPubkey = transaction.transaction.message.accountKeys[1].toString();
    if (toPubkey !== PLATFORM_WALLET) {
      return { valid: false, error: 'Transaction not to platform wallet' };
    }

    // Get SOL price at time of transaction
    const solPrice = await getSolPrice();
    const expectedSol = calculateSolAmount(solPrice);
    const expectedLamports = expectedSol * LAMPORTS_PER_SOL;

    // Verify amount (with 5% tolerance for price fluctuation)
    const actualLamports = transaction.meta.postBalances[1] - transaction.meta.preBalances[1];
    const tolerance = expectedLamports * 0.05;

    if (Math.abs(actualLamports - expectedLamports) > tolerance) {
      return { 
        valid: false, 
        error: 'Incorrect payment amount',
        expected: expectedLamports,
        actual: actualLamports
      };
    }

    // Transaction is valid
    return {
      valid: true,
      amount: actualLamports / LAMPORTS_PER_SOL,
      amountUsd: VERIFICATION_PRICE_USD,
      platformAmount: (actualLamports * PLATFORM_CUT_PERCENT / 100) / LAMPORTS_PER_SOL,
      poolAmount: (actualLamports * (100 - PLATFORM_CUT_PERCENT) / 100) / LAMPORTS_PER_SOL,
      timestamp: transaction.blockTime,
      signature
    };

  } catch (error) {
    console.error('Transaction verification error:', error);
    return { valid: false, error: error.message };
  }
}

/**
 * Create verification payment transaction
 * @param {string} userWallet - User's wallet address
 * @returns {Promise<Object>} - Transaction details
 */
async function createVerificationTransaction(userWallet) {
  try {
    const fromPubkey = new PublicKey(userWallet);
    const toPubkey = new PublicKey(PLATFORM_WALLET);

    // Get current SOL price
    const solPrice = await getSolPrice();
    const solAmount = calculateSolAmount(solPrice);
    const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL);

    // Create transaction
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey,
        toPubkey,
        lamports
      })
    );

    // Get recent blockhash
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = fromPubkey;

    return {
      transaction: transaction.serialize({ requireAllSignatures: false }).toString('base64'),
      amount: solAmount,
      amountUsd: VERIFICATION_PRICE_USD,
      solPrice,
      platformWallet: PLATFORM_WALLET
    };

  } catch (error) {
    console.error('Create transaction error:', error);
    throw error;
  }
}

/**
 * Process referral bonus
 * @param {number} referrerId - Referrer's user ID
 * @param {number} referredId - Referred user's ID
 * @param {Object} pool - Database pool
 */
async function processReferralBonus(referrerId, referredId, pool) {
  try {
    // Check if referral already processed
    const existing = await pool.query(
      'SELECT * FROM referrals WHERE referred_id = $1',
      [referredId]
    );

    if (existing.rows.length > 0) {
      return { processed: false, reason: 'Referral already exists' };
    }

    // Create referral record
    await pool.query(
      `INSERT INTO referrals (referrer_id, referred_id, bonus_paid) 
       VALUES ($1, $2, true)`,
      [referrerId, referredId]
    );

    // In production: Send $1 in SOL to referrer
    // For now, just track it
    const REFERRAL_BONUS_USD = parseFloat(process.env.REFERRAL_BONUS) || 1.00;

    return {
      processed: true,
      bonusUsd: REFERRAL_BONUS_USD,
      referrerId,
      referredId
    };

  } catch (error) {
    console.error('Referral processing error:', error);
    return { processed: false, error: error.message };
  }
}

module.exports = {
  verifyTransaction,
  createVerificationTransaction,
  getSolPrice,
  calculateSolAmount,
  processReferralBonus,
  VERIFICATION_PRICE_USD,
  PLATFORM_CUT_PERCENT
};
