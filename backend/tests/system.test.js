const request = require('supertest');
const app = require('../src/app');
const { pool } = require('../src/config/database');

describe('system endpoints', () => {
  afterAll(async () => {
    await pool.end();
  });

  test('returns the current project milestone', async () => {
    const response = await request(app).get('/api/project-status');

    expect(response.statusCode).toBe(200);
    expect(response.body.milestone).toBe('Initial system foundation');
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
});
