async function migrateQueueTools(connection) {
  for (const [column, definition] of [['delay_notice', 'VARCHAR(300) NULL'], ['delay_notice_updated_at', 'TIMESTAMP NULL']]) {
    const [rows] = await connection.execute('SELECT COUNT(*) AS columnCount FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?', ['clinic_services', column]);
    if (!Number(rows[0].columnCount)) await connection.query(`ALTER TABLE clinic_services ADD COLUMN ${column} ${definition}`);
  }
}
module.exports = { migrateQueueTools };
if (require.main === module) {
  require('dotenv').config();
  const { pool } = require('../backend/src/config/database');
  (async () => { let connection; try { connection = await pool.getConnection(); await migrateQueueTools(connection); console.log('Service notice fields ready.'); } finally { if (connection) connection.release(); await pool.end(); } })()
    .catch(error => { console.error('Migration failed:', error.code || error.message); process.exitCode = 1; });
}
