(function() {
  // Daily puzzle guesses
  var guessForm = document.getElementById('guess-form');
  if (guessForm) {
    guessForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var input = document.getElementById('guess-input');
      var guess = input.value.trim().toUpperCase();
      if (guess.length !== 5) return;

      fetch('/daily/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guess: guess })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) {
          document.getElementById('error-msg').textContent = data.error;
          return;
        }
        window.location.reload();
      })
      .catch(function() {
        document.getElementById('error-msg').textContent = 'Error submitting guess';
      });
    });
  }

  // Classic guesses
  var classicForm = document.getElementById('classic-guess-form');
  if (classicForm) {
    var classicSubmitting = false;
    classicForm.addEventListener('submit', function(e) {
      e.preventDefault();
      if (classicSubmitting) return;
      var input = document.getElementById('classic-guess-input');
      var guess = input.value.trim().toUpperCase().replace(/[^A-Z]/g, '');
      if (guess.length !== 5) return;
      var errorEl = document.getElementById('classic-error');
      var btn = classicForm.querySelector('button[type=submit]');

      classicSubmitting = true;
      btn.disabled = true;
      errorEl.textContent = '';

      fetch('/classic/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guess: guess })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) {
          errorEl.textContent = data.error;
          classicSubmitting = false;
          btn.disabled = false;
          input.focus();
          return;
        }

        var board = document.getElementById('classic-board');
        var emptyRow = board.querySelector('.row:not([data-filled])');
        if (emptyRow) {
          emptyRow.setAttribute('data-filled', '1');
          var tiles = emptyRow.querySelectorAll('.tile');
          data.result.forEach(function(r, i) {
            setTimeout(function() {
              tiles[i].classList.add('tile-flip');
              setTimeout(function() {
                tiles[i].className = 'tile tile-' + r.status;
                tiles[i].textContent = r.letter;
              }, 175);
            }, i * 80);
          });
        }

        input.value = '';
        var totalDelay = data.result.length * 80 + 175;

        setTimeout(function() {
          if (data.solved || data.outOfGuesses) {
            classicForm.style.display = 'none';
            document.querySelector('.classic-actions').style.display = 'none';

            var msg = document.createElement('div');
            msg.id = 'classic-result';
            msg.className = data.solved ? 'result-message win' : 'result-message fail';
            msg.innerHTML = data.solved
              ? 'Solved in ' + data.guessNumber + ' guess' + (data.guessNumber !== 1 ? 'es' : '') + '! +' + data.score + ' pts'
              : 'The word was <strong>' + data.answer + '</strong>';
            classicForm.parentNode.insertBefore(msg, classicForm);

            var actions = document.createElement('div');
            actions.className = 'classic-actions';
            actions.innerHTML = '<form action="/classic/new" method="POST"><button type="submit" class="btn btn-primary">' + (data.solved ? 'New Game' : 'Try Again') + '</button></form>';
            classicForm.parentNode.insertBefore(actions, classicForm);

            if (data.stats) {
              var statEls = document.querySelectorAll('.stat-value');
              if (statEls[0]) statEls[0].textContent = data.stats.total;
              if (statEls[1]) statEls[1].textContent = data.stats.winRate + '%';
              if (statEls[2]) statEls[2].textContent = data.stats.streak;
              if (statEls[3]) statEls[3].textContent = data.stats.bestStreak;
            }
          } else {
            classicSubmitting = false;
            btn.disabled = false;
            input.focus();
          }
        }, totalDelay);
      })
      .catch(function() {
        errorEl.textContent = 'Error submitting guess';
        classicSubmitting = false;
        btn.disabled = false;
      });
    });
  }

  // Battle guesses
  var battleForm = document.getElementById('battle-guess-form');
  if (battleForm) {
    battleForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var input = document.getElementById('battle-guess-input');
      var guess = input.value.trim().toUpperCase();
      if (guess.length !== 5) return;

      var battleId = battleForm.getAttribute('data-battle-id');
      fetch('/battles/' + battleId + '/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guess: guess })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) {
          document.getElementById('battle-error').textContent = data.error;
          return;
        }
        window.location.reload();
      })
      .catch(function() {
        document.getElementById('battle-error').textContent = 'Error';
      });
    });
  }

  // Anime Quote guesses
  var aqForm = document.getElementById('aq-guess-form');
  if (aqForm) {
    aqForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var input = document.getElementById('aq-guess-input');
      var guess = input.value.trim().toUpperCase().replace(/[^A-Z]/g, '');
      if (!guess.length) return;
      var gameId = aqForm.getAttribute('data-game-id');
      var wordId = aqForm.getAttribute('data-word-id');
      fetch('/games/animequotes/' + gameId + '/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guess: guess, word_id: wordId })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) { document.getElementById('aq-error').textContent = data.error; return; }
        window.location.reload();
      })
      .catch(function() { document.getElementById('aq-error').textContent = 'Error'; });
    });
  }

  // Knockout guesses
  var knockoutForm = document.getElementById('knockout-guess-form');
  if (knockoutForm) {
    knockoutForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var input = document.getElementById('knockout-guess-input');
      var guess = input.value.trim().toUpperCase();
      if (guess.length !== 5) return;
      var gameId = knockoutForm.getAttribute('data-game-id');
      fetch('/games/knockout/' + gameId + '/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guess: guess })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) { document.getElementById('knockout-error').textContent = data.error; return; }
        window.location.reload();
      })
      .catch(function() { document.getElementById('knockout-error').textContent = 'Error'; });
    });
  }

  // Pokemon game guesses
  var pokemonForm = document.getElementById('pokemon-guess-form');
  if (pokemonForm) {
    var pokemonSubmitting = false;
    pokemonForm.addEventListener('submit', function(e) {
      e.preventDefault();
      if (pokemonSubmitting) return;
      var input = document.getElementById('pokemon-guess-input');
      var guess = input.value.trim().toUpperCase().replace(/[^A-Z]/g, '');
      if (!guess.length) return;
      var gameId = pokemonForm.getAttribute('data-game-id');
      var errorEl = document.getElementById('pokemon-error');
      var btn = pokemonForm.querySelector('button[type=submit]');

      pokemonSubmitting = true;
      btn.disabled = true;
      errorEl.textContent = '';

      fetch('/games/pokemon/' + gameId + '/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guess: guess })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) {
          errorEl.textContent = data.error;
          pokemonSubmitting = false;
          btn.disabled = false;
          input.focus();
          return;
        }

        // Fill the next empty row with the result tiles
        var board = document.getElementById('pokemon-board');
        var emptyRow = board.querySelector('.row:not([data-filled])');
        if (emptyRow) {
          emptyRow.setAttribute('data-filled', '1');
          var tiles = emptyRow.querySelectorAll('.tile');
          data.result.forEach(function(r, i) {
            var delay = i * 80;
            setTimeout(function() {
              var tile = tiles[i];
              tile.classList.add('tile-flip');
              setTimeout(function() {
                tile.className = 'tile tile-' + r.status;
                tile.textContent = r.letter;
              }, 175);
            }, delay);
          });
        }

        input.value = '';

        var totalDelay = data.result.length * 80 + 175;
        setTimeout(function() {
          if (data.solved) {
            pokemonForm.style.display = 'none';
            var msg = document.createElement('div');
            msg.className = 'result-message win';
            msg.textContent = 'You got it in ' + data.guessCount + ' guess' + (data.guessCount !== 1 ? 'es' : '') + '! +' + data.score + ' pts';
            pokemonForm.parentNode.insertBefore(msg, pokemonForm);
          } else if (data.outOfGuesses) {
            pokemonForm.style.display = 'none';
            var msg = document.createElement('div');
            msg.className = 'result-message fail';
            msg.innerHTML = 'Out of guesses! The Pokémon was <strong>' + data.answer + '</strong>';
            pokemonForm.parentNode.insertBefore(msg, pokemonForm);
          } else if (data.gameCompleted) {
            pokemonForm.style.display = 'none';
            var msg = document.createElement('div');
            msg.className = 'result-message fail';
            msg.innerHTML = 'Game over! The Pokémon was <strong>' + data.answer + '</strong>';
            pokemonForm.parentNode.insertBefore(msg, pokemonForm);
          } else {
            pokemonSubmitting = false;
            btn.disabled = false;
            input.focus();
          }
        }, totalDelay);
      })
      .catch(function() {
        errorEl.textContent = 'Error submitting guess';
        pokemonSubmitting = false;
        btn.disabled = false;
      });
    });

    // Poll player status every 6s without full page reload
    var gameId = pokemonForm.getAttribute('data-game-id');
    function pollPlayers() {
      fetch('/games/pokemon/' + gameId + '/players')
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.status === 'completed') { window.location.reload(); return; }
          var list = document.querySelector('.player-status-list');
          if (!list || !data.players) return;
          data.players.forEach(function(p) {
            var item = list.querySelector('[data-user-id="' + p.user_id + '"]');
            if (!item) return;
            var maxGuesses = parseInt(list.getAttribute('data-max-guesses'), 10);
            if (p.solved) {
              item.className = 'player-status-item solved';
              var badge = item.querySelector('.status-badge');
              if (badge) badge.textContent = p.guesses_count + ' guess' + (p.guesses_count !== 1 ? 'es' : '');
            } else if (p.guesses_count >= maxGuesses) {
              item.className = 'player-status-item failed';
            } else {
              var counter = item.querySelector('.guess-counter');
              if (counter) counter.textContent = p.guesses_count + '/' + maxGuesses;
            }
          });
        })
        .catch(function() {});
    }
    var pollInterval = setInterval(pollPlayers, 6000);
    window.addEventListener('beforeunload', function() { clearInterval(pollInterval); });
  }

  // Royale guesses
  var royaleForm = document.getElementById('royale-guess-form');
  if (royaleForm) {
    royaleForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var input = document.getElementById('royale-guess-input');
      var guess = input.value.trim().toUpperCase();
      if (guess.length !== 5) return;

      var gameId = royaleForm.getAttribute('data-game-id');
      fetch('/royale/' + gameId + '/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guess: guess })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) {
          document.getElementById('royale-error').textContent = data.error;
          return;
        }
        window.location.reload();
      })
      .catch(function() {
        document.getElementById('royale-error').textContent = 'Error';
      });
    });
  }

  // Add by code
  var codeForm = document.getElementById('add-by-code-form');
  if (codeForm) {
    codeForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var code = document.getElementById('friend-code-input').value.trim().toUpperCase();
      if (code.length !== 5) return;
      fetch('/friends/add-by-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) {
          document.getElementById('code-error').textContent = data.error;
        } else {
          window.location.reload();
        }
      });
    });
  }

  // Group invite
  var inviteForm = document.getElementById('invite-form');
  if (inviteForm) {
    inviteForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var email = document.getElementById('invite-email').value;
      var groupId = window.location.pathname.split('/')[2];
      fetch('/groups/' + groupId + '/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) {
          document.getElementById('invite-error').textContent = data.error;
        } else {
          window.location.reload();
        }
      });
    });
  }

  // Round timer
  var timerEl = document.getElementById('timer');
  var roundTimer = document.querySelector('.round-timer');
  if (timerEl && roundTimer) {
    var endsAt = roundTimer.getAttribute('data-ends');
    function updateTimer() {
      var now = new Date();
      var end = new Date(endsAt);
      var diff = Math.max(0, Math.floor((end - now) / 1000));
      timerEl.textContent = diff;
      if (diff <= 0) {
        timerEl.textContent = '0';
      }
    }
    updateTimer();
    setInterval(updateTimer, 1000);

    // Auto-refresh when time expires
    var endTime = new Date(endsAt).getTime();
    var refreshAt = endTime + 2000;
    var timeout = refreshAt - Date.now();
    if (timeout > 0) {
      setTimeout(function() { window.location.reload(); }, timeout);
    }
  }

  // Auto-refresh for battle and royale rooms (every 10s)
  var battlePage = document.querySelector('.battle-page');
  var royalePage = document.querySelector('.royale-page');
  if (battlePage || royalePage) {
    var activeStatus = battlePage ? document.querySelector('.battle-page .guess-form') : document.querySelector('.royale-page .round-timer');
    if (activeStatus) {
      setTimeout(function() { window.location.reload(); }, 10000);
    }
  }

  // Hamburger menu
  var burger = document.getElementById('nav-burger');
  var navLinks = document.getElementById('nav-links');
  if (burger && navLinks) {
    burger.addEventListener('click', function() {
      var expanded = burger.getAttribute('aria-expanded') === 'true';
      burger.setAttribute('aria-expanded', String(!expanded));
      navLinks.classList.toggle('open');
    });
    navLinks.querySelectorAll('a').forEach(function(link) {
      link.addEventListener('click', function() {
        burger.setAttribute('aria-expanded', 'false');
        navLinks.classList.remove('open');
      });
    });
  }

  // Wrap leaderboard tables for horizontal scroll on mobile
  document.querySelectorAll('.leaderboard').forEach(function(table) {
    var wrapper = document.createElement('div');
    wrapper.style.overflowX = 'auto';
    wrapper.style.webkitOverflowScrolling = 'touch';
    table.parentNode.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  });
})();
