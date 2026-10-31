const request=require('supertest');
jest.mock('../src/config/database',()=>({pool:{execute:jest.fn(),getConnection:jest.fn()}}));
const {pool}=require('../src/config/database');const app=require('../src/app');let connection,queues,appointments,patients;
const api=(method,data)=>request(app)[method]('/api/admin/patients/7').set('Cookie','mediq_session=test').send(data||{});
beforeEach(()=>{
 jest.resetAllMocks();queues=[];appointments=[];patients=[{id:7}];pool.execute.mockResolvedValue([[{id:1,role:'admin'}]]);
 connection={beginTransaction:jest.fn(),commit:jest.fn(),rollback:jest.fn(),release:jest.fn(),execute:jest.fn(async sql=>{
  if(sql.includes('appointment_booking_lock'))return [[{id:1}]];
  if(sql.includes('FROM users'))return [patients];if(sql.includes('FROM queue_entries'))return [queues];if(sql.includes('FROM appointments'))return [appointments];return [{affectedRows:1}];
 })};pool.getConnection.mockResolvedValue(connection);
});
test.each(['staff','patient'])('%s cannot manage patient account access or deletion',async role=>{pool.execute.mockResolvedValue([[{id:3,role}]]);expect((await api('patch',{isActive:false})).status).toBe(403);expect((await api('delete')).status).toBe(403);expect(pool.getConnection).not.toHaveBeenCalled();});
test('deactivation revokes sessions and is audited',async()=>{expect((await api('patch',{isActive:false})).status).toBe(200);expect(connection.execute.mock.calls.some(([sql])=>sql.startsWith('DELETE FROM user_sessions'))).toBe(true);expect(connection.execute.mock.calls.some(([,params])=>params.includes('patient_deactivated'))).toBe(true);});
test('reactivation and basic contact editing are available to administrators',async()=>{expect((await api('patch',{isActive:true})).status).toBe(200);expect((await api('patch',{fullName:'New Patient',phone:'0123456789'})).status).toBe(200);});
test.each(['queue','appointment'])('deletion is blocked with an active %s',async type=>{if(type==='queue')queues=[{id:8}];else appointments=[{id:9}];expect((await api('delete')).status).toBe(409);expect(connection.rollback).toHaveBeenCalled();expect(connection.execute.mock.calls.some(([sql])=>sql.includes('SET full_name='))).toBe(false);});
test('deletion anonymises personal account fields while retaining visits',async()=>{expect((await api('delete')).status).toBe(200);const update=connection.execute.mock.calls.find(([sql])=>sql.includes("full_name='Deleted patient'"));expect(update[0]).toContain('deleted_at=CURRENT_TIMESTAMP');expect(update[0]).toContain('identification_number=NULL');expect(connection.execute.mock.calls.some(([sql])=>sql.startsWith('DELETE FROM queue_entries')||sql.startsWith('DELETE FROM appointments')||sql.startsWith('DELETE FROM users'))).toBe(false);expect(connection.commit).toHaveBeenCalled();});
test('deleted or non-patient accounts cannot be restored through patient controls',async()=>{patients=[];expect((await api('patch',{isActive:true})).status).toBe(404);expect((await api('delete')).status).toBe(404);});
