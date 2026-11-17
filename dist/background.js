import { normalizeBackgroundFrost } from './model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const filters = new WeakMap();
let filterSequence = 0;

// The middle value preserves the established 24 px microfacet scatter. Frost
// changes light scattering and grain, never the opacity of the photograph.
export function backgroundFrostSettings(value) {
  const intensity = normalizeBackgroundFrost(value);
  return {
    intensity,
    scatter: intensity * .4,
    grain: Number((intensity * .16 / 60).toFixed(4)),
    integration: Math.min(1, intensity / 60),
  };
}

function createFilter(shell) {
  const doc = shell.ownerDocument;
  const create = (name, attributes, parent) => {
    const node = doc.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes || {})) node.setAttribute(key, String(value));
    parent?.appendChild(node);
    return node;
  };
  const id = `pawprint-background-frost-${++filterSequence}`;
  const svg = create('svg', { width:0, height:0, 'aria-hidden':'true', focusable:'false', class:'background-frost-filter' });
  const defs = create('defs', {}, svg);
  const filter = create('filter', { id, x:'-4%', y:'-4%', width:'108%', height:'108%', 'color-interpolation-filters':'sRGB' }, defs);
  create('feTurbulence', { type:'fractalNoise', baseFrequency:'.64 .71', numOctaves:2, seed:17, stitchTiles:'stitch', result:'etch' }, filter);
  create('feColorMatrix', { in:'etch', type:'matrix', values:'2.2 0 0 0 -.6 0 2.2 0 0 -.6 0 0 1 0 0 0 0 0 1 0', result:'facets' }, filter);
  const displacement = [['R','G','first'],['R','G','second'],['G','B','third'],['G','B','fourth']].map(([x,y,result]) =>
    create('feDisplacementMap', { in:'SourceGraphic', in2:'facets', scale:0, xChannelSelector:x, yChannelSelector:y, result }, filter));
  create('feComposite', { in:'first', in2:'second', operator:'arithmetic', k2:.5, k3:.5, result:'pairA' }, filter);
  create('feComposite', { in:'third', in2:'fourth', operator:'arithmetic', k2:.5, k3:.5, result:'pairB' }, filter);
  create('feComposite', { in:'pairA', in2:'pairB', operator:'arithmetic', k2:.5, k3:.5, result:'scatter' }, filter);
  create('feConvolveMatrix', { in:'scatter', order:3, kernelMatrix:'1 1 1 1 2 1 1 1 1', divisor:10, preserveAlpha:true, edgeMode:'duplicate', result:'integrated' }, filter);
  const integration = create('feComposite', { in:'integrated', in2:'scatter', operator:'arithmetic', k2:1, k3:0 }, filter);
  shell.appendChild(svg);
  shell.style.setProperty('--background-refraction', `url("#${id}")`);
  const state = { svg, displacement, integration, intensity:null };
  filters.set(shell, state);
  return state;
}

export function applyBackgroundFrost(shell, value) {
  const settings = backgroundFrostSettings(value);
  if (!shell?.ownerDocument) return settings;
  let state = filters.get(shell);
  if (!state || !state.svg.isConnected) state = createFilter(shell);
  if (state.intensity === settings.intensity) return settings;
  state.displacement.forEach((node, index) => node.setAttribute('scale', String(settings.scatter * (index % 2 ? -1 : 1))));
  state.integration.setAttribute('k2', String(settings.integration));
  state.integration.setAttribute('k3', String(1 - settings.integration));
  shell.style.setProperty('--background-grain', String(settings.grain));
  shell.dataset.frost = String(settings.intensity);
  state.intensity = settings.intensity;
  return settings;
}
