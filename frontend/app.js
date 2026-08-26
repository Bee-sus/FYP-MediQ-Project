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
  description.textContent = service.description;

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
      const isAdmin = role === 'admin';

      signInButton.textContent = isAdmin ? 'Staff sign in' : 'Sign in';
      signInButton.dataset.demoAction = isAdmin ? 'Staff sign in' : 'Patient sign in';
      registerButton.hidden = isAdmin;
      audienceMessage.textContent = isAdmin
        ? 'Staff accounts are issued by the clinic administrator.'
        : 'New patients can register for an account.';
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
