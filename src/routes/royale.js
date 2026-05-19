const express = require('express');
const { getDb } = require('../db/database');
const { ensureAuth } = require('../services/authService');
const { isValidWord, getWordBySeed } = require('../services/wordService');
const { getFeedback } = require('../services/feedbackService');

const router = express.Router();

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function getWordForRound(db, roundSeed) {
  const wordStr = getWordBySeed(roundSeed);
  if (!wordStr) return null;
  let word = db.prepare('SELECT * FROM daily_words WHERE word = ?').get(wordStr);
  if (!word) {
    db.prepare('INSERT INTO daily_words (word, puzzle_date, word_length) VALUES (?, ?, 5)').run(wordStr, todayStr());
    word = db.prepare('SELECT * FROM daily_words WHERE word = ?').get(wordStr);
  }
  return word;
}

router.get('/royale/new', ensureAuth, (req, res) => {
  const db = getDb();
  const groups = db.prepare(`
    SELECT g.* FROM groups g
    JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
  `).all(req.user.id);
  res.render('royale_new', { groups });
});

router.post('/royale', ensureAuth, (req, res) => {
  const db = getDb();
  const { group_id, round_time_seconds } = req.body;

  const info = db.prepare('INSERT INTO royale_games (group_id, status, round_time_seconds, current_round, created_by) VALUES (?, ?, ?, ?, ?)').run(group_id || null, 'waiting', round_time_seconds || 90, 0, req.user.id);
  const gameId = info.lastInsertRowid;

  db.prepare('INSERT INTO royale_players (game_id, user_id, status) VALUES (?, ?, ?)').run(gameId, req.user.id, 'alive');
  res.redirect(`/royale/${gameId}`);
});

router.get('/royale/:gameId', ensureAuth, (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM royale_games WHERE id = ?').get(req.params.gameId);
  if (!game) return res.status(404).send('Game not found');

  const players = db.prepare(`
    SELECT rp.*, u.display_name, u.avatar_url
    FROM royale_players rp
    JOIN users u ON u.id = rp.user_id
    WHERE rp.game_id = ?
  `).all(req.params.gameId);

  const currentRoundInfo = game.current_round > 0
    ? db.prepare('SELECT * FROM royale_rounds WHERE game_id = ? AND round_number = ?').get(req.params.gameId, game.current_round)
    : null;

  const roundGuesses = currentRoundInfo
    ? db.prepare(`
        SELECT rg.*, u.display_name
        FROM royale_guesses rg
        JOIN users u ON u.id = rg.user_id
        WHERE rg.game_id = ? AND rg.round_id = ?
        ORDER BY rg.created_at
      `).all(req.params.gameId, currentRoundInfo.id)
    : [];

  const isPlayer = players.some(p => p.user_id === req.user.id);
  if (!isPlayer) return res.status(403).send('Not a player');

  res.render('royale', { game, players, currentRound: currentRoundInfo, roundGuesses });
});

router.post('/royale/:gameId/join', ensureAuth, (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM royale_games WHERE id = ?').get(req.params.gameId);
  if (!game || game.status !== 'waiting') return res.status(400).json({ error: 'Cannot join' });

  const playerCount = db.prepare('SELECT COUNT(*) as c FROM royale_players WHERE game_id = ?').get(req.params.gameId).c;
  if (playerCount >= 20) return res.status(400).json({ error: 'Game full' });

  const existing = db.prepare('SELECT * FROM royale_players WHERE game_id = ? AND user_id = ?').get(req.params.gameId, req.user.id);
  if (existing) return res.status(400).json({ error: 'Already joined' });

  db.prepare('INSERT INTO royale_players (game_id, user_id, status) VALUES (?, ?, ?)').run(req.params.gameId, req.user.id, 'alive');
  res.redirect(`/royale/${req.params.gameId}`);
});

router.post('/royale/:gameId/start', ensureAuth, (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM royale_games WHERE id = ?').get(req.params.gameId);
  if (!game) return res.status(404).json({ error: 'Not found' });
  if (game.created_by !== req.user.id) return res.status(403).json({ error: 'Only creator can start' });
  if (game.status !== 'waiting') return res.status(400).json({ error: 'Already started' });

  const players = db.prepare('SELECT COUNT(*) as c FROM royale_players WHERE game_id = ?').get(req.params.gameId).c;
  if (players < 3) return res.status(400).json({ error: 'Need at least 3 players' });

  const word = getWordForRound(db, 1);
  if (!word) return res.status(500).json({ error: 'No word available' });

  const now = new Date();
  const endsAt = new Date(now.getTime() + (game.round_time_seconds * 1000));

  db.prepare('INSERT INTO royale_rounds (game_id, round_number, word_id, started_at, ends_at) VALUES (?, ?, ?, ?, ?)').run(req.params.gameId, 1, word.id, now.toISOString(), endsAt.toISOString());
  db.prepare('UPDATE royale_games SET status = ?, current_round = 1, started_at = CURRENT_TIMESTAMP WHERE id = ?').run('active', req.params.gameId);
  res.redirect(`/royale/${req.params.gameId}`);
});

router.post('/royale/:gameId/guess', ensureAuth, async (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM royale_games WHERE id = ?').get(req.params.gameId);
  if (!game || game.status !== 'active') return res.status(400).json({ error: 'Game not active' });

  const player = db.prepare('SELECT * FROM royale_players WHERE game_id = ? AND user_id = ?').get(req.params.gameId, req.user.id);
  if (!player || player.status !== 'alive') return res.status(403).json({ error: 'Not alive in game' });

  const round = db.prepare('SELECT * FROM royale_rounds WHERE game_id = ? AND round_number = ?').get(req.params.gameId, game.current_round);
  if (!round) return res.status(500).json({ error: 'Round not found' });

  if (new Date() > new Date(round.ends_at)) {
    return res.status(400).json({ error: 'Round time expired' });
  }

  const { guess } = req.body;
  if (!guess || guess.length !== 5) return res.status(400).json({ error: '5-letter guess required' });
  if (!(await isValidWord(guess))) return res.status(400).json({ error: 'Not a valid word' });

  const word = db.prepare('SELECT * FROM daily_words WHERE id = ?').get(round.word_id);
  if (!word) return res.status(500).json({ error: 'Word not found' });

  const guessUpper = guess.toUpperCase();
  const result = getFeedback(guessUpper, word.word);

  db.prepare('INSERT INTO royale_guesses (game_id, round_id, user_id, guess, result_json) VALUES (?, ?, ?, ?, ?)').run(req.params.gameId, round.id, req.user.id, guessUpper, JSON.stringify(result));

  const solved = result.every(r => r.status === 'green');

  res.json({ guess: guessUpper, result, solved });
});

router.post('/royale/:gameId/advance', ensureAuth, (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM royale_games WHERE id = ?').get(req.params.gameId);
  if (!game) return res.status(404).json({ error: 'Not found' });
  if (game.created_by !== req.user.id) return res.status(403).json({ error: 'Only creator can advance' });
  if (game.status !== 'active') return res.status(400).json({ error: 'Game not active' });

  const currentRound = db.prepare('SELECT * FROM royale_rounds WHERE game_id = ? AND round_number = ?').get(req.params.gameId, game.current_round);
  if (!currentRound) return res.status(500).json({ error: 'Round not found' });

  const alivePlayers = db.prepare('SELECT * FROM royale_players WHERE game_id = ? AND status = ?').all(req.params.gameId, 'alive');

  for (const player of alivePlayers) {
    const solved = db.prepare(`
      SELECT id FROM royale_guesses
      WHERE game_id = ? AND round_id = ? AND user_id = ?
      ORDER BY id
    `).get(req.params.gameId, currentRound.id, player.user_id);

    if (!solved) {
      db.prepare('UPDATE royale_players SET status = ?, eliminated_round = ? WHERE game_id = ? AND user_id = ?').run('eliminated', game.current_round, req.params.gameId, player.user_id);
    }
  }

  const remaining = db.prepare('SELECT COUNT(*) as c FROM royale_players WHERE game_id = ? AND status = ?').get(req.params.gameId, 'alive').c;

  if (remaining <= 1) {
    db.prepare('UPDATE royale_games SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?').run('completed', req.params.gameId);
    return res.redirect(`/royale/${req.params.gameId}`);
  }

  const nextRound = game.current_round + 1;
  if (nextRound > 10) {
    db.prepare('UPDATE royale_games SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?').run('completed', req.params.gameId);
    return res.redirect(`/royale/${req.params.gameId}`);
  }

  const nextWord = getWordForRound(db, nextRound);
  if (!nextWord) return res.status(500).json({ error: 'No word available' });

  const now = new Date();
  const endsAt = new Date(now.getTime() + (game.round_time_seconds * 1000));

  db.prepare('INSERT INTO royale_rounds (game_id, round_number, word_id, started_at, ends_at) VALUES (?, ?, ?, ?, ?)').run(req.params.gameId, nextRound, nextWord.id, now.toISOString(), endsAt.toISOString());
  db.prepare('UPDATE royale_games SET current_round = ? WHERE id = ?').run(nextRound, req.params.gameId);

  res.redirect(`/royale/${req.params.gameId}`);
});

module.exports = router;
