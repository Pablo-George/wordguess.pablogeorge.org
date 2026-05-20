const express = require('express');
const { getDb } = require('../db/database');
const { ensureAuth } = require('../services/authService');
const { ANSWERS } = require('../data/answers');
const { isValidWord } = require('../services/wordService');
const { publish, subscribe } = require('../services/gameEvents');

const router = express.Router();

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

// Round N: N zombies, 5+N guesses (round 1 = 6, round 2 = 7, …)
function maxGuessesForRound(n) { return 5 + n; }

function pickWords(db, gameId, count) {
  const used = new Set(
    db.prepare('SELECT words FROM zombie_rounds WHERE game_id = ?').all(gameId)
      .flatMap(r => JSON.parse(r.words))
  );
  const pool = ANSWERS.filter(w => !used.has(w));
  const src = pool.length >= count ? pool : [...ANSWERS];
  const out = [];
  const avail = [...src];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(Math.random() * avail.length);
    out.push(avail.splice(idx, 1)[0]);
  }
  return out;
}

function startRound(db, gameId, roundNumber) {
  const words = pickWords(db, gameId, roundNumber);
  db.prepare('INSERT INTO zombie_rounds (game_id, round_number, words, max_guesses) VALUES (?, ?, ?, ?)')
    .run(gameId, roundNumber, JSON.stringify(words), maxGuessesForRound(roundNumber));
}

function isLobbyStale(db, gameId) {
  const hb = db.prepare("SELECT last_seen FROM lobby_heartbeats WHERE game_type = 'zombie' AND game_id = ?").get(gameId);
  if (!hb) return true;
  return Date.now() - new Date(hb.last_seen + 'Z').getTime() > 25000;
}

function zombieGameState(db, gameId) {
  const game = db.prepare('SELECT * FROM zombie_games WHERE id = ?').get(gameId);
  if (!game) return null;
  const round = db.prepare('SELECT * FROM zombie_rounds WHERE game_id = ? AND round_number = ?').get(gameId, game.current_round);
  const players = db.prepare(`
    SELECT zp.user_id, u.display_name, u.avatar_url
    FROM zombie_players zp JOIN users u ON u.id = zp.user_id WHERE zp.game_id = ?
  `).all(gameId);
  let guesses = [], revealWords = null;
  if (round) {
    guesses = db.prepare(`
      SELECT zg.guess, zg.results_json, zg.user_id, u.display_name
      FROM zombie_guesses zg JOIN users u ON u.id = zg.user_id
      WHERE zg.round_id = ? ORDER BY zg.created_at ASC
    `).all(round.id).map(g => ({ guess: g.guess, results: JSON.parse(g.results_json), userId: g.user_id, displayName: g.display_name }));
    if (game.outcome === 'overrun') revealWords = JSON.parse(round.words);
  }
  return {
    status: game.status,
    currentRound: game.current_round,
    roundsSurvived: game.rounds_survived,
    outcome: game.outcome,
    round: round ? {
      id: round.id,
      wordCount: JSON.parse(round.words).length,
      maxGuesses: round.max_guesses,
      solvedMask: JSON.parse(round.solved_mask),
      outcome: round.outcome,
      guessCount: guesses.length,
    } : null,
    guesses,
    players,
    revealWords,
  };
}

// POST /games/zombie
router.post('/games/zombie', ensureAuth, (req, res) => {
  const db = getDb();
  const info = db.prepare('INSERT INTO zombie_games (created_by) VALUES (?)').run(req.user.id);
  db.prepare('INSERT INTO zombie_players (game_id, user_id) VALUES (?, ?)').run(info.lastInsertRowid, req.user.id);
  res.redirect('/games/zombie/' + info.lastInsertRowid);
});

// GET /games/zombie/:id
router.get('/games/zombie/:id', ensureAuth, (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM zombie_games WHERE id = ?').get(req.params.id);
  if (!game) return res.redirect('/games');
  if (game.status === 'waiting' && game.created_by !== req.user.id && isLobbyStale(db, game.id)) {
    return res.redirect('/games');
  }
  const players = db.prepare(`
    SELECT zp.*, u.display_name, u.avatar_url
    FROM zombie_players zp JOIN users u ON u.id = zp.user_id
    WHERE zp.game_id = ? ORDER BY zp.joined_at ASC
  `).all(game.id);
  const myPlayer = players.find(p => p.user_id === req.user.id) || null;

  let round = null, guesses = [], wordCount = 0, solvedMask = [], revealWords = null;
  if (game.status !== 'waiting') {
    round = db.prepare('SELECT * FROM zombie_rounds WHERE game_id = ? AND round_number = ?').get(game.id, game.current_round);
    if (round) {
      const words = JSON.parse(round.words);
      wordCount = words.length;
      solvedMask = JSON.parse(round.solved_mask);
      guesses = db.prepare(`
        SELECT zg.*, u.display_name FROM zombie_guesses zg JOIN users u ON u.id = zg.user_id
        WHERE zg.round_id = ? ORDER BY zg.created_at ASC
      `).all(round.id).map(g => ({ ...g, results: JSON.parse(g.results_json) }));
      if (game.outcome === 'overrun') revealWords = words;
    }
  }

  const canGuess = !!(myPlayer && game.status === 'active' && round && !round.outcome && guesses.length < round.max_guesses);

  res.render('zombie_game', {
    title: 'Zombie Horde',
    game, players, myPlayer, round, guesses, wordCount, solvedMask, canGuess, revealWords,
  });
});

// POST /games/zombie/:id/join
router.post('/games/zombie/:id/join', ensureAuth, (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM zombie_games WHERE id = ?').get(req.params.id);
  if (!game || game.status !== 'waiting') return res.redirect('/games');
  db.prepare('INSERT OR IGNORE INTO zombie_players (game_id, user_id) VALUES (?, ?)').run(game.id, req.user.id);
  res.redirect('/games/zombie/' + game.id);
});

// POST /games/zombie/:id/start
router.post('/games/zombie/:id/start', ensureAuth, (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM zombie_games WHERE id = ?').get(req.params.id);
  if (!game || game.status !== 'waiting' || game.created_by !== req.user.id) {
    return res.redirect('/games/zombie/' + req.params.id);
  }
  startRound(db, game.id, 1);
  db.prepare("UPDATE zombie_games SET status = 'active' WHERE id = ?").run(game.id);
  res.redirect('/games/zombie/' + game.id);
});

// POST /games/zombie/:id/guess
router.post('/games/zombie/:id/guess', ensureAuth, async (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM zombie_games WHERE id = ?').get(req.params.id);
  if (!game || game.status !== 'active') return res.json({ error: 'Game not active' });

  const myPlayer = db.prepare('SELECT * FROM zombie_players WHERE game_id = ? AND user_id = ?').get(game.id, req.user.id);
  if (!myPlayer) return res.json({ error: 'Not in this game' });

  const round = db.prepare('SELECT * FROM zombie_rounds WHERE game_id = ? AND round_number = ?').get(game.id, game.current_round);
  if (!round || round.outcome) return res.json({ error: 'Round not active' });

  const { c: guessCount } = db.prepare('SELECT COUNT(*) as c FROM zombie_guesses WHERE round_id = ?').get(round.id);
  if (guessCount >= round.max_guesses) return res.json({ error: 'No guesses remaining' });

  const guess = (req.body.guess || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (guess.length !== 5) return res.json({ error: 'Must be a 5-letter word' });

  const dupe = db.prepare('SELECT id FROM zombie_guesses WHERE round_id = ? AND guess = ?').get(round.id, guess);
  if (dupe) return res.json({ error: 'Already tried that word this round' });

  if (!(await isValidWord(guess))) return res.json({ error: 'Not a valid word' });

  const words = JSON.parse(round.words);
  const solvedMask = JSON.parse(round.solved_mask);

  const results = words.map((word, i) =>
    solvedMask.includes(i)
      ? word.split('').map(letter => ({ letter, status: 'green' }))
      : computeFeedback(guess, word)
  );

  const newlySolved = words.reduce((acc, word, i) => {
    if (!solvedMask.includes(i) && guess === word) acc.push(i);
    return acc;
  }, []);
  const newSolvedMask = [...solvedMask, ...newlySolved];

  db.prepare('INSERT INTO zombie_guesses (game_id, round_id, user_id, guess, results_json) VALUES (?, ?, ?, ?, ?)')
    .run(game.id, round.id, req.user.id, guess, JSON.stringify(results));

  const newGuessCount = guessCount + 1;
  let roundOutcome = null, gameOver = false;

  if (newSolvedMask.length === words.length) {
    roundOutcome = 'survived';
    db.prepare("UPDATE zombie_rounds SET solved_mask = ?, outcome = 'survived' WHERE id = ?").run(JSON.stringify(newSolvedMask), round.id);
    const next = game.current_round + 1;
    startRound(db, game.id, next);
    db.prepare('UPDATE zombie_games SET current_round = ?, rounds_survived = rounds_survived + 1 WHERE id = ?').run(next, game.id);
  } else if (newGuessCount >= round.max_guesses) {
    roundOutcome = 'overrun';
    gameOver = true;
    db.prepare("UPDATE zombie_rounds SET solved_mask = ?, outcome = 'overrun' WHERE id = ?").run(JSON.stringify(newSolvedMask), round.id);
    db.prepare("UPDATE zombie_games SET status = 'completed', outcome = 'overrun' WHERE id = ?").run(game.id);
  } else {
    db.prepare('UPDATE zombie_rounds SET solved_mask = ? WHERE id = ?').run(JSON.stringify(newSolvedMask), round.id);
  }

  publish('zombie:' + game.id, zombieGameState(db, game.id));

  res.json({
    ok: true,
    results,
    solvedMask: newSolvedMask,
    newlySolved,
    roundOutcome,
    gameOver,
    guessCount: newGuessCount,
    maxGuesses: round.max_guesses,
    revealWords: gameOver ? words : null,
  });
});

// GET /games/zombie/:id/events
router.get('/games/zombie/:id/events', ensureAuth, (req, res) => {
  const db = getDb();
  const gameId = parseInt(req.params.id);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const state = zombieGameState(db, gameId);
  if (state) send(state);
  const unsub = subscribe('zombie:' + gameId, data => send(data));
  req.on('close', unsub);
});

// POST /games/zombie/:id/cancel
router.post('/games/zombie/:id/cancel', ensureAuth, (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM zombie_games WHERE id = ?').get(req.params.id);
  if (!game || game.status !== 'waiting' || game.created_by !== req.user.id) {
    return res.redirect('/games');
  }
  db.prepare('DELETE FROM zombie_players WHERE game_id = ?').run(game.id);
  db.prepare('DELETE FROM zombie_games WHERE id = ?').run(game.id);
  res.redirect('/games');
});

module.exports = router;
