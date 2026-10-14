const request = require('supertest');
jest.mock('../src/config/database', () => ({ pool: { execute: jest.fn(), getConnection: jest.fn() } }));
const { pool } = require('../src/config/database');
const app = require('../src/app');
const { futureSlot, validDate } = require('../src/services/appointmentService');

let connection;
let entry;
let conflict;
function auth(role = 'staff') {
  pool.execute.mockResolvedValue([[{ id: 7, fullName: 'Test User', role }]]);
}
function decide(action, extra = {}) {
  return request(app).patch('/api/staff/appointments/44').set('Cookie', 'mediq_session=test').send({ action, ...extra });
}
beforeEach(() => {
  jest.resetAllMocks();
  auth();
  entry = { id: 44, patientId: 7, status: 'pending', appointmentDate: '2099-10-10', appointmentTime: '10:30' };
  conflict = false;
  connection = {
    beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
    execute: jest.fn(async (sql) => {
      if (sql.includes('FROM clinic_closures')) return [[]];
      if (sql.includes('FROM clinic_hours')) return [Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, isOpen: 1, opensAt: '09:00', closesAt: '17:00', breakStart: '12:00', breakEnd: '14:00' }))];
      if (sql.includes('appointment_booking_lock')) return [[{ id: 1 }]];
      if (sql.includes('id <> ?')) return [conflict ? [{ id: 99 }] : []];
      if (sql.includes('FROM appointments WHERE id = ?')) return [entry ? [entry] : []];
      if (sql.includes('FROM clinic_services')) return [[{ id: 2, name: 'General Consultation' }]];
      if (sql.includes('FROM queue_entries q')) return [[entry]];
      return [{ affectedRows: 1, insertId: 44 }];
    }),
  };
  pool.getConnection.mockResolvedValue(connection);
});

test.each(['2099-02-30', '2099-13-01', 'not-a-date', '2099-2-01'])('rejects impossible date %s', date => {
  expect(validDate(date)).toBe(false);
  expect(futureSlot(date, '10:30')).toBe(false);
});

test('uses Malaysia time for the future-slot boundary', () => {
  jest.useFakeTimers().setSystemTime(new Date('2099-10-10T02:30:00Z'));
  try {
    expect(futureSlot('2099-10-10', '10:30')).toBe(false);
    expect(futureSlot('2099-10-10', '11:00')).toBe(true);
  } finally { jest.useRealTimers(); }
});

test.each(['patient', 'admin'])('denies %s access to staff appointment decisions', async role => {
  auth(role);
  expect((await decide('approve')).status).toBe(403);
  expect(pool.getConnection).not.toHaveBeenCalled();
});

test('requires authentication for availability and staff list', async () => {
  expect((await request(app).get('/api/patient/appointments/availability?date=2099-10-10')).status).toBe(401);
  expect((await request(app).get('/api/staff/appointments')).status).toBe(401);
});

test('approves with notification and audit in the same transaction', async () => {
  expect((await decide('approve')).status).toBe(200);
  expect(connection.execute.mock.calls[0][0]).toContain('appointment_booking_lock');
  expect(connection.execute.mock.calls.some(([sql, params]) => sql.startsWith('UPDATE appointments') && params[0] === 'approved')).toBe(true);
  expect(connection.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO notifications'))).toBe(true);
  expect(connection.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO staff_audit_logs'))).toBe(true);
  expect(connection.commit).toHaveBeenCalledTimes(1);
  expect(connection.release).toHaveBeenCalledTimes(1);
});

test.each(['approve', 'reschedule'])('blocks conflicting %s without writes', async action => {
  conflict = true;
  const result = await decide(action, { reason: 'Doctor unavailable', appointmentDate: '2099-10-11', appointmentTime: '11:00' });
  expect(result.status).toBe(409);
  expect(connection.execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
  expect(connection.rollback).toHaveBeenCalled();
});

test('rejects a second patient booking the reserved slot across services', async () => {
  auth('patient');
  conflict = true;
  const result = await request(app).post('/api/patient/appointments').set('Cookie', 'mediq_session=test')
    .send({ serviceId: 2, appointmentDate: '2099-10-10', appointmentTime: '10:30' });
  expect(result.status).toBe(409);
  expect(connection.commit).not.toHaveBeenCalled();
  const [sql, params] = connection.execute.mock.calls.find(([query]) => query.includes('id <> ?'));
  expect(sql).not.toContain('service_id');
  expect(sql).toContain('FOR UPDATE');
  expect(params).toEqual([0, '2099-10-10', '10:30', 7]);
});

test.each(['reject', 'reschedule'])('%s requires a meaningful reason', async action => {
  expect((await decide(action)).status).toBe(422);
  expect(pool.getConnection).not.toHaveBeenCalled();
});

test('proposes a new time without approving it on behalf of the patient', async () => {
  expect((await decide('reschedule', { reason: 'Doctor unavailable', appointmentDate: '2099-10-11', appointmentTime: '11:00' })).status).toBe(200);
  const [, params] = connection.execute.mock.calls.find(([sql]) => sql.startsWith('UPDATE appointments'));
  expect(params).toEqual(['reschedule_proposed', '2099-10-11', '11:00', 'Doctor unavailable', 44]);
});

test.each(['completed', 'cancelled', 'rejected', 'reschedule_proposed'])('cannot approve a %s appointment', async status => {
  entry.status = status;
  expect((await decide('approve')).status).toBe(409);
  expect(connection.commit).not.toHaveBeenCalled();
});

test('cannot complete a future appointment', async () => {
  entry.status = 'approved';
  expect((await decide('complete')).status).toBe(409);
});

test('completes an approved past appointment', async () => {
  entry.status = 'approved'; entry.appointmentDate = '2020-01-01';
  expect((await decide('complete')).status).toBe(200);
});

test('cannot approve an expired request', async () => {
  entry.appointmentDate = '2020-01-01';
  expect((await decide('approve')).status).toBe(409);
});

test('rolls back if notification persistence fails', async () => {
  const original = connection.execute.getMockImplementation();
  connection.execute.mockImplementation(async (sql, params) => {
    if (sql.includes('INSERT INTO notifications')) throw new Error('Database failure');
    return original(sql, params);
  });
  expect((await decide('approve')).status).toBe(503);
  expect(connection.rollback).toHaveBeenCalled();
  expect(connection.commit).not.toHaveBeenCalled();
  expect(connection.release).toHaveBeenCalled();
});

function respond(decision, extra = {}) {
  auth('patient');
  return request(app).post('/api/patient/appointments/44/respond').set('Cookie', 'mediq_session=test')
    .send({ decision, appointmentDate: '2099-10-10', appointmentTime: '10:30', ...extra });
}

test.each(['accept', 'decline'])('patient can %s the offered time', async decision => {
  entry.status = 'reschedule_proposed';
  expect((await respond(decision)).status).toBe(200);
  const [, params] = connection.execute.mock.calls.find(([sql]) => sql.startsWith('UPDATE appointments'));
  expect(params[0]).toBe(decision === 'accept' ? 'approved' : 'cancelled');
  const [, ownership] = connection.execute.mock.calls.find(([sql]) => sql.includes('FROM appointments WHERE id = ?'));
  expect(ownership).toEqual([44, 7]);
});

test('cannot respond to another patient appointment', async () => {
  entry = null;
  expect((await respond('accept')).status).toBe(404);
  expect(connection.commit).not.toHaveBeenCalled();
});

test('cannot accept a stale proposal or accept twice', async () => {
  entry.status = 'reschedule_proposed';
  expect((await respond('accept', { appointmentTime: '11:00' })).status).toBe(409);
  entry.status = 'approved';
  expect((await respond('accept')).status).toBe(409);
});

test('availability excludes reserved slots and only returns times', async () => {
  auth('patient');
  pool.execute.mockResolvedValueOnce([[{ id: 7, role: 'patient' }]]).mockResolvedValueOnce([[]]).mockResolvedValueOnce([Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, isOpen: 1, opensAt: '09:00', closesAt: '17:00', breakStart: '12:00', breakEnd: '14:00' }))]).mockResolvedValueOnce([[{ time: '10:30' }]]);
  const result = await request(app).get('/api/patient/appointments/availability?date=2099-10-10').set('Cookie', 'mediq_session=test');
  expect(result.status).toBe(200);
  expect(result.body.slots).not.toContain('10:30');
  expect(result.body.slots).toContain('11:00');
  expect(pool.execute.mock.calls[3][0]).toContain('reschedule_proposed');
});

test('availability returns no slots on a special closure date', async () => {
  auth('patient');
  pool.execute.mockResolvedValueOnce([[{ id: 7, role: 'patient' }]]).mockResolvedValueOnce([[{ reason: 'Public holiday' }]]).mockResolvedValueOnce([[]]);
  const result = await request(app).get('/api/patient/appointments/availability?date=2099-10-10').set('Cookie', 'mediq_session=test');
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ slots: [], closureReason: 'Public holiday' });
});

test('staff cancellation records a reason and is terminal', async () => {
  entry = { id: 44, patientId: 7, serviceId: 1, status: 'waiting', queueNumber: 1, serviceName: 'Consultation' };
  const result = await request(app).patch('/api/staff/queues/44/status').set('Cookie', 'mediq_session=test')
    .send({ status: 'cancelled', reason: 'Patient cannot attend' });
  expect(result.status).toBe(200);
  const [, params] = connection.execute.mock.calls.find(([sql]) => sql.startsWith('UPDATE queue_entries'));
  expect(params).toEqual(['cancelled', 'Patient cannot attend', 44]);
  entry.status = 'cancelled';
  expect((await request(app).patch('/api/staff/queues/44/status').set('Cookie', 'mediq_session=test').send({ status: 'called' })).status).toBe(409);
});

test('staff cannot create skipped entries or cancel without a reason', async () => {
  for (const status of ['skipped', 'cancelled']) {
    expect((await request(app).patch('/api/staff/queues/44/status').set('Cookie', 'mediq_session=test').send({ status })).status).toBe(422);
  }
  expect(pool.getConnection).not.toHaveBeenCalled();
});
