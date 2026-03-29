const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, optionalAuth } = require('../middleware/auth');

// ── Helper: format user row into consistent API response ──────────
function formatUser(u, extras = {}) {
  return {
    id:                u.id,
    walletAddress:     u.wallet_address,
    username:          u.username,
    displayName:       u.display_name || null,
    email:             u.email || null,
    chain:             u.chain,
    isVerified:        u.is_verified,
    isProfileComplete: u.is_profile_complete,
    bio:               u.bio || null,
    avatarUrl:         u.avatar_url || null,
    location:          u.location || null,
    website:           u.website || null,
    createdAt:         u.created_at,
    updatedAt:         u.updated_at,
    followersCount:    parseInt(u.followers_count) || 0,
    followingCount:    parseInt(u.following_count) || 0,
    postsCount:        parseInt(u.posts_count) || 0,
    commentsCount:     parseInt(u.comments_count) || 0,
    upvotesReceived:   parseInt(u.upvotes_received) || 0,
    engagementScore:   parseInt(u.engagement_score) || 0,
    ...extras
  };
}

// ── User stats subquery (reusable) ────────────────────────────────
const USER_STATS_QUERY = `
  SELECT u.*,
         COALESCE(ls.engagement_score, 0) AS engagement_score,
         COALESCE(ls.posts_count, 0) AS posts_count,
         COALESCE(ls.comments_count, 0) AS comments_count,
         COALESCE(ls.upvotes_received, 0) AS upvotes_received,
         COUNT(DISTINCT f1.id)::int AS followers_count,
         COUNT(DISTINCT f2.id)::int AS following_count
  FROM users u
  LEFT JOIN leaderboard_stats ls ON u.id = ls.user_id
  LEFT JOIN follows f1 ON u.id = f1.following_id
  LEFT JOIN follows f2 ON u.id = f2.follower_id
`;
const USER_STATS_GROUP = `
  GROUP BY u.id, ls.engagement_score, ls.posts_count, ls.comments_count, ls.upvotes_received
`;

// ══════════════════════════════════════════════════════════════
// ROUTES — static paths MUST come before /:id
// ══════════════════════════════════════════════════════════════

// PUT /users/profile  — update current user's profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { username, displayName, bio, avatarUrl, email, location, website } = req.body;

    // ── Validation ──
    if (username !== undefined && username !== null) {
      if (username.length < 3 || username.length > 50)
        return res.status(400).json({ error: 'Username must be 3-50 characters' });
      if (!/^[a-zA-Z0-9_]+$/.test(username))
        return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores' });
      const exists = await pool.query('SELECT id FROM users WHERE LOWER(username)=LOWER($1) AND id!=$2', [username, userId]);
      if (exists.rows.length) return res.status(400).json({ error: 'Username already taken' });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'Invalid email format' });
    if (displayName && displayName.length > 100)
      return res.status(400).json({ error: 'Display name must be under 100 characters' });
    if (location && location.length > 100)
      return res.status(400).json({ error: 'Location must be under 100 characters' });
    if (website && website.length > 255)
      return res.status(400).json({ error: 'Website URL must be under 255 characters' });

    const result = await pool.query(
      `UPDATE users SET
         username      = COALESCE($1, username),
         display_name  = COALESCE($2, display_name),
         bio           = COALESCE($3, bio),
         avatar_url    = COALESCE($4, avatar_url),
         email         = COALESCE($5, email),
         location      = COALESCE($6, location),
         website       = COALESCE($7, website),
         is_profile_complete = true,
         updated_at    = NOW()
       WHERE id = $8 RETURNING *`,
      [
        username || null, displayName || null, bio || null,
        avatarUrl || null, email || null, location || null,
        website || null, userId
      ]
    );

    // Fetch full stats
    const full = await pool.query(
      USER_STATS_QUERY + ` WHERE u.id = $1 ` + USER_STATS_GROUP,
      [userId]
    );
    res.json(formatUser(full.rows[0]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to update profile' }); }
});

// POST /users/verify  — mark current user as verified
router.post('/verify', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    await pool.query(
      `UPDATE users SET is_verified=true, verification_date=NOW(), updated_at=NOW() WHERE id=$1`,
      [userId]
    );
    const result = await pool.query(
      USER_STATS_QUERY + ` WHERE u.id = $1 ` + USER_STATS_GROUP,
      [userId]
    );
    res.json({ message: 'Verification successful', user: formatUser(result.rows[0]) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Verification failed' }); }
});

// GET /users/search?q=term  — search users by username
router.get('/search', optionalAuth, async (req, res) => {
  try {
    const { q = '', limit = 10 } = req.query;
    if (!q.trim()) return res.json({ users: [] });
    const result = await pool.query(
      `SELECT u.id, u.username, u.display_name, u.is_verified, u.avatar_url, u.bio,
              COUNT(DISTINCT f.id)::int AS followers_count,
              COALESCE(ls.posts_count, 0) AS posts_count
       FROM users u
       LEFT JOIN follows f ON u.id = f.following_id
       LEFT JOIN leaderboard_stats ls ON u.id = ls.user_id
       WHERE u.username ILIKE $1
       GROUP BY u.id, ls.posts_count
       ORDER BY followers_count DESC
       LIMIT $2`,
      ['%' + q.trim() + '%', limit]
    );
    res.json({ users: result.rows });
  } catch (e) {
    console.error('User search error:', e);
    res.status(500).json({ error: 'Search failed' });
  }
});

// GET /users/me  — current user's full profile
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const result = await pool.query(
      USER_STATS_QUERY + ` WHERE u.id = $1 ` + USER_STATS_GROUP,
      [userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(formatUser(result.rows[0]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch profile' }); }
});

// GET /users/by-username/:username  — lookup user by username
router.get('/by-username/:username', optionalAuth, async (req, res) => {
  try {
    const { username } = req.params;
    const currentUserId = req.user?.userId;
    const result = await pool.query(
      USER_STATS_QUERY + ` WHERE LOWER(u.username) = LOWER($1) ` + USER_STATS_GROUP,
      [username]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    const row = result.rows[0];
    let isFollowing = false;
    if (currentUserId && currentUserId !== row.id) {
      const fol = await pool.query(
        'SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=$2',
        [currentUserId, row.id]
      );
      isFollowing = fol.rows.length > 0;
    }
    const isOwnProfile = currentUserId === row.id;
    res.json(formatUser(row, { isFollowing, isOwnProfile }));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch user' }); }
});

// GET /users/:id  — get any user's profile by ID
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user?.userId;
    const result = await pool.query(
      USER_STATS_QUERY + ` WHERE u.id = $1 ` + USER_STATS_GROUP,
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    const row = result.rows[0];
    let isFollowing = false;
    if (currentUserId && currentUserId !== row.id) {
      const fol = await pool.query(
        'SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=$2',
        [currentUserId, row.id]
      );
      isFollowing = fol.rows.length > 0;
    }
    const isOwnProfile = currentUserId === row.id;
    res.json(formatUser(row, { isFollowing, isOwnProfile }));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch user' }); }
});

// POST /users/:id/follow  — toggle follow / unfollow
router.post('/:id/follow', authenticateToken, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    const userId = req.user.userId;
    if (targetId === userId) return res.status(400).json({ error: 'Cannot follow yourself' });

    // Check target exists
    const target = await pool.query('SELECT id FROM users WHERE id=$1', [targetId]);
    if (!target.rows.length) return res.status(404).json({ error: 'User not found' });

    const existing = await pool.query(
      'SELECT id FROM follows WHERE follower_id=$1 AND following_id=$2',
      [userId, targetId]
    );

    if (existing.rows.length) {
      await pool.query('DELETE FROM follows WHERE follower_id=$1 AND following_id=$2', [userId, targetId]);
      // Get updated counts
      const fc = await pool.query('SELECT COUNT(*)::int AS c FROM follows WHERE following_id=$1', [targetId]);
      return res.json({ following: false, followersCount: fc.rows[0].c });
    }

    await pool.query('INSERT INTO follows (follower_id, following_id) VALUES ($1,$2)', [userId, targetId]);
    // Notify the followed user
    await pool.query(
      `INSERT INTO notifications (user_id, actor_id, type) VALUES ($1,$2,'follow')`,
      [targetId, userId]
    );
    const fc = await pool.query('SELECT COUNT(*)::int AS c FROM follows WHERE following_id=$1', [targetId]);
    res.json({ following: true, followersCount: fc.rows[0].c });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to follow/unfollow' }); }
});

// GET /users/:id/posts
router.get('/:id/posts', async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 20, offset = 0 } = req.query;
    const result = await pool.query(`
      SELECT p.*, u.username, u.display_name, u.is_verified, u.avatar_url,
             COUNT(DISTINCT c.id)::int  AS comment_count,
             COUNT(DISTINCT up.id)::int AS upvote_count
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN comments c  ON p.id = c.post_id
      LEFT JOIN upvotes  up ON p.id = up.post_id
      WHERE p.user_id = $1
      GROUP BY p.id, u.username, u.display_name, u.is_verified, u.avatar_url
      ORDER BY p.created_at DESC
      LIMIT $2 OFFSET $3
    `, [id, limit, offset]);

    // Attach images
    const posts = result.rows;
    if (posts.length) {
      const ids = posts.map(p => p.id);
      const imgs = await pool.query(
        `SELECT post_id, image_url, display_order FROM post_images WHERE post_id = ANY($1) ORDER BY display_order`,
        [ids]
      );
      const imageMap = {};
      imgs.rows.forEach(r => {
        if (!imageMap[r.post_id]) imageMap[r.post_id] = [];
        imageMap[r.post_id].push(r.image_url);
      });
      posts.forEach(p => { p.images = imageMap[p.id] || []; });
    }

    res.json({ posts });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch posts' }); }
});

// GET /users/:id/followers  — list of users who follow this user
router.get('/:id/followers', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user?.userId;
    const result = await pool.query(`
      SELECT u.id, u.username, u.display_name, u.is_verified, u.avatar_url, u.bio,
             COUNT(DISTINCT f2.id)::int AS followers_count
             ${currentUserId ? `,EXISTS(SELECT 1 FROM follows WHERE follower_id=${parseInt(currentUserId)} AND following_id=u.id) AS is_following` : ''}
      FROM follows f
      JOIN users u ON f.follower_id = u.id
      LEFT JOIN follows f2 ON u.id = f2.following_id
      WHERE f.following_id = $1
      GROUP BY u.id
      ORDER BY MAX(f.created_at) DESC
    `, [id]);
    res.json({ followers: result.rows, count: result.rows.length });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch followers' }); }
});

// GET /users/:id/following  — list of users this user follows
router.get('/:id/following', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user?.userId;
    const result = await pool.query(`
      SELECT u.id, u.username, u.display_name, u.is_verified, u.avatar_url, u.bio,
             COUNT(DISTINCT f2.id)::int AS followers_count
             ${currentUserId ? `,EXISTS(SELECT 1 FROM follows WHERE follower_id=${parseInt(currentUserId)} AND following_id=u.id) AS is_following` : ''}
      FROM follows f
      JOIN users u ON f.following_id = u.id
      LEFT JOIN follows f2 ON u.id = f2.following_id
      WHERE f.follower_id = $1
      GROUP BY u.id
      ORDER BY MAX(f.created_at) DESC
    `, [id]);
    res.json({ following: result.rows, count: result.rows.length });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch following' }); }
});

module.exports = router;
