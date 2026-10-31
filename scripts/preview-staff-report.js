// Generates a sample report for visual verification; never connects to the database.
const fs = require('fs');
const path = require('path');
const { buildQualityReport, automaticReportOptions } = require('../backend/src/services/reportQuality');
const { generateStaffReportPdf } = require('../backend/src/services/staffReportPdf');
const rows = Array.from({length:40}, (_,i)=>({
  id:i+1,serviceId:i%3+1,serviceName:['General consultation','Dental consultation','Follow-up consultation'][i%3],
  queueNumber:i+1,joinedAt:`2026-10-${String(i%20+1).padStart(2,'0')}`,visitMonth:i<20?'2026-09':'2026-10',
  status:i%5===0?'cancelled':'completed',isTestVisit:0,consultationStartedAt:i%5===0?null:'2026-10-01',
  waitMinutes:i%5===0?null:(i*7)%90,consultationMinutes:i%5===0?null:10+i%12,predictedMinutes:15,predictionModel:'sample',
}));
const report = buildQualityReport(rows,'2026-09-01','2026-10-31',automaticReportOptions(),'sample');
report.preview=true;
const target = path.join(__dirname,'../output/pdf/staff-report-visual-preview.pdf');
fs.mkdirSync(path.dirname(target),{recursive:true});
generateStaffReportPdf(report).then(buffer=>{fs.writeFileSync(target,buffer);console.log(target);}).catch(error=>{console.error(error);process.exitCode=1;});
