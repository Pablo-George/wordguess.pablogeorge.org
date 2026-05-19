const express = require('express');
const { getDb } = require('../db/database');
const { ensureAuth } = require('../services/authService');

const router = express.Router();
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateCode() {
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

function getOrCreateFriendCode(db, userId) {
  let user = db.prepare('SELECT friend_code FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  if (user.friend_code) return user.friend_code;

  let code;
  for (let attempt = 0; attempt < 20; attempt++) {
    code = generateCode();
    const existing = db.prepare('SELECT id FROM users WHERE friend_code = ?').get(code);
    if (!existing) break;
  }
  db.prepare('UPDATE users SET friend_code = ? WHERE id = ?').run(code, userId);
  return code;
}

router.get('/friends', ensureAuth, (req, res) => {
  const db = getDb();
  const friends = db.prepare(`
    SELECT f.id, f.status, f.created_at, f.user_id as requester_id,
      u.id as friend_user_id, u.display_name, u.email, u.avatar_url
    FROM friends f
    JOIN users u ON u.id = CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END
    WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status IN ('pending', 'accepted')
  `).all(req.user.id, req.user.id, req.user.id);

  const incoming = friends.filter(f => f.status === 'pending' && f.requester_id !== req.user.id);
  const outgoing = friends.filter(f => f.status === 'pending' && f.requester_id === req.user.id);
  const accepted = friends.filter(f => f.status === 'accepted');

  const inviteLink = `${req.protocol}://${req.get('host')}/friends/invite/${req.user.id}`;
  const friendCode = getOrCreateFriendCode(db, req.user.id);

  res.render('friends', { incoming, outgoing, accepted, inviteLink, friendCode });
});

router.get('/friends/invite/:userId', ensureAuth, (req, res) => {
  const db = getDb();
  const targetId = parseInt(req.params.userId);
  if (targetId === req.user.id) return res.redirect('/friends');

  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).send('User not found');

  const existing = db.prepare('SELECT id, status FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').get(req.user.id, targetId, targetId, req.user.id);
  if (existing) return res.redirect('/friends');

  db.prepare('INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, ?)').run(req.user.id, targetId, 'pending');
  res.redirect('/friends');
});

router.post('/friends/add-by-code', ensureAuth, (req, res) => {
  const db = getDb();
  const { code } = req.body;
  if (!code || code.length !== 5) return res.status(400).json({ error: 'Invalid code' });

  const target = db.prepare('SELECT id FROM users WHERE friend_code = ?').get(code.toUpperCase());
  if (!target) return res.status(404).json({ error: 'Code not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Cannot add yourself' });

  const existing = db.prepare('SELECT id, status FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').get(req.user.id, target.id, target.id, req.user.id);
  if (existing) {
    if (existing.status === 'accepted') return res.status(400).json({ error: 'Already friends' });
    return res.status(400).json({ error: 'Request already pending' });
  }

  db.prepare('INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, ?)').run(req.user.id, target.id, 'pending');
  res.json({ success: true });
});

router.post('/friends/accept/:id', ensureAuth, (req, res) => {
  const db = getDb();
  const friend = db.prepare('SELECT * FROM friends WHERE id = ? AND friend_id = ? AND status = ?').get(req.params.id, req.user.id, 'pending');
  if (!friend) return res.status(404).json({ error: 'Request not found' });

  db.prepare('UPDATE friends SET status = ? WHERE id = ?').run('accepted', req.params.id);
  res.redirect('/friends');
});

router.post('/friends/remove/:id', ensureAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM friends WHERE id = ? AND (user_id = ? OR friend_id = ?)').run(req.params.id, req.user.id, req.user.id);
  res.redirect('/friends');
});

router.get('/friends/poll', ensureAuth, (req, res) => {
  const db = getDb();
  const { c } = db.prepare(`
    SELECT COUNT(*) as c FROM friends
    WHERE friend_id = ? AND status = 'pending'
  `).get(req.user.id);
  res.json({ incoming: c });
});

module.exports = router;
