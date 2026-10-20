const request = require('supertest');
const app = require('../src/app');
const { pool } = require('../src/config/database');
afterEach(() => jest.restoreAllMocks());
afterAll(() => pool.end());

test('arrival requires sign-in', async () => {
  expect((await request(app).post('/api/patient/queues/4/arrive')).status).toBe(401);
});
test('patients can check in only their own active entry today', async () => {
  const execute = jest.spyOn(pool, 'execute').mockResolvedValueOnce([[{ id: 7, role: 'patient' }]])
    .mockResolvedValueOnce([{ affectedRows: 1 }]);
  const response = await request(app).post('/api/patient/queues/4/arrive').set('Cookie', 'mediq_session=test');
  expect(response.status).toBe(200);
  expect(execute.mock.calls[1][0]).toContain('AND patient_id = ?');
  expect(execute.mock.calls[1][0]).toContain("status IN ('waiting','called','not_present')");
  expect(execute.mock.calls[1][0]).toContain('queue_date = CURRENT_DATE');
  expect(execute.mock.calls[1][1]).toEqual([4, 7]);
});
test('closed or unowned entries cannot be checked in', async () => {
  jest.spyOn(pool, 'execute').mockResolvedValueOnce([[{ id: 7, role: 'patient' }]])
    .mockResolvedValueOnce([{ affectedRows: 0 }]).mockResolvedValueOnce([[]]);
  expect((await request(app).post('/api/patient/queues/4/arrive').set('Cookie', 'mediq_session=test')).status).toBe(409);
});
test('repeated check-in preserves the first timestamp', async () => {
  const execute = jest.spyOn(pool, 'execute').mockResolvedValueOnce([[{ id: 7, role: 'patient' }]])
    .mockResolvedValueOnce([{ affectedRows: 0 }]).mockResolvedValueOnce([[{ id: 4 }]]);
  expect((await request(app).post('/api/patient/queues/4/arrive').set('Cookie', 'mediq_session=test')).status).toBe(200);
  expect(execute.mock.calls[1][0]).toContain('COALESCE(arrived_at, CURRENT_TIMESTAMP)');
});
test('staff can confirm arrival at reception', async () => {
  const execute = jest.spyOn(pool, 'execute').mockResolvedValueOnce([[{ id: 2, role: 'staff' }]])
    .mockResolvedValueOnce([{ affectedRows: 1 }]);
  expect((await request(app).post('/api/staff/queues/4/arrive').set('Cookie', 'mediq_session=test')).status).toBe(200);
  expect(execute.mock.calls[1][1]).toEqual([4]);
});
test('patients cannot use the staff arrival endpoint', async () => {
  jest.spyOn(pool, 'execute').mockResolvedValueOnce([[{ id: 7, role: 'patient' }]]);
  expect((await request(app).post('/api/staff/queues/4/arrive').set('Cookie', 'mediq_session=test')).status).toBe(403);
});
test('failed check-in returns a retryable error', async () => {
  jest.spyOn(pool, 'execute').mockResolvedValueOnce([[{ id: 7, role: 'patient' }]])
    .mockRejectedValueOnce(new Error('offline'));
  expect((await request(app).post('/api/patient/queues/4/arrive').set('Cookie', 'mediq_session=test')).status).toBe(503);
});

test.each(['at_clinic', 'remote'])('joining records %s without changing queue numbering', async joinLocation => {
  jest.spyOn(pool, 'execute').mockResolvedValueOnce([[{ id: 7, role: 'patient' }]]);
  const connection = {
    beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
    execute: jest.fn().mockResolvedValueOnce([[{ id: 7 }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ id: 2, name: 'General', averageDurationMinutes: 15 }]])
      .mockResolvedValueOnce([[{ nextNumber: 3 }]])
      .mockResolvedValueOnce([[{ peopleAhead: 2 }]])
      .mockResolvedValueOnce([{ insertId: 81 }])
      .mockResolvedValueOnce([{ insertId: 91 }])
      .mockResolvedValueOnce([{ insertId: 101 }]),
  };
  jest.spyOn(pool, 'getConnection').mockResolvedValueOnce(connection);
  const response = await request(app).post('/api/patient/queues').set('Cookie', 'mediq_session=test')
    .send({ serviceId: 2, joinLocation });
  expect(response.status).toBe(201);
  expect(response.body.queue).toMatchObject({ queueNumber: 3, joinLocation });
  expect(connection.execute.mock.calls[5][1]).toEqual([7, 2, 3, joinLocation, joinLocation, 1]);
  expect(connection.execute.mock.calls[5][0]).toContain("IF(? = 'at_clinic', CURRENT_TIMESTAMP, NULL)");
});

test('invalid joining location is rejected before a transaction', async () => {
  jest.spyOn(pool, 'execute').mockResolvedValueOnce([[{ id: 7, role: 'patient' }]]);
  const connection = jest.spyOn(pool, 'getConnection');
  const response = await request(app).post('/api/patient/queues').set('Cookie', 'mediq_session=test')
    .send({ serviceId: 2, joinLocation: 'elsewhere' });
  expect(response.status).toBe(422);
  expect(connection).not.toHaveBeenCalled();
});
