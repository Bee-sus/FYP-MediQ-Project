async function migrateReportQuality(connection) {
  const [rows] = await connection.execute("SELECT COUNT(*) AS columnCount FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='queue_entries' AND column_name='is_test_visit'");
  if (!Number(rows[0].columnCount)) await connection.query('ALTER TABLE queue_entries ADD COLUMN is_test_visit BOOLEAN NULL DEFAULT NULL');
}
module.exports = { migrateReportQuality };
if (require.main === module) {
  require('dotenv').config(); const { pool } = require('../backend/src/config/database');
  (async()=>{let connection;try{connection=await pool.getConnection();await migrateReportQuality(connection);console.log('Visit classification ready; existing visits remain unclassified.');}finally{if(connection)connection.release();await pool.end();}})()
    .catch(error=>{console.error('Migration failed:',error.code||error.message);process.exitCode=1;});
}
