const nodemailer = require('nodemailer');
const { sendVerificationEmail, sendStaffWelcomeEmail, sendQueueCallEmail,sendPatientOtpEmail } = require('../src/services/emailVerificationService');

test('queue call email uses SMTP acceptance and includes the correct ticket and service', async () => {
  Object.assign(process.env, {NODE_ENV:'test',EMAIL_DELIVERY_MODE:'smtp',SMTP_HOST:'smtp.example.test',SMTP_USER:'sender@example.test',SMTP_PASSWORD:'unused'});
  const sendMail=jest.fn().mockResolvedValue({accepted:['patient@example.test']});
  jest.spyOn(nodemailer,'createTransport').mockReturnValue({sendMail});
  expect(await sendQueueCallEmail({email:'patient@example.test',ticket:'Q1-003',serviceName:'General'})).toEqual({sent:true});
  expect(sendMail.mock.calls[0][0]).toMatchObject({to:'patient@example.test',subject:expect.stringContaining('Q1-003'),text:expect.stringContaining('General')});
});

const keys = ['NODE_ENV', 'EMAIL_DELIVERY_MODE', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'APP_BASE_URL'];
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));

test('Patient OTP preview codes are only exposed in explicit development preview mode',async()=>{
 Object.assign(process.env,{NODE_ENV:'development',EMAIL_DELIVERY_MODE:'preview'});
 const transport=jest.spyOn(nodemailer,'createTransport');
 expect(await sendPatientOtpEmail({email:'patient@example.test',code:'123456'})).toEqual({sent:false,previewCode:'123456'});
 expect(transport).not.toHaveBeenCalled();
});
test('production sends OTP mail and never returns a preview code',async()=>{
 Object.assign(process.env,{NODE_ENV:'production',EMAIL_DELIVERY_MODE:'preview',SMTP_HOST:'smtp.example.test',SMTP_USER:'sender@example.test',SMTP_PASSWORD:'unused'});
 const sendMail=jest.fn().mockResolvedValue({accepted:['patient@example.test']});jest.spyOn(nodemailer,'createTransport').mockReturnValue({sendMail});
 expect(await sendPatientOtpEmail({email:'patient@example.test',code:'123456'})).toEqual({sent:true});
 expect(sendMail.mock.calls[0][0].text).toContain('123456');
});

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
