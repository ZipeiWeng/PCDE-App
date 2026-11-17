export const VET_CONDITIONS=[['all','All conditions'],['general','General care'],['mobility','Mobility & joints'],['ear','Ear'],['skin','Skin'],['digestive','Digestive'],['dental','Dental'],['respiratory','Breathing'],['other','Other']];
export const VET_OUTCOMES=[['recovered','Recovered'],['improved','Improved'],['unchanged','Unchanged'],['worse','Worse'],['ongoing','Treatment ongoing']];
export const coordinate=(value,maximum)=>Number.isFinite(value)&&Math.abs(value)<=maximum;
export function safeVetWebsite(value){try{const url=new URL(String(value));return['https:','http:'].includes(url.protocol)?url.href:null;}catch{return null;}}
export function cleanVet(value){
 if(!value||!coordinate(value.lat,90)||!coordinate(value.lon,180))return null;
 return{id:String(value.id||'').slice(0,80),name:String(value.name||'Veterinary clinic').slice(0,180),lat:value.lat,lon:value.lon,distanceKm:Number.isFinite(value.distanceKm)&&value.distanceKm>=0?value.distanceKm:null,address:typeof value.address==='string'?value.address.slice(0,400):'',phone:typeof value.phone==='string'?value.phone.slice(0,80):'',website:safeVetWebsite(value.website),openingHours:typeof value.openingHours==='string'?value.openingHours.slice(0,250):'',rating:Number.isFinite(value.rating)&&value.rating>=1&&value.rating<=5?value.rating:null,reviewCount:Number.isSafeInteger(value.reviewCount)&&value.reviewCount>0?value.reviewCount:null};
}
export function vetDistance(vet){return vet.distanceKm===null?'Distance unavailable':vet.distanceKm<.1?'Under 100 m':`${vet.distanceKm.toFixed(1)} km`;}
export function recoveryLabel(value){
 const completed=Number.isSafeInteger(value?.completedCount)&&value.completedCount>=0?value.completedCount:0,recovered=Number.isSafeInteger(value?.recoveredCount)&&value.recoveredCount>=0&&value.recoveredCount<=completed?value.recoveredCount:null;
 if(completed<5||recovered===null)return{value:'—',note:completed?`${completed} follow-up${completed===1?'':'s'} · 5 needed`:'No outcome data'};
 return{value:`${Math.round(recovered/completed*100)}%`,note:`${recovered} / ${completed} follow-ups`};
}
export function ratingLabel(summary){const rating=Number(summary?.rating),count=Number(summary?.reviewCount);return Number.isFinite(rating)&&rating>=1&&rating<=5&&Number.isInteger(count)&&count>0?{value:rating.toFixed(1),note:`${count} owner review${count===1?'':'s'}`}:{value:'—',note:'No owner reviews'};}
