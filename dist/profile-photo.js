import { DEMO_AVATAR, isProfilePhoto } from './avatar.js';

const MAX_BYTES = 8 * 1024 * 1024;
const rasterType = /^image\/(?:jpeg|jpg|pjpeg|png|x-png|webp|gif|avif|bmp|heic|heif)$/i;
const rasterName = /\.(?:jpe?g|png|webp|gif|avif|bmp|heic|heif)$/i;

export const photoEditAborted = () => new DOMException('Photo editing cancelled.', 'AbortError');

export async function loadProfilePhoto(file, {
  createImage = () => new Image(), objectURLs = URL, signal,
} = {}) {
  if (signal?.aborted) throw photoEditAborted();
  const saved = typeof file === 'string';
  if (saved) {
    if (!isProfilePhoto(file) && file !== DEMO_AVATAR) throw new Error('profilePhotoFormat');
  } else {
    if (!file || !Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_BYTES) throw new Error('profilePhotoSize');
    const type = String(file.type || '').toLowerCase();
    if (!rasterType.test(type) && !((!type || type === 'application/octet-stream') && rasterName.test(file.name || ''))) throw new Error('profilePhotoFormat');
  }
  const url = saved ? file : objectURLs.createObjectURL(file);
  let released = false;
  const release = () => { if (!released) { if(!saved)objectURLs.revokeObjectURL(url); released = true; } };
  try {
    const image = await new Promise((resolve,reject) => {
      const item = createImage();
      const finish = (error) => { clearTimeout(timer); item.onload=null; item.onerror=null; signal?.removeEventListener('abort',abort); error ? reject(error) : resolve(item); };
      const abort = () => finish(photoEditAborted());
      const timer = setTimeout(() => finish(new Error('profilePhotoDecode')), 15000);
      item.onload = () => finish();
      item.onerror = () => finish(new Error('profilePhotoDecode'));
      signal?.addEventListener('abort',abort,{once:true});
      if (signal?.aborted) { abort(); return; }
      item.src = url;
    });
    if (!((image.naturalWidth || image.width) > 0 && (image.naturalHeight || image.height) > 0)) throw new Error('profilePhotoDecode');
    return {image,release};
  } catch(error) {
    release();
    if (error?.name === 'AbortError') throw error;
    throw new Error(error?.message?.startsWith('profilePhoto') ? error.message : 'profilePhotoDecode');
  }
}

export async function prepareProfilePhoto(file, options = {}) {
  const source = await loadProfilePhoto(file, options);
  try {
    const {image} = source;
    const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
    const ratio = Math.min(1, 512 / Math.max(width, height));
    const canvas = options.createCanvas ? options.createCanvas() : document.createElement('canvas');
    canvas.width = Math.max(1,Math.round(width*ratio));
    canvas.height = Math.max(1,Math.round(height*ratio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('profilePhotoDecode');
    context.fillStyle = '#e8e9e9';
    context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(image,0,0,canvas.width,canvas.height);
    const result = canvas.toDataURL('image/jpeg',.84);
    if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(result) || result.length > 1800000) throw new Error('profilePhotoDecode');
    return result;
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new Error(error?.message?.startsWith('profilePhoto') ? error.message : 'profilePhotoDecode');
  } finally {
    source.release();
  }
}

// Photo selection is its own save operation, separate from unfinished profile
// fields. A newer selection/removal wins, and work cannot cross account boundaries.
export function createProfilePhotoEditor({
  prepare = prepareProfilePhoto, save, getIdentity = () => 'demo',
  onBusy = () => {}, onSaved = () => {}, onError = () => {}, onCancel = () => {},
}) {
  let revision = 0, busy = false, controller=null;
  const setBusy = value => { busy=value; onBusy(value); };
  async function update(file, remove=false) {
    const request = ++revision, identity = getIdentity();
    controller?.abort();
    const operation = new AbortController(); controller=operation;
    const current = () => request === revision && identity === getIdentity();
    const identityWatch = setInterval(() => { if (!current()) operation.abort(); }, 250);
    operation.signal.addEventListener('abort',()=>clearInterval(identityWatch),{once:true});
    setBusy(true);
    try {
      const prepared = remove ? '' : await prepare(file,{signal:operation.signal,isCurrent:current});
      const photo = typeof prepared === 'string' ? prepared : prepared?.photo;
      if (typeof photo !== 'string') throw new Error('profilePhotoDecode');
      const edit = prepared && typeof prepared === 'object' ? {photoSource:prepared.photoSource,photoCrop:prepared.photoCrop} : undefined;
      if (!current()) return false;
      const result = await save(photo,edit);
      if (result === false) throw new Error('saveFailed');
      if (!current()) return false;
      onSaved(photo,edit);
      return true;
    } catch(error) {
      if (current()) { if(error?.name === 'AbortError') onCancel(); else onError(error); }
      return false;
    } finally {
      clearInterval(identityWatch);
      if (request === revision) { controller=null; setBusy(false); }
    }
  }
  return {
    select: file => update(file), remove: () => update(null,true),
    cancel() { revision++; controller?.abort(); controller=null; setBusy(false); onCancel(); },
    get busy() { return busy; },
  };
}
