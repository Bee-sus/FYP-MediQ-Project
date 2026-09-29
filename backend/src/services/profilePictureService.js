const MAX_PICTURE_LENGTH = 400000;

function validProfilePicture(value) {
  if (!value) return true;
  if (value.length > MAX_PICTURE_LENGTH) return false;
  return /^https?:\/\//i.test(value) || /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(value);
}

module.exports = { MAX_PICTURE_LENGTH, validProfilePicture };
