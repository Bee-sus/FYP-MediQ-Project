async function migrateArrival(connection) {
  for (const [column, definition] of [
    ['join_location', "ENUM('at_clinic','remote','unknown') NOT NULL DEFAULT 'unknown'"],
    ['arrived_at', 'TIMESTAMP NULL'],
  ]) {
    const [rows] = await connection.execute('SELECT COUNT(*) AS columnCount FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?', ['queue_entries', column]);
    if (!Number(rows[0].columnCount)) await connection.query(`ALTER TABLE queue_entries ADD COLUMN ${column} ${definition}`);
  }
}
module.exports = { migrateArrival };
if (require.main === module) {
  require('dotenv').config();
  const { pool } = require('../backend/src/config/database');
  (async () => {
    const connection = await pool.getConnection();
    try { await migrateArrival(connection); console.log('Arrival fields ready. Existing queue entries preserved with unspecified arrival status.'); }
    finally { connection.release(); await pool.end(); }
  })().catch(error => { console.error('Arrival migration failed:', error.code || error.message); process.exitCode = 1; });
}
