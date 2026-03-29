// ═══════════════════════════════════════════════════════════
// Bookmarks Routes
// Save and manage bookmarked posts
// ═══════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// Helper: attach images array to posts
async function attachImages(posts) {
  if (!posts.length) return posts;
  const ids = posts.map(p => p.id);
  const result = await pool.query(
    `SELECT post_id, image_url, display_order FROM post_images
     WHERE post_id = ANY($1) ORDER BY display_order`,
    [ids]
  );
  const imageMap = {};
  result.rows.forEach(r => {
    if (!imageMap[r.post_id]) imageMap[r.post_id] = [];
    imageMap[r.post_id].push(r.image_url);
  });
  return posts.map(p => ({ ...p, images: imageMap[p.id] || [] }));
}

/**
 * GET /bookmarks
 * Get user's bookmarked posts
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { limit = 50, offset = 0 } = req.query;

    const result = await pool.query(
      `SELECT 
        p.*,
        u.username,
        u.wallet_address,
        u.is_verified,
        u.avatar_url,
        b.created_at as bookmarked_at,
        COUNT(DISTINCT c.id)::int as comment_count,
        COUNT(DISTINCT up.id)::int as upvote_count,
        BOOL_OR(my_up.id IS NOT NULL) as user_upvoted,
        TRUE as user_bookmarked
      FROM bookmarks b
      JOIN posts p ON b.post_id = p.id
      JOIN users u ON p.user_id = u.id
      LEFT JOIN comments c ON p.id = c.post_id
      LEFT JOIN upvotes up ON p.id = up.post_id
      LEFT JOIN upvotes my_up ON p.id = my_up.post_id AND my_up.user_id = $1
      WHERE b.user_id = $1
      GROUP BY p.id, u.id, b.created_at
      ORDER BY b.created_at DESC
      LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const postsWithImages = await attachImages(result.rows);

    res.json({
      bookmarks: postsWithImages,
      total: postsWithImages.length
    });
  } catch (error) {
    console.error('Get bookmarks error:', error);
    res.status(500).json({ error: 'Failed to fetch bookmarks' });
  }
});

/**
 * POST /bookmarks
 * Add post to bookmarks
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { postId } = req.body;
    const userId = req.user.userId;

    if (!postId) {
      return res.status(400).json({ error: 'Post ID required' });
    }

    // Check if post exists
    const post = await pool.query('SELECT id FROM posts WHERE id = $1', [postId]);
    if (post.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Check if already bookmarked
    const existing = await pool.query(
      'SELECT id FROM bookmarks WHERE post_id = $1 AND user_id = $2',
      [postId, userId]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Post already bookmarked' });
    }

    // Add bookmark
    await pool.query(
      'INSERT INTO bookmarks (post_id, user_id) VALUES ($1, $2)',
      [postId, userId]
    );

    res.status(201).json({ 
      message: 'Post bookmarked successfully',
      bookmarked: true 
    });
  } catch (error) {
    console.error('Add bookmark error:', error);
    res.status(500).json({ error: 'Failed to add bookmark' });
  }
});

/**
 * DELETE /bookmarks/:postId
 * Remove post from bookmarks
 */
router.delete('/:postId', authenticateToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.userId;

    const result = await pool.query(
      'DELETE FROM bookmarks WHERE post_id = $1 AND user_id = $2 RETURNING *',
      [postId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bookmark not found' });
    }

    res.json({ 
      message: 'Bookmark removed successfully',
      bookmarked: false 
    });
  } catch (error) {
    console.error('Remove bookmark error:', error);
    res.status(500).json({ error: 'Failed to remove bookmark' });
  }
});

/**
 * GET /bookmarks/check/:postId
 * Check if post is bookmarked by user
 */
router.get('/check/:postId', authenticateToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.userId;

    const result = await pool.query(
      'SELECT id FROM bookmarks WHERE post_id = $1 AND user_id = $2',
      [postId, userId]
    );

    res.json({ bookmarked: result.rows.length > 0 });
  } catch (error) {
    console.error('Check bookmark error:', error);
    res.status(500).json({ error: 'Failed to check bookmark' });
  }
});

module.exports = router;
