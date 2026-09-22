require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { migrateAppointments } = require('./appointmentMigration');
const { migrateAdmin } = require('./adminMigration');
const { hashPassword, meetsPasswordRules } = require('../backend/src/services/passwordService');

async function seedControlledAccount(connection, role, name, email, password) {
  if (!email && !password) return;
  if (!email || !meetsPasswordRules(password)) throw new Error(`${role.toUpperCase()} seed credentials are incomplete or the password is not strong enough.`);
  const passwordHash = await hashPassword(password);
  await connection.execute(
    `INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), password_hash = VALUES(password_hash), role = VALUES(role), is_active = TRUE`,
    [name, email.toLowerCase(), passwordHash, role],
  );
}

async function addColumnIfMissing(connection, table, column, definition) {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS columnCount
     FROM information_schema.columns
     WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
    [process.env.DB_NAME || 'mediq', table, column],
  );
  if (!Number(rows[0].columnCount)) {
    await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
}

async function setup() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', multipleStatements: true,
  });
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await connection.query(schema);
    await connection.changeUser({ database: process.env.DB_NAME || 'mediq' });
    await addColumnIfMissing(connection, 'queue_entries', 'cancelled_at', 'TIMESTAMP NULL AFTER completed_at');
    await addColumnIfMissing(connection, 'queue_entries', 'cancellation_reason', 'VARCHAR(300) NULL AFTER cancelled_at');
    await addColumnIfMissing(connection, 'queue_entries', 'consultation_started_at', 'TIMESTAMP NULL AFTER called_at');
    await addColumnIfMissing(connection, 'clinic_services', 'is_queue_open', 'BOOLEAN NOT NULL DEFAULT TRUE AFTER is_active');
    await migrateAppointments(connection);
    await migrateAdmin(connection);
    await seedControlledAccount(connection, 'staff', process.env.SEED_STAFF_NAME || 'Clinic Staff', process.env.SEED_STAFF_EMAIL, process.env.SEED_STAFF_PASSWORD);
    await seedControlledAccount(connection, 'admin', process.env.SEED_ADMIN_NAME || 'System Administrator', process.env.SEED_ADMIN_EMAIL, process.env.SEED_ADMIN_PASSWORD);
    console.log('MediQ database schema is ready.');
  } finally { await connection.end(); }
}

setup().catch((error) => { console.error(`Database setup failed: ${error.message}`); process.exitCode = 1; });
