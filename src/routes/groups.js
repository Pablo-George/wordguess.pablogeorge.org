const express = require('express');
const { getDb } = require('../db/database');
const { ensureAuth } = require('../services/authService');

const router = express.Router();

router.get('/groups', ensureAuth, (req, res) => {
  const db = getDb();
  const groups = db.prepare(`
    SELECT g.*, gm.role,
      (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
    FROM groups g
    JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
    ORDER BY g.created_at DESC
  `).all(req.user.id);
  res.render('groups', { groups });
});

router.get('/groups/new', ensureAuth, (req, res) => {
  res.render('group_new');
});

router.post('/groups', ensureAuth, (req, res) => {
  const db = getDb();
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  const info = db.prepare('INSERT INTO groups (name, description, created_by) VALUES (?, ?, ?)').run(name, description || null, req.user.id);
  db.prepare('INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)').run(info.lastInsertRowid, req.user.id, 'admin');
  res.redirect(`/groups/${info.lastInsertRowid}`);
});

router.get('/groups/:groupId', ensureAuth, (req, res) => {
  const db = getDb();
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.groupId);
  if (!group) return res.status(404).send('Group not found');

  const isMember = db.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?').get(req.params.groupId, req.user.id);
  if (!isMember) return res.status(403).send('Not a member');

  const members = db.prepare(`
    SELECT u.id, u.display_name, u.avatar_url, gm.role, gm.joined_at
    FROM group_members gm
    JOIN users u ON u.id = gm.user_id
    WHERE gm.group_id = ?
  `).all(req.params.groupId);

  const sessions = db.prepare('SELECT * FROM sessions WHERE group_id = ? ORDER BY start_date DESC').all(req.params.groupId);

  res.render('group', { group, members, sessions, isAdmin: isMember.role === 'admin' });
});

router.post('/groups/:groupId/invite', ensureAuth, (req, res) => {
  const db = getDb();
  const { email } = req.body;
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const isAdmin = db.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ? AND role = ?').get(req.params.groupId, req.user.id, 'admin');
  if (!isAdmin) return res.status(403).json({ error: 'Only admins can invite' });

  const target = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!target) return res.status(404).json({ error: 'User not found' });

  const existing = db.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?').get(req.params.groupId, target.id);
  if (existing) return res.status(400).json({ error: 'Already a member' });

  db.prepare('INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)').run(req.params.groupId, target.id, 'member');
  res.json({ success: true });
});

router.post('/groups/:groupId/join', ensureAuth, (req, res) => {
  const db = getDb();
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const existing = db.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?').get(req.params.groupId, req.user.id);
  if (existing) return res.status(400).json({ error: 'Already a member' });

  db.prepare('INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)').run(req.params.groupId, req.user.id, 'member');
  res.json({ success: true });
});

module.exports = router;
