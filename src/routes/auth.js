// ═══════════════════════════════════════════════════════════
// Authentication Routes
// Wallet-based authentication — Solana (ed25519) + EVM (ECDSA)
// ═══════════════════════════════════════════════════════════

const express  = require('express');
const router   = express.Router();
const jwt      = require('jsonwebtoken');
const pool     = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { PublicKey } = require('@solana/web3.js');
const nacl     = require('tweetnacl');   // ships with @solana/web3.js
const bs58     = require('bs58');        // ships with @solana/web3.js
const { ethers } = require('ethers');    // for EVM sig verification

// In-memory nonce store (use Redis in production)
const nonces = new Map();
const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// The exact message template wallets must sign
const AUTH_MESSAGE_TEMPLATE = (nonce) => `Sign in to WhiteFlag\n\nNonce: ${nonce}`;

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Detect chain from wallet address format.
 * Solana: base58, 32-44 chars (no 0x prefix)
 * EVM: hex, 42 chars with 0x prefix
 */
function detectChain(address) {
  if (!address) return null;
  if (address.startsWith('0x') && address.length === 42) return 'evm';
  if (address.length >= 32 && address.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(address)) return 'solana';
  return null;
}

/**
 * Validate a wallet address for the given chain.
 */
function validateAddress(address, chain) {
  if (chain === 'solana') {
    try { new PublicKey(address); return true; } catch (_) { return false; }
  }
  if (chain === 'evm') {
    return ethers.isAddress(address);
  }
  return false;
}

/**
 * Decode a Solana signature that may be:
 *   - raw Uint8Array / Buffer
 *   - base58 string (Phantom)
 *   - base64 string (some mobile wallets)
 *   - hex string
 */
function decodeSig(sig) {
  if (sig instanceof Uint8Array || Buffer.isBuffer(sig)) return new Uint8Array(sig);
  if (typeof sig === 'object' && sig.data) return new Uint8Array(sig.data);
  if (typeof sig !== 'string') return null;

  try { return bs58.decode(sig); } catch (_) {}
  try { const b = Buffer.from(sig, 'base64'); if (b.length === 64) return new Uint8Array(b); } catch (_) {}
  if (/^[0-9a-fA-F]{128}$/.test(sig)) return new Uint8Array(Buffer.from(sig, 'hex'));
  return null;
}

/**
 * Verify a Solana ed25519 signature.
 */
function verifySolanaSignature(walletAddress, nonce, sig) {
  try {
    const pubKey   = new PublicKey(walletAddress);
    const sigBytes = decodeSig(sig);
    if (!sigBytes || sigBytes.length !== 64) return false;
    const msg = new TextEncoder().encode(AUTH_MESSAGE_TEMPLATE(nonce));
    return nacl.sign.detached.verify(msg, sigBytes, pubKey.toBytes());
  } catch (e) {
    console.error('Ed25519 verify error:', e.message);
    return false;
  }
}

/**
 * Verify an EVM ECDSA signature (MetaMask-style personal_sign).
 * Recovers the signer address and compares to the claimed address.
 */
function verifyEvmSignature(walletAddress, nonce, signature) {
  try {
    const message  = AUTH_MESSAGE_TEMPLATE(nonce);
    const recovered = ethers.verifyMessage(message, signature);
    return recovered.toLowerCase() === walletAddress.toLowerCase();
  } catch (e) {
    console.error('EVM verify error:', e.message);
    return false;
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────

/**
 * GET /auth/nonce/:walletAddress
 * Issue a fresh nonce for the given wallet.
 * Query param: ?chain=solana|evm (auto-detected if omitted)
 */
router.get('/nonce/:walletAddress', async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const chain = req.query.chain || detectChain(walletAddress);

    if (!walletAddress || !chain) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    if (!validateAddress(walletAddress, chain)) {
      return res.status(400).json({ error: `Invalid ${chain} address` });
    }

    const nonce = uuidv4();
    nonces.set(walletAddress.toLowerCase(), { nonce, chain, expires: Date.now() + NONCE_TTL_MS });
    setTimeout(() => nonces.delete(walletAddress.toLowerCase()), NONCE_TTL_MS);

    res.json({
      nonce,
      chain,
      message: AUTH_MESSAGE_TEMPLATE(nonce)
    });
  } catch (err) {
    console.error('Nonce error:', err);
    res.status(500).json({ error: 'Failed to generate nonce' });
  }
});

/**
 * POST /auth/verify
 * Verify signature and issue JWT.
 *
 * Body: { walletAddress, signature, chain? }
 *
 * Returns:
 *   - token (JWT)
 *   - user object
 *   - isNewUser (true if this is a first-time login — frontend should prompt for profile setup)
 */
router.post('/verify', async (req, res) => {
  try {
    const { walletAddress, signature } = req.body;
    if (!walletAddress || !signature) {
      return res.status(400).json({ error: 'walletAddress and signature required' });
    }

    const lookupKey = walletAddress.toLowerCase();
    const stored = nonces.get(lookupKey);
    if (!stored) return res.status(400).json({ error: 'Nonce not found or expired — request a new one' });
    if (Date.now() > stored.expires) {
      nonces.delete(lookupKey);
      return res.status(400).json({ error: 'Nonce expired — request a new one' });
    }
    const { nonce, chain } = stored;

    // Verify signature based on chain
    let sigOk = false;
    if (chain === 'solana') {
      sigOk = verifySolanaSignature(walletAddress, nonce, signature);
    } else if (chain === 'evm') {
      sigOk = verifyEvmSignature(walletAddress, nonce, signature);
    }

    if (!sigOk) {
      return res.status(401).json({ error: 'Signature verification failed' });
    }

    nonces.delete(lookupKey); // consume nonce

    // ── Get or create user ────────────────────────────────────────
    let isNewUser = false;
    let user = await pool.query('SELECT * FROM users WHERE LOWER(wallet_address) = $1', [lookupKey]);

    if (user.rows.length === 0) {
      // New user — create with minimal data; frontend will prompt for profile setup
      isNewUser = true;
      const shortAddr = walletAddress.substring(0, 8);
      const result = await pool.query(
        `INSERT INTO users (wallet_address, username, chain, is_profile_complete)
         VALUES ($1, $2, $3, false) RETURNING *`,
        [walletAddress, `user_${shortAddr}`, chain]
      );
      user = result;
      await pool.query('INSERT INTO leaderboard_stats (user_id) VALUES ($1)', [result.rows[0].id]);
    }

    const u = user.rows[0];
    const token = jwt.sign(
      { userId: u.id, walletAddress: u.wallet_address, isVerified: u.is_verified },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      isNewUser,
      user: {
        id:                u.id,
        walletAddress:     u.wallet_address,
        username:          u.username,
        email:             u.email,
        chain:             u.chain,
        isVerified:        u.is_verified,
        isProfileComplete: u.is_profile_complete,
        bio:               u.bio,
        avatarUrl:         u.avatar_url,
        createdAt:         u.created_at
      }
    });
  } catch (err) {
    console.error('Auth verify error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

module.exports = router;
