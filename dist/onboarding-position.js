const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const number = (value, fallback) => Number.isFinite(value) ? value : fallback;

function rectangle(value = {}, width, height) {
  const left = number(value.left, number(value.x, 0));
  const top = number(value.top, number(value.y, 0));
  const right = number(value.right, left + number(value.width, 0));
  const bottom = number(value.bottom, top + number(value.height, 0));
  return {
    left: clamp(Math.min(left, right), 0, width),
    top: clamp(Math.min(top, bottom), 0, height),
    right: clamp(Math.max(left, right), 0, width),
    bottom: clamp(Math.max(top, bottom), 0, height),
  };
}

function overlap(a, b) {
  return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
}

function sideOf(note, target) {
  if (note.bottom <= target.top) return 'above';
  if (note.top >= target.bottom) return 'below';
  if (note.right <= target.left) return 'left';
  if (note.left >= target.right) return 'right';
  return 'reserved';
}

/** Position a floating caption without adding space to the underlying page. */
export function placeCoachNote({ width, height, target, noteWidth = 260, noteHeight = 70,
  margin = 20, gap = 24, bottomInset = 40, obstacles = [], preferredSide } = {}) {
  width = Math.max(0, number(width, 0));
  height = Math.max(0, number(height, 0));
  margin = Math.max(0, number(margin, 20));
  gap = Math.max(0, number(gap, 24));
  bottomInset = Math.max(0, number(bottomInset, 40));
  const insetX = Math.min(margin, width / 2);
  const insetTop = Math.min(margin, height / 2);
  // The bottom edge remains clear for the small guide controls and safe area.
  const insetBottom = Math.min(Math.max(bottomInset, margin), height - insetTop);
  const w = clamp(number(noteWidth, 260), 0, Math.max(0, width - insetX * 2));
  const h = clamp(number(noteHeight, 70), 0, Math.max(0, height - insetTop - insetBottom));
  const minX = insetX, maxX = Math.max(minX, width - insetX - w);
  const minY = insetTop, maxY = Math.max(minY, height - insetBottom - h);
  const focus = rectangle(target, width, height);
  const obstacleRects = new Map();
  for (const item of obstacles) {
    if (!item) continue;
    const rect = rectangle(item, width, height);
    if (rect.right <= rect.left || rect.bottom <= rect.top) continue;
    obstacleRects.set(`${rect.left}:${rect.top}:${rect.right}:${rect.bottom}`, rect);
  }
  const avoid = [...obstacleRects.values()];
  const cx = (focus.left + focus.right) / 2, cy = (focus.top + focus.bottom) / 2;
  const preferred = ['above', 'below', 'left', 'right'].includes(preferredSide)
    ? preferredSide : focus.top < height / 3 ? 'below' : 'above';
  const xs = [cx - w / 2, focus.left, focus.right - w, minX, maxX, (width - w) / 2];
  const ys = [focus.top - gap - h, focus.bottom + gap, cy - h / 2, minY, maxY];
  for (const rect of [focus, ...avoid]) {
    xs.push(rect.left - gap - w, rect.right + gap);
    ys.push(rect.top - gap - h, rect.bottom + gap);
  }
  // Most page text shares the same left/right edges. Clamp and deduplicate each
  // axis before taking its product, rather than scoring the same point repeatedly.
  const candidateX = [...new Set(xs.map(x => clamp(x, minX, maxX)))];
  const candidateY = [...new Set(ys.map(y => clamp(y, minY, maxY)))];
  const area = Math.max(1, w * h);
  let best;
  for (const left of candidateX) for (const top of candidateY) {
    const note = { left, top, right: left + w, bottom: top + h };
    const side = sideOf(note, focus);
    const targetOverlap = overlap(note, focus) / area;
    let collides = targetOverlap > 0;
    const distance = Math.hypot(left + w / 2 - cx, top + h / 2 - cy) / Math.max(1, Math.hypot(width, height));
    const alignment = Math.abs(left + w / 2 - cx) / Math.max(1, width);
    let score = (collides ? 1e6 : 0) + targetOverlap * 100000 +
      (side === preferred ? 0 : side === 'reserved' ? 30 : 8) + distance * 12 + alignment * 3;
    if (best && score >= best.score) continue;
    for (const rect of avoid) {
      const obstruction = overlap(note, rect) / area;
      if (obstruction && !collides) { score += 1e6; collides = true; }
      score += obstruction * 10000;
      // All remaining penalties are nonnegative, so this cannot become best.
      if (best && score >= best.score) break;
    }
    if (!best || score < best.score) best = { left, top, width: w, height: h, side, score };
  }
  const { score, ...position } = best;
  return position;
}


// Activity's caption is anchored to its fixed page indicators, never to a card
// that scrolls past. The content stays in place and scrolls above this dock.
export function placeActivityCoach({width,height,dotsTop,noteHeight=110}={}) {
  width=Math.max(0,number(width,0));height=Math.max(0,number(height,0));
  const w=Math.max(0,Math.min(350,width-40));
  const h=Math.max(0,number(noteHeight,110));
  const bottom=Math.min(height-90,number(dotsTop,height-60)-48);
  return {left:(width-w)/2,top:Math.max(20,bottom-h),width:w,height:h};
}

// The alert title describes the page; only its action caption points at the
// contact button. Keep those two messages in separate, non-overlapping zones.
export function placeAlertCoach({width,height,target,headingHeight=62,noteHeight=70,bottomInset=64}={}) {
  width=Math.max(0,number(width,0));height=Math.max(0,number(height,0));
  const w=Math.max(0,Math.min(300,width-44)),gap=32,margin=22;
  const focus=rectangle(target,width,height);
  const h=Math.max(0,number(headingHeight,62));
  const headingBottom=Math.min(height/2,focus.top-gap);
  const heading={left:(width-w)/2,top:clamp(height*.25-h/2,margin,Math.max(margin,headingBottom-h)),width:w,height:h,visible:headingBottom-h>=margin};
  const note=placeCoachNote({width,height,target:focus,noteWidth:w,noteHeight,margin,gap,bottomInset,preferredSide:'below',
    obstacles:heading.visible?[{...heading,right:heading.left+w,bottom:heading.top+h}]:[]});
  return {heading,note};
}
