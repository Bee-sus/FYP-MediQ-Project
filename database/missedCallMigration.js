async function migrateMissedCalls(connection) {
  const [rows] = await connection.execute("SELECT COLUMN_TYPE AS columnType FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'queue_entries' AND column_name = 'status'");
  if (!String(rows[0]?.columnType).includes("'not_present'")) {
    await connection.query("ALTER TABLE queue_entries MODIFY COLUMN status ENUM('waiting','called','in_progress','completed','skipped','cancelled','not_present') NOT NULL DEFAULT 'waiting'");
  }
  const [columns] = await connection.execute("SELECT COUNT(*) AS columnCount FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'queue_entries' AND column_name = 'missed_call_at'");
  if (!Number(columns[0].columnCount)) await connection.query('ALTER TABLE queue_entries ADD COLUMN missed_call_at TIMESTAMP NULL');
}
module.exports = { migrateMissedCalls };
if (require.main === module) {
  require('dotenv').config();
  const { pool } = require('../backend/src/config/database');
  (async () => {
    let connection;
    try { connection = await pool.getConnection(); await migrateMissedCalls(connection); console.log('Missed-call fields ready. Existing queue entries preserved.'); }
    finally { if (connection) connection.release(); await pool.end(); }
  })().catch(error => { console.error('Missed-call migration failed:', error.code || error.message); process.exitCode = 1; });
}
