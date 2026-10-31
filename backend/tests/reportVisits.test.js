const {reviewOptions,filterVisits,visitCsv}=require('../src/services/reportVisits');
jest.mock('../src/config/database',()=>({pool:{execute:jest.fn()}}));
const {pool}=require('../src/config/database');
const request=require('supertest');
const app=require('../src/app');
beforeEach(()=>jest.resetAllMocks());
const visits=Array.from({length:230},(_,i)=>({serviceId:1,queueNumber:i+1,serviceName:'Dental',status:i%2?'completed':'cancelled',included:i%3!==0,flags:i%3===0?['Long wait']:[],waitMinutes:10,consultationMinutes:15}));
test('search covers records beyond the previous 200 visit limit',()=>{
 expect(filterVisits(visits,reviewOptions({search:'q1-225'}))).toHaveLength(1);
});
test('review options validate status and pagination',()=>{
 expect(reviewOptions({page:'0'})).toBeNull();expect(reviewOptions({pageSize:'1000'})).toBeNull();expect(reviewOptions({status:'bogus'})).toBeNull();
 expect(reviewOptions({page:'2',pageSize:'25'})).toMatchObject({page:2,pageSize:25});
});
test('inclusion and review flags combine without changing source records',()=>{
 const matches=filterVisits(visits,reviewOptions({inclusion:'excluded',flags:'flagged',status:'cancelled'}));
 expect(matches.length).toBeGreaterThan(0);expect(matches.every(v=>!v.included&&v.flags.length&&v.status==='cancelled')).toBe(true);expect(visits).toHaveLength(230);
});
test('CSV includes all matches and escapes quotes and spreadsheet formulas',()=>{
 const csv=visitCsv([...visits,{...visits[0],serviceName:'=SUM("A1")'}]);
 expect(csv.split('\r\n')).toHaveLength(232);expect(csv).toContain("'=SUM");expect(csv).toContain('""A1""');
});

test('visit endpoint searches the entire report and returns only the requested page',async()=>{
 pool.execute.mockResolvedValueOnce([[{id:2,role:'staff'}]]).mockResolvedValueOnce([visits]);
 const response=await request(app).get('/api/staff/reports/visits?from=2026-10-01&to=2026-10-31&search=q1-225').set('Cookie','mediq_session=test');
 expect(response.status).toBe(200);expect(response.body.total).toBe(1);expect(response.body.visits[0].queueNumber).toBe(225);
});
test('visit endpoint applies service selection to review records',async()=>{
 pool.execute.mockResolvedValueOnce([[{id:2,role:'staff'}]]).mockResolvedValueOnce([[...visits,{...visits[0],serviceId:2}]]);
 const response=await request(app).get('/api/staff/reports/visits?from=2026-10-01&to=2026-10-31&serviceId=2').set('Cookie','mediq_session=test');
 expect(response.status).toBe(200);expect(response.body.total).toBe(1);expect(response.body.visits[0].serviceId).toBe(2);
});
test('CSV endpoint exports every matching visit, including beyond the first page',async()=>{
 pool.execute.mockResolvedValueOnce([[{id:2,role:'staff'}]]).mockResolvedValueOnce([visits]);
 const response=await request(app).get('/api/staff/reports/visits?from=2026-10-01&to=2026-10-31&format=csv').set('Cookie','mediq_session=test');
 expect(response.status).toBe(200);expect(response.headers['content-type']).toContain('text/csv');expect(response.text).toContain('Q1-230');
});
test('visit endpoint rejects invalid filters without querying report data',async()=>{
 pool.execute.mockResolvedValueOnce([[{id:2,role:'staff'}]]);
 const response=await request(app).get('/api/staff/reports/visits?from=2026-10-01&to=2026-10-31&status=invalid').set('Cookie','mediq_session=test');
 expect(response.status).toBe(422);expect(pool.execute).toHaveBeenCalledTimes(1);
});
test('patients cannot access report records',async()=>{
 pool.execute.mockResolvedValueOnce([[{id:3,role:'patient'}]]);
 const response=await request(app).get('/api/staff/reports/visits?from=2026-10-01&to=2026-10-31').set('Cookie','mediq_session=test');
 expect(response.status).toBe(403);expect(pool.execute).toHaveBeenCalledTimes(1);
});
