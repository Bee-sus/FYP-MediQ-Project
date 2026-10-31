fetch('/api/settings').then(response => response.json()).then(data => document.querySelectorAll('.brand small').forEach(item => { item.textContent = data.settings.clinicName; })).catch(() => {});
const patientAlerts = window.createQueueAlerts('patient', document.querySelector('#queue-alert-controls'));
let activeQueue = null;
let cancellationPending = false;
let queueRefreshPending = false;
let arrivalPending = false;
const labels = { not_present: 'Missed call', waiting: 'Waiting', called: 'Please proceed', in_progress: 'In consultation' };
const malaysiaClock = new Intl.DateTimeFormat('en-MY', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' });

function formatQueueTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : malaysiaClock.format(date);
}

function renderNoQueue() {
  document.querySelector('#queue-status-content').innerHTML = `
    <div class="queue-status-empty">
      <span class="empty-icon" aria-hidden="true">Q</span>
      <h2>You do not have an active queue</h2>
      <p>Choose a clinic service to join today’s queue.</p>
      <a class="action-button primary-action" href="/join-queue.html">Join a queue</a>
    </div>
  `;
}

function renderActiveQueue(queue) {
  const content = document.querySelector('#queue-status-content');
  content.innerHTML = `
    <div class="status-hero-card">
      <div class="status-topline">
        <div class="status-number"><span>Your queue number</span><strong id="queue-number"></strong><small id="service-name"></small></div>
        <div class="status-heading">
          <span id="queue-status-badge" class="queue-status-badge"></span>
          <h2 id="queue-guidance"></h2>
          <p id="joined-time"></p><small id="queue-last-updated" class="queue-last-updated"></small>
        </div>
      </div>
      <p id="patient-service-notice" class="service-delay-notice" hidden></p>
      <div class="status-summary">
        <div class="status-metrics"><div><strong id="people-ahead"></strong><span>People ahead</span></div><div><span class="status-wait-main"><strong id="estimated-wait"></strong><em id="estimated-time-range" class="estimated-time-range" hidden></em></span><span id="wait-metric-label">Estimated wait to consultation</span></div></div>
      </div>
      <div class="queue-journey">
        <div class="queue-journey-heading"><strong>Your visit progress</strong><span id="journey-message"></span></div>
        <div id="queue-journey-track" class="queue-journey-track" role="progressbar" aria-label="Visit progress" aria-valuemin="0" aria-valuemax="3"><span id="queue-journey-fill"></span></div>
        <div class="queue-journey-labels"><span>Joined</span><span>Called</span><span>Consultation</span></div>
      </div>
    </div>
    <div class="status-actions-row">
      <div class="status-notice"><span class="notice-symbol" aria-hidden="true">i</span><div><strong id="status-notice-title"></strong><p id="status-notice-message"></p></div></div>
      <div class="arrival-status"><strong id="arrival-label"></strong><button id="arrival-button" class="action-button primary-action" type="button" hidden>I have arrived</button><span id="arrival-feedback" role="status"></span></div>
      <button id="open-cancel-dialog" class="text-danger-button" type="button">Cancel queue entry</button>
    </div>
  `;
  document.querySelector('#queue-number').textContent = formatQueueTicket(queue.serviceId, queue.queueNumber);
  document.querySelector('#service-name').textContent = queue.serviceName;
  const notice = document.querySelector('#patient-service-notice'); notice.hidden = !queue.delayNotice; notice.textContent = queue.delayNotice ? 'Service update: ' + queue.delayNotice + ' · Waiting times may change.' : '';
  if (queue.status === 'called' || queue.status === 'not_present') patientAlerts.notify(queue.id + ':' + queue.status + ':' + (queue.status === 'not_present' ? queue.missedCallAt : queue.calledAt || queue.joinedAt), queue.status === 'called' ? 'Your queue number has been called' : 'You missed your call', queue.status === 'called' ? 'Please proceed to the clinic counter.' : 'Check in and contact reception for recall.');
  document.querySelector('#queue-status-badge').textContent = labels[queue.status] || queue.status;
  document.querySelector('#queue-status-badge').dataset.status = queue.status;
  document.querySelector('#queue-guidance').textContent = queue.status === 'not_present' ? 'You missed your call.' : queue.status === 'called' ? 'You have been called. Please proceed.' : queue.status === 'in_progress' ? 'Your consultation is in progress.' : 'You are in the queue.';
  const updatedAt = new Date();
  const joinedAt = new Date(queue.joinedAt);
  const joinedTime = formatQueueTime(joinedAt);
  const updatedTime = formatQueueTime(updatedAt);
  const waitingAtFront = queue.status === 'waiting' && Number(queue.peopleAhead) === 0;
  const estimate = queueEstimatePresentation(queue, updatedAt);
  document.querySelector('#joined-time').textContent = joinedTime ? `Joined ${joinedTime}` : 'Joined today';
  document.querySelector('#queue-last-updated').textContent = `Automatically updated ${updatedTime}`;
  document.querySelector('#people-ahead').textContent = queue.peopleAhead;
  const waitValue = document.querySelector('#estimated-wait');
  const waitLabel = document.querySelector('#wait-metric-label');
  const timeRange = document.querySelector('#estimated-time-range');
  waitValue.textContent = estimate.waitValue;
  waitLabel.textContent = estimate.waitLabel;
  timeRange.hidden = !estimate.clockText;
  timeRange.textContent = estimate.clockText;
  const stage = queue.status === 'in_progress' ? 3 : queue.status === 'called' ? 2 : 1;
  const journey = document.querySelector('.queue-journey');
  journey.dataset.stage = String(stage);
  const journeyTrack = document.querySelector('#queue-journey-track');
  journeyTrack.setAttribute('aria-valuenow', String(stage));
  journeyTrack.setAttribute('aria-valuetext', stage === 3 ? 'In consultation' : stage === 2 ? 'Called' : 'Joined, waiting for call');
  document.querySelector('#queue-journey-fill').style.width = `${stage / 3 * 100}%`;
  document.querySelector('#journey-message').textContent = stage === 3 ? 'Consultation in progress'
    : stage === 2 ? 'Please proceed to the clinic counter'
      : waitingAtFront ? 'Waiting for call' : `${queue.peopleAhead} ${Number(queue.peopleAhead) === 1 ? 'person' : 'people'} ahead`;
  document.querySelector('#status-notice-title').textContent = stage === 3 ? 'Consultation underway' : stage === 2 ? 'Please proceed now' : queue.reminderMessage ? 'Queue reminder' : 'Stay ready';
  document.querySelector('#status-notice-message').textContent = stage === 3 ? 'Your queue status will update after staff complete the consultation.'
    : stage === 2 ? 'Staff have called your queue number. Please proceed to the clinic counter.'
      : queue.reminderMessage || 'Queue position and remaining-wait estimate refresh every 30 seconds. Select Refresh status to update sooner.';
  if (queue.status === 'not_present') {
    document.querySelector('#journey-message').textContent = 'Awaiting staff recall';
    document.querySelector('#status-notice-title').textContent = 'Please contact reception';
    document.querySelector('#status-notice-message').textContent = 'Your ticket remains active. Confirm you have arrived and contact reception. Staff will recall you when the service is free.';
  }
  const arrivalLabel = document.querySelector('#arrival-label');
  arrivalLabel.textContent = queue.arrivedAt ? 'At clinic · checked in' : queue.joinLocation === 'remote' ? 'Joined remotely · not arrived' : 'Arrival not confirmed';
  const arrivalButton = document.querySelector('#arrival-button');
  arrivalButton.hidden = Boolean(queue.arrivedAt) || queue.status === 'in_progress';
  arrivalButton.addEventListener('click', async () => {
    if (arrivalPending || cancellationPending) return;
    arrivalPending = true; arrivalButton.disabled = true; arrivalButton.textContent = 'Checking in…';
    const feedback = document.querySelector('#arrival-feedback'); feedback.textContent = '';
    try {
      const response = await fetch(`/api/patient/queues/${queue.id}/arrive`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Check-in could not be confirmed.');
      arrivalLabel.textContent = 'At clinic · checked in'; arrivalButton.hidden = true;
      feedback.textContent = result.message;
    } catch (error) { feedback.textContent = error.message || 'Connection lost. Try checking in again.'; }
    finally { arrivalPending = false; arrivalButton.disabled = false; arrivalButton.textContent = 'I have arrived'; }
  });
  const cancelButton = document.querySelector('#open-cancel-dialog');
  if (queue.status === 'in_progress') cancelButton.hidden = true;
  else cancelButton.addEventListener('click', () => {
    document.querySelector('#cancel-error').textContent = '';
    document.querySelector('#cancellation-reason').value = '';
    document.querySelector('#cancel-dialog').showModal();
  });
}

async function loadQueueStatus(showMessage = false) {
  if (queueRefreshPending || arrivalPending || cancellationPending || document.querySelector('dialog[open]')) return;
  queueRefreshPending = true;
  const refresh = document.querySelector('#refresh-queue');
  refresh.disabled = true; refresh.setAttribute('aria-busy', 'true');
  const alert = document.querySelector('#status-alert');
  try {
    const [accountResponse, queueResponse] = await Promise.all([fetch('/api/auth/me'), fetch('/api/patient/queues/active')]);
    if (accountResponse.status === 401 || accountResponse.status === 403) {
      window.location.replace('/patient-login.html');
      return;
    }
    const account = await accountResponse.json();
    if (!accountResponse.ok) throw new Error(account.error || 'Your account could not be verified.');
    document.querySelector('#patient-name').textContent = account.user.fullName;
    const data = await queueResponse.json();
    if (!queueResponse.ok) throw new Error(data.error);
    if (arrivalPending || cancellationPending || document.querySelector('dialog[open]')) return;
    activeQueue = data.queue;
    if (activeQueue) renderActiveQueue(activeQueue);
    else renderNoQueue();
    alert.hidden = true;
    if (showMessage || new URLSearchParams(window.location.search).has('joined')) {
      alert.textContent = activeQueue ? 'Queue status is up to date.' : 'No active queue was found.';
      alert.className = 'dashboard-alert success';
      alert.hidden = false;
      window.history.replaceState({}, '', '/queue-status.html');
    }
  } catch (error) {
    alert.textContent = 'Queue could not refresh. Displayed information may be out of date. ';
    const retry = document.createElement('button');
    retry.type = 'button'; retry.textContent = 'Try again';
    retry.addEventListener('click', () => loadQueueStatus(true));
    alert.append(retry);
    alert.className = 'dashboard-alert error';
    alert.hidden = false;
  } finally { queueRefreshPending = false; refresh.disabled = false; refresh.removeAttribute('aria-busy'); }
}

async function cancelQueue(event) {
  event.preventDefault();
  if (cancellationPending || arrivalPending) return;
  const error = document.querySelector('#cancel-error');
  const reason = document.querySelector('#cancellation-reason').value.trim();
  if (reason.length < 3 || reason.length > 300) { error.textContent = 'Enter a reason between 3 and 300 characters.'; return; }
  if (!activeQueue) { error.textContent = 'Refresh your queue status and try again.'; return; }
  cancellationPending = true;
  const form = document.querySelector('#cancel-form');
  const submit = form.querySelector('[type="submit"]');
  const back = document.querySelector('#keep-queue');
  submit.disabled = true; back.disabled = true; submit.textContent = 'Cancelling…';
  form.setAttribute('aria-busy', 'true'); error.textContent = '';
  try {
    const response = await fetch(`/api/patient/queues/${activeQueue.id}/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The queue could not be cancelled.');
    document.querySelector('#cancel-dialog').close();
    const alert = document.querySelector('#status-alert');
    alert.textContent = result.message; alert.className = 'dashboard-alert success'; alert.hidden = false;
    activeQueue = null; renderNoQueue();
  } catch (failure) {
    error.textContent = failure.message === 'Failed to fetch' ? 'Connection lost. Your cancellation was not confirmed. Check your connection and try again.' : failure.message;
  } finally {
    cancellationPending = false; submit.disabled = false; back.disabled = false;
    submit.textContent = 'Cancel queue'; form.removeAttribute('aria-busy');
  }
}

document.querySelector('#refresh-queue').addEventListener('click', () => loadQueueStatus(true));
document.querySelector('#cancel-dialog').addEventListener('cancel', event => { if (cancellationPending) event.preventDefault(); });
document.querySelector('#keep-queue').addEventListener('click', () => document.querySelector('#cancel-dialog').close());
document.querySelector('#cancel-form').addEventListener('submit', cancelQueue);
document.querySelector('#logout-button').addEventListener('click', event => {
  window.mediqSignOut(event.currentTarget);
});
loadQueueStatus();
window.setInterval(() => {
  if (!document.hidden || patientAlerts.backgroundEnabled) loadQueueStatus(false);
}, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadQueueStatus(false); });
