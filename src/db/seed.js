const { getDb } = require('./database');
const { migrate } = require('./migrate');

function seed() {
  const db = getDb();
  migrate();
  console.log('Seed complete');
}

if (require.main === module) {
  seed();
  console.log('Done');
}

module.exports = { seed };
