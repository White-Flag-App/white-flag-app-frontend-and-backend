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

---

## File Structure

```
whiteflag.html              ← Single-file frontend (open in browser)
src/
  index.js                  ← Express entry point
  config/
    database.js             ← PostgreSQL pool
    init-database.js        ← Creates all 17 tables + indexes
  middleware/
    auth.js                 ← JWT verify / optional auth
    verification.js         ← requireVerified guard
  routes/
    auth.js                 ← Wallet nonce + JWT (2 routes)
    posts.js                ← CRUD, upvotes, reposts, comments (11 routes)
    users.js                ← Profile, follow, stats (8 routes)
    bookmarks.js            ← Save / remove posts (4 routes)
    leaderboard.js          ← Rankings (2 routes)
    messages.js             ← Direct messages (6 routes)
    chat.js                 ← Public chat rooms (9 routes)
    voice.js                ← Voice room management (9 routes)
    verification.js         ← Solana payment verification (4 routes)
  utils/
    solana.js               ← Blockchain transaction helpers
package.json
.env.example
```

---

## API Summary (55 routes)

| Method | Path | Auth |
|--------|------|------|
| GET | /api/auth/nonce/:wallet | — |
| POST | /api/auth/verify | — |
| GET | /api/posts | optional |
| POST | /api/posts | verified |
| PUT | /api/posts/:id | required |
| DELETE | /api/posts/:id | required |
| POST | /api/posts/:id/upvote | required |
| POST | /api/posts/:id/repost | required |
| GET | /api/posts/:id/comments | — |
| POST | /api/posts/:id/comments | required |
| POST | /api/posts/:pid/comments/:cid/upvote | required |
| DELETE | /api/posts/:pid/comments/:cid | required |
| GET | /api/users/me | required |
| PUT | /api/users/profile | required |
| POST | /api/users/verify | required |
| GET | /api/users/:id | optional |
| POST | /api/users/:id/follow | required |
| GET | /api/users/:id/posts | — |
| GET | /api/bookmarks | required |
| POST | /api/bookmarks | required |
| DELETE | /api/bookmarks/:postId | required |
| GET | /api/leaderboard | optional |
| POST | /api/messages/send | required |
| GET | /api/messages/conversations | required |
| POST | /api/chat/rooms/:id/messages | required |
| POST | /api/voice/rooms | required |
| POST | /api/voice/rooms/:id/join | required |
| ... and more |

## Required Environment Variables

| Variable | Required | Default |
|----------|----------|---------|
| DB_PASSWORD | **yes** | — |
| JWT_SECRET | **yes** | — |
| DB_HOST | no | localhost |
| DB_PORT | no | 5432 |
| DB_NAME | no | whiteflag |
| DB_USER | no | postgres |
| PORT | no | 3001 |
| CORS_ORIGIN | no | * (all) |
| SOLANA_RPC_URL | no | devnet |
| PLATFORM_WALLET_ADDRESS | no | — |
