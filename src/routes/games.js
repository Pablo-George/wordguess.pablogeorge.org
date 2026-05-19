const express = require('express');
const { getDb } = require('../db/database');
const { ensureAuth } = require('../services/authService');
const { POKEMON_GEN1 } = require('../data/pokemon_gen1');

const router = express.Router();

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

// GET /games
router.get('/games', ensureAuth, (req, res) => {
  const db = getDb();
  const myGames = db.prepare(`
    SELECT pg.*, u.display_name as creator_name,
      (SELECT COUNT(*) FROM pokemon_game_players WHERE game_id = pg.id) as player_count
    FROM pokemon_games pg
    JOIN users u ON u.id = pg.created_by
    JOIN pokemon_game_players pgp ON pgp.game_id = pg.id AND pgp.user_id = ?
    WHERE pg.status != 'completed'
    ORDER BY pg.created_at DESC
    LIMIT 10
  `).all(req.user.id);

  res.render('games', { title: 'Games', myGames });
});

// POST /games/pokemon — create
router.post('/games/pokemon', ensureAuth, (req, res) => {
  const db = getDb();
  const info = db.prepare('INSERT INTO pokemon_games (created_by) VALUES (?)').run(req.user.id);
  db.prepare('INSERT INTO pokemon_game_players (game_id, user_id) VALUES (?, ?)').run(info.lastInsertRowid, req.user.id);
  res.redirect('/games/pokemon/' + info.lastInsertRowid);
});

// GET /games/pokemon/:id
router.get('/games/pokemon/:id', ensureAuth, (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM pokemon_games WHERE id = ?').get(req.params.id);
  if (!game) return res.status(404).send('Game not found');

  const players = db.prepare(`
    SELECT pgp.*, u.display_name, u.avatar_url
    FROM pokemon_game_players pgp
    JOIN users u ON u.id = pgp.user_id
    WHERE pgp.game_id = ?
    ORDER BY pgp.score DESC, pgp.guesses_count ASC, pgp.joined_at ASC
  `).all(game.id);

  const myPlayer = players.find(p => p.user_id === req.user.id);
  const myGuesses = (game.status !== 'waiting' && myPlayer)
    ? db.prepare('SELECT * FROM pokemon_game_guesses WHERE game_id = ? AND user_id = ? ORDER BY created_at ASC').all(game.id, req.user.id)
        .map(r => ({ ...r, result: JSON.parse(r.result_json) }))
    : [];

  const solved = !!(myPlayer && myPlayer.solved);
  const outOfGuesses = !!(myPlayer && !myPlayer.solved && myPlayer.guesses_count >= game.max_guesses);
  const showAnswer = solved || outOfGuesses || game.status === 'completed';

  res.render('pokemon_game', {
    title: 'Pokémon Game',
    game,
    players,
    myPlayer,
    myGuesses,
    solved,
    outOfGuesses,
    maxGuesses: game.max_guesses,
    wordLength: game.word_length || 0,
    answer: showAnswer ? game.pokemon_name : null,
    pokemonIndex: game.pokemon_index,
  });
});

// POST /games/pokemon/:id/join
router.post('/games/pokemon/:id/join', ensureAuth, (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM pokemon_games WHERE id = ?').get(req.params.id);
  if (!game || game.status !== 'waiting') return res.redirect('/games');
  db.prepare('INSERT OR IGNORE INTO pokemon_game_players (game_id, user_id) VALUES (?, ?)').run(game.id, req.user.id);
  res.redirect('/games/pokemon/' + game.id);
});

// POST /games/pokemon/:id/start
router.post('/games/pokemon/:id/start', ensureAuth, (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM pokemon_games WHERE id = ?').get(req.params.id);
  if (!game || game.status !== 'waiting' || game.created_by !== req.user.id) {
    return res.redirect('/games/pokemon/' + req.params.id);
  }

  const { c: playerCount } = db.prepare('SELECT COUNT(*) as c FROM pokemon_game_players WHERE game_id = ?').get(game.id);
  const pokemonIndex = (playerCount - 1) % POKEMON_GEN1.length;
  const pokemonName = POKEMON_GEN1[pokemonIndex];

  db.prepare(`
    UPDATE pokemon_games SET status = 'active', pokemon_name = ?, pokemon_index = ?, word_length = ? WHERE id = ?
  `).run(pokemonName, pokemonIndex, pokemonName.length, game.id);

  res.redirect('/games/pokemon/' + game.id);
});

// POST /games/pokemon/:id/guess
router.post('/games/pokemon/:id/guess', ensureAuth, (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM pokemon_games WHERE id = ?').get(req.params.id);
  if (!game || game.status !== 'active') return res.json({ error: 'Game not active' });

  const myPlayer = db.prepare('SELECT * FROM pokemon_game_players WHERE game_id = ? AND user_id = ?').get(game.id, req.user.id);
  if (!myPlayer) return res.json({ error: 'Not in this game' });
  if (myPlayer.solved) return res.json({ error: 'Already solved!' });
  if (myPlayer.guesses_count >= game.max_guesses) return res.json({ error: 'Out of guesses' });

  const guess = (req.body.guess || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (guess.length !== game.word_length) return res.json({ error: `Must be ${game.word_length} letters` });

  const result = computeFeedback(guess, game.pokemon_name);
  const solved = guess === game.pokemon_name;
  const newCount = myPlayer.guesses_count + 1;
  const score = solved ? Math.max(1, game.max_guesses - newCount + 1) * 100 + game.word_length * 10 : 0;

  db.prepare('INSERT INTO pokemon_game_guesses (game_id, user_id, guess, result_json) VALUES (?, ?, ?, ?)').run(game.id, req.user.id, guess, JSON.stringify(result));
  db.prepare('UPDATE pokemon_game_players SET guesses_count = ?, solved = ?, score = ? WHERE game_id = ? AND user_id = ?').run(newCount, solved ? 1 : 0, score, game.id, req.user.id);

  const { c: remaining } = db.prepare(`
    SELECT COUNT(*) as c FROM pokemon_game_players
    WHERE game_id = ? AND solved = 0 AND guesses_count < ?
  `).get(game.id, game.max_guesses);

  if (remaining === 0) {
    db.prepare("UPDATE pokemon_games SET status = 'completed' WHERE id = ?").run(game.id);
  }

  res.json({ ok: true });
});

module.exports = router;
