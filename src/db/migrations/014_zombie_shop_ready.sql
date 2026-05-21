ALTER TABLE zombie_games ADD COLUMN last_coins_earned INTEGER DEFAULT 0;
ALTER TABLE zombie_games ADD COLUMN shop_ready TEXT DEFAULT '[]';
ALTER TABLE zombie_rounds ADD COLUMN applied_items TEXT;
