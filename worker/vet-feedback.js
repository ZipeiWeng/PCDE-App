// Owner follow-ups are not verified clinical outcomes. This service deliberately
// keeps test/demo sessions out of public counts and never infers a cure rate.
export const VET_FEEDBACK_CONDITIONS = ['general','vaccination','mobility','ear','skin','digestive','dental','respiratory','other'];
const VET_FEEDBACK_OUTCOMES = ['recovered','improved','unchanged','worse','ongoing'];
const VET_FEEDBACK_MINIMUM_SAMPLE = 5;
const vetFeedbackSchemas = new WeakMap();

class VetFeedbackError extends Error {
  constructor(status, code, message) { super(message); this.status=status; this.code=code; }
}
const vetFeedbackJSON = (body,status=200) => new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const vetFeedbackClinicId = value => typeof value === 'string' && /^(?:node|way|relation)\/[1-9]\d{0,19}$/.test(value);
const vetFeedbackCondition = value => value === 'all' || VET_FEEDBACK_CONDITIONS.includes(value);
const vetFeedbackString = (value,max,fallback='') => {
  if(value===undefined || value===null)return fallback;
  if(typeof value!=='string'||value.length>max)throw new VetFeedbackError(400,'invalid_feedback','Some feedback fields are too long or invalid.');
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim();
};

async function vetFeedbackSchema(db) {
  if(!db?.prepare)throw new VetFeedbackError(503,'feedback_unavailable','Community feedback is unavailable right now.');
  let ready=vetFeedbackSchemas.get(db);
  if(!ready){
    ready=db.prepare(`CREATE TABLE IF NOT EXISTS vet_feedback (
      clinic_id TEXT NOT NULL, account_id TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      condition_key TEXT NOT NULL, outcome TEXT NOT NULL,
      visit_date TEXT NOT NULL, display_name TEXT NOT NULL,
      comment TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY(clinic_id,account_id)
    )`).run();
    vetFeedbackSchemas.set(db,ready);
    ready.catch(()=>vetFeedbackSchemas.delete(db));
  }
  await ready;
}

async function vetFeedbackBody(request) {
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))throw new VetFeedbackError(415,'json_required','Send feedback as JSON.');
  const declared=request.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>8192))throw new VetFeedbackError(413,'feedback_too_large','This feedback is too long.');
  const reader=request.body?.getReader();let size=0;const chunks=[];
  if(reader){
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel();throw new VetFeedbackError(413,'feedback_too_large','This feedback is too long.');}chunks.push(value);}}
    finally{reader.releaseLock();}
  }
  const joined=new Uint8Array(size);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}
  try{const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(joined));if(!body||typeof body!=='object'||Array.isArray(body))throw new Error();return body;}
  catch{throw new VetFeedbackError(400,'invalid_feedback','The feedback could not be read.');}
}

function vetFeedbackValidate(body,now) {
  const allowed=new Set(['clinicId','rating','visitDate','condition','outcome','comment','displayName','consent']);
  if(Object.keys(body).some(key=>!allowed.has(key)))throw new VetFeedbackError(400,'invalid_feedback','The feedback contains unsupported fields.');
  if(!vetFeedbackClinicId(body.clinicId)||!Number.isInteger(body.rating)||body.rating<1||body.rating>5||!VET_FEEDBACK_CONDITIONS.includes(body.condition)||!VET_FEEDBACK_OUTCOMES.includes(body.outcome))throw new VetFeedbackError(400,'invalid_feedback','Choose a clinic, rating, concern and outcome.');
  if(body.consent!==true)throw new VetFeedbackError(400,'publication_consent_required','Confirm that you want to publish this feedback.');
  const date=body.visitDate;
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<'1900-01-01'||date>new Date(now).toISOString().slice(0,10))throw new VetFeedbackError(400,'invalid_visit_date','Choose a past visit date.');
  const parsed=new Date(`${date}T12:00:00Z`);
  if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)throw new VetFeedbackError(400,'invalid_visit_date','Choose a valid visit date.');
  return {clinicId:body.clinicId,rating:body.rating,visitDate:date,condition:body.condition,outcome:body.outcome,comment:vetFeedbackString(body.comment,800),displayName:vetFeedbackString(body.displayName,40,'Pet owner')||'Pet owner'};
}

function vetFeedbackRecovery(completedCount=0,recoveredCount=0) {
  return {percent:completedCount>=VET_FEEDBACK_MINIMUM_SAMPLE?Math.round(recoveredCount/completedCount*100):null,recoveredCount,completedCount,minimumSample:VET_FEEDBACK_MINIMUM_SAMPLE};
}

function vetFeedbackConditionRating(condition,ratingTotal=0,reviewCount=0,positiveCount=0) {
  return {condition,rating:reviewCount?Math.round(ratingTotal/reviewCount*10)/10:null,reviewCount,positiveCount,positivePercent:reviewCount>=VET_FEEDBACK_MINIMUM_SAMPLE?Math.round(positiveCount/reviewCount*100):null,minimumSample:VET_FEEDBACK_MINIMUM_SAMPLE};
}

export function summarizeVetFeedback(rows,ids,condition='all') {
  const summaries=Object.fromEntries(ids.map(id=>[id,{rating:null,reviewCount:0,reportedRecovery:vetFeedbackRecovery(),conditionRecovery:{condition,...vetFeedbackRecovery()},conditionRating:vetFeedbackConditionRating(condition)}]));
  const totals={},conditionTotals={};
  for(const row of rows){
    const summary=summaries[row.clinic_id];if(!summary)continue;
    summary.reviewCount+=Number(row.review_count)||0;
    totals[row.clinic_id]=(totals[row.clinic_id]||0)+(Number(row.rating_total)||0);
    summary.reportedRecovery.completedCount+=Number(row.completed_count)||0;
    summary.reportedRecovery.recoveredCount+=Number(row.recovered_count)||0;
    if(condition==='all'||row.condition_key===condition){
      summary.conditionRecovery.completedCount+=Number(row.completed_count)||0;summary.conditionRecovery.recoveredCount+=Number(row.recovered_count)||0;
      summary.conditionRating.reviewCount+=Number(row.review_count)||0;summary.conditionRating.positiveCount+=Number(row.positive_count)||0;
      conditionTotals[row.clinic_id]=(conditionTotals[row.clinic_id]||0)+(Number(row.rating_total)||0);
    }
  }
  for(const [id,summary] of Object.entries(summaries)){
    if(summary.reviewCount)summary.rating=Math.round(totals[id]/summary.reviewCount*10)/10;
    summary.reportedRecovery=vetFeedbackRecovery(summary.reportedRecovery.completedCount,summary.reportedRecovery.recoveredCount);
    summary.conditionRecovery={condition,...vetFeedbackRecovery(summary.conditionRecovery.completedCount,summary.conditionRecovery.recoveredCount)};
    summary.conditionRating=vetFeedbackConditionRating(condition,conditionTotals[id]||0,summary.conditionRating.reviewCount,summary.conditionRating.positiveCount);
  }
  return summaries;
}

const vetFeedbackPublicReview = row => row ? {displayName:row.display_name,rating:row.rating,visitDate:row.visit_date,condition:row.condition_key,outcome:row.outcome,comment:row.comment,createdAt:new Date(row.created_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString()} : null;

export function createVetFeedbackHandler({getAccountId=async()=>null,now=Date.now}={}) {
  async function accountId(request,env) {
    const id=await getAccountId(request,env,now());
    if(typeof id!=='string'||!id||id.startsWith('test_')||id.length>200)return null;
    // Only registered Pawprint accounts count. Public demo or platform headers
    // alone cannot publish, even if another feature accepts those principals.
    const registered=await env.AUTH_DB.prepare('SELECT id FROM auth_accounts WHERE id=?').bind(id).first();
    return registered?.id===id?id:null;
  }
  async function summaries(db,ids,condition) {
    const placeholders=ids.map(()=>'?').join(',');
    const result=await db.prepare(`SELECT clinic_id,condition_key,COUNT(*) AS review_count,SUM(rating) AS rating_total,
      SUM(CASE WHEN rating>=4 THEN 1 ELSE 0 END) AS positive_count,
      SUM(CASE WHEN outcome='ongoing' THEN 0 ELSE 1 END) AS completed_count,
      SUM(CASE WHEN outcome='recovered' THEN 1 ELSE 0 END) AS recovered_count
      FROM vet_feedback WHERE clinic_id IN (${placeholders}) GROUP BY clinic_id,condition_key`).bind(...ids).all();
    return summarizeVetFeedback(result.results||[],ids,condition);
  }
  async function detail(db,clinicId,condition,id) {
    const all=await summaries(db,[clinicId],condition);
    const columns='rating,condition_key,outcome,visit_date,display_name,comment,created_at,updated_at';
    const reviewParams=condition==='all'?[clinicId]:[clinicId,condition];
    const reviews=await db.prepare(`SELECT ${columns} FROM vet_feedback WHERE clinic_id=?${condition==='all'?'':' AND condition_key=?'} ORDER BY updated_at DESC,created_at DESC LIMIT 20`).bind(...reviewParams).all();
    const own=id?await db.prepare(`SELECT ${columns} FROM vet_feedback WHERE clinic_id=? AND account_id=?`).bind(clinicId,id).first():null;
    return {available:true,clinicId,summary:all[clinicId],reviews:(reviews.results||[]).map(vetFeedbackPublicReview),ownReview:vetFeedbackPublicReview(own),canReview:Boolean(id)};
  }
  return async function handleVetFeedback(request,env={}) {
    try{
      if(!['GET','POST','DELETE'].includes(request.method))return vetFeedbackJSON({code:'method_not_allowed',message:'This method is not supported.'},405);
      const url=new URL(request.url),condition=url.searchParams.get('condition')||'all';
      if(!vetFeedbackCondition(condition))throw new VetFeedbackError(400,'invalid_condition','Choose a listed concern.');
      if(request.method!=='GET'&&request.headers.get('origin')!==url.origin)throw new VetFeedbackError(403,'origin_not_allowed','Open Pawprint to publish feedback.');
      await vetFeedbackSchema(env.AUTH_DB);
      const id=await accountId(request,env);
      if(request.method==='GET'){
        const clinicId=url.searchParams.get('clinic');
        if(clinicId!==null){if(!vetFeedbackClinicId(clinicId))throw new VetFeedbackError(400,'invalid_clinic','Choose a listed clinic.');return vetFeedbackJSON(await detail(env.AUTH_DB,clinicId,condition,id));}
        const ids=[...new Set((url.searchParams.get('ids')||'').split(','))];
        if(!ids.length||ids.length>40||ids.some(item=>!vetFeedbackClinicId(item)))throw new VetFeedbackError(400,'invalid_clinics','Choose between one and forty clinics.');
        return vetFeedbackJSON({available:true,summaries:await summaries(env.AUTH_DB,ids,condition),canReview:Boolean(id)});
      }
      if(!id)throw new VetFeedbackError(401,'registered_account_required','Sign in to a registered Pawprint account to publish feedback. Test accounts cannot publish reviews.');
      if(request.method==='DELETE'){
        const clinicId=url.searchParams.get('clinic');if(!vetFeedbackClinicId(clinicId))throw new VetFeedbackError(400,'invalid_clinic','Choose a listed clinic.');
        await env.AUTH_DB.prepare('DELETE FROM vet_feedback WHERE clinic_id=? AND account_id=?').bind(clinicId,id).run();
        return vetFeedbackJSON(await detail(env.AUTH_DB,clinicId,condition,id));
      }
      const value=vetFeedbackValidate(await vetFeedbackBody(request),now());
      const count=await env.AUTH_DB.prepare('SELECT COUNT(*) AS total FROM vet_feedback WHERE account_id=?').bind(id).first();
      if(Number(count?.total)>=100){const existing=await env.AUTH_DB.prepare('SELECT clinic_id FROM vet_feedback WHERE clinic_id=? AND account_id=?').bind(value.clinicId,id).first();if(!existing)throw new VetFeedbackError(429,'feedback_limit','You have reached the limit of 100 clinic reviews. You can still update an existing review.');}
      await env.AUTH_DB.prepare(`INSERT INTO vet_feedback (clinic_id,account_id,rating,condition_key,outcome,visit_date,display_name,comment,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(clinic_id,account_id) DO UPDATE SET
        rating=excluded.rating,condition_key=excluded.condition_key,outcome=excluded.outcome,
        visit_date=excluded.visit_date,display_name=excluded.display_name,comment=excluded.comment,updated_at=excluded.updated_at`)
        .bind(value.clinicId,id,value.rating,value.condition,value.outcome,value.visitDate,value.displayName,value.comment,now(),now()).run();
      return vetFeedbackJSON(await detail(env.AUTH_DB,value.clinicId,condition,id));
    }catch(error){
      if(error instanceof VetFeedbackError)return vetFeedbackJSON({code:error.code,message:error.message},error.status);
      return vetFeedbackJSON({code:'feedback_unavailable',message:'Community feedback is unavailable right now.'},503);
    }
  };
}
