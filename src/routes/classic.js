const express = require('express');
const { getDb } = require('../db/database');
const { isValidWord } = require('../services/wordService');
const { getFeedback } = require('../services/feedbackService');
const { scoreDaily } = require('../services/scoringService');
const { ensureAuth } = require('../services/authService');
const { ANSWERS } = require('../data/answers');

const router = express.Router();
const MAX_GUESSES = 6;

function pickWord(userId) {
  const db = getDb();
  const recent = db.prepare(
    "SELECT word FROM classic_games WHERE user_id = ? ORDER BY created_at DESC LIMIT 20"
  ).all(userId).map(r => r.word);
  const pool = ANSWERS.filter(w => !recent.includes(w));
  const source = pool.length > 0 ? pool : ANSWERS;
  return source[Math.floor(Math.random() * source.length)];
}

function getStats(userId) {
  const db = getDb();
  const games = db.prepare(
    "SELECT status FROM classic_games WHERE user_id = ? AND status != 'active' ORDER BY created_at ASC"
  ).all(userId);

  let bestStreak = 0, cur = 0;
  for (const g of games) {
    cur = g.status === 'won' ? cur + 1 : 0;
    if (cur > bestStreak) bestStreak = cur;
  }

  let streak = 0;
  for (let i = games.length - 1; i >= 0; i--) {
    if (games[i].status === 'won') streak++;
    else break;
  }

  const won = games.filter(g => g.status === 'won').length;
  return {
    total: games.length,
    won,
    streak,
    bestStreak,
    winRate: games.length > 0 ? Math.round(won / games.length * 100) : 0,
  };
}

router.get('/classic', ensureAuth, (req, res) => {
  const db = getDb();
  let game = db.prepare(
    "SELECT * FROM classic_games WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1"
  ).get(req.user.id);

  if (!game) {
    const word = pickWord(req.user.id);
    const info = db.prepare('INSERT INTO classic_games (user_id, word) VALUES (?, ?)').run(req.user.id, word);
    game = db.prepare('SELECT * FROM classic_games WHERE id = ?').get(info.lastInsertRowid);
  }

  const guesses = db.prepare(
    'SELECT * FROM classic_guesses WHERE game_id = ? ORDER BY guess_number'
  ).all(game.id).map(g => ({ ...g, result: JSON.parse(g.result_json) }));

  res.render('classic_game', {
    title: 'Classic',
    game,
    guesses,
    maxGuesses: MAX_GUESSES,
    stats: getStats(req.user.id),
    answer: game.status !== 'active' ? game.word : null,
  });
});

router.post('/classic/guess', ensureAuth, async (req, res) => {
  const db = getDb();
  const game = db.prepare(
    "SELECT * FROM classic_games WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1"
  ).get(req.user.id);

  if (!game) return res.json({ error: 'No active game' });

  const guess = (req.body.guess || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (guess.length !== 5) return res.json({ error: 'Guess must be 5 letters' });

  const currentCount = db.prepare(
    'SELECT COUNT(*) as c FROM classic_guesses WHERE game_id = ?'
  ).get(game.id).c;
  if (currentCount >= MAX_GUESSES) return res.json({ error: 'No guesses remaining' });

  if (!(await isValidWord(guess))) return res.json({ error: 'Not a valid word' });

  const result = getFeedback(guess, game.word);
  const guessNumber = currentCount + 1;

  db.prepare(
    'INSERT INTO classic_guesses (game_id, guess_number, guess, result_json) VALUES (?, ?, ?, ?)'
  ).run(game.id, guessNumber, guess, JSON.stringify(result));

  const solved = result.every(r => r.status === 'green');
  const outOfGuesses = !solved && guessNumber >= MAX_GUESSES;
  const score = solved ? scoreDaily(guessNumber, true) : 0;

  if (solved || outOfGuesses) {
    db.prepare(
      "UPDATE classic_games SET status = ?, guesses_count = ?, score = ?, completed_at = datetime('now') WHERE id = ?"
    ).run(solved ? 'won' : 'lost', guessNumber, score, game.id);
  } else {
    db.prepare('UPDATE classic_games SET guesses_count = ? WHERE id = ?').run(guessNumber, game.id);
  }

  res.json({
    ok: true,
    result,
    solved,
    outOfGuesses,
    guessNumber,
    score,
    answer: (solved || outOfGuesses) ? game.word : null,
    stats: (solved || outOfGuesses) ? getStats(req.user.id) : null,
  });
});

router.post('/classic/new', ensureAuth, (req, res) => {
  const db = getDb();
  db.prepare(
    "UPDATE classic_games SET status = 'lost', completed_at = datetime('now') WHERE user_id = ? AND status = 'active'"
  ).run(req.user.id);
  res.redirect('/classic');
});

module.exports = router;
