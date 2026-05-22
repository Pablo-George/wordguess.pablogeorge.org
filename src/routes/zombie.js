const express = require('express');
const { getDb } = require('../db/database');
const { ensureAuth } = require('../services/authService');
const { ANSWERS } = require('../data/answers');
const { WORDS_6, WORDS_7, WORDS_8 } = require('../data/longer_words');
const { isValidWord } = require('../services/wordService');
const { broadcast } = require('../ws/wsServer');
const { generateZombieTheme } = require('../services/geminiService');

const router = express.Router();
const PLAYER_COLORS = ['#4a90e2', '#f5a623', '#7ed321', '#9013fe', '#f5426e', '#17b8be'];
const ADMIN_EMAIL = 'pablogeorgeporras@yahoo.com';

const SHOP_ITEMS = {
  extra_guess:   { name: '+1 Guess',      desc: 'Passive — permanently +1 guess every wave',                  cost: 12, max: 5, passive: true },
  shield:        { name: 'Horde Shield',  desc: 'Passive — permanently one fewer zombie every wave (min 1)',   cost: 38, max: 2, passive: true },
  eagle_eye:     { name: 'Eagle Eye',     desc: 'Passive — reveals 1 free random letter per zombie each wave', cost: 25, max: 3, passive: true },
  tough:         { name: 'Tough',         desc: 'Passive — +1 safe guess per wave (wrong guess forgiven)',     cost: 20, max: 3, passive: true },
  scavenger:     { name: 'Scavenger',     desc: 'Passive — +10 bonus coins whenever you survive a wave',       cost: 30, max: 3, passive: true },
  guess_burst:   { name: '+3 Guesses',    desc: 'Bag — use mid-round to add 3 extra guesses right now',       cost: 30, max: 1 },
  medkit:        { name: 'Medkit',        desc: 'Bag — adds 2 extra guesses right now',                       cost: 10, max: 3 },
  safe_guess:    { name: 'Safe Guess',    desc: "Bag — next wrong guess won't count",                         cost: 32, max: 1 },
  scout:         { name: 'Scout',         desc: 'Bag — reveals 1 random letter on 1 zombie',                  cost: 18, max: 3 },
  sweep:         { name: 'First Letters', desc: 'Bag — reveals first letter of every zombie',                 cost: 30, max: 1 },
  last_letter:   { name: 'Last Letters',  desc: 'Bag — reveals last letter of every zombie',                  cost: 28, max: 1 },
  reveal_vowels: { name: 'Vowel Scan',    desc: 'Bag — reveals all vowel positions on every zombie',          cost: 22, max: 2 },
  mega_hint:     { name: 'Mega Scout',    desc: 'Bag — reveals 2 random letters on 1 zombie',                 cost: 35, max: 1 },
  multi_scout:   { name: 'Full Sweep',    desc: 'Bag — reveals 1 random letter on every zombie',              cost: 42, max: 1 },
  mega_shield:   { name: 'Mega Shield',   desc: 'Bag — instantly slays 1 random zombie',                          cost: 72,  max: 1 },
  grenade:       { name: 'Grenade',       desc: 'Bag — choose 1 zombie to instantly slay',                        cost: 55,  max: 2 },
  nuke:          { name: 'Nuke',          desc: 'Bag — instantly slays all remaining zombies',                     cost: 110, max: 1 },
  bounty:        { name: 'Bounty Hunter', desc: 'Passive — +3 bonus coins per zombie slain each wave',             cost: 18,  max: 3, passive: true },
  coin_hoard:    { name: 'Hoarder',       desc: 'Passive — +15 bonus coins at end of every wave',                 cost: 22,  max: 2, passive: true },
  adrenaline:    { name: 'Adrenaline',    desc: 'Bag — adds 5 extra guesses right now',                           cost: 45,  max: 1 },
  spotlight:     { name: 'Spotlight',     desc: 'Bag — reveals all letters on 1 chosen zombie (does not slay)',   cost: 50,  max: 1 },
  dead_center:   { name: 'Dead Center',   desc: 'Bag — reveals the middle letter of every unsolved zombie',       cost: 20,  max: 2 },
};

const PASSIVE_TYPES = ['extra_guess', 'shield', 'eagle_eye', 'tough', 'scavenger', 'bounty', 'coin_hoard'];

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

function computeCoinsEarned(maxGuesses, guessCount, passiveItems, wordCount = 0) {
  const scavengerCount = passiveItems.filter(i => i.type === 'scavenger').length;
  const bountyCount = passiveItems.filter(i => i.type === 'bounty').length;
  const coinHoardCount = passiveItems.filter(i => i.type === 'coin_hoard').length;
  return 10 + Math.max(0, (maxGuesses - guessCount) * 8) + scavengerCount * 10 + bountyCount * 3 * wordCount + coinHoardCount * 15;
}

async function handleRoundSurvived(db, game, round, guessCount) {
  const next = game.current_round + 1;
  const passiveItems = JSON.parse(game.passive_items || '[]');
  const wordCount = JSON.parse(round.words).length;
  const coinsEarned = computeCoinsEarned(round.max_guesses, guessCount, passiveItems, wordCount);
  if (game.current_round % 2 === 0 && game.shop_enabled !== 0) {
    const shopSelections = shuffleArray(Object.keys(SHOP_ITEMS)).slice(0, 3);
    db.prepare("UPDATE zombie_games SET status = 'shop', current_round = ?, rounds_survived = rounds_survived + 1, coins = coins + ?, last_coins_earned = ?, shop_selections = ?, shop_ready = '[]' WHERE id = ?")
      .run(next, coinsEarned, coinsEarned, JSON.stringify(shopSelections), game.id);
  } else {
    await startRound(db, game.id, next, game.theme_enabled !== 0, game.guess_scale || 'normal');
    db.prepare("UPDATE zombie_games SET current_round = ?, rounds_survived = rounds_survived + 1, coins = coins + ?, last_coins_earned = ? WHERE id = ?")
      .run(next, coinsEarned, coinsEarned, game.id);
  }
}

// Round N: guesses scale based on host-selected scale
function maxGuessesForRound(n, scale = 'normal') {
  if (scale === 'tight')    return 4 + n;
  if (scale === 'generous') return Math.round(5 + n * 2);
  return Math.round(4 + n * 1.5); // normal
}

function wordLengthForRound(roundNumber, escalation) {
  if (!escalation || escalation === 'off') return 5;
  const n = parseInt(escalation, 10);
  if (!n) return 5;
  return Math.min(7, 5 + Math.floor((roundNumber - 1) / n));
}

function wordPoolForLength(len) {
  if (len === 6) return WORDS_6;
  if (len === 7) return WORDS_7;
  if (len === 8) return WORDS_8;
  return ANSWERS;
}

function getRoundConfig(game, roundNumber) {
  const passiveItems = JSON.parse(game.passive_items || '[]');
  const shieldCount = passiveItems.filter(i => i.type === 'shield').length;
  const isBossRound = game.boss_enabled !== 0 && roundNumber > 0 && roundNumber % 5 === 0;

  let wordLen, wordCount;
  if (isBossRound) {
    wordLen = 8;
    wordCount = Math.max(1, Math.ceil(roundNumber / 5) - shieldCount);
  } else {
    wordLen = wordLengthForRound(roundNumber, game.word_escalation);
    wordCount = Math.max(1, roundNumber - shieldCount);
  }

  return { wordLen, wordCount, isBossRound };
}

function pickWords(db, gameId, count, wordLen = 5) {
  const pool = wordPoolForLength(wordLen);
  const used = new Set(
    db.prepare('SELECT words FROM zombie_rounds WHERE game_id = ?').all(gameId)
      .flatMap(r => JSON.parse(r.words))
      .filter(w => w.length === wordLen)
  );
  const fresh = pool.filter(w => !used.has(w));
  const src = fresh.length >= count ? fresh : [...pool];
  const avail = [...src];
  const out = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(Math.random() * avail.length);
    out.push(avail.splice(idx, 1)[0]);
  }
  return out;
}

// Fire-and-forget: generate next round's words in background and store in pending_round
function schedulePreGeneration(db, gameId, nextRound) {
  preGenerateRound(db, gameId, nextRound)
    .catch(err => console.warn(`[zombie] pre-gen game=${gameId} round=${nextRound}:`, err.message));
}

async function preGenerateRound(db, gameId, nextRound) {
  const game = db.prepare('SELECT * FROM zombie_games WHERE id = ?').get(gameId);
  if (!game || game.status === 'completed') return;
  // Only pre-gen for theme mode — non-theme picks from local pool instantly
  if (game.theme_enabled === 0) return;

  const cfg = getRoundConfig(game, nextRound);
  const wordCount = cfg.wordCount;
  const wordLen = cfg.wordLen;

  const generated = await generateZombieTheme(wordCount, wordLen);

  // Don't store if game ended while we were generating
  const gameNow = db.prepare('SELECT status FROM zombie_games WHERE id = ?').get(gameId);
  if (!gameNow || gameNow.status === 'completed') return;

  db.prepare('UPDATE zombie_games SET pending_round = ? WHERE id = ?')
    .run(JSON.stringify({ roundNumber: nextRound, words: generated.words, theme: generated.theme }), gameId);
  console.log(`[zombie] pre-gen ready: game=${gameId} round=${nextRound} theme="${generated.theme}"`);
}

async function startRound(db, gameId, roundNumber, themeEnabled = true, guessScale = 'normal') {
  const game = db.prepare('SELECT * FROM zombie_games WHERE id = ?').get(gameId);
  const passiveItems = JSON.parse(game.passive_items || '[]');
  const cfg = getRoundConfig(game, roundNumber);
  const wordLen = cfg.wordLen;
  const wordCount = cfg.wordCount;
  const isBossRound = cfg.isBossRound;
  const extraGuesses = passiveItems.filter(i => i.type === 'extra_guess').length;
  const eagleEyeCount = passiveItems.filter(i => i.type === 'eagle_eye').length;
  const toughCount = passiveItems.filter(i => i.type === 'tough').length;

  let words, theme = null;

  // Use pre-generated data if it's ready for this round
  const pending = game.pending_round ? JSON.parse(game.pending_round) : null;
  if (pending && pending.roundNumber === roundNumber && Array.isArray(pending.words)) {
    const sizedWords = pending.words.filter(w => w.length === wordLen);
    if (sizedWords.length >= wordCount) {
      words = sizedWords.slice(0, wordCount);
      theme = pending.theme || null;
    }
  }
  // Clear pending regardless — we either used it or it was stale
  db.prepare('UPDATE zombie_games SET pending_round = NULL WHERE id = ?').run(gameId);

  if (!words) {
    // Pre-gen wasn't ready (round 1, or finished too fast) — generate synchronously
    if (themeEnabled) {
      try {
        const generated = await generateZombieTheme(wordCount, wordLen);
        words = generated.words;
        theme = generated.theme;
      } catch (err) {
        console.warn('[zombie] theme gen failed, using local pool:', err.message);
        words = pickWords(db, gameId, wordCount, wordLen);
      }
    } else {
      words = pickWords(db, gameId, wordCount, wordLen);
    }
  }

  const maxGuesses = maxGuessesForRound(roundNumber, guessScale) + extraGuesses;

  // Apply eagle_eye: reveal 1 random letter per zombie per eagle_eye passive
  const allPos = Array.from({ length: wordLen }, (_, i) => i);
  const initialHintTiles = [];
  if (eagleEyeCount > 0) {
    words.forEach((w, wi) => {
      for (let n = 0; n < eagleEyeCount; n++) {
        const taken = initialHintTiles.filter(h => h.wordIndex === wi).map(h => h.tileIndex);
        const avail = allPos.filter(p => !taken.includes(p));
        if (avail.length > 0) {
          const ti = avail[Math.floor(Math.random() * avail.length)];
          initialHintTiles.push({ wordIndex: wi, tileIndex: ti, letter: w[ti] });
        }
      }
    });
  }

  db.prepare('INSERT INTO zombie_rounds (game_id, round_number, words, max_guesses, theme, hint_tiles, safe_guesses, is_boss_round) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(gameId, roundNumber, JSON.stringify(words), maxGuesses, theme,
         initialHintTiles.length ? JSON.stringify(initialHintTiles) : null, toughCount, isBossRound ? 1 : 0);

  // Always kick off background generation for next round
  schedulePreGeneration(db, gameId, roundNumber + 1);
}

function computeSlayers(guesses) {
  const slayers = {};
  for (const g of guesses) {
    g.results.forEach((boardResult, b) => {
      if (slayers[b] === undefined && boardResult.every(r => r.status === 'green')) {
        slayers[b] = g.displayName || g.display_name;
      }
    });
  }
  return slayers;
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
    lastCoinsEarned: game.last_coins_earned || 0,
    shopItems: JSON.parse(game.shop_items || '[]'),
    shopReady: JSON.parse(game.shop_ready || '[]').map(String),
    passiveItems: JSON.parse(game.passive_items || '[]'),
    bagItems: JSON.parse(game.bag_items || '[]'),
    round: round ? {
      id: round.id,
      wordCount: JSON.parse(round.words).length,
      maxGuesses: round.max_guesses,
      solvedMask: JSON.parse(round.solved_mask),
      outcome: round.outcome,
      guessCount: guesses.length,
      theme: round.theme || null,
      safeGuesses: round.safe_guesses || 0,
      hintTiles: round.hint_tiles ? JSON.parse(round.hint_tiles) : [],
      isBossRound: round.is_boss_round === 1,
    } : null,
    slayers: computeSlayers(guesses),
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

  const passiveItems = JSON.parse(game.passive_items || '[]');
  const bagItems = JSON.parse(game.bag_items || '[]');
  let round = null, guesses = [], wordCount = 0, solvedMask = [], revealWords = null, theme = null, hints = [], wordLen = 5, isBossRound = false;
  if (game.status !== 'waiting') {
    round = db.prepare('SELECT * FROM zombie_rounds WHERE game_id = ? AND round_number = ?').get(game.id, game.current_round);
    if (round) {
      const words = JSON.parse(round.words);
      wordCount = words.length;
      wordLen = words[0] ? words[0].length : 5;
      solvedMask = JSON.parse(round.solved_mask);
      theme = round.theme || null;
      isBossRound = round.is_boss_round === 1;
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

  const slayers = computeSlayers(guesses);

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

  const nextWordLen = wordLengthForRound(game.current_round + 1, game.word_escalation);
  const isAdmin = req.user.email === ADMIN_EMAIL;
  const devWords = isAdmin && round ? JSON.parse(round.words) : null;

  res.render('zombie_game', {
    title: 'Zombie Horde',
    game, players, myPlayer, round, guesses, wordCount, solvedMask, canGuess, revealWords,
    theme, hints, priorRounds, shopSelections, shopItems, shopEarned, SHOP_ITEMS, leaderboard, slayers,
    passiveItems, bagItems, wordLen, nextWordLen, isAdmin, devWords, isBossRound,
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
  await startRound(db, game.id, 1, game.theme_enabled !== 0, game.guess_scale || 'normal');
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
  const words = JSON.parse(round.words);
  const expectedLen = words[0] ? words[0].length : 5;
  if (guess.length !== expectedLen) return res.json({ error: `Must be a ${expectedLen}-letter word` });

  const dupe = db.prepare('SELECT id FROM zombie_guesses WHERE round_id = ? AND guess = ?').get(round.id, guess);
  if (dupe) return res.json({ error: 'Already tried that word this round' });

  if (!(await isValidWord(guess))) return res.json({ error: 'Not a valid word' });

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
    const roundForHelper = { ...round, max_guesses: effectiveMaxGuesses };
    await handleRoundSurvived(db, game, roundForHelper, newGuessCount);
  } else if (newGuessCount >= effectiveMaxGuesses) {
    roundOutcome = 'overrun';
    gameOver = true;
    db.prepare("UPDATE zombie_rounds SET solved_mask = ?, outcome = 'overrun' WHERE id = ?").run(JSON.stringify(newSolvedMask), round.id);
    db.prepare("UPDATE zombie_games SET status = 'completed', outcome = 'overrun' WHERE id = ?").run(game.id);
  } else {
    db.prepare('UPDATE zombie_rounds SET solved_mask = ? WHERE id = ?').run(JSON.stringify(newSolvedMask), round.id);
  }

  broadcast('zombie', game.id, zombieGameState(db, game.id));

  // Build slayer map for newly solved zombies (the submitting player slayed them)
  const slayerName = db.prepare('SELECT display_name FROM users WHERE id = ?').get(req.user.id)?.display_name || 'Someone';
  const newSlayers = {};
  newlySolved.forEach(i => { newSlayers[i] = slayerName; });

  res.json({
    ok: true,
    results,
    solvedMask: newSolvedMask,
    newlySolved,
    newSlayers,
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

  broadcast('zombie', game.id, zombieGameState(db, game.id));
  res.redirect('/games/zombie/' + game.id);
});

// POST /games/zombie/:id/shop/ready
router.post('/games/zombie/:id/shop/ready', ensureAuth, async (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM zombie_games WHERE id = ?').get(req.params.id);
  if (!game || game.status !== 'shop') return res.redirect('/games/zombie/' + req.params.id);
  const myPlayer = db.prepare('SELECT * FROM zombie_players WHERE game_id = ? AND user_id = ?').get(game.id, req.user.id);
  if (!myPlayer) return res.redirect('/games/zombie/' + req.params.id);

  const ready = JSON.parse(game.shop_ready || '[]').map(Number);
  if (!ready.includes(req.user.id)) ready.push(req.user.id);
  db.prepare('UPDATE zombie_games SET shop_ready = ? WHERE id = ?').run(JSON.stringify(ready), game.id);

  const allPlayerIds = db.prepare('SELECT user_id FROM zombie_players WHERE game_id = ?').all(game.id).map(p => p.user_id);
  const allReady = allPlayerIds.every(id => ready.includes(id));

  if (allReady) {
    const items = JSON.parse(game.shop_items || '[]');
    const newPassive = [...JSON.parse(game.passive_items || '[]'), ...items.filter(i => PASSIVE_TYPES.includes(i.type))];
    const newBag = [...JSON.parse(game.bag_items || '[]'), ...items.filter(i => !PASSIVE_TYPES.includes(i.type))];
    db.prepare('UPDATE zombie_games SET passive_items = ?, bag_items = ? WHERE id = ?')
      .run(JSON.stringify(newPassive), JSON.stringify(newBag), game.id);
    await startRound(db, game.id, game.current_round, game.theme_enabled !== 0, game.guess_scale || 'normal');
    db.prepare("UPDATE zombie_games SET status = 'active', shop_items = '[]', shop_selections = '[]', shop_ready = '[]' WHERE id = ?").run(game.id);
  }
  broadcast('zombie', game.id, zombieGameState(db, game.id));
  res.redirect('/games/zombie/' + game.id);
});

// POST /games/zombie/:id/shop/force-start (host only)
router.post('/games/zombie/:id/shop/force-start', ensureAuth, async (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM zombie_games WHERE id = ?').get(req.params.id);
  if (!game || game.status !== 'shop' || game.created_by !== req.user.id) return res.redirect('/games/zombie/' + req.params.id);

  const items = JSON.parse(game.shop_items || '[]');
  const newPassive = [...JSON.parse(game.passive_items || '[]'), ...items.filter(i => PASSIVE_TYPES.includes(i.type))];
  const newBag = [...JSON.parse(game.bag_items || '[]'), ...items.filter(i => !PASSIVE_TYPES.includes(i.type))];
  db.prepare('UPDATE zombie_games SET passive_items = ?, bag_items = ? WHERE id = ?')
    .run(JSON.stringify(newPassive), JSON.stringify(newBag), game.id);
  await startRound(db, game.id, game.current_round, game.theme_enabled !== 0, game.guess_scale || 'normal');
  db.prepare("UPDATE zombie_games SET status = 'active', shop_items = '[]', shop_selections = '[]', shop_ready = '[]' WHERE id = ?").run(game.id);
  broadcast('zombie', game.id, zombieGameState(db, game.id));
  res.redirect('/games/zombie/' + game.id);
});

// POST /games/zombie/:id/use-item
router.post('/games/zombie/:id/use-item', ensureAuth, async (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM zombie_games WHERE id = ?').get(req.params.id);
  if (!game || game.status !== 'active') return res.json({ error: 'Game not active' });

  const myPlayer = db.prepare('SELECT * FROM zombie_players WHERE game_id = ? AND user_id = ?').get(game.id, req.user.id);
  if (!myPlayer) return res.json({ error: 'Not in this game' });

  const round = db.prepare('SELECT * FROM zombie_rounds WHERE game_id = ? AND round_number = ?').get(game.id, game.current_round);
  if (!round || round.outcome) return res.json({ error: 'Round not active' });

  const itemType = req.body.item;
  const bagItems = JSON.parse(game.bag_items || '[]');
  const itemIdx = bagItems.findIndex(i => i.type === itemType);
  if (itemIdx === -1) return res.json({ error: 'Item not in bag' });

  const words = JSON.parse(round.words);
  const wordLen = words[0] ? words[0].length : 5;
  const allPositions = Array.from({ length: wordLen }, (_, i) => i);
  let solvedMask = JSON.parse(round.solved_mask);
  let hintTiles = round.hint_tiles ? JSON.parse(round.hint_tiles) : [];

  if (itemType === 'guess_burst') {
    db.prepare('UPDATE zombie_rounds SET max_guesses = max_guesses + 3 WHERE id = ?').run(round.id);
  } else if (itemType === 'safe_guess') {
    db.prepare('UPDATE zombie_rounds SET safe_guesses = safe_guesses + 1 WHERE id = ?').run(round.id);
  } else if (itemType === 'scout') {
    const unsolvedIdx = words.map((_, i) => i).filter(i => !solvedMask.includes(i));
    if (unsolvedIdx.length > 0) {
      const wi = unsolvedIdx[Math.floor(Math.random() * unsolvedIdx.length)];
      const taken = hintTiles.filter(h => h.wordIndex === wi).map(h => h.tileIndex);
      const avail = allPositions.filter(p => !taken.includes(p));
      if (avail.length > 0) {
        const ti = avail[Math.floor(Math.random() * avail.length)];
        hintTiles.push({ wordIndex: wi, tileIndex: ti, letter: words[wi][ti] });
        db.prepare('UPDATE zombie_rounds SET hint_tiles = ? WHERE id = ?').run(JSON.stringify(hintTiles), round.id);
      }
    }
  } else if (itemType === 'sweep') {
    words.forEach((w, wi) => {
      if (!solvedMask.includes(wi) && !hintTiles.find(h => h.wordIndex === wi && h.tileIndex === 0))
        hintTiles.push({ wordIndex: wi, tileIndex: 0, letter: w[0] });
    });
    db.prepare('UPDATE zombie_rounds SET hint_tiles = ? WHERE id = ?').run(JSON.stringify(hintTiles), round.id);
  } else if (itemType === 'last_letter') {
    const lastIdx = wordLen - 1;
    words.forEach((w, wi) => {
      if (!solvedMask.includes(wi) && !hintTiles.find(h => h.wordIndex === wi && h.tileIndex === lastIdx))
        hintTiles.push({ wordIndex: wi, tileIndex: lastIdx, letter: w[lastIdx] });
    });
    db.prepare('UPDATE zombie_rounds SET hint_tiles = ? WHERE id = ?').run(JSON.stringify(hintTiles), round.id);
  } else if (itemType === 'mega_hint') {
    const unsolvedIdx = words.map((_, i) => i).filter(i => !solvedMask.includes(i));
    if (unsolvedIdx.length > 0) {
      const wi = unsolvedIdx[Math.floor(Math.random() * unsolvedIdx.length)];
      const positions = shuffleArray([...allPositions]);
      let added = 0;
      for (const ti of positions) {
        if (!hintTiles.find(h => h.wordIndex === wi && h.tileIndex === ti)) {
          hintTiles.push({ wordIndex: wi, tileIndex: ti, letter: words[wi][ti] });
          if (++added >= 2) break;
        }
      }
      db.prepare('UPDATE zombie_rounds SET hint_tiles = ? WHERE id = ?').run(JSON.stringify(hintTiles), round.id);
    }
  } else if (itemType === 'multi_scout') {
    words.forEach((w, wi) => {
      if (!solvedMask.includes(wi)) {
        const taken = hintTiles.filter(h => h.wordIndex === wi).map(h => h.tileIndex);
        const avail = allPositions.filter(p => !taken.includes(p));
        if (avail.length > 0) {
          const ti = avail[Math.floor(Math.random() * avail.length)];
          hintTiles.push({ wordIndex: wi, tileIndex: ti, letter: w[ti] });
        }
      }
    });
    db.prepare('UPDATE zombie_rounds SET hint_tiles = ? WHERE id = ?').run(JSON.stringify(hintTiles), round.id);
  } else if (itemType === 'mega_shield') {
    const unsolvedIdx = words.map((_, i) => i).filter(i => !solvedMask.includes(i));
    if (unsolvedIdx.length > 0) {
      const slayIdx = unsolvedIdx[Math.floor(Math.random() * unsolvedIdx.length)];
      solvedMask = [...solvedMask, slayIdx];
      bagItems.splice(itemIdx, 1);
      db.prepare('UPDATE zombie_games SET bag_items = ? WHERE id = ?').run(JSON.stringify(bagItems), game.id);
      if (solvedMask.length === words.length) {
        db.prepare("UPDATE zombie_rounds SET solved_mask = ?, outcome = 'survived' WHERE id = ?").run(JSON.stringify(solvedMask), round.id);
        const { c: guessCount } = db.prepare('SELECT COUNT(*) as c FROM zombie_guesses WHERE round_id = ?').get(round.id);
        await handleRoundSurvived(db, game, round, guessCount);
      } else {
        db.prepare('UPDATE zombie_rounds SET solved_mask = ? WHERE id = ?').run(JSON.stringify(solvedMask), round.id);
      }
      broadcast('zombie', game.id, zombieGameState(db, game.id));
      return res.json({ ok: true });
    }
  } else if (itemType === 'grenade') {
    const targetIndex = parseInt(req.body.targetIndex, 10);
    const unsolvedIdx = words.map((_, i) => i).filter(i => !solvedMask.includes(i));
    if (isNaN(targetIndex) || !unsolvedIdx.includes(targetIndex)) return res.json({ error: 'Invalid target' });
    solvedMask = [...solvedMask, targetIndex];
    bagItems.splice(itemIdx, 1);
    db.prepare('UPDATE zombie_games SET bag_items = ? WHERE id = ?').run(JSON.stringify(bagItems), game.id);
    if (solvedMask.length === words.length) {
      db.prepare("UPDATE zombie_rounds SET solved_mask = ?, outcome = 'survived' WHERE id = ?").run(JSON.stringify(solvedMask), round.id);
      const { c: guessCount } = db.prepare('SELECT COUNT(*) as c FROM zombie_guesses WHERE round_id = ?').get(round.id);
      await handleRoundSurvived(db, game, round, guessCount);
    } else {
      db.prepare('UPDATE zombie_rounds SET solved_mask = ? WHERE id = ?').run(JSON.stringify(solvedMask), round.id);
    }
    broadcast('zombie', game.id, zombieGameState(db, game.id));
    return res.json({ ok: true });
  } else if (itemType === 'nuke') {
    solvedMask = words.map((_, i) => i);
    bagItems.splice(itemIdx, 1);
    db.prepare('UPDATE zombie_games SET bag_items = ? WHERE id = ?').run(JSON.stringify(bagItems), game.id);
    db.prepare("UPDATE zombie_rounds SET solved_mask = ?, outcome = 'survived' WHERE id = ?").run(JSON.stringify(solvedMask), round.id);
    const { c: nukeGuessCount } = db.prepare('SELECT COUNT(*) as c FROM zombie_guesses WHERE round_id = ?').get(round.id);
    await handleRoundSurvived(db, game, round, nukeGuessCount);
    broadcast('zombie', game.id, zombieGameState(db, game.id));
    return res.json({ ok: true });
  } else if (itemType === 'reveal_vowels') {
    const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);
    words.forEach((w, wi) => {
      if (!solvedMask.includes(wi)) {
        w.split('').forEach((letter, ti) => {
          if (VOWELS.has(letter) && !hintTiles.find(h => h.wordIndex === wi && h.tileIndex === ti))
            hintTiles.push({ wordIndex: wi, tileIndex: ti, letter });
        });
      }
    });
    db.prepare('UPDATE zombie_rounds SET hint_tiles = ? WHERE id = ?').run(JSON.stringify(hintTiles), round.id);
  } else if (itemType === 'medkit') {
    db.prepare('UPDATE zombie_rounds SET max_guesses = max_guesses + 2 WHERE id = ?').run(round.id);
  } else if (itemType === 'adrenaline') {
    db.prepare('UPDATE zombie_rounds SET max_guesses = max_guesses + 5 WHERE id = ?').run(round.id);
  } else if (itemType === 'spotlight') {
    const targetIndex = parseInt(req.body.targetIndex, 10);
    const unsolvedIdx = words.map((_, i) => i).filter(i => !solvedMask.includes(i));
    if (isNaN(targetIndex) || !unsolvedIdx.includes(targetIndex)) return res.json({ error: 'Invalid target' });
    Array.from({ length: wordLen }, (_, ti) => ti).forEach(ti => {
      if (!hintTiles.find(h => h.wordIndex === targetIndex && h.tileIndex === ti))
        hintTiles.push({ wordIndex: targetIndex, tileIndex: ti, letter: words[targetIndex][ti] });
    });
    db.prepare('UPDATE zombie_rounds SET hint_tiles = ? WHERE id = ?').run(JSON.stringify(hintTiles), round.id);
  } else if (itemType === 'dead_center') {
    const midIdx = Math.floor(wordLen / 2);
    words.forEach((w, wi) => {
      if (!solvedMask.includes(wi) && !hintTiles.find(h => h.wordIndex === wi && h.tileIndex === midIdx))
        hintTiles.push({ wordIndex: wi, tileIndex: midIdx, letter: w[midIdx] });
    });
    db.prepare('UPDATE zombie_rounds SET hint_tiles = ? WHERE id = ?').run(JSON.stringify(hintTiles), round.id);
  } else {
    return res.json({ error: 'Unknown item type' });
  }

  bagItems.splice(itemIdx, 1);
  db.prepare('UPDATE zombie_games SET bag_items = ? WHERE id = ?').run(JSON.stringify(bagItems), game.id);

  broadcast('zombie', game.id, zombieGameState(db, game.id));
  res.json({ ok: true });
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

// POST /games/zombie/:id/set-word-escalation
router.post('/games/zombie/:id/set-word-escalation', ensureAuth, (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM zombie_games WHERE id = ?').get(req.params.id);
  if (!game || game.status !== 'waiting' || game.created_by !== req.user.id) {
    return res.redirect('/games/zombie/' + req.params.id);
  }
  const val = ['off', '2', '3', '4'].includes(req.body.escalation) ? req.body.escalation : 'off';
  db.prepare('UPDATE zombie_games SET word_escalation = ? WHERE id = ?').run(val, game.id);
  broadcast('lobby', 'zombie:' + game.id, { word_escalation: val });
  res.redirect('/games/zombie/' + req.params.id);
});

// POST /games/zombie/:id/toggle-boss
router.post('/games/zombie/:id/toggle-boss', ensureAuth, (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT * FROM zombie_games WHERE id = ?').get(req.params.id);
  if (!game || game.status !== 'waiting' || game.created_by !== req.user.id) {
    return res.redirect('/games/zombie/' + req.params.id);
  }
  const newVal = game.boss_enabled === 0 ? 1 : 0;
  db.prepare('UPDATE zombie_games SET boss_enabled = ? WHERE id = ?').run(newVal, game.id);
  broadcast('lobby', 'zombie:' + game.id, { boss_enabled: newVal });
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
