let reportData = null;
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
  section.innerHTML = '<div class="report-prediction-heading"><div><p class="staff-eyebrow">Prediction check</p><h4>ML prediction performance</h4></div><span>Saved estimate vs actual wait</span></div><div class="report-prediction-metrics"></div><p class="report-prediction-note"></p><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Service</th><th>ML visits measured</th><th>Average error</th><th>Within 5 min</th></tr></thead><tbody></tbody></table></div>';
  const count = Number(performance.modelVisits) || 0;
  const within = Number(performance.withinFiveMinutes) || 0;
  section.querySelector('.report-prediction-metrics').replaceChildren(
    reportMetric('ML visits measured', count, 'Consultation start recorded'),
    reportMetric('Average error', count && performance.meanAbsoluteErrorMinutes != null ? `${performance.meanAbsoluteErrorMinutes} min` : '—', 'Mean absolute error'),
    reportMetric('Within 5 minutes', count ? `${within} / ${count}` : '—', count ? `${Math.round(within / count * 100)}% of measured ML visits` : 'No measured ML visits'),
  );
  section.querySelector('.report-prediction-note').textContent = count
    ? `${performance.fallbackVisits} measured fallback estimate${Number(performance.fallbackVisits) === 1 ? '' : 's'} excluded from ML accuracy. These figures describe visits recorded in this database; test visits should be interpreted as test data.`
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
    [], ['ML prediction performance', 'Only visits with recorded consultation start'],
    ['ML visits measured', prediction.modelVisits], ['Average absolute error (min)', prediction.meanAbsoluteErrorMinutes ?? ''],
    ['Within 5 minutes', prediction.withinFiveMinutes], ['Measured fallback estimates excluded', prediction.fallbackVisits],
    [], ['Service', 'ML visits measured', 'Average absolute error (min)', 'Within 5 minutes'],
    ...prediction.services.map(service => [service.serviceName, service.measuredVisits, service.meanAbsoluteErrorMinutes ?? '', service.withinFiveMinutes])];
  const blob = new Blob([rows.map(row => row.map(escape).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `mediq-report-${reportData.from}-to-${reportData.to}.csv`; link.click(); URL.revokeObjectURL(link.href);
}

async function downloadPdfReport(button) {
  button.disabled = true;
  try {
    const response = await fetch(`/api/staff/reports/pdf?from=${encodeURIComponent(reportData.from)}&to=${encodeURIComponent(reportData.to)}`, { credentials: 'same-origin' });
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
  finally { button.disabled = false; }
}

document.querySelector('#report-form').addEventListener('submit', async event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  const result = document.querySelector('#report-result');
  result.textContent = 'Generating report…';
  try {
    reportData = await staffApi(`/api/staff/reports?from=${encodeURIComponent(values.from)}&to=${encodeURIComponent(values.to)}`);
    const total = Number(reportData.summary.totalPatients) || 0;
    const completed = Number(reportData.summary.completed) || 0;
    const cancelled = Number(reportData.summary.cancelled) || 0;
    const active = Math.max(0, total - completed - cancelled);
    const completionRate = total ? Math.round(completed / total * 100) : 0;
    const metrics = [
      ['Total patients', total, 'All queue entries'], ['Completed', completed, `${completionRate}% completion rate`],
      ['Average wait', reportData.summary.averageWaitMinutes == null ? '—' : `${reportData.summary.averageWaitMinutes} min`, 'Join to consultation'],
      ['Average consultation', reportData.summary.averageConsultationMinutes == null ? '—' : `${reportData.summary.averageConsultationMinutes} min`, 'Consultation duration'],
    ];
    result.innerHTML = '<article class="report-document"><header class="report-title"><div><p class="staff-eyebrow">MediQ analytics</p><h3>Queue performance report</h3><span class="report-period"></span></div><div class="report-actions"><button id="export-report-pdf" class="staff-primary-button" type="button">Download PDF</button><button id="download-report" class="staff-secondary-button" type="button">Download CSV</button></div></header><div class="report-grid"></div><div class="report-chart-grid"><section><h4>Patient outcomes</h4><div id="outcome-chart"></div></section><section><h4>Patients by service</h4><div id="service-chart"></div></section></div><section class="report-table-section"><h4>Service performance</h4><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Service</th><th>Patients</th><th>Completed</th><th>Completion rate</th></tr></thead><tbody></tbody></table></div></section><aside class="report-insight"><strong>Report insight</strong><p></p></aside><footer class="report-footer"></footer></article>';
    result.querySelector('.report-period').textContent = `${reportData.from} to ${reportData.to}`;
    result.querySelector('.report-grid').replaceChildren(...metrics.map(item => reportMetric(...item)));
    result.querySelector('#outcome-chart').append(renderDonutChart([{ label: 'Completed', value: completed, color: '#0b8879' }, { label: 'Cancelled', value: cancelled, color: '#d95d50' }, { label: 'Active / other', value: active, color: '#e3a13a' }]));
    result.querySelector('#service-chart').append(renderServiceChart(reportData.services));
    const body = result.querySelector('tbody');
    reportData.services.forEach(service => { const row = body.insertRow(); [service.serviceName, service.patientCount, service.completed, `${service.patientCount ? Math.round(service.completed / service.patientCount * 100) : 0}%`].forEach(value => { row.insertCell().textContent = value; }); });
    result.querySelector('.report-insight').before(renderPredictionPerformance(reportData.predictionPerformance));
    const busiest = reportData.services.find(service => Number(service.patientCount) > 0);
    result.querySelector('.report-insight p').textContent = total ? `${busiest ? `${busiest.serviceName} handled the most patients (${busiest.patientCount}). ` : ''}${completionRate}% of patients completed their visit and ${cancelled} queue entr${cancelled === 1 ? 'y was' : 'ies were'} cancelled.` : 'No queue activity was recorded for the selected period.';
    result.querySelector('.report-footer').textContent = `Generated ${new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}`;
    result.querySelector('#download-report').addEventListener('click', () => downloadCsvReport(metrics));
    result.querySelector('#export-report-pdf').addEventListener('click', event => downloadPdfReport(event.currentTarget));
  } catch (error) { result.textContent = error.message; }
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
}));
document.querySelector('[data-report-days="6"]').click();


