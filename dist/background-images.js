import { DEFAULT_AVATAR, DEMO_AVATAR, profileAvatarSrc, profilePhotoPatch } from './avatar.js';

export function normalizeBackgroundImage(value, { allowDemo = false } = {}) {
  if (allowDemo && value === DEMO_AVATAR) return value;
  return typeof value === 'string' && value.length <= 1800000 && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : '';
}

// A removed avatar does not remove a separately selected background. Keep its
// last profile image as a snapshot, while future photo replacements can follow.
export function profileBackgroundSrc(store, { demo = false } = {}) {
  const current = profileAvatarSrc(store?.profile, { demo });
  if (current !== DEFAULT_AVATAR) return current;
  return normalizeBackgroundImage(store?.preferences?.backgroundProfilePhoto, { allowDemo:true });
}

export function resolveBackgroundImage(store, options = {}) {
  const preferences = store?.preferences || {};
  if (preferences.backgroundMode === 'neutral') return { mode:'neutral', src:'' };
  const custom = preferences.backgroundMode === 'custom';
  const src = custom ? normalizeBackgroundImage(preferences.backgroundPhoto) : profileBackgroundSrc(store, options);
  return { mode:src ? custom ? 'custom' : 'profile' : 'neutral', src };
}

export function updateProfilePhoto(store, photo, options = {}) {
  const profile = { ...store.profile, ...profilePhotoPatch(photo, options.edit) };
  if (photo !== '') return { ...store, profile };
  const backgroundProfilePhoto = profileBackgroundSrc(store, options);
  return { ...store, profile, preferences:{ ...store.preferences, backgroundProfilePhoto } };
}

export function removeCustomBackground(store) {
  const preferences = store.preferences || {};
  return { ...store, preferences:{ ...preferences, backgroundPhoto:'', backgroundMode:preferences.backgroundMode === 'custom' ? 'neutral' : preferences.backgroundMode } };
}
