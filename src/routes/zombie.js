const express = require('express');
const { getDb } = require('../db/database');
const { ensureAuth } = require('../services/authService');
const { ANSWERS } = require('../data/answers');
const { isValidWord } = require('../services/wordService');
const { broadcast } = require('../ws/wsServer');
const { generateZombieTheme } = require('../services/geminiService');

const router = express.Router();
const PLAYER_COLORS = ['#4a90e2', '#f5a623', '#7ed321', '#9013fe', '#f5426e', '#17b8be'];

const SHOP_ITEMS = {
  extra_guess:  { name: '+1 Guess',       desc: 'One extra guess next round',                          cost: 12, max: 5 },
  guess_burst:  { name: '+3 Guesses',     desc: 'Three extra guesses next round',                     cost: 30, max: 1 },
  scout:        { name: 'Scout',          desc: '1 random letter revealed on 1 zombie next round',    cost: 18, max: 3 },
  sweep:        { name: 'First Letters',  desc: 'First letter of every zombie revealed next round',   cost: 30, max: 1 },
  last_letter:  { name: 'Last Letters',   desc: 'Last letter of every zombie revealed next round',    cost: 28, max: 1 },
  mega_hint:    { name: 'Mega Scout',     desc: '2 random letters on 1 zombie next round',            cost: 35, max: 1 },
  multi_scout:  { name: 'Full Sweep',     desc: '1 random letter on every zombie next round',         cost: 42, max: 1 },
  shield:       { name: 'Horde Shield',   desc: 'One fewer zombie next round (min 1)',                 cost: 38, max: 2 },
  mega_shield:  { name: 'Mega Shield',    desc: 'Two fewer zombies next round (min 1)',                cost: 72, max: 1 },
  safe_guess:   { name: 'Safe Guess',     desc: "First wrong guess next round doesn't count",         cost: 32, max: 1 },
};

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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

// Round N: guesses scale based on host-selected scale
function maxGuessesForRound(n, scale = 'normal') {
  if (scale === 'tight')    return 4 + n;
  if (scale === 'generous') return Math.round(5 + n * 2);
  return Math.round(4 + n * 1.5); // normal
}

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

async function startRound(db, gameId, roundNumber, items = [], themeEnabled = true, guessScale = 'normal') {
  const extraGuesses = items.filter(i => i.type === 'extra_guess').length
    + items.filter(i => i.type === 'guess_burst').length * 3;
  const shieldCount = items.filter(i => i.type === 'shield').length
    + items.filter(i => i.type === 'mega_shield').length * 2;
  const wordCount = Math.max(1, roundNumber - shieldCount);

  let words, theme = null;
  if (themeEnabled) {
    try {
      const generated = await generateZombieTheme(wordCount);
      const valid = await Promise.all(generated.words.map(w => isValidWord(w)));
      if (valid.every(Boolean)) { words = generated.words; theme = generated.theme; }
      else throw new Error('Invalid words from Gemini');
    } catch (err) {
      console.warn('Zombie theme generation failed, falling back:', err.message);
      words = pickWords(db, gameId, wordCount);
    }
  } else {
    words = pickWords(db, gameId, wordCount);
  }

  const maxGuesses = maxGuessesForRound(roundNumber, guessScale) + extraGuesses;
  const safeGuesses = items.filter(i => i.type === 'safe_guess').length;

  // Build hint tiles from items
  const hints = [];

  const scoutCount = items.filter(i => i.type === 'scout').length;
  for (let s = 0; s < scoutCount; s++) {
    const wi = Math.floor(Math.random() * words.length);
    const taken = hints.filter(h => h.wordIndex === wi).map(h => h.tileIndex);
    const avail = [0, 1, 2, 3, 4].filter(p => !taken.includes(p));
    if (avail.length > 0) {
      const ti = avail[Math.floor(Math.random() * avail.length)];
      hints.push({ wordIndex: wi, tileIndex: ti, letter: words[wi][ti] });
    }
  }

  if (items.some(i => i.type === 'sweep')) {
    words.forEach((w, wi) => {
      if (!hints.find(h => h.wordIndex === wi && h.tileIndex === 0))
        hints.push({ wordIndex: wi, tileIndex: 0, letter: w[0] });
    });
  }

  if (items.some(i => i.type === 'last_letter')) {
    words.forEach((w, wi) => {
      if (!hints.find(h => h.wordIndex === wi && h.tileIndex === 4))
        hints.push({ wordIndex: wi, tileIndex: 4, letter: w[4] });
    });
  }

  if (items.some(i => i.type === 'mega_hint')) {
    const wi = Math.floor(Math.random() * words.length);
    const positions = shuffleArray([0, 1, 2, 3, 4]);
    let added = 0;
    for (const ti of positions) {
      if (!hints.find(h => h.wordIndex === wi && h.tileIndex === ti)) {
        hints.push({ wordIndex: wi, tileIndex: ti, letter: words[wi][ti] });
        added++;
        if (added >= 2) break;
      }
    }
  }

  if (items.some(i => i.type === 'multi_scout')) {
    words.forEach((w, wi) => {
      const taken = hints.filter(h => h.wordIndex === wi).map(h => h.tileIndex);
      const avail = [0, 1, 2, 3, 4].filter(p => !taken.includes(p));
      if (avail.length > 0) {
        const ti = avail[Math.floor(Math.random() * avail.length)];
        hints.push({ wordIndex: wi, tileIndex: ti, letter: w[ti] });
      }
    });
  }

  const hintTiles = hints.length > 0 ? JSON.stringify(hints) : null;

  db.prepare('INSERT INTO zombie_rounds (game_id, round_number, words, max_guesses, theme, hint_tiles, safe_guesses) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(gameId, roundNumber, JSON.stringify(words), maxGuesses, theme, hintTiles, safeGuesses);
}

function isLobbyStale(game) {
  return Date.now() - new Date(game.created_at + 'Z').getTime() > 10 * 60 * 1000;
}

function zombieGameState(db, gameId) {
  const game = db.prepare('SELECT * FROM zombie_games WHERE id = ?').get(gameId);
  if (!game) return null;
  const round = db.prepare('SELECT * FROM zombie_rounds WHERE game_id = ? AND round_number = ?').get(gameId, game.current_round);
  const players = db.prepare(`
    SELECT zp.user_id, u.display_name, u.avatar_url
    FROM zombie_players zp JOIN users u ON u.id = zp.user_id WHERE zp.game_id = ? ORDER BY zp.joined_at ASC
  `).all(gameId).map((p, i) => ({ ...p, color: PLAYER_COLORS[i % PLAYER_COLORS.length] }));
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
    coins: game.coins,
    shopItems: JSON.parse(game.shop_items || '[]'),
    round: round ? {
      id: round.id,
      wordCount: JSON.parse(round.words).length,
      maxGuesses: round.max_guesses,
      solvedMask: JSON.parse(round.solved_mask),
      outcome: round.outcome,
      guessCount: guesses.length,
      theme: round.theme || null,
      safeGuesses: round.safe_guesses || 0,
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
  if (game.status === 'waiting' && game.created_by !== req.user.id && isLobbyStale(game)) {
    return res.redirect('/games');
  }
  const players = db.prepare(`
    SELECT zp.*, u.display_name, u.avatar_url
    FROM zombie_players zp JOIN users u ON u.id = zp.user_id
    WHERE zp.game_id = ? ORDER BY zp.joined_at ASC
  `).all(game.id).map((p, i) => ({ ...p, color: PLAYER_COLORS[i % PLAYER_COLORS.length] }));
  const myPlayer = players.find(p => p.user_id === req.user.id) || null;

  let round = null, guesses = [], wordCount = 0, solvedMask = [], revealWords = null, theme = null, hints = [];
  if (game.status !== 'waiting') {
    round = db.prepare('SELECT * FROM zombie_rounds WHERE game_id = ? AND round_number = ?').get(game.id, game.current_round);
    if (round) {
      const words = JSON.parse(round.words);
      wordCount = words.length;
      solvedMask = JSON.parse(round.solved_mask);
      theme = round.theme || null;
      hints = round.hint_tiles ? JSON.parse(round.hint_tiles) : [];
      guesses = db.prepare(`
        SELECT zg.*, u.display_name FROM zombie_guesses zg JOIN users u ON u.id = zg.user_id
        WHERE zg.round_id = ? ORDER BY zg.created_at ASC
      `).all(round.id).map(g => ({ ...g, results: JSON.parse(g.results_json) }));
      if (game.outcome === 'overrun') revealWords = words;
    }
  }

  const canGuess = !!(myPlayer && game.status === 'active' && round && !round.outcome && guesses.length < round.max_guesses);

  const priorRounds = game.status !== 'waiting'
    ? db.prepare(`
        SELECT round_number, words, theme, outcome FROM zombie_rounds
        WHERE game_id = ? AND round_number < ? AND outcome IS NOT NULL
        ORDER BY round_number DESC
      `).all(game.id, game.current_round).map(r => ({
        roundNumber: r.round_number,
        words: JSON.parse(r.words),
        theme: r.theme,
        outcome: r.outcome,
      }))
    : [];

  // Shop state
  const shopSelections = game.status === 'shop' ? JSON.parse(game.shop_selections || '[]') : [];
  const shopItems = JSON.parse(game.shop_items || '[]');
  const shopEarned = req.query.earned ? parseInt(req.query.earned) : null;

  // Friends leaderboard (self + accepted friends)
  const friendIds = db.prepare(`
    SELECT CASE WHEN user_id = ? THEN friend_id ELSE user_id END as id
    FROM friends WHERE (user_id = ? OR friend_id = ?) AND status = 'accepted'
  `).all(req.user.id, req.user.id, req.user.id).map(r => r.id);
  const lbIds = [req.user.id, ...friendIds];
  const leaderboard = db.prepare(`
    SELECT u.id as user_id, u.display_name, u.avatar_url,
           MAX(zg.rounds_survived) as best_waves,
           COUNT(DISTINCT zp.game_id) as games_played
    FROM zombie_players zp
    JOIN zombie_games zg ON zg.id = zp.game_id AND zg.status = 'completed'
    JOIN users u ON u.id = zp.user_id
    WHERE zp.user_id IN (${lbIds.map(() => '?').join(',')})
    GROUP BY zp.user_id
    ORDER BY best_waves DESC
    LIMIT 20
  `).all(...lbIds);

  res.render('zombie_game', {
    title: 'Zombie Horde',
    game, players, myPlayer, round, guesses, wordCount, solvedMask, canGuess, revealWords,
    theme, hints, priorRounds, shopSelections, shopItems, shopEarned, SHOP_ITEMS, leaderboard,
  });
});

// POST /games/zombie/:id/join
router.post('/games/zombie/:id/join', ensureAuth, (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM zombie_games WHERE id = ?').get(req.params.id);
  if (!game || game.status !== 'waiting') return res.redirect('/games');
  db.prepare('INSERT OR IGNORE INTO zombie_players (game_id, user_id) VALUES (?, ?)').run(game.id, req.user.id);
  const players = db.prepare('SELECT zp.user_id, u.display_name, u.avatar_url FROM zombie_players zp JOIN users u ON u.id = zp.user_id WHERE zp.game_id = ? ORDER BY zp.joined_at ASC').all(game.id);
  broadcast('lobby', 'zombie:' + game.id, { players, created_by: game.created_by });
  broadcast('lobby-updates', 'global', { type: 'lobby-changed' });
  res.redirect('/games/zombie/' + game.id);
});

// POST /games/zombie/:id/start
router.post('/games/zombie/:id/start', ensureAuth, async (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM zombie_games WHERE id = ?').get(req.params.id);
  if (!game || game.status !== 'waiting' || game.created_by !== req.user.id) {
    return res.redirect('/games/zombie/' + req.params.id);
  }
  await startRound(db, game.id, 1, [], game.theme_enabled !== 0, game.guess_scale || 'normal');
  db.prepare("UPDATE zombie_games SET status = 'active' WHERE id = ?").run(game.id);
  broadcast('lobby', 'zombie:' + game.id, { status: 'active' });
  broadcast('lobby-updates', 'global', { type: 'lobby-changed' });
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

  // Handle safe guess: wrong guess + safe_guesses remaining → extend max_guesses
  let effectiveMaxGuesses = round.max_guesses;
  let safeGuessUsed = false;
  if (newlySolved.length === 0 && newSolvedMask.length < words.length && round.safe_guesses > 0) {
    safeGuessUsed = true;
    effectiveMaxGuesses++;
    db.prepare('UPDATE zombie_rounds SET safe_guesses = safe_guesses - 1, max_guesses = max_guesses + 1 WHERE id = ?').run(round.id);
  }

  const newGuessCount = guessCount + 1;
  let roundOutcome = null, gameOver = false;

  if (newSolvedMask.length === words.length) {
    roundOutcome = 'survived';
    db.prepare("UPDATE zombie_rounds SET solved_mask = ?, outcome = 'survived' WHERE id = ?").run(JSON.stringify(newSolvedMask), round.id);
    const next = game.current_round + 1;
    const coinsEarned = 10 + Math.max(0, (effectiveMaxGuesses - newGuessCount) * 8);

    if (game.current_round % 2 === 0 && game.shop_enabled !== 0) {
      // Shop time — pick 3 random items to offer
      const shopSelections = shuffleArray(Object.keys(SHOP_ITEMS)).slice(0, 3);
      db.prepare("UPDATE zombie_games SET status = 'shop', current_round = ?, rounds_survived = rounds_survived + 1, coins = coins + ?, shop_selections = ? WHERE id = ?")
        .run(next, coinsEarned, JSON.stringify(shopSelections), game.id);
    } else {
      await startRound(db, game.id, next, [], game.theme_enabled !== 0, game.guess_scale || 'normal');
      db.prepare("UPDATE zombie_games SET current_round = ?, rounds_survived = rounds_survived + 1, coins = coins + ? WHERE id = ?")
        .run(next, coinsEarned, game.id);
    }
  } else if (newGuessCount >= effectiveMaxGuesses) {
    roundOutcome = 'overrun';
    gameOver = true;
    db.prepare("UPDATE zombie_rounds SET solved_mask = ?, outcome = 'overrun' WHERE id = ?").run(JSON.stringify(newSolvedMask), round.id);
    db.prepare("UPDATE zombie_games SET status = 'completed', outcome = 'overrun' WHERE id = ?").run(game.id);
  } else {
    db.prepare('UPDATE zombie_rounds SET solved_mask = ? WHERE id = ?').run(JSON.stringify(newSolvedMask), round.id);
  }

  broadcast('zombie', game.id, zombieGameState(db, game.id));

  res.json({
    ok: true,
    results,
    solvedMask: newSolvedMask,
    newlySolved,
    roundOutcome,
    gameOver,
    guessCount: newGuessCount,
    maxGuesses: effectiveMaxGuesses,
    safeGuessUsed,
    revealWords: gameOver ? words : null,
  });
});

// POST /games/zombie/:id/shop/buy
router.post('/games/zombie/:id/shop/buy', ensureAuth, (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM zombie_games WHERE id = ?').get(req.params.id);
  if (!game || game.status !== 'shop') return res.redirect('/games/zombie/' + req.params.id);
  const myPlayer = db.prepare('SELECT * FROM zombie_players WHERE game_id = ? AND user_id = ?').get(game.id, req.user.id);
  if (!myPlayer) return res.redirect('/games/zombie/' + req.params.id);

  const itemType = req.body.item;
  const shopDef = SHOP_ITEMS[itemType];
  if (!shopDef || game.coins < shopDef.cost) return res.redirect('/games/zombie/' + req.params.id);

  const items = JSON.parse(game.shop_items || '[]');
  if (items.filter(i => i.type === itemType).length >= shopDef.max) return res.redirect('/games/zombie/' + req.params.id);

  items.push({ type: itemType });
  db.prepare('UPDATE zombie_games SET coins = coins - ?, shop_items = ? WHERE id = ?')
    .run(shopDef.cost, JSON.stringify(items), game.id);

  res.redirect('/games/zombie/' + game.id);
});

// POST /games/zombie/:id/shop/continue
router.post('/games/zombie/:id/shop/continue', ensureAuth, async (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM zombie_games WHERE id = ?').get(req.params.id);
  if (!game || game.status !== 'shop') return res.redirect('/games/zombie/' + req.params.id);
  const myPlayer = db.prepare('SELECT * FROM zombie_players WHERE game_id = ? AND user_id = ?').get(game.id, req.user.id);
  if (!myPlayer) return res.redirect('/games/zombie/' + req.params.id);

  const items = JSON.parse(game.shop_items || '[]');
  await startRound(db, game.id, game.current_round, items, game.theme_enabled !== 0, game.guess_scale || 'normal');
  db.prepare("UPDATE zombie_games SET status = 'active', shop_items = '[]', shop_selections = '[]' WHERE id = ?").run(game.id);
  broadcast('zombie', game.id, zombieGameState(db, game.id));
  res.redirect('/games/zombie/' + game.id);
});

// POST /games/zombie/:id/toggle-shop
router.post('/games/zombie/:id/toggle-shop', ensureAuth, (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM zombie_games WHERE id = ?').get(req.params.id);
  if (!game || game.status !== 'waiting' || game.created_by !== req.user.id) {
    return res.redirect('/games/zombie/' + req.params.id);
  }
  const newVal = game.shop_enabled === 0 ? 1 : 0;
  db.prepare('UPDATE zombie_games SET shop_enabled = ? WHERE id = ?').run(newVal, game.id);
  broadcast('lobby', 'zombie:' + game.id, { shop_enabled: newVal });
  res.redirect('/games/zombie/' + req.params.id);
});

// POST /games/zombie/:id/set-guess-scale
router.post('/games/zombie/:id/set-guess-scale', ensureAuth, (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM zombie_games WHERE id = ?').get(req.params.id);
  if (!game || game.status !== 'waiting' || game.created_by !== req.user.id) {
    return res.redirect('/games/zombie/' + req.params.id);
  }
  const scale = ['tight', 'normal', 'generous'].includes(req.body.scale) ? req.body.scale : 'normal';
  db.prepare('UPDATE zombie_games SET guess_scale = ? WHERE id = ?').run(scale, game.id);
  broadcast('lobby', 'zombie:' + game.id, { guess_scale: scale });
  res.redirect('/games/zombie/' + req.params.id);
});

// POST /games/zombie/:id/toggle-theme
router.post('/games/zombie/:id/toggle-theme', ensureAuth, (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM zombie_games WHERE id = ?').get(req.params.id);
  if (!game || game.status !== 'waiting' || game.created_by !== req.user.id) {
    return res.redirect('/games/zombie/' + req.params.id);
  }
  const newVal = game.theme_enabled === 0 ? 1 : 0;
  db.prepare('UPDATE zombie_games SET theme_enabled = ? WHERE id = ?').run(newVal, game.id);
  broadcast('lobby', 'zombie:' + game.id, { theme_enabled: newVal });
  res.redirect('/games/zombie/' + req.params.id);
});

// POST /games/zombie/:id/cancel
router.post('/games/zombie/:id/cancel', ensureAuth, (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM zombie_games WHERE id = ?').get(req.params.id);
  if (!game || game.status !== 'waiting' || game.created_by !== req.user.id) {
    return res.redirect('/games');
  }
  broadcast('lobby', 'zombie:' + game.id, { cancelled: true });
  broadcast('lobby-updates', 'global', { type: 'lobby-changed' });
  db.prepare('DELETE FROM zombie_players WHERE game_id = ?').run(game.id);
  db.prepare('DELETE FROM zombie_games WHERE id = ?').run(game.id);
  res.redirect('/games');
});

module.exports = router;
