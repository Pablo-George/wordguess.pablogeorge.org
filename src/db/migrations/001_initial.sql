CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_id TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS friends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  friend_id INTEGER NOT NULL,
  status TEXT CHECK(status IN ('pending', 'accepted', 'blocked')) DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (friend_id) REFERENCES users(id),
  UNIQUE(user_id, friend_id)
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  created_by INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS group_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT CHECK(role IN ('admin', 'member')) DEFAULT 'member',
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(group_id, user_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  scoring_mode TEXT DEFAULT 'daily_classic',
  created_by INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS daily_words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL,
  puzzle_date DATE UNIQUE NOT NULL,
  word_length INTEGER DEFAULT 5,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS daily_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  puzzle_date DATE NOT NULL,
  solved INTEGER DEFAULT 0,
  guesses_count INTEGER DEFAULT 0,
  score INTEGER DEFAULT 0,
  completed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(user_id, puzzle_date)
);

CREATE TABLE IF NOT EXISTS daily_guesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL,
  guess_number INTEGER NOT NULL,
  guess TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (attempt_id) REFERENCES daily_attempts(id)
);

CREATE TABLE IF NOT EXISTS team_battles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER,
  word_id INTEGER NOT NULL,
  status TEXT CHECK(status IN ('waiting', 'active', 'completed', 'cancelled')) DEFAULT 'waiting',
  created_by INTEGER NOT NULL,
  started_at DATETIME,
  completed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id),
  FOREIGN KEY (word_id) REFERENCES daily_words(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS team_battle_players (
  battle_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  team_number INTEGER NOT NULL,
  turn_order INTEGER DEFAULT 0,
  PRIMARY KEY (battle_id, user_id),
  FOREIGN KEY (battle_id) REFERENCES team_battles(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS team_battle_guesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  battle_id INTEGER NOT NULL,
  team_number INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  guess TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (battle_id) REFERENCES team_battles(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS royale_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER,
  status TEXT CHECK(status IN ('waiting', 'active', 'between_rounds', 'completed', 'cancelled')) DEFAULT 'waiting',
  round_time_seconds INTEGER DEFAULT 90,
  current_round INTEGER DEFAULT 0,
  created_by INTEGER NOT NULL,
  started_at DATETIME,
  completed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS royale_players (
  game_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT CHECK(status IN ('alive', 'eliminated')) DEFAULT 'alive',
  eliminated_round INTEGER,
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (game_id, user_id),
  FOREIGN KEY (game_id) REFERENCES royale_games(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS royale_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  round_number INTEGER NOT NULL,
  word_id INTEGER NOT NULL,
  started_at DATETIME,
  ends_at DATETIME,
  FOREIGN KEY (game_id) REFERENCES royale_games(id),
  FOREIGN KEY (word_id) REFERENCES daily_words(id)
);

CREATE TABLE IF NOT EXISTS royale_guesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  round_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  guess TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (game_id) REFERENCES royale_games(id),
  FOREIGN KEY (round_id) REFERENCES royale_rounds(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS word_dictionary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT UNIQUE NOT NULL,
  word_length INTEGER DEFAULT 5
);

CREATE INDEX IF NOT EXISTS idx_friends_user_id ON friends(user_id);
CREATE INDEX IF NOT EXISTS idx_friends_friend_id ON friends(friend_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_attempts_user_date ON daily_attempts(user_id, puzzle_date);
CREATE INDEX IF NOT EXISTS idx_daily_words_date ON daily_words(puzzle_date);
CREATE INDEX IF NOT EXISTS idx_sessions_group_id ON sessions(group_id);
