const request = require('supertest');
const app = require('../src/app');
const { pool } = require('../src/config/database');
const { estimateLiveRemainingWait } = require('../src/services/waitPredictionService');
afterEach(() => jest.restoreAllMocks());
afterAll(() => pool.end());
function setup(status, { arrivedAt = null, busy = false, failNotice = false } = {}) {
  jest.spyOn(pool, 'execute').mockResolvedValue([[{ id: 2, role: 'staff' }]]);
  const connection = {
    beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
    execute: jest.fn(async (sql) => {
      if (sql.includes('SELECT q.id')) return [[{ id: 4, patientId: 7, serviceId: 1, queueNumber: 2, serviceName: 'General', status, arrivedAt }]];
      if (sql.includes("status IN ('called','in_progress')")) return [busy ? [{ id: 8 }] : []];
      if (sql.includes('INSERT INTO notifications') && failNotice) throw new Error('offline');
      return [{ affectedRows: 1 }];
    }),
  };
  jest.spyOn(pool, 'getConnection').mockResolvedValue(connection);
  return connection;
}
const update = status => request(app).patch('/api/staff/queues/4/status').set('Cookie', 'mediq_session=test').send({ status });
test('called patient can be marked not present, with notification and audit record', async () => {
  const db = setup('called');
  expect((await update('not_present')).status).toBe(200);
  const sql = db.execute.mock.calls.map(call => call[0]).join('\n');
  expect(sql).toContain('missed_call_at = CURRENT_TIMESTAMP, arrived_at = NULL');
  expect(sql).toContain('INSERT INTO notifications');
  expect(sql).toContain('INSERT INTO staff_audit_logs');
  expect(db.commit).toHaveBeenCalledTimes(1);
});
test.each(['waiting', 'completed', 'cancelled', 'in_progress'])('%s cannot be marked not present', async status => {
  const db = setup(status);
  expect((await update('not_present')).status).toBe(409);
  expect(db.commit).not.toHaveBeenCalled();
});
test('recall requires a fresh arrival check-in', async () => {
  setup('not_present');
  expect((await update('called')).status).toBe(409);
});
test('recall cannot interrupt a called patient or consultation', async () => {
  setup('not_present', { arrivedAt: '2026-10-20T10:00:00Z', busy: true });
  expect((await update('called')).status).toBe(409);
});
test('arrived patient can be recalled when the service is free', async () => {
  const db = setup('not_present', { arrivedAt: '2026-10-20T10:00:00Z' });
  expect((await update('called')).status).toBe(200);
  expect(db.commit).toHaveBeenCalledTimes(1);
  expect(db.execute.mock.calls.some(call => call[0].includes('called_at = CURRENT_TIMESTAMP'))).toBe(true);
});
test('notification failure rolls back missed-call update', async () => {
  const db = setup('called', { failNotice: true });
  expect((await update('not_present')).status).toBe(503);
  expect(db.rollback).toHaveBeenCalledTimes(1);
  expect(db.commit).not.toHaveBeenCalled();
});
test('paused ticket has no numeric remaining wait', () => {
  expect(estimateLiveRemainingWait({ status: 'not_present', peopleAhead: 0 })).toMatchObject({ remainingWaitMinutes: null, remainingEstimateMethod: 'awaiting-recall' });
});
