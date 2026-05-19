const express = require('express');
const { getDb } = require('../db/database');
const { ensureAuth } = require('../services/authService');
const { generateAnimeQuote } = require('../services/geminiService');

const router = express.Router();
const MAX_GUESSES = 6;

const ANIME_LIST = [
  'Attack on Titan', 'Naruto', 'One Piece', 'Demon Slayer', 'Death Note',
  'Fullmetal Alchemist: Brotherhood', 'My Hero Academia', 'Hunter x Hunter',
  'Dragon Ball Z', 'Jujutsu Kaisen', 'Bleach', 'One Punch Man',
  'Tokyo Ghoul', 'Re:Zero', 'Violet Evergarden', 'Your Lie in April',
  'Steins;Gate', 'Code Geass', 'Cowboy Bebop', 'Neon Genesis Evangelion',
  'Vinland Saga', 'Chainsaw Man', 'Spy × Family', 'Kaguya-sama: Love Is War',
  'No Game No Life', 'Overlord', 'Black Clover', 'Fairy Tail',
  'Sword Art Online', 'Made in Abyss',
];

function targetWordCount(playerCount) {
  const steps = [8, 10, 12, 14, 16, 18, 20];
  return steps[Math.min(playerCount - 1, steps.length - 1)];
}

function processQuote(quoteText) {
  return quoteText
    .split(/\s+/)
    .filter(t => t.length > 0)
    .map((token, index) => {
      const word = token.toUpperCase().replace(/[^A-Z]/g, '');
      if (!word) return null;
      return { word_index: index, word, word_length: word.length, is_given: word.length <= 2 ? 1 : 0 };
    })
    .filter(Boolean);
}

function computeFeedback(guess, answer) {
  const result = [];
  const answerArr = answer.split('');
  const guessArr = guess.split('');
  const used = new Array(answer.length).fill(false);
  for (let i = 0; i < guessArr.length; i++) {
    if (guessArr[i] === answerArr[i]) { result[i] = { letter: guessArr[i], status: 'green' }; used[i] = true; }
    else result[i] = { letter: guessArr[i], status: 'gray' };
  }
  for (let i = 0; i < guessArr.length; i++) {
    if (result[i].status !== 'gray') continue;
    for (let j = 0; j < answerArr.length; j++) {
      if (!used[j] && guessArr[i] === answerArr[j]) { result[i].status = 'yellow'; used[j] = true; break; }
    }
  }
  return result;
}

function checkGameComplete(db, gameId) {
  const pending = db.prepare('SELECT id FROM animequote_words WHERE game_id = ? AND is_given = 0 AND solved = 0 AND revealed = 0').get(gameId);
  if (!pending) db.prepare("UPDATE animequote_games SET status = 'completed' WHERE id = ?").run(gameId);
}

// GET /games/animequotes/new
router.get('/games/animequotes/new', ensureAuth, (req, res) => {
  res.render('animequotes_new', { title: 'Anime Quote', animeList: ANIME_LIST });
});

// POST /games/animequotes
router.post('/games/animequotes', ensureAuth, (req, res) => {
  const animeName = (req.body.anime_name || '').trim().slice(0, 100);
  if (!animeName) return res.redirect('/games/animequotes/new');
  const db = getDb();
  const info = db.prepare('INSERT INTO animequote_games (created_by, anime_name) VALUES (?, ?)').run(req.user.id, animeName);
  db.prepare('INSERT INTO animequote_players (game_id, user_id) VALUES (?, ?)').run(info.lastInsertRowid, req.user.id);
  res.redirect('/games/animequotes/' + info.lastInsertRowid);
});

// GET /games/animequotes/:id
router.get('/games/animequotes/:id', ensureAuth, (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM animequote_games WHERE id = ?').get(req.params.id);
  if (!game) return res.status(404).send('Game not found');

  const players = db.prepare(`
    SELECT aqp.*, u.display_name, u.avatar_url
    FROM animequote_players aqp JOIN users u ON u.id = aqp.user_id
    WHERE aqp.game_id = ? ORDER BY aqp.joined_at ASC
  `).all(game.id);

  const myPlayer = players.find(p => p.user_id === req.user.id) || null;
  const quoteWords = game.status !== 'waiting'
    ? db.prepare('SELECT * FROM animequote_words WHERE game_id = ? ORDER BY word_index ASC').all(game.id)
    : [];

  // Active word: query param, else first unsolved guessable word
  let activeWord = null;
  let activeGuesses = [];

  if (game.status === 'active' || game.status === 'completed') {
    const requestedId = parseInt(req.query.w);
    const guessable = quoteWords.filter(w => !w.is_given);
    activeWord = guessable.find(w => w.id === requestedId)
      || guessable.find(w => !w.solved && !w.revealed)
      || guessable[0]
      || null;

    if (activeWord) {
      activeGuesses = db.prepare('SELECT * FROM animequote_guesses WHERE word_id = ? ORDER BY created_at ASC').all(activeWord.id)
        .map(g => ({ ...g, result: JSON.parse(g.result_json) }));
    }
  }

  const totalGuessable = quoteWords.filter(w => !w.is_given).length;
  const totalSolved = quoteWords.filter(w => w.solved).length;

  res.render('animequotes_game', {
    title: 'Anime Quote',
    game, players, myPlayer, quoteWords,
    activeWord, activeGuesses,
    totalGuessable, totalSolved,
    maxGuesses: MAX_GUESSES,
    animeList: ANIME_LIST,
  });
});

// POST /games/animequotes/:id/join
router.post('/games/animequotes/:id/join', ensureAuth, (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM animequote_games WHERE id = ?').get(req.params.id);
  if (!game || game.status !== 'waiting') return res.redirect('/games');
  db.prepare('INSERT OR IGNORE INTO animequote_players (game_id, user_id) VALUES (?, ?)').run(game.id, req.user.id);
  res.redirect('/games/animequotes/' + game.id);
});

// POST /games/animequotes/:id/start
router.post('/games/animequotes/:id/start', ensureAuth, async (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM animequote_games WHERE id = ?').get(req.params.id);
  if (!game || game.status !== 'waiting' || game.created_by !== req.user.id) {
    return res.redirect('/games/animequotes/' + req.params.id);
  }

  const { c: playerCount } = db.prepare('SELECT COUNT(*) as c FROM animequote_players WHERE game_id = ?').get(game.id);
  const wordTarget = targetWordCount(playerCount);

  try {
    const quote = await generateAnimeQuote(game.anime_name, wordTarget);
    const words = processQuote(quote);

    db.prepare('UPDATE animequote_games SET quote_raw = ?, status = ? WHERE id = ?').run(quote, 'active', game.id);

    const insert = db.prepare('INSERT INTO animequote_words (game_id, word_index, word, word_length, is_given) VALUES (?, ?, ?, ?, ?)');
    for (const w of words) insert.run(game.id, w.word_index, w.word, w.word_length, w.is_given);

    // Mark all given words as solved so completion check works
    db.prepare('UPDATE animequote_words SET solved = 1 WHERE game_id = ? AND is_given = 1').run(game.id);

    checkGameComplete(db, game.id);
  } catch (err) {
    console.error('Gemini error:', err.message);
    return res.status(500).send('Failed to generate quote. Make sure GEMINI_API_KEY is set.');
  }

  res.redirect('/games/animequotes/' + game.id);
});

// POST /games/animequotes/:id/guess
router.post('/games/animequotes/:id/guess', ensureAuth, (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM animequote_games WHERE id = ?').get(req.params.id);
  if (!game || game.status !== 'active') return res.json({ error: 'Game not active' });

  const myPlayer = db.prepare('SELECT * FROM animequote_players WHERE game_id = ? AND user_id = ?').get(game.id, req.user.id);
  if (!myPlayer) return res.json({ error: 'Not in this game' });

  const wordId = parseInt(req.body.word_id);
  const word = db.prepare('SELECT * FROM animequote_words WHERE id = ? AND game_id = ?').get(wordId, game.id);
  if (!word || word.is_given || word.solved || word.revealed) return res.json({ error: 'Word not available' });

  const { c: guessCount } = db.prepare('SELECT COUNT(*) as c FROM animequote_guesses WHERE word_id = ?').get(word.id);
  if (guessCount >= MAX_GUESSES) return res.json({ error: 'Out of guesses for this word' });

  const guess = (req.body.guess || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (guess.length !== word.word_length) return res.json({ error: `Must be ${word.word_length} letters` });

  const result = computeFeedback(guess, word.word);
  const solved = guess === word.word;
  const newCount = guessCount + 1;

  db.prepare('INSERT INTO animequote_guesses (word_id, game_id, user_id, guess, result_json) VALUES (?, ?, ?, ?, ?)').run(word.id, game.id, req.user.id, guess, JSON.stringify(result));

  if (solved) {
    db.prepare('UPDATE animequote_words SET solved = 1 WHERE id = ?').run(word.id);
  } else if (newCount >= MAX_GUESSES) {
    db.prepare('UPDATE animequote_words SET revealed = 1 WHERE id = ?').run(word.id);
  }

  checkGameComplete(db, game.id);
  res.json({ ok: true });
});

router.post('/games/animequotes/:id/cancel', ensureAuth, (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM animequote_games WHERE id = ?').get(req.params.id);
  if (!game || game.status !== 'waiting' || game.created_by !== req.user.id) {
    return res.redirect('/games');
  }
  db.prepare('DELETE FROM animequote_players WHERE game_id = ?').run(game.id);
  db.prepare('DELETE FROM animequote_games WHERE id = ?').run(game.id);
  res.redirect('/games');
});

module.exports = router;
