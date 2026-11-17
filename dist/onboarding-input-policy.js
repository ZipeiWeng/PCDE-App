// Keep editing and soft-keyboard dismissal separate from ending a tour.
// Inputs are plain values so the decisions can also be exercised without a DOM.
const nonTextInputTypes = new Set(['button','checkbox','color','file','hidden','image','radio','range','reset','submit']);

export function isOnboardingTextEntry({tagName='',type='',disabled=false,readOnly=false,isContentEditable=false}={}) {
  if(disabled||readOnly)return false;
  if(isContentEditable)return true;
  const tag=String(tagName).toUpperCase();
  return tag==='TEXTAREA'||tag==='SELECT'||(tag==='INPUT'&&!nonTextInputTypes.has(String(type).toLowerCase()));
}

export function onboardingInputPolicy({editableFocused=false,composing=false,layoutHeight,viewportHeight,dismissible=false}={}) {
  const validHeights=Number.isFinite(layoutHeight)&&layoutHeight>0&&Number.isFinite(viewportHeight)&&viewportHeight>0;
  // Browser chrome alone commonly changes height by a few dozen pixels. A
  // larger shrink keeps End tour out of the keyboard's moving hit area, even
  // between blur and the viewport's final resize frame.
  const keyboardOpen=validHeights&&layoutHeight-viewportHeight>=120&&viewportHeight/layoutHeight<=.8;
  const editing=Boolean(editableFocused||composing);
  return {
    keyboardOpen,
    editing,
    showEndTour:!editing&&!keyboardOpen,
    escapeAction:editableFocused&&!composing?'blur':'ignore',
    preventDialogCancel:editing||keyboardOpen||!dismissible,
  };
}
