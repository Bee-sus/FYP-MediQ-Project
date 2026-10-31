const request = require('supertest');
const app = require('../src/app');
const { pool } = require('../src/config/database');
const { hashPassword, verifyPassword, meetsPasswordRules } = require('../src/services/passwordService');

describe('system endpoints', () => {
  afterAll(async () => {
    await pool.end();
  });

  test('a sign-out database failure returns a retryable error without clearing the session cookie', async () => {
    const execute = jest.spyOn(pool, 'execute')
      .mockResolvedValueOnce([[{ id: 1, role: 'patient' }]])
      .mockRejectedValueOnce(new Error('Temporary database failure'));
    try {
      const response = await request(app).post('/api/auth/logout').set('Cookie', 'mediq_session=test');
      expect(response.status).toBe(503);
      expect(response.body.error).toContain('Sign-out could not be completed');
      expect(response.headers['set-cookie']).toBeUndefined();
    } finally { execute.mockRestore(); }
  });

  test.each(['get','post'])('missing API routes return JSON for %s requests',async method=>{
    const response=await request(app)[method]('/api/unknown-feature');
    expect(response.status).toBe(404);expect(response.headers['content-type']).toContain('application/json');expect(response.body.code).toBe('API_NOT_FOUND');
  });
  test('malformed JSON produces a readable API error',async()=>{
    const response=await request(app).post('/api/auth/login').set('Content-Type','application/json').send('{broken');
    expect(response.status).toBe(400);expect(response.body.error).toContain('could not be read');
  });

  test('returns the current project milestone', async () => {
    const response = await request(app).get('/api/project-status');

    expect(response.statusCode).toBe(200);
    expect(response.body.milestone).toBe('Administrator portal');
    expect(response.body.completed.length).toBeGreaterThan(0);
  });

  test('returns the available clinic services', async () => {
    const execute = jest.spyOn(pool, 'execute').mockResolvedValueOnce([[{ id: 1, name: 'General Consultation', averageDurationMinutes: 15, isQueueOpen: 1 }]]);
    const response = await request(app).get('/api/services');

    expect(response.statusCode).toBe(200);
    expect(response.body.source).toBe('database');
    expect(response.body.services).toHaveLength(1);
    expect(response.body.services[0]).toMatchObject({
      name: 'General Consultation',
      averageDurationMinutes: 15,
      availability: 'Available',
    });
    execute.mockRestore();
  });

  test('shows patients current availability and estimated wait for each open queue', async () => {
    const execute = jest.spyOn(pool, 'execute')
      .mockResolvedValueOnce([[{ id: 9, fullName: 'Test Patient', role: 'patient' }]])
      .mockResolvedValueOnce([[
        { id: 1, name: 'General Consultation', averageDurationMinutes: 15, queueCapacity: 8, isQueueOpen: 1, activePatients: 2, lastQueueNumber: 6 },
        { id: 2, name: 'Dental Consultation', averageDurationMinutes: 20, queueCapacity: 3, isQueueOpen: 1, activePatients: 3, lastQueueNumber: 3 },
        { id: 3, name: 'Specialist Consultation', averageDurationMinutes: 25, queueCapacity: null, isQueueOpen: 0, activePatients: 1, lastQueueNumber: 1 },
      ]]);

    const response = await request(app).get('/api/patient/queues/availability').set('Cookie', 'mediq_session=patient-token');

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.services).toMatchObject([
      { id: 1, activePatients: 2, isQueueOpen: true, estimatedWaitMinutes: 30, estimateSource: 'baseline-average-duration-v1' },
      { id: 2, activePatients: 3, isQueueOpen: true, estimatedWaitMinutes: null },
      { id: 3, activePatients: 1, isQueueOpen: false, estimatedWaitMinutes: null },
    ]);
    expect(execute.mock.calls[1][0]).toContain('COUNT(CASE WHEN q.status IN');
    expect(execute.mock.calls[1][0]).toContain('MAX(q.queue_number)');
    execute.mockRestore();
  });

  test('serves the completed homepage feature sections', async () => {
    const response = await request(app).get('/');

    expect(response.statusCode).toBe(200);
    expect(response.text).toContain('Smart queue management');
    expect(response.text).toContain('Book appointments');
    expect(response.text).toContain('Instant notifications');
    expect(response.text).toContain('Three simple steps');
    expect(response.text).toContain('data-role="patient"');
    expect(response.text).toContain('data-role="staff"');
    expect(response.text).toContain('data-role="admin"');
    expect(response.text).toContain('Clinic name pending');
    expect(response.text).not.toContain('Development progress');
    expect(response.text).not.toContain('Database not connected');
  });

  test.each([
    ['/patient-login.html', 'Patient sign in'],
    ['/register.html', 'Patient registration'],
    ['/staff-login.html', 'Staff sign in'],
    ['/admin-login.html', 'Administrator sign in'],
    ['/terms.html', 'Terms and Conditions &amp; Privacy Notice'],
    ['/forgot-password.html', 'Forgot your password?'],
  ])('serves the authentication page %s', async (path, heading) => {
    const response = await request(app).get(path);

    expect(response.statusCode).toBe(200);
    expect(response.text).toContain(heading);
  });

  test('serves patient-only registration with accessible validation and legal consent', async () => {
    const response = await request(app).get('/register.html');

    expect(response.statusCode).toBe(200);
    expect(response.text).toContain('data-auth-form="register"');
    expect(response.text).toContain('minlength="12"');
    expect(response.text).toContain('id="password-requirements"');
    expect(response.text).toContain('data-password-toggle="password"');
    expect(response.text).toContain('aria-describedby="terms-error"');
    expect(response.text).toContain('href="/terms.html"');
    expect(response.text).not.toContain('Staff registration');
    expect(response.text).not.toContain('Administrator registration');
  });

  test('homepage role controls point to three separate sign-in pages', async () => {
    const response = await request(app).get('/app.js');

    expect(response.text).toContain("href: '/patient-login.html'");
    expect(response.text).toContain("href: '/staff-login.html'");
    expect(response.text).toContain("href: '/admin-login.html'");
    expect(response.text).toContain("registerButton.hidden = role !== 'patient'");
  });

  test.each(['/patient-login.html', '/staff-login.html', '/admin-login.html'])('%s includes an accessible password visibility control', async (path) => {
    const response = await request(app).get(path);
    expect(response.text).toContain('data-password-toggle="password"');
    expect(response.text).toContain('aria-label="Show password"');
  });

  test.each(['/staff-login.html'])('%s lets an unverified account request another link', async (path) => {
    const response = await request(app).get(path);
    expect(response.statusCode).toBe(200);
    expect(response.text).toContain('class="resend-verification"');
    expect(response.text).toContain('Get a new verification link');
  });

  test('hashes and verifies strong passwords without storing plaintext', async () => {
    const password = 'Strong-Patient-2026!';
    const hash = await hashPassword(password);

    expect(meetsPasswordRules(password)).toBe(true);
    expect(hash).not.toContain(password);
    expect(await verifyPassword(password, hash)).toBe(true);
    expect(await verifyPassword('Wrong-Password-2026!', hash)).toBe(false);
  });

  test('registers valid public accounts as patients only', async () => {
    const execute = jest.spyOn(pool, 'execute')
      .mockResolvedValueOnce([{ insertId: 42 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    const response = await request(app).post('/api/auth/register').send({
      fullName: 'Test Patient', email: 'patient@example.com', phone: '+60 12-345 6789',
      birthDate: '2000-01-01', gender: 'prefer-not-to-say', password: 'Strong-Patient-2026!',
      confirmPassword: 'Strong-Patient-2026!', terms: true, role: 'admin',
    });

    expect(response.statusCode).toBe(201);
    expect(response.body).toMatchObject({ userId: 42, requiresVerification: true });
    expect(response.body.verificationMethod).toBe('otp');
    expect(response.body.verificationSession).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.body).not.toHaveProperty('verificationPreviewUrl');
    expect(execute.mock.calls[0][0]).toContain("'patient'");
    expect(execute.mock.calls[0][1][2]).not.toContain('Strong-Patient-2026!');
    execute.mockRestore();
  });

  test('rejects registration before querying MySQL when fields are invalid', async () => {
    const execute = jest.spyOn(pool, 'execute');
    const response = await request(app).post('/api/auth/register').send({ email: 'invalid', password: 'weak' });

    expect(response.statusCode).toBe(422);
    expect(response.body.fields).toHaveProperty('email');
    expect(response.body.fields).toHaveProperty('terms');
    expect(execute).not.toHaveBeenCalled();
    execute.mockRestore();
  });

  test('creates a secure session only through the account correct role portal', async () => {
    const passwordHash = await hashPassword('Strong-Staff-2026!');
    const execute = jest.spyOn(pool, 'execute')
      .mockResolvedValueOnce([[{ id: 7, full_name: 'Clinic Staff', email: 'staff@example.com', password_hash: passwordHash, role: 'staff', is_active: 1 }]])
      .mockResolvedValueOnce([{ insertId: 9 }]);
    const response = await request(app).post('/api/auth/login').send({ email: 'staff@example.com', password: 'Strong-Staff-2026!', role: 'staff' });

    expect(response.statusCode).toBe(200);
    expect(response.body.redirect).toBe('/staff-dashboard.html');
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Strict');
    expect(execute).toHaveBeenCalledTimes(2);
    execute.mockRestore();
  });

  test('serves the authenticated patient dashboard interface', async () => {
    const response = await request(app).get('/patient-dashboard.html');
    expect(response.statusCode).toBe(200);
    expect(response.text).toContain('Your queue');
    expect(response.text).toContain('Plan your visit');
    expect(response.text).toContain('Queue history');
    expect(response.text).toContain('patient-dashboard.js');
  });

  test('serves all five separate staff pages with report and profile navigation', async () => {
    const response = await request(app).get('/staff-dashboard.html');
    expect(response.statusCode).toBe(200);
    expect(response.text).toContain('Clinic overview');
    expect(response.text).toContain('href="/staff-queue.html"');
    expect(response.text).toContain('href="/staff-appointments.html"');
    expect(response.text).toContain('href="/staff-reports.html"');
    expect(response.text).toContain('href="/staff-profile.html"');
    expect(response.text).not.toContain('id="service-queues"');
    expect(response.text).toContain('staff-dashboard.js');

    const queuePage = await request(app).get('/staff-queue.html');
    expect(queuePage.statusCode).toBe(200);
    expect(queuePage.text).toContain('Live service queues');
    expect(queuePage.text).toContain('id="service-queues"');
    expect(queuePage.text).not.toContain('id="staff-appointments"');

    const appointmentsPage = await request(app).get('/staff-appointments.html');
    expect(appointmentsPage.statusCode).toBe(200);
    expect(appointmentsPage.text).toContain('Manage appointments');
    expect(appointmentsPage.text).toContain('id="staff-appointments"');
    expect(appointmentsPage.text).toContain('id="appointment-filters"');
    expect(appointmentsPage.text).not.toContain('id="service-queues"');

    const reportsPage = await request(app).get('/staff-reports.html');
    expect(reportsPage.statusCode).toBe(200);
    expect(reportsPage.text).toContain('id="report-form"');
    expect(reportsPage.text).toContain('staff-reports.js');

    const profilePage = await request(app).get('/staff-profile.html');
    expect(profilePage.statusCode).toBe(200);
    expect(profilePage.text).toContain('id="staff-profile-form"');
    expect(profilePage.text).toContain('id="staff-password-form"');
  });

  test('generates a staff report from queue activity for the requested dates', async () => {
    const execute = jest.spyOn(pool, 'execute')
      .mockResolvedValueOnce([[{ id: 7, fullName: 'Clinic Staff', role: 'staff' }]])
      .mockResolvedValueOnce([[{"id":1,"serviceId":2,"queueNumber":1,"serviceName":"Dental Consultation","isTestVisit":0,"status":"completed","consultationStartedAt":"2026-09-01","waitMinutes":12,"consultationMinutes":18,"predictedMinutes":11,"predictionModel":"operational-f4-hist-gradient-boosting-v1"},{"id":2,"serviceId":2,"queueNumber":2,"serviceName":"Dental Consultation","isTestVisit":0,"status":"completed","consultationStartedAt":"2026-09-01","waitMinutes":12,"consultationMinutes":18,"predictedMinutes":18,"predictionModel":"operational-f4-hist-gradient-boosting-v1"},{"id":3,"serviceId":2,"queueNumber":3,"serviceName":"Dental Consultation","isTestVisit":0,"status":"cancelled","consultationStartedAt":"2026-09-01","waitMinutes":12,"predictedMinutes":12,"predictionModel":"baseline-average-duration-v1"}]]);

    const response = await request(app).get('/api/staff/reports?from=2026-09-01&to=2026-09-30').set('Cookie', 'mediq_session=staff-token');
    expect(response.statusCode).toBe(200);
    expect(response.body.summary.averageWaitMinutes).toBe(12);
    expect(response.body.services).toHaveLength(1);
    expect(response.body.predictionPerformance).toEqual({
      measuredVisits: 3, modelVisits: 2, fallbackVisits: 1, meanAbsoluteErrorMinutes: 3.5, withinFiveMinutes: 1,
      services: [{ serviceName: 'Dental Consultation', measuredVisits: 2, meanAbsoluteErrorMinutes: 3.5, withinFiveMinutes: 1 }],
    });
    expect(execute.mock.calls[1][1]).toEqual(['2026-09-01', '2026-09-30']);
    expect(execute.mock.calls[1][0]).toContain('TIMESTAMPDIFF(SECOND,q.joined_at,q.consultation_started_at)');
    expect(execute.mock.calls[1][1]).toEqual(['2026-09-01', '2026-09-30']);
    execute.mockRestore();
  });

  test('downloads a separately generated staff PDF report', async () => {
    const execute = jest.spyOn(pool, 'execute')
      .mockResolvedValueOnce([[{ id: 7, fullName: 'Clinic Staff', role: 'staff' }]])
      .mockResolvedValueOnce([[{"id":1,"serviceId":2,"queueNumber":1,"serviceName":"Dental Consultation","isTestVisit":0,"status":"completed","consultationStartedAt":"2026-09-01","waitMinutes":12,"consultationMinutes":18,"predictedMinutes":11,"predictionModel":"operational-f4-hist-gradient-boosting-v1"},{"id":2,"serviceId":2,"queueNumber":2,"serviceName":"Dental Consultation","isTestVisit":0,"status":"completed","consultationStartedAt":"2026-09-01","waitMinutes":12,"consultationMinutes":18,"predictedMinutes":18,"predictionModel":"operational-f4-hist-gradient-boosting-v1"},{"id":3,"serviceId":2,"queueNumber":3,"serviceName":"Dental Consultation","isTestVisit":0,"status":"cancelled","consultationStartedAt":"2026-09-01","waitMinutes":12,"predictedMinutes":12,"predictionModel":"baseline-average-duration-v1"}]]);

    const response = await request(app)
      .get('/api/staff/reports/pdf?from=2026-09-01&to=2026-09-30')
      .set('Cookie', 'mediq_session=staff-token');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/pdf/);
    expect(response.headers['content-disposition']).toContain('mediq-queue-report-2026-09-01-to-2026-09-30.pdf');
    expect(response.body.subarray(0, 4).toString()).toBe('%PDF');
    expect(response.body.length).toBeGreaterThan(1000);
    expect(execute.mock.calls[1][1]).toEqual(['2026-09-01', '2026-09-30']);
    execute.mockRestore();
  });

  test('rejects an invalid staff report date range', async () => {
    const response = await request(app).get('/api/staff/reports?from=2026-09-31&to=2026-10-01');
    expect(response.statusCode).toBe(401);
    const execute = jest.spyOn(pool, 'execute').mockResolvedValueOnce([[{ id: 7, fullName: 'Clinic Staff', role: 'staff' }]]);
    const signedIn = await request(app).get('/api/staff/reports?from=2026-09-31&to=2026-10-01').set('Cookie', 'mediq_session=staff-token');
    expect(signedIn.statusCode).toBe(422);
    execute.mockRestore();
  });

  test('loads the staff profile from the current account', async () => {
    const execute = jest.spyOn(pool, 'execute')
      .mockResolvedValueOnce([[{ id: 7, fullName: 'Clinic Staff', role: 'staff' }]])
      .mockResolvedValueOnce([[{ staffCode: 'STF-007', fullName: 'Clinic Staff', email: 'staff@example.com', phone: '0123456789', profilePictureUrl: null }]]);
    const response = await request(app).get('/api/staff/profile').set('Cookie', 'mediq_session=staff-token');
    expect(response.statusCode).toBe(200);
    expect(response.body.profile.staffCode).toBe('STF-007');
    execute.mockRestore();
  });

  test('protects Staff operations from unauthenticated requests', async () => {
    const response = await request(app).get('/api/staff/queues');
    expect(response.statusCode).toBe(401);
  });

  test('shows staff the same changing wait estimate alongside the initial ML estimate', async () => {
    const execute = jest.spyOn(pool, 'execute')
      .mockResolvedValueOnce([[{ id: 7, fullName: 'Clinic Staff', role: 'staff' }]])
      .mockResolvedValueOnce([[{ id: 2, name: 'Dental Consultation', isQueueOpen: 1 }]])
      .mockResolvedValueOnce([[
        { id: 82, queueNumber: 2, status: 'waiting', serviceId: 2, patientName: 'Test Patient',
          peopleAhead: 1, completedLast30m: 0, consultationElapsedMinutesAhead: 5,
          averageDurationMinutes: 15, estimatedMinutes: 22,
          predictionModel: 'operational-f4-hist-gradient-boosting-v1' },
      ]]);

    const response = await request(app).get('/api/staff/queues').set('Cookie', 'mediq_session=staff-token');

    expect(response.statusCode).toBe(200);
    expect(response.body.entries[0]).toMatchObject({
      peopleAhead: 1, remainingWaitMinutes: 10, estimatedMinutes: 22,
      predictionModel: 'operational-f4-hist-gradient-boosting-v1',
    });
    expect(execute.mock.calls[2][0]).toContain('waiting_time_predictions');
    execute.mockRestore();
  });

  test('returns the Staff overview metrics', async () => {
    const execute = jest.spyOn(pool, 'execute')
      .mockResolvedValueOnce([[{ id: 7, fullName: 'Clinic Staff', email: 'staff@example.com', role: 'staff' }]])
      .mockResolvedValueOnce([[{ total: 7, waiting: 3, called: 1, inProgress: 1, completed: 2, skipped: 0 }]])
      .mockResolvedValueOnce([[{ pendingAppointments: 4 }]])
      .mockResolvedValueOnce([[{ averageDuration: 14 }]]);

    const response = await request(app).get('/api/staff/overview').set('Cookie', 'mediq_session=staff-token');

    expect(response.statusCode).toBe(200);
    expect(response.body.summary).toMatchObject({ waiting: 3, called: 1, inProgress: 1, completed: 2, pendingAppointments: 4, averageDuration: 14 });
    execute.mockRestore();
  });

  test('rejects an invalid Staff queue status transition', async () => {
    const execute = jest.spyOn(pool, 'execute').mockResolvedValueOnce([[
      { id: 7, fullName: 'Clinic Staff', email: 'staff@example.com', role: 'staff' },
    ]]);
    const connection = {
      beginTransaction: jest.fn().mockResolvedValue(),
      execute: jest.fn().mockResolvedValueOnce([[{ id: 2 }]]).mockResolvedValueOnce([[
        { id: 81, patientId: 21, status: 'waiting', queueNumber: 3, serviceName: 'General Consultation' },
      ]]),
      commit: jest.fn(), rollback: jest.fn().mockResolvedValue(), release: jest.fn(),
    };
    const getConnection = jest.spyOn(pool, 'getConnection').mockResolvedValueOnce(connection);

    const response = await request(app)
      .patch('/api/staff/queues/81/status')
      .set('Cookie', 'mediq_session=staff-token')
      .send({ status: 'completed' });

    expect(response.statusCode).toBe(409);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    execute.mockRestore();
    getConnection.mockRestore();
  });

  test('updates a queue through a valid Staff transition with notification and audit', async () => {
    const execute = jest.spyOn(pool, 'execute').mockResolvedValueOnce([[
      { id: 7, fullName: 'Clinic Staff', email: 'staff@example.com', role: 'staff' },
    ]]).mockResolvedValue([[]]);
    const connection = {
      beginTransaction: jest.fn().mockResolvedValue(),
      execute: jest.fn()
        .mockResolvedValueOnce([[{ id: 2 }]])
        .mockResolvedValueOnce([[
          { id: 81, patientId: 21, serviceId: 2, status: 'waiting', queueNumber: 3, serviceName: 'General Consultation' },
        ]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ insertId: 103 }])
        .mockResolvedValueOnce([{ insertId: 104 }]),
      commit: jest.fn().mockResolvedValue(), rollback: jest.fn().mockResolvedValue(), release: jest.fn(),
    };
    const getConnection = jest.spyOn(pool, 'getConnection').mockResolvedValueOnce(connection);

    const response = await request(app)
      .patch('/api/staff/queues/81/status')
      .set('Cookie', 'mediq_session=staff-token')
      .send({ status: 'called' });

    expect(response.statusCode).toBe(200);
    expect(connection.execute.mock.calls.find(([sql]) => sql.startsWith('UPDATE queue_entries'))[0]).toContain('called_at = CURRENT_TIMESTAMP');
    expect(connection.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO notifications'))).toBe(true);
    expect(connection.execute.mock.calls.find(([sql]) => sql.includes('INSERT INTO staff_audit_logs'))[1][3]).toContain('Q2-003');
    expect(response.body.message).toContain('Q2-003');
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
    execute.mockRestore();
    getConnection.mockRestore();
  });

  test('completes a consultation and calls the next waiting patient in one transaction', async () => {
    const execute = jest.spyOn(pool, 'execute').mockResolvedValueOnce([[
      { id: 7, fullName: 'Clinic Staff', email: 'staff@example.com', role: 'staff' },
    ]]).mockResolvedValue([[]]);
    const connection = {
      beginTransaction: jest.fn().mockResolvedValue(),
      execute: jest.fn()
        .mockResolvedValueOnce([[{ id: 2 }]])
        .mockResolvedValueOnce([[{ id: 81, patientId: 21, serviceId: 2, status: 'in_progress', queueNumber: 1, serviceName: 'General Consultation' }]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ id: 82, patientId: 22, queueNumber: 2 }]])
        .mockResolvedValue([{ affectedRows: 1 }]),
      commit: jest.fn().mockResolvedValue(), rollback: jest.fn().mockResolvedValue(), release: jest.fn(),
    };
    const getConnection = jest.spyOn(pool, 'getConnection').mockResolvedValueOnce(connection);

    const response = await request(app)
      .post('/api/staff/queues/81/complete-and-call-next')
      .set('Cookie', 'mediq_session=staff-token');

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ calledQueueId: 82 });
    expect(response.body.message).toContain('Q2-001 completed and Q2-002 called');
    expect(connection.execute.mock.calls.some(([sql]) => sql.includes('ORDER BY queue_number LIMIT 1 FOR UPDATE'))).toBe(true);
    expect(connection.execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE queue_entries') && sql.includes("status = 'completed'"))).toBe(true);
    expect(connection.execute.mock.calls.find(([sql]) => sql.startsWith('UPDATE queue_entries') && sql.includes("status = 'called'"))[1]).toEqual([82]);
    expect(connection.execute.mock.calls.filter(([sql]) => sql.includes('INSERT INTO notifications'))).toHaveLength(2);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    execute.mockRestore();
    getConnection.mockRestore();
  });

  test('rolls back completion when calling the next patient fails', async () => {
    const execute = jest.spyOn(pool, 'execute').mockResolvedValueOnce([[
      { id: 7, fullName: 'Clinic Staff', email: 'staff@example.com', role: 'staff' },
    ]]);
    const connection = {
      beginTransaction: jest.fn().mockResolvedValue(),
      execute: jest.fn()
        .mockResolvedValueOnce([[{ id: 2 }]])
        .mockResolvedValueOnce([[{ id: 81, patientId: 21, serviceId: 2, status: 'in_progress', queueNumber: 1, serviceName: 'General Consultation' }]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ id: 82, patientId: 22, queueNumber: 2 }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ insertId: 1 }])
        .mockResolvedValueOnce([{ insertId: 2 }])
        .mockRejectedValueOnce(new Error('database write failed')),
      commit: jest.fn().mockResolvedValue(), rollback: jest.fn().mockResolvedValue(), release: jest.fn(),
    };
    const getConnection = jest.spyOn(pool, 'getConnection').mockResolvedValueOnce(connection);

    const response = await request(app)
      .post('/api/staff/queues/81/complete-and-call-next')
      .set('Cookie', 'mediq_session=staff-token');

    expect(response.statusCode).toBe(503);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    execute.mockRestore();
    getConnection.mockRestore();
  });

  test('protects patient dashboard data from unauthenticated requests', async () => {
    const response = await request(app).get('/api/patient/overview');
    expect(response.statusCode).toBe(401);
    expect(response.body.error).toContain('Sign in');
  });

  test.each([
    ['/join-queue.html', 'Join today’s queue'],
    ['/queue-status.html', 'Your queue status'],
    ['/patient-services.html', 'data-patient-page="services"'],
    ['/queue-history.html', 'data-patient-page="history"'],
    ['/appointments.html', 'data-patient-page="appointments"'],
    ['/notifications.html', 'data-patient-page="notifications"'],
    ['/patient-profile.html', 'data-patient-page="profile"'],
  ])('serves the patient queue page %s', async (path, heading) => {
    const response = await request(app).get(path);
    expect(response.statusCode).toBe(200);
    expect(response.text).toContain(heading);
  });

  test('rejects an invalid service before starting a queue transaction', async () => {
    const execute = jest.spyOn(pool, 'execute').mockResolvedValueOnce([[{
      id: 21, fullName: 'Test Patient', email: 'patient@example.com', role: 'patient',
    }]]);
    const getConnection = jest.spyOn(pool, 'getConnection');
    const response = await request(app)
      .post('/api/patient/queues')
      .set('Cookie', 'mediq_session=test-token')
      .send({ serviceId: 'invalid' });

    expect(response.statusCode).toBe(422);
    expect(getConnection).not.toHaveBeenCalled();
    execute.mockRestore();
    getConnection.mockRestore();
  });

  test('joins a queue transactionally and stores the baseline estimate', async () => {
    const execute = jest.spyOn(pool, 'execute').mockResolvedValueOnce([[{
      id: 21, fullName: 'Test Patient', email: 'patient@example.com', role: 'patient',
    }]]);
    const connection = {
      beginTransaction: jest.fn().mockResolvedValue(),
      execute: jest.fn()
        .mockResolvedValueOnce([[{ id: 21 }]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ id: 2, name: 'General Consultation', averageDurationMinutes: 15 }]])
        .mockResolvedValueOnce([[{ nextNumber: 3 }]])
        .mockResolvedValueOnce([[{ peopleAhead: 2 }]])
        .mockResolvedValueOnce([{ insertId: 81 }])
        .mockResolvedValueOnce([{ insertId: 91 }])
        .mockResolvedValueOnce([{ insertId: 101 }]),
      commit: jest.fn().mockResolvedValue(),
      rollback: jest.fn().mockResolvedValue(),
      release: jest.fn(),
    };
    const getConnection = jest.spyOn(pool, 'getConnection').mockResolvedValueOnce(connection);
    const response = await request(app)
      .post('/api/patient/queues')
      .set('Cookie', 'mediq_session=test-token')
      .send({ serviceId: 2 });

    expect(response.statusCode).toBe(201);
    expect(response.body.queue).toMatchObject({ serviceId: 2, queueNumber: 3, peopleAhead: 2, estimatedMinutes: 30 });
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.execute.mock.calls[6][0]).toContain('waiting_time_predictions');
    expect(connection.execute.mock.calls[6][1]).toEqual([81, 30, 'baseline-average-duration-v1', 2, 15]);
    expect(connection.execute.mock.calls[7][1][2]).toContain('Q2-003');
    expect(connection.release).toHaveBeenCalledTimes(1);
    execute.mockRestore();
    getConnection.mockRestore();
  });

  test('prevents a patient from joining a second active queue', async () => {
    const execute = jest.spyOn(pool, 'execute').mockResolvedValueOnce([[{
      id: 21, fullName: 'Test Patient', email: 'patient@example.com', role: 'patient',
    }]]);
    const connection = {
      beginTransaction: jest.fn().mockResolvedValue(),
      execute: jest.fn().mockResolvedValueOnce([[{ id: 21 }]]).mockResolvedValueOnce([[{ id: 77 }]]),
      commit: jest.fn(), rollback: jest.fn().mockResolvedValue(), release: jest.fn(),
    };
    const getConnection = jest.spyOn(pool, 'getConnection').mockResolvedValueOnce(connection);
    const response = await request(app)
      .post('/api/patient/queues')
      .set('Cookie', 'mediq_session=test-token')
      .send({ serviceId: 1 });

    expect(response.statusCode).toBe(409);
    expect(response.body.queueId).toBe(77);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    execute.mockRestore();
    getConnection.mockRestore();
  });

  test('requires a meaningful reason before queue cancellation', async () => {
    const execute = jest.spyOn(pool, 'execute').mockResolvedValueOnce([[{
      id: 21, fullName: 'Test Patient', email: 'patient@example.com', role: 'patient',
    }]]);
    const getConnection = jest.spyOn(pool, 'getConnection');
    const response = await request(app)
      .post('/api/patient/queues/81/cancel')
      .set('Cookie', 'mediq_session=test-token')
      .send({ reason: 'x' });

    expect(response.statusCode).toBe(422);
    expect(getConnection).not.toHaveBeenCalled();
    execute.mockRestore();
    getConnection.mockRestore();
  });

  test('cancels only a queue owned by the authenticated patient', async () => {
    const execute = jest.spyOn(pool, 'execute').mockResolvedValueOnce([[{
      id: 21, fullName: 'Test Patient', email: 'patient@example.com', role: 'patient',
    }]]);
    const connection = {
      beginTransaction: jest.fn().mockResolvedValue(),
      execute: jest.fn()
        .mockResolvedValueOnce([[{ id: 81, status: 'waiting' }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ insertId: 102 }]),
      commit: jest.fn().mockResolvedValue(), rollback: jest.fn().mockResolvedValue(), release: jest.fn(),
    };
    const getConnection = jest.spyOn(pool, 'getConnection').mockResolvedValueOnce(connection);
    const response = await request(app)
      .post('/api/patient/queues/81/cancel')
      .set('Cookie', 'mediq_session=test-token')
      .send({ reason: 'Unable to attend today' });

    expect(response.statusCode).toBe(200);
    expect(connection.execute.mock.calls[0][0]).toContain('patient_id = ?');
    expect(connection.execute.mock.calls[0][1]).toEqual([81, 21]);
    expect(connection.execute.mock.calls[1][1]).toEqual(['Unable to attend today', 81, 21]);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    execute.mockRestore();
    getConnection.mockRestore();
  });

  test('returns paginated queue history belonging to the signed-in patient', async () => {
    const execute = jest.spyOn(pool, 'execute')
      .mockResolvedValueOnce([[{ id: 21, fullName: 'Test Patient', email: 'patient@example.com', role: 'patient' }]])
      .mockResolvedValueOnce([[{ total: 1 }]])
      .mockResolvedValueOnce([[{ id: 81, queueNumber: 3, status: 'completed', serviceName: 'General Consultation' }]]);

    const response = await request(app)
      .get('/api/patient/history?status=completed')
      .set('Cookie', 'mediq_session=test-token');

    expect(response.statusCode).toBe(200);
    expect(response.body.total).toBe(1);
    expect(execute.mock.calls[1][1]).toEqual([21, 'completed']);
    expect(execute.mock.calls[2][1]).toEqual([21, 'completed']);
    execute.mockRestore();
  });

  test('submits an appointment request transactionally', async () => {
    const execute = jest.spyOn(pool, 'execute').mockResolvedValueOnce([[
      { id: 21, fullName: 'Test Patient', email: 'patient@example.com', role: 'patient' },
    ]]);
    const connection = {
      beginTransaction: jest.fn().mockResolvedValue(),
      execute: jest.fn()
        .mockResolvedValueOnce([[{ id: 1 }]])
        .mockResolvedValueOnce([[{ id: 21, isActive: 1 }]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, isOpen: 1, opensAt: '09:00', closesAt: '17:00', breakStart: '12:00', breakEnd: '14:00' }))])
        .mockResolvedValueOnce([[{ id: 2, name: 'General Consultation' }]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([{ insertId: 44 }])
        .mockResolvedValueOnce([{ insertId: 45 }]),
      commit: jest.fn().mockResolvedValue(), rollback: jest.fn().mockResolvedValue(), release: jest.fn(),
    };
    const getConnection = jest.spyOn(pool, 'getConnection').mockResolvedValueOnce(connection);
    const response = await request(app)
      .post('/api/patient/appointments')
      .set('Cookie', 'mediq_session=test-token')
      .send({ serviceId: 2, appointmentDate: '2099-10-10', appointmentTime: '10:30', notes: 'Routine follow-up' });

    expect(response.statusCode).toBe(201);
    expect(response.body.appointmentId).toBe(44);
    expect(connection.execute.mock.calls.find(([sql])=>sql.includes('INSERT INTO appointments'))[1]).toEqual([21, 2, '2099-10-10', '10:30', 'Routine follow-up']);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
    execute.mockRestore();
    getConnection.mockRestore();
  });

  test('rejects appointment times outside the published clinic slots', async () => {
    const execute = jest.spyOn(pool, 'execute').mockResolvedValueOnce([[
      { id: 21, fullName: 'Test Patient', email: 'patient@example.com', role: 'patient' },
    ]]);
    const getConnection = jest.spyOn(pool, 'getConnection');

    const response = await request(app)
      .post('/api/patient/appointments')
      .set('Cookie', 'mediq_session=test-token')
      .send({ serviceId: 2, appointmentDate: '2099-10-10', appointmentTime: '13:17' });

    expect(response.statusCode).toBe(422);
    expect(response.body.error).toContain('available clinic time slots');
    expect(getConnection).not.toHaveBeenCalled();
    execute.mockRestore();
    getConnection.mockRestore();
  });

  test('marks only the signed-in patient notification as read', async () => {
    const execute = jest.spyOn(pool, 'execute')
      .mockResolvedValueOnce([[{ id: 21, fullName: 'Test Patient', email: 'patient@example.com', role: 'patient' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const response = await request(app)
      .patch('/api/patient/notifications/17/read')
      .set('Cookie', 'mediq_session=test-token');

    expect(response.statusCode).toBe(200);
    expect(execute.mock.calls[1][1]).toEqual([17, 21]);
    execute.mockRestore();
  });

  test('validates patient-editable profile fields and does not accept a role change', async () => {
    const execute = jest.spyOn(pool, 'execute')
      .mockResolvedValueOnce([[{ id: 21, fullName: 'Test Patient', email: 'patient@example.com', role: 'patient' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const response = await request(app)
      .patch('/api/patient/profile')
      .set('Cookie', 'mediq_session=test-token')
      .send({ fullName: 'Updated Patient', phone: '+60 12-345 6789', gender: 'other', role: 'admin' });

    expect(response.statusCode).toBe(200);
    expect(execute.mock.calls[1][0]).not.toContain('role = ?');
    expect(execute.mock.calls[1][1]).toEqual(['Updated Patient', '+60 12-345 6789', 'other', 21]);
    execute.mockRestore();
  });
});
