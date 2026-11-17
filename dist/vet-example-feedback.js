// Illustrative UI data only. Never published or stored as a real clinic outcome.
const profiles = [
  {rating:4.8,count:96,recovered:62,completed:72,matched:18,matchedTotal:22},
  {rating:4.6,count:74,recovered:43,completed:56,matched:14,matchedTotal:19},
  {rating:4.7,count:118,recovered:75,completed:88,matched:21,matchedTotal:26},
  {rating:4.4,count:63,recovered:32,completed:45,matched:11,matchedTotal:16},
  {rating:4.9,count:142,recovered:91,completed:102,matched:27,matchedTotal:30},
  {rating:4.5,count:81,recovered:51,completed:67,matched:15,matchedTotal:21},
  {rating:4.7,count:109,recovered:68,completed:83,matched:19,matchedTotal:24},
  {rating:4.6,count:57,recovered:29,completed:38,matched:9,matchedTotal:13},
];
const visits = [
  ['Example owner A','The appointment included a clear examination and follow-up plan.','recovered'],
  ['Example owner B','The team explained the options and checked progress afterwards.','improved'],
  ['Example owner C','Booking was straightforward and the next steps were easy to understand.','recovered'],
];
function indexFor(id) {
  const tutorial=/^tutorial\/clinic-(\d+)$/.exec(String(id));
  if(tutorial)return Math.max(0,Number(tutorial[1])-1)%profiles.length;
  let hash=0;for(const character of String(id))hash=(hash*31+character.charCodeAt(0))>>>0;
  return hash%profiles.length;
}
export function exampleVetFeedback(id,condition='all',variant) {
  const index=Number.isInteger(variant)?Math.abs(variant)%profiles.length:indexFor(id),p=profiles[index];
  const conditionOffset=condition==='all'?0:[...String(condition)].reduce((sum,c)=>sum+c.charCodeAt(0),0)%3;
  const summary={illustrative:true,rating:p.rating,reviewCount:p.count,
    reportedRecovery:{recoveredCount:p.recovered,completedCount:p.completed},
    conditionRating:{condition,rating:p.rating,reviewCount:p.matchedTotal,positiveCount:p.matched-conditionOffset,positivePercent:Math.round((p.matched-conditionOffset)/p.matchedTotal*100),minimumSample:5},
    conditionRecovery:condition==='all'?{recoveredCount:p.recovered,completedCount:p.completed}:{condition,recoveredCount:p.matched-conditionOffset,completedCount:p.matchedTotal},
  };
  return {available:true,illustrative:true,canReview:false,summary,reviews:visits.map((item,i)=>({
    illustrative:true,displayName:item[0],rating:i===1?4:5,condition:condition==='all'?['general','skin','dental'][(index+i)%3]:condition,
    visitDate:['2026-10-28','2026-10-16','2026-09-30'][i],outcome:item[2],comment:`Example review: ${visits[(index+i)%visits.length][1]}`,
  }))};
}
