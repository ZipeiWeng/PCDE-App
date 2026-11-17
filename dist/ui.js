export function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

export function icon(name, className = '') {
  return `<svg class="icon ${escapeHTML(className)}" aria-hidden="true"><use href="#i-${escapeHTML(name)}"/></svg>`;
}

export function formatDate(iso) {
  const date = new Date(iso);
  return Number.isFinite(date.valueOf())
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
    : 'Date not recorded';
}

let afterClose = null;
export function openSheet({ title, eyebrow = '', body, onOpen, onClose }) {
  const dialog = document.getElementById('app-sheet');
  afterClose?.();
  afterClose = null;
  dialog.classList.remove('insight-sheet', 'water-arrival', 'card-sheet', 'card-visit-summary-sheet', 'card-history-sheet', 'insight-detail', 'insight-alert', 'vet-finder-sheet', 'vet-detail-sheet');
  document.getElementById('sheet-close').setAttribute('aria-label', 'Close');
  document.getElementById('sheet-title').textContent = title;
  document.getElementById('sheet-eyebrow').textContent = eyebrow;
  dialog.querySelector('.sheet-body').innerHTML = body;
  afterClose = onClose || null;
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  onOpen?.(dialog);
  return dialog;
}

export function closeSheet() {
  document.getElementById('app-sheet').close();
}

let toastTimer;
export function toast(message) {
  const target = document.getElementById('toast');
  clearTimeout(toastTimer);
  target.textContent = message;
  toastTimer = setTimeout(() => { target.textContent = ''; }, 3600);
}

document.getElementById('sheet-close').addEventListener('click', closeSheet);
document.getElementById('app-sheet').addEventListener('close', () => {
  // A close event can arrive after the same dialog has opened its next view.
  if (document.getElementById('app-sheet').open) return;
  const callback = afterClose;
  afterClose = null;
  callback?.();
});
