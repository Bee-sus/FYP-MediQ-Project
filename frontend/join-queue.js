fetch('/api/settings').then(response => response.json()).then(data => document.querySelectorAll('.brand small').forEach(item => { item.textContent = data.settings.clinicName; })).catch(() => {});
let selectedService = null;
const requestedServiceId = Number(new URLSearchParams(window.location.search).get('service'));

function setDateText() {
  const formatted = new Intl.DateTimeFormat('en-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  document.querySelector('#current-date').textContent = formatted;
  document.querySelector('#confirm-date').textContent = formatted;
}

function updateJoinButton() {
  document.querySelector('#join-queue-button').disabled = !(selectedService && document.querySelector('input[name="join-location"]:checked') && document.querySelector('#queue-agreement').checked);
}

function selectService(service, card) {
  if (card.disabled) return;
  selectedService = service;
  document.querySelectorAll('.queue-service-option').forEach((item) => {
    const selected = item === card;
    item.classList.toggle('selected', selected);
    item.setAttribute('aria-checked', String(selected));
  });
  document.querySelector('#confirm-service').textContent = service.name;
  updateJoinButton();
}

function renderServices(services) {
  const container = document.querySelector('#queue-services');
  const selectedId = selectedService?.id || requestedServiceId;
  selectedService = null;
  document.querySelector('#confirm-service').textContent = 'Select a service';
  updateJoinButton();
  if (!services.length) {
    container.innerHTML = '<p class="dashboard-empty">No services are available for queue registration.</p>';
    return;
  }
  let selectedCard = null;
  let selectedOption = null;
  container.replaceChildren(...services.map((service) => {
    const availability = describeQueueAvailability(service);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'queue-service-option';
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', 'false');
    card.innerHTML = '<span class="service-radio" aria-hidden="true"></span><span class="service-option-copy"><span class="queue-service-title"><strong></strong><span class="queue-load-badge"></span></span><small></small><span class="queue-availability-metrics"></span><span class="queue-availability-advice"></span></span>';
    card.dataset.queueStatus = availability.status;
    card.querySelector('strong').textContent = service.name;
    card.querySelector('small').textContent = `${service.doctorName ? `Dr. ${service.doctorName} · ` : ''}${service.serviceDetails || service.description || 'Clinic consultation service.'}`;
    card.querySelector('.queue-load-badge').textContent = availability.label;
    card.querySelector('.queue-availability-metrics').textContent = `${availability.activePatients} ${availability.activePatients === 1 ? 'patient' : 'patients'} ahead · ${availability.waitText}`;
    card.querySelector('.queue-availability-advice').textContent = service.delayNotice ? `Service update: ${service.delayNotice} · Waiting times may change.` : availability.advice;
    card.disabled = availability.status === 'full' || availability.status === 'closed';
    card.addEventListener('click', () => selectService(service, card));
    if (Number(service.id) === selectedId && !card.disabled) { selectedCard = card; selectedOption = service; }
    return card;
  }));
  if (selectedCard) selectService(selectedOption, selectedCard);
}

async function refreshAvailability() {
  const response = await fetch('/api/patient/queues/availability');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Current queues could not be loaded.');
  renderServices(data.services);
  document.querySelector('#queue-availability-updated').textContent = `Updated ${new Intl.DateTimeFormat('en-MY', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(data.updatedAt))} · refreshes every 30 sec`;
}

async function loadJoinQueuePage() {
  setDateText();
  try {
    const [accountResponse, queueResponse] = await Promise.all([
      fetch('/api/auth/me'), fetch('/api/patient/queues/active'),
    ]);
    if (accountResponse.status === 401 || accountResponse.status === 403) {
      window.location.replace('/patient-login.html');
      return;
    }
    const account = await accountResponse.json();
    if (!accountResponse.ok) throw new Error(account.error || 'Your account could not be verified.');
    document.querySelector('#patient-name').textContent = account.user.fullName;
    document.querySelector('#confirm-patient').textContent = account.user.fullName;
    const queueData = await queueResponse.json();
    if (!queueResponse.ok) throw new Error(queueData.error || 'Your queue status could not be checked.');
    if (queueData.queue) {
      window.location.replace('/queue-status.html');
      return;
    }
    await refreshAvailability();
    setInterval(() => {
      if (document.visibilityState === 'visible') refreshAvailability().catch(() => {
        document.querySelector('#queue-availability-updated').textContent = 'Unable to refresh. Select Refresh to try again.';
      });
    }, 30000);
  } catch (error) {
    const alert = document.querySelector('#page-alert');
    alert.textContent = error.message || 'The queue page could not be loaded.';
    alert.hidden = false;
  }
}

async function joinQueue() {
  const locationChoice = document.querySelector('input[name="join-location"]:checked');
  if (!selectedService || !locationChoice || !document.querySelector('#queue-agreement').checked) return;
  const button = document.querySelector('#join-queue-button');
  const status = document.querySelector('#join-status');
  button.disabled = true;
  status.textContent = 'Joining the queue…';
  status.className = 'form-status';
  status.hidden = false;
  try {
    const response = await fetch('/api/patient/queues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId: selectedService.id, joinLocation: locationChoice.value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The queue could not be joined.');
    status.textContent = `Queue number ${formatQueueTicket(result.queue.serviceId, result.queue.queueNumber)} confirmed. Opening your queue status…`;
    setTimeout(() => window.location.assign('/queue-status.html?joined=true'), 800);
  } catch (error) {
    status.textContent = error.message;
    status.className = 'form-status error';
    button.disabled = false;
  }
}

document.querySelectorAll('input[name="join-location"]').forEach(input => input.addEventListener('change', updateJoinButton));
document.querySelector('#queue-agreement').addEventListener('change', updateJoinButton);
document.querySelector('#refresh-queue-availability').addEventListener('click', () => refreshAvailability().catch((error) => {
  document.querySelector('#queue-availability-updated').textContent = error.message;
}));
document.querySelector('#join-queue-button').addEventListener('click', joinQueue);
document.querySelector('#logout-button').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.replace('/');
});
loadJoinQueuePage();
