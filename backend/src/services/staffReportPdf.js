const { PDFDocument } = require('pdfkit');

const PAGE_WIDTH = 595.28;
const LEFT = 48;
const RIGHT = PAGE_WIDTH - LEFT;
const WIDTH = RIGHT - LEFT;
const CONTENT_BOTTOM = 747;
const INK = '#1d2d42';
const MUTED = '#5f6d7c';
const ACCENT = '#0b776c';
const RULE = '#cdd6dd';

const count = value => Math.max(0, Number(value) || 0);
const minutes = value => value == null ? 'Not available' : `${Number(Number(value).toFixed(1))} min`;

function displayDate(value) {
  return new Intl.DateTimeFormat('en-MY', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(`${value}T00:00:00Z`));
}

function generatedDate(value) {
  return new Intl.DateTimeFormat('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short',
  }).format(value);
}

function line(doc, x1, y, x2, color = RULE, width = 0.7) {
  doc.moveTo(x1, y).lineTo(x2, y).strokeColor(color).lineWidth(width).stroke();
}

function section(doc, number, title, y) {
  doc.font('Helvetica-Bold').fontSize(10).fillColor(ACCENT)
    .text(`${number}  /  ${title.toUpperCase()}`, LEFT, y, { characterSpacing: 0.8 });
  line(doc, LEFT, y + 18, RIGHT);
  return y + 30;
}

function firstPageHeader(doc, report, generatedAt) {
  doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text('MediQ', LEFT, 39);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED)
    .text('CLINIC OPERATIONS  /  STAFF REPORT', 295, 46, { width: 252, align: 'right', characterSpacing: 0.8 });
  line(doc, LEFT, 76, RIGHT, ACCENT, 1.5);

  doc.font('Times-Bold').fontSize(25).fillColor(INK).text('Queue activity report', LEFT, 98);
  doc.font('Helvetica').fontSize(11).fillColor(MUTED)
    .text(`${displayDate(report.from)} to ${displayDate(report.to)}`, LEFT, 135);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('PREPARED', LEFT, 164);
  doc.font('Helvetica').fontSize(9).fillColor(INK)
    .text(`${generatedDate(generatedAt)}  |  Malaysia time`, LEFT + 67, 163);
  if (report.preview) doc.font('Helvetica-Bold').fontSize(8).fillColor(ACCENT)
    .text('SAMPLE DATA', 434, 164, { width: 113, align: 'right' });
  if(report.quality) doc.font('Helvetica').fontSize(7).fillColor(MUTED).text('Automatic filtering'+' | Included: '+report.quality.includedVisits+' / '+report.quality.totalVisits+' | Excluded: '+(report.quality.excludedByScope+report.quality.excludedUnusual),LEFT,176,{width:WIDTH});
  line(doc, LEFT, 186, RIGHT);
}

function continuationHeader(doc, report) {
  doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text('MediQ', LEFT, 40);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED)
    .text(`Queue activity report  |  ${displayDate(report.from)} to ${displayDate(report.to)}`,
      176, 43, { width: 371, align: 'right' });
  line(doc, LEFT, 75, RIGHT, ACCENT, 1.3);
}

function executiveSummary(doc, report) {
  const total = count(report.summary.totalPatients);
  const completed = count(report.summary.completed);
  const cancelled = count(report.summary.cancelled);
  const other = Math.max(0, total - completed - cancelled);
  const rate = total ? Math.round(completed / total * 100) : 0;
  const busiest = report.services.find(service => count(service.patientCount) > 0);
  const period = `${displayDate(report.from)} and ${displayDate(report.to)}`;
  const narrative = total
    ? `Between ${period}, the clinic recorded ${total} queue entr${total === 1 ? 'y' : 'ies'}. ${completed} ${completed === 1 ? 'was' : 'were'} completed (${rate}%), ${cancelled} ${cancelled === 1 ? 'was' : 'were'} cancelled, and ${other} ${other === 1 ? 'was' : 'were'} in other statuses at export.${busiest ? ` ${busiest.serviceName} had the most activity with ${count(busiest.patientCount)} entries.` : ''}`
    : `No queue entries were recorded between ${period}. The measures and service counts below reflect that empty reporting period.`;
  const start = section(doc, '01', 'Executive summary', 208);
  doc.font('Times-Roman').fontSize(11).fillColor(INK);
  const height = doc.heightOfString(narrative, { width: WIDTH, lineGap: 3 });
  doc.text(narrative, LEFT, start, { width: WIDTH, lineGap: 3 });
  if (total > 0 && total < 10) {
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(MUTED)
      .text('The small number of entries means percentages may change substantially with further activity.',
        LEFT, start + height + 8, { width: WIDTH });
    return start + height + 28;
  }
  return start + height + 15;
}

function results(doc, report, y) {
  const total = count(report.summary.totalPatients);
  const completed = count(report.summary.completed);
  const cancelled = count(report.summary.cancelled);
  const other = Math.max(0, total - completed - cancelled);
  const rate = value => `${total ? Math.round(value / total * 100) : 0}%`;
  const top = section(doc, '02', 'Recorded measures', y);
  const gap = 25;
  const width = (WIDTH - gap) / 2;
  const rightX = LEFT + width + gap;
  const headerY = top + 2;

  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED)
    .text('KEY MEASURE', LEFT, headerY)
    .text('RESULT', LEFT + width - 95, headerY, { width: 95, align: 'right' })
    .text('QUEUE STATUS', rightX, headerY)
    .text('COUNT', rightX + 139, headerY, { width: 46, align: 'right' })
    .text('SHARE', rightX + 190, headerY, { width: 44, align: 'right' });
  line(doc, LEFT, headerY + 17, LEFT + width);
  line(doc, rightX, headerY + 17, RIGHT);

  const measures = [
    ['Queue entries', total],
    ['Completed visits', completed],
    ['Average wait', minutes(report.summary.averageWaitMinutes)],
    ['Average consultation', minutes(report.summary.averageConsultationMinutes)],
    ['Median wait', minutes(report.summary.medianWaitMinutes)],
    ['Longest wait', minutes(report.summary.longestWaitMinutes)],
  ];
  const statuses = [
    ['Completed', completed],
    ['Cancelled', cancelled],
    ['Other statuses', other],
  ];
  const firstRowY = headerY + 23;
  measures.forEach(([label, value], index) => {
    const rowY = firstRowY + index * 24;
    doc.font('Helvetica').fontSize(9).fillColor(INK).text(label, LEFT, rowY, { width: width - 94 });
    doc.font('Helvetica-Bold').text(String(value), LEFT + width - 95, rowY, { width: 95, align: 'right' });
    line(doc, LEFT, rowY + 17, LEFT + width);
  });
  statuses.forEach(([label, value], index) => {
    const rowY = firstRowY + index * 24;
    doc.font('Helvetica').fontSize(9).fillColor(INK).text(label, rightX, rowY, { width: 137 });
    doc.font('Helvetica-Bold').text(String(value), rightX + 139, rowY, { width: 46, align: 'right' });
    doc.font('Helvetica').text(rate(value), rightX + 190, rowY, { width: 44, align: 'right' });
    line(doc, rightX, rowY + 17, RIGHT);
  });
  return firstRowY + measures.length * 24 + 7;
}

function serviceHeader(doc, y) {
  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED)
    .text('SERVICE', LEFT + 3, y)
    .text('ENTRIES', LEFT + 295, y, { width: 57, align: 'right' })
    .text('COMPLETED', LEFT + 363, y, { width: 74, align: 'right' })
    .text('RATE', LEFT + 450, y, { width: 46, align: 'right' });
  line(doc, LEFT, y + 17, RIGHT, ACCENT, 1);
  return y + 24;
}

function serviceTable(doc, report, y) {
  y = section(doc, '03', 'Service activity', y);
  y = serviceHeader(doc, y + 2);
  if (!report.services.length) {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      .text('No clinic services are available for this report.', LEFT + 3, y + 8);
    return y + 38;
  }
  report.services.forEach((service, index) => {
    const name = String(service.serviceName || 'Unnamed service');
    const nameHeight = doc.font('Helvetica').fontSize(9).heightOfString(name, { width: 285 });
    const rowHeight = Math.max(27, Math.ceil(nameHeight) + 12);
    if (y + rowHeight > CONTENT_BOTTOM) {
      doc.addPage();
      continuationHeader(doc, report);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(ACCENT)
        .text('03  /  SERVICE ACTIVITY (CONTINUED)', LEFT, 102, { characterSpacing: 0.8 });
      y = serviceHeader(doc, 134);
    }
    doc.font('Helvetica').fontSize(9).fillColor(INK)
      .text(name, LEFT + 3, y + 5, { width: 285 });
    const entries = count(service.patientCount);
    const completed = count(service.completed);
    doc.text(String(entries), LEFT + 295, y + 5, { width: 57, align: 'right' });
    doc.text(String(completed), LEFT + 363, y + 5, { width: 74, align: 'right' });
    doc.text(`${entries ? Math.round(completed / entries * 100) : 0}%`,
      LEFT + 450, y + 5, { width: 46, align: 'right' });
    line(doc, LEFT, y + rowHeight, RIGHT);
    y += rowHeight;
  });
  return y;
}

function predictionAccuracy(doc, report, y) {
  const prediction = report.predictionPerformance || {};
  if (y + 250 > CONTENT_BOTTOM) {
    doc.addPage();
    continuationHeader(doc, report);
    y = 103;
  } else y += 22;
  y = section(doc, '04', 'Local prediction check', y);
  const measured = count(prediction.modelVisits);
  const within = count(prediction.withinFiveMinutes);
  const items = [
    ['ML visits measured', measured],
    ['Average absolute error', measured ? minutes(prediction.meanAbsoluteErrorMinutes) : 'Not available'],
    ['Within 5 minutes', measured ? `${within} of ${measured}` : 'Not available'],
    ['Measured fallback estimates excluded', count(prediction.fallbackVisits)],
  ];
  items.forEach(([label, value]) => {
    doc.font('Helvetica').fontSize(9).fillColor(INK).text(label, LEFT + 3, y, { width: 335 });
    doc.font('Helvetica-Bold').text(String(value), LEFT + 337, y, { width: 156, align: 'right' });
    line(doc, LEFT, y + 17, RIGHT);
    y += 23;
  });
  y += 11;
  const services = prediction.services || [];
  if (services.length) {
    const heading = () => {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED)
        .text('SERVICE', LEFT + 3, y, { width: 255 })
        .text('VISITS', LEFT + 264, y, { width: 58, align: 'right' })
        .text('AVG ERROR', LEFT + 325, y, { width: 85, align: 'right' })
        .text('WITHIN 5 MIN', LEFT + 413, y, { width: 80, align: 'right' });
      line(doc, LEFT, y + 17, RIGHT, ACCENT, 1);
      y += 24;
    };
    heading();
    services.forEach(service => {
      const name = String(service.serviceName || 'Unnamed service');
      const nameHeight = doc.font('Helvetica').fontSize(8.5).heightOfString(name, { width: 255 });
      const rowHeight = Math.max(28, Math.ceil(nameHeight) + 11);
      if (y + rowHeight > CONTENT_BOTTOM) {
        doc.addPage();
        continuationHeader(doc, report);
        y = 104;
        heading();
      }
      doc.font('Helvetica').fontSize(8.5).fillColor(INK)
        .text(name, LEFT + 3, y + 4, { width: 255 })
        .text(String(count(service.measuredVisits)), LEFT + 264, y + 4, { width: 58, align: 'right' })
        .text(minutes(service.meanAbsoluteErrorMinutes), LEFT + 325, y + 4, { width: 85, align: 'right' })
        .text(`${count(service.withinFiveMinutes)} / ${count(service.measuredVisits)}`, LEFT + 413, y + 4, { width: 80, align: 'right' });
      line(doc, LEFT, y + rowHeight - 3, RIGHT);
      y += rowHeight;
    });
  }
  return y;
}

function visitReview(doc, report, y) {
  if (!report.visits) return y;
  if(y+170>CONTENT_BOTTOM){doc.addPage(); continuationHeader(doc, report); y=103;}else y+=24;
  y=section(doc,'05','Visit review',y);
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text('Latest '+report.visits.length+' of '+report.detailTotal+' visits. Automatically excluded visits remain visible for transparency. No patient names or identification numbers are included.',LEFT,y,{width:WIDTH});y+=36;
  function heading(){doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('TICKET / STATUS',LEFT,y,{width:190}).text('WAIT / CONSULT',LEFT+196,y,{width:115}).text('PRED / ERROR',LEFT+314,y,{width:90}).text('REVIEW',LEFT+408,y,{width:90});line(doc,LEFT,y+17,RIGHT);y+=24;}
  heading();
  for(const v of report.visits){
    const label='Q'+v.serviceId+'-'+String(v.queueNumber).padStart(3,'0')+' / '+v.status.replaceAll('_',' ')+' / '+(v.included?'included':'excluded');
    const review=v.flags.join(', ')||'No flags';
    const height=Math.max(43,doc.font('Helvetica').fontSize(8).heightOfString(review,{width:90})+12,doc.heightOfString(label+'\n'+v.serviceName,{width:190})+12);
    if(y+height>CONTENT_BOTTOM){doc.addPage();continuationHeader(doc,report);y=103;heading();}
    doc.font('Helvetica').fontSize(8).fillColor(INK).text(label+'\n'+v.serviceName,LEFT,y,{width:190});
    doc.text((v.waitMinutes==null&&v.elapsedWaitMinutes!=null?'Open '+minutes(v.elapsedWaitMinutes):minutes(v.waitMinutes))+' / '+(v.consultationMinutes==null&&v.elapsedConsultationMinutes!=null?'Open '+minutes(v.elapsedConsultationMinutes):minutes(v.consultationMinutes)),LEFT+196,y,{width:115});
    doc.text(minutes(v.predictedMinutes)+' / '+minutes(v.errorMinutes),LEFT+314,y,{width:90});
    doc.text(review,LEFT+408,y,{width:90});line(doc,LEFT,y+height-6,RIGHT);y+=height;
  }
  return y;
}

function definitions(doc, report, y) {
  const scope = report.quality ? `Automatic filtering. Included ${report.quality.includedVisits} of ${report.quality.totalVisits} visits. Excluded by scope: ${report.quality.excludedByScope}; excluded unusual: ${report.quality.excludedUnusual}. Review thresholds: wait ${report.quality.waitReviewMinutes} min, consultation ${report.quality.consultationReviewMinutes} min. Durations are never capped. ` : '';
  const notes = scope + 'Counts cover tickets dated in this period; statuses reflect export time. Other includes waiting, called, or in-progress entries. Average wait is joining to consultation start; average consultation is start to completion. ML accuracy compares the saved joining estimate with actual join-to-consultation wait. Only visits with both values are measured; fallback estimates are excluded. These local measurements are separate from the original dataset evaluation. All visit types are evaluated by the same automatic duration checks; these checks do not establish real-clinic accuracy.';
  doc.font('Helvetica').fontSize(8.5);
  const height = doc.heightOfString(notes, { width: WIDTH, lineGap: 2 });
  if (y + 55 + height > CONTENT_BOTTOM) {
    doc.addPage();
    continuationHeader(doc, report);
    y = 103;
  } else y += 23;
  y = section(doc, '06', 'Scope and definitions', y);
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
    .text(notes, LEFT, y, { width: WIDTH, lineGap: 2 });
}

function footers(doc) {
  const { start, count: pages } = doc.bufferedPageRange();
  for (let index = start; index < start + pages; index++) {
    doc.switchToPage(index);
    line(doc, LEFT, 771, RIGHT);
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text('MediQ  |  Internal operational report', LEFT, 782, { width: 360 });
    doc.text(`Page ${index - start + 1} of ${pages}`, RIGHT - 100, 782, { width: 100, align: 'right' });
  }
}

function generateStaffReportPdf(report, generatedAt = new Date()) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    try {
      doc.info.Title = 'MediQ queue activity report';
      doc.info.Author = 'MediQ';
      doc.info.CreationDate = generatedAt;
      firstPageHeader(doc, report, generatedAt);
      let y = executiveSummary(doc, report);
      y = results(doc, report, y);
      y = serviceTable(doc, report, y);
      y = predictionAccuracy(doc, report, y);
      y = visitReview(doc, report, y);
      definitions(doc, report, y);
      footers(doc);
      doc.end();
    } catch (error) { reject(error); }
  });
}

module.exports = { generateStaffReportPdf };
