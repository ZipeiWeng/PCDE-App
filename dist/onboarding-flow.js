const step = (id,chapter,target,en,zh,detail,detailZh,options={}) => ({
  id,chapter,target,en,zh,detail,detailZh,showDescription:true,...options,
});
const backHome = (type) => ({
  event:'continue',continueLabel:'Back to home',continueLabelZh:'返回主页',
  continueAction:'home-good',dismiss:true,requiresOpen:true,acceptEvents:[{type}],
});

// Six scenes. Home entrances and their contents are one scene, so opening
// something never skips its explanation or adds another mandatory tutorial step.
export const onboardingFlow = [
  step('welcome',0,'#app-workspace','Welcome!','欢迎！',
    'Let’s get you started.','一起开始吧。',
    {action:'home-current',home:true,visual:'welcome',event:'continue',continueLabel:'Get started',continueLabelZh:'开始'}),
  step('device',3,'#device-button','First, connect your collar','先连接你的项圈',
    'Device settings are at the top right.','设备设置入口在右上角。',
    {...backHome('settings-close'),action:'home-current',home:true,gesture:'tap',
      continueLabel:'Try the health demo',continueLabelZh:'体验健康示例',skipEvent:'example',skipLabel:'No collar? Try an example',skipLabelZh:'没有项圈？先体验示例',
      entry:{type:'settings',section:'device'},settingsGestures:true,
      allow:'[data-connect],[data-connect-back],[data-connect-demo],[data-pair],[data-disconnect],[data-settings-menu]'}),
  step('score',1,'#wellness-orb','This water orb shows their health','水球显示当前健康状态',
    'See green, yellow and red in order, then tap the water for details.','依次了解绿色、黄色和红色，再点水球查看详情。',
    {action:'set-good',home:true,visual:'colours',event:'continue',gesture:'tap',example:true,
      entry:{type:'health-open'},requiresOpen:true,dismiss:false}),
  step('red-alert',2,'[data-find-vet]','Yellow or red brings an alert','水球变黄或变红时，会弹出提醒',
    'Check the signs and readings. Tap Contact nearest vet for nearby help.','查看警示症状与读数。点 Contact nearest vet 寻找附近的帮助。',
    {...backHome('sheet-close'),action:'red-alert',home:false,entry:{type:'health-alert'},
      startsOpen:true,visual:'alert-intro',example:true,requiresClinicPreview:true,
      continueLabel:'Continue tour',continueLabelZh:'继续引导'}),
  step('profile',5,'#account-button','Tap your pet photo for settings','点宠物照片，打开设置',
    'Find it at the top left.','入口在左上角。',
    {...backHome('settings-close'),home:true,gesture:'tap',entry:{type:'settings',section:'profile'},settingsGestures:true,
      allow:'[data-section="profile"],[data-section="preferences"],[data-section="language"],[data-section="subscription"],[data-settings-menu],#settings-screen .settings-content'}),
  step('explore',6,'[data-page-step="-1"]','Swipe right to explore','向右滑，继续探索',
    'Activity shows their day. Swipe again for your AI companion.','活动页记录一天的状态；再滑一次，进入 AI 助手。',
    {action:'activity-home',home:true,done:false,event:'page',navigation:true,gesture:'swipe',visual:'swipe',
      doneLabel:'Start exploring',doneLabelZh:'开始使用',allow:'.companion-type,.companion-voice,[data-companion-cancel]'}),
].map((item,index,all)=>({...item,next:all[index+1]?.id,...(!item.event&&!item.done?{event:'continue'}:{})}));

export function onboardingSteps(language='en') {
  return onboardingFlow.map(item=>({...item,label:language==='zh'?item.zh:item.en,
    description:language==='zh'?item.detailZh:item.detail,
    ...(item.continueLabel?{continueLabel:language==='zh'?item.continueLabelZh:item.continueLabel}:{}),
    ...(item.skipLabel?{skipLabel:language==='zh'?item.skipLabelZh:item.skipLabel}:{}),
    ...(item.doneLabel?{doneLabel:language==='zh'?item.doneLabelZh:item.doneLabel}:{}),
  }));
}
function matches(expected,event) {
  if(expected.type!==event.type)return false;
  return ['index','section','view','module','open'].every(key=>expected[key]===undefined||expected[key]===event[key]);
}
export function isTourEntry(id,event={}) {
  const entry=onboardingFlow.find(item=>item.id===id)?.entry;
  return Boolean(entry&&matches(entry,event));
}
export function nextTourStep(id,event={},scene={}) {
  const current=onboardingSteps('en',scene).find(item=>item.id===id);
  if(current?.skipEvent&&current.skipEvent===event.type)return current.next||id;
  if(id==='score'&&scene.coloursComplete!==true)return id;
  if(current?.requiresClinicPreview&&scene.clinicReviewed!==true)return id;
  if(!current||current.requiresOpen&&scene.opened!==true)return id;
  const alternative=current.acceptEvents?.find(expected=>matches(expected,event));
  if(alternative)return alternative.next||current.next||id;
  if(!current.event||!matches({...current,type:current.event},event))return id;
  return current.next||id;
}
