// Shared by every page: horizontal intent navigates, vertical intent scrolls.
export function swipeDirection(dx, dy) {
  return Math.abs(dx) >= 44 && Math.abs(dx) > Math.abs(dy) * 1.35 ? (dx > 0 ? -1 : 1) : 0;
}
export function installPageGestures(root, { enabled, onSwipe }) {
  let start = null;
  let suppressUntil = 0;
  root.addEventListener('pointerdown', event => {
    // Capture runs before a coach button can stop bubbling. A drag that starts
    // on the guide or another control belongs to that control, not the page.
    if (event.target.closest?.('.coach-layer,input,select,textarea,[contenteditable]:not([contenteditable="false"]),[data-page-scrubber],[data-liquid-ready]')) { start = null; return; }
    const control = event.target.closest?.('button,a,summary');
    // The central orb supports both tap-for-details and swipe-to-change-page.
    // Its gesture is still subject to the page/tutorial enabled gate below.
    if (control && control.id !== 'wellness-orb') { start = null; return; }
    if (!enabled() || (event.pointerType === 'mouse' && event.button !== 0)) return;
    start = { x: event.clientX, y: event.clientY, id: event.pointerId, moved: false };
  }, true);
  root.addEventListener('pointermove', event => {
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    start.moved ||= Math.hypot(dx, dy) > 12;
    if (Math.abs(dx) > 20 && Math.abs(dx) > Math.abs(dy) * 1.35 && event.cancelable) event.preventDefault();
  }, true);
  window.addEventListener('pointerup', event => {
    if (!start || start.id !== event.pointerId) return;
    const direction = swipeDirection(event.clientX - start.x, event.clientY - start.y);
    if (start.moved || direction) suppressUntil = performance.now() + 400;
    start = null;
    if (direction && enabled()) onSwipe(direction);
  }, true);
  window.addEventListener('pointercancel', () => { start = null; }, true);
  root.addEventListener('click', event => {
    if (performance.now() < suppressUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  document.addEventListener('keydown', event => {
    if (!enabled() || event.target.closest('input,textarea,select,[contenteditable=true]') || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      onSwipe(event.key === 'ArrowLeft' ? -1 : 1);
    }
  });
}
