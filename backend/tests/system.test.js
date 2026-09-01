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
    expect(response.body.milestone).toBe('Database authentication foundation');
    expect(response.body.completed.length).toBeGreaterThan(0);
  });

  test('returns the available clinic services', async () => {
    const response = await request(app).get('/api/services');

    expect(response.statusCode).toBe(200);
    expect(response.body.source).toBe('development-data');
    expect(response.body.services).toHaveLength(2);
    expect(response.body.services[0]).toMatchObject({
      name: 'General Consultation',
      averageDurationMinutes: 15,
      availability: 'Available',
    });
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
    const execute = jest.spyOn(pool, 'execute').mockResolvedValueOnce([{ insertId: 42 }]);
    const response = await request(app).post('/api/auth/register').send({
      fullName: 'Test Patient', email: 'patient@example.com', phone: '+60 12-345 6789',
      birthDate: '2000-01-01', gender: 'prefer-not-to-say', password: 'Strong-Patient-2026!',
      confirmPassword: 'Strong-Patient-2026!', terms: true, role: 'admin',
    });

    expect(response.statusCode).toBe(201);
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
    expect(response.body.redirect).toBe('/dashboard.html?role=staff');
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

  test('protects patient dashboard data from unauthenticated requests', async () => {
    const response = await request(app).get('/api/patient/overview');
    expect(response.statusCode).toBe(401);
    expect(response.body.error).toContain('Sign in');
  });
});
