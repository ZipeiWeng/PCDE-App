// Concern text only chooses a feedback category. It is not a diagnosis and is
// never sent to map/geocoding providers.
export const VET_RADII = [1,5,10,25];
export const validVetRadius = value => VET_RADII.includes(Number(value)) ? Number(value) : 10;
const rules = [
 ['vaccination',/vaccin|immuni[sz]|booster|疫苗|接种|打针/i],
 ['skin',/skin|itch|rash|dermat|皮肤|瘙痒|过敏/i],
 ['respiratory',/sneez|cough|breath|喘|喷嚏|咳嗽|呼吸/i],
 ['mobility',/limp|joint|walk|muscle|arthritis|关节|跛|走路|肌肉/i],
 ['ear',/\bear\b|耳/i],['dental',/teeth|tooth|dental|gum|牙|口腔/i],
 ['digestive',/vomit|diarr|stomach|digest|呕吐|腹泻|肠胃|消化/i],
 ['general',/check.?up|routine|wellness|general|体检|检查|常规/i],
];
export function concernCategory(text){return rules.find(([,pattern])=>pattern.test(String(text||'')))?.[0]||'other';}
export function isServiceCategory(condition){return condition==='vaccination'||condition==='general';}
const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
export function recommendationEvidence(summary,condition){
 if(!summary||condition==='all')return null;
 const recovery=summary.conditionRecovery,ratings=summary.conditionRating;
 const completed=count(recovery?.completedCount),recovered=count(recovery?.recoveredCount);
 if(!isServiceCategory(condition)&&(!recovery?.condition||recovery.condition===condition)&&completed>=5&&recovered!==null&&recovered<=completed){
  return {kind:'recovery',percent:Math.round(recovered/completed*100),count:completed,numerator:recovered,illustrative:summary.illustrative===true};
 }
 const reviews=count(ratings?.reviewCount),positive=count(ratings?.positiveCount);
 if(reviews>=5&&positive!==null&&positive<=reviews&&(!ratings.condition||ratings.condition===condition)){
  return {kind:'positive',percent:Math.round(positive/reviews*100),count:reviews,numerator:positive,illustrative:summary.illustrative===true};
 }
 return null;
}
export function rankClinics(vets,summaries,{condition='all',radiusKm=10,routine=false}={}){
 const radius=validVetRadius(radiusKm);
 return vets.filter(v=>Number.isFinite(v.distanceKm)&&v.distanceKm>=0&&v.distanceKm<=radius).map((vet,index)=>({vet,index,evidence:routine?recommendationEvidence(summaries?.[vet.id],condition):null})).sort((a,b)=>{
  // Never treat unrelated overall/Google ratings as condition-specific evidence.
  if(routine){if(Boolean(a.evidence)!==Boolean(b.evidence))return a.evidence?-1:1;
   if(a.evidence&&b.evidence){if(a.evidence.kind!==b.evidence.kind)return a.evidence.kind==='recovery'?-1:1;
    if(a.evidence.percent!==b.evidence.percent)return b.evidence.percent-a.evidence.percent;
    if(a.evidence.count!==b.evidence.count)return b.evidence.count-a.evidence.count;}}
  return a.vet.distanceKm-b.vet.distanceKm||a.index-b.index;
 }).map(item=>item.vet);
}
export function recommendationText(evidence,{loading=false}={}){
 if(!evidence)return loading?'Checking related feedback…':'Limited related feedback · nearest options';
 return `${evidence.illustrative?'Example · ':''}${evidence.percent}% ${evidence.kind==='recovery'?'reported recovery':'positive reviews'} · ${evidence.count} ${evidence.kind==='recovery'?'follow-ups':'reviews'}`;
}
