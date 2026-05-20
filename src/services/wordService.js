const { getDb } = require('../db/database');
const { ANSWERS } = require('../data/answers');

const validCache = new Map();

function getDailyWord(puzzleDate) {
  const db = getDb();
  let word = db.prepare('SELECT * FROM daily_words WHERE puzzle_date = ?').get(puzzleDate);
  if (!word) {
    const dayIndex = Math.floor(new Date(puzzleDate).getTime() / 86400000);
    const offset = dayIndex % ANSWERS.length;
    const entry = ANSWERS[offset];
    if (!entry) return null;
    db.prepare('INSERT INTO daily_words (word, puzzle_date, word_length) VALUES (?, ?, 5)').run(entry, puzzleDate);
    word = db.prepare('SELECT * FROM daily_words WHERE puzzle_date = ?').get(puzzleDate);
  }
  return word;
}

function getWordBySeed(seed) {
  const offset = Math.abs(seed) % ANSWERS.length;
  return ANSWERS[offset];
}

async function isValidWord(word) {
  const upper = word.toUpperCase();

  if (validCache.has(upper)) return validCache.get(upper);

  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(upper.toLowerCase())}`);
    if (res.status === 200) {
      const data = await res.json();
      const valid = Array.isArray(data) && data.length > 0;
      validCache.set(upper, valid);
      return valid;
    }
  } catch {
  }

  // Fallback: allow any word in the answers list (5-letter games)
  const fallback = ANSWERS.includes(upper);
  validCache.set(upper, fallback);
  return fallback;
}

module.exports = { getDailyWord, getWordBySeed, isValidWord };
