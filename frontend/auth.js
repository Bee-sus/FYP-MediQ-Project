function configureAuthForm() {
  const form = document.querySelector('[data-auth-form]');
  if (!form) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    const status = document.querySelector('#form-status');
    const password = form.querySelector('#password');
    const passwordConfirmation = form.querySelector('#confirm-password');

    if (passwordConfirmation && password.value !== passwordConfirmation.value) {
      status.textContent = 'The passwords do not match. Please check them and try again.';
      status.className = 'form-status error';
      status.hidden = false;
      passwordConfirmation.focus();
      return;
    }

    status.textContent = form.dataset.authForm === 'register'
      ? 'Your registration details are valid. Account creation will be available soon.'
      : 'Your sign-in details are valid. Secure account access will be available soon.';
    status.className = 'form-status';
    status.hidden = false;
  });
}

configureAuthForm();
