import { readStore, saveStore, createSnapshot, createEmptySnapshot, selectAccount, assessCurrentHealth, withTestAssessment } from './model.js';
import { isDemoAccount, hasCurrentReadings, hasHealthScore, emptyReadingLabel } from './readings-state.js';
import { createHealthData, mergeCloudCare, cloudCare, hasAnyReadings, recordedReadingLabel } from './health-data.js';
import { createTestScenarios } from './test-scenarios.js';
import { consumeBillingReturn } from './billing.js';
import { initShop, consumeShopReturn } from './shop.js';
import { initAuth } from './auth.js';
import { initSessionLoader } from './startup.js';
import { authRequest } from './auth-client.js';
import { createOnboarding } from './onboarding.js';
import { createOnboardingState } from './onboarding-state.js';
import { installPageGestures } from './gestures.js';
import { installPageScrubber } from './page-scrubber.js';
import { installSwipeDismiss } from './settings-gestures.js';
import { waterTransition } from './water-transition.js';
import { mountOrb } from './orb.js';
import { renderTrends, renderSleep } from './charts.js';
import { initHealthCard } from './health-card.js';
import { initCompanion } from './companion.js';
import { initSettings } from './settings.js';
import { applyBackgroundFrost } from './background.js';
import { profileAvatarSrc } from './avatar.js';
import { resolveBackgroundImage } from './background-images.js';
import { initInsights, describeCurrentPattern, URGENT_SIGNS } from './insights.js';
import { recordDeviceAlert, updateDeviceAlertTrend } from './device-alerts.js';
import { setInterfaceLanguage } from './i18n.js';
import { icon, escapeHTML as esc, openSheet, closeSheet, toast } from './ui.js';

const $ = id => document.getElementById(id);
const put = (id, text) => { $(id).textContent = text; };
const number = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
let store = readStore();
let snapshot = createSnapshot();
let reportedSigns = null;
let role = 'owner';
let activeAccount = {demo:true};
let demoMode = true;
let realContextBeforeDemo = null;
let latestCloudSnapshot = null;
const testScenarios = createTestScenarios();
const billingReturn = consumeBillingReturn(window.location.href);
let pendingBillingReturn = billingReturn.intent;
const shopReturn = consumeShopReturn(billingReturn.cleanURL);
let pendingShopReturn = shopReturn.intent;
let deviceState = {status:'idle'};
let page = 1;
let settingsReturnPage = 1;
let shopReturnPage = 1;
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let online = true;
let soundEnabled = true;
let alarmContext;
let refreshCount = 0;
let transitioning = false;
let orbTransitionEpoch = 0;
let returnToSettings = false;
let syncTimer;
const alerts = [];
let guideAccount = null;
let guideSnapshot = null;
let guideStorage;
try { guideStorage = window.localStorage; } catch { /* The guide still works without storage. */ }
const guideState = createOnboardingState({
  storage: guideStorage,
  completeRemote: accountId => authRequest('/onboarding-complete', { accountId }),
});
const guide = createOnboarding({
  shell: $('app-shell'),
  getLanguage: () => store.preferences?.language || 'en',
  showPage, getPage: () => page,
  getNeedsConnection: () => !isDemoAccount(activeAccount) && !demoMode && !hasCurrentReadings(snapshot),
  onStep({ action }) {
    if (!action) return;
    if (action === 'vet-example') {
      return insights.useVetExample();
    } else if (action === 'home-current') {
      closeSheet(); settings.close(false);
      $('card-screen').hidden = true; $('app-workspace').hidden = false;
      refreshViews(); showPage(1,false);
    } else if (['set-good', 'set-watch', 'set-alert', 'home-good', 'activity-home'].includes(action)) {
      // Tutorial scenarios are transient. They never run chooseScenario(),
      // persist observations, create alert history, or play an emergency sound.
      const scenario = action === 'set-watch' ? 'watch' : action === 'set-alert' ? 'alert' : 'good';
      snapshot = createSnapshot(scenario, { observationSource: 'demo' });
      if (action === 'home-good' || action === 'activity-home') {
        closeSheet();
        settings.close(false);
        $('card-screen').hidden = true;
        $('app-workspace').hidden = false;
      }
      refreshViews();
      showPage(1, false);
    } else if (action === 'watch-alert' || action === 'red-alert') {
      snapshot = createSnapshot(action === 'red-alert' ? 'alert' : 'watch', { observationSource: 'demo' });
      refreshViews();
      insights.open({ alarm: true });
    }
  },
  restore(index) {
    orbTransitionEpoch++;
    if (guideSnapshot) { snapshot = guideSnapshot; guideSnapshot = null; }
    if(!demoMode){
      if(deviceState.status==='demo'){settings.resetConnection?.({notify:false});deviceState={status:'idle'};}
      if(latestCloudSnapshot) snapshot = cloudSnapshotWithSigns(latestCloudSnapshot);
      online=snapshot.connected===true||deviceState.status==='connected';
      if(!hasAnyReadings(snapshot))snapshot=createEmptySnapshot({connected:online,observedSigns:reportedSigns||[]});
    }
    settings.close(false);
    closeSheet();
    returnToSettings = false;
    $('card-screen').hidden = true;
    $('app-workspace').hidden = false;
    refreshViews();
    showPage(index, false);
  },
  onFinish() { if (guideAccount) void guideState.finish(guideAccount); guideAccount = null; },
});
function startGuide() {
  if (guide.active) guide.close();
  guideAccount = { ...activeAccount };
  guideSnapshot = snapshot;
  companion.deactivate();
  closeSheet();
  $('card-screen').hidden = true;
  $('app-workspace').hidden = false;
  guide.start();
}

const states = {
  good: { label: 'Looking good' },
  watch: { label: 'Check this pattern' },
  alert: { label: 'Get help now' },
  unknown: { label: 'Waiting for readings' },
};

function persist(next) {
  if (!saveStore(next)) {
    toast('This browser could not save the record. Please check local storage access.');
    return false;
  }
  store = readStore();
  applyPreferences();
  healthData.queueSave(store);
  return true;
}

function updateWarningHistory({ emit = false, source } = {}) {
  if (guide.active) return;
  if (!isDemoAccount(activeAccount) && demoMode) return;
  if (!hasCurrentReadings(snapshot) && !snapshot.observedSigns?.length) return;
  const pattern = describeCurrentPattern(snapshot);
  source ||= snapshot.observationSource === 'owner' && pattern.emergencySigns.length ? 'owner' : 'demo';
  // The measurements remain simulated; only an explicit symptom check-in is
  // an owner observation. Never use demo readings to resolve an owner alert.
  const sample = { ...snapshot, observationSource: source, status: pattern.status, triage: { ...snapshot.triage, level: pattern.status } };
  const now = new Date().toISOString();
  const previous = store.deviceAlerts || [];
  let history = updateDeviceAlertTrend(previous, sample, { source, now });
  if (emit && (source === 'demo' || pattern.emergencySigns.length)) {
    const urgent = pattern.status === 'alert';
    const reason = urgent
      ? pattern.emergencySigns.map(id => URGENT_SIGNS.find(sign => sign.id === id)?.label).filter(Boolean).join(' · ')
      : pattern.relevant.map(item => `${item.name} ${number.format(item.value)} ${item.unit} · usual ${number.format(item.usual)} ${item.unit}`).join('; ');
    history = recordDeviceAlert(history, sample, {
      source, now, title: urgent ? 'Urgent signs reported' : pattern.title,
      risk: urgent ? pattern.possibilities.join(' · ') : pattern.risk, reason,
    });
  }
  if (history !== previous) persist({ ...store, deviceAlerts: history });
}

const insights = initInsights({
  getSnapshot: () => snapshot, getStore: () => store, getAccount: () => activeAccount, openCard,
  onConnect: () => openSettings('device'),
  isTutorial: () => guide.active,
  canDismiss: () => !guide.active || guide.allowSwipeDismiss,
  onViewChange: ({ alarm }) => guide.notify({ type: alarm ? 'health-alert' : 'health-open' }),
  onVetViewChange: event => guide.notify({ type: 'vet', ...event }),
});
const shared = { getStore: () => store, getSnapshot: () => snapshot, persist, onChange: refreshViews };
const card = initHealthCard($('health-card-content'), { ...shared, getRole: () => role, getAccount: () => activeAccount, isOnboarding: () => guide.active });
const companion = initCompanion($('chat-content'), {
  ...shared,
  onTextMode: () => guide.notify({type:'compose'}),
  onInputCancel: () => guide.notify({type:'input-cancel'}),
});
const orb = mountOrb($('wellness-orb'), { tone: snapshot.status });
function cloudSnapshotWithSigns(value) {
  value=withTestAssessment(value,activeAccount);
  if(testScenarios.active(activeAccount))return testScenarios.resolve(activeAccount,value);
  if(!reportedSigns?.length) return value;
  const triage=assessCurrentHealth(value,reportedSigns);
  return {...value,observedSigns:reportedSigns,observationSource:'owner',triage,status:triage.level};
}
const healthData = createHealthData({
  isVisible:()=>!document.hidden,
  onPet(pet) {
    if(JSON.stringify(cloudCare(store))===JSON.stringify(cloudCare(pet)))return;
    const merged=mergeCloudCare(store,pet);
    store=saveStore(merged)?readStore():merged;
    if(!guide.active)refreshViews();
  },
  onSnapshot(value) {
    latestCloudSnapshot=value;
    if(guide.active||demoMode)return;
    snapshot=cloudSnapshotWithSigns(value);online=value.connected===true||deviceState.status==='connected';
    // Keep the conversation and open forms intact while new readings arrive.
    renderHome();renderData();if(!$('card-screen').hidden)card.render();
  },
  onChange() { settings.refreshDeviceStatus?.(); },
  onError(message) { toast(message); },
});
const settings = initSettings($('settings-screen'), {
  getStore: () => store, saveStore: persist, getAccount: () => activeAccount, healthData,
  getDeviceStatus: () => ({ online, lastSync: snapshot.updatedAt, hasReadings:hasAnyReadings(snapshot), practice:guide.active, demo:demoMode || snapshot.simulated===true || (guide.active && snapshot.observationSource==='demo'), cloud:healthData.getState() }),
  onConnectionChange(state) {
    deviceState=state;
    if(guide.active){
      if(!demoMode){online=latestCloudSnapshot?.connected===true||state.status==='connected';if(!hasAnyReadings(guideSnapshot))guideSnapshot=createEmptySnapshot({connected:online,observedSigns:reportedSigns||[]});}
      return;
    }
    if(state.status==='demo') { startDemo(); return; }
    else if(state.status==='connected') { if(realContextBeforeDemo){reportedSigns=realContextBeforeDemo.reportedSigns;realContextBeforeDemo=null;}demoMode=activeAccount.demo===true;online=true;if(!demoMode)snapshot=latestCloudSnapshot?cloudSnapshotWithSigns(latestCloudSnapshot):createEmptySnapshot({connected:true,observedSigns:reportedSigns||[]}); }
    else if(['idle','disconnected','error','unsupported'].includes(state.status)){ online=demoMode&&state.status==='idle'||latestCloudSnapshot?.connected===true;if(!demoMode&&!hasAnyReadings(snapshot))snapshot=createEmptySnapshot({connected:online,observedSigns:reportedSigns||[]}); }
    refreshViews();
  },
  onClose() { $('settings-screen').hidden = true; $('app-workspace').hidden = false; refreshViews(); showPage(settingsReturnPage, false); guide.notify({type:'settings-close'}); },
  canUseGestures: () => !guide.active || guide.allowSettingsGestures,
  onViewChange(section) { guide.notify({type:'settings',section}); },
  onBackgroundPreview(value) { applyBackgroundFrost($('app-shell'), value); },
  onProfileChange: refreshViews,
  onHealthCard() { settings.close(); returnToSettings = true; openCard(); },
  onSignOut: signOut,
  onReplayGuide() { settings.close(); startGuide(); },
  onLanguageChange: () => applyPreferences(),
  onScenario() { settings.close();if(!demoMode&&!activeAccount.isTest)startDemo();$('demo-button').click(); },
  onDeviceToggle() { online = !online; refreshViews(); return online; },
  onSync() { if(healthData.getState().authenticated&&!demoMode)return healthData.refresh();if (!online || !demoMode || !hasCurrentReadings(snapshot)) return false; snapshot={...snapshot,updatedAt:new Date().toISOString()}; renderData(); return true; },
  onDemoRole() { settings.close(); enterApp(role === 'owner' ? 'vet' : 'owner'); },
});
const shop = initShop($('shop-screen'), {
  getAccount:()=>activeAccount,
  getLanguage:()=>store.preferences?.language||'en',
  onClose(){
    $('app-workspace').hidden=false;
    refreshViews();showPage(shopReturnPage,false);
    $('shop-button').focus({preventScroll:true});
  },
});
function openShop(){
  if(guide.active)return;
  shopReturnPage=page;
  companion.deactivate();closeSheet();settings.close(false);
  $('app-workspace').hidden=true;$('card-screen').hidden=true;
  shop.open();
}
function applyPreferences() {
  const prefs = store.preferences || {};
  setInterfaceLanguage(prefs.language || 'en');
  applyBackground();
  document.documentElement.dataset.motion = motionPreference.matches ? 'reduced' : 'full';
  orb.setReducedMotion?.(motionPreference.matches);
  window.dispatchEvent(new CustomEvent('pawprint:preferences'));
  clearInterval(syncTimer);
  syncTimer = setInterval(() => {
    if (!online || !demoMode || !hasCurrentReadings(snapshot) || document.hidden || $('app-workspace').hidden) return;
    snapshot = { ...snapshot, updatedAt: new Date().toISOString() };
    renderData();
  }, (prefs.syncInterval || 5) * 60 * 1000);
}
function applyBackground() {
  const prefs = store.preferences || {};
  const background = resolveBackgroundImage(store,{demo:activeAccount?.demo === true || activeAccount?.isTest === true});
  $('app-shell').style.setProperty('--profile-background', background.src ? `url(${JSON.stringify(background.src)})` : 'none');
  $('app-shell').style.setProperty('--profile-background-position', background.src === './mochi.webp' ? '70% 50%' : '50% 50%');
  $('app-shell').dataset.background = background.mode;
  $('app-shell').dataset.paws = String(Boolean(prefs.pawPattern));
  applyBackgroundFrost($('app-shell'), prefs.backgroundFrost);
}
function openSettings(section = 'profile') {
  if ($('settings-screen').hidden) settingsReturnPage = page;
  companion.deactivate(); closeSheet();
  $('app-workspace').hidden = true; $('card-screen').hidden = true;
  const target = typeof section === 'string' ? section : 'profile';
  settings.open(target, { sidebarOpen: target !== 'device' });
}
const sessionLoader=initSessionLoader($('app-shell'));
const auth = initAuth($('login-screen'), {
  getDefaultNames: () => ({ ownerName: store.ownerName, doctorName: store.doctorName }),
  async onLogin(account) {
    let loaded;
    try { loaded=await sessionLoader.run(async signal=>{
    healthData.stop(); latestCloudSnapshot=null;testScenarios.clear();shop.close(false);
    reportedSigns = null;
    demoMode=account.demo===true; online=demoMode; deviceState={status:'idle'};realContextBeforeDemo=null;
    snapshot = demoMode ? createSnapshot() : createEmptySnapshot();
    settings.resetSession?.({notify:false});
    alerts.length = 0;
    activeAccount=account;
    selectAccount(account);
    store=readStore();
    companion.setAccount(account);
    const profile = account.isTest ? { ...store.profile, breed:store.profile.breed === 'Not recorded' ? 'Golden retriever' : store.profile.breed, weight:store.profile.weight || 28.5 } : store.profile;
    persist({ ...store, profile, ...(account.isTest?{preferences:{...store.preferences,backgroundMode:'neutral',pawPattern:true}}:{}), [account.role === 'vet' ? 'doctorName' : 'ownerName']: account.name });
    await healthData.start(account,store,{signal});
    if(signal.aborted)return;
    enterApp(account.role);
    }); } catch(error) {
      closeSheet();settings.close(false);
      $('app-workspace').hidden=true;$('card-screen').hidden=true;$('settings-screen').hidden=true;
      $('login-screen').hidden=false;
      throw error;
    }
    if(!loaded)return;
    if(pendingShopReturn && account.id && account.demo!==true && account.isTest!==true){
      const intent=pendingShopReturn;
      pendingShopReturn=null;pendingBillingReturn=null;
      window.history.replaceState(null,'',shopReturn.cleanURL);
      openShop();shop.acceptReturn(intent);
      return;
    }
    if(pendingBillingReturn && account.id && account.demo!==true && account.isTest!==true){
      const intent=pendingBillingReturn;
      pendingBillingReturn=null;
      window.history.replaceState(null,'',shopReturn.cleanURL);
      openSettings('subscription');
      settings.acceptBillingReturn(intent);
      return;
    }
    if (guideState.shouldShow(account)) startGuide();
  },
});

function renderHome() {
  const state = states[snapshot.status] || states.unknown;
  const available=hasHealthScore(snapshot), readings=hasAnyReadings(snapshot), simulated=readings&&(snapshot.simulated===true||snapshot.observationSource==='demo');
  const zh=store.preferences?.language==='zh';
  const name = store.profile.name;
  $('app-shell').dataset.tone = snapshot.status;
  const healthLabel=snapshot.status==='unknown'&&readings?(zh?'已收到读数，暂无健康评分':'Readings received; health comparison unavailable'):zh?({good:'状态平稳',watch:'需要关注',alert:'请尽快就医',unknown:'等待设备读数'}[snapshot.status]||'等待设备读数'):state.label;
  const avatarStatus=`${zh?'宠物当前状态':'Current wellness'}: ${healthLabel}${simulated?(zh?' · 模拟数据':' · simulated'):''}`;
  put('avatar-health-description',avatarStatus);
  $('account-button').title=`${zh?'设置':'Settings'} · ${avatarStatus}`;
  $('demo-button').innerHTML = `<span class="demo-dot"></span> ${activeAccount.isTest?'TEST':simulated?'DEMO':(zh?'设备':'DEVICE')} ${icon('chevron')}`;
  $('demo-button').title = activeAccount.isTest?'Test health colours and alerts':demoMode?'Simulated readings':'Device settings';
  $('demo-button').setAttribute('aria-label',activeAccount.isTest?'Choose a test health scenario':demoMode?'Choose a demo health scenario':'Device connection');
  put('wellness-score', available?snapshot.score:'—');
  document.querySelector('.orb-score-max').hidden=!available;
  const waitingLabel=readings?(zh?'已收到读数 · 暂无健康评分':'Readings received · no health score yet'):emptyReadingLabel({connected:snapshot.connected,zh});
  $('wellness-orb').setAttribute('aria-label',available?`Wellness ${snapshot.score} out of 100${simulated?', demo':''}. ${state.label}. ${guide.orbInstruction||'Tap for details.'}`:snapshot.status==='alert'?'Urgent signs reported. Get veterinary help now. Tap for details.':`${waitingLabel}. Tap for details.`);
  put('status-label', !available&&snapshot.status!=='alert'?waitingLabel:state.label);
  let actions=$('home-setup-actions');
  if(!actions){actions=document.createElement('div');actions.id='home-setup-actions';actions.className='home-setup-actions';document.querySelector('.orb-wrap').append(actions);}
  actions.innerHTML=!readings&&snapshot.status!=='alert'?`<button class="button glass" data-home-connect>${icon('device')}${zh?'连接设备':'Connect collar'}</button><button class="home-demo-link" data-home-demo>${zh?'先体验示例':'Try a demo'}</button>`:testScenarios.active(activeAccount)?`<button class="home-demo-link" data-home-exit-demo>${zh?'返回已保存的数据':'Return to saved data'}</button>`:activeAccount.demo!==true&&demoMode?`<button class="home-demo-link" data-home-exit-demo>${zh?'退出示例':'Exit demo'}</button>`:'';
  actions.hidden=!actions.innerHTML;
  $('home-screen').classList.toggle('has-setup-actions',!actions.hidden);
  actions.querySelector('[data-home-connect]')?.addEventListener('click',()=>openSettings('device'));
  actions.querySelector('[data-home-demo]')?.addEventListener('click',startDemo);
  actions.querySelector('[data-home-exit-demo]')?.addEventListener('click',exitDemo);
  document.querySelectorAll('.pet-avatar').forEach(image => {
    image.src = profileAvatarSrc(store.profile,{demo:activeAccount?.demo === true || activeAccount?.isTest === true});
    image.alt = store.profile.name;
  });
  orb.setTone(snapshot.status);
}

const metricSpec = [
  ['heart', 'heart', 'Heart rate', 'bpm'],
  ['temp', 'temp', 'Skin temperature', '°C'],
  ['steps', 'steps', 'Steps today', 'steps'],
  ['sleep', 'moon', 'Estimated sleep', 'hours'],
];

function renderData() {
  const available=hasAnyReadings(snapshot),simulated=snapshot.simulated===true||snapshot.observationSource==='demo',cloud=healthData.getState().authenticated&&!demoMode;
  put('data-date', new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(snapshot.updatedAt?new Date(snapshot.updatedAt):new Date()));
  put('data-sync', available?`${online ? 'Received' : 'Last reading'} at ${time.format(new Date(snapshot.updatedAt))}${simulated?snapshot.source==='test'?' · test data':' · demo':snapshot.stale?' · last available data':''}`:emptyReadingLabel({connected:snapshot.connected}));
  $('refresh-button').disabled = cloud?false:!online || !available;
  $('metric-grid').innerHTML = metricSpec.map(([key, symbol, label, unit]) => {
    const recorded=Number.isFinite(snapshot[key])?recordedReadingLabel(snapshot.metricUpdatedAt?.[key],{zh:store.preferences?.language==='zh'}):'';
    const baseline=Number.isFinite(snapshot.baseline?.[key])?`Usual ${number.format(snapshot.baseline[key])} ${unit}`:Number.isFinite(snapshot[key])?recorded?'':'No baseline yet':'No readings yet';
    return `
    <article class="metric-tile glass">${icon(symbol)}<h2>${label}</h2>
      <p class="metric-reading"><strong>${Number.isFinite(snapshot[key])?(key === 'temp' ? snapshot[key].toFixed(1) : number.format(snapshot[key])):'—'}</strong><span>${unit}</span></p>
      <p class="metric-baseline">${[baseline,recorded].filter(Boolean).join(' · ')}</p></article>`;
  }).join('');
  $('goals-grid').innerHTML = [['steps', 'Daily steps', 'steps'], ['sleep', 'Estimated sleep', 'hours']].map(([key, label, unit]) => {
    const present=Number.isFinite(snapshot[key]),percent = present?Math.round(snapshot[key] / store.goals[key] * 100):null;
    return `<article class="goal-tile glass"><div class="goal-ring" role="img" aria-label="${label}, ${present?percent+'% of goal':'no readings yet'}"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="track" cx="50" cy="50" r="42"/><circle class="fill" cx="50" cy="50" r="42" pathLength="100" stroke-dasharray="${present?Math.min(100, percent):0} 100"/></svg><strong aria-hidden="true">${present?(percent > 999 ? '999%+' : percent + '%'):'—'}</strong></div><h3>${label}</h3><p>${present?number.format(snapshot[key])+' of ':'Goal · '}${number.format(store.goals[key])} ${unit}</p></article>`;
  }).join('');
  put('activity-value', Number.isFinite(snapshot.steps)?(snapshot.scenario?(online?'Quiet rest':'Quiet rest · last reading'):'Activity readings available'):'No activity readings yet');
  renderTrends($('trends-content'), snapshot.history);
  if(Number.isFinite(snapshot.sleep))renderSleep($('sleep-content'), snapshot.segments);else $('sleep-content').innerHTML='<p class="paw-chart-empty">No sleep readings yet</p>';
  document.querySelector('#data-screen .screen-note').textContent=available?(simulated?snapshot.source==='test'?'Test readings · simulated data.':'Demo readings · simulated data.':'Device readings · missing measurements remain blank.'):'Readings appear after a compatible device sends data.';
  $('alert-records').innerHTML = alerts.length
    ? [...alerts].reverse().map(alert => `<article class="alert-item"><strong>${esc(alert.title)}</strong><p>${esc(alert.date)} · ${esc(alert.detail)}</p></article>`).join('')
    : '<p class="small muted">No alerts in this session.</p>';
}

function refreshViews() {
  renderHome();
  renderData();
  if (!$('card-screen').hidden) card.render();
  if (page === 2) companion.render();
}

let pageAnimations = [];
function showPage(index, animate = true) {
  const previous = page;
  const target = ((index % 3) + 3) % 3;
  const direction = index > previous ? 1 : -1;
  pageAnimations.forEach(animation => animation.cancel());
  pageAnimations = [];
  page = target;
  $('app-workspace').dataset.page = String(page);
  const screens = [...document.querySelectorAll('#page-track > .screen')];
  screens.forEach((screen, i) => {
    screen.inert = page !== i;
    screen.setAttribute('aria-hidden', String(page !== i));
    screen.style.visibility = page === i ? 'visible' : 'hidden';
  });
  if (animate && previous !== page && !motionPreference.matches) {
    const incoming = screens[page], outgoing = screens[previous];
    outgoing.style.visibility = 'visible';
    const timing = { duration: 360, easing: 'cubic-bezier(.22,.8,.3,1)' };
    pageAnimations = [incoming.animate([{ transform: `translateX(${direction * 100}%)` }, { transform: 'translateX(0)' }], timing), outgoing.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-direction * 100}%)` }], timing)];
    pageAnimations[1].onfinish = () => { if (page !== previous) outgoing.style.visibility = 'hidden'; };
  }
  document.querySelectorAll('[data-position]').forEach(dot => {
    const active = Number(dot.dataset.position) === page;
    dot.classList.toggle('active', active);
    dot.setAttribute('aria-current', active ? 'page' : 'false');
  });
  if (page === 2) companion.render();
  else companion.deactivate();
  guide.notify({type:'page',index:page});
}

function canChangePage() {
  return !$('app-workspace').hidden && !$('app-sheet').open && !transitioning && (!guide.active || guide.allowPageChange);
}

function stepPage(direction) {
  if (!canChangePage() || ![-1, 1].includes(direction)) return;
  if(guide.active&&!guide.canNavigateTo(((page+direction)%3+3)%3))return;
  orb.release();
  showPage(page + direction);
}

function openCard() {
  companion.deactivate();
  $('app-workspace').hidden = true;
  $('card-screen').hidden = false;
  card.render();
  $('card-back').focus({ preventScroll: true });
  guide.notify({type:'card-open'});
}
function backFromCard() {
  $('card-screen').hidden = true;
  if (returnToSettings) { returnToSettings = false; openSettings(); return; }
  $('app-workspace').hidden = false;
  showPage(page);
  $('health-card-button').focus({ preventScroll: true });
  guide.notify({type:'card-close'});
}
function enterApp(nextRole) {
  role = nextRole === 'vet' ? 'vet' : 'owner';
  $('login-screen').hidden = true;
  $('app-workspace').hidden = false;
  applyPreferences();
  refreshViews();
  showPage(1);
  if (role === 'vet') openCard();
}
async function signOut() {
  sessionLoader.cancel();
  shop.close(false);
  healthData.stop();latestCloudSnapshot=null;testScenarios.clear();
  guide.close(); guideAccount = null;
  const logout = auth.signOut();
  settings.close();
  returnToSettings = false;
  companion.deactivate();
  closeSheet();
  $('app-workspace').hidden = true;
  $('card-screen').hidden = true;
  $('login-screen').hidden = false;
  activeAccount={demo:true};
  demoMode=true; online=true; deviceState={status:'idle'};realContextBeforeDemo=null;
  settings.resetSession?.({notify:false});
  reportedSigns=null;
  snapshot=createSnapshot();
  alerts.length=0;
  selectAccount(activeAccount);
  store=readStore();
  companion.setAccount(activeAccount);
  applyPreferences();
  try { await logout; } catch { toast('Signed out here. Server session could not be revoked; try again when connected.'); }
}

// A restored browser snapshot must return to the same locked account picker as a fresh visit.
window.addEventListener('pageshow', event => { if (event.persisted) signOut(); });

$('health-card-button').addEventListener('click', openCard);
$('device-button').addEventListener('click', () => openSettings('device'));
$('shop-button').addEventListener('click', openShop);
function selectPage(index) {
  if (!canChangePage() || index === page || (guide.active&&!guide.canNavigateTo(index))) return;
  orb.release();
  showPage(index);
}
document.querySelectorAll('[data-position]').forEach(button => button.addEventListener('click', () => selectPage(Number(button.dataset.position))));
installPageScrubber(document.querySelector('.page-dots'), { enabled:canChangePage, onSelect:selectPage });
document.querySelectorAll('[data-page-step]').forEach(button => button.addEventListener('click', () => stepPage(Number(button.dataset.pageStep))));
$('card-back').addEventListener('click', backFromCard);
installSwipeDismiss($('card-screen'), {
  isEnabled: () => !$('card-screen').hidden && !$('app-sheet').open && (!guide.active || guide.allowSwipeDismiss),
  onDismiss: backFromCard,
});
let orbPressStart=null;
$('wellness-orb').addEventListener('pointerdown',event=>{orbPressStart={x:event.clientX,y:event.clientY,moved:false};});
$('wellness-orb').addEventListener('pointermove',event=>{if(orbPressStart&&event.buttons)orbPressStart.moved ||= Math.hypot(event.clientX-orbPressStart.x,event.clientY-orbPressStart.y)>12;});
$('wellness-orb').addEventListener('pointercancel',()=>{if(orbPressStart)orbPressStart.moved=true;});
async function enterOrb(event) {
  const moved=event?.type==='click'&&event.detail>0&&orbPressStart?.moved;
  if(guide.activateOrb({detail:event?.detail,repeat:event?.repeat,moved}))return;
  if (transitioning) return;
  transitioning = true;
  const revealEpoch = ++orbTransitionEpoch;
  $('wellness-orb').classList.add('is-entering');
  const reveal = () => {
    if (revealEpoch !== orbTransitionEpoch) return;
    openInsight();
    $('app-sheet').classList.add('water-arrival');
    setTimeout(() => $('app-sheet').classList.remove('water-arrival'), 900);
  };
  try {
    await Promise.all([
      orb.burst ? orb.burst() : Promise.resolve(orb.nudge()),
      waterTransition({ source: $('wellness-orb'), shell: $('app-shell'), reveal }),
    ]);
  } finally {
    transitioning = false;
    orb.restore?.();
    $('wellness-orb').classList.remove('is-entering');
  }
}
$('wellness-orb').addEventListener('click', enterOrb);
$('wellness-orb').addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    enterOrb(event);
  }
});
installPageGestures($('app-workspace'), {
  enabled: canChangePage,
  onSwipe: stepPage,
});

function playAlert() {
  const hour = new Date().getHours();
  const quiet = store.preferences?.quietHours && (hour >= 22 || hour < 8);
  if (!soundEnabled || quiet || store.preferences?.alertsEnabled === false) return;
  try {
    alarmContext ||= new (window.AudioContext || window.webkitAudioContext)();
    alarmContext.resume();
    for (let index = 0; index < 3; index++) {
      const start = alarmContext.currentTime + index * .28;
      const oscillator = alarmContext.createOscillator();
      const volume = alarmContext.createGain();
      oscillator.frequency.value = index === 1 ? 660 : 520;
      oscillator.type = 'sine';
      volume.gain.setValueAtTime(0, start);
      volume.gain.linearRampToValueAtTime(.045, start + .025);
      volume.gain.exponentialRampToValueAtTime(.001, start + .2);
      oscillator.connect(volume).connect(alarmContext.destination);
      oscillator.start(start);
      oscillator.stop(start + .21);
    }
  } catch { /* The visible alert remains available when audio is unsupported. */ }
}

function chooseScenario(scenario) {
  if(!['good','watch','alert'].includes(scenario))return;
  const priorStatus = snapshot.status;
  if(activeAccount.isTest){
    // Selecting TEST scenarios must not turn an authenticated session into the
    // anonymous demo or pause its cloud data. Samples never enter the database.
    demoMode=false;
    snapshot=testScenarios.select(activeAccount,scenario);
    if(!snapshot)return;
  }else{
    demoMode=true;
    snapshot=createSnapshot(scenario,reportedSigns===null?{}:{observedSigns:reportedSigns,observationSource:'owner'});
  }
  refreshCount = 0;
  updateWarningHistory({ emit: true });
  if (snapshot.status !== 'good' && snapshot.status !== priorStatus) {
    alerts.push({
      title: `${states[snapshot.status].label} · simulated alert`,
      date: time.format(new Date(snapshot.updatedAt)),
      detail: `${snapshot.heart} bpm · ${snapshot.temp.toFixed(1)} °C skin · ${number.format(snapshot.steps)} steps · score ${snapshot.score}/100`,
    });
  }
  closeSheet();
  refreshViews();
  showPage(1);
  if (snapshot.status !== 'good' && (activeAccount.isTest || store.preferences?.alertsEnabled !== false)) {
    playAlert();
    openInsight(true);
  }
}

$('demo-button').addEventListener('click', () => {
  if(!demoMode&&!activeAccount.isTest&&!guide.active){openSettings('device');return;}
  openSheet({
    title: activeAccount.isTest?'Test colours & alerts':'Demo',
    body: `<div class="scenario-choices">${[
      ['good', 'Green · Typical', 'Close to usual'],
      ['watch', 'Yellow · Watch', 'Preview a possible-risk alert'],
      ['alert', 'Red · Emergency', 'Preview an urgent alert · simulated signs'],
    ].map(([key, title, subtitle]) => `<button type="button" data-scenario="${key}" class="scenario-choice" aria-pressed="${snapshot.scenario === key}"><span class="scenario-color ${key}">${createSnapshot(key).score}</span><span><strong>${title}</strong><small>${subtitle}</small></span></button>`).join('')}</div>
      ${activeAccount.isTest?`<div class="form-actions"><button type="button" class="button glass" data-scenario-saved ${testScenarios.active(activeAccount)?'':'disabled'}>Return to saved data</button></div>`:''}
      <label class="toggle-line"><span>Alert sound</span><input type="checkbox" id="sound-toggle" ${soundEnabled ? 'checked' : ''}></label>
      <p class="explanation">${activeAccount.isTest?'Temporary previews. Your saved readings stay unchanged. ':'Simulated readings and signs. '}The score compares patterns; emergency signs determine urgent care.</p>`,
    onOpen(dialog) {
      dialog.querySelectorAll('[data-scenario]').forEach(button => button.addEventListener('click', () => chooseScenario(button.dataset.scenario)));
      dialog.querySelector('[data-scenario-saved]')?.addEventListener('click',()=>{closeSheet();exitDemo();showPage(1);});
      dialog.querySelector('#sound-toggle').addEventListener('change', event => { soundEnabled = event.target.checked; });
    },
  });
});

function startDemo() {
  if(activeAccount.isTest){demoMode=false;snapshot=testScenarios.select(activeAccount,'good');refreshViews();return;}
  if(activeAccount.demo!==true&&!demoMode) realContextBeforeDemo={snapshot,reportedSigns};
  demoMode=true; online=true; reportedSigns=null; alerts.length=0;
  snapshot=createSnapshot(); refreshViews();
}
function exitDemo() {
  if(activeAccount.demo===true)return;
  testScenarios.clear();
  demoMode=false; online=deviceState.status==='connected'; reportedSigns=realContextBeforeDemo?.reportedSigns||null; alerts.length=0;
  if(deviceState.status==='demo'){settings.resetConnection?.({notify:false});deviceState={status:'idle'};online=false;}
  snapshot=latestCloudSnapshot?cloudSnapshotWithSigns(latestCloudSnapshot):realContextBeforeDemo?.snapshot||createEmptySnapshot({connected:online,observedSigns:reportedSigns||[]});realContextBeforeDemo=null;
  online=snapshot.connected===true||deviceState.status==='connected';
  if(!hasAnyReadings(snapshot))snapshot=createEmptySnapshot({connected:online,observedSigns:reportedSigns||[]});
  refreshViews();
}

function openInsight(alarm = false) {
  insights.open({ alarm });
}
$('app-sheet').addEventListener('close', () => {
  if (!$('app-sheet').open) guide.notify({type:'sheet-close'});
});

window.addEventListener('pawprint:urgent-signs', event => {
  guide.close(); guideAccount = null;
  // The check-in asks what the owner sees in their pet. Apply that observation
  // to their real state, even if they opened it while exploring sample readings.
  if (testScenarios.active(activeAccount)||!isDemoAccount(activeAccount) && demoMode) exitDemo();
  const triage = assessCurrentHealth(snapshot, event.detail?.signs);
  reportedSigns = triage.emergencySigns;
  snapshot = { ...snapshot, observedSigns: reportedSigns, observationSource: 'owner', triage, status: triage.level };
  updateWarningHistory({ emit: triage.level === 'alert', source: 'owner' });
  if (triage.level === 'alert') {
    alerts.push({ title: 'Emergency signs reported', date: time.format(new Date()), detail: 'Owner check-in · contact an emergency vet now.' });
    playAlert();
  }
  refreshViews();
  closeSheet();
  openInsight(triage.level === 'alert');
});

$('goals-button').addEventListener('click', () => {
  openSheet({
    title: 'Goals',
    body: `<form id="goals-form"><div class="field-grid"><label class="field">Daily steps<input name="steps" type="number" min="1" max="1000000" step="1" value="${store.goals.steps}" required></label><label class="field">Estimated sleep · hours<input name="sleep" type="number" min="0.1" max="24" step="0.1" value="${store.goals.sleep}" required></label></div><div class="form-actions"><button class="button primary" type="submit">Save goals</button></div></form>`,
    onOpen(dialog) {
      dialog.querySelector('form').addEventListener('submit', event => {
        event.preventDefault();
        const form = event.currentTarget;
        const goals = { steps: Number(form.elements.steps.value), sleep: Number(form.elements.sleep.value) };
        if (persist({ ...store, goals })) { closeSheet(); renderData(); toast('Daily goals updated.'); }
      });
    },
  });
});

$('refresh-button').addEventListener('click', async () => {
  if(healthData.getState().authenticated&&!demoMode){
    $('refresh-button').disabled=true;
    const result=await healthData.refresh();
    if(result)toast(testScenarios.active(activeAccount)?'Saved readings refreshed. Scenario preview is still active.':'Latest saved readings loaded.');
    renderData();return;
  }
  if (!online || !demoMode || !hasCurrentReadings(snapshot)) return;
  refreshCount++;
  const next = createSnapshot(snapshot.scenario, reportedSigns === null ? {} : { observedSigns: reportedSigns, observationSource: 'owner' });
  const date = new Date(next.updatedAt);
  date.setMinutes(date.getMinutes() + refreshCount);
  snapshot = { ...next, updatedAt: date.toISOString() };
  updateWarningHistory();
  renderData();
  toast('Demo sample refreshed. Values stay fixed within this scenario.');
});

$('account-button').addEventListener('click', openSettings);

document.addEventListener('visibilitychange', () => { if (document.hidden) companion.deactivate();else if(healthData.getState().authenticated)void healthData.refresh(); });
applyPreferences();
renderHome();
renderData();
showPage(1);

motionPreference.addEventListener('change', () => {
  document.documentElement.dataset.motion = motionPreference.matches ? 'reduced' : 'full';
  orb.setReducedMotion?.(motionPreference.matches);
});
