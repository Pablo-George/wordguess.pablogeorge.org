const express = require('express');
const { getDb } = require('../db/database');
const { ensureAuth } = require('../services/authService');
const { getDailyWord } = require('../services/wordService');
const { isValidWord } = require('../services/wordService');
const { getFeedback } = require('../services/feedbackService');

const router = express.Router();

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

router.get('/battles/new', ensureAuth, (req, res) => {
  const db = getDb();
  const groups = db.prepare(`
    SELECT g.* FROM groups g
    JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
  `).all(req.user.id);
  res.render('battle_new', { groups });
});

router.post('/battles', ensureAuth, (req, res) => {
  const db = getDb();
  const { group_id } = req.body;
  const word = getDailyWord(todayStr());
  if (!word) return res.status(500).json({ error: 'No word available' });

  const info = db.prepare('INSERT INTO team_battles (group_id, word_id, status, created_by) VALUES (?, ?, ?, ?)').run(group_id || null, word.id, 'waiting', req.user.id);
  const battleId = info.lastInsertRowid;

  db.prepare('INSERT INTO team_battle_players (battle_id, user_id, team_number, turn_order) VALUES (?, ?, ?, ?)').run(battleId, req.user.id, 1, 0);
  res.redirect(`/battles/${battleId}`);
});

router.get('/battles/:battleId', ensureAuth, (req, res) => {
  const db = getDb();
  const battle = db.prepare('SELECT * FROM team_battles WHERE id = ?').get(req.params.battleId);
  if (!battle) return res.status(404).send('Battle not found');

  const players = db.prepare(`
    SELECT tbp.*, u.display_name, u.avatar_url
    FROM team_battle_players tbp
    JOIN users u ON u.id = tbp.user_id
    WHERE tbp.battle_id = ?
  `).all(req.params.battleId);

  const guesses = db.prepare(`
    SELECT tbg.*, u.display_name
    FROM team_battle_guesses tbg
    JOIN users u ON u.id = tbg.user_id
    WHERE tbg.battle_id = ?
    ORDER BY tbg.created_at
  `).all(req.params.battleId);

  const isPlayer = players.some(p => p.user_id === req.user.id);
  if (!isPlayer) return res.status(403).send('Not a player');

  res.render('battle', { battle, players, guesses });
});

router.post('/battles/:battleId/join', ensureAuth, (req, res) => {
  const db = getDb();
  const battle = db.prepare('SELECT * FROM team_battles WHERE id = ?').get(req.params.battleId);
  if (!battle || battle.status !== 'waiting') return res.status(400).json({ error: 'Cannot join' });

  const existing = db.prepare('SELECT * FROM team_battle_players WHERE battle_id = ? AND user_id = ?').get(req.params.battleId, req.user.id);
  if (existing) return res.status(400).json({ error: 'Already joined' });

  const teamCounts = db.prepare('SELECT team_number, COUNT(*) as c FROM team_battle_players WHERE battle_id = ? GROUP BY team_number').all(req.params.battleId);
  let team = 1;
  if (teamCounts.length > 0) {
    const t1 = teamCounts.find(t => t.team_number === 1)?.c || 0;
    const t2 = teamCounts.find(t => t.team_number === 2)?.c || 0;
    team = t1 <= t2 ? 1 : 2;
  }

  db.prepare('INSERT INTO team_battle_players (battle_id, user_id, team_number, turn_order) VALUES (?, ?, ?, ?)').run(req.params.battleId, req.user.id, team, 0);
  res.redirect(`/battles/${req.params.battleId}`);
});

router.post('/battles/:battleId/start', ensureAuth, (req, res) => {
  const db = getDb();
  const battle = db.prepare('SELECT * FROM team_battles WHERE id = ?').get(req.params.battleId);
  if (!battle) return res.status(404).json({ error: 'Not found' });
  if (battle.created_by !== req.user.id) return res.status(403).json({ error: 'Only creator can start' });
  if (battle.status !== 'waiting') return res.status(400).json({ error: 'Already started' });

  const players = db.prepare('SELECT COUNT(*) as c FROM team_battle_players WHERE battle_id = ?').get(req.params.battleId).c;
  if (players < 2) return res.status(400).json({ error: 'Need at least 2 players' });

  db.prepare('UPDATE team_battles SET status = ?, started_at = CURRENT_TIMESTAMP WHERE id = ?').run('active', req.params.battleId);
  res.redirect(`/battles/${req.params.battleId}`);
});

router.post('/battles/:battleId/guess', ensureAuth, async (req, res) => {
  const db = getDb();
  const battle = db.prepare('SELECT * FROM team_battles WHERE id = ?').get(req.params.battleId);
  if (!battle || battle.status !== 'active') return res.status(400).json({ error: 'Battle not active' });

  const { guess } = req.body;
  if (!guess || guess.length !== 5) return res.status(400).json({ error: '5-letter guess required' });
  if (!(await isValidWord(guess))) return res.status(400).json({ error: 'Not a valid word' });

  const player = db.prepare('SELECT * FROM team_battle_players WHERE battle_id = ? AND user_id = ?').get(req.params.battleId, req.user.id);
  if (!player) return res.status(403).json({ error: 'Not a player' });

  const word = db.prepare('SELECT w.* FROM daily_words w JOIN team_battles b ON b.word_id = w.id WHERE b.id = ?').get(req.params.battleId);
  if (!word) return res.status(500).json({ error: 'Word not found' });

  const guessUpper = guess.toUpperCase();
  const result = getFeedback(guessUpper, word.word);

  db.prepare('INSERT INTO team_battle_guesses (battle_id, team_number, user_id, guess, result_json) VALUES (?, ?, ?, ?, ?)').run(req.params.battleId, player.team_number, req.user.id, guessUpper, JSON.stringify(result));

  const solved = result.every(r => r.status === 'green');
  if (solved) {
    db.prepare('UPDATE team_battles SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?').run('completed', req.params.battleId);
  }

  res.json({ guess: guessUpper, result, solved });
});

module.exports = router;
