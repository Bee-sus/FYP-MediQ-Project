async function migrateAppointments(connection) {
  await connection.query(`CREATE TABLE IF NOT EXISTS appointment_booking_lock (id TINYINT UNSIGNED PRIMARY KEY) ENGINE=InnoDB`);
  await connection.query('INSERT IGNORE INTO appointment_booking_lock (id) VALUES (1)');
  await connection.query("ALTER TABLE appointments MODIFY COLUMN status ENUM('pending','approved','rejected','completed','cancelled','reschedule_proposed') NOT NULL DEFAULT 'pending'");
}

module.exports = { migrateAppointments };

if (require.main === module) {
  require('dotenv').config();
  const { pool } = require('../backend/src/config/database');
  (async () => {
    let connection;
    try {
      connection = await pool.getConnection();
      await migrateAppointments(connection);
      const [conflicts] = await connection.query(`SELECT COUNT(*) AS conflictCount FROM (
        SELECT appointment_date, appointment_time FROM appointments
        WHERE status IN ('pending','approved','reschedule_proposed')
        GROUP BY appointment_date, appointment_time HAVING COUNT(*) > 1
      ) conflicts`);
      console.log('Appointment migration complete. Existing conflicting slots:', Number(conflicts[0].conflictCount));
      console.log('Existing appointments and account credentials were preserved.');
    } finally {
      if (connection) connection.release();
      await pool.end();
    }
  })().catch(error => { console.error(`Appointment migration failed: ${error.code || error.message}`); process.exitCode = 1; });
}
