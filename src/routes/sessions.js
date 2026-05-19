const express = require('express');
const { getDb } = require('../db/database');
const { ensureAuth } = require('../services/authService');

const router = express.Router();

router.get('/groups/:groupId/sessions', ensureAuth, (req, res) => {
  const db = getDb();
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.groupId);
  if (!group) return res.status(404).send('Group not found');

  const sessions = db.prepare('SELECT * FROM sessions WHERE group_id = ? ORDER BY start_date DESC').all(req.params.groupId);
  res.render('sessions', { group, sessions });
});

router.get('/groups/:groupId/sessions/new', ensureAuth, (req, res) => {
  const db = getDb();
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.groupId);
  if (!group) return res.status(404).send('Group not found');
  res.render('session_new', { group });
});

router.post('/groups/:groupId/sessions', ensureAuth, (req, res) => {
  const db = getDb();
  const { name, start_date, end_date, scoring_mode } = req.body;
  if (!name || !start_date || !end_date) return res.status(400).json({ error: 'Name, start and end date required' });

  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const isMember = db.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?').get(req.params.groupId, req.user.id);
  if (!isMember) return res.status(403).json({ error: 'Not a member' });

  const info = db.prepare('INSERT INTO sessions (group_id, name, start_date, end_date, scoring_mode, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(req.params.groupId, name, start_date, end_date, scoring_mode || 'daily_classic', req.user.id);
  res.redirect(`/sessions/${info.lastInsertRowid}`);
});

router.get('/sessions/:sessionId', ensureAuth, (req, res) => {
  const db = getDb();
  const session = db.prepare(`
    SELECT s.*, g.name as group_name, u.display_name as creator_name
    FROM sessions s
    JOIN groups g ON g.id = s.group_id
    JOIN users u ON u.id = s.created_by
    WHERE s.id = ?
  `).get(req.params.sessionId);
  if (!session) return res.status(404).send('Session not found');

  const isMember = db.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?').get(session.group_id, req.user.id);
  if (!isMember) return res.status(403).send('Not a member');

  const leaderboard = db.prepare(`
    SELECT u.id, u.display_name, u.avatar_url,
      COALESCE(SUM(da.score), 0) as total_points,
      COUNT(CASE WHEN da.solved = 1 THEN 1 END) as words_solved,
      ROUND(AVG(CASE WHEN da.solved = 1 THEN da.guesses_count END), 2) as avg_guesses,
      COUNT(CASE WHEN da.puzzle_date BETWEEN ? AND ? AND da.id IS NULL THEN 1 END) as missed_days
    FROM group_members gm
    JOIN users u ON u.id = gm.user_id
    LEFT JOIN daily_attempts da ON da.user_id = u.id AND da.puzzle_date BETWEEN ? AND ?
    WHERE gm.group_id = ?
    GROUP BY u.id
    ORDER BY total_points DESC, words_solved DESC, avg_guesses ASC
  `).all(session.start_date, session.end_date, session.start_date, session.end_date, session.group_id);

  res.render('session', { session, leaderboard, todayStr: new Date().toISOString().slice(0, 10) });
});

module.exports = router;
