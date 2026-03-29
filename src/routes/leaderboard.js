// ═══════════════════════════════════════════════════════════
// Leaderboard Routes
// Rankings and stats
// ═══════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { optionalAuth } = require('../middleware/auth');

/**
 * GET /leaderboard
 * Get top ranked users
 */
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { limit = 100 } = req.query;
    const currentUserId = req.user?.userId;

    const result = await pool.query(
      `SELECT 
        u.id,
        u.username,
        u.wallet_address,
        u.is_verified,
        ls.engagement_score,
        ls.posts_count,
        ls.comments_count,
        ls.upvotes_received,
        ROW_NUMBER() OVER (ORDER BY ls.engagement_score DESC) as rank
      FROM users u
      JOIN leaderboard_stats ls ON u.id = ls.user_id
      ORDER BY ls.engagement_score DESC
      LIMIT $1`,
      [limit]
    );

    // Get current user's rank if authenticated
    let currentUserRank = null;
    if (currentUserId) {
      const userRank = await pool.query(
        `SELECT 
          COUNT(*) + 1 as rank
        FROM leaderboard_stats ls1
        WHERE ls1.engagement_score > (
          SELECT engagement_score 
          FROM leaderboard_stats 
          WHERE user_id = $1
        )`,
        [currentUserId]
      );
      currentUserRank = userRank.rows[0]?.rank || null;
    }

    res.json({
      leaderboard: result.rows,
      currentUserRank,
      total: result.rows.length
    });
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

/**
 * GET /leaderboard/stats/:userId
 * Get specific user's stats
 */
router.get('/stats/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      `SELECT 
        u.username,
        u.is_verified,
        ls.*,
        (SELECT COUNT(*) + 1 
         FROM leaderboard_stats ls2 
         WHERE ls2.engagement_score > ls.engagement_score) as rank
      FROM leaderboard_stats ls
      JOIN users u ON ls.user_id = u.id
      WHERE ls.user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User stats not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
