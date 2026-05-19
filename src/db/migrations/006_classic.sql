CREATE TABLE IF NOT EXISTS classic_games (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  word         TEXT NOT NULL,
  status       TEXT CHECK(status IN ('active', 'won', 'lost')) DEFAULT 'active',
  guesses_count INTEGER DEFAULT 0,
  score        INTEGER DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS classic_guesses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id      INTEGER NOT NULL REFERENCES classic_games(id),
  guess_number INTEGER NOT NULL,
  guess        TEXT NOT NULL,
  result_json  TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_classic_games_user ON classic_games(user_id, status);
