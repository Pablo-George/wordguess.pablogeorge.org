ALTER TABLE zombie_games ADD COLUMN coins INTEGER DEFAULT 0;
ALTER TABLE zombie_games ADD COLUMN shop_items TEXT DEFAULT '[]';
ALTER TABLE zombie_games ADD COLUMN shop_selections TEXT DEFAULT '[]';
ALTER TABLE zombie_rounds ADD COLUMN hint_tiles TEXT;
ALTER TABLE zombie_rounds ADD COLUMN safe_guesses INTEGER DEFAULT 0;
