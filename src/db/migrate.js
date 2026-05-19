const fs = require('fs');
const path = require('path');
const { getDb } = require('./database');

function migrate() {
  const db = getDb();
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, run_at DATETIME DEFAULT CURRENT_TIMESTAMP)');

  for (const file of files) {
    const existing = db.prepare('SELECT name FROM _migrations WHERE name = ?').get(file);
    if (!existing) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
      console.log(`Migration ${file} applied`);
    }
  }
  console.log('All migrations applied');
}

if (require.main === module) {
  migrate();
  console.log('Done');
}

module.exports = { migrate };
