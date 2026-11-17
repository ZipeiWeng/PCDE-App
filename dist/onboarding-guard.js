// The tour grants access to the controls used by the current scene only.
// A permitted scrolling/swipe surface does not implicitly enable its buttons.
const controls = 'button,a[href],input,select,textarea,summary,[role="button"],[role="tab"],[role="checkbox"],[role="switch"],[role="slider"],[contenteditable]:not([contenteditable="false"])';
const focusables = `${controls},[tabindex]:not([tabindex="-1"])`;
const coachControls = '[data-coach-skip],[data-coach-continue],[data-coach-done],[data-coach-secondary],[data-coach-tone]';
const closest = (node, selector) => Boolean(selector && node?.closest?.(selector));
const textEntry = node => closest(node,'input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]),textarea,select,[contenteditable]:not([contenteditable="false"])');

export function onboardingTargetAccess(target, policy = {}, layer) {
  const overlay = Boolean(layer?.contains?.(target));
  if(!overlay && closest(target,policy.deniedSelectors))return {control:false,gesture:false,scroll:false,overlay};
  const control = overlay ? closest(target,coachControls) : closest(target,policy.allowedSelectors);
  const interactive = closest(target,controls);
  return {
    control,
    // A dedicated swipe lesson may own its artwork/background contacts. This
    // grants the coach's recognizer access, never an underlying app gesture.
    gesture: overlay ? Boolean(policy.overlaySwipe && !interactive) : (!interactive || closest(target,policy.gestureControlSelectors)) && closest(target,policy.gestureSelectors),
    scroll: !overlay && closest(target,policy.scrollSelectors),
    overlay,
  };
}

/**
 * getPolicy returns current scene selectors, not a cached step:
 * { allowedSelectors, deniedSelectors, gestureSelectors, gestureControlSelectors, scrollSelectors,
 *   keyboardSelectors, allowNavigationKeys, overlaySwipe }
 * Call mount once when the tour opens and destroy before restoring the app.
 * App gesture recognizers must also exclude .coach-layer and interactive
 * controls at pointerdown; their window capture handlers run before document.
 */
export function createOnboardingGuard({doc,layer,getPolicy = () => ({})}) {
  let mounted = false, redirecting = false, blockedContact = false;
  const starts = new Map(), bindings = [];
  const policy = () => getPolicy() || {};
  const access = target => onboardingTargetAccess(target,policy(),layer);
  const block = event => {
    if(event.cancelable !== false)event.preventDefault();
    event.stopImmediatePropagation();
  };
  const bind = (node,type,handler,options) => {
    node?.addEventListener(type,handler,options);bindings.push([node,type,handler,options]);
  };
  const candidates = () => [...doc.querySelectorAll(focusables)].filter(node => {
    if(node.disabled || node.closest?.('[hidden],[inert]') || node.tabIndex < 0)return false;
    if(node.getClientRects && !node.getClientRects().length)return false;
    return access(node).control;
  });
  function focusFirst() {
    if(redirecting)return;
    redirecting = true;
    const target = candidates()[0];
    if(target)target.focus({preventScroll:true});
    else doc.activeElement?.blur?.();
    redirecting = false;
  }
  function click(event) {
    if(blockedContact && event.type==='click' && event.detail!==0){blockedContact=false;block(event);return;}
    if(!access(event.target).control)block(event);
  }
  function start(event) {
    const target = event.target, decision = access(target);
    const permitted = (decision.control || decision.gesture || (decision.scroll && (!closest(target,controls)||closest(target,policy().scrollControlSelectors)))) && !(event.touches?.length > 1);
    const key = event.pointerId ?? (event.type.startsWith('touch') ? 'touch' : 'mouse');
    // Keep the origin decision for this entire contact; dragging a forbidden
    // button into the highlighted region must not unlock it at pointerup.
    starts.set(key,{permitted,target});
    blockedContact=!permitted;
    if(!permitted)block(event);
  }
  function continuation(event) {
    const key = event.pointerId ?? (event.type.startsWith('touch') ? 'touch' : 'mouse');
    const origin = starts.get(key);
    const decision = access(origin?.target || event.target);
    const permitted = origin?.permitted !== false && (decision.control || decision.gesture || decision.scroll);
    if(/up$|end$|cancel$/.test(event.type))starts.delete(key);
    if(!permitted)block(event);
  }
  function wheel(event) {
    if(!access(event.target).scroll)block(event);
  }
  function focus(event) {
    if(redirecting || access(event.target).control)return;
    event.stopImmediatePropagation();focusFirst();
  }
  function key(event) {
    // Preserve browser/OS shortcuts; they cannot activate an app control.
    if(event.ctrlKey || event.metaKey || event.altKey)return;
    if(event.key === 'Tab') {
      block(event);
      const items = candidates();if(!items.length)return;
      const current = items.indexOf(doc.activeElement);
      const next = event.shiftKey ? (current <= 0 ? items.length-1 : current-1) : (current+1)%items.length;
      items[next].focus({preventScroll:true});return;
    }
    if(event.key === 'Escape') {
      block(event);if(textEntry(doc.activeElement))doc.activeElement.blur?.();return;
    }
    const target = event.target, decision = access(target);
    const scroll=policy().scrollElement;
    if(scroll&&!textEntry(target)&&['ArrowDown','ArrowUp','PageDown','PageUp','Home','End'].includes(event.key)){
      block(event);
      const page=Math.max(80,scroll.clientHeight*.8),delta={ArrowDown:56,ArrowUp:-56,PageDown:page,PageUp:-page}[event.key];
      scroll.scrollTop=event.key==='Home'?0:event.key==='End'?scroll.scrollHeight:scroll.scrollTop+delta;
      return;
    }
    if(!decision.overlay && closest(target,policy().deniedSelectors)){block(event);return;}
    if(['ArrowLeft','ArrowRight'].includes(event.key) && policy().allowNavigationKeys && !decision.overlay && !textEntry(target))return;
    if(!decision.control) { block(event);return; }
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(event.key) && !textEntry(target) && !closest(target,'[role="slider"],input[type="range"]') && !closest(target,policy().keyboardSelectors))block(event);
  }
  const stopAtLayer = event => event.stopPropagation();
  function mount() {
    if(mounted)return;mounted=true;
    bind(doc,'click',click,true);bind(doc,'dblclick',click,true);
    bind(doc,'contextmenu',click,true);bind(doc,'submit',click,true);
    bind(doc,'change',click,true);bind(doc,'input',click,true);
    for(const type of ['pointerdown','mousedown','touchstart'])bind(doc,type,start,{capture:true,passive:false});
    for(const type of ['pointermove','pointerup','pointercancel','mousemove','mouseup','touchmove','touchend','touchcancel'])bind(doc,type,continuation,{capture:true,passive:false});
    bind(doc,'wheel',wheel,{capture:true,passive:false});
    bind(doc,'keydown',key,true);bind(doc,'focusin',focus,true);
    for(const type of ['pointerdown','pointermove','pointerup','pointercancel','mousedown','mousemove','mouseup','touchstart','touchmove','touchend','touchcancel'])bind(layer,type,stopAtLayer,false);
  }
  function destroy() {
    if(!mounted)return;mounted=false;starts.clear();blockedContact=false;
    for(const [node,type,handler,options] of bindings)node?.removeEventListener(type,handler,options);
    bindings.length=0;
  }
  return {mount,destroy};
}
