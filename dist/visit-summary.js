const supportedTypes = new Set(['visit', 'vaccine', 'parasite', 'medication', 'observation']);
const timeOf = value => {
  const time = new Date(value).valueOf();
  return Number.isFinite(time) ? time : -Infinity;
};

// Keep preventive history independent of the volume of recent notes. A dated
// record is evidence of an entry, not proof of present protection or a schedule.
export function groupVisitSummaryRecords(records = []) {
  const groups = Object.fromEntries([...supportedTypes].map(type => [type, []]));
  for (const record of Array.isArray(records) ? records : []) {
    if (record && supportedTypes.has(record.type)) groups[record.type].push(record);
  }
  for (const values of Object.values(groups)) values.sort((a,b) => timeOf(b.date) - timeOf(a.date));
  return groups;
}

export function isDewormingRecord(record) {
  const text = `${record?.title || ''} ${record?.details || ''}`;
  if (/\b(no|not|never)\s+(?:been\s+)?deworm(?:ed|ing)?\b|\b(?:heartworm|lungworm)\s+(?:test|screen|screening)\b|未驱虫|未做体内驱虫|心丝虫检测/i.test(text)) return false;
  return /\b(deworm(?:ed|ing|er)?|worming|anthelmintic|roundworm|tapeworm|hookworm|whipworm|lungworm|heartworm)\b|体内驱虫|内驱|蛔虫|绦虫|心丝虫/i.test(text);
}

// A check denotes a recorded past vaccination, not verified protection. Generic
// placeholders, demo entries, future appointments and explicit non-administration
// retain a neutral icon.
export function isRecordedVaccination(record, now = Date.now()) {
  if (!record || record.type !== 'vaccine' || record.sample || record.demo || record.isDemo) return false;
  const title = String(record.title || '').trim();
  const time = new Date(record.date).valueOf();
  if (!title || /^(?:vaccination|vaccine)(?: record| entry)?$/i.test(title) || !Number.isFinite(time) || time > now) return false;
  const text = `${title} ${record.details || ''}`;
  if (/\b(scheduled|planned|cancelled|canceled|declined|reminder)\b|未注射|预约|计划|取消/i.test(text) || /\bappointment\b/i.test(title)) return false;
  return !/\b(not (?:yet )?(?:given|administered|vaccinated)|no (?:dose|vaccine) (?:given|administered))\b|未注射|未接种/i.test(`${title} ${record.details || ''}`);
}

export function isRecordedParasiteCare(record, now = Date.now()) {
  if (!record || record.type !== 'parasite') return false;
  const time = new Date(record.date).valueOf();
  const text = `${record.title || ''} ${record.details || ''}`;
  return Number.isFinite(time) && time <= now
    && !/\b(scheduled|planned|cancelled|canceled|declined|reminder|appointment|test|screening)\b|\bnot (?:yet )?(?:given|administered|treated|dewormed)\b|\bno (?:treatment|deworming)\b|未驱虫|未用药|未使用|未给予|预约|计划|取消|检测/i.test(text);
}

export function medicalHistoryPreview(record) {
  const clean = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  const reason = clean(record?.symptoms) || clean(record?.title) || clean(record?.details) || 'Reason not recorded';
  return {
    reason: reason.length > 100 ? `${reason.slice(0, 97).trimEnd()}…` : reason,
    clinic: clean(record?.clinic) || 'Clinic not recorded',
    city: clean(record?.city) || 'City not recorded',
  };
}
