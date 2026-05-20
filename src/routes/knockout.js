const express = require('express');
const { getDb } = require('../db/database');
const { ensureAuth } = require('../services/authService');
const { ANSWERS } = require('../data/answers');
const { isValidWord } = require('../services/wordService');

const router = express.Router();
const MAX_GUESSES = 6;
const ROUND_MS = 2 * 60 * 1000;

function computeFeedback(guess, answer) {
  const result = [];
  const answerArr = answer.split('');
  const guessArr = guess.split('');
  const used = new Array(answer.length).fill(false);

  for (let i = 0; i < guessArr.length; i++) {
    if (guessArr[i] === answerArr[i]) {
      result[i] = { letter: guessArr[i], status: 'green' };
      used[i] = true;
    } else {
      result[i] = { letter: guessArr[i], status: 'gray' };
    }
  }
  for (let i = 0; i < guessArr.length; i++) {
    if (result[i].status !== 'gray') continue;
    for (let j = 0; j < answerArr.length; j++) {
      if (!used[j] && guessArr[i] === answerArr[j]) {
        result[i].status = 'yellow';
        used[j] = true;
        break;
      }
    }
  }
  return result;
}

function roundScore(guessesUsed, solved) {
  if (!solved) return 0;
  return Math.max(100, (MAX_GUESSES - guessesUsed + 1) * 100);
}

function getRandomWord(db, gameId) {
  const used = new Set(db.prepare('SELECT word FROM knockout_rounds WHERE game_id = ?').all(gameId).map(r => r.word));
  const pool = ANSWERS.filter(w => !used.has(w));
  const list = pool.length > 0 ? pool : ANSWERS;
  return list[Math.floor(Math.random() * list.length)];
}

function endRound(db, game, round) {
  if (round.ended_at) return db.prepare('SELECT * FROM knockout_games WHERE id = ?').get(game.id);

  db.prepare("UPDATE knockout_rounds SET ended_at = datetime('now') WHERE id = ?").run(round.id);

  // Ensure every active player has a round score entry
  const activePlayers = db.prepare("SELECT * FROM knockout_players WHERE game_id = ? AND status = 'active'").all(game.id);
  for (const p of activePlayers) {
    const existing = db.prepare('SELECT id FROM knockout_round_scores WHERE round_id = ? AND user_id = ?').get(round.id, p.user_id);
    if (!existing) {
      const { c } = db.prepare('SELECT COUNT(*) as c FROM knockout_guesses WHERE round_id = ? AND user_id = ?').get(round.id, p.user_id);
      db.prepare('INSERT INTO knockout_round_scores (round_id, game_id, user_id, score, solved, guesses_count) VALUES (?, ?, ?, 0, 0, ?)').run(round.id, game.id, p.user_id, c);
    }
  }

  // Add round scores to cumulative totals
  for (const p of activePlayers) {
    const rs = db.prepare('SELECT score FROM knockout_round_scores WHERE round_id = ? AND user_id = ?').get(round.id, p.user_id);
    db.prepare('UPDATE knockout_players SET total_score = total_score + ? WHERE game_id = ? AND user_id = ?').run(rs ? rs.score : 0, game.id, p.user_id);
  }

  // Eliminate player(s) with the lowest round score
  const scores = db.prepare('SELECT user_id, score FROM knockout_round_scores WHERE round_id = ? ORDER BY score ASC').all(round.id);
  if (scores.length > 1) {
    const minScore = scores[0].score;
    const losers = scores.filter(s => s.score === minScore);
    // Only eliminate if it leaves at least one player standing
    if (losers.length < scores.length) {
      for (const loser of losers) {
        db.prepare("UPDATE knockout_players SET status = 'eliminated', eliminated_round = ? WHERE game_id = ? AND user_id = ?").run(game.current_round, game.id, loser.user_id);
      }
    }
    // If everyone tied (all 0 points), no one is eliminated — round just advances
  }

  const remaining = db.prepare("SELECT * FROM knockout_players WHERE game_id = ? AND status = 'active'").all(game.id);

  if (remaining.length <= 1) {
    const winnerId = remaining.length === 1 ? remaining[0].user_id : null;
    db.prepare("UPDATE knockout_games SET status = 'completed', winner_id = ? WHERE id = ?").run(winnerId, game.id);
  } else {
    const nextWord = getRandomWord(db, game.id);
    const nextRound = game.current_round + 1;
    const nextEndsAt = new Date(Date.now() + ROUND_MS).toISOString();
    db.prepare('INSERT INTO knockout_rounds (game_id, round_number, word) VALUES (?, ?, ?)').run(game.id, nextRound, nextWord);
    db.prepare('UPDATE knockout_games SET current_round = ?, round_ends_at = ? WHERE id = ?').run(nextRound, nextEndsAt, game.id);
  }

  return db.prepare('SELECT * FROM knockout_games WHERE id = ?').get(game.id);
}

function advanceIfExpired(db, game) {
  if (game.status !== 'active' || !game.round_ends_at) return game;
  if (new Date() <= new Date(game.round_ends_at)) return game;
  const round = db.prepare('SELECT * FROM knockout_rounds WHERE game_id = ? AND round_number = ?').get(game.id, game.current_round);
  if (!round || round.ended_at) return db.prepare('SELECT * FROM knockout_games WHERE id = ?').get(game.id);
  return endRound(db, game, round);
}

// GET /games/knockout/:id
function isLobbyStale(db, gameId) {
  const hb = db.prepare("SELECT last_seen FROM lobby_heartbeats WHERE game_type = 'knockout' AND game_id = ?").get(gameId);
  if (!hb) return true;
  return Date.now() - new Date(hb.last_seen + 'Z').getTime() > 25000;
}

router.get('/games/knockout/:id', ensureAuth, (req, res) => {
  const db = getDb();
  let game = db.prepare('SELECT * FROM knockout_games WHERE id = ?').get(req.params.id);
  if (!game) return res.redirect('/games');
  if (game.status === 'waiting' && game.created_by !== req.user.id && isLobbyStale(db, game.id)) {
    return res.redirect('/games');
  }

  game = advanceIfExpired(db, game);

  const players = db.prepare(`
    SELECT kp.*, u.display_name, u.avatar_url
    FROM knockout_players kp JOIN users u ON u.id = kp.user_id
    WHERE kp.game_id = ?
    ORDER BY kp.total_score DESC, kp.joined_at ASC
  `).all(game.id);

  const myPlayer = players.find(p => p.user_id === req.user.id) || null;

  let currentRound = null;
  let myGuesses = [];
  let myRoundScore = null;
  let prevRoundResults = null;

  if (game.status === 'active' || game.status === 'completed') {
    currentRound = db.prepare('SELECT * FROM knockout_rounds WHERE game_id = ? AND round_number = ?').get(game.id, game.current_round);

    if (currentRound && myPlayer) {
      myGuesses = db.prepare('SELECT * FROM knockout_guesses WHERE round_id = ? AND user_id = ? ORDER BY created_at ASC').all(currentRound.id, req.user.id)
        .map(g => ({ ...g, result: JSON.parse(g.result_json) }));
      myRoundScore = db.prepare('SELECT * FROM knockout_round_scores WHERE round_id = ? AND user_id = ?').get(currentRound.id, req.user.id);
    }

    if (game.current_round > 1) {
      const prevRound = db.prepare('SELECT * FROM knockout_rounds WHERE game_id = ? AND round_number = ?').get(game.id, game.current_round - 1);
      if (prevRound) {
        prevRoundResults = {
          word: prevRound.word,
          roundNumber: prevRound.round_number,
          scores: db.prepare(`
            SELECT krs.*, u.display_name
            FROM knockout_round_scores krs JOIN users u ON u.id = krs.user_id
            WHERE krs.round_id = ? ORDER BY krs.score DESC
          `).all(prevRound.id),
          eliminated: players.filter(p => p.eliminated_round === prevRound.round_number),
        };
      }
    }
  }

  const mySolved = !!(myRoundScore && myRoundScore.solved);
  const myDone = mySolved || !!(myRoundScore && !myRoundScore.solved);
  const isEliminated = !!(myPlayer && myPlayer.status === 'eliminated');

  res.render('knockout_game', {
    title: 'Knockout',
    game,
    players,
    myPlayer,
    currentRound,
    myGuesses,
    myRoundScore,
    mySolved,
    myDone,
    isEliminated,
    prevRoundResults,
    maxGuesses: MAX_GUESSES,
  });
});

// POST /games/knockout
router.post('/games/knockout', ensureAuth, (req, res) => {
  const db = getDb();
  const info = db.prepare('INSERT INTO knockout_games (created_by) VALUES (?)').run(req.user.id);
  db.prepare('INSERT INTO knockout_players (game_id, user_id) VALUES (?, ?)').run(info.lastInsertRowid, req.user.id);
  res.redirect('/games/knockout/' + info.lastInsertRowid);
});

// POST /games/knockout/:id/join
router.post('/games/knockout/:id/join', ensureAuth, (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM knockout_games WHERE id = ?').get(req.params.id);
  if (!game || game.status !== 'waiting') return res.redirect('/games');
  db.prepare('INSERT OR IGNORE INTO knockout_players (game_id, user_id) VALUES (?, ?)').run(game.id, req.user.id);
  res.redirect('/games/knockout/' + game.id);
});

// POST /games/knockout/:id/start
router.post('/games/knockout/:id/start', ensureAuth, (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM knockout_games WHERE id = ?').get(req.params.id);
  if (!game || game.status !== 'waiting' || game.created_by !== req.user.id) {
    return res.redirect('/games/knockout/' + req.params.id);
  }
  const { c: playerCount } = db.prepare('SELECT COUNT(*) as c FROM knockout_players WHERE game_id = ?').get(game.id);
  if (playerCount < 2) return res.redirect('/games/knockout/' + req.params.id);
  const word = getRandomWord(db, game.id);
  const endsAt = new Date(Date.now() + ROUND_MS).toISOString();
  db.prepare('INSERT INTO knockout_rounds (game_id, round_number, word) VALUES (?, 1, ?)').run(game.id, word);
  db.prepare("UPDATE knockout_games SET status = 'active', current_round = 1, round_ends_at = ? WHERE id = ?").run(endsAt, game.id);
  res.redirect('/games/knockout/' + game.id);
});

// POST /games/knockout/:id/guess
router.post('/games/knockout/:id/guess', ensureAuth, async (req, res) => {
  const db = getDb();
  let game = db.prepare('SELECT * FROM knockout_games WHERE id = ?').get(req.params.id);
  if (!game) return res.json({ error: 'Game not found' });

  game = advanceIfExpired(db, game);
  if (game.status !== 'active') return res.json({ error: 'Round has ended' });

  const myPlayer = db.prepare('SELECT * FROM knockout_players WHERE game_id = ? AND user_id = ?').get(game.id, req.user.id);
  if (!myPlayer || myPlayer.status === 'eliminated') return res.json({ error: 'You are eliminated' });

  const round = db.prepare('SELECT * FROM knockout_rounds WHERE game_id = ? AND round_number = ?').get(game.id, game.current_round);
  if (!round || round.ended_at) return res.json({ error: 'Round has ended' });
  if (new Date() > new Date(game.round_ends_at)) return res.json({ error: "Time's up!" });

  const existingScore = db.prepare('SELECT * FROM knockout_round_scores WHERE round_id = ? AND user_id = ?').get(round.id, req.user.id);
  if (existingScore) return res.json({ error: existingScore.solved ? 'Already solved!' : 'Out of guesses' });

  const { c: guessCount } = db.prepare('SELECT COUNT(*) as c FROM knockout_guesses WHERE round_id = ? AND user_id = ?').get(round.id, req.user.id);
  if (guessCount >= MAX_GUESSES) return res.json({ error: 'Out of guesses' });

  const guess = (req.body.guess || '').toUpperCase().trim();
  if (!/^[A-Z]{5}$/.test(guess)) return res.json({ error: 'Must be a 5-letter word' });
  if (!(await isValidWord(guess))) return res.json({ error: 'Not a valid word' });

  const result = computeFeedback(guess, round.word);
  const solved = guess === round.word;
  const newCount = guessCount + 1;

  db.prepare('INSERT INTO knockout_guesses (round_id, game_id, user_id, guess, result_json) VALUES (?, ?, ?, ?, ?)').run(round.id, game.id, req.user.id, guess, JSON.stringify(result));

  if (solved || newCount >= MAX_GUESSES) {
    const score = roundScore(newCount, solved);
    db.prepare('INSERT INTO knockout_round_scores (round_id, game_id, user_id, score, solved, guesses_count) VALUES (?, ?, ?, ?, ?, ?)').run(round.id, game.id, req.user.id, score, solved ? 1 : 0, newCount);

    // If all active players are done, end the round early
    const activePlayers = db.prepare("SELECT user_id FROM knockout_players WHERE game_id = ? AND status = 'active'").all(game.id);
    const allDone = activePlayers.every(p => db.prepare('SELECT id FROM knockout_round_scores WHERE round_id = ? AND user_id = ?').get(round.id, p.user_id));
    if (allDone) endRound(db, game, round);
  }

  res.json({ ok: true });
});

router.post('/games/knockout/:id/cancel', ensureAuth, (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM knockout_games WHERE id = ?').get(req.params.id);
  if (!game || game.status !== 'waiting' || game.created_by !== req.user.id) {
    return res.redirect('/games');
  }
  db.prepare('DELETE FROM knockout_players WHERE game_id = ?').run(game.id);
  db.prepare('DELETE FROM knockout_games WHERE id = ?').run(game.id);
  res.redirect('/games');
});

module.exports = router;
