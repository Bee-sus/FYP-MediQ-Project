fetch('/api/settings').then(response => response.json()).then(data => document.querySelectorAll('.brand small').forEach(item => { item.textContent = data.settings.clinicName; })).catch(() => {});
function createServiceCard(service) {
  const card = document.createElement('article');
  card.className = 'service-card';

  const header = document.createElement('div');
  header.className = 'service-card-header';

  const name = document.createElement('h3');
  name.textContent = service.name;

  const availability = document.createElement('span');
  availability.className = 'service-availability';
  availability.textContent = service.availability;

  const description = document.createElement('p');
  description.textContent = `${service.doctorName ? `Dr. ${service.doctorName} · ` : ''}${service.serviceDetails || service.description || 'Clinic consultation service.'}`;

  const duration = document.createElement('span');
  duration.className = 'service-duration';
  duration.textContent = `Average duration: ${service.averageDurationMinutes} minutes`;

  header.append(name, availability);
  card.append(header, description, duration);
  return card;
}

async function loadClinicServices() {
  const servicesList = document.querySelector('#services-list');

  try {
    const response = await fetch('/api/services');
    if (!response.ok) {
      throw new Error('Clinic services could not be loaded.');
    }

    const data = await response.json();
    servicesList.replaceChildren(...data.services.map(createServiceCard));
    if (!data.services.length) servicesList.textContent = 'No clinic services are currently available.';
  } catch (error) {
    const message = document.createElement('p');
    message.className = 'services-message error';
    message.textContent = 'Clinic services are temporarily unavailable.';
    servicesList.replaceChildren(message);
  }
}

let noticeTimer;

function showDevelopmentNotice(feature) {
  const notice = document.querySelector('#demo-notice');
  notice.textContent = `${feature} will be available soon.`;
  notice.hidden = false;

  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    notice.hidden = true;
  }, 4500);
}

function configureHomepageControls() {
  const audienceMessage = document.querySelector('#audience-message');
  const roleButtons = document.querySelectorAll('.role-button');
  const signInButton = document.querySelector('#sign-in-button');
  const registerButton = document.querySelector('#register-button');

  roleButtons.forEach((button) => {
    button.addEventListener('click', () => {
      roleButtons.forEach((roleButton) => {
        const isSelected = roleButton === button;
        roleButton.classList.toggle('active', isSelected);
        roleButton.setAttribute('aria-pressed', String(isSelected));
      });

      const role = button.dataset.role;
      const access = {
        patient: { label: 'Patient sign in', href: '/patient-login.html', message: 'New patients can create their own patient account.' },
        staff: { label: 'Staff sign in', href: '/staff-login.html', message: 'Staff accounts are issued by the clinic administrator. There is no public staff registration.' },
        admin: { label: 'Administrator sign in', href: '/admin-login.html', message: 'Administrator access is restricted. There is no public administrator registration.' },
      }[role];

      signInButton.textContent = access.label;
      signInButton.href = access.href;
      registerButton.hidden = role !== 'patient';
      audienceMessage.textContent = access.message;
    });
  });

  document.querySelectorAll('[data-demo-action]').forEach((button) => {
    button.addEventListener('click', () => showDevelopmentNotice(button.dataset.demoAction));
  });

  document.querySelectorAll('[data-scroll-target]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelector(button.dataset.scrollTarget)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
}

loadClinicServices();
configureHomepageControls();
