// Creates and removes only a disposable database; never edits application data.
require('dotenv').config();
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const request = require('supertest');
const { databaseDateOptions, setClinicTimeZone, clinicDate } = require('../src/config/clinicTime');
const { migrateIntegrity, integrityConstraints } = require('../../database/integrityMigration');

(async () => {
  const database = 'mediq_integrity_check_' + crypto.randomBytes(8).toString('hex');
  assert(/^mediq_integrity_check_[a-f0-9]{16}$/.test(database));
  const owner = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '',
    multipleStatements: true, ...databaseDateOptions,
  });
  let created = false;
  let pool;
  try {
    await setClinicTimeZone(owner);
    await owner.query(`CREATE DATABASE \`${database}\``);
    created = true;
    await owner.query(fs.readFileSync(path.join(__dirname, '../../database/schema.sql'), 'utf8')
      .replace('CREATE DATABASE IF NOT EXISTS mediq', `CREATE DATABASE IF NOT EXISTS \`${database}\``)
      .replace('USE mediq;', `USE \`${database}\`;`));
    await owner.query(fs.readFileSync(path.join(__dirname, '../../database/admin-schema.sql'), 'utf8'));

    // Exercise the upgrade path, not just constraints created by fresh SQL.
    for (const { table, name } of integrityConstraints) await owner.query(`ALTER TABLE \`${table}\` DROP CHECK \`${name}\``);
    assert.equal((await migrateIntegrity(owner)).length, integrityConstraints.length);
    assert.deepEqual(await migrateIntegrity(owner), [], 'The migration must be repeatable');

    process.env.DB_NAME = database;
    process.env.NODE_ENV = 'test';
    process.env.EMAIL_DELIVERY_MODE = 'preview';
    const app = require('../src/app');
    pool = require('../src/config/database').pool;
    const { tokenHash } = require('../src/middleware/authentication');
    const [[clock]] = await pool.execute("SELECT @@session.time_zone AS zone, CURRENT_DATE AS today, CAST('2000-01-01' AS DATE) AS birthDate, CURRENT_TIMESTAMP AS now");
    assert.equal(clock.zone, '+08:00');
    assert.equal(clock.today, clinicDate());
    assert.equal(clock.birthDate, '2000-01-01');
    assert(Math.abs(clock.now.getTime() - Date.now()) < 5000, 'Timestamp decoding must preserve the instant');

    async function account(role, label) {
      const token = crypto.randomBytes(24).toString('hex');
      const [result] = await pool.execute('INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, ?)',
        [label, `${label.replace(/ /g, '').toLowerCase()}@example.invalid`, 'unusable-test-password', role]);
      await pool.execute('INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))', [result.insertId, tokenHash(token)]);
      return { id: result.insertId, cookie: `mediq_session=${token}` };
    }
    const admin = await account('admin', 'Integrity Admin');
    const staffA = await account('staff', 'Integrity Staff A');
    const staffB = await account('staff', 'Integrity Staff B');
    const unusedStaff = await account('staff', 'Unused Staff');
    const patientA = await account('patient', 'Integrity Patient A');
    const patientB = await account('patient', 'Integrity Patient B');
    const [service] = await pool.execute("INSERT INTO clinic_services (name, average_duration_minutes) VALUES ('Integrity queue', 15)");
    const [pausedService] = await pool.execute("INSERT INTO clinic_services (name, average_duration_minutes) VALUES ('Paused queue', 15)");
    async function ticket(patient, serviceId, number, status = 'waiting') {
      const [result] = await pool.execute('INSERT INTO queue_entries (patient_id, service_id, queue_date, queue_number, status, is_test_visit) VALUES (?, ?, CURRENT_DATE, ?, ?, TRUE)', [patient.id, serviceId, number, status]);
      return result.insertId;
    }
    const first = await ticket(patientA, service.insertId, 1);
    const second = await ticket(patientB, service.insertId, 2);
    const paused = await ticket(patientA, pausedService.insertId, 1, 'not_present');
    const status = (user, id, next) => request(app).patch(`/api/staff/queues/${id}/status`).set('Cookie', user.cookie).send({ status: next });
    const api = (method, endpoint, body) => {
      const call = request(app)[method]('/api/admin' + endpoint).set('Cookie', admin.cookie);
      return body ? call.send(body) : call;
    };

    assert.equal((await status(staffA, first, 'called')).status, 200);
    assert.equal((await status(staffB, second, 'called')).status, 409, 'An ordinary call must respect the busy service');
    for (let round = 0; round < 3; round++) {
      await pool.execute("UPDATE queue_entries SET status = 'waiting', called_at = NULL WHERE id IN (?, ?)", [first, second]);
      const results = await Promise.all([status(staffA, first, 'called'), status(staffB, second, 'called')]);
      assert.deepEqual(results.map(result => result.status).sort(), [200, 409], 'Only one concurrent call can succeed');
      const [[{ count }]] = await pool.execute("SELECT COUNT(*) AS count FROM queue_entries WHERE service_id = ? AND status = 'called'", [service.insertId]);
      assert.equal(Number(count), 1);
    }

    assert.equal((await status(staffA, first, 'in_progress')).status, 200);
    const handoff = await Promise.all([
      status(staffB, second, 'called'),
      request(app).post(`/api/staff/queues/${first}/complete-and-call-next`).set('Cookie', staffA.cookie),
    ]);
    assert.deepEqual(handoff.map(result => result.status), [409, 200], 'A competing call must not duplicate the handoff');
    await pool.execute("UPDATE queue_entries SET status = 'not_present', arrived_at = CURRENT_TIMESTAMP WHERE id = ?", [first]);
    await pool.execute("UPDATE queue_entries SET status = 'waiting', called_at = NULL WHERE id = ?", [second]);
    const recall = await Promise.all([status(staffA, first, 'called'), status(staffB, second, 'called')]);
    assert.deepEqual(recall.map(result => result.status).sort(), [200, 409], 'Recall and normal call share the same service guard');

    const blockedService = await api('put', `/services/${pausedService.insertId}`, { name: 'Paused queue', averageDurationMinutes: 15, isActive: false });
    assert.equal(blockedService.status, 409, 'Missed-call tickets prevent service deactivation');
    const [[preservedTicket]] = await pool.execute('SELECT status FROM queue_entries WHERE id = ?', [paused]);
    assert.equal(preservedTicket.status, 'not_present');

    const [[beforeAudit]] = await pool.execute('SELECT COUNT(*) AS count FROM staff_audit_logs WHERE staff_id = ?', [staffA.id]);
    assert(Number(beforeAudit.count) > 0);
    assert.equal((await api('delete', `/staff/${staffA.id}`)).status, 409);
    const [[afterAudit]] = await pool.execute('SELECT COUNT(*) AS count FROM staff_audit_logs WHERE staff_id = ?', [staffA.id]);
    assert.equal(Number(afterAudit.count), Number(beforeAudit.count));
    assert.equal((await api('patch', `/staff/${staffA.id}`, { isActive: false })).status, 200);
    assert.equal((await request(app).get('/api/staff/overview').set('Cookie', staffA.cookie)).status, 401);
    assert.equal((await api('delete', `/staff/${unusedStaff.id}`)).status, 200);
    const [remaining] = await pool.execute('SELECT id FROM users WHERE id = ?', [unusedStaff.id]);
    assert.equal(remaining.length, 0);

    async function rejects(sql, parameters) {
      await assert.rejects(pool.execute(sql, parameters), error => error.code === 'ER_CHECK_CONSTRAINT_VIOLATED');
    }
    await rejects("INSERT INTO clinic_services (name, average_duration_minutes) VALUES ('Invalid duration', 0)");
    await rejects("INSERT INTO clinic_services (name, queue_capacity) VALUES ('Invalid capacity', 0)");
    await rejects('INSERT INTO queue_entries (patient_id, service_id, queue_date, queue_number) VALUES (?, ?, CURRENT_DATE, 0)', [patientA.id, service.insertId]);
    await rejects("INSERT INTO waiting_time_predictions (queue_entry_id, estimated_minutes, model_version) VALUES (?, -1, 'test')", [first]);
    await rejects("INSERT INTO waiting_time_predictions (queue_entry_id, estimated_minutes, actual_wait_minutes, model_version) VALUES (?, 1, -1, 'test')", [first]);
    await rejects('UPDATE clinic_hours SET day_of_week = 7 WHERE day_of_week = 0');
    await rejects("UPDATE clinic_hours SET opens_at = '17:00:00', closes_at = '09:00:00' WHERE day_of_week = 0");
    await rejects('UPDATE clinic_hours SET break_start = NULL WHERE day_of_week = 0');

    // Confirm the migration refuses bad legacy data without deleting it.
    await owner.query('ALTER TABLE clinic_services DROP CHECK ck_service_duration');
    const [legacy] = await owner.query("INSERT INTO clinic_services (name, average_duration_minutes) VALUES ('Legacy invalid fixture', 0)");
    await assert.rejects(migrateIntegrity(owner), /stopped before schema changes/);
    const [[legacyRow]] = await owner.query('SELECT average_duration_minutes AS duration FROM clinic_services WHERE id = ?', [legacy.insertId]);
    assert.equal(legacyRow.duration, 0);
    await owner.execute('DELETE FROM clinic_services WHERE id = ?', [legacy.insertId]);
    assert.deepEqual(await migrateIntegrity(owner), ['ck_service_duration']);
    console.log('MySQL checks passed: concurrent calls/recall/handoff, busy-service rejection, missed-call service protection, audit preservation, unused-account deletion, timezone/date handling, eight enforced constraints, repeatable migration and non-destructive legacy-data refusal.');
  } finally {
    if (pool) await pool.end();
    if (created && /^mediq_integrity_check_[a-f0-9]{16}$/.test(database)) await owner.query(`DROP DATABASE \`${database}\``);
    await owner.end();
    console.log('Disposable integrity-check database removed. Application records were not modified.');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
