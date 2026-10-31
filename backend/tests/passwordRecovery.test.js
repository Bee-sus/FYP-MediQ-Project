const request=require('supertest');
jest.mock('../src/config/database',()=>({pool:{execute:jest.fn(),getConnection:jest.fn()}}));
jest.mock('../src/services/emailVerificationService',()=>({...jest.requireActual('../src/services/emailVerificationService'),sendPasswordRecoveryEmail:jest.fn()}));
let mockAllowance;
jest.mock('../src/services/passwordRecoveryLimiter',()=>({createRecoveryLimiter:()=>()=>mockAllowance}));
const {pool}=require('../src/config/database');
const {sendPasswordRecoveryEmail}=require('../src/services/emailVerificationService');
const {codeHash}=require('../src/services/patientOtpService');
const {hashPassword,verifyPassword}=require('../src/services/passwordService');
const app=require('../src/app');
const session='b'.repeat(43),newPassword='Changed-Patient-2026!';
const saved=Object.fromEntries(['SMTP_HOST','SMTP_USER','SMTP_PASSWORD','EMAIL_DELIVERY_MODE'].map(key=>[key,process.env[key]]));
let connection,user,record,exists,previous;
beforeEach(async()=>{
 jest.resetAllMocks();mockAllowance={allowed:true};Object.assign(process.env,{SMTP_HOST:'smtp.example.test',SMTP_USER:'sender@example.test',SMTP_PASSWORD:'unused',EMAIL_DELIVERY_MODE:'smtp'});
 user={id:7,email:'patient@example.test',role:'patient',password_hash:await hashPassword('Original-Patient-2026!')};
 record={user_id:7,code_hash:codeHash(session,'123456'),attempts:0,codeValid:1};exists=true;previous=[];
 connection={beginTransaction:jest.fn(),commit:jest.fn(),rollback:jest.fn(),release:jest.fn(),execute:jest.fn(async(sql)=>{
  if(sql.startsWith('SELECT user_id'))return [exists?[{user_id:7}]:[]];
  if(sql.startsWith('SELECT id,email'))return [user?[user]:[]];
  if(sql.startsWith('SELECT *,TIMESTAMPDIFF'))return [previous];
  if(sql.startsWith('SELECT *,expires_at'))return [exists?[record]:[]];
  if(sql.includes('attempts=attempts+1'))record.attempts++;
  if(sql.startsWith('DELETE FROM password_reset_codes'))exists=false;
  return [{affectedRows:1}];
 })};pool.getConnection.mockResolvedValue(connection);sendPasswordRecoveryEmail.mockResolvedValue({sent:true});
});
afterAll(()=>{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
const requestCode=(extra={})=>request(app).post('/api/auth/forgot-password').send({email:'patient@example.test',role:'patient',...extra});
const reset=(extra={})=>request(app).post('/api/auth/reset-password').send({resetSession:session,code:'123456',newPassword,confirmPassword:newPassword,...extra});
test('request stores hashes and sends a code without exposing it',async()=>{
 const result=await requestCode();expect(result.status).toBe(200);expect(result.body.resetSession).toHaveLength(43);expect(result.body).not.toHaveProperty('previewCode');
 const insert=connection.execute.mock.calls.find(([sql])=>sql.startsWith('INSERT INTO password_reset_codes')),code=sendPasswordRecoveryEmail.mock.calls[0][0].code;
 expect(code).toMatch(/^\d{6}$/);expect(insert[1]).not.toContain(code);expect(insert[1]).not.toContain(result.body.resetSession);
});
test('unknown accounts receive the same message without an email',async()=>{
 const known=await requestCode();sendPasswordRecoveryEmail.mockClear();user=null;const unknown=await requestCode({email:'missing@example.test'});
 expect(unknown.status).toBe(200);expect(unknown.body.message).toBe(known.body.message);expect(sendPasswordRecoveryEmail).not.toHaveBeenCalled();expect(connection.execute.mock.calls[0][0]).toContain('is_active=TRUE');expect(connection.execute.mock.calls[0][0]).toContain('deleted_at IS NULL');
});
test('throttling stops requests before querying the database',async()=>{mockAllowance={allowed:false,retryAfter:60};const result=await requestCode();expect(result.status).toBe(429);expect(result.headers['retry-after']).toBe('60');expect(pool.getConnection).not.toHaveBeenCalled();});
test('persistent cooldown preserves an outstanding code',async()=>{previous=[{secondsSinceRequest:10,windowAge:20,request_count:2}];expect((await requestCode()).status).toBe(200);expect(sendPasswordRecoveryEmail).not.toHaveBeenCalled();});
test('SMTP errors do not reveal account presence or create a reset code',async()=>{const warn=jest.spyOn(console,'warn').mockImplementation(()=>{});sendPasswordRecoveryEmail.mockRejectedValue({code:'EAUTH'});const result=await requestCode();expect(result.status).toBe(200);expect(result.body.message).toContain('If an active account');expect(connection.execute.mock.calls.some(([sql])=>sql.startsWith('INSERT INTO password_reset_codes'))).toBe(false);warn.mockRestore();});
test('valid reset hashes the password, revokes sessions and prevents replay',async()=>{
 const result=await reset();expect(result.status).toBe(200);expect(result.body.redirect).toBe('/patient-login.html');const change=connection.execute.mock.calls.find(([sql])=>sql.startsWith('UPDATE users SET password_hash'));
 expect(await verifyPassword(newPassword,change[1][0])).toBe(true);expect(change[0]).not.toContain('email_verified_at');expect(connection.execute.mock.calls.some(([sql])=>sql.startsWith('DELETE FROM user_sessions'))).toBe(true);expect((await reset()).status).toBe(410);
});
test('Staff can choose a permanent password through recovery',async()=>{user.role='staff';const result=await reset();expect(result.status).toBe(200);expect(result.body.redirect).toBe('/staff-login.html');expect(connection.execute.mock.calls.find(([sql])=>sql.startsWith('UPDATE users SET password_hash'))[0]).toContain('must_change_password=FALSE');});
test('expired codes and unavailable accounts cannot change passwords',async()=>{record.codeValid=0;expect((await reset()).status).toBe(410);record.codeValid=1;user=null;expect((await reset()).status).toBe(410);expect(connection.execute.mock.calls.some(([sql])=>sql.startsWith('UPDATE users SET password_hash'))).toBe(false);});
test('five incorrect attempts prevent further guessing',async()=>{for(let i=0;i<5;i++)expect((await reset({code:'000000'})).status).toBe(422);expect(record.attempts).toBe(5);expect((await reset()).status).toBe(429);});
test('weak, mismatched and unchanged passwords are rejected',async()=>{expect((await reset({newPassword:'weak',confirmPassword:'weak'})).status).toBe(422);expect((await reset({confirmPassword:'Other-Password-2026!'})).status).toBe(422);expect((await reset({newPassword:'Original-Patient-2026!',confirmPassword:'Original-Patient-2026!'})).status).toBe(422);expect(connection.execute.mock.calls.some(([sql])=>sql.startsWith('UPDATE users SET password_hash'))).toBe(false);});
test('Administrator accounts have no public recovery route',async()=>{expect((await requestCode({role:'admin'})).status).toBe(422);expect(pool.getConnection).not.toHaveBeenCalled();});
