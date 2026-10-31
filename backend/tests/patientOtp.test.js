const request=require('supertest');
jest.mock('../src/config/database',()=>({pool:{execute:jest.fn(),getConnection:jest.fn()}}));
jest.mock('../src/services/emailVerificationService',()=>({...jest.requireActual('../src/services/emailVerificationService'),sendPatientOtpEmail:jest.fn()}));
const {pool}=require('../src/config/database');
const {sendPatientOtpEmail}=require('../src/services/emailVerificationService');
const {codeHash}=require('../src/services/patientOtpService');
const app=require('../src/app');
const session='a'.repeat(43);let row,connection;
const verify=code=>request(app).post('/api/auth/verify-email-code').send({verificationSession:session,code});
const send=()=>request(app).post('/api/auth/request-email-code').send({verificationSession:session});
beforeEach(()=>{
 jest.resetAllMocks();row={user_id:7,email:'patient@example.test',verifiedAt:null,code_hash:codeHash(session,'123456'),codeValid:1,attempts:0,secondsSinceSend:null,windowAge:null,send_count:0};
 connection={beginTransaction:jest.fn(),commit:jest.fn(),rollback:jest.fn(),release:jest.fn(),execute:jest.fn(async(sql,params)=>{
  if(sql.includes('SELECT p.'))return [row?[row]:[]];
  if(sql.includes('attempts=attempts+1'))row.attempts++;
  if(sql.includes('DELETE FROM patient_email_codes'))row=null;
  if(sql.includes('SET code_hash=')){row.code_hash=params[0];row.attempts=0;row.secondsSinceSend=0;row.send_count=params[1];}
  return [{affectedRows:1}];
 })};pool.getConnection.mockResolvedValue(connection);sendPatientOtpEmail.mockResolvedValue({sent:true});
});
test('correct code verifies once and removes its challenge',async()=>{
 expect((await verify('123456')).status).toBe(200);expect(connection.commit).toHaveBeenCalled();expect((await verify('123456')).status).toBe(410);
});
test('five failed attempts are committed and block further guessing',async()=>{
 for(let i=0;i<4;i++)expect((await verify('111111')).status).toBe(422);
 expect((await verify('111111')).status).toBe(429);expect(row.attempts).toBe(5);expect((await verify('123456')).status).toBe(429);
});
test('expired codes cannot verify',async()=>{row.codeValid=0;expect((await verify('123456')).status).toBe(410);expect(connection.commit).not.toHaveBeenCalled();});
test('resending rotates the code hash and has a cooldown',async()=>{
 const previous=row.code_hash;const result=await send();expect(result.status).toBe(200);expect(row.code_hash).not.toBe(previous);expect(result.body).not.toHaveProperty('previewCode');expect((await send()).status).toBe(429);expect(sendPatientOtpEmail).toHaveBeenCalledTimes(1);
});
test('hourly send limit is enforced',async()=>{row.windowAge=1;row.send_count=5;expect((await send()).status).toBe(429);expect(sendPatientOtpEmail).not.toHaveBeenCalled();});
test('email failure does not report success or replace the code',async()=>{sendPatientOtpEmail.mockRejectedValue(new Error('SMTP failure'));expect((await send()).status).toBe(503);expect(connection.rollback).toHaveBeenCalled();expect(connection.execute.mock.calls.some(([sql])=>sql.includes('SET code_hash='))).toBe(false);});
test('invalid sessions are rejected before connecting to the database',async()=>{expect((await request(app).post('/api/auth/request-email-code').send({verificationSession:'7'})).status).toBe(422);expect(pool.getConnection).not.toHaveBeenCalled();});
