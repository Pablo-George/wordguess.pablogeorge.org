const express = require('express');
const { getDb } = require('../db/database');
const { getDailyWord, isValidWord } = require('../services/wordService');
const { getFeedback } = require('../services/feedbackService');
const { scoreDaily } = require('../services/scoringService');
const { ensureAuth } = require('../services/authService');

const router = express.Router();

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

router.get('/daily', ensureAuth, (req, res) => {
  const db = getDb();
  const puzzleDate = todayStr();
  const word = getDailyWord(puzzleDate);
  if (!word) return res.status(500).send('No word available');

  const attempt = db.prepare('SELECT * FROM daily_attempts WHERE user_id = ? AND puzzle_date = ?').get(req.user.id, puzzleDate);
  const guesses = attempt
    ? db.prepare('SELECT * FROM daily_guesses WHERE attempt_id = ? ORDER BY guess_number').all(attempt.id)
    : [];

  const feedbackResults = guesses.map(g => ({
    guess: g.guess,
    result: JSON.parse(g.result_json),
  }));

  res.render('daily', {
    wordLength: word.word_length,
    maxGuesses: 6,
    attempt,
    guesses: feedbackResults,
    solved: attempt ? attempt.solved : false,
    puzzleDate,
    answer: word.word,
  });
});

router.post('/daily/guess', ensureAuth, async (req, res) => {
  const db = getDb();
  const puzzleDate = todayStr();
  const { guess } = req.body;

  if (!guess || guess.length !== 5) {
    return res.status(400).json({ error: 'Guess must be 5 letters' });
  }

  const word = getDailyWord(puzzleDate);
  if (!word) return res.status(500).json({ error: 'No word available' });

  let attempt = db.prepare('SELECT * FROM daily_attempts WHERE user_id = ? AND puzzle_date = ?').get(req.user.id, puzzleDate);

  if (attempt && attempt.solved) {
    return res.status(400).json({ error: 'Already solved today' });
  }

  if (!(await isValidWord(guess))) {
    return res.status(400).json({ error: 'Not a valid word' });
  }

  const guessUpper = guess.toUpperCase();
  const currentGuesses = attempt
    ? db.prepare('SELECT COUNT(*) as c FROM daily_guesses WHERE attempt_id = ?').get(attempt.id).c
    : 0;

  if (currentGuesses >= 6) {
    return res.status(400).json({ error: 'No guesses remaining' });
  }

  const guessNumber = currentGuesses + 1;
  const result = getFeedback(guessUpper, word.word);

  if (!attempt) {
    const info = db.prepare('INSERT INTO daily_attempts (user_id, puzzle_date) VALUES (?, ?)').run(req.user.id, puzzleDate);
    attempt = { id: info.lastInsertRowid, user_id: req.user.id, puzzle_date: puzzleDate, solved: 0, guesses_count: 0, score: 0 };
  }

  db.prepare('INSERT INTO daily_guesses (attempt_id, guess_number, guess, result_json) VALUES (?, ?, ?, ?)').run(attempt.id, guessNumber, guessUpper, JSON.stringify(result));

  const solved = result.every(r => r.status === 'green');
  const score = solved ? scoreDaily(guessNumber, true) : 0;

  db.prepare('UPDATE daily_attempts SET guesses_count = ?, solved = ?, score = ?, completed_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id = ?').run(guessNumber, solved ? 1 : 0, score, solved ? 1 : 0, attempt.id);

  res.json({ guess: guessUpper, result, solved, guessNumber, score, remainingGuesses: 6 - guessNumber });
});

module.exports = router;
