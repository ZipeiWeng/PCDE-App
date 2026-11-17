// The cookie-authenticated repository owns cloud care data. Appearance, photos,
// open panels and credentials never enter this payload.
const profileKeys = ['name', 'breed', 'birthday', 'age', 'weight', 'sex'];
const careKeys = ['goals', 'allergies', 'conditions', 'ownerName', 'doctorName', 'clinicName', 'records'];
const clone = value => JSON.parse(JSON.stringify(value));
export const hasAnyReadings = snapshot => ['heart', 'temp', 'steps', 'sleep'].some(key => Number.isFinite(snapshot?.[key]));

export function recordedReadingLabel(at, {now = new Date(), zh = false} = {}) {
  if(typeof at !== 'string')return '';
  const recorded=new Date(at);
  if(!Number.isFinite(recorded.valueOf()))return '';
  const locale=zh?'zh-CN':'en-GB';
  const clock=new Intl.DateTimeFormat(locale,{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(recorded);
  const date=recorded.toDateString()===now.toDateString()?'':new Intl.DateTimeFormat(locale,{day:'numeric',month:'short',...(recorded.getFullYear()!==now.getFullYear()?{year:'numeric'}:{})}).format(recorded)+' ';
  return `${zh?'记录于':'Recorded'} ${date}${clock}`;
}

export function cloudCare(store = {}) {
  return clone({profile:Object.fromEntries(profileKeys.filter(key => store.profile?.[key] !== undefined).map(key => [key, store.profile[key]])), ...Object.fromEntries(careKeys.filter(key => store[key] !== undefined).map(key => [key, store[key]]))});
}

export function mergeCloudCare(local = {}, pet = {}) {
  return {...local, ...Object.fromEntries(careKeys.filter(key => pet[key] !== undefined).map(key => [key, clone(pet[key])])), profile:{...local.profile, ...Object.fromEntries(profileKeys.filter(key => pet.profile?.[key] !== undefined).map(key => [key, pet.profile[key]]))}};
}

export function createHealthData({fetcher = (...args) => fetch(...args), storage, onSnapshot = () => {}, onPet = () => {}, onChange = () => {}, onError = () => {}, isVisible = () => true, pollMs = 15000, setTimer = setInterval, clearTimer = clearInterval} = {}) {
  if(storage === undefined) { try { storage = globalThis.localStorage; } catch { storage = null; } }
  let epoch = 0, controller = null, timer = null, refreshJob = null, saveJob = null, pending = null, pendingRevision = null, outboxKey = '', blocked = false, requestNumber = 0, acceptedRead = 0;
  const responseOrder = new WeakMap();
  let state = initial();
  function initial() { return {authenticated:false, isTest:false, loading:false, saving:false, error:'', conflict:false, pet:null, devices:[], snapshot:null}; }
  const getState = () => ({...state, devices:[...state.devices]});
  const emit = () => onChange(getState());
  function saveOutbox() {
    if(!outboxKey || !storage) return;
    try {
      if(!pending)storage.removeItem(outboxKey);
      // The account-scoped model store already holds the edited care data.
      // A tiny revision marker keeps retries durable without duplicating photos
      // or allowing an unbounded second copy of medical documents.
      else storage.setItem(outboxKey,JSON.stringify({revision:pendingRevision,dirty:true}));
    } catch { onError('Your changes are saved in this browser, but cloud retry storage is unavailable. Keep this page open until syncing finishes.'); }
  }
  function restoreOutbox(localStore) {
    try {
      const saved=JSON.parse(storage?.getItem(outboxKey)||'null');
      if(saved?.dirty===true && Number.isInteger(saved.revision) && saved.revision>=0) { pending=cloudCare(localStore);pendingRevision=saved.revision; }
    } catch { /* An invalid retry record cannot supply cloud care data. */ }
  }
  function failure(error, run) {
    if(run !== epoch || error?.name === 'AbortError') return;
    state.error = error?.message || 'Cloud data could not sync. Your local changes are kept on this device.';
    if(error?.status === 409) { blocked = true; state.conflict = true; state.error = 'This profile changed on another device. Your local changes are kept here; review the cloud profile before saving again.'; }
    emit(); onError(state.error, error);
  }
  async function request(path, {method = 'GET', body, run = epoch} = {}) {
    const signal = controller?.signal;
    const order = ++requestNumber;
    const response = await fetcher(`/api/health${path}`, {method, credentials:'same-origin', cache:'no-store', signal, headers:{Accept:'application/json', ...(body === undefined ? {} : {'Content-Type':'application/json'})}, ...(body === undefined ? {} : {body:JSON.stringify(body)})});
    const result = await response.json().catch(() => ({}));
    if(run !== epoch || signal?.aborted) throw Object.assign(new Error('Account changed.'), {name:'AbortError'});
    if(!response.ok) throw Object.assign(new Error(result.message || 'Cloud data could not sync. Please try again.'), {status:response.status, code:result.code});
    responseOrder.set(result,order);
    return result;
  }
  function accept(data, {pet = true, fromSave = false} = {}) {
    const newerPet=!state.pet || Number.isInteger(data.pet?.revision)&&data.pet.revision>=state.pet.revision;
    if(data.pet && newerPet && (fromSave || !state.pet || (!pending && !state.saving && !blocked))) {
      state.pet = data.pet;
      if(pet && !pending && !state.saving && !blocked) onPet(data.pet);
    }
    const order=responseOrder.get(data)||0;
    if(order>=acceptedRead) {
      acceptedRead=order;
      if(Array.isArray(data.devices)) state.devices = data.devices;
      if(data.snapshot) { const changed=JSON.stringify(state.snapshot)!==JSON.stringify(data.snapshot);state.snapshot = data.snapshot;if(changed)onSnapshot(data.snapshot); }
    }
    state.error = blocked ? state.error : ''; emit();
  }
  function stop() {
    epoch++; controller?.abort(); controller = null;
    if(timer !== null) clearTimer(timer);
    timer = null; refreshJob = null; saveJob = null; pending = null; pendingRevision = null; outboxKey = ''; blocked = false;acceptedRead=0;state = initial(); emit();
  }
  async function flush() {
    if(!state.authenticated || blocked || !pending) return false;
    if(saveJob) return saveJob;
    const run = epoch;
    const job = (async () => {
      state.saving = true; emit();
      try {
        while(run === epoch && pending && !blocked) {
          const care = pending;
          const result = await request('/pet', {method:'PUT', body:{...care, revision:pendingRevision ?? state.pet?.revision ?? 0}, run});
          if(run !== epoch) return false;
          if(pending === care) pending = null;
          pendingRevision = pending ? result.pet?.revision ?? pendingRevision : null;
          saveOutbox();
          // A newer local edit wins over the earlier save response.
          accept(result, {pet:false, fromSave:true});
        }
        return true;
      } catch(error) { failure(error, run); return false; }
      finally { if(run === epoch) { state.saving = false; emit(); } }
    })();
    saveJob = job;
    try { return await job; } finally { if(run === epoch && saveJob === job) saveJob = null; }
  }
  function queueSave(store) {
    if(!state.authenticated) return;
    const care = cloudCare(store);
    if(!pending && state.pet && JSON.stringify(care) === JSON.stringify(cloudCare(state.pet))) return;
    pending = care;
    pendingRevision ??= state.pet?.revision ?? 0;
    saveOutbox();
    if(state.pet) void flush();
  }
  async function refresh() {
    if(!state.authenticated) return null;
    if(refreshJob) return refreshJob;
    const run = epoch;
    const job = (async () => {
      try {
        // Never race a profile write with a stale bootstrap revision.
        if(saveJob) await saveJob;
        if(run !== epoch) return null;
        const data = await request('/bootstrap', {run});
        accept(data);
        if(pending && !blocked) void flush();
        return data;
      } catch(error) { failure(error, run); return null; }
    })();
    refreshJob = job;
    try { return await job; } finally { if(run === epoch && refreshJob === job) refreshJob = null; }
  }
  async function start(account, localStore, {signal} = {}) {
    stop();
    if(!account?.id || account.demo === true) return null;
    const run = epoch;
    controller = new AbortController(); state = {...initial(), authenticated:true, isTest:account.isTest === true, loading:true}; emit();
    outboxKey=`pawprint-health.cloud-outbox.v1:${account.id}`;
    restoreOutbox(localStore);
    const abort = () => { if(run === epoch) stop(); };
    if(signal?.aborted) { stop(); return null; }
    signal?.addEventListener('abort', abort, {once:true});
    try {
      const data = await request('/bootstrap', {run});
      accept(data, {pet:data.pet?.initialized !== false});
      if(data.pet?.initialized === false && !pending) { pending = cloudCare(localStore);pendingRevision=data.pet.revision;saveOutbox(); }
      if(pending)await flush();
      if(run !== epoch) return null;
      if(account.isTest === true && !hasAnyReadings(state.snapshot)) {
        const seeded = await request('/demo/seed', {method:'POST', body:{}, run}); accept(seeded);
      }
      return getState();
    } catch(error) { failure(error, run); return null; }
    finally {
      signal?.removeEventListener('abort', abort);
      if(run === epoch) {
        state.loading = false; emit();
        timer = setTimer(() => { if(isVisible()) void refresh(); }, pollMs);
      }
    }
  }
  async function createDevice(label) {
    const run = epoch;
    const result = await request('/devices', {method:'POST', body:{label}, run});
    await refresh();
    if(run !== epoch) throw Object.assign(new Error('Account changed.'), {name:'AbortError'});
    return result;
  }
  async function revokeDevice(id) {
    const result = await request(`/devices/${encodeURIComponent(id)}/revoke`, {method:'POST', body:{}});
    await refresh(); return result;
  }
  async function seedTestData() {
    const result = await request('/demo/seed', {method:'POST', body:{}}); accept(result); return result;
  }
  // Called only after an explicit choice to discard pending edits in favour of
  // the newer cloud version. A conflict never silently overwrites either side.
  async function useCloudProfile() { pending = null;pendingRevision=null;saveOutbox();blocked = false;state.conflict = false;return refresh(); }
  return {start, stop, refresh, queueSave, flush, getState, createDevice, revokeDevice, seedTestData, useCloudProfile};
}
