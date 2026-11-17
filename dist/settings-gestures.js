// A completed horizontal gesture performs exactly one navigation action.
const excluded = '.coach-layer,input,select,textarea,[contenteditable]:not([contenteditable="false"]),.settings-device-model,[data-no-settings-swipe]';

const consumedUps = new WeakSet();

// A modal can tear down its recognizer while dismissing. Keep this short-lived
// click shield independent so that the release cannot activate the exposed app.
function shieldReleaseClick(win) {
  let timer;
  const cleanup = () => {
    win.removeEventListener('click', click, true);
    win.removeEventListener('pointerdown', cleanup, true);
    win.removeEventListener('blur', cleanup);
    (win.clearTimeout?.bind(win) || clearTimeout)(timer);
  };
  function click(event) {
    if (event.detail === 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cleanup();
  }
  win.addEventListener('click', click, true);
  win.addEventListener('pointerdown', cleanup, true);
  win.addEventListener('blur', cleanup);
  timer = (win.setTimeout?.bind(win) || setTimeout)(cleanup, 450);
  timer?.unref?.();
}

function installHorizontalGesture(root, { isEnabled, captureState, onSwipe, directions = ['left', 'right'], allowVerticalLiquid = false, threshold = 44, intentThreshold = 20, axisRatio = 1.35 }) {
  const doc = root.ownerDocument || document;
  const win = doc.defaultView || window;
  const pointers = new Set();
  let start = null;
  const hasSelection = () => {
    const selection = doc.getSelection?.();
    return selection && !selection.isCollapsed && String(selection).length > 0;
  };
  const cancel = () => { start = null; };
  function trackDown(event) {
    pointers.add(event.pointerId);
    if (pointers.size > 1 || event.isPrimary === false) cancel();
  }
  function down(event) {
    if (!isEnabled() || pointers.size > 1 || event.isPrimary === false ||
        (event.pointerType === 'mouse' && event.button !== 0) ||
        event.target.closest?.(excluded) || hasSelection()) return;
    const liquid = event.target.closest?.('[data-liquid-ready]');
    const verticalLiquid = liquid && allowVerticalLiquid && liquid.getAttribute?.('data-liquid-drag-axis') === 'y';
    // Sidebar choices intentionally support horizontal collapse gestures.
    // All other buttons/links/disclosures keep their own pointer interaction.
    // The coach exclusion above always wins, including during capture phase.
    if ((liquid && !verticalLiquid) || (!verticalLiquid && event.target.closest?.('button,a,summary'))) return;
    start = {
      x: event.clientX, y: event.clientY, id: event.pointerId,
      state: captureState?.(), axis: null,
    };
  }
  function move(event) {
    if (!start || start.id !== event.pointerId) return;
    if (!isEnabled() || hasSelection()) { cancel(); return; }
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (!start.axis) {
      if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) start.axis = 'vertical';
      else if (Math.abs(dx) >= intentThreshold && Math.abs(dx) > Math.abs(dy) * axisRatio) start.axis = 'horizontal';
    }
    if (start.axis === 'horizontal' && directions.includes(dx > 0 ? 'right' : 'left') && event.cancelable) event.preventDefault();
  }
  function up(event) {
    pointers.delete(event.pointerId);
    if (!start || start.id !== event.pointerId) return;
    const gesture = start;
    cancel();
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    const direction = dx > 0 ? 'right' : 'left';
    if (consumedUps.has(event) || !isEnabled() || hasSelection() || gesture.axis === 'vertical' ||
        !directions.includes(direction) || Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy) * axisRatio) return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation?.();
    consumedUps.add(event);
    shieldReleaseClick(win);
    onSwipe(direction, gesture.state);
  }
  function pointerCancel(event) {
    pointers.delete(event.pointerId);
    if (start?.id === event.pointerId) cancel();
  }
  function blur() { pointers.clear(); cancel(); }
  win.addEventListener('pointerdown', trackDown, true);
  root.addEventListener('pointerdown', down, true);
  win.addEventListener('pointermove', move, { capture:true, passive:false });
  win.addEventListener('pointerup', up, true);
  win.addEventListener('pointercancel', pointerCancel, true);
  win.addEventListener('blur', blur);
  return () => {
    blur();
    win.removeEventListener('pointerdown', trackDown, true);
    root.removeEventListener('pointerdown', down, true);
    win.removeEventListener('pointermove', move, true);
    win.removeEventListener('pointerup', up, true);
    win.removeEventListener('pointercancel', pointerCancel, true);
    win.removeEventListener('blur', blur);
  };
}

export function installSettingsGestures(root, {
  isSidebarOpen, onCollapse, onExpand, onExit, isEnabled = () => true,
}) {
  return installHorizontalGesture(root, {
    isEnabled,
    allowVerticalLiquid: true,
    threshold: 28,
    intentThreshold: 10,
    axisRatio: 1.2,
    captureState: isSidebarOpen,
    onSwipe(direction, sidebarOpen) {
      if (sidebarOpen) {
        if (direction === 'right') onExit();
        else onCollapse();
      } else if (direction === 'right') onExpand();
      else onExit();
    },
  });
}

export function installSwipeDismiss(root, { isEnabled = () => true, onDismiss, directions }) {
  return installHorizontalGesture(root, { isEnabled, onSwipe: onDismiss, directions });
}
