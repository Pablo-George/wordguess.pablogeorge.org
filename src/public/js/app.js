// ── WEBSOCKET CLIENT ─────────────────────────────────────────────────────────
(function() {
  var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  var ws = null;
  var handlers = {}; // room key -> handler fn
  var pending = []; // join messages queued before open
  var reconnectDelay = 1000;

  function connect() {
    ws = new WebSocket(proto + '//' + location.host);

    ws.onopen = function() {
      reconnectDelay = 1000;
      pending.forEach(function(msg) { ws.send(msg); });
      pending = [];
    };

    ws.onmessage = function(e) {
      try {
        var data = JSON.parse(e.data);
        if (data._room && handlers[data._room]) handlers[data._room](data);
      } catch (err) {}
    };

    ws.onclose = function() {
      // Reconnect with backoff (cap at 30s)
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    };

    ws.onerror = function() { ws.close(); };
  }

  connect();

  window.wsJoin = function(gameType, gameId, handler) {
    var key = gameType + ':' + gameId;
    handlers[key] = handler;
    var msg = JSON.stringify({ type: 'join', gameType: gameType, gameId: gameId });
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    } else {
      pending.push(msg);
    }
  };

  window.wsRelay = function(data) {
    var msg = JSON.stringify({ type: 'relay', data: data });
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  };
})();

// ── GAME UI ───────────────────────────────────────────────────────────────────
(function() {
  // Prevent pinch zoom (Safari ignores the viewport meta tag since iOS 10)
  document.addEventListener('touchmove', function(e) {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });
  document.addEventListener('gesturestart', function(e) {
    e.preventDefault();
  });

  function shakeBoard(boardId) {
    var b = document.getElementById(boardId);
    if (!b) return;
    b.classList.remove('board-shake');
    void b.offsetWidth; // reflow to restart animation
    b.classList.add('board-shake');
    setTimeout(function() { b.classList.remove('board-shake'); }, 400);
  }

  function rejectGuess(boardId, errorEl, msg) {
    if (errorEl) errorEl.textContent = msg;
    shakeBoard(boardId);
    if (window.syncKeyboardTiles) window.syncKeyboardTiles();
  }

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
          rejectGuess('board', document.getElementById('error-msg'), data.error);
          return;
        }
        window.location.reload();
      })
      .catch(function() {
        rejectGuess('board', document.getElementById('error-msg'), 'Error submitting guess');
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
      if (btn) btn.disabled = true;
      errorEl.textContent = '';

      fetch('/classic/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guess: guess })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) {
          rejectGuess('classic-board', errorEl, data.error);
          classicSubmitting = false;
          if (btn) btn.disabled = false;
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
        if (window.syncKeyboardTiles) window.syncKeyboardTiles();
        var totalDelay = data.result.length * 80 + 175;

        setTimeout(function() {
          if (window.updateKeyboardColors) window.updateKeyboardColors();
          if (data.solved || data.outOfGuesses) {
            classicForm.style.display = 'none';
            var kbEl = document.getElementById('game-keyboard');
            if (kbEl) kbEl.style.display = 'none';
            var actionsEl = document.querySelector('.classic-actions');
            if (actionsEl) actionsEl.style.display = 'none';

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
            if (btn) btn.disabled = false;
          }
        }, totalDelay);
      })
      .catch(function() {
        rejectGuess('classic-board', errorEl, 'Error submitting guess');
        classicSubmitting = false;
        if (btn) btn.disabled = false;
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
        if (data.error) { rejectGuess('aq-board', document.getElementById('aq-error'), data.error); return; }
        if (window.onAqGuessSuccess) { window.onAqGuessSuccess(data); return; }
        window.location.reload();
      })
      .catch(function() { rejectGuess('aq-board', document.getElementById('aq-error'), 'Error'); });
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
        if (data.error) { rejectGuess('knockout-board', document.getElementById('knockout-error'), data.error); return; }
        window.location.reload();
      })
      .catch(function() { rejectGuess('knockout-board', document.getElementById('knockout-error'), 'Error'); });
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
      if (btn) btn.disabled = true;
      errorEl.textContent = '';

      fetch('/games/pokemon/' + gameId + '/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guess: guess })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) {
          rejectGuess('pokemon-board', errorEl, data.error);
          pokemonSubmitting = false;
          if (btn) btn.disabled = false;
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
        if (window.syncKeyboardTiles) window.syncKeyboardTiles();

        var totalDelay = data.result.length * 80 + 175;
        setTimeout(function() {
          if (window.updateKeyboardColors) window.updateKeyboardColors();
          if (data.solved) {
            pokemonForm.style.display = 'none';
            var kbEl2 = document.getElementById('game-keyboard');
            if (kbEl2) kbEl2.style.display = 'none';
            var msg = document.createElement('div');
            msg.className = 'result-message win';
            msg.textContent = 'You got it in ' + data.guessCount + ' guess' + (data.guessCount !== 1 ? 'es' : '') + '! +' + data.score + ' pts';
            pokemonForm.parentNode.insertBefore(msg, pokemonForm);
          } else if (data.outOfGuesses) {
            pokemonForm.style.display = 'none';
            var kbEl2 = document.getElementById('game-keyboard');
            if (kbEl2) kbEl2.style.display = 'none';
            var msg = document.createElement('div');
            msg.className = 'result-message fail';
            msg.innerHTML = 'Out of guesses! The Pokémon was <strong>' + data.answer + '</strong>';
            pokemonForm.parentNode.insertBefore(msg, pokemonForm);
          } else if (data.gameCompleted) {
            pokemonForm.style.display = 'none';
            var kbEl2 = document.getElementById('game-keyboard');
            if (kbEl2) kbEl2.style.display = 'none';
            var msg = document.createElement('div');
            msg.className = 'result-message fail';
            msg.innerHTML = 'Game over! The Pokémon was <strong>' + data.answer + '</strong>';
            pokemonForm.parentNode.insertBefore(msg, pokemonForm);
          } else {
            pokemonSubmitting = false;
            if (btn) btn.disabled = false;
          }
        }, totalDelay);
      })
      .catch(function() {
        rejectGuess('pokemon-board', errorEl, 'Error submitting guess');
        pokemonSubmitting = false;
        if (btn) btn.disabled = false;
      });
    });

  }

  // Pokemon real-time updates via WebSocket
  var pokemonBoard = document.getElementById('pokemon-board');
  if (pokemonBoard && pokemonBoard.getAttribute('data-status') === 'active') {
    var pokemonGameId = (pokemonForm && pokemonForm.getAttribute('data-game-id'))
      || (window.location.pathname.match(/\/games\/pokemon\/(\d+)/) || [])[1];
    if (pokemonGameId) {
      window.wsJoin('pokemon', pokemonGameId, function(data) {
        if (data.status === 'completed') { window.location.reload(); return; }
        updatePokemonPlayers(data);
        updatePokemonGuesses(data);
      });
    }
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

  // Lobby real-time updates via WebSocket
  var lobbySection = document.getElementById('lobby-section');
  if (lobbySection) {
    var lobbyGameType = lobbySection.getAttribute('data-game-type');
    var lobbyGameId   = lobbySection.getAttribute('data-game-id');
    var lobbyCreatedBy = parseInt(lobbySection.getAttribute('data-created-by'), 10);
    window.wsJoin('lobby', lobbyGameType + ':' + lobbyGameId, function(data) {
      if (data.status === 'active') { window.location.reload(); return; }
      if (data.cancelled) { window.location.href = '/games'; return; }
      if (data.players) updateLobbyPlayerList(data.players, data.created_by || lobbyCreatedBy);
    });
  }

  // Friend request notifications
  var friendsPage = document.getElementById('friends-user-id');
  if (friendsPage) {
    window.wsJoin('friends', friendsPage.getAttribute('data-user-id'), function(data) {
      if (data.type === 'friend-request') window.location.reload();
    });
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

  // ── LOBBY HELPERS ─────────────────────────────────────────────
  function updateLobbyPlayerList(players, createdBy) {
    var list = document.querySelector('#lobby-section .member-list');
    if (!list) return;
    list.innerHTML = players.map(function(p) {
      return '<div class="member-card">' +
        '<img src="' + (p.avatar_url || '') + '" alt="" class="member-avatar" onerror="this.style.display=\'none\'">' +
        '<div class="member-info"><strong>' + p.display_name + '</strong></div>' +
        (p.user_id === createdBy ? '<span class="badge">Host</span>' : '') +
        '</div>';
    }).join('');
    if (window.onLobbyPlayersUpdate) window.onLobbyPlayersUpdate(players, createdBy);
  }

  // ── POKEMON REAL-TIME HELPERS ─────────────────────────────────
  function updatePokemonPlayers(data) {
    var list = document.querySelector('.player-status-list');
    if (!list || !data.players) return;
    var maxGuesses = parseInt(list.getAttribute('data-max-guesses'), 10);
    data.players.forEach(function(p) {
      var item = list.querySelector('[data-user-id="' + p.user_id + '"]');
      if (!item) return;
      var rightEl = item.querySelector('.status-badge, .badge.dead, .guess-counter');
      if (p.solved) {
        item.className = 'player-status-item solved';
        var guessLabel = p.guesses_count + ' guess' + (p.guesses_count !== 1 ? 'es' : '');
        if (rightEl && rightEl.classList.contains('status-badge')) {
          rightEl.textContent = guessLabel;
        } else {
          if (rightEl) rightEl.remove();
          var badge = document.createElement('span');
          badge.className = 'badge winner status-badge';
          badge.textContent = guessLabel;
          item.appendChild(badge);
          var pts = document.createElement('span');
          pts.className = 'badge';
          pts.style.cssText = 'background:transparent;color:var(--accent)';
          pts.textContent = '+' + p.score + 'pts';
          item.appendChild(pts);
        }
      } else if (p.guesses_count >= maxGuesses) {
        item.className = 'player-status-item failed';
        if (rightEl) rightEl.textContent = 'Out';
      } else {
        var counter = item.querySelector('.guess-counter');
        if (counter) counter.textContent = p.guesses_count + '/' + maxGuesses;
      }
    });
  }

  function updatePokemonGuesses(data) {
    var feed = document.getElementById('pokemon-guess-feed');
    if (!feed || !data.guesses) return;
    feed.innerHTML = data.guesses.slice().reverse().slice(0, 20).map(function(g) {
      var tiles = g.result.map(function(r) {
        return '<span class="feed-tile feed-tile-' + r.status + '">' + r.letter + '</span>';
      }).join('');
      return '<div class="feed-row"><span class="feed-name">' + g.display_name + '</span>' + tiles + '</div>';
    }).join('');
  }

  // ── KNOCKOUT REAL-TIME ────────────────────────────────────────
  var knockoutBoard = document.getElementById('knockout-board');
  if (knockoutBoard && knockoutBoard.getAttribute('data-status') === 'active') {
    var koGameId = document.getElementById('knockout-guess-form') && document.getElementById('knockout-guess-form').getAttribute('data-game-id');
    if (!koGameId) koGameId = (window.location.pathname.match(/\/games\/knockout\/(\d+)/) || [])[1];
    if (koGameId) {
      window.wsJoin('knockout', koGameId, function(data) {
        if (data.status === 'completed') { window.location.reload(); return; }
        var list = document.querySelector('.player-status-list');
        if (!list || !data.players) return;
        data.players.forEach(function(p) {
          var item = list.querySelector('[data-user-id="' + p.user_id + '"]');
          if (!item) return;
          if (p.status === 'eliminated') {
            item.className = 'player-status-item failed';
            var statusEl = item.querySelector('.ko-status, .ko-score');
            if (statusEl) { statusEl.className = 'badge dead ko-status'; statusEl.textContent = 'Eliminated'; }
          } else {
            var scoreEl = item.querySelector('.ko-score');
            if (scoreEl) scoreEl.textContent = p.total_score + ' pts';
          }
        });
      });
    }
  }


  // ── ON-SCREEN KEYBOARD ────────────────────────────────────────
  (function() {
    var container = document.getElementById('game-keyboard');
    if (!container) return;

    var boardId = container.getAttribute('data-board');
    var inputId = container.getAttribute('data-input');
    var formId  = container.getAttribute('data-form');
    var board = boardId ? document.getElementById(boardId) : null;
    var input = inputId ? document.getElementById(inputId) : null;
    var form  = formId  ? document.getElementById(formId)  : null;
    if (!input || !form) return;

    var ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
    var keyEls = {};

    function mkKey(label, wide) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = wide ? 'key key-wide' : 'key';
      btn.textContent = label;
      return btn;
    }

    function buildKeyboard() {
      var kb = document.createElement('div');
      kb.className = 'keyboard';

      ROWS.forEach(function(letters, ri) {
        var row = document.createElement('div');
        row.className = 'keyboard-row';

        if (ri === 2) {
          var enterKey = mkKey('Enter', true);
          enterKey.addEventListener('click', submitGuess);
          row.appendChild(enterKey);
        }

        letters.split('').forEach(function(ch) {
          var key = mkKey(ch, false);
          key.addEventListener('click', function() { pressLetter(ch); });
          keyEls[ch] = key;
          row.appendChild(key);
        });

        if (ri === 2) {
          var bsKey = mkKey('⌫', true);
          bsKey.addEventListener('click', pressBackspace);
          row.appendChild(bsKey);
        }

        kb.appendChild(row);
      });

      container.appendChild(kb);
    }

    function getWordLength() {
      return parseInt(input.getAttribute('maxlength'), 10) || 5;
    }

    function getActiveRow() {
      return board ? board.querySelector('.row:not([data-filled])') : null;
    }

    function syncActiveTiles() {
      var row = getActiveRow();
      if (!row) return;
      var tiles = row.querySelectorAll('.tile');
      var val = input.value;
      tiles.forEach(function(tile, i) {
        if (i < val.length) {
          tile.textContent = val[i];
          tile.className = 'tile tile-active';
          var c = window.tileColors && window.tileColors[i];
          if (c) tile.style.setProperty('--player-color', c);
          else tile.style.removeProperty('--player-color');
        } else {
          tile.textContent = '';
          tile.className = 'tile tile-empty';
          tile.style.removeProperty('--player-color');
        }
      });
    }

    function pressLetter(ch) {
      if (form.style.display === 'none') return;
      if (input.value.length >= getWordLength()) return;
      input.value += ch;
      syncActiveTiles();
    }

    function pressBackspace() {
      if (form.style.display === 'none') return;
      if (!input.value.length) return;
      input.value = input.value.slice(0, -1);
      syncActiveTiles();
    }

    function submitGuess() {
      if (form.style.display === 'none') return;
      if (input.value.length < getWordLength()) return;
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }

    function computeLetterStates() {
      var states = {};
      var rank = { green: 3, yellow: 2, gray: 1 };
      // Read from ALL boards on the page so multi-board games (zombie) work
      document.querySelectorAll('.board').forEach(function(b) {
        b.querySelectorAll('.row[data-filled] .tile').forEach(function(tile) {
          var letter = tile.textContent.trim().toUpperCase();
          if (!letter) return;
          var status = tile.classList.contains('tile-green') ? 'green'
                     : tile.classList.contains('tile-yellow') ? 'yellow'
                     : tile.classList.contains('tile-gray') ? 'gray'
                     : null;
          if (status && (!states[letter] || rank[status] > rank[states[letter]])) {
            states[letter] = status;
          }
        });
      });
      return states;
    }

    function updateKeyboardColors() {
      var states = computeLetterStates();
      Object.keys(keyEls).forEach(function(ch) {
        keyEls[ch].className = 'key' + (states[ch] ? ' key-' + states[ch] : '');
      });
    }

    window.updateKeyboardColors = updateKeyboardColors;
    window.syncKeyboardTiles = syncActiveTiles;

    buildKeyboard();
    updateKeyboardColors();

    // Physical keyboard support
    document.addEventListener('keydown', function(e) {
      if (form.style.display === 'none') return;
      var active = document.activeElement;
      if (active && active.tagName === 'TEXTAREA') return;
      if (active && active.tagName === 'INPUT' && active !== input) return;
      if (e.key === 'Backspace') { e.preventDefault(); pressBackspace(); }
      else if (e.key === 'Enter') { submitGuess(); }
      else if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); pressLetter(e.key.toUpperCase()); }
    });
  })();

})();
