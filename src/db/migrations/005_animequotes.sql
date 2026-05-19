CREATE TABLE IF NOT EXISTS animequote_games (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_by  INTEGER NOT NULL REFERENCES users(id),
  status      TEXT    NOT NULL DEFAULT 'waiting',
  anime_name  TEXT    NOT NULL,
  quote_raw   TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS animequote_players (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id   INTEGER NOT NULL REFERENCES animequote_games(id),
  user_id   INTEGER NOT NULL REFERENCES users(id),
  joined_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(game_id, user_id)
);

CREATE TABLE IF NOT EXISTS animequote_words (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id     INTEGER NOT NULL REFERENCES animequote_games(id),
  word_index  INTEGER NOT NULL,
  word        TEXT    NOT NULL,
  word_length INTEGER NOT NULL,
  is_given    INTEGER NOT NULL DEFAULT 0,
  solved      INTEGER NOT NULL DEFAULT 0,
  revealed    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS animequote_guesses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  word_id     INTEGER NOT NULL REFERENCES animequote_words(id),
  game_id     INTEGER NOT NULL REFERENCES animequote_games(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  guess       TEXT    NOT NULL,
  result_json TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
