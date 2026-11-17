import { escapeHTML, icon, openSheet, closeSheet } from './ui.js';
import { initVetFinder } from './vet-finder.js';
import { installSwipeDismiss } from './settings-gestures.js';

const evidence = {
  joints: {
    name: 'PDSA · veterinary guidance',
    title: 'Arthritis in dogs',
    url: 'https://www.pdsa.org.uk/pet-help-and-advice/pet-health-hub/conditions/arthritis-in-dogs',
    summary: 'Arthritis can cause stiffness, reduced movement and changes in rest. Excess weight puts more strain on painful joints.',
  },
  discomfort: {
    name: 'AAHA · veterinary guidance',
    title: 'Recognising pain in pets',
    url: 'https://www.aaha.org/resources/whats-wrong-common-pet-pain-signs/',
    summary: 'Restlessness, changed sleep and reluctance to move can be signs of pain. A vet needs to establish the cause.',
  },
  heat: {
    name: 'PDSA · veterinary guidance',
    title: 'Heatstroke in dogs',
    url: 'https://www.pdsa.org.uk/pet-help-and-advice/pet-health-hub/conditions/heatstroke-in-dogs',
    summary: 'Exercise in warm conditions can lead to heatstroke, which can become life-threatening. Wearable skin temperature is not core body temperature.',
  },
  emergency: {
    name: 'University of Sydney · Veterinary Teaching Hospital',
    title: 'Recognising a veterinary emergency',
    url: 'https://www.sydney.edu.au/vet-hospital/emergency/signs-and-symptoms-faqs.html',
    summary: 'Difficulty breathing, collapse, seizures and severe pain or distress require urgent veterinary care.',
  },
};

export const URGENT_SIGNS = [
  { id: 'breathing_difficulty', label: 'Struggling to breathe', detail: 'Laboured breathing at rest, not ordinary panting after play.' },
  { id: 'collapse', label: 'Collapsed or unable to stand', detail: 'Sudden collapse, severe weakness or unresponsiveness.' },
  { id: 'blue_gums', label: 'Blue, grey or very pale gums', detail: 'Especially with weakness or breathing difficulty.' },
  { id: 'seizure', label: 'A seizure now, prolonged or repeated', detail: 'Keep clear of their mouth and contact emergency care.' },
  { id: 'severe_pain', label: 'Severe or sudden pain', detail: 'Extreme distress, a swollen painful belly or serious injury.' },
];
const signIds = new Set(URGENT_SIGNS.map(sign => sign.id));
export function currentUrgentSigns(snapshot = {}) {
  const signs = Array.isArray(snapshot.observedSigns) ? snapshot.observedSigns
    : Array.isArray(snapshot?.triage?.emergencySigns) ? snapshot.triage.emergencySigns : [];
  return [...new Set(signs)].filter(id => signIds.has(id));
}

const metrics = [
  { key: 'heart', name: 'Heart rate', unit: 'bpm', icon: 'heart', digits: 0 },
  { key: 'temp', name: 'Skin temperature', unit: '°C', icon: 'temp', digits: 1 },
  { key: 'steps', name: 'Activity', unit: 'steps', icon: 'steps', digits: 0 },
  { key: 'sleep', name: 'Estimated sleep', unit: 'h', icon: 'moon', digits: 1 },
];
function number(value, digits = 0) {
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: digits });
}
function changes(snapshot) {
  return metrics.filter(metric => Number.isFinite(snapshot?.[metric.key]) && Number.isFinite(snapshot?.baseline?.[metric.key]))
    .map(metric => ({ ...metric, value: snapshot[metric.key], usual: snapshot.baseline[metric.key], difference: snapshot[metric.key] - snapshot.baseline[metric.key] }));
}
function acutePossibilities(signs) {
  const result = [];
  if (signs.includes('breathing_difficulty') || signs.includes('blue_gums')) result.push('An airway or breathing emergency', 'A heart or lung problem');
  if (signs.includes('collapse')) result.push('Shock or a serious circulation problem');
  if (signs.includes('seizure')) result.push('A seizure-related emergency');
  if (signs.includes('severe_pain')) result.push('Severe pain or an acute injury');
  return result.slice(0, 3);
}

export function describeCurrentPattern(snapshot = {}) {
  const readings = changes(snapshot);
  const currentReadings = metrics.filter(metric => Number.isFinite(snapshot[metric.key])).map(metric => ({...metric, value:snapshot[metric.key], usual:null, recordedAt:snapshot.metricUpdatedAt?.[metric.key]}));
  const emergencySigns = currentUrgentSigns(snapshot);
  const requestedStatus = snapshot.triage?.level || snapshot.status;
  // A score cannot make an emergency diagnosis. Explicit urgent signs override
  // even normal or unavailable sensor readings; score-only alerts stay amber.
  const status = emergencySigns.length ? 'alert' : !readings.length ? 'unknown'
    : requestedStatus === 'alert' ? 'watch' : ['good', 'watch'].includes(requestedStatus) ? requestedStatus : 'unknown';
  const base = { status, readings, currentReadings, emergencySigns, possibilities: acutePossibilities(emergencySigns) };
  if (status === 'unknown') return {
    ...base, illustration: 'device', title: currentReadings.length ? 'Latest readings' : snapshot.connected ? 'Waiting for first reading' : 'No readings yet',
    risk: '', outlook: '', relevant: currentReadings, source: null, actions: [],
  };
  const activity = readings.find(item => item.key === 'steps');
  const sleep = readings.find(item => item.key === 'sleep');
  const highActivity = activity && activity.usual > 0 && activity.value > activity.usual * 1.3;
  const lowActivity = activity && activity.usual > 0 && activity.value < activity.usual * .85;
  const changedSleep = sleep && Math.abs(sleep.difference) >= .7;
  if (highActivity) return {
    ...base, illustration: 'heat', title: 'Heat illness risk',
    risk: 'Activity is above usual. If it is warm or humid, extra exertion can increase the risk of heatstroke.',
    outlook: 'Heatstroke can worsen quickly. These readings do not show that it is happening now.',
    relevant: readings.filter(item => ['steps', 'heart', 'temp'].includes(item.key)),
    source: evidence.heat,
    actions: [
      ['Cool down gently', 'Pause in shade, offer water and choose cooler times for walks.'],
      ['Avoid pushing through', 'Skip intense play in heat, especially if they are panting heavily.'],
      ['Check for urgent signs', 'Weakness, collapse or difficulty breathing needs emergency care now.'],
    ],
  };
  if (lowActivity) return {
    ...base, illustration: 'joints', title: 'Possible joint or muscle pain',
    risk: changedSleep
      ? 'Less movement and disrupted rest can occur with pain. Osteoarthritis or a muscle strain are possibilities if you also notice stiffness, limping or reluctance to jump.'
      : 'Reduced movement can occur with joint pain, including osteoarthritis. Look for stiffness, limping or reluctance to jump before drawing conclusions.',
    outlook: 'If arthritis is present, it can worsen over time. Repeated jumping or intense exercise can aggravate painful joints. A quieter routine or device fit can also explain the readings.',
    relevant: readings.filter(item => changedSleep ? ['steps', 'sleep'].includes(item.key) : item.key === 'steps'),
    source: evidence.joints,
    secondarySource: evidence.discomfort,
    actions: [
      ['Keep movement gentle', 'Choose short, comfortable walks. Avoid forced running, repeated jumps and slippery floors if they seem sore.'],
      ['Notice stiffness', 'Watch how they get up after rest. Record limping or reluctance to climb stairs for your vet.'],
      ['Follow up if it persists', 'Arrange a vet check if reduced movement continues or you notice pain. Do not give human painkillers.'],
    ],
  };
  if (changedSleep) return {
    ...base, illustration: 'rest', title: 'Possible pain disrupting rest',
    risk: 'Rest has changed. Pain may be disrupting sleep, especially if they pace, cannot settle or avoid being touched.',
    outlook: 'This does not show that poor sleep will cause a disease. Persistent disrupted rest can be a reason to check for an underlying problem.',
    relevant: readings.filter(item => ['sleep', 'heart'].includes(item.key)),
    source: evidence.discomfort,
    actions: [
      ['Make rest comfortable', 'Offer a quiet, comfortable place and keep their routine predictable.'],
      ['Look for a pattern', 'Note pacing, stiffness, reluctance to move or sensitivity to touch.'],
      ['Ask a vet if it continues', 'Share the changes if rest stays disrupted or your pet seems uncomfortable. Severe pain needs urgent care.'],
    ],
  };
  return {
    ...base, illustration: 'rest', title: 'Check for pain or heat stress',
    risk: 'The current readings differ from usual. Pain, stress or recent exertion are possibilities; these measurements cannot identify a specific disease.',
    outlook: 'Skin warmth cannot confirm a fever. Check the device fit and how your pet looks and behaves.',
    relevant: readings.filter(item => Math.abs(item.difference) > .01).slice(0, 3),
    source: evidence.discomfort,
    actions: [
      ['Let them settle', 'Allow quiet rest in a comfortable, cool space, then recheck the readings.'],
      ['Look beyond the numbers', 'Notice stiffness, restlessness or sensitivity to touch. Note recent exercise or heat exposure.'],
      ['Follow up if it persists', 'Ask your vet about ongoing changes or discomfort. Urgent symptoms need care regardless of the score.'],
    ],
  };
}

function illustration(kind = 'rest') {
  // One familiar silhouette across states, following the rounded, upright-ear
  // reference: long muzzle, gently curved back, four paws and an upturned tail.
  const dog = (resting = false) => `<g class="insight-dog">
    <path class="insight-dog-far-legs" d="M77 114c0 10 0 19-1 26-1 5-8 8-13 12-7 6-3 11 7 12 15 2 24-5 26-15l1-20m56 0c1 7 8 10 6 15-2 5-12 7-11 12 1 7 15 8 24 1 7-5 9-14 7-28"/>
    <path class="insight-dog-body" d="M76 87C60 100 35 97 28 87c-7-10-3-18 7-27 10-9 16-17 17-28 1-12 7-23 14-26 8-4 12 3 10 13l-5 14c8 1 14 4 20 7 12-12 26-18 34-14 12 7-1 21-24 28-1 11 5 21 15 25 17 7 32-6 46-2l17 6c9-7 16-18 20-29 3-7 7-5 9 2 5 12-6 27-12 38 5 16 6 31 4 43 4 10 7 19 2 25-5 6-19 6-23 1-4-5 2-11 6-15l-3-11c-5-3-8-8-9-12-12 4-24 8-36 9v23c1 10-10 15-22 13-9-1-13-7-9-13l6-7v-16c-13-3-25-10-32-17-8-7-10-15-13-23"/>
    ${resting?'<path d="M58 64q4 4 8 0"/>':'<circle cx="61" cy="65" r="2.15" fill="currentColor" stroke="none"/>'}
    <path d="M27 75q-1 5 3 7" stroke-width="3.4"/>
  </g>`;
  const ground = `<ellipse cx="122" cy="177" rx="75" ry="4" fill="currentColor" opacity=".055" stroke="none"/>`;
  const wrap = (label, content, good = false) => `<svg class="insight-illustration insight-illustration-dog${good ? ' insight-illustration-good' : ''}" viewBox="0 0 240 190" role="img" aria-label="${label}">${ground}${content}</svg>`;
  if (kind === 'good') return wrap('A dog with rounded upright ears, four paws and a healthy-status check mark', `${dog()}<circle class="insight-status-disc" cx="213" cy="30" r="15"/><path class="insight-status-mark" d="m206 30 5 5 9-10"/>`, true);
  if (kind === 'joints') return wrap('A dog with its hind-leg joint highlighted', `${dog()}<circle cx="184" cy="124" r="11" fill="currentColor" fill-opacity=".08" stroke-width="1.8"/><circle cx="184" cy="124" r="3" fill="currentColor" stroke="none"/>`);
  if (kind === 'heat') return wrap('A dog with a sun and drinking-water bowl', `<g transform="translate(0 14) scale(.9)">${dog(true)}</g><circle cx="213" cy="35" r="9" fill="currentColor" fill-opacity=".06"/><path d="M213 19v-4m0 40v-4m16-16h4m-40 0h4m27-11 3-3m-28 28 3-3m22 0 3 3m-28-28 3 3" stroke-width="2"/><path class="insight-dog-body" d="M198 156h30l-3 10q-1 4-6 4h-12q-5 0-6-4Z"/><path d="M205 150q8-3 15 0" stroke-width="2"/>`);
  return wrap('A relaxed dog with closed eyes and a rest symbol', `${dog(true)}<path d="M211 18a14 14 0 1 0 17 20 15 15 0 0 1-17-20Z" fill="currentColor" fill-opacity=".06" stroke-width="2"/>`);
}

function readingRows(readings, compact = false) {
  return `<div class="insight-readings${compact ? ' compact' : ''}">${readings.map(item => `<div class="insight-reading"><span>${icon(item.icon)}${escapeHTML(item.name)}</span><div><strong>${number(item.value, item.digits)} <small>${escapeHTML(item.unit)}</small></strong><small>${Number.isFinite(item.usual)?`Usual ${number(item.usual, item.digits)} ${escapeHTML(item.unit)}`:'No baseline yet'}</small>${item.recordedAt&&Number.isFinite(Date.parse(item.recordedAt))?`<small>Recorded ${escapeHTML(new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(item.recordedAt)))}</small>`:''}</div></div>`).join('')}</div>`;
}

function sourceMarkup(source, extra) {
  const links = [source, extra].filter(Boolean).map(item => `<a href="${item.url}" target="_blank" rel="noopener noreferrer">${escapeHTML(item.title)} ${icon('arrow-right')}<small>${escapeHTML(item.name)}</small></a>`).join('');
  return `<details class="insight-evidence" open><summary>Why this matters ${icon('chevron')}</summary><p>${escapeHTML(source.summary)}</p>${links}</details>`;
}
function signMarkup(signs) {
  return `<ul class="insight-observed-signs">${signs.map(id => `<li>${escapeHTML(URGENT_SIGNS.find(sign => sign.id === id).label)}</li>`).join('')}</ul>`;
}
function dataSummary(readings) {
  return readings.map(item => {
    if (item.key === 'temp') return `Skin temperature ${item.difference >= 0 ? '+' : '−'}${number(Math.abs(item.difference), 1)} °C`;
    if (!item.usual) return '';
    const percentage = Math.round(Math.abs(item.difference / item.usual * 100));
    return `${item.name} ${percentage}% ${item.difference >= 0 ? 'above' : 'below'} usual`;
  }).filter(Boolean).join(' · ');
}

function colourLegend(language = 'en') {
  const zh = language === 'zh';
  const items = [
    ['red', zh ? '红色' : 'Red', zh ? '立即求助' : 'Get help now'],
    ['yellow', zh ? '黄色' : 'Yellow', zh ? '关注变化' : 'Check changes'],
    ['green', zh ? '绿色' : 'Green', zh ? '接近平常' : 'Usual pattern'],
  ];
  return `<section class="insight-colour-legend" aria-labelledby="insight-colours-title"><h3 id="insight-colours-title">${zh ? '水球颜色含义' : 'Meaning of Colours'}</h3><ul>${items.map(([colour, name, meaning]) => `<li><span class="insight-colour-orb is-${colour}" aria-hidden="true"></span><span class="sr-only">${name}: </span><strong>${meaning}</strong></li>`).join('')}</ul></section>`;
}

export function initInsights({ getSnapshot, getStore, getAccount = () => null, openCard, onConnect, isTutorial = () => false, canDismiss = () => true, onViewChange = () => {}, onVetViewChange = () => {} }) {
  const vets = initVetFinder({ getAccount, isTutorial, canDismiss, onViewChange: onVetViewChange });
  let removeSwipeDismiss = null;
  function clearClasses() {
    removeSwipeDismiss?.();
    removeSwipeDismiss = null;
    const target = document.getElementById('app-sheet');
    target.classList.remove('insight-detail', 'insight-alert', 'insight-current');
    delete target.dataset.insightStatus;
  }
  function openSignCheck() {
    const snapshot = getSnapshot();
    const selected = new Set(snapshot.observationSource === 'owner' ? currentUrgentSigns(snapshot) : []);
    const demoNote = snapshot.observationSource !== 'owner' && currentUrgentSigns(snapshot).length ? '<p class="insight-sign-demo-note">Report what you see in your pet, not the demo scenario.</p>' : '';
    openSheet({
      title: 'Check urgent signs',
      body: `<form data-urgent-sign-form><p class="insight-sign-intro">Check what you can see now. Any of these signs needs emergency veterinary advice, even with a normal score.</p>${demoNote}<div class="insight-sign-options">${URGENT_SIGNS.map(sign => `<label class="insight-sign-option"><input type="checkbox" name="sign" value="${sign.id}" ${selected.has(sign.id) ? 'checked' : ''}><span><strong>${escapeHTML(sign.label)}</strong><small>${escapeHTML(sign.detail)}</small></span></label>`).join('')}</div><div class="insight-sign-warning" data-sign-warning ${selected.size ? '' : 'hidden'}><strong>Contact a vet now.</strong><p>Do not wait for the app to confirm a diagnosis.</p><button type="button" class="button insight-vet-cta" data-find-vet>Contact nearest vet ${icon('arrow-right')}</button></div><button type="submit" class="button primary insight-sign-save">Update current check ${icon('check')}</button><p class="insight-limit">Your observations guide urgency; they do not establish a diagnosis.</p></form>`,
      onOpen(target) {
        target.classList.add('insight-detail');
        const form = target.querySelector('[data-urgent-sign-form]');
        form.addEventListener('change', () => { target.querySelector('[data-sign-warning]').hidden = !form.querySelector('input:checked'); });
        target.querySelector('[data-find-vet]').addEventListener('click', () => vets.open());
        form.addEventListener('submit', event => {
          event.preventDefault();
          const signs = [...form.querySelectorAll('input:checked')].map(input => input.value).filter(id => signIds.has(id));
          window.dispatchEvent(new CustomEvent('pawprint:urgent-signs', { detail: { signs } }));
        });
      },
      onClose: clearClasses,
    });
  }

  function open({ alarm = false } = {}) {
    const snapshot = getSnapshot();
    const insight = describeCurrentPattern(snapshot);
    const pet = getStore()?.profile?.name || 'your pet';
    const isRed = insight.status === 'alert';
    const isGreen = insight.status === 'good';
    const isUnknown = insight.status === 'unknown';
    if (alarm && (isGreen || isUnknown)) return;
    const simulated = snapshot?.scenario || snapshot?.simulated === true ? 'Simulated data · ' : '';
    let body;
    if (isUnknown) {
      body = `<section class="glass insight-panel insight-empty"><svg class="insight-illustration" viewBox="0 0 220 132" role="img" aria-label="A collar waiting for readings"><rect x="79" y="35" width="62" height="62" rx="17"/><path d="M95 35V16h30v19m-30 62v19h30V97m-22-31h14"/></svg><h3>${snapshot.connected ? 'Waiting for first reading' : 'No readings yet'}</h3><p>${snapshot.connected ? 'Your collar is connected. No measurements have arrived yet.' : 'Connect your collar to start monitoring.'}</p><p class="insight-secondary">No readings means no health score.</p>${onConnect ? `<button class="button primary" data-connect-device>${snapshot.connected ? 'Device settings' : 'Connect collar'} ${icon('arrow-right')}</button>` : ''}</section>`;
      if(insight.currentReadings.length) body = `<section class="glass insight-panel"><h3>Latest readings</h3><p>${simulated?'Simulated test measurements.':'Measurements received from your device.'}</p>${readingRows(insight.currentReadings)}<p class="insight-secondary">A health comparison is not available yet.</p></section>`;
    } else if (isGreen) {
      body = `<section class="glass insight-panel insight-good">${illustration('good')}<h3>Looking good</h3><p>No unusual changes detected.</p><p class="insight-secondary">Keep their usual rest and activity routine. Check symptoms even if the score looks normal.</p></section>`;
    } else if (isRed) {
      const supporting = insight.readings.filter(item => item.key === 'temp' ? Math.abs(item.difference) >= .5 : item.key === 'sleep' ? Math.abs(item.difference) >= .75 : item.usual > 0 && Math.abs(item.difference / item.usual) >= (item.key === 'heart' ? .10 : .20)).slice(0, alarm ? 2 : 4);
      body = `<section class="${alarm ? '' : 'glass '}insight-panel insight-urgent"><div class="insight-alert-symbol" aria-hidden="true">!</div><h3>Emergency signs.<br>Get help now.</h3><p>${escapeHTML(pet)} needs urgent veterinary assessment. These signs can be life-threatening.</p><p class="insight-kicker insight-sign-kicker">${snapshot.observationSource === 'owner' ? 'Reported' : snapshot?.scenario ? 'Simulated' : 'Reported'} signs</p>${signMarkup(insight.emergencySigns)}<button class="button insight-vet-cta" data-find-vet>Contact nearest vet ${icon('arrow-right')}</button>${alarm ? '' : `<div class="insight-possibilities"><strong>Possible causes to rule out</strong><ul>${insight.possibilities.map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul><p>A vet must assess the cause. Do not wait for a diagnosis in the app.</p></div>`}${supporting.length ? `<p class="insight-kicker insight-supporting-title">Sensor changes · signs determine urgency</p>${readingRows(supporting, true)}` : `<p class="insight-secondary">${insight.readings.length ? 'No major sensor changes.' : 'No sensor readings available.'} These signs still need urgent assessment.</p>`}<a class="insight-source-link" href="${evidence.emergency.url}" target="_blank" rel="noopener noreferrer">Emergency guidance · University of Sydney ${icon('arrow-right')}</a>${alarm ? '<button class="text-button insight-more" data-insight-details>View current details</button>' : ''}</section>`;
    } else if (alarm) {
      body = `<section class="insight-panel insight-checkin"><div class="insight-watch-symbol" aria-hidden="true">${icon('heart')}</div><h3>${escapeHTML(insight.title)}</h3><p>${escapeHTML(insight.risk)}</p><button class="button primary insight-more-button" data-insight-details>See the pattern & advice ${icon('arrow-right')}</button></section>`;
    } else {
      body = `<div class="insight-panels"><section class="glass insight-panel insight-risk">${illustration(insight.illustration)}<p class="insight-kicker">Potential risk · keep an eye on it</p><h3>${escapeHTML(insight.title)}</h3><p>${escapeHTML(insight.risk)}</p><p class="insight-outlook">${escapeHTML(insight.outlook)}</p><div class="insight-data-summary"><strong>What changed</strong><p>${escapeHTML(dataSummary(insight.relevant))}</p></div>${readingRows(insight.relevant)}${sourceMarkup(insight.source, insight.secondarySource)}</section><section class="glass insight-panel insight-actions"><h3>What to do next</h3><ol>${insight.actions.map(([title, detail]) => `<li><strong>${escapeHTML(title)}</strong><p>${escapeHTML(detail)}</p></li>`).join('')}</ol><button class="text-button" data-open-card>View health card ${icon('arrow-right')}</button></section></div>`;
    }
    if (!alarm) {
      body += '<button class="text-button insight-check-signs" data-check-signs>Check urgent signs</button>';
      body += colourLegend(getStore()?.preferences?.language);
    }
    body += `<p class="insight-limit">${simulated}Guidance, not a diagnosis or a validated disease prediction. AI and estimates can be wrong.</p>`;
    const dialog = openSheet({
      title: alarm ? 'Health alert' : 'Current health',
      body,
      onOpen(target) {
        target.classList.add(alarm ? 'insight-alert' : 'insight-detail');
        target.dataset.insightStatus = insight.status;
        if (!alarm) {
          target.classList.add('insight-current');
          removeSwipeDismiss = installSwipeDismiss(target, {
            directions: ['left', 'right'],
            isEnabled: () => target.open && target.classList.contains('insight-current') && canDismiss(),
            onDismiss: closeSheet,
          });
        }
        target.querySelectorAll('[data-find-vet]').forEach(button => button.addEventListener('click', () => vets.open()));
        target.querySelectorAll('[data-insight-details]').forEach(button => button.addEventListener('click', () => open()));
        target.querySelectorAll('[data-open-card]').forEach(button => button.addEventListener('click', () => { closeSheet(); openCard?.(); }));
        target.querySelectorAll('[data-check-signs]').forEach(button => button.addEventListener('click', openSignCheck));
        target.querySelectorAll('[data-connect-device]').forEach(button => button.addEventListener('click', () => { closeSheet(); onConnect?.(); }));
      },
      onClose: clearClasses,
    });
    dialog.querySelector('#sheet-close')?.setAttribute('aria-label', 'Close current health');
    onViewChange({ alarm, status: insight.status });
  }
  return { open, openSignCheck, openVets: () => vets.open(), openClinicRequest: () => vets.openRoutine(), useVetExample: () => vets.useExample() };
}
