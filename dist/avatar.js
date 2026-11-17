export const DEFAULT_AVATAR = './avatar-default.svg';
export const DEMO_AVATAR = './mochi.webp';

// Only locally re-encoded raster photos can replace the bundled avatar. A
// removal is explicit so a later render never silently restores the demo dog.
export const isProfilePhoto = value => typeof value === 'string' && value.length <= 1800000 && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
export const normalizePhotoSource = value => isProfilePhoto(value) && value.startsWith('data:image/jpeg;') ? value : '';
export function normalizePhotoCrop(value) {
  if (!value || !['zoom','centerX','centerY'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]))) return null;
  return {zoom:Math.min(4,Math.max(1,value.zoom)),centerX:Math.min(1,Math.max(0,value.centerX)),centerY:Math.min(1,Math.max(0,value.centerY))};
}

export function profileAvatarSrc(profile = {}, { demo = false } = {}) {
  if (profile?.photoRemoved === true) return DEFAULT_AVATAR;
  if (isProfilePhoto(profile?.photo)) return profile.photo;
  return demo ? DEMO_AVATAR : DEFAULT_AVATAR;
}

export function profilePhotoPatch(photo, edit) {
  if (photo === '') return {photo:'',photoRemoved:true,photoSource:'',photoCrop:null};
  if (!isProfilePhoto(photo)) throw new Error('profilePhotoDecode');
  const photoSource=normalizePhotoSource(edit?.photoSource);
  return {photo,photoRemoved:false,photoSource,photoCrop:photoSource ? normalizePhotoCrop(edit?.photoCrop) : null};
}

export function profilePhotoEditSource(profile, options = {}) {
  const avatar=profileAvatarSrc(profile,options);
  if (avatar===DEFAULT_AVATAR) return null;
  const source=normalizePhotoSource(profile?.photoSource);
  return source ? {src:source,photoCrop:normalizePhotoCrop(profile?.photoCrop),reuseSource:true} : {src:avatar,photoCrop:null,reuseSource:false};
}
