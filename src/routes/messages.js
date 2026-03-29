// ═══════════════════════════════════════════════════════════
// Messages Routes
// Direct messaging between users
// ═══════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

/**
 * GET /messages/conversations
 * Get user's conversation list
 */
router.get('/conversations', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT DISTINCT ON (conversation_id)
        c.*,
        m.content as last_message,
        m.created_at as last_message_at,
        m.user_id as last_sender_id,
        CASE 
          WHEN c.user1_id = $1 THEN u2.username
          ELSE u1.username
        END as other_user_name,
        CASE 
          WHEN c.user1_id = $1 THEN u2.id
          ELSE u1.id
        END as other_user_id,
        CASE 
          WHEN c.user1_id = $1 THEN u2.is_verified
          ELSE u1.is_verified
        END as other_user_verified,
        CASE 
          WHEN c.user1_id = $1 THEN u2.avatar_url
          ELSE u1.avatar_url
        END as other_user_avatar,
        (SELECT COUNT(*) FROM messages 
         WHERE conversation_id = c.id 
         AND user_id != $1 
         AND is_read = false) as unread_count
      FROM conversations c
      LEFT JOIN messages m ON c.id = m.conversation_id
      LEFT JOIN users u1 ON c.user1_id = u1.id
      LEFT JOIN users u2 ON c.user2_id = u2.id
      WHERE c.user1_id = $1 OR c.user2_id = $1
      ORDER BY conversation_id, m.created_at DESC`,
      [userId]
    );

    res.json({ conversations: result.rows });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

/**
 * GET /messages/conversation/:userId
 * Get or create conversation with a user
 */
router.get('/conversation/:otherUserId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { otherUserId } = req.params;

    if (parseInt(otherUserId) === userId) {
      return res.status(400).json({ error: 'Cannot message yourself' });
    }

    // Check if conversation exists
    let conversation = await pool.query(
      `SELECT * FROM conversations 
       WHERE (user1_id = $1 AND user2_id = $2) 
       OR (user1_id = $2 AND user2_id = $1)`,
      [userId, otherUserId]
    );

    // Create conversation if it doesn't exist
    if (conversation.rows.length === 0) {
      conversation = await pool.query(
        `INSERT INTO conversations (user1_id, user2_id) 
         VALUES ($1, $2) 
         RETURNING *`,
        [userId, otherUserId]
      );
    }

    const conversationId = conversation.rows[0].id;

    // Get messages
    const messages = await pool.query(
      `SELECT 
        m.*,
        u.username,
        u.avatar_url,
        u.is_verified
      FROM messages m
      JOIN users u ON m.user_id = u.id
      WHERE m.conversation_id = $1
      ORDER BY m.created_at ASC`,
      [conversationId]
    );

    // Mark messages as read
    await pool.query(
      `UPDATE messages 
       SET is_read = true 
       WHERE conversation_id = $1 
       AND user_id = $2 
       AND is_read = false`,
      [conversationId, otherUserId]
    );

    // Get other user info
    const otherUser = await pool.query(
      'SELECT id, username, avatar_url, is_verified FROM users WHERE id = $1',
      [otherUserId]
    );

    res.json({
      conversation: conversation.rows[0],
      messages: messages.rows,
      otherUser: otherUser.rows[0]
    });
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

/**
 * POST /messages/send
 * Send a message
 */
router.post('/send', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { recipientId, content } = req.body;

    if (!recipientId || !content) {
      return res.status(400).json({ error: 'Recipient and content required' });
    }

    if (content.trim().length === 0) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }

    if (content.length > 2000) {
      return res.status(400).json({ error: 'Message too long (max 2000 chars)' });
    }

    // Get or create conversation
    let conversation = await pool.query(
      `SELECT id FROM conversations 
       WHERE (user1_id = $1 AND user2_id = $2) 
       OR (user1_id = $2 AND user2_id = $1)`,
      [userId, recipientId]
    );

    if (conversation.rows.length === 0) {
      conversation = await pool.query(
        `INSERT INTO conversations (user1_id, user2_id) 
         VALUES ($1, $2) 
         RETURNING id`,
        [userId, recipientId]
      );
    }

    const conversationId = conversation.rows[0].id;

    // Insert message
    const result = await pool.query(
      `INSERT INTO messages (conversation_id, user_id, content) 
       VALUES ($1, $2, $3) 
       RETURNING *`,
      [conversationId, userId, content]
    );

    // Update conversation's last activity
    await pool.query(
      'UPDATE conversations SET updated_at = NOW() WHERE id = $1',
      [conversationId]
    );

    res.status(201).json({
      message: result.rows[0],
      conversationId
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

/**
 * PUT /messages/:messageId/read
 * Mark message as read
 */
router.put('/:messageId/read', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.userId;

    // Get message to verify it's not from current user
    const message = await pool.query(
      'SELECT * FROM messages WHERE id = $1',
      [messageId]
    );

    if (message.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (message.rows[0].user_id === userId) {
      return res.status(400).json({ error: 'Cannot mark own message as read' });
    }

    // Mark as read
    await pool.query(
      'UPDATE messages SET is_read = true WHERE id = $1',
      [messageId]
    );

    res.json({ message: 'Message marked as read' });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Failed to mark message as read' });
  }
});

/**
 * GET /messages/unread-count
 * Get count of unread messages
 */
router.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT COUNT(*) as count
       FROM messages m
       JOIN conversations c ON m.conversation_id = c.id
       WHERE (c.user1_id = $1 OR c.user2_id = $1)
       AND m.user_id != $1
       AND m.is_read = false`,
      [userId]
    );

    res.json({ unreadCount: parseInt(result.rows[0].count) });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

/**
 * DELETE /messages/:messageId
 * Delete a message (only sender can delete)
 */
router.delete('/:messageId', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.userId;

    // Check if user owns the message
    const message = await pool.query(
      'SELECT * FROM messages WHERE id = $1 AND user_id = $2',
      [messageId, userId]
    );

    if (message.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found or unauthorized' });
    }

    // Delete message
    await pool.query('DELETE FROM messages WHERE id = $1', [messageId]);

    res.json({ message: 'Message deleted' });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

module.exports = router;
