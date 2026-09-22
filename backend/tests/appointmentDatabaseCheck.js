// Explicit opt-in: uses the configured MySQL database and removes only its own fixtures.
require('dotenv').config();
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');
const app = require('../src/app');
const { pool } = require('../src/config/database');
const { tokenHash } = require('../src/middleware/authentication');

(async () => {
  const users = [];
  const cookies = [];
  try {
    const [services] = await pool.execute('SELECT id FROM clinic_services WHERE is_active = TRUE LIMIT 2');
    assert(services.length, 'An active clinic service is required');
    const [existing] = await pool.execute("SELECT id FROM appointments WHERE appointment_date IN ('2099-12-30','2099-12-31') AND status IN ('pending','approved','reschedule_proposed')");
    assert.equal(existing.length, 0, 'Test dates must be unused; existing appointments are never modified');
    for (const role of ['patient', 'patient', 'staff']) {
      const nonce = crypto.randomBytes(16).toString('hex');
      const [result] = await pool.execute('INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, ?)',
        ['Appointment verification fixture', `${nonce}@example.invalid`, 'unusable-test-password', role]);
      users.push(result.insertId);
      await pool.execute('INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))', [result.insertId, tokenHash(nonce)]);
      cookies.push(`mediq_session=${nonce}`);
    }
    const results = await Promise.all(cookies.slice(0, 2).map((cookie, index) => request(app)
      .post('/api/patient/appointments').set('Cookie', cookie)
      .send({ serviceId: services[index % services.length].id, appointmentDate: '2099-12-30', appointmentTime: '10:30' })));
    assert.deepEqual(results.map(result => result.status).sort(), [201, 409], 'Exactly one concurrent booking must succeed');
    const winner = results.findIndex(result => result.status === 201);
    const appointmentId = results[winner].body.appointmentId;
    const staff = (body) => request(app).patch(`/api/staff/appointments/${appointmentId}`).set('Cookie', cookies[2]).send(body);
    assert.equal((await staff({ action: 'approve' })).status, 200);
    assert.equal((await staff({ action: 'reschedule', appointmentDate: '2099-12-31', appointmentTime: '11:00', reason: 'Verification schedule change' })).status, 200);
    const available = await request(app).get('/api/patient/appointments/availability?date=2099-12-31').set('Cookie', cookies[winner]);
    assert.equal(available.status, 200);
    assert(!available.body.slots.includes('11:00'), 'Proposed slots remain reserved');
    const respond = (cookie, decision) => request(app).post(`/api/patient/appointments/${appointmentId}/respond`).set('Cookie', cookie)
      .send({ decision, appointmentDate: '2099-12-31', appointmentTime: '11:00' });
    assert.equal((await respond(cookies[1 - winner], 'accept')).status, 404, 'Another patient cannot accept the proposal');
    assert.equal((await respond(cookies[winner], 'accept')).status, 200);
    assert.equal((await respond(cookies[winner], 'accept')).status, 409, 'Repeated acceptance is rejected');
    assert.equal((await request(app).post(`/api/patient/appointments/${appointmentId}/cancel`).set('Cookie', cookies[winner])).status, 200);
    const released = await request(app).get('/api/patient/appointments/availability?date=2099-12-31').set('Cookie', cookies[winner]);
    assert(released.body.slots.includes('11:00'), 'Cancellation releases the reserved slot');
    const [audits] = await pool.execute('SELECT id FROM staff_audit_logs WHERE staff_id = ?', [users[2]]);
    assert.equal(audits.length, 2);
    console.log('MySQL workflow passed: concurrent booking, approval, proposal reservation, ownership, acceptance, cancellation, slot release and audit persistence.');
  } finally {
    for (const id of users) {
      await pool.execute('DELETE FROM notifications WHERE patient_id = ?', [id]);
      await pool.execute('DELETE FROM staff_audit_logs WHERE staff_id = ?', [id]);
      await pool.execute('DELETE FROM appointments WHERE patient_id = ?', [id]);
      await pool.execute('DELETE FROM user_sessions WHERE user_id = ?', [id]);
      await pool.execute('DELETE FROM users WHERE id = ?', [id]);
    }
    await pool.end();
    console.log('Temporary verification records removed.');
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
