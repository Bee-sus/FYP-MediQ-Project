async function migratePatientIdentity(connection) {
  for (const [column, definition] of [['identification_type', "ENUM('mykad','passport') NULL"], ['identification_number', 'VARCHAR(20) NULL']]) {
    const [rows] = await connection.execute('SELECT COUNT(*) AS columnCount FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?', ['users', column]);
    if (!Number(rows[0].columnCount)) await connection.query(`ALTER TABLE users ADD COLUMN ${column} ${definition}`);
  }
}
module.exports = { migratePatientIdentity };
if (require.main === module) {
  require('dotenv').config();
  const { pool } = require('../backend/src/config/database');
  (async () => { let connection; try { connection = await pool.getConnection(); await migratePatientIdentity(connection); console.log('Patient identification fields ready. Existing accounts preserved.'); } finally { if (connection) connection.release(); await pool.end(); } })()
    .catch(error => { console.error('Migration failed:', error.code || error.message); process.exitCode = 1; });
}
