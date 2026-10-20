const { buildQualityReport,reportOptions }=require('../src/services/reportQuality');
const request=require('supertest');
const app=require('../src/app');
const {pool}=require('../src/config/database');
const model='operational-f4-hist-gradient-boosting-v1';
const visit=(id,extra={})=>({id,serviceId:1,queueNumber:id,serviceName:'General',status:'completed',isTestVisit:0,consultationStartedAt:'2026-10-20',waitMinutes:10,consultationMinutes:15,predictedMinutes:12,predictionModel:model,...extra});
const build=(rows,query={})=>buildQualityReport(rows,'2026-10-20','2026-10-20',reportOptions(query),model);
afterEach(()=>jest.restoreAllMocks());afterAll(()=>pool.end());
test('test and unclassified visits are excluded by default without guessing',()=>{
 const report=build([visit(1),visit(2,{isTestVisit:1,waitMinutes:900}),visit(3,{isTestVisit:null})]);
 expect(report.summary.totalPatients).toBe(1);expect(report.summary.averageWaitMinutes).toBe(10);
 expect(report.quality.excludedByScope).toBe(2);expect(report.visits).toHaveLength(3);
});
test('long durations stay intact and are flagged unless explicitly excluded',()=>{
 const rows=[visit(1),visit(2,{waitMinutes:900,consultationMinutes:180})];
 const report=build(rows);expect(report.summary.longestWaitMinutes).toBe(900);expect(report.quality.flaggedVisits).toBe(1);
 const filtered=build(rows,{excludeUnusual:'true'});expect(filtered.summary.averageWaitMinutes).toBe(10);expect(filtered.quality.excludedUnusual).toBe(1);
 expect(filtered.visits[1].waitMinutes).toBe(900);expect(rows[1].waitMinutes).toBe(900);
});
test('ongoing visits do not enter final duration or prediction-error statistics',()=>{
 const report=build([visit(1),visit(2,{status:'waiting',consultationStartedAt:null,waitMinutes:null,consultationMinutes:null,elapsedWaitMinutes:200}),visit(3,{status:'in_progress',consultationMinutes:null,elapsedConsultationMinutes:80})]);
 expect(report.summary.averageConsultationMinutes).toBe(15);expect(report.summary.measuredConsultationVisits).toBe(1);
 expect(report.summary.waitingNow).toBe(1);expect(report.summary.inConsultationNow).toBe(1);expect(report.predictionPerformance.modelVisits).toBe(2);
});
test('median and within-five counts use real values without capping or boundary rounding',()=>{
 const report=build([visit(1,{waitMinutes:1,predictedMinutes:6.04}),visit(2,{waitMinutes:20}),visit(3,{waitMinutes:900})]);
 expect(report.summary.medianWaitMinutes).toBe(20);expect(report.predictionPerformance.withinFiveMinutes).toBe(0);
});
test('scope and unusual exclusion counts are disjoint',()=>{
 const report=build([visit(1,{isTestVisit:1,waitMinutes:900}),visit(2,{waitMinutes:900}),visit(3)],{excludeUnusual:'true'});
 expect(report.quality.excludedByScope).toBe(1);expect(report.quality.excludedUnusual).toBe(1);expect(report.quality.includedVisits).toBe(1);
});
test('review thresholds are configurable and invalid options are rejected',()=>{
 expect(build([visit(1,{waitMinutes:121})],{waitReviewMinutes:'180'}).quality.flaggedVisits).toBe(0);
 expect(reportOptions({dataScope:'invalid'})).toBeNull();expect(reportOptions({waitReviewMinutes:'0'})).toBeNull();
});
test('automatic filtering covers all visit types, without staff decisions',()=>{
 const {automaticReportOptions}=require('../src/services/reportQuality');
 const report=buildQualityReport([visit(1,{isTestVisit:1}),visit(2,{isTestVisit:null}),visit(3,{waitMinutes:900})],'2026-10-20','2026-10-20',automaticReportOptions(),model);
 expect(report.summary.totalPatients).toBe(2);expect(report.quality.excludedUnusual).toBe(1);expect(report.quality.excludedByScope).toBe(0);
});
test('API filtering cannot be overridden through staff query parameters',async()=>{
 jest.spyOn(pool,'execute').mockResolvedValueOnce([[{id:2,role:'staff'}]]).mockResolvedValueOnce([[
  visit(1,{isTestVisit:1}),visit(2,{waitMinutes:900})
 ]]);
 const response=await request(app).get('/api/staff/reports?from=2026-10-20&to=2026-10-20&excludeUnusual=false&waitReviewMinutes=9999').set('Cookie','mediq_session=test');
 expect(response.status).toBe(200);expect(response.body.summary.totalPatients).toBe(1);expect(response.body.quality.waitReviewMinutes).toBe(120);
});
