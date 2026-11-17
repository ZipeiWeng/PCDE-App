// The page dots can be scrubbed directly, independently of page swipes.
export function installPageScrubber(root, { enabled, onSelect }) {
  const win = root.ownerDocument.defaultView;
  const buttons = [...root.querySelectorAll('[data-position]')];
  let gesture = null;
  let suppressUntil = 0;
  const now = () => win.performance.now();

  function reset() {
    const previous = gesture;
    gesture = null;
    root.classList.remove('is-scrubbing');
    if (previous && root.hasPointerCapture?.(previous.id)) root.releasePointerCapture(previous.id);
  }
  function down(event) {
    if (gesture) { reset(); return; }
    if (!enabled() || event.isPrimary === false || event.button !== 0) return;
    suppressUntil = 0;
    gesture = { id:event.pointerId, x:event.clientX, y:event.clientY, axis:null, selected:null };
  }
  function move(event) {
    if (!gesture || gesture.id !== event.pointerId) return;
    if (!enabled()) { reset(); return; }
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (!gesture.axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
      gesture.axis = Math.abs(dx) > Math.abs(dy) * 1.35 ? 'x' : 'y';
      if (gesture.axis === 'x') {
        root.setPointerCapture?.(gesture.id);
        root.classList.add('is-scrubbing');
      }
    }
    if (gesture.axis !== 'x') return;
    if (event.cancelable) event.preventDefault();
    suppressUntil = now() + 450;
    const centers = buttons.map(button => {
      const rect = button.getBoundingClientRect();
      return { index:Number(button.dataset.position), x:rect.left + rect.width / 2 };
    });
    if (!centers.length) return;
    const nearest = centers.reduce((best, dot) => Math.abs(event.clientX - dot.x) < Math.abs(event.clientX - best.x) ? dot : best);
    const x = Math.max(Math.min(...centers.map(dot => dot.x)), Math.min(Math.max(...centers.map(dot => dot.x)), event.clientX));
    root.style.setProperty('--scrub-x', `${x - root.getBoundingClientRect().left}px`);
    if (gesture.selected !== nearest.index) {
      gesture.selected = nearest.index;
      onSelect(nearest.index);
    }
  }
  function up(event) {
    if (!gesture || gesture.id !== event.pointerId) return;
    move(event);
    if (gesture?.axis === 'x') suppressUntil = now() + 450;
    reset();
  }
  function cancel(event) {
    if (!event.pointerId || event.pointerId === gesture?.id) reset();
  }
  function lostCapture(event) {
    // A touch starts with implicit capture on its button. Moving capture to
    // the row emits a bubbling loss from that button; the row still owns it.
    if (event.target !== root || root.hasPointerCapture?.(event.pointerId)) return;
    cancel(event);
  }
  function otherPointer(event) {
    if (gesture && event.pointerId !== gesture.id) reset();
  }
  function blur(event) {
    if (!event.target || event.target === win) reset();
  }
  function click(event) {
    if (event.detail !== 0 && now() < suppressUntil) {
      suppressUntil = 0;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }
  const bindings = [
    [root,'pointerdown',down], [win,'pointerdown',otherPointer],
    [win,'pointermove',move], [win,'pointerup',up], [win,'pointercancel',cancel],
    [root,'lostpointercapture',lostCapture], [win,'blur',blur], [root,'click',click],
  ];
  bindings.forEach(([target,type,handler]) => target.addEventListener(type,handler,true));
  return () => {
    reset();
    bindings.forEach(([target,type,handler]) => target.removeEventListener(type,handler,true));
  };
}
