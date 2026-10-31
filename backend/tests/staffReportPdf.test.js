const {buildQualityReport,automaticReportOptions}=require('../src/services/reportQuality');
const {generateStaffReportPdf}=require('../src/services/staffReportPdf');
const makeReport=(rows=[])=>buildQualityReport(rows,'2026-01-01','2026-10-31',{...automaticReportOptions(),includeAllVisits:true},'test');
test('visual PDF handles an empty period and absent measurements',async()=>{
 const pdf=await generateStaffReportPdf(makeReport());
 expect(pdf.subarray(0,4).toString()).toBe('%PDF');expect(pdf.length).toBeGreaterThan(4000);
});
test('visual PDF paginates long service names and includes optional visit records',async()=>{
 const rows=Array.from({length:18},(_,i)=>({id:i+1,serviceId:i+1,serviceName:'Long clinic service name '.repeat(5),status:'completed',queueNumber:i+1,joinedAt:'2026-10-01',consultationStartedAt:'2026-10-01',waitMinutes:10,consultationMinutes:15,visitMonth:'2026-10',isTestVisit:0,predictedMinutes:12,predictionModel:'test'}));
 const report=makeReport(rows);report.includeVisitDetails=true;
 const pdf=await generateStaffReportPdf(report);
 expect(pdf.subarray(0,4).toString()).toBe('%PDF');expect(pdf.length).toBeGreaterThan(10000);
});
test('service statistics derive measured waits and outcomes from included records',()=>{
 const report=makeReport([{serviceId:1,serviceName:'General',status:'completed',isTestVisit:0,consultationStartedAt:'2026-10-01',waitMinutes:10,consultationMinutes:15},{serviceId:1,serviceName:'General',status:'cancelled',isTestVisit:0,waitMinutes:null,consultationMinutes:null}]);
 expect(report.services[0]).toMatchObject({patientCount:2,completed:1,cancelled:1,measuredWaitVisits:1,averageWaitMinutes:10});
});
