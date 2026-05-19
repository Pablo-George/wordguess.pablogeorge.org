CREATE TABLE IF NOT EXISTS lobby_heartbeats (
  game_type TEXT    NOT NULL,
  game_id   INTEGER NOT NULL,
  last_seen TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (game_type, game_id)
);
