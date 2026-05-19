CREATE TABLE IF NOT EXISTS knockout_games (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  created_by    INTEGER NOT NULL REFERENCES users(id),
  status        TEXT    NOT NULL DEFAULT 'waiting',
  current_round INTEGER NOT NULL DEFAULT 0,
  round_ends_at TEXT,
  winner_id     INTEGER REFERENCES users(id),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS knockout_players (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id          INTEGER NOT NULL REFERENCES knockout_games(id),
  user_id          INTEGER NOT NULL REFERENCES users(id),
  status           TEXT    NOT NULL DEFAULT 'active',
  total_score      INTEGER NOT NULL DEFAULT 0,
  eliminated_round INTEGER,
  joined_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(game_id, user_id)
);

CREATE TABLE IF NOT EXISTS knockout_rounds (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id      INTEGER NOT NULL REFERENCES knockout_games(id),
  round_number INTEGER NOT NULL,
  word         TEXT    NOT NULL,
  started_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  ended_at     TEXT,
  UNIQUE(game_id, round_number)
);

CREATE TABLE IF NOT EXISTS knockout_guesses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id    INTEGER NOT NULL REFERENCES knockout_rounds(id),
  game_id     INTEGER NOT NULL REFERENCES knockout_games(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  guess       TEXT    NOT NULL,
  result_json TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS knockout_round_scores (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id      INTEGER NOT NULL REFERENCES knockout_rounds(id),
  game_id       INTEGER NOT NULL REFERENCES knockout_games(id),
  user_id       INTEGER NOT NULL REFERENCES users(id),
  score         INTEGER NOT NULL DEFAULT 0,
  solved        INTEGER NOT NULL DEFAULT 0,
  guesses_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(round_id, user_id)
);
