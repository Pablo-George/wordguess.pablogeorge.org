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

// View engine
app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');

app.use(loadUser);

// Routes
const authRoutes = require('./routes/auth');
const dailyRoutes = require('./routes/daily');
const classicRoutes = require('./routes/classic');
const friendRoutes = require('./routes/friends');
const gamesRoutes = require('./routes/games');
const knockoutRoutes = require('./routes/knockout');
const animequotesRoutes = require('./routes/animequotes');
const battleRoutes = require('./routes/battles');
const royaleRoutes = require('./routes/royale');

app.use(authRoutes);
app.use(dailyRoutes);
app.use(classicRoutes);
app.use(friendRoutes);
app.use(gamesRoutes);
app.use(knockoutRoutes);
app.use(animequotesRoutes);
app.use(battleRoutes);
app.use(royaleRoutes);

// Home
app.get('/', (req, res) => {
  if (!req.isAuthenticated()) return res.render('login', { title: 'Login' });

  const db = getDb();
  const todayStr = new Date().toISOString().slice(0, 10);

  const todayAttempt = db.prepare('SELECT * FROM daily_attempts WHERE user_id = ? AND puzzle_date = ?').get(req.user.id, todayStr);

  const activeGames = db.prepare(`
    SELECT pg.*,
      (SELECT COUNT(*) FROM pokemon_game_players WHERE game_id = pg.id) as player_count
    FROM pokemon_games pg
    JOIN pokemon_game_players pgp ON pgp.game_id = pg.id AND pgp.user_id = ?
    WHERE pg.status != 'completed'
    ORDER BY pg.created_at DESC
    LIMIT 5
  `).all(req.user.id);

  res.render('index', {
    title: 'Dashboard',
    todayAttempt,
    activeGames,
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
