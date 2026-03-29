// ═══════════════════════════════════════════════════════════
// WhiteFlag Backend - Main Server
// Express.js API server with PostgreSQL
// ═══════════════════════════════════════════════════════════

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

// Import routes
const authRoutes = require('./routes/auth');
const postsRoutes = require('./routes/posts');
const usersRoutes = require('./routes/users');
const bookmarksRoutes = require('./routes/bookmarks');
const leaderboardRoutes = require('./routes/leaderboard');
const messagesRoutes = require('./routes/messages');
const chatRoutes = require('./routes/chat');
const voiceRoutes = require('./routes/voice');
const verificationRoutes = require('./routes/verification');
const notificationsRoutes = require('./routes/notifications');

const app = express();
const PORT = process.env.PORT || 3001;

// ═══════════════════════════════════════════════════════════
// VIEW ENGINE
// ═══════════════════════════════════════════════════════════

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// ═══════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════

// Security headers (CSP relaxed for inline handlers & CDN scripts)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "https://tenor.googleapis.com", "http://localhost:3001"],
    }
  }
}));

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || '*',
  credentials: true
}));

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// Serve public frontend files
app.use(express.static(path.join(__dirname, '../public')));

// Logging
app.use(morgan('dev'));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
});
app.use('/api/', limiter);

// ═══════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════

app.use('/api/auth', authRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/bookmarks', bookmarksRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/verification', verificationRoutes);
app.use('/api/notifications', notificationsRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
});

// Root endpoint — serve EJS frontend
app.get('/', (req, res) => {
  res.render('index');
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ═══════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  🚀 WhiteFlag Backend Server');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`  Port: ${PORT}`);
  console.log(`  Database: ${process.env.DB_NAME}`);
  console.log('');
  console.log('  API Endpoints:');
  console.log(`  → http://localhost:${PORT}/api/auth`);
  console.log(`  → http://localhost:${PORT}/api/posts`);
  console.log(`  → http://localhost:${PORT}/api/users`);
  console.log(`  → http://localhost:${PORT}/api/bookmarks`);
  console.log(`  → http://localhost:${PORT}/api/leaderboard`);
  console.log('');
  console.log(`  Health Check: http://localhost:${PORT}/health`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
});

module.exports = app;
