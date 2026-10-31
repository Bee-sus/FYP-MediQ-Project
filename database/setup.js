require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { migrateAppointments } = require('./appointmentMigration');
const { migrateReportQuality } = require('./reportQualityMigration');
const { migratePatientIdentity } = require('./patientIdentityMigration');
const { migrateQueueTools } = require('./queueToolsMigration');
const { migrateMissedCalls } = require('./missedCallMigration');
const { migrateArrival } = require('./arrivalMigration');
const { migrateAdmin } = require('./adminMigration');
const { migrateIntegrity } = require('./integrityMigration');
const { databaseDateOptions, setClinicTimeZone } = require('../backend/src/config/clinicTime');
const { hashPassword, meetsPasswordRules } = require('../backend/src/services/passwordService');

async function seedControlledAccount(connection, role, name, email, password) {
  if (!email && !password) return;
  if (!email || !meetsPasswordRules(password)) throw new Error(`${role.toUpperCase()} seed credentials are incomplete or the password is not strong enough.`);
  const passwordHash = await hashPassword(password);
  await connection.execute(
    `INSERT INTO users (full_name, email, password_hash, role, email_verified_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), password_hash = VALUES(password_hash), role = VALUES(role), is_active = TRUE, email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP)`,
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
    ...databaseDateOptions,
  });
  try {
    await setClinicTimeZone(connection);
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await connection.query(schema);
    await connection.changeUser({ database: process.env.DB_NAME || 'mediq' });
    await setClinicTimeZone(connection);
    await addColumnIfMissing(connection, 'queue_entries', 'cancelled_at', 'TIMESTAMP NULL AFTER completed_at');
    await addColumnIfMissing(connection, 'queue_entries', 'cancellation_reason', 'VARCHAR(300) NULL AFTER cancelled_at');
    await addColumnIfMissing(connection, 'queue_entries', 'consultation_started_at', 'TIMESTAMP NULL AFTER called_at');
    await addColumnIfMissing(connection, 'clinic_services', 'is_queue_open', 'BOOLEAN NOT NULL DEFAULT TRUE AFTER is_active');
    await addColumnIfMissing(connection, 'users', 'staff_code', 'VARCHAR(30) NULL UNIQUE AFTER phone_number');
    await addColumnIfMissing(connection, 'users', 'profile_picture_url', 'VARCHAR(500) NULL AFTER staff_code');
    await addColumnIfMissing(connection, 'clinic_services', 'doctor_name', 'VARCHAR(120) NULL AFTER description');
    await addColumnIfMissing(connection, 'clinic_services', 'service_details', 'VARCHAR(500) NULL AFTER doctor_name');
    await migrateAppointments(connection);
    await migrateAdmin(connection);
    await migrateArrival(connection);
    await migrateMissedCalls(connection);
    await migrateQueueTools(connection);
    await migratePatientIdentity(connection);
    await migrateReportQuality(connection);
    await migrateIntegrity(connection);
    await seedControlledAccount(connection, 'staff', process.env.SEED_STAFF_NAME || 'Clinic Staff', process.env.SEED_STAFF_EMAIL, process.env.SEED_STAFF_PASSWORD);
    await seedControlledAccount(connection, 'admin', process.env.SEED_ADMIN_NAME || 'System Administrator', process.env.SEED_ADMIN_EMAIL, process.env.SEED_ADMIN_PASSWORD);
    console.log('MediQ database schema is ready.');
  } finally { await connection.end(); }
}

setup().catch((error) => { console.error(`Database setup failed: ${error.message}`); process.exitCode = 1; });
