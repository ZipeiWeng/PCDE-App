// Keep confirmed words still when a live recognition result appends or revises
// its ending. Animation never manufactures words or delays transcript updates.
const graphemes=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'grapheme'}):null;
function speechTokens(text) {
  // Whitespace marks English words, but continuous CJK speech needs smaller
  // units so an appended character never restarts the whole sentence's fade.
  return String(text||'').split(/((?:[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]\p{M}*)+)/u).flatMap((part,index)=>
    index%2 ? graphemes?Array.from(graphemes.segment(part),item=>item.segment):Array.from(part) : part.match(/\S+\s*|\s+/gu)||[]
  );
}
export function transcriptParts(previous, next) {
  const before=speechTokens(previous);
  const after=speechTokens(next);
  let stable=0;
  while(stable<before.length&&stable<after.length&&before[stable]===after[stable])stable++;
  return after.map((text,index)=>({text,fresh:index>=stable}));
}

export function paintWords(node,text,{live=false,reveal=false}={}) {
  const previous=node.dataset.words||'';
  if(previous===text&&!reveal)return;
  node.dataset.words=text;
  const doc=node.ownerDocument;
  if(!doc?.createTextNode){node.textContent=text;return;}
  const parts=transcriptParts(live?previous:'',text);
  node.replaceChildren(...parts.map(({text,fresh},index)=>{
    const span=doc.createElement('span');span.textContent=text;
    span.className=(reveal||live&&fresh)?'companion-word is-entering':'companion-word';
    if(reveal)span.style.setProperty('--word-delay',`${Math.min(index*28,850)}ms`);
    return span;
  }));
}

export function replyParticles() {
  return `<span class="reply-particles" aria-hidden="true">${Array.from({length:30},(_,i)=>{
    const angle=i*2.39996,radius=12+(i%7)*5;
    return `<i style="--px:${(Math.cos(angle)*radius).toFixed(1)}px;--py:${(Math.sin(angle)*radius*.52).toFixed(1)}px;--delay:${-(i%9)*.21}s;--size:${i%5===0?3:1.7}px"></i>`;
  }).join('')}</span><span class="sr-only">Thinking…</span>`;
}
