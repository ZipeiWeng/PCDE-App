import { icon, escapeHTML, formatDate, openSheet, closeSheet, toast } from './ui.js';
import { normalizeBirthday, ageFromBirthday } from './model.js';
import { groupVisitSummaryRecords, isDewormingRecord, isRecordedVaccination, isRecordedParasiteCare, medicalHistoryPreview } from './visit-summary.js';
import { installSwipeDismiss } from './settings-gestures.js';
import { renderDeviceAlerts } from './device-alert-view.js';
import { createLiquidSelection } from './liquid-selection.js';
import { profileAvatarSrc, profilePhotoPatch } from './avatar.js';
import { medicalIcon } from './medical-icons.js';
import { summarizeMonitoring } from './monitoring-summary.js';

const typeNames = {
  visit: 'Vet visit',
  vaccine: 'Vaccination',
  parasite: 'Parasite care',
  medication: 'Medicine',
  observation: 'Observation',
};
const typeIcons = { visit: 'calendar', vaccine: 'plus', parasite: 'paw', medication: 'pill', observation: 'heart' };
const count = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
const isSample = record => Boolean(record.sample || record.demo || record.isDemo);
// Preserve retired entries in storage without presenting them as a supported feature.
const isAvailableRecord = record => record.type !== 'meal';
const byNewest = (a, b) => new Date(b.date) - new Date(a.date);
const cameraIcon = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5 9.5 3h5L16 5h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3Z"/><circle cx="12" cy="12" r="4"/></svg>';
const profileWeight = profile => profile.weight > 0 ? `${count.format(profile.weight)} kg` : 'Weight not recorded';

function medicalMarker(record) {
  if (record.type === 'vaccine' && isRecordedVaccination(isSample(record) ? { ...record, sample:false, demo:false, isDemo:false } : record)) return 'vaccine';
  if (record.type === 'parasite') return 'deworming';
  return null;
}

function recordSymbol(record) {
  const marker = medicalMarker(record);
  const label = marker === 'vaccine' ? 'Recorded vaccination' : isDewormingRecord(record) ? 'Deworming record' : 'Parasite care record';
  return marker ? medicalIcon(marker, {label:`${isSample(record) ? 'Sample · ' : ''}${label}`,recorded:marker === 'vaccine' || isRecordedParasiteCare(record)}) : icon(typeIcons[record.type] || 'clock');
}

function birthdayLabel(value) {
  const birthday = normalizeBirthday(value);
  if (!birthday) return '';
  const [year, month, day] = birthday.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(year, month - 1, day));
}

function localDateValue(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function fullDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

function field(name, label, value = '', { type = 'text', required = false, maxLength = 100, wide = false, extra = '' } = {}) {
  return `<label class="field ${wide ? 'card-full-field' : ''}"><span>${escapeHTML(label)}</span><input class="input" name="${name}" type="${type}" value="${escapeHTML(String(value))}" ${required ? 'required' : ''} maxlength="${maxLength}" ${extra}></label>`;
}

function textArea(name, label, value = '', required = false) {
  return `<label class="field card-full-field"><span>${escapeHTML(label)}</span><textarea class="input" name="${name}" rows="3" maxlength="1600" ${required ? 'required' : ''}>${escapeHTML(value)}</textarea></label>`;
}

function submitFooter(label) {
  return `<p class="card-form-error" role="alert"></p><div class="card-form-actions"><button class="button primary" type="submit">${escapeHTML(label)}</button></div>`;
}

function error(form, message) {
  form.querySelector('.card-form-error').textContent = message;
}

async function compressedPhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) {
    throw new Error('Choose a JPG, PNG or WebP image smaller than 8 MB.');
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/webp', .82);
  } catch {
    throw new Error('This photo could not be opened. Try another image.');
  } finally {
    bitmap?.close();
  }
}

export function initHealthCard(root, { getStore, getSnapshot, getRole, persist, onChange, getAccount = () => null, isOnboarding = () => false }) {
  const liquid=createLiquidSelection(root,[
    {id:'card-tabs',group:'.card-tabs',selected:'[aria-selected="true"]'},
    {id:'card-filter',group:'.card-filter-scroll',selected:'[aria-pressed="true"]'},
    {id:'monitoring-range',group:'.card-monitoring-ranges',selected:'[aria-pressed="true"]'},
  ]);
  let tab = 'overview';
  let filter = 'all';
  let overviewMonitoringRange = '7';
  const summaryDialog = document.getElementById('app-sheet');

  function summaryModule(id, label, body, {total, className = ''} = {}) {
    const open = getStore().healthCardModules?.[id] !== false;
    return `<details class="glass card-summary-module ${className}" data-summary-module="${id}"${open ? ' open' : ''}><summary><h3>${escapeHTML(label)}</h3>${Number.isInteger(total) ? `<span class="card-summary-count">${total}</span>` : ''}${icon('chevron')}</summary><div class="card-summary-module-body">${body}</div></details>`;
  }

  function rememberModuleStates(container) {
    const accountId = getAccount()?.id ?? null;
    for (const details of container.querySelectorAll?.('details') || []) {
      const id = details.dataset.summaryModule;
      if (!id) continue;
      let previous = details.open;
      details.addEventListener('toggle', () => {
        const open = details.open;
        if (open === previous) return;
        previous = open;
        // Ignore detached views, account changes and temporary tour expansion.
        // Copying expands and restores synchronously, leaving the same state.
        if (!details.isConnected || (getAccount()?.id ?? null) !== accountId || isOnboarding()) return;
        const store = getStore();
        if ((store.healthCardModules?.[id] ?? true) === open) return;
        persist({...store, healthCardModules:{...store.healthCardModules, [id]:open}});
      });
    }
  }

  function cardSheet(options) {
    let removeSwipe;
    return openSheet({
      ...options,
      onOpen(dialog) {
        dialog.classList.add('card-sheet');
        removeSwipe = installSwipeDismiss(dialog, {
          directions: ['right'],
          isEnabled: () => dialog.open && dialog.classList.contains('card-sheet'),
          // Use the same return path as X, including nested views and scan cleanup.
          onDismiss: () => document.getElementById('sheet-close').click(),
        });
        options.onOpen?.(dialog);
      },
      onClose() {
        removeSwipe?.();
        summaryDialog.classList.remove('card-sheet', 'card-visit-summary-sheet', 'card-history-sheet');
        options.onClose?.();
      },
    });
  }

  function save(next, message) {
    if (!persist(next)) return false;
    closeSheet();
    onChange();
    toast(message);
    return true;
  }

  function editProfile() {
    const profile = getStore().profile;
    let closed = false;
    cardSheet({
      title: 'Pet profile',
      body: `<form id="card-profile-form"><div class="field-grid">
        ${field('name', 'Name', profile.name, { required: true, maxLength: 28 })}
        ${field('breed', 'Breed', profile.breed, { required: true, maxLength: 70 })}
        ${field('birthday', 'Birthday · optional', profile.birthday || '', { type: 'date', extra: `min="1900-01-01" max="${localDateValue().slice(0, 10)}"` })}
        ${field('age', 'Age · years', profile.age, { type: 'number', required: true, extra: `min="0" max="100" step="0.1" ${profile.birthday ? 'disabled' : ''}` })}
        ${field('weight', 'Weight · kg · optional', profile.weight > 0 ? profile.weight : '', { type: 'number', extra: 'min="0.1" max="300" step="0.1" placeholder="Not recorded"' })}
        <label class="field card-full-field"><span>Sex</span><select class="input" name="sex">${['Male', 'Female', 'Not recorded'].map(sex => `<option ${profile.sex === sex ? 'selected' : ''}>${sex}</option>`).join('')}</select></label>
        <label class="field card-full-field"><span>Profile photo <small>optional</small></span><input class="input" name="photo" type="file" accept="image/jpeg,image/png,image/webp"><small class="muted">JPG, PNG or WebP · up to 8 MB</small></label>
      </div>${submitFooter('Save profile')}</form>`,
      onClose() { closed = true; },
      onOpen(dialog) {
        const form = dialog.querySelector('#card-profile-form');
        form.elements.birthday.addEventListener('input', () => {
          const age = ageFromBirthday(form.elements.birthday.value);
          form.elements.age.disabled = age !== null;
          if (age !== null) form.elements.age.value = age;
        });
        form.addEventListener('submit', async event => {
          event.preventDefault();
          const data = new FormData(form);
          const name = data.get('name').trim();
          const breed = data.get('breed').trim();
          const birthday = normalizeBirthday(data.get('birthday'));
          const age = ageFromBirthday(birthday) ?? Number(data.get('age'));
          const weightInput = data.get('weight').trim();
          const weight = weightInput ? Number(weightInput) : 0;
          if (data.get('birthday') && !birthday) {
            error(form, 'Enter a valid birthday that is not in the future.');
            return;
          }
          if (!name || !breed || !Number.isFinite(age) || age < 0 || age > 100 || !Number.isFinite(weight) || (weightInput && weight < .1) || weight > 300) {
            error(form, 'Enter a name, breed and valid age. Leave an unknown weight blank.');
            return;
          }
          const button = form.querySelector('[type=submit]');
          button.disabled = true;
          error(form, '');
          try {
            const file = data.get('photo');
            const photo = file?.size ? await compressedPhoto(file) : getStore().profile.photo;
            if (closed || !dialog.open || !form.isConnected) return;
            save({ ...getStore(), profile: { ...getStore().profile, name, breed, birthday, age, weight, sex: data.get('sex'), photo, ...(file?.size ? profilePhotoPatch(photo) : {}) } }, 'Pet profile saved.');
          } catch (cause) {
            if (!closed) error(form, cause.message);
          } finally {
            if (!closed) button.disabled = false;
          }
        });
      },
    });
  }

  function editHealthDetails() {
    const store = getStore();
    cardSheet({
      title: 'Health essentials',
      body: `<form id="card-health-form"><div class="field-grid">
        ${textArea('allergies', 'Known allergies', store.allergies)}
        ${textArea('conditions', 'Ongoing conditions', store.conditions)}
      </div><p class="card-form-hint">Include only information you know or have discussed with your vet.</p>${submitFooter('Save essentials')}</form>`,
      onOpen(dialog) {
        const form = dialog.querySelector('#card-health-form');
        form.addEventListener('submit', event => {
          event.preventDefault();
          const data = new FormData(form);
          save({ ...getStore(), allergies: data.get('allergies').trim() || 'None recorded', conditions: data.get('conditions').trim() || 'None recorded' }, 'Health essentials saved.');
        });
      },
    });
  }

  function addRecord() {
    cardSheet({
      title: 'Add a health record',
      body: `<form id="card-record-form"><div class="field-grid">
        <label class="field card-full-field"><span>Record type</span><select class="input" name="type"><option value="observation">Observation</option><option value="visit">Vet visit</option><option value="medication">Medicine</option><option value="vaccine">Vaccination</option><option value="parasite">Parasite care</option></select></label>
        ${field('title', 'Title', '', { required: true, wide: true, maxLength: 100 })}
        ${field('date', 'When it happened', localDateValue(), { type: 'datetime-local', required: true, wide: true })}
        <div class="card-visit-location card-full-field field-grid" hidden>${field('clinic', 'Clinic · optional', '', {wide:true,maxLength:100})}${field('city', 'City · optional', '', {wide:true,maxLength:100})}</div>
        <div class="card-dose-field card-full-field" hidden>${field('dose', 'Amount given', '', { maxLength: 60, extra: 'placeholder="Enter the actual amount"' })}</div>
        ${textArea('details', 'Details', '', true)}
      </div><p class="card-form-hint">Record what happened, when, and anything else you noticed. Saved as an owner-reported entry.</p>${submitFooter('Save record')}</form>`,
      onOpen(dialog) {
        const form = dialog.querySelector('#card-record-form');
        const typeInput = form.elements.type;
        typeInput.addEventListener('change', () => {
          const medicine = typeInput.value === 'medication';
          form.querySelector('.card-dose-field').hidden = !medicine;
          form.elements.dose.required = medicine;
          form.querySelector('.card-visit-location').hidden = typeInput.value !== 'visit';
        });
        form.addEventListener('submit', event => {
          event.preventDefault();
          const data = new FormData(form);
          const title = data.get('title').trim();
          const details = data.get('details').trim();
          const date = new Date(data.get('date'));
          const dose = data.get('dose').trim();
          if (!title || !details || !Number.isFinite(date.valueOf()) || (data.get('type') === 'medication' && !dose)) {
            error(form, 'Complete the title, event time and details. Medicines also need the amount given.');
            return;
          }
          const record = { id: crypto.randomUUID(), type: data.get('type'), title, date: date.toISOString(), details, author: 'Owner' };
          if (record.type === 'medication') record.dose = dose;
          if (record.type === 'visit') { record.clinic = String(data.get('clinic') || '').trim(); record.city = String(data.get('city') || '').trim(); }
          save({ ...getStore(), records: [...getStore().records, record] }, 'Added to the health card.');
        });
      },
    });
  }

  function addVisit() {
    if (getRole() !== 'vet') return;
    const store = getStore();
    cardSheet({
      title: 'Record a consultation',
      eyebrow: 'CLINICIAN WORKSPACE · DEMO',
      body: `<form id="card-visit-form"><p class="card-form-hint card-form-hint-top">This is a local demonstration of clinician entry. Records are labelled “Vet demo”.</p><div class="field-grid">
        ${field('doctor', 'Clinician name', store.doctorName, { required: true, wide: true, maxLength: 80 })}
        ${field('clinic', 'Clinic', store.clinicName, { required: true, wide: true, maxLength: 100 })}
        ${field('city', 'City · optional', '', { wide: true, maxLength: 100 })}
        ${field('date', 'Consultation time', localDateValue(), { type: 'datetime-local', required: true, wide: true })}
        ${field('title', 'Visit title', '', { required: true, wide: true, maxLength: 100 })}
        ${textArea('symptoms', 'Presenting symptoms and history', '', true)}
        ${textArea('diagnosis', 'Clinician assessment', '', true)}
        ${textArea('plan', 'Care plan and follow-up', '', true)}
      </div>${submitFooter('Save consultation')}</form>`,
      onOpen(dialog) {
        const form = dialog.querySelector('#card-visit-form');
        form.addEventListener('submit', event => {
          event.preventDefault();
          if (getRole() !== 'vet') return;
          const data = new FormData(form);
          const values = Object.fromEntries(['doctor', 'clinic', 'title', 'symptoms', 'diagnosis', 'plan'].map(key => [key, data.get(key).trim()]));
          const date = new Date(data.get('date'));
          if (Object.values(values).some(value => !value) || !Number.isFinite(date.valueOf())) {
            error(form, 'Complete each field and choose a valid consultation time.');
            return;
          }
          const record = { id: crypto.randomUUID(), type: 'visit', ...values, city:String(data.get('city') || '').trim(), date: date.toISOString(), details: values.symptoms, author: 'Vet demo' };
          save({ ...getStore(), records: [...getStore().records, record], doctorName: values.doctor, clinicName: values.clinic }, 'Demo consultation added to the timeline.');
        });
      },
    });
  }

  function recordMarkup(record) {
    const title = escapeHTML(record.title || typeNames[record.type] || 'Health record');
    const description = record.symptoms || record.details || record.plan || '';
    const source = record.source === 'scan' ? 'Scanned · owner reviewed' : record.author === 'Vet demo' ? `${record.doctor || 'Clinician'} · Vet demo` : 'Owner';
    return `<button type="button" class="card-record" data-card-record="${escapeHTML(record.id)}">
      <span class="card-record-icon card-record-icon--${escapeHTML(record.type)}${medicalMarker(record) ? ' card-record-icon--medical' : ''}">${recordSymbol(record)}</span>
      <span class="card-record-copy"><span class="card-record-topline"><span>${escapeHTML(typeNames[record.type] || 'Record')}</span>${isSample(record) ? '<span class="card-sample">Sample</span>' : ''}</span><strong>${title}</strong><span class="card-record-description">${escapeHTML(description)}</span><span class="card-record-meta">${escapeHTML(formatDate(record.date))} · ${escapeHTML(source)}</span></span>
      <span class="card-record-chevron" aria-hidden="true">›</span>
    </button>`;
  }

  function showRecord(id, returnState = null) {
    const record = getStore().records.find(item => item.id === id && isAvailableRecord(item));
    if (!record) return;
    const details = [];
    if (record.clinic) details.push(['Clinic', record.clinic]);
    if (record.city) details.push(['City', record.city]);
    if (record.doctor) details.push(['Clinician', record.doctor]);
    if (record.dose) details.push(['Amount recorded', record.dose]);
    if (record.medications) details.push(['Medicines in the record', record.medications]);
    if (record.symptoms) details.push(['Presenting symptoms', record.symptoms]);
    if (record.diagnosis) details.push([record.source === 'scan' ? 'Assessment in the document' : 'Clinician assessment', record.diagnosis]);
    if (record.plan) details.push(['Care plan and follow-up', record.plan]);
    if (record.details && record.details !== record.symptoms) details.push(['Notes', record.details]);
    cardSheet({
      title: record.title || typeNames[record.type],
      eyebrow: `${typeNames[record.type] || 'Health record'}${isSample(record) ? ' · SAMPLE' : ''}`,
      body: `<div class="card-entry-meta"><span>${escapeHTML(fullDate(record.date))}</span><span class="tag">${escapeHTML(record.author || 'Owner')}</span></div><dl class="card-entry-details">${details.map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHTML(value)}</dd></div>`).join('')}</dl>${record.source === 'scan' ? '<p class="card-form-hint">Scanned document, extracted with AI and reviewed by the owner. Check against the original document.</p>' : record.author === 'Vet demo' ? '<p class="card-form-hint">Clinician entry for this prototype. Hospital identity and clinical sign-off are simulated.</p>' : '<p class="card-form-hint">Owner-reported information.</p>'}`,
      onOpen(dialog) { if (returnState) { dialog.classList.add('card-history-sheet'); document.getElementById('sheet-close').setAttribute('aria-label', 'Back to summary card'); } },
      onClose() { if (returnState && !summaryDialog.open) summaryCard(returnState); },
    });
  }

  function monitoringSummary(range = '7', controls = false) {
    const snapshot = getSnapshot();
    const summary = summarizeMonitoring(snapshot.history, {range});
    const readingDay = value => formatDate(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
    const firstDay = summary.count ? readingDay(summary.firstDate) : '';
    const lastDay = summary.count ? readingDay(summary.lastDate) : '';
    const dates = firstDay ? `${firstDay}${firstDay !== lastDay ? ` – ${lastDay}` : ''}` : '';
    const coverage = summary.requestedDays && summary.observedDays < summary.requestedDays ? `${summary.observedDays} of ${summary.requestedDays} days have readings.` : 'Only available readings are included.';
    const metrics = [['heart','Heart rate','bpm'],['temp','Skin temperature','°C'],['steps','Movement','steps'],['sleep','Estimated sleep','h']];
    return `<section class="card-monitoring-summary"><div class="card-section-head"><h3>Monitoring statistics</h3>${snapshot.scenario || snapshot.simulated === true ? '<span class="card-sample">Simulated</span>' : ''}</div>${controls ? `<div class="card-monitoring-ranges" role="group" aria-label="Monitoring period">${[['7','7 days'],['30','30 days'],['all','All records']].map(([value,label]) => `<button type="button" data-monitoring-range="${value}" aria-pressed="${summary.range === value}">${label}</button>`).join('')}</div>` : ''}<div class="card-monitoring-readings" aria-live="polite"><p class="card-monitoring-coverage"><strong>${summary.count} ${summary.count === 1 ? 'reading' : 'readings'}</strong> · ${summary.observedDays} ${summary.observedDays === 1 ? 'recorded day' : 'recorded days'}</p>${dates ? `<p class="card-monitoring-dates">${escapeHTML(dates)}</p>` : '<p class="card-empty">No readings in this period.</p>'}<div class="card-monitoring-metrics">${metrics.map(([key,label,unit]) => { const metric = summary.metrics[key]; return `<div><span>${label}</span><strong>${metric.count ? `${count.format(metric.min)}${metric.min !== metric.max ? `–${count.format(metric.max)}` : ''} <small>${unit}</small>` : 'Not recorded'}</strong>${metric.count !== summary.count ? `<small>${metric.count} readings</small>` : ''}</div>`; }).join('')}</div><small>${coverage} Ranges use recorded values; missing days are not filled in.</small><small>Same-time readings, not complete daily totals.</small></div></section>`;
  }

  const caseFileIcon = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6m-8 3v5m-2.5-2.5h5"/></svg>';

  function medicalHistoryCard(record) {
    const item = medicalHistoryPreview(record);
    return `<button type="button" class="glass card-history-file" data-medical-history="${escapeHTML(record.id)}"><span class="card-history-file-icon">${caseFileIcon}</span><span class="card-history-file-copy"><span class="card-history-date">${escapeHTML(formatDate(record.date))}${isSample(record) ? ' · Sample' : ''}</span><strong>${escapeHTML(item.reason)}</strong><span class="card-history-location">${escapeHTML(item.clinic)}<span>${escapeHTML(item.city)}</span></span></span><span class="card-history-chevron" aria-hidden="true">›</span></button>`;
  }

  function essentialsMarkup(editable = true) {
    const store = getStore();
    return `<div class="card-essential-grid">${[['allergies','Allergies',store.allergies],['conditions','Ongoing conditions',store.conditions]].map(([id,label,value]) => summaryModule(id,label,`<p>${escapeHTML(value || 'Not recorded')}</p>${editable ? `<button type="button" class="card-text-button card-essential-edit" data-card-action="health" aria-label="Edit ${label.toLowerCase()}">${icon('edit')} Edit</button>` : ''}`,{className:'card-summary-essential'})).join('')}</div>`;
  }

  function careSummaryTile(record, type) {
    const marker = medicalMarker(record);
    const provenance = isSample(record) ? 'Sample' : record.source === 'scan' ? 'Scanned · owner reviewed' : record.author === 'Vet demo' ? 'Vet demo' : 'Owner reported';
    const detailValues = [['Notes', record.details], ['Symptoms', record.symptoms], ['Assessment', record.diagnosis], ['Medicines', record.medications], ['Amount recorded', type === 'medication' ? '' : record.dose], ['Clinic', record.clinic], ['City', record.city], ['Clinician', record.doctor], ['Plan', record.plan], ['Source document', record.sourceFilename]].filter(([, value]) => value);
    return `<article class="card-care-tile"><div class="card-care-symbol${marker ? ' is-medical-marker' : ''}">${recordSymbol(record)}</div><h4>${escapeHTML(record.title || typeNames[record.type])}</h4><time datetime="${escapeHTML(record.date)}">${escapeHTML(formatDate(record.date))}</time>${type === 'medication' && record.dose ? `<p class="card-care-dose">${escapeHTML(record.dose)}</p>` : ''}<span class="card-care-source">${provenance}</span>${detailValues.length ? `<details class="card-care-notes"><summary>Details ${icon('chevron')}</summary><dl>${detailValues.map(([label,value]) => `<div><dt>${label}</dt><dd>${escapeHTML(value)}</dd></div>`).join('')}</dl></details>` : ''}</article>`;
  }

  function careSummaryModule(id, label, records, type, empty) {
    return summaryModule(id,label,records.length ? `<div class="card-care-grid">${records.map(record => careSummaryTile(record, type)).join('')}</div>` : `<p class="card-empty">${empty}</p>`,{total:records.length,className:'card-care-module'});
  }

  function summaryMarkup({monitoringRange = '7', editable = false, includeProfile = true} = {}) {
    const store = getStore();
    const groups = groupVisitSummaryRecords(store.records);
    return `<div class="card-visit-summary">${includeProfile ? `<div class="card-summary-pet"><h3>${escapeHTML(store.profile.name)}</h3><p>${escapeHTML(store.profile.breed)} · ${count.format(store.profile.age)} years · ${profileWeight(store.profile)}</p></div>` : ''}${essentialsMarkup(editable)}${careSummaryModule('vaccination','Vaccination', groups.vaccine, 'vaccine', 'No vaccinations recorded.')}${careSummaryModule('parasite','Parasite care', groups.parasite, 'parasite', 'No parasite care recorded.')}${careSummaryModule('medication','Medication history', groups.medication, 'medication', 'No medicines recorded.')}<p class="card-local-note">✓ Recorded vaccination · does not confirm current immunity.</p>${summaryModule('history','Medical history',groups.visit.length ? `<div class="card-history-files">${groups.visit.map(medicalHistoryCard).join('')}</div>` : '<p class="card-empty">No visits recorded.</p>',{total:groups.visit.length,className:'card-medical-history'})}${renderDeviceAlerts(store.deviceAlerts)}<div class="card-monitoring-slot">${monitoringSummary(monitoringRange,true)}</div><p class="card-local-note">Check owner reports and sample entries against the original clinical records.</p><button type="button" class="button primary card-copy-button">Copy summary card</button><p class="card-copy-status small muted" role="status"></p></div>`;
  }

  function summaryCard({scrollTop = 0, openDetails = null, focusRecordId = null, monitoringRange = '7'} = {}) {
    let selectedRange = monitoringRange;
    let monitoringLiquid;
    cardSheet({
      title: 'Summary card',
      body: summaryMarkup({monitoringRange:selectedRange}),
      onClose() { monitoringLiquid?.destroy(); },
      onOpen(dialog) {
        dialog.classList.add('card-visit-summary-sheet');
        const summaryView = dialog.querySelector('.card-visit-summary');
        if (Array.isArray(openDetails)) [...dialog.querySelectorAll('details')].forEach((details,index) => { details.open = openDetails.includes(index); });
        rememberModuleStates(dialog);
        const monitoring = dialog.querySelector('.card-monitoring-slot');
        monitoringLiquid = createLiquidSelection(monitoring,[{id:'monitoring-range',group:'.card-monitoring-ranges',selected:'[aria-pressed="true"]'}]);
        monitoringLiquid.sync({animate:false});
        monitoring.addEventListener('click', event => {
          const button = event.target.closest('[data-monitoring-range]');
          if (!button || !monitoring.contains(button) || !['7','30','all'].includes(button.dataset.monitoringRange) || button.dataset.monitoringRange === selectedRange) return;
          const previousScroll = dialog.scrollTop;
          selectedRange = button.dataset.monitoringRange;
          monitoringLiquid.capture();
          monitoring.innerHTML = monitoringSummary(selectedRange,true);
          monitoringLiquid.sync();
          monitoring.querySelector(`[data-monitoring-range="${selectedRange}"]`)?.focus({preventScroll:true});
          dialog.scrollTop = previousScroll;
        });
        dialog.querySelectorAll('[data-medical-history]').forEach(button => button.addEventListener('click', () => {
          const returnState = {scrollTop:dialog.scrollTop, openDetails:[...dialog.querySelectorAll('details')].flatMap((item,index) => item.open ? [index] : []), focusRecordId:button.dataset.medicalHistory, monitoringRange:selectedRange};
          showRecord(button.dataset.medicalHistory, returnState);
        }));
        requestAnimationFrame(() => {
          if (!dialog.open || !summaryView.isConnected) return;
          if (focusRecordId) [...dialog.querySelectorAll('[data-medical-history]')].find(button => button.dataset.medicalHistory === focusRecordId)?.focus({preventScroll:true});
          dialog.scrollTop = scrollTop;
        });
        dialog.querySelector('.card-copy-button').addEventListener('click', async () => {
          const summary = dialog.querySelector('.card-visit-summary');
          const status = dialog.querySelector('.card-copy-status');
          // Collapsing a section only changes presentation; copying still includes its records.
          const details = [...dialog.querySelectorAll('details')];
          const expanded = details.map(item => item.open);
          let text;
          try {
            details.forEach(item => { item.open = true; });
            text = ['SUMMARY CARD', ...[...summary.children].filter(el => !el.matches('button,.card-copy-status')).map(el => el.innerText)].join('\n\n');
          } finally { details.forEach((item,index) => { item.open = expanded[index]; }); }
          try { await navigator.clipboard.writeText(text); status.textContent = 'Copied.'; }
          catch { status.textContent = 'Copy is unavailable in this browser. You can select the summary text.'; }
        });
      },
    });
  }

  async function copyMainSummary() {
    const summary = root.querySelector('.card-visit-summary');
    const status = root.querySelector('.card-copy-status');
    const details = [...summary.querySelectorAll('details')];
    const expanded = details.map(item => item.open);
    let text;
    try {
      details.forEach(item => { item.open = true; });
      text = ['SUMMARY CARD', root.querySelector('.card-profile-copy').innerText, ...[...summary.children].filter(el => !el.matches('button,.card-copy-status')).map(el => el.innerText)].join('\n\n');
    } finally { details.forEach((item,index) => { item.open = expanded[index]; }); }
    try { await navigator.clipboard.writeText(text); status.textContent = 'Copied.'; }
    catch { status.textContent = 'Copy is unavailable in this browser. You can select the summary text.'; }
  }

  function overviewMarkup() {
    return summaryMarkup({monitoringRange:overviewMonitoringRange, editable:true, includeProfile:false});
  }

  function scanRecords(initialFile = null) {
    let selectedFile = null;
    let controller = null;
    let closed = false;
    cardSheet({
      title: 'Scan a record',
      body: `<div class="card-scan"><div class="card-scan-symbol">${cameraIcon}</div><p class="card-scan-intro">Keep a clinic letter or prescription in the health card.</p><div class="card-scan-choices"><label class="button glass">${cameraIcon} Take photo<input class="card-scan-file" type="file" accept="image/*" capture="environment" data-scan-camera></label><label class="button glass">${icon('plus')} Upload file<input class="card-scan-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" data-scan-upload></label></div><p class="card-scan-selected" role="status">JPG, PNG, WebP or PDF · up to 6 MB</p><img class="card-scan-preview" alt="Selected document" hidden><p class="card-form-hint">Extract details sends this document to OpenAI. AI can miss details; review the result before saving. The original file is not saved in this app.</p><p class="card-form-error" role="alert"></p><button type="button" class="button primary card-scan-extract" disabled>Extract details</button></div>`,
      onClose() { closed = true; controller?.abort(); },
      onOpen(dialog) {
        const selected = dialog.querySelector('.card-scan-selected');
        const preview = dialog.querySelector('.card-scan-preview');
        const status = dialog.querySelector('.card-form-error');
        const extract = dialog.querySelector('.card-scan-extract');
        const isCurrent = () => !closed && dialog.open && extract.isConnected;
        const selectFile = file => {
          if (!file) return;
          selectedFile = null; extract.disabled = true; status.textContent = ''; preview.hidden = true;
          if (!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type) || file.size > 6 * 1024 * 1024) { status.textContent = 'Choose a JPG, PNG, WebP or PDF under 6 MB.'; return; }
          selectedFile = file; selected.textContent = file.name; extract.disabled = false;
          if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = () => { if (!closed && selectedFile === file) { preview.src = reader.result; preview.hidden = false; } };
            reader.readAsDataURL(file);
          }
        };
        dialog.querySelectorAll('.card-scan-file').forEach(input => input.addEventListener('change', () => selectFile(input.files?.[0])));
        if (initialFile) selectFile(initialFile);
        extract.addEventListener('click', async () => {
          if (!isCurrent() || !selectedFile || controller) return;
          const file = selectedFile;
          controller = new AbortController();
          const requestController = controller;
          extract.disabled = true; extract.textContent = 'Reading document…'; status.textContent = '';
          dialog.querySelectorAll('.card-scan-file').forEach(input => { input.disabled = true; });
          const timeout = setTimeout(() => requestController.abort(), 90000);
          try {
            const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('This file could not be read.')); reader.readAsDataURL(file); });
            if (!isCurrent()) return;
            if (requestController.signal.aborted) throw new DOMException('Reading timed out.', 'AbortError');
            const response = await fetch('/api/records/scan', { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json', ...(getAccount()?.isTest ? {'X-Pawprint-Test-Mode':'1'} : {})}, body:JSON.stringify({ dataUrl, mimeType:file.type, filename:file.name }), signal:requestController.signal });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(response.status === 401 ? 'Sign in or use the Mochi test account to scan records.' : result.message || result.error?.message || 'The document could not be read. Try again.');
            if (!result.draft || typeof result.draft !== 'object') throw new Error('No readable record was found. Try a clearer document.');
            if (!isCurrent()) return;
            reviewScan(result.draft, result.warnings, file.name, () => scanRecords(file));
          } catch (cause) {
            if (isCurrent()) status.textContent = cause.name === 'AbortError' ? 'Reading took too long. Please try a smaller or clearer file.' : cause.message;
          } finally {
            clearTimeout(timeout); controller = null;
            if (isCurrent()) { extract.disabled = false; extract.textContent = 'Extract details'; dialog.querySelectorAll('.card-scan-file').forEach(input => { input.disabled = false; }); }
          }
        });
      },
    });
  }

  function reviewScan(draft, warnings, filename, onBack) {
    const value = key => typeof draft[key] === 'string' ? draft[key].slice(0, 1600) : '';
    const recordType = Object.hasOwn(typeNames, value('type')) ? value('type') : 'visit';
    const date = /^\d{4}-\d{2}-\d{2}/.test(value('date')) ? value('date').slice(0,10) : '';
    const notices = Array.isArray(warnings) ? warnings.filter(item => typeof item === 'string').slice(0,4) : [];
    let saved = false;
    cardSheet({
      title: 'Review the record',
      body: `<form id="card-scan-review"><p class="card-form-hint card-form-hint-top">Check the extracted details against your document. Nothing is saved yet.</p>${notices.length ? `<ul class="card-scan-warnings">${notices.map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul>` : ''}<div class="field-grid"><label class="field card-full-field"><span>Record type</span><select class="input" name="type">${Object.entries(typeNames).map(([key,label]) => `<option value="${key}" ${key === recordType ? 'selected' : ''}>${label}</option>`).join('')}</select></label>${field('title','Title',value('title'),{required:true,wide:true,maxLength:100})}${field('date','Date on the document',date,{type:'date',required:true,wide:true})}${field('clinic','Clinic',value('clinic'),{wide:true,maxLength:100})}${field('city','City · optional',value('city'),{wide:true,maxLength:100})}${textArea('symptoms','Symptoms / reason for the visit',value('symptoms'))}${textArea('diagnosis','Assessment written in the document',value('diagnosis'))}${textArea('medications','Medicines and instructions',value('medications'))}${textArea('plan','Treatment / follow-up',value('plan'))}${textArea('details','Other notes',value('details'))}</div><p class="card-form-hint">Saved as an owner-reviewed document, not a new AI diagnosis or verified clinician entry.</p>${submitFooter('Save to health card')}</form>`,
      onClose() { if (!saved && !summaryDialog.open) onBack?.(); },
      onOpen(dialog) {
        document.getElementById('sheet-close').setAttribute('aria-label', 'Back to scan records');
        const form = dialog.querySelector('#card-scan-review');
        form.addEventListener('submit', event => {
          event.preventDefault();
          const data = new FormData(form);
          const title = String(data.get('title') || '').trim();
          const rawDate = String(data.get('date') || '');
          const parsedDate = new Date(`${rawDate}T12:00:00`);
          if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(rawDate) || !Number.isFinite(parsedDate.valueOf())) { error(form,'Enter a title and the correct document date.'); return; }
          const record = { id:crypto.randomUUID(), type:String(data.get('type')), title, date:parsedDate.toISOString(), author:'Owner', source:'scan', sourceFilename:filename };
          ['clinic','city','symptoms','diagnosis','medications','plan','details'].forEach(key => { record[key] = String(data.get(key) || '').trim(); });
          if (!record.details) record.details = record.symptoms || record.diagnosis || record.plan || 'Imported clinical document.';
          saved = true;
          if (save({ ...getStore(), records:[...getStore().records, record] }, 'Document added to the health card.')) { tab = 'timeline'; filter = 'all'; render(); }
          else saved = false;
        });
      },
    });
  }

  function timelineEventMarkup(record) {
    const rawDate=String(record.date||''),hasTime=/[T ]\d{2}:\d{2}/.test(rawDate)&&record.source!=='scan';
    const dateLabel=hasTime?fullDate(rawDate):formatDate(rawDate);
    const dateAttribute=Number.isFinite(new Date(rawDate).valueOf())?` datetime="${escapeHTML(hasTime?rawDate:rawDate.slice(0,10))}"`:'';
    const title=record.title||typeNames[record.type]||'Health record';
    const description=record.symptoms||record.details||record.plan||'';
    const source=isSample(record)?'Sample':record.source==='scan'?'Scanned · owner reviewed':record.author==='Vet demo'?'Vet demo':'Owner';
    return `<li class="card-timeline-item"><button type="button" class="card-timeline-event" data-card-record="${escapeHTML(record.id)}"><span class="card-timeline-marker">${recordSymbol(record)}</span><span class="card-timeline-copy"><span class="card-timeline-date"><time${dateAttribute}>${escapeHTML(dateLabel)}</time><span class="card-timeline-source">${source}</span></span><strong class="card-timeline-title">${escapeHTML(title)}</strong>${description?`<span class="card-timeline-description">${escapeHTML(description)}</span>`:''}</span></button></li>`;
  }

  function timelineMarkup() {
    const filters = [['all', 'All'], ['visit', 'Vet visits'], ['vaccine', 'Vaccines'], ['parasite', 'Parasite care'], ['medication', 'Medicines'], ['observation', 'Observations']];
    const history = getStore().records.filter(isAvailableRecord).sort(byNewest);
    const records = history.filter(record => filter === 'all' || record.type === filter);
    return `<div class="card-filter-scroll" aria-label="Filter health records">${filters.map(([value, label]) => `<button type="button" class="card-filter ${filter === value ? 'is-active' : ''}" aria-pressed="${filter === value}" data-card-filter="${value}">${label}<span class="card-filter-count">${history.filter(record => value === 'all' || record.type === value).length}</span></button>`).join('')}</div>${records.length?`<ol class="card-timeline" aria-label="Health history, newest first">${records.map(timelineEventMarkup).join('')}</ol>`:'<p class="card-empty">No records in this category yet.</p>'}<p class="card-local-note">Entries are saved in this browser. Hospital connections are part of the demo.</p>`;
  }

  function render() {
    liquid.capture();
    const store = getStore();
    const profile = store.profile;
    const vet = getRole() === 'vet';
    root.innerHTML = `<div class="card-content">
      ${vet ? '<p class="card-role-label">Clinician workspace · demo</p>' : ''}
      <section class="glass card-profile"><img class="card-avatar" src="${escapeHTML(profileAvatarSrc(profile, {demo:getAccount()?.demo === true || getAccount()?.isTest === true}))}" alt="${escapeHTML(profile.name)}"><div class="card-profile-copy"><h2>${escapeHTML(profile.name)}</h2><p>${escapeHTML(profile.breed)}</p><div class="card-profile-facts"><span>${count.format(profile.age)} years</span><span>${profileWeight(profile)}</span><span>${escapeHTML(profile.sex || 'Not recorded')}</span>${profile.birthday ? `<span>Born ${birthdayLabel(profile.birthday)}</span>` : ''}</div></div><button type="button" class="card-icon-button" aria-label="Edit pet profile" data-card-action="profile">${icon('edit')}</button></section>
      <div class="card-primary-actions"><button type="button" class="button glass" data-card-action="scan">${cameraIcon}<span>Scan records</span></button><button type="button" class="button glass" data-card-action="${vet ? 'visit' : 'add'}">${icon('plus')}<span>${vet ? 'Consultation' : 'Add record'}</span></button></div>
      <div class="card-toolbar"><div class="card-tabs" role="tablist" aria-label="Health card views"><button type="button" id="card-tab-overview" role="tab" aria-controls="card-tab-content" tabindex="${tab === 'overview' ? '0' : '-1'}" aria-selected="${tab === 'overview'}" data-card-tab="overview">Summary</button><button type="button" id="card-tab-timeline" role="tab" aria-controls="card-tab-content" tabindex="${tab === 'timeline' ? '0' : '-1'}" aria-selected="${tab === 'timeline'}" data-card-tab="timeline">Timeline</button></div></div>
      <div class="card-tab-content" id="card-tab-content" role="tabpanel" aria-labelledby="card-tab-${tab}">${tab === 'overview' ? overviewMarkup() : timelineMarkup()}</div>
      ${vet ? '<button class="card-text-button card-owner-note-button" type="button" data-card-action="add">Add an owner-reported note</button>' : ''}
    </div>`;
    rememberModuleStates(root);
    liquid.sync();
  }

  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !root.contains(button)) return;
    if (button.dataset.cardTab) {
      tab = button.dataset.cardTab;
      render();
      root.querySelector(`[data-card-tab="${tab}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (button.dataset.cardFilter) {
      filter = button.dataset.cardFilter;
      render();
      root.querySelector(`[data-card-filter="${filter}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (button.dataset.cardRecord) {
      showRecord(button.dataset.cardRecord);
      return;
    }
    if (button.dataset.medicalHistory) {
      showRecord(button.dataset.medicalHistory);
      return;
    }
    if (button.dataset.monitoringRange) {
      const range = button.dataset.monitoringRange;
      if (!['7','30','all'].includes(range) || range === overviewMonitoringRange) return;
      overviewMonitoringRange = range;
      const monitoring = root.querySelector('.card-monitoring-slot');
      liquid.capture();
      monitoring.innerHTML = monitoringSummary(range,true);
      liquid.sync();
      monitoring.querySelector(`[data-monitoring-range="${range}"]`)?.focus({preventScroll:true});
      return;
    }
    if (button.classList?.contains('card-copy-button')) {
      copyMainSummary();
      return;
    }
    const action = button.dataset.cardAction;
    if (action === 'profile') editProfile();
    if (action === 'health') editHealthDetails();
    if (action === 'add') addRecord();
    if (action === 'visit') addVisit();
    if (action === 'summary') summaryCard();
    if (action === 'scan') scanRecords();
    if (action === 'visits') { tab = 'timeline'; filter = 'visit'; render(); }
    if (action === 'timeline') { tab = 'timeline'; render(); }
  });

  root.addEventListener('keydown', event => {
    if (!event.target.matches('[data-card-tab]') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    tab = event.key === 'Home' ? 'overview' : event.key === 'End' ? 'timeline' : tab === 'overview' ? 'timeline' : 'overview';
    render();
    root.querySelector(`[data-card-tab="${tab}"]`)?.focus({ preventScroll: true });
  });

  return { render };
}
