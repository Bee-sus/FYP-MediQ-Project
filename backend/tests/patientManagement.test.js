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

const listPatients = query => request(app).get('/api/admin/patients').query(query).set('Cookie','mediq_session=test');
function patientListResult(total, rows) {
 pool.execute.mockResolvedValueOnce([[{id:1,role:'admin'}]])
  .mockResolvedValueOnce([[{total}]]).mockResolvedValueOnce([rows]);
}

test('patient filters search the complete registry with matching count and pagination',async()=>{
 patientListResult(23,[{id:7,fullName:'Dylan'}]);
 const response=await listPatients({query:'Dylan',status:'active',verification:'verified',sort:'newest',page:2});
 expect(response.status).toBe(200);expect(response.body).toMatchObject({total:23,page:2,pages:2,pageSize:20,hasMore:false});
 const calls=pool.execute.mock.calls.slice(1);
 for(const [sql,params] of calls){expect(sql).toContain("role = 'patient'");expect(sql).toContain('deleted_at IS NULL');expect(sql).toContain('is_active = TRUE');expect(sql).toContain('email_verified_at IS NOT NULL');expect(params).toEqual(['%Dylan%','%Dylan%','%Dylan%']);}
 expect(calls[1][0]).toContain('ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET 20');
});

test('inactive and unverified filters combine, and stale pages clamp after deletion',async()=>{
 patientListResult(1,[{id:7}]);
 const response=await listPatients({status:'inactive',verification:'pending',sort:'name_desc',page:3});
 expect(response.status).toBe(200);expect(response.body).toMatchObject({total:1,page:1,pages:1,hasMore:false});
 const sql=pool.execute.mock.calls[2][0];expect(sql).toContain('is_active = FALSE');expect(sql).toContain('email_verified_at IS NULL');expect(sql).toContain('ORDER BY full_name DESC, id DESC LIMIT 20 OFFSET 0');
});

test('empty filtered results retain a valid first page',async()=>{
 patientListResult(0,[]);const response=await listPatients({query:'No match'});
 expect(response.status).toBe(200);expect(response.body).toMatchObject({patients:[],total:0,page:1,pages:1,hasMore:false});
});

test.each([{status:'unknown'},{verification:'unknown'},{sort:'full_name; DROP TABLE users'},{page:'1.5'},{page:'-1'},{page:'Infinity'}])('rejects invalid patient list options %j',async options=>{
 const response=await listPatients(options);expect(response.status).toBe(422);expect(pool.execute).toHaveBeenCalledTimes(1);
});

test('patient search is parameterised and treats wildcard characters literally',async()=>{
 patientListResult(0,[]);const query="name_%' OR 1=1 --";await listPatients({query});
 const [sql,values]=pool.execute.mock.calls[1];expect(sql).not.toContain(query);expect(values[0]).toBe("%name\\_\\%' OR 1=1 --%");
});

test.each(['staff','patient'])('%s cannot use the administrator patient filters',async role=>{
 pool.execute.mockResolvedValue([[{id:3,role}]]);const response=await listPatients({status:'active'});expect(response.status).toBe(403);expect(pool.execute).toHaveBeenCalledTimes(1);
});
