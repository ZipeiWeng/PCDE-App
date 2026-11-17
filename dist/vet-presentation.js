import {ratingLabel,recoveryLabel,vetDistance} from './vet-data.js';
import {publicVetRating} from './vet-public-ratings.js';
import {exampleVetFeedback} from './vet-example-feedback.js';

export function clinicStats(vet,summary,{demo=false,tutorial=false,condition='all',available=true,variant}={}) {
  const example=(demo||tutorial)?exampleVetFeedback(vet?.id,condition,variant).summary:null;
  const source=tutorial?null:publicVetRating(vet);
  const actualRating=ratingLabel(summary);
  let rating;
  if(actualRating.value!=='—'&&!summary?.illustrative)rating={...actualRating,label:'Owner rating'};
  else if(source)rating={label:'Google rating',value:source.rating.toFixed(1),note:`${source.reviewCount} Google reviews`,sourceUrl:source.sourceUrl,source:source.source,retrievedAt:source.retrievedAt,sourceAsOf:source.sourceAsOf};
  else if(example)rating={...ratingLabel(example),label:'Example rating',note:`${example.reviewCount} example reviews`,illustrative:true};
  else rating={label:'Owner rating',value:'—',note:available===null?'Loading…':available===false?'Feedback unavailable':'No owner reviews yet'};
  const recovery=(value,fallback,label)=>{
    const actual=recoveryLabel(value);
    if(actual.value!=='—'&&!summary?.illustrative)return{...actual,label};
    if(fallback)return{...recoveryLabel(fallback),label,illustrative:true};
    return{...actual,label,note:available===null?'Loading…':available===false?'Feedback unavailable':actual.note};
  };
  const overall=recovery(summary?.reportedRecovery,example?.reportedRecovery,'Recovery');
  let matched;
  if(condition==='all'){
    const actual=summary?.reportedRecovery,hasActual=Number.isSafeInteger(actual?.completedCount)&&actual.completedCount>0&&!summary?.illustrative;
    const count=hasActual?actual.completedCount:example?.reportedRecovery.completedCount??(available===true&&actual?.completedCount===0?0:undefined);
    matched={label:'Follow-ups',value:count===undefined?'—':String(count),note:count===undefined?'No completed reports':hasActual?'Completed owner reports':example?'Example completed reports':'No completed reports',illustrative:!hasActual&&!!example};
  }else matched=recovery(summary?.conditionRecovery,example?.conditionRecovery,'This condition');
  return {items:[rating,overall,matched],illustrative:[rating,overall,matched].some(item=>item.illustrative),source:rating.sourceUrl?source:null};
}
export function clinicDistanceParts(vet) {
  const text=vetDistance(vet);
  if(text==='Under 100 m')return{value:'<100',unit:'m',text};
  if(text.endsWith(' km'))return{value:text.slice(0,-3),unit:'km',text};
  return{value:'—',unit:'',text};
}
export function clinicDisplayName(vet){return publicVetRating(vet)?.branch||vet.name;}
