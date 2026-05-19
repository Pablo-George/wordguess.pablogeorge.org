CREATE TABLE IF NOT EXISTS pokemon_games (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  created_by    INTEGER NOT NULL REFERENCES users(id),
  status        TEXT    NOT NULL DEFAULT 'waiting',
  pokemon_name  TEXT,
  pokemon_index INTEGER,
  word_length   INTEGER,
  max_guesses   INTEGER NOT NULL DEFAULT 8,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pokemon_game_players (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id       INTEGER NOT NULL REFERENCES pokemon_games(id),
  user_id       INTEGER NOT NULL REFERENCES users(id),
  solved        INTEGER NOT NULL DEFAULT 0,
  guesses_count INTEGER NOT NULL DEFAULT 0,
  score         INTEGER NOT NULL DEFAULT 0,
  joined_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(game_id, user_id)
);

CREATE TABLE IF NOT EXISTS pokemon_game_guesses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id     INTEGER NOT NULL REFERENCES pokemon_games(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  guess       TEXT    NOT NULL,
  result_json TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
