fetch('/api/settings').then(response => response.json()).then(data => {
  document.querySelectorAll('.brand small').forEach(item => { item.textContent = data.settings.clinicName; });
}).catch(() => {});
const statusLabels = { not_present: 'Not present', waiting: 'Waiting', called: 'Called', in_progress: 'In consultation', cancelled: 'Cancelled' };
const actionLabels = { not_present: 'Not present', called: 'Call patient', in_progress: 'Start consultation', completed: 'Complete', complete_and_call_next: 'Complete & call next', cancelled: 'Cancel queue' };
const staffPage = document.body.dataset.staffPage;
if (staffPage === 'overview' && window.location.hash === '#profile') window.location.replace('/staff-profile.html');
const staffAlerts = staffPage === 'queue' ? window.createQueueAlerts('staff', document.querySelector('#queue-alert-controls')) : null;
let queueSnapshot = null;
let previousQueueEntries = null;
function visibleQueueEntry(entry) {
  return window.matchesQueueFilter ? window.matchesQueueFilter(entry, document.querySelector('#queue-search')?.value, document.querySelector('#queue-filter')?.value) : matchesQueueFilter(entry, document.querySelector('#queue-search')?.value, document.querySelector('#queue-filter')?.value);
}
function renderQueueSnapshot() {
  if (!queueSnapshot) return;
  document.querySelector('#service-queues').replaceChildren(...queueSnapshot.services.map(service => servicePanel(service, queueSnapshot.entries.filter(entry => Number(entry.serviceId) === Number(service.id)))));
  const count = queueSnapshot.entries.filter(visibleQueueEntry).length;
  document.querySelector('#queue-filter-count').textContent = count + ' matching entries';
}
if (staffPage === 'queue') {
  document.querySelector('#queue-search').addEventListener('input', renderQueueSnapshot);
  document.querySelector('#queue-filter').addEventListener('change', renderQueueSnapshot);
  document.querySelector('#clear-queue-filters').addEventListener('click', () => { document.querySelector('#queue-search').value = ''; document.querySelector('#queue-filter').value = ''; renderQueueSnapshot(); });
}
let queueLoadVersion = 0;
let queueMutationPending = false;
let lastReminderSignature = null;
const staffQueueClock = new Intl.DateTimeFormat('en-MY', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' });

function formatClock(time) {
  const [hour, minute] = String(time).slice(0, 5).split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function formatTimeRange(start) {
  const [hour, minute] = String(start).slice(0, 5).split(':').map(Number);
  const endMinutes = hour * 60 + minute + 30;
  const end = `${String(Math.floor(endMinutes / 60) % 24).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
  return `${formatClock(start)} – ${formatClock(end)}`;
}

async function staffApi(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  if (response.status === 401 || response.status === 403) {
    window.location.replace('/staff-login.html');
    throw new Error('Staff sign-in required.');
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw new Error(response.status === 413 ? 'The selected picture is too large.' : 'The server returned an invalid response. Restart the server and try again.');
  const data = await response.json();
  if (response.status === 428 && data.passwordChangeRequired) window.location.replace('/staff-profile.html');
  if (!response.ok) throw new Error(data.error || 'The staff request could not be completed.');
  return data;
}

function showAlert(message, type = 'success', retryAction = null) {
  const alert = document.querySelector('#staff-alert');
  alert.textContent = message;
  alert.className = `staff-alert ${type}`;
  alert.setAttribute('role', type === 'error' ? 'alert' : 'status');
  alert.hidden = false;
  if (retryAction) {
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Try again';
    retry.addEventListener('click', retryAction); alert.append(' ', retry);
  }
}

function summaryCard(label, value, note, tone = '') {
  const card = document.createElement('article');
  card.className = `summary-card ${tone}`;
  card.innerHTML = '<span></span><strong></strong><small></small>';
  card.querySelector('span').textContent = label;
  card.querySelector('strong').textContent = value;
  card.querySelector('small').textContent = note;
  return card;
}

function renderSummary(summary) {
  const container = document.querySelector('#staff-summary');
  container.replaceChildren(
    summaryCard('Waiting', summary.waiting, `${summary.notPresent || 0} not present · awaiting recall`, 'blue'),
    summaryCard('Active care', summary.called + summary.inProgress, `${summary.called} called · ${summary.inProgress} consulting`, 'amber'),
    summaryCard('Completed', summary.completed, 'Consultations today', 'green'),
    summaryCard('Pending appointments', summary.pendingAppointments, 'Awaiting staff decision', 'violet'),
    summaryCard('Average duration', summary.averageDuration == null ? '—' : `${summary.averageDuration} min`, summary.averageDuration == null ? 'Available after completed visits' : 'From today’s completed visits'),
  );
}

function actionsFor(status, hasWaiting) {
  if (status === 'waiting') return ['called', 'cancelled'];
  if (status === 'called') return ['in_progress', 'not_present', 'cancelled'];
  if (status === 'not_present') return ['called', 'cancelled'];
  if (status === 'in_progress') return hasWaiting ? ['complete_and_call_next', 'completed'] : ['completed'];

  return [];
}

function confirmAction(title, message) {
  const dialog = document.querySelector('#staff-confirmation');
  document.querySelector('#confirmation-title').textContent = title;
  document.querySelector('#confirmation-message').textContent = message;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
}

function estimateReached(entry) {
  if (entry.status !== 'waiting' || Number(entry.peopleAhead) !== 0 || entry.estimatedMinutes == null) return false;
  const minutes = Number(entry.estimatedMinutes);
  const elapsedSeconds = entry.elapsedQueueSeconds == null
    ? (Date.now() - new Date(entry.joinedAt).getTime()) / 1000
    : Number(entry.elapsedQueueSeconds);
  return Number.isFinite(minutes) && minutes >= 0 && Number.isFinite(elapsedSeconds)
    && elapsedSeconds >= minutes * 60;
}

function staffWaitDisplay(entry, now = new Date()) {
  if (entry.status !== 'waiting') return null;
  const initialMinutes = Number(entry.estimatedMinutes);
  const joinedAt = new Date(entry.joinedAt);
  const currentTime = new Date(now);
  if (Number(entry.peopleAhead) === 0) {
    if (entry.estimatedMinutes == null || !Number.isFinite(initialMinutes) || !Number.isFinite(joinedAt.getTime())) {
      return { time: 'Waiting for staff call', remaining: 'No time estimate available' };
    }
    const expectedAt = new Date(joinedAt.getTime() + initialMinutes * 60000);
    if (expectedAt <= currentTime) return { time: `Estimate was around ${staffQueueClock.format(expectedAt)}`, remaining: 'Waiting for staff call' };
    return { time: `Around ${staffQueueClock.format(expectedAt)}`, remaining: `~${Math.ceil((expectedAt - currentTime) / 60000)} min remaining` };
  }
  const remainingMinutes = Number(entry.remainingWaitMinutes);
  if (entry.remainingWaitMinutes == null || !Number.isFinite(remainingMinutes) || remainingMinutes < 0) {
    return { time: 'Estimated time unavailable', remaining: `${entry.peopleAhead} ahead` };
  }
  const expectedAt = new Date(currentTime.getTime() + remainingMinutes * 60000);
  return { time: `Around ${staffQueueClock.format(expectedAt)}`, remaining: `~${Math.ceil(remainingMinutes)} min remaining` };
}

function renderQueueReminders(entries) {
  const due = entries.filter(estimateReached);
  const signature = due.map(entry => entry.id).sort((left, right) => left - right).join(',');
  if (signature === lastReminderSignature) return;
  lastReminderSignature = signature;
  const banner = document.querySelector('#queue-reminder-banner');
  banner.hidden = !due.length;
  if (!due.length) return;
  banner.querySelector('strong').textContent = due.length === 1
    ? `${formatQueueTicket(due[0].serviceId, due[0].queueNumber)} has reached its estimated time`
    : `${due.length} waiting patients have reached their estimated times`;
  banner.querySelector('span').textContent = 'Review the highlighted queue entries. Call patients when the clinician is ready.';
}

function queueRow(entry, isFirstWaiting, hasWaiting, serviceName, canCall) {
  const row = document.createElement('article');
  const due = estimateReached(entry);
  row.className = `staff-queue-row${isFirstWaiting ? ' is-next' : ''}${due ? ' is-estimate-due' : ''}`;
  row.innerHTML = '<span class="staff-queue-number"></span><div class="patient-details"><strong></strong><span></span></div><div class="staff-queue-state"><span class="staff-status"></span><small class="staff-wait"></small><small class="staff-remaining"></small><small class="staff-ml-note"></small></div><div class="queue-actions"></div>';
  row.querySelector('.staff-queue-number').textContent = formatQueueTicket(entry.serviceId, entry.queueNumber);
  row.querySelector('.patient-details strong').textContent = entry.patientName;
  row.querySelector('.patient-details span').textContent = `Joined ${new Intl.DateTimeFormat('en-MY', { timeStyle: 'short' }).format(new Date(entry.joinedAt))}`;
  const status = row.querySelector('.staff-status');
  status.textContent = statusLabels[entry.status];
  status.dataset.status = entry.status;
  const wait = row.querySelector('.staff-wait');
  const waitDisplay = staffWaitDisplay(entry);
  if (waitDisplay) {
    wait.textContent = waitDisplay.time;
    row.querySelector('.staff-remaining').textContent = waitDisplay.remaining;
  }
  const mlNote = row.querySelector('.staff-ml-note');
  if (entry.status === 'waiting' && entry.estimatedMinutes != null) {
    const isMlEstimate = entry.predictionModel === 'operational-f4-hist-gradient-boosting-v1';
    mlNote.textContent = `At joining · ${isMlEstimate ? 'ML' : 'Average'} ~${Math.round(entry.estimatedMinutes)} min`;
    mlNote.title = isMlEstimate ? 'Initial F4 model estimate at joining; not validated for this clinic.' : 'Initial average-duration estimate at joining.';
  }
  const arrival = document.createElement('small');
  arrival.className = 'arrival-badge';
  arrival.textContent = entry.arrivedAt ? 'At clinic' : entry.joinLocation === 'remote' ? 'Remote · not arrived' : 'Arrival unconfirmed';
  row.querySelector('.patient-details').append(arrival);
  const identityNote = document.createElement('small');
  identityNote.textContent = [entry.patientAge == null ? null : `Age ${entry.patientAge}`, entry.maskedIdentification ? `${entry.identificationType === 'mykad' ? 'MyKad' : 'Passport'} ${entry.maskedIdentification}` : null].filter(Boolean).join(' · ');
  if (identityNote.textContent) row.querySelector('.patient-details').append(identityNote);
  if (!entry.arrivedAt && ['waiting', 'called', 'not_present'].includes(entry.status)) {
    const checkIn = document.createElement('button'); checkIn.type = 'button';
    checkIn.className = 'staff-secondary-button'; checkIn.textContent = 'Confirm arrival';
    checkIn.addEventListener('click', async () => {
      if (queueMutationPending) return;
      const confirmed = await window.mediqDialog({ title: 'Confirm patient arrival?', message: entry.patientName + ' is physically at the clinic.', confirmLabel: 'Confirm arrival' });
      if (!confirmed || queueMutationPending) return;
      queueMutationPending = true; checkIn.disabled = true; checkIn.textContent = 'Checking in…';
      try { const result = await staffApi('/api/staff/queues/' + entry.id + '/arrive', { method: 'POST' }); showAlert(result.message); await loadStaffDashboard(true); }
      catch (error) { showAlert(error.message, 'error'); }
      finally { queueMutationPending = false; checkIn.disabled = false; checkIn.textContent = 'Confirm arrival'; }
    });
    row.querySelector('.queue-actions').append(checkIn);
  }
  if (entry.cancellationReason) row.querySelector('.patient-details span').textContent += ` · Reason: ${entry.cancellationReason}`;
  const actions = row.querySelector('.queue-actions');
  actionsFor(entry.status, hasWaiting).filter((nextStatus) => nextStatus !== 'called' || entry.status !== 'waiting' || isFirstWaiting).forEach((nextStatus) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = nextStatus === 'cancelled' ? 'staff-text-button' : nextStatus === 'completed' ? 'staff-secondary-button' : 'staff-primary-button';
    button.dataset.queueAction = nextStatus;
    button.textContent = entry.status === 'not_present' && nextStatus === 'called' ? 'Recall patient' : actionLabels[nextStatus];
    if (nextStatus === 'called' && (!canCall || (entry.status === 'not_present' && !entry.arrivedAt))) {
      button.disabled = true;
      button.title = entry.status === 'not_present' && !entry.arrivedAt ? 'Confirm arrival before recalling this patient.' : 'Finish the current patient before calling the next one.';
    }
    button.addEventListener('click', async () => {
      if (queueMutationPending) return;
      const reason = nextStatus === 'cancelled' ? await window.mediqDialog({ title: 'Cancel queue entry?', message: `${entry.patientName} (${row.querySelector('.staff-queue-number').textContent}) will be removed from the queue and notified.`, confirmLabel: 'Cancel entry', reason: true, danger: true }) : '';
      if (nextStatus === 'cancelled' && reason === null) return;
      const combined = nextStatus === 'complete_and_call_next';
      const confirmed = nextStatus === 'cancelled' || await confirmAction(`${actionLabels[nextStatus]}?`, combined
        ? `${entry.patientName} will be marked completed, and the earliest waiting patient in ${serviceName} will be called. Both patients will be notified.`
        : nextStatus === 'not_present' ? 'This patient will be marked not present and notified. Their ticket remains active, but the waiting queue can continue. Confirm arrival before recalling them.' : `${entry.patientName} (${row.querySelector('.staff-queue-number').textContent}) will be moved from ${statusLabels[entry.status].toLowerCase()} to ${nextStatus === 'in_progress' ? 'in consultation' : nextStatus}. The patient will be notified.`);
      if (!confirmed || queueMutationPending) return;
      const controls = [...document.querySelectorAll('#service-queues button')].map(control => [control, control.disabled]);
      controls.forEach(([control]) => { control.disabled = true; });
      button.textContent = nextStatus === 'called' ? 'Calling…' : nextStatus === 'cancelled' ? 'Cancelling…' : nextStatus === 'in_progress' ? 'Starting…' : 'Completing…';
      button.setAttribute('aria-busy', 'true');
      try {
        queueMutationPending = true;
        const result = combined
          ? await staffApi(`/api/staff/queues/${entry.id}/complete-and-call-next`, { method: 'POST' })
          : await staffApi(`/api/staff/queues/${entry.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: nextStatus, reason }) });
        showAlert(result.message);
        await loadStaffDashboard(true);
      } catch (error) { showAlert(error.message, 'error'); }
      finally { queueMutationPending = false; controls.forEach(([control, disabled]) => { control.disabled = disabled; }); button.textContent = actionLabels[nextStatus]; button.removeAttribute('aria-busy'); }
    });
    actions.append(button);
  });
  const primary = [...actions.querySelectorAll('[data-queue-action]')].find(button => !['cancelled', 'not_present'].includes(button.dataset.queueAction));
  if (primary) { primary.className = 'staff-primary-button'; primary.classList.add('queue-main-action'); }
  const secondary = [...actions.querySelectorAll('button')].filter(button => button !== primary);
  if (secondary.length) {
    const more = document.createElement('details'); more.className = 'queue-more';
    const summary = document.createElement('summary'); summary.textContent = 'More actions';
    const menu = document.createElement('div'); menu.className = 'queue-more-actions';
    secondary.forEach(button => { menu.append(button); });
    more.append(summary, menu); actions.append(more);
  }
  return row;
}

function openServiceNotice(service) {
  if (queueMutationPending || document.querySelector('dialog[open]')) return;
  const dialog = document.createElement('dialog'); dialog.className = 'staff-dialog service-notice-dialog portal-form-dialog'; dialog.setAttribute('aria-labelledby', 'notice-editor-title');
  dialog.innerHTML = '<form class="dialog-form-layout"><header class="dialog-form-header"><h2 id="notice-editor-title">Service delay notice</h2><p class="notice-service-name"></p><p>This update informs patients. Use Close queue separately to stop new joins.</p></header><div class="dialog-form-body"><label>Quick message<select><option value="">Choose a quick message</option><option value="Doctor delayed. Please allow extra waiting time.">Doctor delayed</option><option value="Service temporarily paused. Please wait for a further update.">Service temporarily paused</option><option value="Consultations are taking longer than usual.">Longer consultations</option></select></label><label>Message for patients<textarea rows="3" maxlength="300"></textarea></label><p class="notice-error" role="alert"></p></div><footer class="dialog-form-footer"><button type="button" class="staff-secondary-button notice-back">Go back</button><button type="button" class="staff-secondary-button notice-clear">Clear notice</button><button type="submit" class="staff-primary-button">Publish notice</button></footer></form>';
  dialog.querySelector('.notice-service-name').textContent = service.name;
  const input = dialog.querySelector('textarea'); input.value = service.delayNotice || '';
  dialog.querySelector('select').addEventListener('change', event => { if (event.target.value) input.value = event.target.value; });
  dialog.querySelector('.notice-back').addEventListener('click', () => dialog.close());
  let saving = false;
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  async function save(notice) {
    if (saving || queueMutationPending) return;
    const error = dialog.querySelector('.notice-error');
    if (notice.length && notice.length < 3) { error.textContent = 'Use at least 3 characters, or clear the notice.'; return; }
    saving = true; queueMutationPending = true;
    dialog.querySelectorAll('button').forEach(button => { button.disabled = true; });
    error.textContent = 'Saving…';
    try {
      const result = await staffApi('/api/staff/services/' + service.id + '/notice', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notice }) });
      dialog.close(); showAlert(result.message); await loadStaffDashboard(true);
    } catch (failure) { error.textContent = failure.message; }
    finally { saving = false; queueMutationPending = false; dialog.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
  }
  dialog.querySelector('form').addEventListener('submit', event => { event.preventDefault(); save(input.value.trim()); });
  dialog.querySelector('.notice-clear').addEventListener('click', () => save(''));
  document.body.append(dialog); dialog.showModal(); input.focus();
}

function servicePanel(service, entries) {
  const panel = document.createElement('section');
  panel.className = 'service-queue-panel';
  panel.innerHTML = '<header><div><span class="service-state"></span><h3></h3><p></p></div><button class="queue-toggle" type="button"></button></header><div class="next-patient-cue" hidden><strong></strong><span></span></div><div class="service-queue-list"></div><details class="cancelled-queue-list" hidden><summary></summary><div></div></details>';
  panel.querySelector('h3').textContent = service.name;
  const activeEntries = entries.filter((entry) => entry.status !== 'cancelled');
  const cancelledEntries = entries.filter((entry) => entry.status === 'cancelled');
  panel.querySelector('p').textContent = `${activeEntries.length} active patient${activeEntries.length === 1 ? '' : 's'}${service.queueCapacity ? ` · Capacity ${activeEntries.length}/${service.queueCapacity}` : ''}`;
  const state = panel.querySelector('.service-state');
  state.textContent = service.isQueueOpen ? 'Queue open' : 'Queue closed';
  state.classList.toggle('closed', !service.isQueueOpen);
  const toggle = panel.querySelector('.queue-toggle');
  toggle.textContent = service.isQueueOpen ? 'Close queue' : 'Open queue';
  toggle.addEventListener('click', async () => {
    if (queueMutationPending) return;
    const nextState = !Boolean(service.isQueueOpen);
    const confirmed = await confirmAction(`${nextState ? 'Open' : 'Close'} ${service.name}?`, nextState ? 'Patients will be able to join this service queue.' : 'New patients will be prevented from joining. Existing patients remain in the queue.');
    if (!confirmed || queueMutationPending) return;
    toggle.disabled = true; toggle.textContent = nextState ? 'Opening…' : 'Closing…';
    try {
      queueMutationPending = true;
      const result = await staffApi(`/api/staff/services/${service.id}/queue`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isOpen: nextState }) });
      showAlert(result.message);
      await loadStaffDashboard(true);
    } catch (error) { showAlert(error.message, 'error'); }
    finally { queueMutationPending = false; toggle.disabled = false; toggle.textContent = service.isQueueOpen ? 'Close queue' : 'Open queue'; }
  });
  const notice = document.createElement('p'); notice.className = 'service-delay-notice'; notice.hidden = !service.delayNotice; notice.textContent = service.delayNotice ? 'Service update: ' + service.delayNotice : ''; panel.querySelector('header').after(notice);
  const editNotice = document.createElement('button'); editNotice.type = 'button'; editNotice.className = 'staff-secondary-button'; editNotice.textContent = service.delayNotice ? 'Edit delay notice' : 'Add delay notice';
  editNotice.addEventListener('click', () => openServiceNotice(service)); panel.querySelector('header').append(editNotice);
  const list = panel.querySelector('.service-queue-list');
  const firstWaiting = activeEntries.find((entry) => entry.status === 'waiting');
  const firstWaitingId = firstWaiting?.id;
  const busy = activeEntries.some((entry) => entry.status === 'called' || entry.status === 'in_progress');
  const cue = panel.querySelector('.next-patient-cue');
  if (firstWaiting) {
    cue.hidden = false;
    cue.querySelector('strong').textContent = `${busy ? 'Next waiting' : 'Ready to call'} · ${formatQueueTicket(service.id, firstWaiting.queueNumber)}`;
    cue.querySelector('span').textContent = busy ? 'Call when the current patient is finished and the clinician is ready.' : 'The clinician can call this patient when ready.';
    cue.classList.toggle('ready', !busy);
    if (estimateReached(firstWaiting)) {
      cue.classList.add('estimate-due');
      cue.querySelector('strong').textContent = `Estimate reached · ${formatQueueTicket(service.id, firstWaiting.queueNumber)}`;
      cue.querySelector('span').textContent = busy
        ? 'Review this patient, then call when the current consultation is finished.'
        : 'Review this patient and call when the clinician is ready.';
    }
  }
  const matchingEntries = activeEntries.filter(visibleQueueEntry);
  if (matchingEntries.length) list.replaceChildren(...matchingEntries.map((entry) => queueRow(entry, entry.id === firstWaitingId, Boolean(firstWaitingId), service.name, !busy)));
  else { list.textContent = activeEntries.length ? 'No patients match these filters.' : 'No active patients in this service.'; list.classList.add('staff-empty'); }
  const cancelledList = panel.querySelector('.cancelled-queue-list');
  if (cancelledEntries.filter(visibleQueueEntry).length) {
    cancelledList.hidden = false;
    cancelledList.querySelector('summary').textContent = `${cancelledEntries.length} cancelled today`;
    cancelledList.querySelector('div').replaceChildren(...cancelledEntries.filter(visibleQueueEntry).map((entry) => queueRow(entry, false, false, service.name, false)));
  }
  return panel;
}

async function loadStaffDashboard(afterMutation = false) {
  const loadVersion = ++queueLoadVersion;
  try {
    const [overview, queueData] = await Promise.all([
      staffApi('/api/staff/overview'),
      staffPage === 'queue' ? staffApi('/api/staff/queues') : Promise.resolve(null),
    ]);
    if (loadVersion !== queueLoadVersion || document.querySelector('dialog[open]') || (queueMutationPending && !afterMutation)) return;
    document.querySelector('#staff-name').textContent = overview.user.fullName;
    if (staffPage === 'overview') renderSummary(overview.summary);
    if (staffPage === 'queue') {
      queueSnapshot = queueData; renderQueueSnapshot();
      if (previousQueueEntries) {
        const attention = queueData.entries.filter(entry => {
          const previous = previousQueueEntries.get(entry.id);
          return (!previous && entry.status === 'waiting') || (entry.arrivedAt && !previous?.arrivedAt) || (estimateReached(entry) && !estimateReached(previous || {}));
        });
        if (attention.length) staffAlerts.notify(attention.map(entry => entry.id + ':' + entry.status + ':' + (entry.arrivedAt || '') + ':' + estimateReached(entry)).sort().join('|'), 'MediQ queue update', attention.length + ' queue entries need review. Open Live queue.');
      }
      previousQueueEntries = new Map(queueData.entries.map(entry => [entry.id, entry]));
      renderQueueReminders(queueData.entries);
    }
    const updated = document.querySelector('#last-updated');
    if (updated) updated.textContent = `Updated ${new Intl.DateTimeFormat('en-MY', { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date())}`;
  } catch (error) {
    if (loadVersion === queueLoadVersion && error.message !== 'Staff sign-in required.') showAlert('Queue information could not refresh. Displayed information may be out of date.', 'error', () => loadStaffDashboard());
  }
}

document.querySelector('#refresh-button').addEventListener('click', () => {
  if (staffPage === 'profile') { loadStaffProfile(); return; }
  loadStaffDashboard();
  if (staffPage === 'appointments') loadStaffAppointments();
});
document.querySelector('#logout-button').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  window.location.replace('/');
});

if (staffPage !== 'profile') loadStaffDashboard();
if (staffPage === 'queue') {
  window.setInterval(() => {
    if ((!document.hidden || staffAlerts?.backgroundEnabled) && !queueMutationPending && !document.querySelector('dialog[open]')) loadStaffDashboard();
  }, 20000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !queueMutationPending && !document.querySelector('dialog[open]')) loadStaffDashboard();
  });
}


let appointmentLoadVersion = 0;
let appointmentDecision = null;
let slotLoadVersion = 0;
let appointmentPage = 1;
const appointmentLabels = { pending: 'Pending', approved: 'Approved', reschedule_proposed: 'Awaiting patient response', rejected: 'Rejected', cancelled: 'Cancelled', completed: 'Completed' };

async function loadStaffAppointments() {
  const version = ++appointmentLoadVersion;
  const container = document.querySelector('#staff-appointments');
  container.textContent = 'Loading appointments…';
  try {
    const filters = new FormData(document.querySelector('#appointment-filters'));
    const data = await staffApi('/api/staff/appointments?' + new URLSearchParams({ status: filters.get('status'), search: filters.get('search'), from: filters.get('from'), to: filters.get('to'), page: appointmentPage }));
    if (version !== appointmentLoadVersion) return;
    container.replaceChildren(...data.appointments.map(staffAppointmentCard));
    if (!data.appointments.length) container.textContent = 'No appointments match this filter.';
    document.querySelector('#appointment-page').textContent = `Page ${data.page}`;
    document.querySelector('#appointment-previous').disabled = data.page <= 1;
    document.querySelector('#appointment-next').disabled = !data.hasMore;
  } catch (error) { if (version === appointmentLoadVersion) container.textContent = error.message; }
}

function staffAppointmentCard(item) {
  const card = document.createElement('article');
  card.className = 'staff-appointment';
  card.innerHTML = '<h3></h3><span class="staff-status"></span><p class="appointment-when"></p><p class="appointment-notes"></p><p class="appointment-response"></p><div class="queue-actions"></div>';
  card.querySelector('h3').textContent = item.patientName + ' · ' + item.serviceName;
  card.querySelector('.staff-status').textContent = appointmentLabels[item.status];
  card.querySelector('.staff-status').dataset.status = item.status;
  card.querySelector('.appointment-when').textContent = item.appointmentDate + ' · ' + formatTimeRange(item.appointmentTime) + ' (Malaysia time)';
  card.querySelector('.appointment-notes').textContent = 'Patient notes: ' + (item.notes || 'None');
  card.querySelector('.appointment-response').textContent = item.rejectionReason ? 'Clinic response: ' + item.rejectionReason : '';
  const actions = item.status === 'pending' ? ['approve', 'reject', 'reschedule'] : item.status === 'approved' ? ['complete', 'reject', 'reschedule'] : item.status === 'reschedule_proposed' ? ['reject', 'reschedule'] : [];
  const labels = { approve: 'Approve', reject: 'Reject', reschedule: 'Propose new time', complete: 'Mark completed' };
  actions.forEach(action => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'staff-secondary-button';
    button.textContent = labels[action];
    button.addEventListener('click', () => {
      appointmentDecision = { item, action };
      ++slotLoadVersion;
      document.querySelector('#staff-appointment-form').reset();
      document.querySelector('#appointment-dialog-title').textContent = labels[action];
      document.querySelector('#appointment-dialog-description').textContent = item.patientName + ' · ' + item.appointmentDate + ' · ' + formatTimeRange(item.appointmentTime);
      document.querySelector('#reschedule-fields').hidden = action !== 'reschedule';
      document.querySelector('#proposed-date').required = action === 'reschedule';
      document.querySelector('#proposed-time').required = action === 'reschedule';
      document.querySelector('#proposed-time').replaceChildren(new Option('Select a date first', ''));
      document.querySelector('#proposed-time').disabled = true;
      document.querySelector('#appointment-reason-label').hidden = !['reject', 'reschedule'].includes(action);
      document.querySelector('#appointment-reason').required = ['reject', 'reschedule'].includes(action);
      document.querySelector('#appointment-dialog-error').textContent = '';
      document.querySelector('#appointment-dialog-submit').disabled = action === 'reschedule';
      document.querySelector('#appointment-dialog').showModal();
    });
    card.querySelector('.queue-actions').append(button);
  });
  return card;
}

if (staffPage === 'appointments') {
document.querySelector('#proposed-date').addEventListener('change', async event => {
  const version = ++slotLoadVersion;
  const select = document.querySelector('#proposed-time');
  const submit = document.querySelector('#appointment-dialog-submit');
  select.disabled = true;
  submit.disabled = true;
  select.replaceChildren(new Option('Loading available times…', ''));
  try {
    const data = await staffApi('/api/staff/appointments/availability?date=' + encodeURIComponent(event.target.value));
    if (version !== slotLoadVersion) return;
    select.replaceChildren(new Option(data.slots.length ? 'Choose a time' : 'No available times', ''), ...data.slots.map(time => new Option(formatTimeRange(time), time)));
    select.disabled = !data.slots.length;
    submit.disabled = !data.slots.length;
    document.querySelector('#appointment-dialog-error').textContent = data.closureReason ? `Clinic closed: ${data.closureReason}` : '';
  } catch (error) { if (version === slotLoadVersion) document.querySelector('#appointment-dialog-error').textContent = error.message; }
});

document.querySelector('#appointment-dialog-cancel').addEventListener('click', () => document.querySelector('#appointment-dialog').close());
document.querySelector('#staff-appointment-form').addEventListener('submit', async event => {
  event.preventDefault();
  const { item, action } = appointmentDecision;
  const submit = document.querySelector('#appointment-dialog-submit');
  submit.disabled = true;
  try {
    const result = await staffApi('/api/staff/appointments/' + item.id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, reason: document.querySelector('#appointment-reason').value, appointmentDate: document.querySelector('#proposed-date').value, appointmentTime: document.querySelector('#proposed-time').value }),
    });
    document.querySelector('#appointment-dialog').close();
    showAlert(result.message);
    await Promise.all([loadStaffAppointments(), loadStaffDashboard()]);
  } catch (error) { document.querySelector('#appointment-dialog-error').textContent = error.message; }
  finally { submit.disabled = false; }
});
document.querySelector('#appointment-filters').addEventListener('submit', event => { event.preventDefault(); appointmentPage = 1; loadStaffAppointments(); });
document.querySelector('#appointment-filter').addEventListener('change', () => { appointmentPage = 1; loadStaffAppointments(); });
document.querySelector('#appointment-previous').addEventListener('click', () => { appointmentPage = Math.max(1, appointmentPage - 1); loadStaffAppointments(); });
document.querySelector('#appointment-next').addEventListener('click', () => { appointmentPage += 1; loadStaffAppointments(); });
loadStaffAppointments();
}
