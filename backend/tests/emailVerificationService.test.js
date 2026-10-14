const nodemailer = require('nodemailer');
const { sendVerificationEmail, sendStaffWelcomeEmail } = require('../src/services/emailVerificationService');

const keys = ['NODE_ENV', 'EMAIL_DELIVERY_MODE', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'APP_BASE_URL'];
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
  jest.restoreAllMocks();
});

test('local preview provides a verification link without sending mail even when SMTP is configured', async () => {
  Object.assign(process.env, {
    NODE_ENV: 'development', EMAIL_DELIVERY_MODE: 'preview', SMTP_HOST: 'smtp.example.test',
    SMTP_USER: 'sender@example.test', SMTP_PASSWORD: 'unused', APP_BASE_URL: 'http://localhost:3000',
  });
  const createTransport = jest.spyOn(nodemailer, 'createTransport');
  const patient = await sendVerificationEmail({ email: 'patient1@example.test', fullName: 'Test Patient', token: 'patient-token' });
  const staff = await sendStaffWelcomeEmail({ email: 'staff1@example.test', fullName: 'Test Staff', staffCode: 'STF-1', temporaryPassword: 'unused', token: 'staff-token' });

  expect(patient).toEqual({ sent: false, previewUrl: 'http://localhost:3000/verify-email.html?token=patient-token' });
  expect(staff).toEqual({ sent: false, previewUrl: 'http://localhost:3000/verify-email.html?token=staff-token' });
  expect(createTransport).not.toHaveBeenCalled();
});

test('production ignores preview mode and sends verification through configured SMTP', async () => {
  Object.assign(process.env, {
    NODE_ENV: 'production', EMAIL_DELIVERY_MODE: 'preview', SMTP_HOST: 'smtp.example.test',
    SMTP_USER: 'sender@example.test', SMTP_PASSWORD: 'unused', APP_BASE_URL: 'http://localhost:3000',
  });
  const sendMail = jest.fn().mockResolvedValue({ messageId: 'test' });
  const createTransport = jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail });
  const result = await sendVerificationEmail({ email: 'patient1@example.test', fullName: 'Test Patient', token: 'patient-token' });

  expect(result).toEqual({ sent: true, previewUrl: null });
  expect(createTransport).toHaveBeenCalledTimes(1);
  expect(sendMail).toHaveBeenCalledTimes(1);
});
