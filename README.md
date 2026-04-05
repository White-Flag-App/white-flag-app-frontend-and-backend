# WhiteFlag — Crypto Social Platform

Solana-powered social platform: posts, comments, GIF replies, voice chats, leaderboard, DMs, bookmarks.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — set DB_PASSWORD and JWT_SECRET (min 32 chars)

# 3. Create database
createdb whiteflag

# 4. Initialize tables (17 tables + indexes)
npm run init-db

# 5. Start server
npm start          # http://localhost:3001
npm run dev        # with auto-restart
```

Then open **whiteflag.html** in your browser.
The frontend connects to `http://localhost:3001/api` automatically,
and falls back to demo mode if the backend is offline.