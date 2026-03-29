const pool = require('./database');

const createTables = async () => {
  console.log('🔧 Initializing database...\n');
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        wallet_address VARCHAR(64) UNIQUE NOT NULL,
        username VARCHAR(50),
        display_name VARCHAR(100),
        email VARCHAR(255),
        bio TEXT,
        avatar_url VARCHAR(255),
        location VARCHAR(100),
        website VARCHAR(255),
        chain VARCHAR(10) DEFAULT 'solana',
        is_verified BOOLEAN DEFAULT false,
        is_profile_complete BOOLEAN DEFAULT false,
        verification_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS posts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        title VARCHAR(255),
        topic VARCHAR(50) NOT NULL,
        link_url VARCHAR(500),
        upvotes INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS post_images (
        id SERIAL PRIMARY KEY,
        post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
        image_url TEXT NOT NULL,
        display_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS comments (
        id SERIAL PRIMARY KEY,
        post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        parent_comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        upvotes INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS upvotes (
        id SERIAL PRIMARY KEY,
        post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(post_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS comment_upvotes (
        id SERIAL PRIMARY KEY,
        comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(comment_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS bookmarks (
        id SERIAL PRIMARY KEY,
        post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(post_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS follows (
        id SERIAL PRIMARY KEY,
        follower_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        following_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(follower_id, following_id)
      );
      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        referrer_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        referred_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        bonus_paid BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(referred_id)
      );
      CREATE TABLE IF NOT EXISTS leaderboard_stats (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        engagement_score INTEGER DEFAULT 0,
        posts_count INTEGER DEFAULT 0,
        comments_count INTEGER DEFAULT 0,
        upvotes_received INTEGER DEFAULT 0,
        month_year VARCHAR(7),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS reposts (
        id SERIAL PRIMARY KEY,
        post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(post_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        user1_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        user2_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user1_id, user2_id)
      );
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS voice_rooms (
        id SERIAL PRIMARY KEY,
        host_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        topic VARCHAR(50) NOT NULL DEFAULT 'general',
        is_active BOOLEAN DEFAULT true,
        max_speakers INTEGER DEFAULT 20,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS voice_participants (
        id SERIAL PRIMARY KEY,
        room_id INTEGER REFERENCES voice_rooms(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        is_speaker BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        joined_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(room_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS chat_rooms (
        id SERIAL PRIMARY KEY,
        creator_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        topic VARCHAR(50) DEFAULT 'general',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        actor_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(30) NOT NULL,
        post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
        comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        room_id INTEGER REFERENCES chat_rooms(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        reply_to_id INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS chat_participants (
        id SERIAL PRIMARY KEY,
        room_id INTEGER REFERENCES chat_rooms(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        joined_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(room_id, user_id)
      );
    `);
    console.log('✅ All tables created');

    // ── Migrations for existing databases ─────────────────────────
    // These are safe to run repeatedly (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
    await pool.query(`
      DO $$ BEGIN
        ALTER TABLE users ALTER COLUMN wallet_address TYPE VARCHAR(64);
      EXCEPTION WHEN others THEN NULL; END $$;

      DO $$ BEGIN
        ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);
      EXCEPTION WHEN others THEN NULL; END $$;

      DO $$ BEGIN
        ALTER TABLE users ADD COLUMN IF NOT EXISTS chain VARCHAR(10) DEFAULT 'solana';
      EXCEPTION WHEN others THEN NULL; END $$;

      DO $$ BEGIN
        ALTER TABLE users ADD COLUMN IF NOT EXISTS is_profile_complete BOOLEAN DEFAULT false;
      EXCEPTION WHEN others THEN NULL; END $$;

      DO $$ BEGIN
        ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(100);
      EXCEPTION WHEN others THEN NULL; END $$;

      DO $$ BEGIN
        ALTER TABLE users ADD COLUMN IF NOT EXISTS location VARCHAR(100);
      EXCEPTION WHEN others THEN NULL; END $$;

      DO $$ BEGIN
        ALTER TABLE users ADD COLUMN IF NOT EXISTS website VARCHAR(255);
      EXCEPTION WHEN others THEN NULL; END $$;

      DO $$ BEGIN
        ALTER TABLE posts ADD COLUMN IF NOT EXISTS link_url VARCHAR(500);
      EXCEPTION WHEN others THEN NULL; END $$;
    `);
    console.log('✅ Migrations applied');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_posts_user        ON posts(user_id);
      CREATE INDEX IF NOT EXISTS idx_posts_topic       ON posts(topic);
      CREATE INDEX IF NOT EXISTS idx_posts_created     ON posts(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_comments_post     ON comments(post_id);
      CREATE INDEX IF NOT EXISTS idx_comments_parent   ON comments(parent_comment_id);
      CREATE INDEX IF NOT EXISTS idx_upvotes_post      ON upvotes(post_id);
      CREATE INDEX IF NOT EXISTS idx_bookmarks_user    ON bookmarks(user_id);
      CREATE INDEX IF NOT EXISTS idx_post_images_post  ON post_images(post_id);
      CREATE INDEX IF NOT EXISTS idx_follows_follower  ON follows(follower_id);
      CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);
      CREATE INDEX IF NOT EXISTS idx_reposts_post      ON reposts(post_id);
      CREATE INDEX IF NOT EXISTS idx_messages_conv     ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_chat_msgs_room    ON chat_messages(room_id);
      CREATE INDEX IF NOT EXISTS idx_voice_rooms_act   ON voice_rooms(is_active);
      CREATE INDEX IF NOT EXISTS idx_voice_part_room   ON voice_participants(room_id);
    `);
    console.log('✅ All indexes created');
    console.log('\n🎉 Database ready! Run: npm start\n');
  } catch (error) {
    console.error('❌ Database init error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
};

createTables();
