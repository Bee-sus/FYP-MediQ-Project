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
    expect(response.text).not.toContain('Development progress');
    expect(response.text).not.toContain('Database not connected');
  });

  test.each([
    ['/patient-login.html', 'Patient sign in'],
    ['/register.html', 'Patient registration'],
    ['/staff-login.html', 'Staff sign in'],
  ])('serves the authentication page %s', async (path, heading) => {
    const response = await request(app).get(path);

    expect(response.statusCode).toBe(200);
    expect(response.text).toContain(heading);
  });
});
