const request = require('supertest');
jest.mock('../src/config/database', () => ({ pool: { execute: jest.fn(), getConnection: jest.fn() } }));
const { pool } = require('../src/config/database');
const app = require('../src/app');
const { verifyPassword } = require('../src/services/passwordService');
const { validateHours, slotsForDate } = require('../src/services/clinicScheduleService');

const makeDays = () => Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, isOpen: true, opensAt: '09:00', closesAt: '17:00', breakStart: '12:00', breakEnd: '14:00' }));
let connection;
let existingBookings;
let activeQueues;
let existingStaff;

function asAdmin(method, path, body) {
  const call = request(app)[method]('/api/admin' + path).set('Cookie', 'mediq_session=admin-test');
  return body ? call.send(body) : call;
}

beforeEach(() => {
  jest.resetAllMocks();
  pool.execute.mockResolvedValue([[{ id: 8, role: 'admin', fullName: 'Administrator' }]]);
  existingBookings = [];
  activeQueues = [];
  existingStaff = [{ id: 9 }];
  connection = {
    beginTransaction: jest.fn(), rollback: jest.fn(), commit: jest.fn(), release: jest.fn(),
    execute: jest.fn(async sql => {
      if (sql.includes('appointment_booking_lock')) return [[{ id: 1 }]];
      if (sql.includes('SELECT revision')) return [[{ revision: 3 }]];
      if (sql.includes('FROM appointments')) return [existingBookings];
      if (sql.includes('FROM queue_entries')) return [activeQueues];
      if (sql.includes('FROM users')) return [existingStaff];
      if (sql.includes('FROM clinic_services')) return [[{ id: 2 }]];
      if (sql.includes('FROM clinic_hours')) return [makeDays()];
      return [{ affectedRows: 1, insertId: 9 }];
    }),
  };
  pool.getConnection.mockResolvedValue(connection);
});

test.each(['/overview', '/staff', '/services', '/hours', '/audit'])('requires authentication for %s', async path => {
  expect((await request(app).get('/api/admin' + path)).status).toBe(401);
});

test.each(['staff', 'patient'])('denies all administrator controls to %s', async role => {
  pool.execute.mockResolvedValue([[{ id: 9, role }]]);
  for (const [method, path, body] of [['get', '/audit'], ['post', '/staff', {}], ['put', '/hours', {}], ['put', '/services/2', {}], ['patch', '/staff/9', { isActive: false }]]) {
    expect((await asAdmin(method, path, body)).status).toBe(403);
  }
  expect(pool.getConnection).not.toHaveBeenCalled();
});

test('creates only a staff role, hashes credentials and excludes passwords from audits', async () => {
  const password = 'Clinic-Staff-2026!';
  const result = await asAdmin('post', '/staff', { fullName: 'Test Staff', email: 'STAFF@example.com', password, role: 'admin' });
  expect(result.status).toBe(201);
  const [sql, params] = connection.execute.mock.calls.find(([query]) => query.startsWith('INSERT INTO users'));
  expect(sql).toContain("'staff', TRUE");
  expect(params[1]).toBe('staff@example.com');
  expect(await verifyPassword(password, params[2])).toBe(true);
  const audit = connection.execute.mock.calls.find(([query]) => query.includes('INSERT INTO admin_audit_logs'));
  expect(JSON.stringify(audit)).not.toContain(password);
  expect(result.body).not.toHaveProperty('password');
  expect(connection.commit).toHaveBeenCalled();
});

test('rejects weak staff passwords without starting a transaction', async () => {
  expect((await asAdmin('post', '/staff', { fullName: 'Test Staff', email: 'staff@example.com', password: 'weak' })).status).toBe(422);
  expect(pool.getConnection).not.toHaveBeenCalled();
});

test('deactivation revokes sessions and retains the account and history', async () => {
  expect((await asAdmin('patch', '/staff/9', { isActive: false })).status).toBe(200);
  expect(connection.execute.mock.calls.find(([sql]) => sql.startsWith('DELETE FROM user_sessions'))[1]).toEqual([9]);
  expect(connection.execute.mock.calls.some(([sql]) => sql.startsWith('DELETE FROM users'))).toBe(false);
  expect(connection.execute.mock.calls[0][0]).toContain("role = 'staff'");
  expect(connection.commit).toHaveBeenCalled();
});

test('cannot deactivate administrators or patients through the staff endpoint', async () => {
  existingStaff = [];
  expect((await asAdmin('patch', '/staff/8', { isActive: false })).status).toBe(404);
  expect(connection.commit).not.toHaveBeenCalled();
});

test('authentication rejects a deactivated user with a stale session', async () => {
  pool.execute.mockResolvedValue([[]]);
  expect((await asAdmin('get', '/overview')).status).toBe(401);
  expect(pool.execute.mock.calls[0][0]).toContain('u.is_active = TRUE');
});

const service = { name: 'Test consultation', description: 'Test description', averageDurationMinutes: 20, isActive: false };
test.each(['queue', 'appointment'])('blocks service deactivation with an active %s', async type => {
  if (type === 'queue') activeQueues = [{ id: 1 }]; else existingBookings = [{ id: 2 }];
  expect((await asAdmin('put', '/services/2', service)).status).toBe(409);
  expect(connection.execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE clinic_services'))).toBe(false);
  expect(connection.rollback).toHaveBeenCalled();
});

test('deactivates an unused service and closes its queue', async () => {
  expect((await asAdmin('put', '/services/2', service)).status).toBe(200);
  const [sql, params] = connection.execute.mock.calls.find(([query]) => query.startsWith('UPDATE clinic_services'));
  expect(sql).toContain('is_queue_open = IF(?, is_queue_open, FALSE)');
  expect(params.slice(-3)).toEqual([false, false, 2]);
});

test.each([0, -1, 241, 1.5])('rejects invalid service duration %s', async duration => {
  expect((await asAdmin('post', '/services', { ...service, averageDurationMinutes: duration })).status).toBe(422);
});

test('hours exclude closed weekdays and breaks', () => {
  const days = makeDays();
  const date = '2099-10-10';
  expect(validateHours(days)).toBeNull();
  expect(slotsForDate(days, date)).toContain('11:30');
  expect(slotsForDate(days, date)).not.toContain('12:00');
  expect(slotsForDate(days, date)).not.toContain('17:00');
  days[new Date(date).getUTCDay()].isOpen = false;
  expect(slotsForDate(days, date)).toEqual([]);
});

test.each([
  { opensAt: '17:00', closesAt: '09:00' },
  { opensAt: '09:15' },
  { breakStart: '08:00' },
  { breakEnd: null },
  { breakStart: '09:00', breakEnd: '17:00' },
])('rejects inconsistent weekly hours %j', update => {
  const days = makeDays(); Object.assign(days[0], update);
  expect(validateHours(days)).not.toBeNull();
});

test('rejects duplicate weekdays and missing days', () => {
  const days = makeDays(); days[0].dayOfWeek = 1;
  expect(validateHours(days)).not.toBeNull();
  expect(validateHours([])).not.toBeNull();
});

test('refuses hours that would invalidate an existing appointment', async () => {
  existingBookings = [{ appointmentDate: '2099-10-10', appointmentTime: '09:00' }];
  const days = makeDays().map(day => ({ ...day, opensAt: '10:00' }));
  expect((await asAdmin('put', '/hours', { revision: 3, days })).status).toBe(409);
  expect(connection.execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE clinic_hours'))).toBe(false);
});

test('refuses a stale administrator schedule revision', async () => {
  expect((await asAdmin('put', '/hours', { revision: 2, days: makeDays() })).status).toBe(409);
  expect(connection.commit).not.toHaveBeenCalled();
});

test('saves a valid schedule under the shared booking lock with an audit record', async () => {
  expect((await asAdmin('put', '/hours', { revision: 3, days: makeDays() })).status).toBe(200);
  expect(connection.execute.mock.calls[0][0]).toContain('appointment_booking_lock');
  expect(connection.execute.mock.calls.filter(([sql]) => sql.startsWith('UPDATE clinic_hours'))).toHaveLength(7);
  expect(connection.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO admin_audit_logs'))).toBe(true);
  expect(connection.commit).toHaveBeenCalled();
});

test('rolls back a configuration change if audit persistence fails', async () => {
  const original = connection.execute.getMockImplementation();
  connection.execute.mockImplementation((sql, params) => {
    if (sql.includes('INSERT INTO admin_audit_logs')) throw new Error('Unavailable');
    return original(sql, params);
  });
  expect((await asAdmin('put', '/services/2', service)).status).toBe(503);
  expect(connection.rollback).toHaveBeenCalled();
  expect(connection.commit).not.toHaveBeenCalled();
  expect(connection.release).toHaveBeenCalled();
});

test('audit pages are bounded and validate their offset', async () => {
  expect((await asAdmin('get', '/audit?page=-1')).status).toBe(422);
  pool.execute.mockResolvedValueOnce([[{ id: 8, role: 'admin' }]]).mockResolvedValueOnce([Array.from({ length: 26 }, (_, id) => ({ id }))]);
  const result = await asAdmin('get', '/audit?page=2');
  expect(result.status).toBe(200);
  expect(result.body.items).toHaveLength(25);
  expect(result.body.hasMore).toBe(true);
});
