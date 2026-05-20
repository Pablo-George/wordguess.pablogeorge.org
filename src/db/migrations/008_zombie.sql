CREATE TABLE IF NOT EXISTS zombie_games (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  status          TEXT    NOT NULL DEFAULT 'waiting',
  created_by      INTEGER NOT NULL REFERENCES users(id),
  current_round   INTEGER NOT NULL DEFAULT 1,
  rounds_survived INTEGER NOT NULL DEFAULT 0,
  outcome         TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS zombie_players (
  game_id   INTEGER NOT NULL REFERENCES zombie_games(id),
  user_id   INTEGER NOT NULL REFERENCES users(id),
  joined_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (game_id, user_id)
);

CREATE TABLE IF NOT EXISTS zombie_rounds (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id      INTEGER NOT NULL REFERENCES zombie_games(id),
  round_number INTEGER NOT NULL,
  words        TEXT    NOT NULL,
  max_guesses  INTEGER NOT NULL,
  solved_mask  TEXT    NOT NULL DEFAULT '[]',
  outcome      TEXT
);

CREATE TABLE IF NOT EXISTS zombie_guesses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id      INTEGER NOT NULL REFERENCES zombie_games(id),
  round_id     INTEGER NOT NULL REFERENCES zombie_rounds(id),
  user_id      INTEGER NOT NULL REFERENCES users(id),
  guess        TEXT    NOT NULL,
  results_json TEXT    NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
