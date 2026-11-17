// Small, decorative gesture demonstrations. All interaction stays on the real page.
const hand = `<g class="gesture-hand"><path class="gesture-hand-shape" d="M96 87V54c0-9 12-9 12 0v22c3-7 13-5 13 3v3c4-6 13-3 13 4v4c5-5 13-1 13 7v7c0 16-12 27-26 26-9 0-17-4-24-10L80 104c-8-7 0-18 7-12l9 7"/><path class="gesture-hand-detail" d="M108 77v18m13-13v15m13-7v10"/></g>`;
const svg = (body, cls = '', viewBox = '0 0 200 150') => `<svg class="coach-motion ${cls}" viewBox="${viewBox}" aria-hidden="true" focusable="false">${body}</svg>`;
const phone = `<rect class="motion-phone" x="71" y="8" width="60" height="113" rx="13"/><path class="motion-phone-detail" d="M94 17h14m-16 95h18"/>`;
const glyphs = {
  record: '<path d="M10 3h14l8 8v26H10zM24 3v9h8M16 20h10m-10 7h10"/>',
  scan: '<path d="M9 13V7h6m14 0h6v6M9 29v6h6m14 0h6v-6M5 21h34"/>',
  plus: '<path d="M22 9v24M10 21h24"/>',
  photo: '<rect x="6" y="6" width="32" height="30" rx="7"/><path d="m7 29 10-10 8 8 5-5 8 8"/><circle cx="28" cy="15" r="3"/>',
  frost: '<path d="M22 4v34M7 12l30 18M7 30l30-18m-20-4 5 5 5-5m-10 26 5-5 5 5M7 19l7-2-1-7m18 22-1-7 7-2M7 23l7 2-1 7m18-22-1 7 7 2"/>',
  paw: '<path d="M12 29c0-4 6-11 10-11s10 7 10 11c0 5-5 6-10 3-5 3-10 2-10-3Z"/><ellipse cx="10" cy="17" rx="3" ry="4"/><ellipse cx="18" cy="10" rx="3" ry="4"/><ellipse cx="27" cy="10" rx="3" ry="4"/><ellipse cx="35" cy="17" rx="3" ry="4"/>',
  heart: '<path d="M22 35 7 21C-4 10 12-1 22 12 32-1 48 10 37 21Z"/><path d="M9 22h7l4-8 5 14 4-6h6"/>',
  temperature: '<path d="M17 23V10a5 5 0 0 1 10 0v13a9 9 0 1 1-10 0ZM22 12v16m11-16h5m-5 8h5"/><circle cx="22" cy="30" r="2"/>',
  steps: '<ellipse cx="13" cy="15" rx="5" ry="9" transform="rotate(20 13 15)"/><ellipse cx="29" cy="24" rx="5" ry="9" transform="rotate(-20 29 24)"/><circle cx="9" cy="30" r="3"/><circle cx="33" cy="9" r="3"/>',
  moon: '<path d="M29 30A16 16 0 0 1 15 5a16 16 0 1 0 24 22 16 16 0 0 1-10 3Z"/><path d="M32 5v10m-5-5h10"/>',
  pin: '<path d="M34 17c0 10-12 22-12 22S10 27 10 17a12 12 0 1 1 24 0Z"/><circle cx="22" cy="17" r="4"/>',
  call: '<path d="m9 5 7 1 3 9-5 4c3 6 6 9 12 12l4-5 9 3 1 7c-1 7-14 4-23-4S3 12 9 5Z"/>',
  star: '<path d="m22 3 6 12 13 2-9 10 2 13-12-6-12 6 2-13-9-10 13-2Z"/>',
  mic: '<rect x="15" y="3" width="14" height="24" rx="7"/><path d="M9 19v2a13 13 0 0 0 26 0v-2M22 34v7m-6 0h12"/>',
  keyboard: '<rect x="3" y="8" width="38" height="28" rx="6"/><path d="M10 16h1m7 0h1m7 0h1m7 0h1M10 23h1m7 0h1m7 0h1m7 0h1M12 30h20"/>',
  message: '<path d="M8 6h28a5 5 0 0 1 5 5v18a5 5 0 0 1-5 5H18L7 41V34a5 5 0 0 1-4-5V11a5 5 0 0 1 5-5Z"/><path d="M12 16h20m-20 9h13"/>',
};
const labels = {
  records: [['Scan', 'Add'], ['扫描', '添加']],
  settings: [['Photo', 'Frost', 'Pattern'], ['图片', '磨砂', '暗纹']],
  activity: [['Heart', 'Temp', 'Steps', 'Sleep'], ['心率', '温度', '步数', '睡眠']],
  clinic: [['Address', 'Contact', 'Reviews'], ['地址', '联系', '评价']],
  assistant: [['Speak', 'Type'], ['语音', '文字']],
};
function iconRow(kind, language) {
  const names = { records:['scan','plus'], settings:['photo','frost','paw'], activity:['heart','temperature','steps','moon'], clinic:['pin','call','star'], assistant:['mic','keyboard'] }[kind];
  const words = labels[kind][language === 'zh' ? 1 : 0];
  return `<div class="motion-icon-row is-${kind}" aria-hidden="true">${names.map((name,i)=>`<span class="motion-icon-item">${svg(glyphs[name],`motion-glyph is-${name}`,'0 0 44 44')}<small>${words[i]}</small></span>`).join('')}</div>`;
}
export function coachVisual(kind, language = 'en') {
  let art = '';
  if (kind === 'tap') art = svg(`${phone}<circle class="tap-mark" cx="102" cy="51" r="6"/><circle class="tap-echo" cx="102" cy="51" r="12"/>${hand}`, 'is-tap');
  if (kind === 'swipe') art = svg(`<rect class="motion-ghost" x="39" y="15" width="60" height="101" rx="12"/>${phone}<g class="motion-page"><rect x="79" y="28" width="44" height="63" rx="7"/><path d="M91 41h20m-20 9h14"/></g><path class="swipe-direction" d="M48 51h101m-12-12 12 12-12 12"/>${hand}`, 'is-swipe');
  if (kind === 'swipe-return') art = svg(`<rect class="return-home-frame" x="47" y="13" width="76" height="111" rx="18"/><path class="return-home-icon" d="m69 64 16-14 16 14m-27-4v24h22V60m-15 24V72h8v12"/><g class="return-sheet"><rect x="47" y="13" width="76" height="111" rx="18"/><path d="M72 24h26M65 43h40m-40 10h26"/></g><path class="return-trail" d="M56 73h96m-11-11 11 11-11 11"/>${hand}`, 'is-swipe-return');
  if (kind === 'fold') art = svg(`<rect class="fold-heading" x="37" y="20" width="126" height="28" rx="10"/><path class="fold-chevron" d="m142 31 5 5 5-5"/><path class="fold-heading-line" d="M50 34h52"/><g class="fold-records"><rect x="45" y="58" width="110" height="22" rx="8"/><rect x="45" y="89" width="110" height="22" rx="8"/><path d="M57 69h63m-63 31h41"/></g>${hand}`, 'is-fold');
  if (kind === 'connect') art = svg(`<g class="connect-phone"><rect class="motion-phone" x="124" y="21" width="47" height="91" rx="11"/><path class="motion-phone-detail" d="M141 30h13m-16 72h18"/></g><g class="connect-collar"><path d="M30 51H19v37h11m51-37h12v37H81"/><rect x="29" y="43" width="54" height="52" rx="13"/><rect x="38" y="54" width="36" height="28" rx="8"/><path d="M48 65v7m8-7v7m8-7v7"/></g><g class="connect-signal"><circle cx="104" cy="68" r="3"/><path d="M108 55q12 13 0 26m5-33q18 20 0 40"/></g><path class="connect-check" d="m139 68 6 6 12-14"/>`, 'is-connect');
  // Colour teaching updates the actual water orb via labeled controls.
  // A second set of decorative mini-orbs would compete with that target.
  if (kind === 'search') art = svg(`<rect class="search-field" x="25" y="51" width="150" height="49" rx="19"/><circle class="search-lens" cx="47" cy="74" r="8"/><path class="search-lens" d="m53 80 6 6"/><path class="search-text" d="M76 74h46"/><path class="search-enter" d="M141 75h17m-6-6 6 6-6 6"/><g class="search-pin"><path d="M113 24c0 11-13 24-13 24S87 35 87 24a13 13 0 0 1 26 0Z"/><circle cx="100" cy="24" r="4"/></g>`, 'is-search');
  if (labels[kind]) art = iconRow(kind, language);
  return art ? `<div class="coach-visual is-${kind}" aria-hidden="true">${art}</div>` : '';
}
