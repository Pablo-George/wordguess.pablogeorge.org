function getFeedback(guess, answer) {
  const guessLetters = guess.toUpperCase().split('');
  const answerLetters = answer.toUpperCase().split('');
  const result = new Array(5).fill(null);
  const remaining = {};

  for (const letter of answerLetters) {
    remaining[letter] = (remaining[letter] || 0) + 1;
  }

  for (let i = 0; i < 5; i++) {
    if (guessLetters[i] === answerLetters[i]) {
      result[i] = { letter: guessLetters[i], status: 'green' };
      remaining[guessLetters[i]]--;
    }
  }

  for (let i = 0; i < 5; i++) {
    if (result[i]) continue;
    if (remaining[guessLetters[i]] > 0) {
      result[i] = { letter: guessLetters[i], status: 'yellow' };
      remaining[guessLetters[i]]--;
    } else {
      result[i] = { letter: guessLetters[i], status: 'gray' };
    }
  }

  return result;
}

module.exports = { getFeedback };
