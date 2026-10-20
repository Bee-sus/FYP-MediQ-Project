const request = require('supertest');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const app = require('../src/app');
const { pool } = require('../src/config/database');
const { validateIdentity } = require('../src/services/patientIdentity');
afterEach(() => jest.restoreAllMocks());
afterAll(() => pool.end());
test('identification is optional for existing and new patients', () => {
  expect(validateIdentity({})).toEqual({ type: null, number: null, errors: {} });
});
test('MyKad spaces and hyphens are normalised', () => {
  expect(validateIdentity({ identificationType: 'mykad', identificationNumber: '000101-00-0000' })).toMatchObject({ number: '000101000000', errors: {} });
});
test('passport letters are normalised', () => {
  expect(validateIdentity({ identificationType: 'passport', identificationNumber: 'demo12345' })).toMatchObject({ number: 'DEMO12345', errors: {} });
});
test.each([
  { identificationType: 'mykad', identificationNumber: '123' },
  { identificationType: 'passport', identificationNumber: 'a$12345' },
  { identificationType: 'mykad', identificationNumber: '' },
  { identificationNumber: 'DEMO1234' },
])('incomplete or malformed identification is rejected', body => {
  expect(Object.keys(validateIdentity(body).errors).length).toBeGreaterThan(0);
});
test('profile update saves optional identity for its authenticated owner', async () => {
  const execute = jest.spyOn(pool, 'execute').mockResolvedValueOnce([[{ id: 7, role: 'patient' }]]).mockResolvedValueOnce([{ affectedRows: 1 }]);
  const result = await request(app).patch('/api/patient/profile').set('Cookie', 'mediq_session=test')
    .send({ fullName: 'Test Patient', phone: '0123456789', gender: 'other', identificationType: 'passport', identificationNumber: 'demo1234' });
  expect(result.status).toBe(200);
  expect(execute.mock.calls[1][1]).toEqual(['Test Patient', '0123456789', 'other', 'passport', 'DEMO1234', 7]);
  expect(JSON.stringify(result.body)).not.toContain('DEMO1234');
});
test('old profile clients do not accidentally clear stored identification', async () => {
  const execute = jest.spyOn(pool, 'execute').mockResolvedValueOnce([[{ id: 7, role: 'patient' }]]).mockResolvedValueOnce([{ affectedRows: 1 }]);
  const result = await request(app).patch('/api/patient/profile').set('Cookie', 'mediq_session=test')
    .send({ fullName: 'Test Patient', phone: '0123456789', gender: 'other' });
  expect(result.status).toBe(200);
  expect(execute.mock.calls[1][0]).not.toContain('identification_number');
});
test('invalid identity prevents registration before any database write', async () => {
  const execute = jest.spyOn(pool, 'execute');
  const result = await request(app).post('/api/auth/register').send({ identificationType: 'mykad', identificationNumber: '123' });
  expect(result.status).toBe(422);
  expect(result.body.fields.identificationNumber).toBeDefined();
  expect(execute).not.toHaveBeenCalled();
});
test.each([['2000-10-21', '25 years'], ['2000-10-20', '26 years'], ['2000-10-19', '26 years'], ['2026-10-20', '0 years']])('age respects birthdays: %s', (birthDateValue, expected) => {
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/auth.js'), 'utf8');
  const start = source.indexOf('    function updateRegistrationAge()');
  const end = source.indexOf("    birthDate.addEventListener('input', updateRegistrationAge)", start);
  const output = {};
  const RealDate = Date;
  class FixedDate extends RealDate { constructor(...args) { super(...(args.length ? args : ['2026-10-20T08:00:00Z'])); } }
  const context = vm.createContext({ Intl, Date: FixedDate, ageOutput: output, birthDate: { value: birthDateValue, checkValidity: () => true } });
  vm.runInContext(source.slice(start, end) + '\nupdateRegistrationAge();', context);
  expect(output.textContent).toBe('Age: ' + expected);
});
