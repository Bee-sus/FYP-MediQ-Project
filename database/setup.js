require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
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

async function setup() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', multipleStatements: true,
  });
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await connection.query(schema);
    await connection.changeUser({ database: process.env.DB_NAME || 'mediq' });
    await seedControlledAccount(connection, 'staff', process.env.SEED_STAFF_NAME || 'Clinic Staff', process.env.SEED_STAFF_EMAIL, process.env.SEED_STAFF_PASSWORD);
    await seedControlledAccount(connection, 'admin', process.env.SEED_ADMIN_NAME || 'System Administrator', process.env.SEED_ADMIN_EMAIL, process.env.SEED_ADMIN_PASSWORD);
    console.log('MediQ database schema is ready.');
  } finally { await connection.end(); }
}

setup().catch((error) => { console.error(`Database setup failed: ${error.message}`); process.exitCode = 1; });
