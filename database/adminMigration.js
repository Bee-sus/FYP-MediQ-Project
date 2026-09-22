const fs = require('fs');
const path = require('path');

async function migrateAdmin(connection) {
  const sql = fs.readFileSync(path.join(__dirname, 'admin-schema.sql'), 'utf8');
  for (const statement of sql.split(';').map(part => part.trim()).filter(Boolean)) {
    await connection.query(statement);
  }
}

module.exports = { migrateAdmin };

if (require.main === module) {
  require('dotenv').config();
  const { pool } = require('../backend/src/config/database');
  (async () => {
    let connection;
    try {
      connection = await pool.getConnection();
      await migrateAdmin(connection);
      console.log('Administrator schema ready. Existing accounts, services and appointments preserved.');
    } finally {
      if (connection) connection.release();
      await pool.end();
    }
  })().catch(error => { console.error(`Administrator migration failed: ${error.code || error.message}`); process.exitCode = 1; });
}
