const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// GET /notifications — fetch notifications for current user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { limit = 30, offset = 0 } = req.query;

    const result = await pool.query(`
      SELECT n.*,
        actor.username AS actor_username,
        actor.is_verified AS actor_verified,
        p.content AS post_content,
        p.title AS post_title
      FROM notifications n
      JOIN users actor ON n.actor_id = actor.id
      LEFT JOIN posts p ON n.post_id = p.id
      WHERE n.user_id = $1
      ORDER BY n.created_at DESC
      LIMIT $2 OFFSET $3
    `, [userId, limit, offset]);

    res.json({ notifications: result.rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch notifications' }); }
});

// GET /notifications/unread-count
router.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const result = await pool.query(
      'SELECT COUNT(*)::int AS count FROM notifications WHERE user_id=$1 AND is_read=false',
      [userId]
    );
    res.json({ count: result.rows[0].count });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch count' }); }
});

// PUT /notifications/mark-all-read
router.put('/mark-all-read', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    await pool.query('UPDATE notifications SET is_read=true WHERE user_id=$1', [userId]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to mark read' }); }
});

// PUT /notifications/:id/read
router.put('/:id/read', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    await pool.query('UPDATE notifications SET is_read=true WHERE id=$1 AND user_id=$2', [id, userId]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to mark read' }); }
});

// DELETE /notifications — clear all
router.delete('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    await pool.query('DELETE FROM notifications WHERE user_id=$1', [userId]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to clear' }); }
});

module.exports = router;
