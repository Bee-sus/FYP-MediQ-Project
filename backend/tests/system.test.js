const request = require('supertest');
const app = require('../src/app');
const { pool } = require('../src/config/database');
const { hashPassword, verifyPassword, meetsPasswordRules } = require('../src/services/passwordService');

describe('system endpoints', () => {
  afterAll(async () => {
    await pool.end();
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
    ['/verify-email.html', 'Verify your email'],
    ['/terms.html', 'Terms and Conditions &amp; Privacy Notice'],
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
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([{ insertId: 1 }]);
    const response = await request(app).post('/api/auth/register').send({
      fullName: 'Test Patient', email: 'patient@example.com', phone: '+60 12-345 6789',
      birthDate: '2000-01-01', gender: 'prefer-not-to-say', password: 'Strong-Patient-2026!',
      confirmPassword: 'Strong-Patient-2026!', terms: true, role: 'admin',
    });

    expect(response.statusCode).toBe(201);
    expect(response.body).toMatchObject({ userId: 42, requiresVerification: true });
    expect(response.body.verificationPreviewUrl).toContain('/verify-email.html?token=');
    expect(execute.mock.calls[0][0]).toContain("'patient'");
    expect(execute.mock.calls[0][1][2]).not.toContain('Strong-Patient-2026!');
    expect(execute.mock.calls[2][0]).toContain('email_verification_tokens');
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

  test('blocks an unverified non-admin account from signing in', async () => {
    const passwordHash = await hashPassword('Strong-Staff-2026!');
    const execute = jest.spyOn(pool, 'execute').mockResolvedValueOnce([[
      { id: 7, full_name: 'Clinic Staff', email: 'staff@example.com', password_hash: passwordHash, role: 'staff', is_active: 1, email_verified_at: null },
    ]]);

    const response = await request(app).post('/api/auth/login').send({ email: 'staff@example.com', password: 'Strong-Staff-2026!', role: 'staff' });

    expect(response.statusCode).toBe(403);
    expect(response.body.emailVerificationRequired).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
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

  test('serves the dedicated Staff operations dashboard', async () => {
    const response = await request(app).get('/staff-dashboard.html');
    expect(response.statusCode).toBe(200);
    expect(response.text).toContain('Clinic operations');
    expect(response.text).toContain('Service queues');
    expect(response.text).toContain('staff-dashboard.js');
  });

  test('protects Staff operations from unauthenticated requests', async () => {
    const response = await request(app).get('/api/staff/queues');
    expect(response.statusCode).toBe(401);
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
      execute: jest.fn().mockResolvedValueOnce([[
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
    ]]);
    const connection = {
      beginTransaction: jest.fn().mockResolvedValue(),
      execute: jest.fn()
        .mockResolvedValueOnce([[
          { id: 81, patientId: 21, serviceId: 2, status: 'waiting', queueNumber: 3, serviceName: 'General Consultation' },
        ]])
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
    expect(connection.execute.mock.calls[2][0]).toContain('called_at = CURRENT_TIMESTAMP');
    expect(connection.execute.mock.calls[3][0]).toContain('notifications');
    expect(connection.execute.mock.calls[4][0]).toContain('staff_audit_logs');
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
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
    expect(response.body.queue).toMatchObject({ queueNumber: 3, peopleAhead: 2, estimatedMinutes: 30 });
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.execute.mock.calls[6][0]).toContain('waiting_time_predictions');
    expect(connection.execute.mock.calls[6][1]).toEqual([81, 30, 2, 15]);
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
    expect(connection.execute.mock.calls[5][1]).toEqual([21, 2, '2099-10-10', '10:30', 'Routine follow-up']);
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
