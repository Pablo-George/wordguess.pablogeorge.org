const GUESS_SCORES = { 1: 6, 2: 5, 3: 4, 4: 3, 5: 2, 6: 1 };

function scoreDaily(guessesCount, solved) {
  if (!solved) return 0;
  return GUESS_SCORES[guessesCount] || 0;
}

module.exports = { scoreDaily, GUESS_SCORES };
