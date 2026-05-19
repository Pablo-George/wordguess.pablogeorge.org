const express = require('express');
const passport = require('passport');
const { getDb } = require('../db/database');

const router = express.Router();
const googleStrategyEnabled = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

router.get('/login', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/');
  res.render('login', { googleEnabled: googleStrategyEnabled });
});

if (googleStrategyEnabled) {
  router.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
  );

  router.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login' }),
    (req, res) => {
      const db = getDb();
      db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.user.id);
      res.redirect('/');
    }
  );
} else {
  router.get('/auth/google', (req, res) => {
    res.status(400).send('Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
  });
}

if (!googleStrategyEnabled) {
  router.get('/devlogin', (req, res) => {
    const db = getDb();
    let user = db.prepare('SELECT * FROM users ORDER BY id LIMIT 1').get();
    if (!user) {
      const info = db.prepare('INSERT INTO users (google_id, email, display_name) VALUES (?, ?, ?)').run('dev', 'dev@wordguess.local', 'Dev User');
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    }
    if (!user.friend_code) {
      const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
      let code;
      for (let i = 0; i < 20; i++) {
        code = '';
        for (let j = 0; j < 5; j++) code += chars[Math.floor(Math.random() * chars.length)];
        if (!db.prepare('SELECT id FROM users WHERE friend_code = ?').get(code)) break;
      }
      db.prepare('UPDATE users SET friend_code = ? WHERE id = ?').run(code, user.id);
      user.friend_code = code;
    }
    req.login(user, (err) => {
      if (err) return res.status(500).send('Login error');
      db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
      res.redirect('/');
    });
  });
}

router.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect('/');
  });
});

router.get('/profile', (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/login');
  res.render('profile', { user: req.user });
});

module.exports = router;
