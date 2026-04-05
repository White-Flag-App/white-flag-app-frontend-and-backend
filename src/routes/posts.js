const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { uploadToCloudinary } = require('../config/cloudinary');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const { requireVerified } = require('../middleware/verification');
const { upload } = require('../middleware/upload');

// ── Helper: attach images array to posts ──────────────────────────
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

// GET /posts
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { topic, limit = 50, offset = 0 } = req.query;
    const userId = req.user?.userId;
    const params = topic ? [topic, limit, offset] : [limit, offset];
    if (userId) params.push(userId);
    const userIdx = params.length;

    const result = await pool.query(`
      SELECT p.*, u.username, u.wallet_address, u.is_verified, u.avatar_url,
        COUNT(DISTINCT c.id)::int  AS comment_count,
        COUNT(DISTINCT up.id)::int AS upvote_count,
        COUNT(DISTINCT rp.id)::int AS repost_count
        ${userId ? `,EXISTS(SELECT 1 FROM upvotes  WHERE post_id=p.id AND user_id=$${userIdx}) AS user_upvoted` : ''}
        ${userId ? `,EXISTS(SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=$${userIdx}) AS user_bookmarked` : ''}
        ${userId ? `,EXISTS(SELECT 1 FROM reposts   WHERE post_id=p.id AND user_id=$${userIdx}) AS user_reposted` : ''}
        ${userId ? `,EXISTS(SELECT 1 FROM follows   WHERE follower_id=$${userIdx} AND following_id=p.user_id) AS user_following` : ''}
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN comments c  ON p.id = c.post_id
      LEFT JOIN upvotes  up ON p.id = up.post_id
      LEFT JOIN reposts  rp ON p.id = rp.post_id
      ${topic ? 'WHERE p.topic = $1' : ''}
      GROUP BY p.id, u.id
      ORDER BY p.created_at DESC
      LIMIT $${topic ? 2 : 1} OFFSET $${topic ? 3 : 2}
    `, params);
    res.json({ posts: await attachImages(result.rows), total: result.rows.length, hasMore: result.rows.length === parseInt(limit) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch posts' }); }
});


// GET /posts/following  — posts from people the current user follows
router.get('/following', authenticateToken, async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const userId = req.user.userId;

    const result = await pool.query(`
      SELECT p.*, u.username, u.wallet_address, u.is_verified, u.avatar_url,
        COUNT(DISTINCT c.id)::int  AS comment_count,
        COUNT(DISTINCT up.id)::int AS upvote_count,
        COUNT(DISTINCT rp.id)::int AS repost_count,
        EXISTS(SELECT 1 FROM upvotes   WHERE post_id=p.id AND user_id=$1) AS user_upvoted,
        EXISTS(SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=$1) AS user_bookmarked,
        EXISTS(SELECT 1 FROM reposts   WHERE post_id=p.id AND user_id=$1) AS user_reposted,
        true AS user_following
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN comments c  ON p.id = c.post_id
      LEFT JOIN upvotes  up ON p.id = up.post_id
      LEFT JOIN reposts  rp ON p.id = rp.post_id
      WHERE p.user_id IN (
        SELECT following_id FROM follows WHERE follower_id = $1
      )
      GROUP BY p.id, u.id
      ORDER BY p.created_at DESC
      LIMIT $2 OFFSET $3
    `, [userId, limit, offset]);

    res.json({ posts: await attachImages(result.rows), total: result.rows.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch following posts' });
  }
});

// GET /posts/:id
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;
    const params = userId ? [id, userId] : [id];
    const result = await pool.query(`
      SELECT p.*, u.username, u.wallet_address, u.is_verified, u.avatar_url,
        COUNT(DISTINCT c.id)::int  AS comment_count,
        COUNT(DISTINCT up.id)::int AS upvote_count,
        COUNT(DISTINCT rp.id)::int AS repost_count
        ${userId ? `,EXISTS(SELECT 1 FROM upvotes  WHERE post_id=p.id AND user_id=$2) AS user_upvoted` : ''}
        ${userId ? `,EXISTS(SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=$2) AS user_bookmarked` : ''}
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN comments c  ON p.id = c.post_id
      LEFT JOIN upvotes  up ON p.id = up.post_id
      LEFT JOIN reposts  rp ON p.id = rp.post_id
      WHERE p.id = $1
      GROUP BY p.id, u.id
    `, params);
    if (!result.rows.length) return res.status(404).json({ error: 'Post not found' });
    const withImages = await attachImages(result.rows);
    res.json(withImages[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch post' }); }
});

// POST /posts — create post with optional image uploads (up to 4)
router.post('/', authenticateToken, requireVerified, upload.array('images', 4), async (req, res) => {
  try {
    const { content, title, topic, linkUrl } = req.body;
    const userId = req.user.userId;
    if (!content || !topic) return res.status(400).json({ error: 'Content and topic required' });
    if (content.length > 5000) return res.status(400).json({ error: 'Content too long (max 5000 chars)' });
    const valid = ['trends','general','solana','meme coins','lore','utility','news'];
    if (!valid.includes(topic.toLowerCase())) return res.status(400).json({ error: 'Invalid topic' });

    // Create the post
    const result = await pool.query(
      `INSERT INTO posts (user_id, content, title, topic, link_url) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [userId, content, title || null, topic, linkUrl || null]
    );
    const post = result.rows[0];

    // Upload images to Cloudinary
    const images = [];
    console.log('[DEBUG] req.files:', req.files ? req.files.length + ' files' : 'NO FILES');
    if (req.files && req.files.length > 0) {
      console.log('[DEBUG] File details:', req.files.map(f => ({ name: f.originalname, size: f.size, mime: f.mimetype, hasBuffer: !!f.buffer })));
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        try {
          const result = await uploadToCloudinary(file.buffer, {
            folder: 'whiteflag/posts',
            public_id: `post_${post.id}_${i}_${Date.now()}`
          });

          const imageUrl = result.secure_url;
          await pool.query(
            `INSERT INTO post_images (post_id, image_url, display_order) VALUES ($1, $2, $3)`,
            [post.id, imageUrl, i]
          );
          images.push(imageUrl);
        } catch (imgErr) {
          console.error('Cloudinary upload error:', imgErr);
        }
      }
    }

    // Update leaderboard
    await pool.query(
      `INSERT INTO leaderboard_stats (user_id, posts_count, engagement_score)
       VALUES ($1, 1, 10)
       ON CONFLICT (user_id)
       DO UPDATE SET posts_count=leaderboard_stats.posts_count+1, engagement_score=leaderboard_stats.engagement_score+10, updated_at=NOW()`,
      [userId]
    );

    res.status(201).json({ ...post, images });
  } catch (e) {
    console.error(e);
    if (e.message && e.message.includes('Invalid file type')) {
      return res.status(400).json({ error: e.message });
    }
    res.status(500).json({ error: 'Failed to create post' });
  }
});

// PUT /posts/:id
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { content, title } = req.body;
    const userId = req.user.userId;
    const result = await pool.query(
      `UPDATE posts SET content=COALESCE($1,content), title=COALESCE($2,title), updated_at=NOW()
       WHERE id=$3 AND user_id=$4 RETURNING *`,
      [content, title, id, userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Post not found or unauthorized' });
    res.json(result.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to update post' }); }
});

// DELETE /posts/:id
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const result = await pool.query('DELETE FROM posts WHERE id=$1 AND user_id=$2 RETURNING id', [id, userId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Post not found or unauthorized' });

    // Update leaderboard stats (decrement post count)
    await pool.query(
      `UPDATE leaderboard_stats SET posts_count = GREATEST(posts_count - 1, 0), engagement_score = GREATEST(engagement_score - 10, 0), updated_at = NOW() WHERE user_id = $1`,
      [userId]
    );

    res.json({ message: 'Post deleted' });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to delete post' }); }
});

// POST /posts/:id/upvote
router.post('/:id/upvote', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const existing = await pool.query('SELECT id FROM upvotes WHERE post_id=$1 AND user_id=$2', [id, userId]);
    if (existing.rows.length) {
      await pool.query('DELETE FROM upvotes WHERE post_id=$1 AND user_id=$2', [id, userId]);
      await pool.query('UPDATE posts SET upvotes=GREATEST(0,upvotes-1) WHERE id=$1', [id]);
      return res.json({ upvoted: false });
    }
    await pool.query('INSERT INTO upvotes (post_id, user_id) VALUES ($1, $2)', [id, userId]);
    await pool.query('UPDATE posts SET upvotes=upvotes+1 WHERE id=$1', [id]);
    const post = await pool.query('SELECT user_id FROM posts WHERE id=$1', [id]);
    if (post.rows.length) {
      await pool.query(
        `UPDATE leaderboard_stats SET upvotes_received=upvotes_received+1, engagement_score=engagement_score+2, updated_at=NOW() WHERE user_id=$1`,
        [post.rows[0].user_id]
      );
      // Notify post owner (not self)
      if (post.rows[0].user_id !== userId) {
        await pool.query(
          `INSERT INTO notifications (user_id, actor_id, type, post_id) VALUES ($1,$2,'upvote',$3)`,
          [post.rows[0].user_id, userId, id]
        );
      }
    }
    res.json({ upvoted: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to upvote' }); }
});

// POST /posts/:id/repost
router.post('/:id/repost', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const post = await pool.query('SELECT * FROM posts WHERE id=$1', [id]);
    if (!post.rows.length) return res.status(404).json({ error: 'Post not found' });
    const existing = await pool.query('SELECT id FROM reposts WHERE post_id=$1 AND user_id=$2', [id, userId]);
    if (existing.rows.length) {
      await pool.query('DELETE FROM reposts WHERE post_id=$1 AND user_id=$2', [id, userId]);
      return res.json({ reposted: false });
    }
    await pool.query('INSERT INTO reposts (post_id, user_id) VALUES ($1, $2)', [id, userId]);
    await pool.query(
      `UPDATE leaderboard_stats SET engagement_score=engagement_score+3, updated_at=NOW() WHERE user_id=$1`,
      [post.rows[0].user_id]
    );
    // Notify post owner (not self)
    if (post.rows[0].user_id !== userId) {
      await pool.query(
        `INSERT INTO notifications (user_id, actor_id, type, post_id) VALUES ($1,$2,'repost',$3)`,
        [post.rows[0].user_id, userId, id]
      );
    }
    res.json({ reposted: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to repost' }); }
});

// GET /posts/:id/comments  (threaded)
router.get('/:id/comments', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT c.*, u.username, u.wallet_address, u.is_verified, u.avatar_url,
             COUNT(cu.id)::int AS upvote_count
      FROM comments c
      JOIN users u ON c.user_id = u.id
      LEFT JOIN comment_upvotes cu ON c.id = cu.comment_id
      WHERE c.post_id = $1
      GROUP BY c.id, u.id
      ORDER BY c.created_at ASC
    `, [id]);

    // Build threaded tree
    const map = {};
    const roots = [];
    result.rows.forEach(r => { map[r.id] = { ...r, replies: [] }; });
    result.rows.forEach(r => {
      if (r.parent_comment_id && map[r.parent_comment_id]) {
        map[r.parent_comment_id].replies.push(map[r.id]);
      } else {
        roots.push(map[r.id]);
      }
    });
    res.json({ comments: roots });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch comments' }); }
});

// POST /posts/:id/comments  (supports parent_comment_id for replies)
router.post('/:id/comments', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { content, parent_comment_id } = req.body;
    const userId = req.user.userId;
    if (!content?.trim()) return res.status(400).json({ error: 'Comment content required' });

    const result = await pool.query(
      `INSERT INTO comments (post_id, user_id, parent_comment_id, content) VALUES ($1,$2,$3,$4) RETURNING *`,
      [id, userId, parent_comment_id || null, content.trim()]
    );
    await pool.query(
      `UPDATE leaderboard_stats SET comments_count=comments_count+1, engagement_score=engagement_score+5, updated_at=NOW() WHERE user_id=$1`,
      [userId]
    );

    const comment = result.rows[0];
    const user = await pool.query('SELECT username, is_verified FROM users WHERE id=$1', [userId]);
    // Notify post owner (not self)
    const postOwner = await pool.query('SELECT user_id FROM posts WHERE id=$1', [id]);
    if (postOwner.rows.length && postOwner.rows[0].user_id !== userId) {
      await pool.query(
        `INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id) VALUES ($1,$2,'comment',$3,$4)`,
        [postOwner.rows[0].user_id, userId, id, comment.id]
      );
    }
    res.status(201).json({ ...comment, ...user.rows[0], replies: [] });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to create comment' }); }
});

// POST /posts/:postId/comments/:commentId/upvote
router.post('/:postId/comments/:commentId/upvote', authenticateToken, async (req, res) => {
  try {
    const { commentId } = req.params;
    const userId = req.user.userId;
    const existing = await pool.query('SELECT id FROM comment_upvotes WHERE comment_id=$1 AND user_id=$2', [commentId, userId]);
    if (existing.rows.length) {
      await pool.query('DELETE FROM comment_upvotes WHERE comment_id=$1 AND user_id=$2', [commentId, userId]);
      await pool.query('UPDATE comments SET upvotes=GREATEST(0,upvotes-1) WHERE id=$1', [commentId]);
      return res.json({ upvoted: false });
    }
    await pool.query('INSERT INTO comment_upvotes (comment_id, user_id) VALUES ($1,$2)', [commentId, userId]);
    await pool.query('UPDATE comments SET upvotes=upvotes+1 WHERE id=$1', [commentId]);
    res.json({ upvoted: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to upvote comment' }); }
});

// DELETE /posts/:postId/comments/:commentId
router.delete('/:postId/comments/:commentId', authenticateToken, async (req, res) => {
  try {
    const { commentId } = req.params;
    const userId = req.user.userId;
    const result = await pool.query('DELETE FROM comments WHERE id=$1 AND user_id=$2 RETURNING id', [commentId, userId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Comment not found or unauthorized' });
    res.json({ message: 'Comment deleted' });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to delete comment' }); }
});

module.exports = router;
