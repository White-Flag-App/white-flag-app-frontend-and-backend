// ═══════════════════════════════════════════════════════════
// Chat Room Routes
// Public chat rooms for community discussion
// ═══════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, optionalAuth } = require('../middleware/auth');

/**
 * GET /chat/rooms
 * Get all active chat rooms
 */
router.get('/rooms', optionalAuth, async (req, res) => {
  try {
    const { topic } = req.query;
    const validTopics = ['trends', 'general', 'solana', 'meme coins', 'lore', 'utility', 'news'];

    let whereClause = 'WHERE r.is_active = true';
    const params = [];

    if (topic && validTopics.includes(topic.toLowerCase())) {
      params.push(topic.toLowerCase());
      whereClause += ` AND LOWER(r.topic) = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT 
        r.*,
        u.username as creator_username,
        u.is_verified as creator_verified,
        COUNT(DISTINCT m.id) as message_count,
        COUNT(DISTINCT p.id) as participant_count,
        (SELECT content FROM chat_messages 
         WHERE room_id = r.id 
         ORDER BY created_at DESC 
         LIMIT 1) as last_message,
        (SELECT created_at FROM chat_messages 
         WHERE room_id = r.id 
         ORDER BY created_at DESC 
         LIMIT 1) as last_message_at
      FROM chat_rooms r
      JOIN users u ON r.creator_id = u.id
      LEFT JOIN chat_messages m ON r.id = m.room_id
      LEFT JOIN chat_participants p ON r.id = p.room_id
      ${whereClause}
      GROUP BY r.id, u.username, u.is_verified
      ORDER BY r.created_at DESC`,
      params
    );

    res.json({ rooms: result.rows });
  } catch (error) {
    console.error('Get rooms error:', error);
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

/**
 * GET /chat/rooms/:id
 * Get single chat room details
 */
router.get('/rooms/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const room = await pool.query(
      `SELECT 
        r.*,
        u.username as creator_username,
        u.is_verified as creator_verified
      FROM chat_rooms r
      JOIN users u ON r.creator_id = u.id
      WHERE r.id = $1`,
      [id]
    );

    if (room.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    res.json(room.rows[0]);
  } catch (error) {
    console.error('Get room error:', error);
    res.status(500).json({ error: 'Failed to fetch room' });
  }
});

/**
 * POST /chat/rooms
 * Create new chat room
 */
router.post('/rooms', authenticateToken, async (req, res) => {
  try {
    const { name, description, topic } = req.body;
    const userId = req.user.userId;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Room name required' });
    }

    if (name.length > 100) {
      return res.status(400).json({ error: 'Room name too long (max 100 chars)' });
    }

    const validTopics = ['trends', 'general', 'solana', 'meme coins', 'lore', 'utility', 'news'];
    if (topic && !validTopics.includes(topic.toLowerCase())) {
      return res.status(400).json({ error: 'Invalid topic' });
    }

    const result = await pool.query(
      `INSERT INTO chat_rooms (creator_id, name, description, topic) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [userId, name.trim(), description || null, topic || 'general']
    );

    // Add creator as participant
    await pool.query(
      'INSERT INTO chat_participants (room_id, user_id) VALUES ($1, $2)',
      [result.rows[0].id, userId]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create room error:', error);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

/**
 * GET /chat/rooms/:id/messages
 * Get messages from a chat room
 * Query params: limit, offset, after (ISO timestamp for polling new messages)
 */
router.get('/rooms/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 100, offset = 0, after } = req.query;

    let query;
    let params;

    if (after) {
      // Polling mode: only get messages newer than the given timestamp
      query = `SELECT 
        m.*,
        u.username,
        u.wallet_address,
        u.is_verified,
        u.avatar_url
      FROM chat_messages m
      JOIN users u ON m.user_id = u.id
      WHERE m.room_id = $1 AND m.created_at > $2
      ORDER BY m.created_at ASC`;
      params = [id, after];
    } else {
      query = `SELECT 
        m.*,
        u.username,
        u.wallet_address,
        u.is_verified,
        u.avatar_url
      FROM chat_messages m
      JOIN users u ON m.user_id = u.id
      WHERE m.room_id = $1
      ORDER BY m.created_at DESC
      LIMIT $2 OFFSET $3`;
      params = [id, limit, offset];
    }

    const result = await pool.query(query, params);

    // Reverse to get chronological order (only when not using 'after' mode)
    const messages = after ? result.rows : result.rows.reverse();

    res.json({ 
      messages,
      total: messages.length 
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

/**
 * POST /chat/rooms/:id/messages
 * Send message to chat room
 */
router.post('/rooms/:id/messages', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const userId = req.user.userId;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Message content required' });
    }

    if (content.length > 1000) {
      return res.status(400).json({ error: 'Message too long (max 1000 chars)' });
    }

    // Check if room exists
    const room = await pool.query(
      'SELECT * FROM chat_rooms WHERE id = $1 AND is_active = true',
      [id]
    );

    if (room.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found or inactive' });
    }

    // Add user as participant if not already
    await pool.query(
      `INSERT INTO chat_participants (room_id, user_id) 
       VALUES ($1, $2) 
       ON CONFLICT (room_id, user_id) DO NOTHING`,
      [id, userId]
    );

    // Insert message
    const result = await pool.query(
      `INSERT INTO chat_messages (room_id, user_id, content) 
       VALUES ($1, $2, $3) 
       RETURNING *`,
      [id, userId, content.trim()]
    );

    // Get user info
    const user = await pool.query(
      'SELECT username, is_verified, avatar_url FROM users WHERE id = $1',
      [userId]
    );

    const message = {
      ...result.rows[0],
      username: user.rows[0].username,
      is_verified: user.rows[0].is_verified,
      avatar_url: user.rows[0].avatar_url
    };

    res.status(201).json(message);
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

/**
 * POST /chat/rooms/:id/join
 * Join a chat room
 */
router.post('/rooms/:id/join', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // Check if room exists
    const room = await pool.query(
      'SELECT * FROM chat_rooms WHERE id = $1 AND is_active = true',
      [id]
    );

    if (room.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found or inactive' });
    }

    // Add as participant
    await pool.query(
      `INSERT INTO chat_participants (room_id, user_id) 
       VALUES ($1, $2) 
       ON CONFLICT (room_id, user_id) DO UPDATE SET joined_at = NOW()`,
      [id, userId]
    );

    res.json({ message: 'Joined room successfully' });
  } catch (error) {
    console.error('Join room error:', error);
    res.status(500).json({ error: 'Failed to join room' });
  }
});

/**
 * POST /chat/rooms/:id/leave
 * Leave a chat room
 */
router.post('/rooms/:id/leave', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    await pool.query(
      'DELETE FROM chat_participants WHERE room_id = $1 AND user_id = $2',
      [id, userId]
    );

    res.json({ message: 'Left room successfully' });
  } catch (error) {
    console.error('Leave room error:', error);
    res.status(500).json({ error: 'Failed to leave room' });
  }
});

/**
 * GET /chat/rooms/:id/participants
 * Get room participants
 */
router.get('/rooms/:id/participants', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT 
        u.id,
        u.username,
        u.is_verified,
        u.avatar_url,
        p.joined_at
      FROM chat_participants p
      JOIN users u ON p.user_id = u.id
      WHERE p.room_id = $1
      ORDER BY p.joined_at DESC`,
      [id]
    );

    res.json({ 
      participants: result.rows,
      count: result.rows.length 
    });
  } catch (error) {
    console.error('Get participants error:', error);
    res.status(500).json({ error: 'Failed to fetch participants' });
  }
});

/**
 * DELETE /chat/rooms/:id
 * Delete/close a chat room (creator only)
 */
router.delete('/rooms/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // Check if user is creator
    const room = await pool.query(
      'SELECT * FROM chat_rooms WHERE id = $1 AND creator_id = $2',
      [id, userId]
    );

    if (room.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found or unauthorized' });
    }

    // Deactivate room instead of deleting
    await pool.query(
      'UPDATE chat_rooms SET is_active = false WHERE id = $1',
      [id]
    );

    res.json({ message: 'Room closed successfully' });
  } catch (error) {
    console.error('Delete room error:', error);
    res.status(500).json({ error: 'Failed to delete room' });
  }
});

module.exports = router;
