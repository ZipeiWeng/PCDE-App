// Owner-scoped health storage and independent, revocable hardware credentials.
// Schema is deployed through drizzle migrations, never created by public requests.
const HEALTH_DAY = 86400000;
const HEALTH_TOKEN_TTL = 180 * HEALTH_DAY;
const HEALTH_FRESH_MS = 15 * 60000;
const HEALTH_PROFILE_BYTES = 256 * 1024;
const healthEncoder = new TextEncoder();

class HealthDataError extends Error {
  constructor(status, code, message, extra = {}, headers = {}) {
    super(message); this.status = status; this.code = code; this.extra = extra; this.headers = headers;
  }
}
const healthJSON = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers},
});
const healthObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const healthISO = value => value === null || value === undefined ? null : new Date(value).toISOString();
const healthTime = now => typeof now === 'function' ? now() : Number.isFinite(now) ? now : Date.now();
function healthRandom(prefix = '') {
  return prefix + [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2,'0')).join('');
}
async function healthHash(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',healthEncoder.encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
function healthStorage(env) {
  if (!env.AUTH_DB?.prepare || !env.AUTH_DB?.batch) throw new HealthDataError(503,'storage_unavailable','Health storage is temporarily unavailable.');
  return env.AUTH_DB;
}
function healthOrigin(request) {
  if (request.headers.get('origin') !== new URL(request.url).origin || ['cross-site','none'].includes(request.headers.get('sec-fetch-site'))) {
    throw new HealthDataError(403,'origin_not_allowed','Open this action from the Pawprint app.');
  }
}
function healthKeys(value, allowed, label = 'request') {
  if (!healthObject(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new HealthDataError(400,'invalid_input',`The ${label} contains unsupported fields.`);
}
function healthText(value, max, label, min = 0) {
  if (typeof value !== 'string' || value.length > max || value.trim().length < min || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new HealthDataError(400,'invalid_input',`Enter a valid ${label}.`);
  }
  return value.trim();
}
function healthNumber(value, min, max, label, integer = false) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new HealthDataError(400,'invalid_input',`Enter a valid ${label}.`);
  }
  return value;
}
async function healthBody(request, max = 4096) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw new HealthDataError(415,'json_required','Send this request as JSON.');
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > max)) throw new HealthDataError(413,'payload_too_large','This request is too large.');
  const reader = request.body?.getReader(), chunks = []; let size = 0;
  if (reader) {
    try {
      while (true) {
        const {done,value} = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > max) { await reader.cancel(); throw new HealthDataError(413,'payload_too_large','This request is too large.'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  try {
    const body = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if (!healthObject(body)) throw new Error();
    return body;
  } catch { throw new HealthDataError(400,'invalid_json','Send a valid JSON object.'); }
}
async function healthPrincipal(request, env, getAccountId, now) {
  const id = await getAccountId(request,env,now);
  if (!id || typeof id !== 'string' || id.length > 200) return null;
  const db = healthStorage(env);
  // Resolve an actual account/session again: client IDs and a test_ prefix do
  // not grant access, nor does a platform identity by itself own Pawprint data.
  const account = await db.prepare('SELECT id,username,pet_name,pet_birthday,pet_sex FROM auth_accounts WHERE id=?').bind(id).first();
  if (account) return {...account,isTest:false};
  const test = await db.prepare('SELECT id,expires_at FROM auth_test_sessions WHERE id=? AND expires_at>?').bind(id,now).first();
  return test ? {...test,username:'mochi_test',pet_name:'Mochi',pet_birthday:'2023-03-17',pet_sex:'female',isTest:true} : null;
}
function healthAge(birthday, now) {
  if (!birthday) return null;
  const current = new Date(now), born = new Date(`${birthday}T00:00:00Z`);
  return current.getUTCFullYear()-born.getUTCFullYear()-(current.getUTCMonth()<born.getUTCMonth() || (current.getUTCMonth()===born.getUTCMonth() && current.getUTCDate()<born.getUTCDate()) ? 1 : 0);
}
async function healthPet(db, principal, now) {
  let pet = await db.prepare('SELECT * FROM health_pets WHERE owner_id=?').bind(principal.id).first();
  if (pet) return pet;
  const profile = {name:principal.pet_name || 'Your pet',breed:principal.isTest?'Golden retriever':'Not recorded',birthday:principal.pet_birthday || '',age:healthAge(principal.pet_birthday,now),weight:principal.isTest?28.5:null,sex:principal.pet_sex==='female'?'Female':principal.pet_sex==='male'?'Male':'Not recorded'};
  await db.prepare(`INSERT INTO health_pets (id,owner_id,profile_json,goals_json,owner_name,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(owner_id) DO NOTHING`).bind(healthRandom('pet_'),principal.id,JSON.stringify(profile),JSON.stringify({steps:8000,sleep:10}),principal.username || '',now,now).run();
  return db.prepare('SELECT * FROM health_pets WHERE owner_id=?').bind(principal.id).first();
}
async function healthPublicPet(db, pet) {
  const rows = await db.prepare('SELECT payload_json FROM health_care_records WHERE pet_id=? AND owner_id=? ORDER BY sort_order,id').bind(pet.id,pet.owner_id).all();
  return {id:pet.id,revision:pet.revision,initialized:pet.initialized===1,profile:JSON.parse(pet.profile_json),goals:JSON.parse(pet.goals_json),allergies:pet.allergies,conditions:pet.conditions,ownerName:pet.owner_name,doctorName:pet.doctor_name,clinicName:pet.clinic_name,records:rows.results.map(row=>JSON.parse(row.payload_json))};
}
function healthPublicDevice(row, now) {
  const status = row.revoked_at !== null ? 'revoked' : row.token_expires_at <= now ? 'stale' : row.last_seen_at === null ? 'waiting' : row.last_seen_at >= now-HEALTH_FRESH_MS ? 'connected' : 'stale';
  return {id:row.id,label:row.label,source:row.source,provisioned:Boolean(row.token_hash),status,lastSeenAt:healthISO(row.last_seen_at),revokedAt:healthISO(row.revoked_at),expiresAt:healthISO(row.token_expires_at),createdAt:healthISO(row.created_at)};
}
async function healthDevices(db, pet, now) {
  const rows = await db.prepare('SELECT * FROM health_devices WHERE pet_id=? AND owner_id=? ORDER BY created_at DESC,id').bind(pet.id,pet.owner_id).all();
  return rows.results.map(row=>healthPublicDevice(row,now));
}
async function healthSnapshot(db, pet, devices, now) {
  const today = Math.floor(now/HEALTH_DAY)*HEALTH_DAY, start = today-6*HEALTH_DAY, ceiling = now+5*60000;
  const latest = await db.prepare('SELECT recorded_at,source FROM health_readings WHERE pet_id=? AND owner_id=? AND recorded_at<=? ORDER BY recorded_at DESC,received_at DESC,rowid DESC LIMIT 1').bind(pet.id,pet.owner_id,ceiling).first();
  const metrics = [['heart','heart_bpm'],['temp','skin_temperature_c'],['steps','steps_today'],['sleep','sleep_hours_today']];
  const values = {}, metricUpdatedAt = {};
  for (const [key,column] of metrics) {
    // SQL identifiers come only from this fixed list. Daily counters never
    // become today's values simply because yesterday is less than 24h ago.
    const from = ['steps','sleep'].includes(key) ? today : now-HEALTH_DAY;
    const row = await db.prepare(`SELECT ${column} AS value,recorded_at FROM health_readings WHERE pet_id=? AND owner_id=? AND recorded_at>=? AND recorded_at<=? AND ${column} IS NOT NULL ORDER BY recorded_at DESC,received_at DESC,rowid DESC LIMIT 1`).bind(pet.id,pet.owner_id,from,ceiling).first();
    values[key] = row?.value ?? null; metricUpdatedAt[key] = healthISO(row?.recorded_at);
  }
  const history = await db.prepare(`WITH recent AS (
      SELECT rowid AS arrival_order,*,strftime('%Y-%m-%d',recorded_at/1000,'unixepoch') AS day FROM health_readings
      WHERE pet_id=? AND owner_id=? AND recorded_at>=? AND recorded_at<=?
    ), ranked AS (
      SELECT *,ROW_NUMBER() OVER (PARTITION BY day ORDER BY (steps_today IS NULL),recorded_at DESC,received_at DESC,arrival_order DESC) AS step_rank,
      ROW_NUMBER() OVER (PARTITION BY day ORDER BY (sleep_hours_today IS NULL),recorded_at DESC,received_at DESC,arrival_order DESC) AS sleep_rank FROM recent
    ) SELECT day AS date,ROUND(AVG(heart_bpm),2) AS heart,ROUND(AVG(skin_temperature_c),2) AS temp,
      MAX(CASE WHEN step_rank=1 THEN steps_today END) AS steps,MAX(CASE WHEN sleep_rank=1 THEN sleep_hours_today END) AS sleep
      FROM ranked GROUP BY day ORDER BY day`).bind(pet.id,pet.owner_id,start,ceiling).all();
  const count = Object.values(values).filter(value=>value!==null).length;
  const source = latest?.source || 'unavailable';
  return {scenario:null,...values,availability:count===4?'available':count?'partial':'unavailable',source,simulated:source==='test',connected:devices.some(device=>device.status==='connected'),stale:Boolean(latest && latest.recorded_at<now-HEALTH_FRESH_MS),updatedAt:healthISO(latest?.recorded_at),metricUpdatedAt,dayTimezone:'UTC',history:history.results,segments:[],baseline:{},deviations:[],score:null,status:'unknown',observedSigns:[],observationSource:'unavailable',triage:{level:'unknown',emergencySigns:[],reasons:[count?'baseline_unavailable':'incomplete_readings'],assessedAt:new Date(now).toISOString(),provenance:source==='test'?'simulated database readings':source==='device'?'device-reported, not clinically validated':'no measurements available'}};
}
async function healthBootstrap(db, principal, now) {
  const pet = await healthPet(db,principal,now);
  await healthEnsureExampleReadings(db,principal,pet,now);
  const devices = await healthDevices(db,pet,now);
  return {pet:await healthPublicPet(db,pet),devices,snapshot:await healthSnapshot(db,pet,devices,now)};
}

// This lookup is used by AI to obtain authoritative account-scoped provenance.
// Missing session/storage means no stored context; genuine DB failures propagate.
export async function loadHealthContext(request, env = {}, {getAccountId=async()=>null,now=Date.now} = {}) {
  if (!env.AUTH_DB?.prepare) return null;
  const time = healthTime(now), principal = await healthPrincipal(request,env,getAccountId,time);
  if (!principal) return null;
  return healthBootstrap(healthStorage(env),principal,time);
}

function healthProfileInput(body, principal, now) {
  healthKeys(body,['revision','profile','goals','allergies','conditions','ownerName','doctorName','clinicName','records']);
  if (!Number.isSafeInteger(body.revision) || body.revision<0) throw new HealthDataError(400,'invalid_input','Provide the current pet revision.');
  healthKeys(body.profile,['name','breed','birthday','age','weight','sex'],'profile');
  const p = body.profile;
  const birthday = healthText(p.birthday ?? '',10,'birthday');
  if (birthday && (!/^\d{4}-\d{2}-\d{2}$/.test(birthday) || !Number.isFinite(Date.parse(`${birthday}T00:00:00Z`)) || new Date(`${birthday}T00:00:00Z`).toISOString().slice(0,10)!==birthday || birthday<'1900-01-01' || birthday>new Date(now).toISOString().slice(0,10))) throw new HealthDataError(400,'invalid_input','Enter a valid past birthday.');
  const sex = healthText(p.sex ?? 'Not recorded',20,'sex');
  if (!['Male','Female','Not recorded','male','female','unknown'].includes(sex)) throw new HealthDataError(400,'invalid_input','Choose a valid sex.');
  const profile = {name:healthText(p.name,60,'pet name',1),breed:healthText(p.breed ?? '',100,'breed'),birthday,age:birthday?healthAge(birthday,now):healthNumber(p.age,0,150,'age'),weight:healthNumber(p.weight,0,300,'weight'),sex};
  healthKeys(body.goals,['steps','sleep'],'goals');
  const goals = {steps:healthNumber(body.goals.steps,1,1000000,'step goal',true),sleep:healthNumber(body.goals.sleep,0.1,24,'sleep goal')};
  if (Object.values(goals).some(value=>value===null)) throw new HealthDataError(400,'invalid_input','Provide both daily goals.');
  if (!Array.isArray(body.records) || body.records.length>200) throw new HealthDataError(400,'invalid_input','A pet can store up to 200 care records.');
  const ids = new Set();
  const records = body.records.map(record=>{
    healthKeys(record,['id','type','title','date','details','author','sample','demo','clinic','doctor','dose','symptoms','diagnosis','plan','medications','sourceFilename','city','source'],'care record');
    const id = healthText(record.id,128,'record ID',1);
    if (ids.has(id)) throw new HealthDataError(400,'invalid_input','Care record IDs must be unique.');
    ids.add(id);
    if (!['visit','vaccine','parasite','medication','observation','meal'].includes(record.type)) throw new HealthDataError(400,'invalid_input','Choose a supported care record type.');
    const date = healthText(record.date,40,'record date',1);
    if (!Number.isFinite(Date.parse(date))) throw new HealthDataError(400,'invalid_input','Choose a valid care record date.');
    const result = {id,type:record.type,title:healthText(record.title,300,'record title',1),date,details:healthText(record.details ?? '',5000,'record notes'),author:principal.isTest && record.author==='Vet demo'?'Vet demo':'Owner'};
    if (principal.isTest || record.sample===true || record.demo===true) result.sample=true;
    for (const key of ['clinic','doctor','dose','symptoms','diagnosis','plan','medications','sourceFilename','city']) if (record[key]!==undefined) result[key]=healthText(record[key],['symptoms','diagnosis','plan','medications'].includes(key)?5000:key==='city'?160:300,key);
    if (record.source!==undefined) { if(record.source!=='scan')throw new HealthDataError(400,'invalid_input','Unsupported record source.'); result.source='scan'; }
    return result;
  });
  return {revision:body.revision,profile,goals,records,allergies:healthText(body.allergies??'',5000,'allergies'),conditions:healthText(body.conditions??'',5000,'conditions'),ownerName:healthText(body.ownerName??'',120,'owner name'),doctorName:healthText(body.doctorName??'',120,'doctor name'),clinicName:healthText(body.clinicName??'',160,'clinic name')};
}
async function healthSavePet(db, principal, body, now) {
  const input = healthProfileInput(body,principal,now), pet = await healthPet(db,principal,now), writeId=healthRandom();
  const guard = 'EXISTS (SELECT 1 FROM health_pets WHERE id=? AND owner_id=? AND write_id=?)';
  const statements = [db.prepare(`UPDATE health_pets SET profile_json=?,goals_json=?,allergies=?,conditions=?,owner_name=?,doctor_name=?,clinic_name=?,revision=revision+1,initialized=1,write_id=?,updated_at=? WHERE id=? AND owner_id=? AND revision=?`).bind(JSON.stringify(input.profile),JSON.stringify(input.goals),input.allergies,input.conditions,input.ownerName,input.doctorName,input.clinicName,writeId,now,pet.id,principal.id,input.revision),
    db.prepare(`DELETE FROM health_care_records WHERE pet_id=? AND owner_id=? AND ${guard}`).bind(pet.id,principal.id,pet.id,principal.id,writeId)];
  for (const [index,record] of input.records.entries()) statements.push(db.prepare(`INSERT INTO health_care_records (pet_id,owner_id,id,sort_order,payload_json) SELECT ?,?,?,?,? WHERE ${guard}`).bind(pet.id,principal.id,record.id,index,JSON.stringify(record),pet.id,principal.id,writeId));
  const result = await db.batch(statements);
  if (!result[0]?.meta?.changes) {
    const current = await db.prepare('SELECT revision FROM health_pets WHERE id=? AND owner_id=?').bind(pet.id,principal.id).first();
    throw new HealthDataError(409,'revision_conflict','This pet changed on another device. Reload before saving.',{revision:current?.revision ?? null});
  }
  const bootstrap = await healthBootstrap(db,principal,now);
  // A different client can commit between our transaction and this refresh.
  // Return the revision/content we actually wrote so a queued local edit must
  // still conflict with that subsequent writer instead of inheriting its token.
  bootstrap.pet = {id:pet.id,...input,revision:input.revision+1,initialized:true};
  return bootstrap;
}
async function healthLimit(db, key, maximum, now) {
  const row = await db.prepare(`INSERT INTO health_rate_limits (bucket_key,count,expires_at) VALUES (?,1,?)
    ON CONFLICT(bucket_key) DO UPDATE SET count=CASE WHEN health_rate_limits.expires_at<=? THEN 1 ELSE health_rate_limits.count+1 END,
    expires_at=CASE WHEN health_rate_limits.expires_at<=? THEN excluded.expires_at ELSE health_rate_limits.expires_at END RETURNING count,expires_at`).bind(key,now+60000,now,now).first();
  if (row.count>maximum) throw new HealthDataError(429,'rate_limited','Too many requests. Try again shortly.',{}, {'Retry-After':String(Math.max(1,Math.ceil((row.expires_at-now)/1000)))});
}
async function healthCreateDevice(request, db, principal, body, now) {
  healthKeys(body,['label']);
  const label = healthText(body.label,80,'device label',1), pet = await healthPet(db,principal,now);
  const token = healthRandom('pp_dev_'), id=healthRandom('dvc_'), hash=await healthHash(token), expiry=Math.min(now+HEALTH_TOKEN_TTL,principal.isTest?principal.expires_at:Infinity);
  // Enforce the cap in the same INSERT so concurrent provisioning cannot race.
  const inserted = await db.prepare(`INSERT INTO health_devices (id,pet_id,owner_id,label,source,token_hash,token_expires_at,created_at)
    SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM health_devices WHERE owner_id=? AND revoked_at IS NULL AND token_expires_at>?)<10`).bind(id,pet.id,principal.id,label,principal.isTest?'test':'device',hash,expiry,now,principal.id,now).run();
  if (!inserted.meta?.changes) throw new HealthDataError(409,'device_limit','Revoke an unused device before adding another.');
  const row = await db.prepare('SELECT * FROM health_devices WHERE id=? AND owner_id=?').bind(id,principal.id).first();
  return {device:healthPublicDevice(row,now),uploadToken:token,uploadUrl:new URL('/api/v1/telemetry',request.url).href};
}
async function healthRevokeDevice(db, principal, id, now) {
  const row = await db.prepare('SELECT * FROM health_devices WHERE id=? AND owner_id=?').bind(id,principal.id).first();
  if (!row) throw new HealthDataError(404,'device_not_found','This device was not found.');
  await db.prepare('UPDATE health_devices SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND owner_id=?').bind(now,id,principal.id).run();
  return {device:healthPublicDevice({...row,revoked_at:row.revoked_at ?? now},now)};
}
function healthTelemetry(body, now) {
  healthKeys(body,['sampleId','recordedAt','heartBpm','skinTemperatureC','stepsToday','estimatedSleepHoursToday']);
  if (typeof body.sampleId!=='string' || !/^[A-Za-z0-9._:-]{1,96}$/.test(body.sampleId)) throw new HealthDataError(400,'invalid_input','Use a stable sampleId of 1–96 letters, digits, periods, underscores, colons or hyphens.');
  const recordedAt = body.recordedAt;
  if (typeof recordedAt!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(recordedAt)) throw new HealthDataError(400,'invalid_timestamp','recordedAt must be an ISO 8601 UTC timestamp.');
  const recorded = Date.parse(recordedAt);
  if (!Number.isFinite(recorded) || new Date(recorded).toISOString().slice(0,19)!==recordedAt.slice(0,19) || recorded<now-30*HEALTH_DAY || recorded>now+5*60000) throw new HealthDataError(400,'invalid_timestamp','recordedAt must be within the past 30 days and at most 5 minutes ahead.');
  const values = {heartBpm:healthNumber(body.heartBpm,0,400,'heartBpm'),skinTemperatureC:healthNumber(body.skinTemperatureC,-20,60,'skinTemperatureC'),stepsToday:healthNumber(body.stepsToday,0,1000000,'stepsToday',true),estimatedSleepHoursToday:healthNumber(body.estimatedSleepHoursToday,0,24,'estimatedSleepHoursToday')};
  if (Object.values(values).every(value=>value===null)) throw new HealthDataError(400,'invalid_input','Provide at least one measured value.');
  return {sampleId:body.sampleId,recordedAt:new Date(recorded).toISOString(),...values};
}
async function healthIngest(request, db, now) {
  const authorization=request.headers.get('authorization') || '';
  const denied=()=>new HealthDataError(401,'device_authentication_required','A valid device upload credential is required.');
  if (!/^Bearer pp_dev_[a-f0-9]{64}$/.test(authorization)) throw denied();
  const hash=await healthHash(authorization.slice(7));
  const device=await db.prepare(`SELECT d.* FROM health_devices d WHERE d.token_hash=? AND d.revoked_at IS NULL AND d.token_expires_at>?
    AND ((d.source='device' AND EXISTS(SELECT 1 FROM auth_accounts a WHERE a.id=d.owner_id))
      OR (d.source='test' AND EXISTS(SELECT 1 FROM auth_test_sessions t WHERE t.id=d.owner_id AND t.expires_at>?)))`).bind(hash,now,now).first();
  if (!device) throw denied();
  await healthLimit(db,`device:${device.id}`,120,now);
  const input=healthTelemetry(await healthBody(request),now), payloadHash=await healthHash(JSON.stringify(input));
  const readingId=healthRandom('reading_');
  const results=await db.batch([
    db.prepare(`INSERT INTO health_readings (id,device_id,pet_id,owner_id,sample_id,payload_hash,recorded_at,received_at,heart_bpm,skin_temperature_c,steps_today,sleep_hours_today,source)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM health_devices d WHERE d.id=? AND d.token_hash=? AND d.revoked_at IS NULL AND d.token_expires_at>?
        AND ((d.source='device' AND EXISTS(SELECT 1 FROM auth_accounts a WHERE a.id=d.owner_id))
          OR (d.source='test' AND EXISTS(SELECT 1 FROM auth_test_sessions t WHERE t.id=d.owner_id AND t.expires_at>?))))
      ON CONFLICT(device_id,sample_id) DO NOTHING`).bind(readingId,device.id,device.pet_id,device.owner_id,input.sampleId,payloadHash,Date.parse(input.recordedAt),now,input.heartBpm,input.skinTemperatureC,input.stepsToday,input.estimatedSleepHoursToday,device.source,device.id,hash,now,now),
    db.prepare(`UPDATE health_devices SET last_seen_at=MAX(COALESCE(last_seen_at,0),?) WHERE id=? AND token_hash=? AND revoked_at IS NULL AND token_expires_at>?
      AND ((source='device' AND EXISTS(SELECT 1 FROM auth_accounts a WHERE a.id=health_devices.owner_id))
        OR (source='test' AND EXISTS(SELECT 1 FROM auth_test_sessions t WHERE t.id=health_devices.owner_id AND t.expires_at>?)))
      AND EXISTS(SELECT 1 FROM health_readings WHERE device_id=? AND sample_id=? AND payload_hash=?)`).bind(now,device.id,hash,now,now,device.id,input.sampleId,payloadHash),
  ]);
  const row=await db.prepare('SELECT payload_hash,received_at FROM health_readings WHERE device_id=? AND sample_id=?').bind(device.id,input.sampleId).first();
  if (!row) throw denied(); // Revocation raced the original token lookup.
  if (row.payload_hash!==payloadHash) throw new HealthDataError(409,'sample_conflict','This sampleId already belongs to different data.');
  if (!results[1]?.meta?.changes) throw denied();
  const accepted=Number(Boolean(results[0]?.meta?.changes));
  return healthJSON({accepted,duplicate:!accepted,sampleId:input.sampleId,receivedAt:healthISO(row.received_at)},accepted?201:200);
}
// A resumed TEST session keeps its identity across UTC days. Once explicitly
// seeded, its example-only dataset needs today's counters instead of yesterday's.
// Never add examples to a pet that has received uploaded/custom measurements.
async function healthEnsureExampleReadings(db, principal, pet, now) {
  if (!principal.isTest) return;
  const id=`demo_${pet.id}`;
  const sensor=await db.prepare("SELECT id FROM health_devices WHERE id=? AND pet_id=? AND owner_id=? AND source='test' AND token_hash IS NULL AND revoked_at IS NULL").bind(id,pet.id,principal.id).first();
  if (!sensor) return; // Empty test bootstraps must still wait for explicit seeding.
  const foreignReadings=`SELECT 1 FROM health_readings WHERE pet_id=? AND owner_id=? AND
    (device_id<>? OR source<>'test' OR (sample_id NOT IN ('example-0','example-1','example-2','example-3','example-4','example-5','example-6')
      AND sample_id<>'example-'||strftime('%Y-%m-%d',recorded_at/1000,'unixepoch')))`;
  if (await db.prepare(foreignReadings+' LIMIT 1').bind(pet.id,principal.id,id).first()) return;
  const today=Math.floor(now/HEALTH_DAY)*HEALTH_DAY;
  const existing=await db.prepare('SELECT recorded_at FROM health_readings WHERE pet_id=? AND owner_id=? AND recorded_at>=? AND recorded_at<?').bind(pet.id,principal.id,today-6*HEALTH_DAY,today+HEALTH_DAY).all();
  const days=new Set(existing.results.map(row=>Math.floor(row.recorded_at/HEALTH_DAY)));
  const fixture=[[78,34.3,6100,7.6],[81,34.6,6700,8.2],[79,34.4,6400,7.8],[82,34.7,6900,8.4],[80,34.5,6500,8],[77,34.2,6000,7.7],[82,34.6,6248,7.7]];
  const statements=[];
  for (const [index,values] of fixture.entries()) {
    const at=now-(6-index)*HEALTH_DAY, day=Math.floor(at/HEALTH_DAY)*HEALTH_DAY;
    if (days.has(day/HEALTH_DAY)) continue;
    const input={sampleId:`example-${healthISO(at).slice(0,10)}`,recordedAt:healthISO(at),heartBpm:values[0],skinTemperatureC:values[1],stepsToday:values[2],estimatedSleepHoursToday:values[3]};
    statements.push(db.prepare(`INSERT INTO health_readings (id,device_id,pet_id,owner_id,sample_id,payload_hash,recorded_at,received_at,heart_bpm,skin_temperature_c,steps_today,sleep_hours_today,source)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,'test'
      WHERE EXISTS(SELECT 1 FROM health_devices WHERE id=? AND pet_id=? AND owner_id=? AND source='test' AND token_hash IS NULL AND revoked_at IS NULL)
        AND NOT EXISTS(${foreignReadings})
        AND NOT EXISTS(SELECT 1 FROM health_readings WHERE pet_id=? AND owner_id=? AND recorded_at>=? AND recorded_at<?)
      ON CONFLICT(device_id,sample_id) DO NOTHING`).bind(healthRandom('reading_'),id,pet.id,principal.id,input.sampleId,await healthHash(JSON.stringify(input)),at,now,...values,
        id,pet.id,principal.id,pet.id,principal.id,id,pet.id,principal.id,day,day+HEALTH_DAY));
  }
  if (!statements.length) return;
  statements.push(db.prepare(`UPDATE health_devices SET last_seen_at=MAX(COALESCE(last_seen_at,0),?),token_expires_at=?
    WHERE id=? AND pet_id=? AND owner_id=? AND source='test' AND token_hash IS NULL AND revoked_at IS NULL
      AND NOT EXISTS(${foreignReadings})
      AND EXISTS(SELECT 1 FROM health_readings WHERE device_id=? AND recorded_at=? AND received_at=?)`).bind(now,principal.expires_at,id,pet.id,principal.id,pet.id,principal.id,id,id,now,now));
  await db.batch(statements);
}
async function healthSeed(db, principal, now) {
  if (!principal.isTest) throw new HealthDataError(403,'test_session_required','Example readings are only available in a test account.');
  const pet=await healthPet(db,principal,now);
  if (await db.prepare('SELECT id FROM health_readings WHERE pet_id=? AND owner_id=? LIMIT 1').bind(pet.id,principal.id).first()) return healthBootstrap(db,principal,now);
  const id=`demo_${pet.id}`, expiry=principal.expires_at;
  await db.prepare(`INSERT INTO health_devices (id,pet_id,owner_id,label,source,token_expires_at,last_seen_at,created_at)
    VALUES (?,?,?,'Example sensor','test',?,?,?) ON CONFLICT(id) DO NOTHING`).bind(id,pet.id,principal.id,expiry,now,now).run();
  return healthBootstrap(db,principal,now);
}

export function createHealthDataHandler({getAccountId=async()=>null,now=Date.now} = {}) {
  return async (request, env = {}) => {
    const path=new URL(request.url).pathname;
    if (!path.startsWith('/api/health/') && path!=='/api/v1/telemetry') return null;
    try {
      const db=healthStorage(env), time=healthTime(now);
      if (path==='/api/v1/telemetry') {
        if(request.method!=='POST')throw new HealthDataError(405,'method_not_allowed','Use POST to upload a reading.',{}, {Allow:'POST'});
        return await healthIngest(request,db,time);
      }
      const principal=await healthPrincipal(request,env,getAccountId,time);
      if (!principal) throw new HealthDataError(401,'authentication_required','Sign in to access your pet data.');
      if (path==='/api/health/bootstrap' && request.method==='GET') return healthJSON(await healthBootstrap(db,principal,time));
      const revoke=path.match(/^\/api\/health\/devices\/([A-Za-z0-9_-]{1,100})\/revoke$/);
      const required=path==='/api/health/pet'?'PUT':['/api/health/devices','/api/health/demo/seed'].includes(path)||revoke?'POST':path==='/api/health/bootstrap'?'GET':null;
      if (!required) throw new HealthDataError(404,'not_found','This health endpoint was not found.');
      if (request.method!==required) throw new HealthDataError(405,'method_not_allowed',`Use ${required} for this action.`,{}, {Allow:required});
      healthOrigin(request);
      await healthLimit(db,`owner:${principal.id}`,60,time);
      const body=await healthBody(request,path==='/api/health/pet'?HEALTH_PROFILE_BYTES:4096);
      if (path==='/api/health/pet') return healthJSON(await healthSavePet(db,principal,body,time));
      if (path==='/api/health/devices') return healthJSON(await healthCreateDevice(request,db,principal,body,time),201);
      healthKeys(body,[]);
      if (revoke) return healthJSON(await healthRevokeDevice(db,principal,revoke[1],time));
      return healthJSON(await healthSeed(db,principal,time));
    } catch (error) {
      if(error instanceof HealthDataError)return healthJSON({code:error.code,message:error.message,...error.extra},error.status,error.headers);
      return healthJSON({code:'storage_unavailable',message:'Health storage is temporarily unavailable. Please try again.'},503);
    }
  };
}
