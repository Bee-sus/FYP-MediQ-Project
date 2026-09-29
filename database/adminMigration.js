const fs = require('fs');
const path = require('path');

async function migrateAdmin(connection) {
  const sql = fs.readFileSync(path.join(__dirname, 'admin-schema.sql'), 'utf8');
  for (const statement of sql.split(';').map(part => part.trim()).filter(Boolean)) {
    await connection.query(statement);
  }
  const additions = [
    ['users', 'staff_code', 'VARCHAR(30) NULL UNIQUE AFTER phone_number'],
    ['users', 'profile_picture_url', 'VARCHAR(500) NULL AFTER staff_code'],
    ['users', 'must_change_password', 'BOOLEAN NOT NULL DEFAULT FALSE AFTER is_active'],
    ['users', 'email_verified_at', 'TIMESTAMP NULL AFTER must_change_password'],
    ['clinic_services', 'doctor_name', 'VARCHAR(120) NULL AFTER description'],
    ['clinic_services', 'service_details', 'VARCHAR(500) NULL AFTER doctor_name'],
    ['clinic_services', 'queue_capacity', 'INT UNSIGNED NULL AFTER average_duration_minutes'],
    ['waiting_time_predictions', 'people_ahead', 'INT UNSIGNED NULL AFTER predicted_at'],
    ['waiting_time_predictions', 'service_duration_minutes', 'INT UNSIGNED NULL AFTER people_ahead'],
    ['waiting_time_predictions', 'joined_hour', 'TINYINT UNSIGNED NULL AFTER service_duration_minutes'],
    ['waiting_time_predictions', 'joined_weekday', 'TINYINT UNSIGNED NULL AFTER joined_hour'],
    ['waiting_time_predictions', 'actual_wait_minutes', 'DECIMAL(6,2) NULL AFTER joined_weekday'],
    ['appointments', 'reminder_sent_at', 'TIMESTAMP NULL AFTER cancelled_at'],
  ];
  let emailVerificationAdded = false;
  for (const [table, column, definition] of additions) {
    const [rows] = await connection.execute(`SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`, [table, column]);
    if (!Number(rows[0].count)) {
      await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
      if (table === 'users' && column === 'email_verified_at') emailVerificationAdded = true;
    }
  }
  await connection.query('ALTER TABLE users MODIFY COLUMN profile_picture_url MEDIUMTEXT NULL');
  await connection.query(`CREATE TABLE IF NOT EXISTS clinic_settings (id TINYINT UNSIGNED PRIMARY KEY, clinic_name VARCHAR(120) NOT NULL DEFAULT 'MediQ Clinic', address VARCHAR(300) NULL, phone VARCHAR(30) NULL, timezone VARCHAR(60) NOT NULL DEFAULT 'Asia/Kuala_Lumpur') ENGINE=InnoDB`);
  await connection.query('INSERT IGNORE INTO clinic_settings (id) VALUES (1)');
  await connection.query(`CREATE TABLE IF NOT EXISTS email_verification_tokens (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL, token_hash CHAR(64) NOT NULL UNIQUE, expires_at DATETIME NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_verification_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, INDEX idx_verification_expiry (expires_at)) ENGINE=InnoDB`);
  if (emailVerificationAdded) await connection.query('UPDATE users SET email_verified_at = CURRENT_TIMESTAMP WHERE email_verified_at IS NULL');
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
