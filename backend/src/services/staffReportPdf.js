const { PDFDocument } = require('pdfkit');

// Charts are drawn as vectors so exported reports remain sharp when printed.
const C={ink:'#182c3b',muted:'#647681',teal:'#087f73',blue:'#457db5',amber:'#cc932f',red:'#c8685f',line:'#dde6e9',pale:'#f1f7f6',white:'#ffffff'};
const L=44,W=507,BOTTOM=744;
const n=value=>Math.max(0,Number(value)||0);
const pct=(value,total)=>total?Math.round(n(value)/total*100):0;
const mins=value=>value==null?'Not measured':`${Number(Number(value).toFixed(1))} min`;
const date=value=>new Intl.DateTimeFormat('en-MY',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T00:00:00Z'));

function generateStaffReportPdf(report,generatedAt=new Date()) {
 return new Promise((resolve,reject)=>{
  const doc=new PDFDocument({size:'A4',margin:44,bufferPages:true});const chunks=[];
  doc.on('data',chunk=>chunks.push(chunk));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
  const s=report.summary||{},total=n(s.totalPatients),completed=n(s.completed),cancelled=n(s.cancelled),other=Math.max(0,total-completed-cancelled);
  const q=report.quality||{totalVisits:total,includedVisits:total,excludedUnusual:0};
  const services=report.services||[],prediction=report.predictionPerformance||{};
  const scope=report.serviceId?(report.availableServices||[]).find(v=>String(v.serviceId)===String(report.serviceId))?.serviceName||'Selected service':'All clinic services';
  const txt=(value,x,y,width=W,size=10,color=C.ink,bold=false)=>{
   doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(size).fillColor(color);
   const options={width,align:'left',lineGap:2,paragraphGap:0,continued:false,characterSpacing:0};
   const height=doc.heightOfString(String(value),options);doc.text(String(value),x,y,options);return height;
  };
  const rule=y=>doc.moveTo(L,y).lineTo(L+W,y).strokeColor(C.line).lineWidth(.7).stroke();
  let first=true;
  const page=(chapter,title,subtitle)=>{
   if(!first)doc.addPage();first=false;
   doc.rect(0,0,595.28,7).fill(C.teal);
   txt('MediQ',L,29,180,18,C.teal,true);txt(report.preview?'SAMPLE REPORT':'STAFF OPERATIONS',L+320,34,187,8,C.muted,true);
   rule(63);txt(chapter.toUpperCase(),L,84,W,8,C.teal,true);
   txt(title,L,104,W,25,C.ink,true);
   txt(subtitle,L,142,W,9,C.muted);
  };
  const heading=(title,y,note)=>{txt(title,L,y,W,14,C.ink,true);if(note)txt(note,L,y+23,W,9,C.muted);};
  const card=(label,value,note,x,y,width=161)=>{
   doc.roundedRect(x,y,width,87,10).fill(C.pale);
   txt(label,x+13,y+12,width-26,8,C.muted,true);
   txt(value,x+13,y+30,width-26,String(value).length>10?17:22,C.ink,true);
   txt(note,x+13,y+61,width-26,7.5,C.muted);
  };
  const noteBox=(title,body,y)=>{
   const height=txtHeight(body,W-34,9)+49;
   doc.roundedRect(L,y,W,height,9).fill(C.pale);txt(title,L+17,y+13,W-34,10,C.teal,true);txt(body,L+17,y+34,W-34,9,C.ink);return y+height;
  };
  const txtHeight=(value,width,size)=>{doc.font('Helvetica').fontSize(size);return doc.heightOfString(String(value),{width,lineGap:2});};
  const legend=(items,x,y,width=W)=>{const step=width/items.length;items.forEach((item,i)=>{doc.circle(x+i*step+4,y+5,3).fill(item.color);txt(item.label,x+i*step+13,y,width/items.length-15,8,C.muted);});};
  const stacked=(items,x,y,width,height)=>{
   const sum=items.reduce((a,v)=>a+n(v.value),0);doc.roundedRect(x,y,width,height,4).fill(C.line);
   let offset=0;for(const item of items){if(sum&&n(item.value)){const size=width*n(item.value)/sum;doc.rect(x+offset,y,size,height).fill(item.color);offset+=size;}}
  };
  const donut=(items,x,y,r)=>{
   const sum=items.reduce((a,v)=>a+n(v.value),0);doc.circle(x,y,r).fill(C.line);
   let angle=-Math.PI/2;
   for(const item of items){if(!sum||!n(item.value))continue;const end=angle+Math.PI*2*n(item.value)/sum;doc.moveTo(x,y);for(let a=angle;a<end;a+=.035)doc.lineTo(x+Math.cos(a)*r,y+Math.sin(a)*r);doc.lineTo(x+Math.cos(end)*r,y+Math.sin(end)*r).closePath().fill(item.color);angle=end;}
   doc.circle(x,y,r*.68).fill(C.white);
   doc.font('Helvetica-Bold').fontSize(26).fillColor(C.ink).text(String(sum),x-r*.6,y-17,{width:r*1.2,align:'center'});
   doc.font('Helvetica').fontSize(8).fillColor(C.muted).text('included visits',x-r*.6,y+16,{width:r*1.2,align:'center'});
  };
  try{
   doc.info.Title='MediQ visual queue performance report';doc.info.Author='MediQ';doc.info.CreationDate=generatedAt;
   page('01 / At a glance','Queue performance summary',`${date(report.from)} - ${date(report.to)} | ${scope}`);
   const stamp=new Intl.DateTimeFormat('en-MY',{timeZone:'Asia/Kuala_Lumpur',dateStyle:'medium',timeStyle:'short'}).format(generatedAt);
   txt(`Prepared ${stamp} (Malaysia time)`,L,166,W,8,C.muted);
   card('INCLUDED VISITS',total,'Queue visits, not unique people',L,195);
   card('COMPLETION RATE',total?`${pct(completed,total)}%`:'No visits',`${completed} completed visits`,L+173,195);
   card('AVERAGE WAIT',mins(s.averageWaitMinutes),`${n(s.measuredWaitVisits)} measured waits`,L+346,195);
   card('COMPLETED',completed,'Consultations completed',L,294);
   card('CANCELLED',cancelled,total?`${pct(cancelled,total)}% of included visits`:'No included visits',L+173,294);
   card('CONSULTATION TIME',mins(s.averageConsultationMinutes),'Average completed consultation',L+346,294);
   heading('How visits ended',410,'Statuses reflect the time the report was generated.');
   const outcomes=[{label:'Completed',value:completed,color:C.teal},{label:'Cancelled',value:cancelled,color:C.red},{label:'Active / other',value:other,color:C.amber}];
   donut(outcomes,L+96,554,83);
   outcomes.forEach((item,i)=>{const y=485+i*47;doc.circle(L+221,y+7,4).fill(item.color);txt(item.label,L+236,y,162,10,C.ink,true);txt(`${item.value} visits | ${pct(item.value,total)}%`,L+236,y+17,230,9,C.muted);});
   const busiest=services.reduce((best,v)=>!best||n(v.patientCount)>n(best.patientCount)?v:best,null);
   noteBox('What stands out',total?`${completed} of ${total} included visits were completed. ${busiest?`The busiest service handled ${pct(busiest.patientCount,total)}% of included visits. `:''}${total<10?'This is a small sample; interpret percentages with care.':'See the following pages for waiting times and service comparisons.'}`:'No visits passed the report filters. Check the chosen dates, service and data coverage on the next page.',650);

   page('02 / Waiting and coverage','Waiting times, explained','Only measured, included waits enter the waiting-time charts. Open visits are not final waits.');
   heading('How long did measured visits wait?',190,'Each bar counts visits in one waiting-time range.');
   const buckets=report.waitDistribution||[],maximum=Math.max(1,...buckets.map(v=>n(v.count)));
   buckets.forEach((v,i)=>{const y=246+i*46;txt(v.label,L,y,185,9,C.ink);doc.roundedRect(L+188,y+1,261,16,4).fill(C.line);if(n(v.count))doc.roundedRect(L+188,y+1,Math.max(2,261*n(v.count)/maximum),16,4).fill(C.teal);txt(`${n(v.count)}`,L+465,y,42,10,C.ink,true);});
   card('MEDIAN WAIT',mins(s.medianWaitMinutes),'Middle measured waiting time',L,448);
   card('LONGEST WAIT',mins(s.longestWaitMinutes),'Longest included measured wait',L+173,448);
   const measured=buckets.reduce((sum,v)=>sum+n(v.count),0),under30=buckets.slice(0,2).reduce((sum,v)=>sum+n(v.count),0);
   card('WAITED UNDER 30 MIN',measured?`${pct(under30,measured)}%`:'Not measured',`${under30} of ${measured} measured waits`,L+346,448);
   heading('How much data is included?',563,`${n(q.includedVisits)} of ${n(q.totalVisits)} selected visits contribute to the summary.`);
   const excluded=Math.max(0,n(q.totalVisits)-n(q.includedVisits));
   stacked([{value:n(q.includedVisits),color:C.teal},{value:excluded,color:C.amber}],L,611,W,18);
   legend([{label:`Included: ${n(q.includedVisits)}`,color:C.teal},{label:`Excluded: ${excluded}`,color:C.amber}],L,642);
   txt(`Excluded visits remain available in Visit review. Automatic checks flag missing or invalid timing data and unusually long durations. Review limits: wait ${q.waitReviewMinutes??120} min; consultation ${q.consultationReviewMinutes??60} min. Original durations are never capped.`,L,676,W,9,C.muted);

   const serviceGroups=[];for(let i=0;i<services.length;i+=4)serviceGroups.push(services.slice(i,i+4));if(!serviceGroups.length)serviceGroups.push([]);
   serviceGroups.forEach((group,index)=>{
    page('03 / Service comparison',index?'Service performance (continued)':'Which services handled the visits?','Compare workload, outcomes and measured waiting times within the selected period.');
    legend(outcomes,L,188);
    let y=229;
    if(!group.length)noteBox('No service activity','There are no included service visits in this reporting period.',y);
    for(const v of group){
     const height=txt(v.serviceName,L,y,W,12,C.ink,true);y+=height+8;
     const entries=n(v.patientCount),done=n(v.completed),cancel=n(v.cancelled),active=Math.max(0,entries-done-cancel);
     stacked([{value:done,color:C.teal},{value:cancel,color:C.red},{value:active,color:C.amber}],L,y,W,14);y+=23;
     txt(`${entries} visits | ${done} completed (${pct(done,entries)}%) | ${cancel} cancelled | ${active} other`,L,y,W,9);y+=19;
     txt(`Average measured wait: ${mins(v.averageWaitMinutes)} | ${n(v.measuredWaitVisits)} measured visits`,L,y,W,8,C.muted);y+=31;
    }
    txt('Each service bar represents 100% of that service\'s included visits. Compare the labelled visit counts to assess workload; compare the coloured shares to assess outcomes.',L,688,W,9,C.muted);
   });

   const monthly=new Map();for(const v of report.monthly||[]){if(!monthly.has(v.month))monthly.set(v.month,{month:v.month,total:0,completed:0,cancelled:0});const m=monthly.get(v.month);m.total+=n(v.total);m.completed+=n(v.completed);m.cancelled+=n(v.cancelled);}
   // Fill absent months with zero so the timeline does not visually skip quiet periods.
   const start=new Date(report.from+'T00:00:00Z'),end=new Date(report.to+'T00:00:00Z');start.setUTCDate(1);
   for(let i=0;start<=end&&i<1200;i++,start.setUTCMonth(start.getUTCMonth()+1)){const key=start.toISOString().slice(0,7);if(!monthly.has(key))monthly.set(key,{month:key,total:0,completed:0,cancelled:0});}
   const months=[...monthly.values()].sort((a,b)=>a.month.localeCompare(b.month));
   const monthGroups=[];for(let i=0;i<months.length;i+=8)monthGroups.push(months.slice(i,i+8));if(!monthGroups.length)monthGroups.push([]);
   monthGroups.forEach((group,index)=>{
    page('04 / Monthly activity',index?'Monthly activity (continued)':'How did activity change by month?','Months group visits by their queue date. Partial months include only the selected dates.');
    legend([{label:'All included visits',color:C.blue},{label:'Completed visits',color:C.teal}],L,190);
    const x=L+28,top=248,h=205,bottom=top+h,cw=W-38,peak=Math.max(1,...group.map(v=>v.total)),axisStep=Math.max(1,Math.ceil(peak/4)),max=axisStep*4;
    for(let i=0;i<=4;i++){const yy=bottom-h*i/4;doc.moveTo(x,yy).lineTo(L+W,yy).strokeColor(C.line).lineWidth(.5).stroke();txt(String(axisStep*i),L,yy-5,24,8,C.muted);}
    const step=cw/Math.max(1,group.length),bar=Math.min(27,step*.28);
    group.forEach((v,i)=>{const cx=x+step*(i+.5);const ht=h*v.total/max,hc=h*v.completed/max;if(ht)doc.rect(cx-bar-2,bottom-ht,bar,ht).fill(C.blue);if(hc)doc.rect(cx+2,bottom-hc,bar,hc).fill(C.teal);txt(v.month,cx-step*.46,bottom+12,step*.92,8,C.muted);txt(`${v.total} / ${v.completed}`,cx-step*.46,bottom+30,step*.92,8,C.ink,true);});
    txt('Labels below each month: included visits / completed visits',L,507,W,8,C.muted);
    const localTotal=group.reduce((sum,v)=>sum+v.total,0),localDone=group.reduce((sum,v)=>sum+v.completed,0);
    noteBox('Reading this chart',group.length>1?`These months contain ${localTotal} included visits and ${localDone} completed visits. Compare bar heights for volume. Different month lengths and partial months can affect the totals.`:'Only one month is represented. This chart shows its volume; a longer reporting period is needed to compare months.',550);
    txt('Service-specific monthly counts are available by choosing a clinic service before generating the report. A completed visit is counted in its queue month, even if the status changed later.',L,660,W,9,C.muted);
   });

   page('05 / Prediction and report notes','Understand the estimates','Prediction performance uses recorded estimates and measured consultation-start waiting times.');
   const model=n(prediction.modelVisits),within=n(prediction.withinFiveMinutes);
   card('ML VISITS MEASURED',model,'With a saved estimate and actual wait',L,196);
   card('AVERAGE ERROR',model?mins(prediction.meanAbsoluteErrorMinutes):'Not measured','Mean absolute difference',L+173,196);
   card('WITHIN 5 MINUTES',model?`${pct(within,model)}%`:'Not measured',`${within} of ${model} measured ML visits`,L+346,196);
   heading('How close were the estimates?',319,model?'Measured ML visits only; fallback estimates are excluded.':'No matched ML estimate and actual wait is available for this period.');
   stacked([{value:within,color:C.teal},{value:Math.max(0,model-within),color:C.amber}],L,375,W,20);
   legend([{label:`Within 5 min: ${within}`,color:C.teal},{label:`Over 5 min: ${Math.max(0,model-within)}`,color:C.amber}],L,410);
   txt(`${n(prediction.fallbackVisits)} measured fallback estimates are excluded from ML accuracy. Local results do not replace the model's original dataset evaluation.`,L,447,W,9,C.muted);
   noteBox('What the statistics mean','Visits are queue entries, so a returning patient can be counted more than once. Average wait runs from joining the queue to starting consultation. Average consultation runs from consultation start to completion. Open visits do not enter completed-duration averages. Cancelled and other statuses are counted at export time.',503);
   txt(`Report scope: ${scope}. The statistics use automatically included records for ${date(report.from)} to ${date(report.to)}. Visit review and its CSV export retain excluded records for checking.`,L,654,W,9,C.muted);

   if(report.includeVisitDetails){
    page('Appendix / Visit review','Supporting visit records','Includes excluded visits. No patient names or identification numbers are printed.');let y=195;
    for(const v of report.visits||[]){
     const lines=`Q${v.serviceId}-${String(v.queueNumber).padStart(3,'0')} | ${v.serviceName}\n${v.status.replaceAll('_',' ')} | ${v.included?'Included':'Excluded'} | Actual wait: ${mins(v.waitMinutes)} | Consultation: ${mins(v.consultationMinutes)}\nEstimate: ${mins(v.predictedMinutes)} | Error: ${mins(v.errorMinutes)} | Review: ${(v.flags||[]).join(', ')||'No flags'}`;
     const height=txtHeight(lines,W,8)+24;
     if(y+height>BOTTOM){page('Appendix / Visit review','Visit records (continued)','Full detail for the selected period and service.');y=195;}
     txt(lines,L,y,W,8);y+=height;rule(y-11);
    }
   }
   const {start:pageStart,count:pages}=doc.bufferedPageRange();
   for(let i=pageStart;i<pageStart+pages;i++){doc.switchToPage(i);rule(770);txt('MediQ | Internal operational report',L,782,370,8,C.muted);txt(`${i-pageStart+1} / ${pages}`,L+W-40,782,40,8,C.muted);}
   doc.end();
  }catch(error){reject(error);}
 });
}
module.exports={generateStaffReportPdf};
