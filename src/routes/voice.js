// ═══════════════════════════════════════════════════════════
// Voice Chat Routes
// Voice room management and participation
// ═══════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, optionalAuth } = require('../middleware/auth');

/**
 * GET /voice/rooms
 * Get all active voice rooms
 */
router.get('/rooms', optionalAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        v.*,
        u.username as host_username,
        u.is_verified as host_verified,
        COUNT(DISTINCT p.id) as participant_count,
        COUNT(DISTINCT s.id) as speaker_count
      FROM voice_rooms v
      JOIN users u ON v.host_id = u.id
      LEFT JOIN voice_participants p ON v.id = p.room_id AND p.is_active = true
      LEFT JOIN voice_participants s ON v.id = s.room_id AND s.is_speaker = true AND s.is_active = true
      WHERE v.is_active = true
      GROUP BY v.id, u.username, u.is_verified
      ORDER BY v.created_at DESC`,
      []
    );

    res.json({ rooms: result.rows });
  } catch (error) {
    console.error('Get voice rooms error:', error);
    res.status(500).json({ error: 'Failed to fetch voice rooms' });
  }
});

/**
 * GET /voice/rooms/:id
 * Get single voice room details
 */
router.get('/rooms/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;

    const room = await pool.query(
      `SELECT 
        v.*,
        u.username as host_username,
        u.is_verified as host_verified,
        u.wallet_address as host_wallet
        ${userId ? `, EXISTS(SELECT 1 FROM voice_participants WHERE room_id = v.id AND user_id = $2 AND is_active = true) as user_joined` : ''}
      FROM voice_rooms v
      JOIN users u ON v.host_id = u.id
      WHERE v.id = $1`,
      userId ? [id, userId] : [id]
    );

    if (room.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    res.json(room.rows[0]);
  } catch (error) {
    console.error('Get voice room error:', error);
    res.status(500).json({ error: 'Failed to fetch voice room' });
  }
});

/**
 * POST /voice/rooms
 * Create new voice room
 */
router.post('/rooms', authenticateToken, async (req, res) => {
  try {
    const { title, description, topic, maxSpeakers } = req.body;
    const userId = req.user.userId;

    if (!title || title.trim().length === 0) {
      return res.status(400).json({ error: 'Room title required' });
    }

    if (title.length > 100) {
      return res.status(400).json({ error: 'Title too long (max 100 chars)' });
    }

    const validTopics = ['trends', 'general', 'solana', 'meme coins', 'lore', 'utility', 'news'];
    if (topic && !validTopics.includes(topic.toLowerCase())) {
      return res.status(400).json({ error: 'Invalid topic' });
    }

    const maxSpeakersNum = parseInt(maxSpeakers) || 20;
    if (maxSpeakersNum < 1 || maxSpeakersNum > 50) {
      return res.status(400).json({ error: 'Max speakers must be between 1 and 50' });
    }

    const result = await pool.query(
      `INSERT INTO voice_rooms (host_id, title, description, topic, max_speakers) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING *`,
      [userId, title.trim(), description || null, topic || 'general', maxSpeakersNum]
    );

    // Add host as participant and speaker
    await pool.query(
      `INSERT INTO voice_participants (room_id, user_id, is_speaker, is_active) 
       VALUES ($1, $2, true, true)`,
      [result.rows[0].id, userId]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create voice room error:', error);
    res.status(500).json({ error: 'Failed to create voice room' });
  }
});

/**
 * POST /voice/rooms/:id/join
 * Join a voice room
 */
router.post('/rooms/:id/join', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // Check if room exists and is active
    const room = await pool.query(
      'SELECT * FROM voice_rooms WHERE id = $1 AND is_active = true',
      [id]
    );

    if (room.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found or inactive' });
    }

    // Check if already joined
    const existing = await pool.query(
      'SELECT * FROM voice_participants WHERE room_id = $1 AND user_id = $2',
      [id, userId]
    );

    if (existing.rows.length > 0) {
      // Reactivate if previously left
      await pool.query(
        'UPDATE voice_participants SET is_active = true WHERE room_id = $1 AND user_id = $2',
        [id, userId]
      );
    } else {
      // Add as new participant
      await pool.query(
        `INSERT INTO voice_participants (room_id, user_id, is_speaker, is_active) 
         VALUES ($1, $2, false, true)`,
        [id, userId]
      );
    }

    res.json({ message: 'Joined voice room successfully' });
  } catch (error) {
    console.error('Join voice room error:', error);
    res.status(500).json({ error: 'Failed to join voice room' });
  }
});

/**
 * POST /voice/rooms/:id/leave
 * Leave a voice room
 */
router.post('/rooms/:id/leave', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    await pool.query(
      'UPDATE voice_participants SET is_active = false WHERE room_id = $1 AND user_id = $2',
      [id, userId]
    );

    res.json({ message: 'Left voice room successfully' });
  } catch (error) {
    console.error('Leave voice room error:', error);
    res.status(500).json({ error: 'Failed to leave voice room' });
  }
});

/**
 * POST /voice/rooms/:id/request-speaker
 * Request to become a speaker
 */
router.post('/rooms/:id/request-speaker', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // Check if room exists
    const room = await pool.query(
      'SELECT * FROM voice_rooms WHERE id = $1 AND is_active = true',
      [id]
    );

    if (room.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found or inactive' });
    }

    // Check speaker limit
    const speakerCount = await pool.query(
      'SELECT COUNT(*) FROM voice_participants WHERE room_id = $1 AND is_speaker = true AND is_active = true',
      [id]
    );

    if (parseInt(speakerCount.rows[0].count) >= room.rows[0].max_speakers) {
      return res.status(400).json({ error: 'Speaker limit reached' });
    }

    // Update to speaker
    await pool.query(
      'UPDATE voice_participants SET is_speaker = true WHERE room_id = $1 AND user_id = $2',
      [id, userId]
    );

    res.json({ message: 'You are now a speaker' });
  } catch (error) {
    console.error('Request speaker error:', error);
    res.status(500).json({ error: 'Failed to become speaker' });
  }
});

/**
 * POST /voice/rooms/:id/remove-speaker/:userId
 * Remove speaker status (host only)
 */
router.post('/rooms/:id/remove-speaker/:targetUserId', authenticateToken, async (req, res) => {
  try {
    const { id, targetUserId } = req.params;
    const userId = req.user.userId;

    // Check if requester is host
    const room = await pool.query(
      'SELECT * FROM voice_rooms WHERE id = $1 AND host_id = $2',
      [id, userId]
    );

    if (room.rows.length === 0) {
      return res.status(403).json({ error: 'Only host can remove speakers' });
    }

    // Remove speaker status
    await pool.query(
      'UPDATE voice_participants SET is_speaker = false WHERE room_id = $1 AND user_id = $2',
      [id, targetUserId]
    );

    res.json({ message: 'Speaker removed successfully' });
  } catch (error) {
    console.error('Remove speaker error:', error);
    res.status(500).json({ error: 'Failed to remove speaker' });
  }
});

/**
 * GET /voice/rooms/:id/participants
 * Get room participants
 */
router.get('/rooms/:id/participants', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT 
        p.*,
        u.username,
        u.is_verified,
        u.avatar_url
      FROM voice_participants p
      JOIN users u ON p.user_id = u.id
      WHERE p.room_id = $1 AND p.is_active = true
      ORDER BY p.is_speaker DESC, p.joined_at ASC`,
      [id]
    );

    const speakers = result.rows.filter(p => p.is_speaker);
    const listeners = result.rows.filter(p => !p.is_speaker);

    res.json({ 
      participants: result.rows,
      speakers,
      listeners,
      total: result.rows.length,
      speakerCount: speakers.length,
      listenerCount: listeners.length
    });
  } catch (error) {
    console.error('Get voice participants error:', error);
    res.status(500).json({ error: 'Failed to fetch participants' });
  }
});

/**
 * DELETE /voice/rooms/:id
 * End voice room (host only)
 */
router.delete('/rooms/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // Check if user is host
    const room = await pool.query(
      'SELECT * FROM voice_rooms WHERE id = $1 AND host_id = $2',
      [id, userId]
    );

    if (room.rows.length === 0) {
      return res.status(403).json({ error: 'Only host can end room' });
    }

    // Deactivate room
    await pool.query(
      'UPDATE voice_rooms SET is_active = false WHERE id = $1',
      [id]
    );

    // Deactivate all participants
    await pool.query(
      'UPDATE voice_participants SET is_active = false WHERE room_id = $1',
      [id]
    );

    res.json({ message: 'Voice room ended successfully' });
  } catch (error) {
    console.error('End voice room error:', error);
    res.status(500).json({ error: 'Failed to end voice room' });
  }
});

module.exports = router;
