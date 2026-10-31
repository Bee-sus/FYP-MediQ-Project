let reportData = null;
let reportRequest = 0;
let reportSection = 'overview';
const reportForm = document.querySelector('#report-form');
const reportFeedback = document.querySelector('#report-feedback');
function reportChanged() {
  reportFeedback.textContent = 'Filters changed. Generate the report to apply them.';
  document.querySelectorAll('#report-result .report-actions button').forEach(button=>{button.disabled=true;});
}
function reportMetric(label, value, note) {
  const card = document.createElement('article');
  card.innerHTML = '<span></span><strong></strong><small></small>';
  card.querySelector('span').textContent = label;
  card.querySelector('strong').textContent = value;
  card.querySelector('small').textContent = note;
  return card;
}

function renderDonutChart(items) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const chart = document.createElement('div');
  chart.className = 'report-donut-layout';
  const donut = document.createElement('div');
  donut.className = 'report-donut';
  let offset = 0;
  const stops = items.map(item => {
    const start = total ? offset / total * 100 : 0;
    offset += item.value;
    const end = total ? offset / total * 100 : 0;
    return `${item.color} ${start}% ${end}%`;
  });
  donut.style.background = total ? `conic-gradient(${stops.join(',')})` : '#e8edf1';
  donut.innerHTML = '<div><strong></strong><span>patients</span></div>';
  donut.querySelector('strong').textContent = total;
  const legend = document.createElement('div');
  legend.className = 'report-legend';
  items.forEach(item => {
    const row = document.createElement('p');
    row.innerHTML = '<i></i><span></span><strong></strong>';
    row.querySelector('i').style.background = item.color;
    row.querySelector('span').textContent = item.label;
    row.querySelector('strong').textContent = `${item.value} (${total ? Math.round(item.value / total * 100) : 0}%)`;
    legend.append(row);
  });
  chart.append(donut, legend);
  return chart;
}

function renderServiceChart(services) {
  const chart = document.createElement('div');
  chart.className = 'report-bars';
  const maximum = Math.max(1, ...services.map(service => Number(service.patientCount)));
  services.forEach(service => {
    const row = document.createElement('div');
    row.innerHTML = '<div><span></span><strong></strong></div><div class="report-bar-track"><span></span></div>';
    row.querySelector('span').textContent = service.serviceName;
    row.querySelector('strong').textContent = service.patientCount;
    row.querySelector('.report-bar-track span').style.width = `${Number(service.patientCount) / maximum * 100}%`;
    chart.append(row);
  });
  if (!services.length) chart.textContent = 'No service activity in this period.';
  return chart;
}

function renderPredictionPerformance(performance) {
  const section = document.createElement('section');
  section.className = 'report-prediction-section';
  section.innerHTML = '<div class="report-prediction-heading"><div><p class="staff-eyebrow">Prediction check</p><h4>Local queue prediction performance</h4></div><span>Saved estimate vs actual wait</span></div><div class="report-prediction-metrics"></div><p class="report-prediction-note"></p><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Service</th><th>ML visits measured</th><th>Average error</th><th>Within 5 min</th></tr></thead><tbody></tbody></table></div>';
  const count = Number(performance.modelVisits) || 0;
  const within = Number(performance.withinFiveMinutes) || 0;
  section.querySelector('.report-prediction-metrics').replaceChildren(
    reportMetric('ML visits measured', count, 'Consultation start recorded'),
    reportMetric('Average error', count && performance.meanAbsoluteErrorMinutes != null ? `${performance.meanAbsoluteErrorMinutes} min` : '—', 'Mean absolute error'),
    reportMetric('Within 5 minutes', count ? `${within} / ${count}` : '—', count ? `${Math.round(within / count * 100)}% of measured ML visits` : 'No measured ML visits'),
  );
  section.querySelector('.report-prediction-note').textContent = count
    ? `${performance.fallbackVisits} measured fallback estimate${Number(performance.fallbackVisits) === 1 ? '' : 's'} excluded from ML accuracy. These are local operational or test results, not the model’s original dataset evaluation.`
    : 'No ML prediction has both a saved estimate and an actual consultation start in this period. Fallback estimates are excluded from ML accuracy.';
  const body = section.querySelector('tbody');
  (performance.services || []).forEach(service => {
    const row = body.insertRow();
    [service.serviceName, service.measuredVisits, service.meanAbsoluteErrorMinutes == null ? '—' : `${service.meanAbsoluteErrorMinutes} min`, `${service.withinFiveMinutes} / ${service.measuredVisits}`]
      .forEach(value => { row.insertCell().textContent = value; });
  });
  if (!body.rows.length) section.querySelector('.report-table-wrap').hidden = true;
  return section;
}

function downloadCsvReport(metrics) {
  const escape = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const prediction = reportData.predictionPerformance;
  const rows = [['MediQ Staff Report'], ['From', reportData.from], ['To', reportData.to], [], ['Metric', 'Value'], ...metrics.map(item => [item[0], item[1]]),
    [], ['Service', 'Patients', 'Completed', 'Completion rate'], ...reportData.services.map(item => [item.serviceName, item.patientCount, item.completed, `${item.patientCount ? Math.round(item.completed / item.patientCount * 100) : 0}%`]),
    [], ['Local queue prediction performance', 'Only visits with recorded consultation start'],
    ['ML visits measured', prediction.modelVisits], ['Average absolute error (min)', prediction.meanAbsoluteErrorMinutes ?? ''],
    ['Within 5 minutes', prediction.withinFiveMinutes], ['Measured fallback estimates excluded', prediction.fallbackVisits],
    [], ['Service', 'ML visits measured', 'Average absolute error (min)', 'Within 5 minutes'],
    ...prediction.services.map(service => [service.serviceName, service.measuredVisits, service.meanAbsoluteErrorMinutes ?? '', service.withinFiveMinutes])];
  rows.push([], ['Filtering', 'Automatic duration checks'], ['Excluded by scope',reportData.quality.excludedByScope], ['Excluded unusual visits',reportData.quality.excludedUnusual], ['Wait review threshold (min)',reportData.quality.waitReviewMinutes], ['Consultation review threshold (min)',reportData.quality.consultationReviewMinutes], [], ['Visit details (latest '+reportData.visits.length+' of '+reportData.detailTotal+')'], ['Ticket','Service','Status','Included','Predicted min','Actual wait min','Consultation min','Elapsed wait min','Elapsed consultation min','Absolute error min','Review flags']);
  reportData.visits.forEach(v=>rows.push([formatReportTicket(v),v.serviceName,v.status,v.included?'Yes':'No',v.predictedMinutes,v.waitMinutes,v.consultationMinutes,v.elapsedWaitMinutes,v.elapsedConsultationMinutes,v.errorMinutes,v.flags.join('; ')]));
  rows.push([], ['Month','Service','Visits','Completed','Cancelled'], ...(reportData.monthly || []).map(item => [item.month,item.serviceName,item.total,item.completed,item.cancelled]));
  const blob = new Blob([rows.map(row => row.map(escape).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `mediq-report-${reportData.from}-to-${reportData.to}.csv`; link.click(); URL.revokeObjectURL(link.href);
}

async function downloadPdfReport(button) {
  button.disabled = true;
  const originalText=button.textContent;button.textContent='Preparing PDF…';
  try {
    const response = await fetch(`/api/staff/reports/pdf?${reportQuery(reportData)}`, { credentials: 'same-origin' });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || 'The PDF report could not be downloaded.');
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `mediq-queue-report-${reportData.from}-to-${reportData.to}.pdf`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) { showAlert(error.message, 'error'); }
  finally { button.disabled = false;button.textContent=originalText; }
}

document.querySelector('#report-form').addEventListener('submit', async event => {
  event.preventDefault();
  if(reportForm.querySelector('[type="submit"]').disabled)return;
  const values = Object.fromEntries(new FormData(event.currentTarget));
  const result = document.querySelector('#report-result');
  if(values.from>values.to){reportFeedback.textContent='Start date must be on or before the end date.';reportForm.elements.from.focus();return;}
  const version=++reportRequest;
  const submit=reportForm.querySelector('[type="submit"]');submit.disabled=true;submit.textContent='Generating…';
  reportForm.querySelectorAll('input,select,button').forEach(control=>{control.disabled=true;});
  result.setAttribute('aria-busy','true');reportFeedback.textContent='Loading your report…';
  try {
    const data = await staffApi(`/api/staff/reports?${new URLSearchParams(values)}`);
    if(version!==reportRequest)return;
    reportData=data;
    try{localStorage.setItem('mediq-staff-report-filters',JSON.stringify(values));}catch(_){}
    const serviceSelect = document.querySelector('#report-service');
    const selected = serviceSelect.value;
    for (const service of reportData.availableServices || []) {
      const existing=[...serviceSelect.options].find(option=>option.value===String(service.serviceId));if(existing)existing.textContent=service.serviceName;
      if (![...serviceSelect.options].some(option => option.value === String(service.serviceId))) {
        const option = document.createElement('option'); option.value = service.serviceId; option.textContent = service.serviceName; serviceSelect.append(option);
      }
    }
    serviceSelect.value = selected;
    const total = Number(reportData.summary.totalPatients) || 0;
    const completed = Number(reportData.summary.completed) || 0;
    const cancelled = Number(reportData.summary.cancelled) || 0;
    const active = Math.max(0, total - completed - cancelled);
    const completionRate = total ? Math.round(completed / total * 100) : 0;
    const metrics = [
      ['Total visits', total, 'Included queue entries; repeat visits counted separately'], ['Completed', completed, `${completionRate}% completion rate`],
      ['Average wait', reportData.summary.averageWaitMinutes == null ? '—' : `${reportData.summary.averageWaitMinutes} min`, 'Join to consultation'],
      ['Median wait', reportData.summary.medianWaitMinutes == null ? '—' : reportData.summary.medianWaitMinutes+' min', 'Middle measured wait'],
      ['Longest wait', reportData.summary.longestWaitMinutes == null ? '—' : reportData.summary.longestWaitMinutes+' min', 'Measured wait; no cap'],
      ['Still waiting / consulting', reportData.summary.waitingNow+' / '+reportData.summary.inConsultationNow, 'Elapsed time shown separately'],
      ['Average consultation', reportData.summary.averageConsultationMinutes == null ? '—' : `${reportData.summary.averageConsultationMinutes} min`, 'Consultation duration'],
    ];
    result.innerHTML = '<article class="report-document"><header class="report-title"><div><p class="staff-eyebrow">MediQ analytics</p><h3>Queue performance report</h3><span class="report-period"></span></div><div class="report-actions"><button id="export-report-pdf" class="staff-primary-button" type="button">Download PDF</button><button id="download-report" class="staff-secondary-button" type="button">Download CSV</button></div></header><div class="report-grid"></div><div class="report-chart-grid"><section><h4>Patient outcomes</h4><div id="outcome-chart"></div></section><section><h4>Patients by service</h4><div id="service-chart"></div></section></div><section class="report-table-section"><h4>Service performance</h4><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Service</th><th>Patients</th><th>Completed</th><th>Completion rate</th></tr></thead><tbody></tbody></table></div></section><aside class="report-insight"><strong>Report insight</strong><p></p></aside><footer class="report-footer"></footer></article>';
    const selectedService = reportData.availableServices.find(s=>String(s.serviceId)===String(reportData.serviceId));
    result.querySelector('.report-period').textContent = `${reportData.from} to ${reportData.to} · ${selectedService?.serviceName || (reportData.serviceId ? 'Selected service' : 'All services')}`;
    result.querySelector('.report-grid').replaceChildren(...metrics.map(item => reportMetric(...item)));
    result.querySelector('#outcome-chart').append(renderDonutChart([{ label: 'Completed', value: completed, color: '#0b8879' }, { label: 'Cancelled', value: cancelled, color: '#d95d50' }, { label: 'Active / other', value: active, color: '#e3a13a' }]));
    result.querySelector('#service-chart').append(renderServiceChart(reportData.services));
    const extraCharts = document.createElement('div'); extraCharts.className = 'report-chart-grid';
    const addChart = (title, note, chart) => { const section = document.createElement('section'); const h = document.createElement('h4'); h.textContent = title; const p = document.createElement('p'); p.textContent = note; section.append(h,p,chart); extraCharts.append(section); };
    addChart('Actual waiting-time distribution', 'Measured waits only; open visits and excluded records are omitted.', renderServiceChart((reportData.waitDistribution || []).map(item=>({serviceName:item.label,patientCount:item.count}))));
    const rateChart = renderServiceChart(reportData.services.map(item=>({serviceName:item.serviceName,patientCount:item.patientCount ? Math.round(item.completed/item.patientCount*100) : 0})));
    rateChart.querySelectorAll('strong').forEach(value=>{value.textContent += '%';});
    rateChart.querySelectorAll('.report-bar-track span').forEach((bar,index)=>{const item=reportData.services[index];bar.style.width=`${item.patientCount ? item.completed/item.patientCount*100 : 0}%`;});
    addChart('Completion rate by service', 'Completed visits as a share of included visits for each service.', rateChart);
    addChart('Report data coverage', 'Shows how much of the selected report is included in the statistics.', renderDonutChart([{label:'Included',value:reportData.quality.includedVisits,color:'#0b8879'},{label:'Excluded',value:reportData.quality.totalVisits-reportData.quality.includedVisits,color:'#d95d50'}]));
    result.querySelector('.report-insight').before(extraCharts);
    const monthly = document.createElement('section'); monthly.className = 'report-table-section';
    monthly.innerHTML = '<h4>Monthly completions by service</h4><p>Completed queue visits grouped by visit month, service and selected date range.</p><div class="monthly-completion-chart"></div><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Month</th><th>Service</th><th>Visits</th><th>Completed</th><th>Cancelled</th><th>Completion rate</th></tr></thead><tbody></tbody></table></div>';
    monthly.querySelector('.monthly-completion-chart').append(renderServiceChart((reportData.monthly || []).map(item => ({ serviceName: item.month + ' · ' + item.serviceName, patientCount: item.completed }))));
    for (const item of reportData.monthly || []) {
      const row = monthly.querySelector('tbody').insertRow();
      [item.month,item.serviceName,item.total,item.completed,item.cancelled,Math.round(item.completed / item.total * 100)+'%'].forEach(value => { row.insertCell().textContent = value; });
    }
    result.querySelector('.report-insight').before(monthly);
    const body = result.querySelector('tbody');
    reportData.services.forEach(service => { const row = body.insertRow(); [service.serviceName, service.patientCount, service.completed, `${service.patientCount ? Math.round(service.completed / service.patientCount * 100) : 0}%`].forEach(value => { row.insertCell().textContent = value; }); });
    result.querySelector('.report-insight').before(renderPredictionPerformance(reportData.predictionPerformance));
    const busiest = reportData.services.find(service => Number(service.patientCount) > 0);
    result.querySelector('.report-insight p').textContent = total ? `${busiest ? `${busiest.serviceName} handled the most patients (${busiest.patientCount}). ` : ''}${completionRate}% of patients completed their visit and ${cancelled} queue entr${cancelled === 1 ? 'y was' : 'ies were'} cancelled.` : 'No queue activity was recorded for the selected period.';
    result.querySelector('.report-insight').before(renderVisitReview(reportData));
    result.querySelector('.report-footer').textContent = `Generated ${new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}`;
    result.querySelector('#download-report').addEventListener('click', () => downloadCsvReport(metrics));
    result.querySelector('#export-report-pdf').addEventListener('click', event => downloadPdfReport(event.currentTarget));
    organiseReport(result,extraCharts,monthly);
    reportFeedback.textContent=total ? `Report ready · ${reportData.quality.includedVisits} of ${reportData.quality.totalVisits} visits included.` : 'No included visits for this period. Try a wider date range or check Visit review for excluded records.';
  } catch (error) { if(version===reportRequest)reportFeedback.textContent=`${error.message} Your previous report remains available. Select Generate report to retry.`; }
  finally {if(version===reportRequest){reportForm.querySelectorAll('input,select,button').forEach(control=>{control.disabled=false;});submit.textContent='Generate report';result.setAttribute('aria-busy','false');}}
});

document.querySelectorAll('[data-report-days]').forEach(button => button.addEventListener('click', () => {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - Number(button.dataset.reportDays));
  const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const form = document.querySelector('#report-form');
  form.elements.from.value = localDate(from);
  form.elements.to.value = localDate(to);
  document.querySelectorAll('[data-report-days]').forEach(item => item.classList.toggle('active', item === button));
  document.querySelectorAll('[data-report-calendar]').forEach(item=>item.classList.remove('active'));
  document.querySelector('#report-month').value='';reportChanged();
}));
document.querySelector('[data-report-days="6"]').click();
document.querySelector('#report-month').addEventListener('change', event => {
  if (!event.target.value) return;
  const [year,month] = event.target.value.split('-').map(Number);
  const form = document.querySelector('#report-form');
  form.elements.from.value = event.target.value + '-01';
  form.elements.to.value = event.target.value + '-' + new Date(year,month,0).getDate();
  document.querySelectorAll('[data-report-days],[data-report-calendar]').forEach(item=>item.classList.remove('active'));
  reportChanged();
});
staffApi('/api/services').then(data => {
  const select = document.querySelector('#report-service');
  for (const service of data.services || []) {
    if ([...select.options].some(option => option.value === String(service.id))) continue;
    const option = document.createElement('option'); option.value = service.id; option.textContent = service.name; select.append(option);
  }
}).catch(() => {});


function formatReportTicket(v) { return 'Q'+v.serviceId+'-'+String(v.queueNumber).padStart(3,'0'); }
function reportQuery(report) { return new URLSearchParams({from:report.from,to:report.to,...(report.serviceId ? {serviceId:report.serviceId} : {})}); }
function renderVisitReview(report) {
 const section=document.createElement('details');section.className='report-table-section visit-review';
 const heading=document.createElement('summary');heading.textContent='Visit review';section.append(heading);
 const note=document.createElement('p');note.textContent='Automatic filtering: '+report.quality.includedVisits+' of '+report.quality.totalVisits+' visits included; '+report.quality.excludedUnusual+' excluded for invalid or unusually long durations. Limits: wait '+report.quality.waitReviewMinutes+' minutes; consultation '+report.quality.consultationReviewMinutes+' minutes. Open visits are not treated as completed durations. Showing latest '+report.visits.length+' of '+report.detailTotal+' records. Original timestamps remain unchanged.';section.append(note);
 const wrap=document.createElement('div');wrap.className='report-table-wrap';
 const empty=document.createElement('p');empty.className='review-empty';empty.hidden=true;empty.textContent='No matching visits. Clear your filters to see all records.';
 const table=document.createElement('table');table.className='report-table review-visits-table';table.innerHTML='<thead><tr><th scope="col">Visit</th><th scope="col">Status</th><th scope="col">Wait</th><th scope="col">Statistics</th><th scope="col"><span class="review-sr-only">Visit details</span></th></tr></thead><tbody></tbody>';
 const filters=document.createElement('div'); filters.className='review-filters';
 filters.innerHTML='<div class="review-main-filters"><label>Find a visit<input data-review="search" type="search" placeholder="Search ticket or service…" /></label><label>Status<select data-review="status"><option value="">All statuses</option><option value="waiting">Waiting</option><option value="called">Called</option><option value="in_progress">In consultation</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="not_present">Not present</option></select></label><button type="button" class="review-more-filters" aria-expanded="false" aria-controls="review-extra-filters"><span>More filters<span data-active-filter-count></span></span></button></div><div id="review-extra-filters" class="review-extra-filters" hidden><label>Statistics<select data-review="inclusion"><option value="">All records</option><option value="included">Included</option><option value="excluded">Excluded</option></select></label><label>Review flags<select data-review="flags"><option value="">All records</option><option value="flagged">Needs review</option><option value="clear">No flags</option></select></label></div>';
 const moreFilters=filters.querySelector('.review-more-filters');
 const extraFilters=filters.querySelector('.review-extra-filters');
 moreFilters.addEventListener('click',()=>{extraFilters.hidden=!extraFilters.hidden;moreFilters.setAttribute('aria-expanded',String(!extraFilters.hidden));});
 section.append(filters);
 const pager=document.createElement('div');pager.className='review-pager';pager.innerHTML='<button type="button" class="staff-secondary-button" data-prev>Previous</button><span role="status" aria-live="polite"></span><button type="button" class="staff-secondary-button" data-next>Next</button>';
 const toolbar=document.createElement('div');toolbar.className='review-toolbar';
 toolbar.innerHTML='<span class="review-record-count" role="status"></span><button type="button" class="review-reset" data-clear hidden>Clear filters</button><button type="button" class="staff-secondary-button" data-export>Export visits CSV</button>';
 section.insertBefore(toolbar,filters);
 const pageLabel=document.createElement('label');pageLabel.className='review-page-size';pageLabel.innerHTML='Show <select data-page-size aria-label="Visits per page"><option>10</option><option>25</option><option>50</option></select> per page';
 pager.prepend(pageLabel);const pageSizeSelect=pageLabel.querySelector('select');
 let page=1,requestId=0,timer;
 const params=()=>{
 const search=filters.querySelector('[data-review="search"]').value.trim().toLowerCase();
 const status=filters.querySelector('[data-review="status"]').value;
 const inclusion=filters.querySelector('[data-review="inclusion"]').value;
 const flags=filters.querySelector('[data-review="flags"]').value;
 const query=reportQuery(report);Object.entries({search,status,inclusion,flags,page,pageSize:pageSizeSelect.value}).forEach(([key,value])=>query.set(key,value));return query;
 };
 const draw=async()=>{
 const id=++requestId;
 const active=[...filters.querySelectorAll('input,select')].filter(input=>input.value).length;
 toolbar.querySelector('[data-clear]').hidden=!active;
 const extra=[...filters.querySelectorAll('.review-extra-filters select')].filter(input=>input.value).length;
 filters.querySelector('[data-active-filter-count]').textContent=extra?` (${extra})`:'';
 pager.querySelector('span').textContent='Loading visits…';
 pager.querySelectorAll('button').forEach(b=>{b.disabled=true;});wrap.setAttribute('aria-busy','true');
 try{
 const data=await staffApi('/api/staff/reports/visits?'+params());
 if(id!==requestId)return;
 page=data.page;
 table.querySelector('tbody').replaceChildren();
 for(const visit of data.visits){
  const row=document.createElement('tr');
  const duration=value=>value==null?'—':Number(value).toFixed(1)+' min';
  row.innerHTML='<td><strong class="review-ticket"></strong><small class="review-service"></small></td><td><span class="review-status"></span></td><td><strong class="review-wait"></strong><small class="review-wait-note"></small></td><td><span class="review-inclusion"></span></td><td><button type="button" class="review-detail-button" aria-expanded="false">Details</button></td>';
  row.querySelector('.review-ticket').textContent=formatReportTicket(visit);row.querySelector('.review-service').textContent=visit.serviceName;
  const statusLabels={called:'Called',waiting:'Waiting',in_progress:'In consultation',completed:'Completed',cancelled:'Cancelled',not_present:'Not present',skipped:'Skipped'};
  const status=row.querySelector('.review-status');status.textContent=statusLabels[visit.status]||visit.status;status.dataset.status=visit.status;
  const wait=visit.waitMinutes??visit.elapsedWaitMinutes;
  row.querySelector('.review-wait').textContent=readableReviewWait(wait);
  row.querySelector('.review-wait-note').textContent=visit.waitMinutes==null?(visit.elapsedWaitMinutes==null?'Not measured':'Still waiting'):'Actual wait';
  const inclusion=row.querySelector('.review-inclusion');inclusion.textContent=visit.included?'Included':'Excluded';inclusion.dataset.included=String(visit.included);
  const detailRow=document.createElement('tr');detailRow.className='review-detail-row';detailRow.hidden=true;detailRow.id='visit-review-details-'+visit.id;
  const cell=detailRow.insertCell();cell.colSpan=5;const detail=document.createElement('dl');
  for(const [label,value] of [['Actual wait',duration(visit.waitMinutes)],['Current elapsed wait',duration(visit.elapsedWaitMinutes)],['Consultation',duration(visit.consultationMinutes)],['Elapsed consultation',duration(visit.elapsedConsultationMinutes)],['Predicted wait',duration(visit.predictedMinutes)],['Prediction error',duration(visit.errorMinutes)],['Review notes',visit.flags.join(', ')||'No flags']]){const term=document.createElement('dt'),description=document.createElement('dd');term.textContent=label;description.textContent=value;detail.append(term,description);}
  cell.append(detail);const button=row.querySelector('button');button.setAttribute('aria-label',`View details for ${formatReportTicket(visit)}`);button.setAttribute('aria-controls',detailRow.id);
  button.onclick=()=>{detailRow.hidden=!detailRow.hidden;button.setAttribute('aria-expanded',String(!detailRow.hidden));button.textContent=detailRow.hidden?'Details':'Close';};
  table.querySelector('tbody').append(row,detailRow);
 }
 wrap.hidden=!data.total;empty.hidden=Boolean(data.total);
 toolbar.querySelector('.review-record-count').textContent=`${data.total} visit${data.total===1?'':'s'}${active?' match your filters':''}`;
 pager.querySelector('span').textContent=`Page ${page} of ${data.pages}`;
 pager.querySelector('[data-prev]').disabled=page===1;pager.querySelector('[data-next]').disabled=page===data.pages;
 }catch(error){if(id===requestId){pager.querySelector('span').textContent=error.message;pager.querySelector('[data-next]').textContent='Retry';pager.querySelector('[data-next]').disabled=false;}}
 finally{if(id===requestId)wrap.setAttribute('aria-busy','false');}
 };
 filters.addEventListener('input',()=>{page=1;clearTimeout(timer);timer=setTimeout(draw,250);});
 pageSizeSelect.onchange=()=>{page=1;draw();};
 toolbar.querySelector('[data-clear]').onclick=()=>{filters.querySelectorAll('input,select').forEach(input=>{input.value='';});page=1;clearTimeout(timer);draw();};
 toolbar.querySelector('[data-export]').onclick=async event=>{
  const button=event.currentTarget;button.disabled=true;
  try{const query=params();query.set('format','csv');const response=await fetch('/api/staff/reports/visits?'+query,{credentials:'same-origin'});if(!response.ok)throw new Error('Visit export failed. Please retry.');const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download=`mediq-filtered-visits-${report.from}-to-${report.to}.csv`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}catch(error){pager.querySelector('span').textContent=error.message;}finally{button.disabled=false;}
 };
 pager.querySelector('[data-prev]').onclick=()=>{page=Math.max(1,page-1);draw();};pager.querySelector('[data-next]').onclick=event=>{if(event.currentTarget.textContent==='Retry')event.currentTarget.textContent='Next';else page++;draw();};
 note.className='review-intro';note.textContent=`${report.quality.includedVisits} of ${report.quality.totalVisits} visits included in statistics. Open Details to see timings and review notes.`;
 wrap.append(table);section.append(wrap,empty,pager);
 section.addEventListener('toggle',()=>{if(section.open&&!section.dataset.loaded){section.dataset.loaded='true';draw();}});
 return section;
}

function readableReviewWait(value){
 if(value==null)return '—';const minutes=Math.max(0,Math.round(Number(value)));
 if(minutes<60)return `${minutes} min`;
 const days=Math.floor(minutes/1440),hours=Math.floor(minutes%1440/60),remaining=minutes%60;
 return [days?`${days}d`:'',hours?`${hours}h`:'',remaining?`${remaining}m`:''].filter(Boolean).join(' ');
}

function organiseReport(result,extraCharts,monthly){
 const article=result.querySelector('.report-document');
 const overview=document.createElement('section'),charts=document.createElement('section'),review=document.createElement('section');
 overview.id='report-overview';charts.id='report-charts';review.id='report-review';
 overview.append(result.querySelector('.report-grid'),result.querySelector('.report-chart-grid'),result.querySelector('.report-insight'));
 charts.append(extraCharts,monthly,result.querySelector('.report-prediction-section'));
 const serviceTable=article.querySelector('.report-table-section:not(.visit-review)');if(serviceTable)charts.append(serviceTable);
 review.append(result.querySelector('.visit-review'));
 const navigation=document.createElement('nav');navigation.className='report-section-nav';navigation.setAttribute('aria-label','Report sections');
 for(const [name,label,panel] of [['overview','Summary',overview],['charts','Charts & services',charts],['review','Visit review',review]]){
  const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.reportSection=name;button.setAttribute('aria-controls',panel.id);
  button.onclick=()=>{reportSection=name;for(const p of [overview,charts,review])p.hidden=p!==panel;navigation.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));if(name==='review')review.querySelector('details').open=true;};navigation.append(button);
 }
 article.querySelector('.report-title').after(navigation);article.querySelector('.report-footer').before(overview,charts,review);
 navigation.querySelector(`[data-report-section="${reportSection}"]`).click();
}

const localReportDate=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
document.querySelectorAll('[data-report-calendar]').forEach(button=>button.onclick=()=>{
 const now=new Date(),type=button.dataset.reportCalendar;
 const from=type==='year'?new Date(now.getFullYear(),0,1):new Date(now.getFullYear(),now.getMonth()-(type==='previous'?1:0),1);
 const to=type==='previous'?new Date(now.getFullYear(),now.getMonth(),0):now;
 reportForm.elements.from.value=localReportDate(from);reportForm.elements.to.value=localReportDate(to);document.querySelector('#report-month').value='';
 document.querySelectorAll('[data-report-days],[data-report-calendar]').forEach(item=>item.classList.toggle('active',item===button));reportChanged();
});
reportForm.addEventListener('input',()=>{document.querySelectorAll('[data-report-days],[data-report-calendar]').forEach(item=>item.classList.remove('active'));reportChanged();});
document.querySelector('#reset-report').onclick=()=>{reportForm.reset();document.querySelector('[data-report-days="6"]').click();reportChanged();};
window.addEventListener('refresh-staff-report',()=>reportForm.requestSubmit());
try{const saved=JSON.parse(localStorage.getItem('mediq-staff-report-filters')||'null');if(saved){for(const key of ['from','to'])if(/^\d{4}-\d{2}-\d{2}$/.test(saved[key]||''))reportForm.elements[key].value=saved[key];if(saved.serviceId){const option=document.createElement('option');option.value=saved.serviceId;option.textContent='Previously selected service';document.querySelector('#report-service').append(option);reportForm.elements.serviceId.value=saved.serviceId;}document.querySelectorAll('[data-report-days]').forEach(b=>b.classList.remove('active'));}}catch(_){}
reportForm.requestSubmit();
