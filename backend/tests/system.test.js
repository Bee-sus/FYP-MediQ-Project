const request = require('supertest');
const app = require('../src/app');

describe('system endpoints', () => {
  test('returns the current project milestone', async () => {
    const response = await request(app).get('/api/project-status');

    expect(response.statusCode).toBe(200);
    expect(response.body.milestone).toBe('Initial system foundation');
    expect(response.body.completed.length).toBeGreaterThan(0);
  });
});
