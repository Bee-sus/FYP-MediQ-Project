const round = value => value == null ? null : Math.round(value * 10) / 10;
const valid = value => value != null && Number.isFinite(Number(value)) && Number(value) >= 0;
const average = values => values.length ? round(values.reduce((a,b)=>a+b,0)/values.length) : null;
function reportOptions(query) {
  const scope=query.dataScope || 'operational';
  const wait=Number(query.waitReviewMinutes ?? 120), consultation=Number(query.consultationReviewMinutes ?? 60);
  if(!['operational','test','unclassified','all'].includes(scope) || !Number.isInteger(wait)||wait<1||wait>10080 || !Number.isInteger(consultation)||consultation<1||consultation>10080 || (query.excludeUnusual!=null&&!['true','false'].includes(query.excludeUnusual)))return null;
  return {dataScope:scope, waitReviewMinutes:wait, consultationReviewMinutes:consultation, excludeUnusual:query.excludeUnusual==='true'};
}
function automaticReportOptions() {
  const bounded=(value,fallback)=>{const n=Number(value);return Number.isInteger(n)&&n>=1&&n<=10080?n:fallback;};
  return {...reportOptions({dataScope:'all',excludeUnusual:'true',waitReviewMinutes:bounded(process.env.REPORT_MAX_WAIT_MINUTES,120),consultationReviewMinutes:bounded(process.env.REPORT_MAX_CONSULTATION_MINUTES,60)}),automaticFiltering:true};
}
function buildQualityReport(rows,from,to,options,modelVersion) {
  options ||= automaticReportOptions();
  let visits=rows.map(row=>{
    const classification=row.isTestVisit==null?'unclassified':Number(row.isTestVisit)===1?'test':'operational';
    const flags=[];
    if ((row.status==='completed'&&(!row.consultationStartedAt||row.consultationMinutes==null)) || (row.status==='in_progress'&&!row.consultationStartedAt)) flags.push('Incomplete timestamps');
    if([row.waitMinutes,row.consultationMinutes,row.elapsedWaitMinutes,row.elapsedConsultationMinutes].some(v=>v!=null&&!valid(v)))flags.push('Invalid duration');
    if([row.waitMinutes,row.elapsedWaitMinutes].some(v=>valid(v)&&Number(v)>options.waitReviewMinutes))flags.push('Long wait');
    if([row.consultationMinutes,row.elapsedConsultationMinutes].some(v=>valid(v)&&Number(v)>options.consultationReviewMinutes))flags.push('Long consultation');
    const inScope=options.dataScope==='all'||classification===options.dataScope;
    const included=inScope&&(!options.excludeUnusual||!flags.length);
    const wait=valid(row.waitMinutes)?Number(row.waitMinutes):null;
    return {...row,classification,flags,included,waitMinutes:round(wait),consultationMinutes:valid(row.consultationMinutes)?round(Number(row.consultationMinutes)):null,
      rawErrorMinutes:wait!=null&&valid(row.predictedMinutes)?Math.abs(Number(row.predictedMinutes)-wait):null,
      errorMinutes:wait!=null&&valid(row.predictedMinutes)?round(Math.abs(Number(row.predictedMinutes)-wait)):null};
  });
  const availableServices = [...new Map(rows.map(v => [v.serviceId, { serviceId: v.serviceId, serviceName: v.serviceName }])).values()];
  if (options.serviceId) visits = visits.filter(v => Number(v.serviceId) === Number(options.serviceId));
  const included=visits.filter(v=>v.included);
  const monthlyMap = new Map();
  for (const visit of included) {
    const date = visit.visitMonth || (visit.joinedAt instanceof Date ? `${visit.joinedAt.getFullYear()}-${String(visit.joinedAt.getMonth()+1).padStart(2,'0')}` : String(visit.joinedAt || '').slice(0,7));
    if (!/^\d{4}-\d{2}$/.test(date)) continue;
    const key = date + ':' + visit.serviceId;
    if (!monthlyMap.has(key)) monthlyMap.set(key, { month: date, serviceName: visit.serviceName, total: 0, completed: 0, cancelled: 0 });
    const bucket = monthlyMap.get(key); bucket.total++; if (visit.status === 'completed') bucket.completed++; if (visit.status === 'cancelled') bucket.cancelled++;
  }
  const waits=included.filter(v=>valid(v.waitMinutes)).map(v=>v.waitMinutes).sort((a,b)=>a-b);
  const consultations=included.filter(v=>v.status==='completed'&&valid(v.consultationMinutes)).map(v=>v.consultationMinutes);
  const waitDistribution = [
    {label:'Under 15 minutes',count:waits.filter(v=>v<15).length},
    {label:'15 to under 30 minutes',count:waits.filter(v=>v>=15&&v<30).length},
    {label:'30 to under 60 minutes',count:waits.filter(v=>v>=30&&v<60).length},
    {label:'60 minutes or more',count:waits.filter(v=>v>=60).length},
  ];
  const summary={totalPatients:included.length,completed:included.filter(v=>v.status==='completed').length,cancelled:included.filter(v=>v.status==='cancelled').length,
    averageWaitMinutes:average(waits),medianWaitMinutes:waits.length?round(waits.length%2?waits[(waits.length-1)/2]:(waits[waits.length/2-1]+waits[waits.length/2])/2):null,
    longestWaitMinutes:waits.length?waits[waits.length-1]:null,averageConsultationMinutes:average(consultations),
    waitingNow:included.filter(v=>['waiting','called','not_present'].includes(v.status)).length,inConsultationNow:included.filter(v=>v.status==='in_progress').length,
    measuredWaitVisits:waits.length,measuredConsultationVisits:consultations.length};
  const serviceMap=new Map();
  for(const visit of included){if(!serviceMap.has(visit.serviceId))serviceMap.set(visit.serviceId,{serviceName:visit.serviceName,patientCount:0,completed:0,cancelled:0,waitTotal:0,measuredWaitVisits:0});const s=serviceMap.get(visit.serviceId);s.patientCount++;if(visit.status==='completed')s.completed++;if(visit.status==='cancelled')s.cancelled++;if(valid(visit.waitMinutes)){s.waitTotal+=Number(visit.waitMinutes);s.measuredWaitVisits++;}}
  for(const service of serviceMap.values()){service.averageWaitMinutes=service.measuredWaitVisits?round(service.waitTotal/service.measuredWaitVisits):null;delete service.waitTotal;}
  const measured=included.filter(v=>v.consultationStartedAt&&valid(v.errorMinutes));
  const ml=measured.filter(v=>v.predictionModel===modelVersion);
  const errors=ml.map(v=>v.rawErrorMinutes);
  const predictionServices=[...new Set(ml.map(v=>v.serviceId))].map(id=>{const list=ml.filter(v=>v.serviceId===id);return {serviceName:list[0].serviceName,measuredVisits:list.length,meanAbsoluteErrorMinutes:average(list.map(v=>v.rawErrorMinutes)),withinFiveMinutes:list.filter(v=>v.rawErrorMinutes<=5).length};});
  const inScope=visits.filter(v=>options.dataScope==='all'||v.classification===options.dataScope);
  return {from,to,summary,serviceId:options.serviceId || null,availableServices,monthly:[...monthlyMap.values()].sort((a,b)=>a.month.localeCompare(b.month)||a.serviceName.localeCompare(b.serviceName)),services:[...serviceMap.values()].sort((a,b)=>b.patientCount-a.patientCount),
    waitDistribution,
    predictionPerformance:{measuredVisits:measured.length,modelVisits:ml.length,fallbackVisits:measured.length-ml.length,meanAbsoluteErrorMinutes:average(errors),withinFiveMinutes:ml.filter(v=>v.rawErrorMinutes<=5).length,services:predictionServices},
    quality:{...options,totalVisits:visits.length,includedVisits:included.length,excludedByScope:visits.length-inScope.length,excludedUnusual:inScope.filter(v=>options.excludeUnusual&&v.flags.length).length,flaggedVisits:inScope.filter(v=>v.flags.length).length,testVisits:visits.filter(v=>v.classification==='test').length,unclassifiedVisits:visits.filter(v=>v.classification==='unclassified').length},
    visits:options.includeAllVisits ? visits : visits.slice(0,200),detailTotal:visits.length,detailLimit:options.includeAllVisits ? visits.length : 200};
}
module.exports={reportOptions,automaticReportOptions,buildQualityReport};
