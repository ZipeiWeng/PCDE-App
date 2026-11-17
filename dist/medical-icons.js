const escapeAttribute = value => String(value ?? '').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const green = '#63a14b';

const markers = {
  vaccine: {
    label:'Vaccination record',
    viewBox:'0 0 24 24',
    paths:`<path d="m4.8 12.5 4.6 4.6L19.4 6.9" fill="none" stroke="${green}" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  deworming: {
    label:'Deworming record',
    viewBox:'0 0 32 32',
    paths:`<g fill="none" stroke="#929da5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m11.9 10-2-2.4M16.1 10l2-2.4M8.6 15.7 4.7 13.9M8.2 20H3.8m5 4-3.7 2.4m14.3-10.7 3.9-1.8M19.8 20h4.4M19.2 24l3.7 2.4"/></g><ellipse cx="14" cy="20" rx="5.8" ry="7.4" fill="#a2abb2" stroke="none"/><circle cx="14" cy="11.9" r="3.2" fill="#929da5" stroke="none"/><path d="M14 15.6v10" fill="none" stroke="#cdd3d7" stroke-width="1.3" stroke-linecap="round"/><path d="m5.6 28 18.7-18" fill="none" stroke="#273138" stroke-width="2.5" stroke-linecap="round"/>`,
    check:`<path d="m18.8 25.1 3.9 3.9 6.9-7.5" fill="none" stroke="${green}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
};

// Self-contained labels avoid duplicate SVG IDs when a card lists many records.
// Callers choose the marker only when the record supports that care category.
export function medicalIcon(kind,{label,className='',recorded=true}={}) {
  if(!Object.hasOwn(markers,kind))throw new TypeError('Unknown medical marker.');
  const marker=markers[kind];
  return `<svg class="icon medical-icon medical-icon--${kind}${className?' '+escapeAttribute(className):''}" viewBox="${marker.viewBox}" role="img" aria-label="${escapeAttribute(label||marker.label)}" focusable="false">${marker.paths}${recorded ? marker.check || '' : ''}</svg>`;
}
