const express = require('express');
const { getDb } = require('../db/database');
const { ensureAuth } = require('../services/authService');
const { POKEMON_GEN1 } = require('../data/pokemon_gen1');

// Sorted by name length ascending so more players = longer (harder) name
const POKEMON_BY_LENGTH = [...POKEMON_GEN1].filter(p => p.length >= 5).sort((a, b) => a.length - b.length || a.localeCompare(b));

const router = express.Router();
const LOBBY_STALE_MS = 25000; // 25s — host pings every 10s so 2 missed pings = stale

function isLobbyStale(db, type, gameId) {
  const hb = db.prepare('SELECT last_seen FROM lobby_heartbeats WHERE game_type = ? AND game_id = ?').get(type, gameId);
  if (!hb) return true;
  return Date.now() - new Date(hb.last_seen + 'Z').getTime() > LOBBY_STALE_MS;
}

function cleanStaleLobbies(db) {
  const threshold = "datetime('now', '-25 seconds')";
  [
    { type: 'pokemon',      gameTable: 'pokemon_games',    playerTable: 'pokemon_game_players' },
    { type: 'knockout',     gameTable: 'knockout_games',   playerTable: 'knockout_players' },
    { type: 'animequotes',  gameTable: 'animequote_games', playerTable: 'animequote_players' },
  ].forEach(({ type, gameTable, playerTable }) => {
    const stale = db.prepare(
      `SELECT game_id FROM lobby_heartbeats WHERE game_type = ? AND last_seen < ${threshold}`
    ).all(type).map(r => r.game_id);
    for (const id of stale) {
      const game = db.prepare(`SELECT id FROM ${gameTable} WHERE id = ? AND status = 'waiting'`).get(id);
      if (game) {
        db.prepare(`DELETE FROM ${playerTable} WHERE game_id = ?`).run(id);
        db.prepare(`DELETE FROM ${gameTable} WHERE id = ?`).run(id);
      }
      db.prepare('DELETE FROM lobby_heartbeats WHERE game_type = ? AND game_id = ?').run(type, id);
    }
  });
}

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

function getFriendLobbies(db, userId) {
  const friendIds = db.prepare(`
    SELECT CASE WHEN user_id = ? THEN friend_id ELSE user_id END as id
    FROM friends WHERE (user_id = ? OR friend_id = ?) AND status = 'accepted'
  `).all(userId, userId, userId).map(r => r.id);

  if (friendIds.length === 0) return [];
  const ph = friendIds.map(() => '?').join(',');

  const pokemonLobbies = db.prepare(`
    SELECT pg.id, 'pokemon' as type, u.display_name as host_name, u.avatar_url as host_avatar,
      (SELECT COUNT(*) FROM pokemon_game_players WHERE game_id = pg.id) as player_count,
      NULL as subtitle
    FROM pokemon_games pg
    JOIN users u ON u.id = pg.created_by
    WHERE pg.status = 'waiting' AND pg.created_by IN (${ph})
      AND pg.created_at > datetime('now', '-1 hour')
      AND pg.id NOT IN (SELECT game_id FROM pokemon_game_players WHERE user_id = ?)
    ORDER BY pg.created_at DESC
  `).all(...friendIds, userId);

  const knockoutLobbies = db.prepare(`
    SELECT kg.id, 'knockout' as type, u.display_name as host_name, u.avatar_url as host_avatar,
      (SELECT COUNT(*) FROM knockout_players WHERE game_id = kg.id) as player_count,
      NULL as subtitle
    FROM knockout_games kg
    JOIN users u ON u.id = kg.created_by
    WHERE kg.status = 'waiting' AND kg.created_by IN (${ph})
      AND kg.created_at > datetime('now', '-1 hour')
      AND kg.id NOT IN (SELECT game_id FROM knockout_players WHERE user_id = ?)
    ORDER BY kg.created_at DESC
  `).all(...friendIds, userId);

  const animeLobbies = db.prepare(`
    SELECT ag.id, 'animequotes' as type, u.display_name as host_name, u.avatar_url as host_avatar,
      (SELECT COUNT(*) FROM animequote_players WHERE game_id = ag.id) as player_count,
      ag.anime_name as subtitle
    FROM animequote_games ag
    JOIN users u ON u.id = ag.created_by
    WHERE ag.status = 'waiting' AND ag.created_by IN (${ph})
      AND ag.created_at > datetime('now', '-1 hour')
      AND ag.id NOT IN (SELECT game_id FROM animequote_players WHERE user_id = ?)
    ORDER BY ag.created_at DESC
  `).all(...friendIds, userId);

  return [...pokemonLobbies, ...knockoutLobbies, ...animeLobbies].sort((a, b) => b.id - a.id);
}

// GET /games
router.get('/games', ensureAuth, (req, res) => {
  const db = getDb();
  cleanStaleLobbies(db);
  const openLobbies = getFriendLobbies(db, req.user.id);

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

  res.render('games', { title: 'Games', myGames, openLobbies });
});

// GET /games/lobbies — poll endpoint for live lobby list
router.get('/games/lobbies', ensureAuth, (req, res) => {
  const db = getDb();
  cleanStaleLobbies(db);
  res.json(getFriendLobbies(db, req.user.id));
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
  if (!game) return res.redirect('/games');
  if (game.status === 'waiting' && game.created_by !== req.user.id && isLobbyStale(db, 'pokemon', game.id)) {
    return res.redirect('/games');
  }

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

  const previewLength = POKEMON_BY_LENGTH[Math.min(players.length - 1, POKEMON_BY_LENGTH.length - 1)]?.length || 0;

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
    previewLength,
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
  const pokemonIndex = Math.min(playerCount - 1, POKEMON_BY_LENGTH.length - 1);
  const pokemonName = POKEMON_BY_LENGTH[pokemonIndex];

  db.prepare(`
    UPDATE pokemon_games SET status = 'active', pokemon_name = ?, pokemon_index = ?, word_length = ? WHERE id = ?
  `).run(pokemonName, pokemonIndex, pokemonName.length, game.id);

  res.redirect('/games/pokemon/' + game.id);
});

// POST /games/lobby-ping — host heartbeat for waiting lobbies
router.post('/games/lobby-ping', ensureAuth, (req, res) => {
  const db = getDb();
  const { type, id } = req.body;
  const tables = { pokemon: 'pokemon_games', knockout: 'knockout_games', animequotes: 'animequote_games' };
  if (!tables[type] || !id) return res.json({ ok: false });
  const game = db.prepare(`SELECT * FROM ${tables[type]} WHERE id = ? AND status = 'waiting'`).get(id);
  if (!game || game.created_by !== req.user.id) return res.json({ ok: false });
  db.prepare(`
    INSERT INTO lobby_heartbeats (game_type, game_id, last_seen) VALUES (?, ?, datetime('now'))
    ON CONFLICT (game_type, game_id) DO UPDATE SET last_seen = datetime('now')
  `).run(type, id);
  res.json({ ok: true });
});

// GET /games/pokemon/:id/players — lightweight status poll
router.get('/games/pokemon/:id/players', ensureAuth, (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT status FROM pokemon_games WHERE id = ?').get(req.params.id);
  if (!game) return res.json({ error: 'Not found' });
  const players = db.prepare(`
    SELECT pgp.user_id, u.display_name, pgp.solved, pgp.guesses_count, pgp.score, u.avatar_url
    FROM pokemon_game_players pgp
    JOIN users u ON u.id = pgp.user_id
    WHERE pgp.game_id = ?
    ORDER BY pgp.score DESC, pgp.guesses_count ASC
  `).all(game.id);
  res.json({ status: game.status, players });
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
  if (!POKEMON_GEN1.includes(guess)) return res.json({ error: 'Not a valid Gen 1 Pokémon name' });

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

  const gameCompleted = remaining === 0;
  if (gameCompleted) {
    db.prepare("UPDATE pokemon_games SET status = 'completed' WHERE id = ?").run(game.id);
  }

  const outOfGuesses = !solved && newCount >= game.max_guesses;
  res.json({
    ok: true,
    result,
    solved,
    score,
    guessCount: newCount,
    outOfGuesses,
    gameCompleted,
    answer: (solved || outOfGuesses || gameCompleted) ? game.pokemon_name : null,
  });
});

// POST /games/pokemon/:id/cancel
router.post('/games/pokemon/:id/cancel', ensureAuth, (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM pokemon_games WHERE id = ?').get(req.params.id);
  if (!game || game.status !== 'waiting' || game.created_by !== req.user.id) {
    return res.redirect('/games');
  }
  db.prepare('DELETE FROM pokemon_game_players WHERE game_id = ?').run(game.id);
  db.prepare('DELETE FROM pokemon_games WHERE id = ?').run(game.id);
  res.redirect('/games');
});

module.exports = router;
