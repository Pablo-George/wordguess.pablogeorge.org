ALTER TABLE users ADD COLUMN friend_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_friend_code ON users(friend_code);
