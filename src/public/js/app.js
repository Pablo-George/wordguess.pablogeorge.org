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
