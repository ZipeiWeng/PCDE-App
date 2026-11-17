// Each colour is acknowledged in order; stale activations cannot skip a lesson.
const tones=['good','watch','alert'];
const content={
  en:[
    ['Green water orb','Readings are close to their usual pattern.'],
    ['Yellow water orb','Readings have changed. Check the pattern.'],
    ['Red water orb','Urgent signs: seek veterinary help.'],
  ],
  zh:[
    ['绿色水球','读数接近平时，状态平稳。'],
    ['黄色水球','读数出现变化，需要关注。'],
    ['红色水球','出现紧急征兆，请及时寻求兽医帮助。'],
  ],
};
const stepIndex=progress=>Number.isInteger(progress)&&progress>=0?Math.min(progress,tones.length):0;
export function colourLesson(progress=0,language='en') {
  const index=stepIndex(progress),zh=language==='zh';
  if(index===tones.length)return {index,complete:true,tone:'watch',label:zh?'点水球，查看详情':'Tap the water orb',description:zh?'查看读数、变化和下一步建议。':'See readings, changes and next steps.'};
  const [label,description]=content[zh?'zh':'en'][index];
  return {index,complete:false,tone:tones[index],label,description,hint:zh?'点击继续':'Tap to continue'};
}
export function advanceColourLesson(progress,expectedTone) {
  const current=colourLesson(progress);
  return current.complete||expectedTone!==current.tone?current.index:current.index+1;
}

// Ignore repeat activations through the colour change, including the final one.
export function colourTapAction(progress,{detail=0,repeat=false,moved=false}={},elapsed=Infinity) {
  if(repeat||detail>1||moved||elapsed<450)return 'ignore';
  return colourLesson(progress).complete?'open':'advance';
}
