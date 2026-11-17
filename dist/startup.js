// A short transition after authentication succeeds; never a page-load gate.
export function initSessionLoader(shell, { duration = 1000 } = {}) {
  const doc = shell.ownerDocument, win = doc.defaultView;
  const screen = shell.querySelector('#startup-screen');
  const progress = screen.querySelector('[data-startup-progress]');
  const fill = screen.querySelector('[data-startup-fill]');
  let current = null;

  function clear(job) {
    win.cancelAnimationFrame(job.frame);
    win.clearTimeout(job.timeout);
    for (const [node, inert] of job.surfaces) node.inert = inert;
    shell.removeAttribute('aria-busy');
    screen.hidden = true;
    if (current === job) current = null;
  }
  function cancel() {
    if (!current) return;
    const job = current;
    job.controller.abort();
    clear(job);
    job.resolve(false);
  }
  function run(prepare = () => {}) {
    cancel();
    let resolve, reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    const job = {
      resolve, reject, promise, ready: false, frame: null,
      startedAt: win.performance.now(), controller: new AbortController(),
      surfaces: [...shell.children].filter(node => node !== screen).map(node => [node, Boolean(node.inert)]),
    };
    current = job;
    for (const [node] of job.surfaces) node.inert = true;
    doc.activeElement?.blur?.();
    shell.setAttribute('aria-busy', 'true');
    screen.hidden = false;
    fill.style.transform = 'scaleX(0)';
    progress.setAttribute('aria-valuenow', '0');
    progress.setAttribute('aria-valuetext', 'Opening Pawprint');

    function tick() {
      if (current !== job) return;
      const elapsed = win.performance.now() - job.startedAt;
      // This bar describes the opening transition, not a network-download estimate.
      const fraction = Math.max(0, Math.min(job.ready ? 1 : .9, elapsed / duration));
      fill.style.transform = `scaleX(${fraction})`;
      progress.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
      if (job.ready && elapsed >= duration) {
        progress.setAttribute('aria-valuetext', 'Pawprint ready');
        clear(job);
        resolve(true);
        return;
      }
      job.frame = win.requestAnimationFrame(tick);
    }
    function failed(error) {
      if (current !== job) return;
      job.controller.abort();
      clear(job);
      reject(error);
    }
    job.timeout = win.setTimeout(() => failed(new Error('Pawprint could not open. Please try again.')), 15_000);
    job.frame = win.requestAnimationFrame(tick);
    Promise.resolve().then(() => {
      if (current === job) return prepare(job.controller.signal);
    }).then(() => { if (current === job) job.ready = true; }, failed);
    return promise;
  }
  return { run, cancel, get active() { return current !== null; } };
}
