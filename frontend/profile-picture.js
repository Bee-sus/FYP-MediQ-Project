(function () {
  function initials(name) {
    return String(name || 'Staff').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  }

  function resizeImage(file) {
    return new Promise((resolve, reject) => {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return reject(new Error('Choose a JPEG, PNG or WebP image.'));
      if (file.size > 5 * 1024 * 1024) return reject(new Error('Choose an image smaller than 5 MB.'));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('The image could not be read.'));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error('The selected file is not a valid image.'));
        image.onload = () => {
          const size = 256;
          const canvas = document.createElement('canvas');
          canvas.width = size; canvas.height = size;
          const context = canvas.getContext('2d');
          const crop = Math.min(image.naturalWidth, image.naturalHeight);
          const x = (image.naturalWidth - crop) / 2;
          const y = (image.naturalHeight - crop) / 2;
          context.drawImage(image, x, y, crop, crop, 0, 0, size, size);
          resolve(canvas.toDataURL('image/jpeg', .82));
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  window.setupProfilePicturePicker = function (container, nameInput) {
    const hidden = container.querySelector('[name="profilePictureUrl"]');
    const preview = container.querySelector('.profile-picture-preview');
    const fileInput = container.querySelector('[type="file"]');
    const remove = container.querySelector('.remove-profile-picture');
    const status = container.querySelector('.profile-picture-status');
    const render = value => {
      hidden.value = value || '';
      preview.replaceChildren();
      if (value) {
        const image = document.createElement('img'); image.src = value; image.alt = 'Profile picture preview';
        image.onerror = () => { preview.textContent = initials(nameInput?.value); status.textContent = 'This picture could not be displayed.'; };
        preview.append(image);
      } else preview.textContent = initials(nameInput?.value);
      remove.hidden = !value;
    };
    fileInput.addEventListener('change', async () => {
      status.textContent = '';
      if (!fileInput.files[0]) return;
      try { render(await resizeImage(fileInput.files[0])); status.textContent = 'Picture ready. Save the profile to apply it.'; }
      catch (error) { fileInput.value = ''; status.textContent = error.message; }
    });
    remove.addEventListener('click', () => { fileInput.value = ''; status.textContent = 'Picture will be removed when saved.'; render(''); });
    nameInput?.addEventListener('input', () => { if (!hidden.value) render(''); });
    render(hidden.value);
    return { setValue: value => { fileInput.value = ''; status.textContent = ''; render(value); } };
  };
}());
