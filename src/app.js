const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const { getDb } = require('./db/database');
const { migrate } = require('./db/migrate');
const { seed } = require('./db/seed');
const { loadUser } = require('./services/authService');

const app = express();

// DB init
migrate();
seed();

// Config
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'wordguess-dev-secret-change-in-production';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname + '/public'));

// Session
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 },
}));

// Passport
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    done(null, user || null);
  } catch (err) {
    done(err, null);
  }
});

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: `${BASE_URL}/auth/google/callback`,
  }, (accessToken, refreshToken, profile, done) => {
    try {
      const db = getDb();
      const email = profile.emails && profile.emails[0] ? profile.emails[0].value : '';
      const avatar = profile.photos && profile.photos[0] ? profile.photos[0].value : '';
      let user = db.prepare('SELECT * FROM users WHERE google_id = ?').get(profile.id);
      if (!user) {
        const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
        let code;
        for (let i = 0; i < 20; i++) {
          code = '';
          for (let j = 0; j < 5; j++) code += chars[Math.floor(Math.random() * chars.length)];
          if (!db.prepare('SELECT id FROM users WHERE friend_code = ?').get(code)) break;
        }
        const info = db.prepare('INSERT INTO users (google_id, email, display_name, avatar_url, friend_code) VALUES (?, ?, ?, ?, ?)').run(profile.id, email, profile.displayName, avatar, code);
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
      } else {
        db.prepare('UPDATE users SET email = ?, display_name = ?, avatar_url = ?, last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(email, profile.displayName, avatar, user.id);
      }
      done(null, user);
    } catch (err) {
      done(err, null);
    }
  }));
}

// View engine
app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');

app.use(loadUser);

// Routes
const authRoutes = require('./routes/auth');
const dailyRoutes = require('./routes/daily');
const friendRoutes = require('./routes/friends');
const groupRoutes = require('./routes/groups');
const sessionRoutes = require('./routes/sessions');
const battleRoutes = require('./routes/battles');
const royaleRoutes = require('./routes/royale');

app.use(authRoutes);
app.use(dailyRoutes);
app.use(friendRoutes);
app.use(groupRoutes);
app.use(sessionRoutes);
app.use(battleRoutes);
app.use(royaleRoutes);

// Home
app.get('/', (req, res) => {
  if (!req.isAuthenticated()) return res.render('login', { title: 'Login' });

  const db = getDb();
  const todayStr = new Date().toISOString().slice(0, 10);

  const todayAttempt = db.prepare('SELECT * FROM daily_attempts WHERE user_id = ? AND puzzle_date = ?').get(req.user.id, todayStr);

  const activeSessions = db.prepare(`
    SELECT s.*, g.name as group_name
    FROM sessions s
    JOIN groups g ON g.id = s.group_id
    JOIN group_members gm ON gm.group_id = s.group_id AND gm.user_id = ?
    WHERE s.start_date <= ? AND s.end_date >= ?
    ORDER BY s.end_date ASC
  `).all(req.user.id, todayStr, todayStr);

  const groups = db.prepare(`
    SELECT g.*, gm.role,
      (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
    FROM groups g
    JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
    ORDER BY g.created_at DESC
  `).all(req.user.id);

  res.render('index', {
    title: 'Dashboard',
    todayAttempt,
    activeSessions,
    groups,
  });
});

// Catch-all render helper
app.use((req, res, next) => {
  if (!res.headersSent) {
    res.status(404).send('Not found');
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Something went wrong');
});

app.listen(PORT, () => {
  console.log(`WordGuess running on ${BASE_URL}`);
});

module.exports = app;
