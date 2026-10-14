const staffProfileForm = document.querySelector('#staff-profile-form');
const staffPicture = setupProfilePicturePicker(staffProfileForm.querySelector('.profile-picture-field'), staffProfileForm.elements.fullName);

async function loadStaffProfile() {
  try {
    const { profile } = await staffApi('/api/staff/profile');
    for (const key of ['staffCode', 'fullName', 'email', 'phone', 'profilePictureUrl']) {
      staffProfileForm.elements[key].value = profile[key] || '';
    }
    staffPicture.setValue(profile.profilePictureUrl || '');
    document.querySelector('#staff-name').textContent = profile.fullName;
  } catch (error) { showAlert(error.message, 'error'); }
}

staffProfileForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const result = await staffApi('/api/staff/profile', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(staffProfileForm))),
    });
    document.querySelector('#staff-name').textContent = staffProfileForm.elements.fullName.value;
    showAlert(result.message);
  } catch (error) { showAlert(error.message, 'error'); }
});

document.querySelector('#staff-password-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (form.elements.newPassword.value !== form.elements.confirmPassword.value) {
    showAlert('New passwords do not match.', 'error');
    return;
  }
  try {
    const result = await staffApi('/api/staff/password', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: form.elements.currentPassword.value, newPassword: form.elements.newPassword.value }),
    });
    showAlert(result.message);
    form.reset();
    document.querySelector('#password-change-note').textContent = 'Your password is up to date.';
  } catch (error) { showAlert(error.message, 'error'); }
});

loadStaffProfile();
