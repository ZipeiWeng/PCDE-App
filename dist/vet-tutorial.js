import { exampleVetFeedback } from './vet-example-feedback.js';
// Fictional data used only inside the guided tour. Never used for real searches.
export function createVetTutorialResults(query='') {
  const names=['Willow · example clinic','Oak · example clinic','Clover · example clinic'];
  return {
    tutorial:true,
    center:{lat:0,lon:0,label:'Example area'},
    query:String(query).trim().slice(0,120),
    vets:names.map((name,index)=>({
      id:`tutorial/clinic-${index+1}`,name,lat:0,lon:0,
      distanceKm:[.6,1.2,1.8][index],
      address:`${[12,28,46][index]} Example Lane · fictional address`,
      phone:'Example phone number',website:null,openingHours:'Example: open until 20:00',
      tutorial:true,
    })),
  };
}

export function vetTutorialFeedback(vetId,condition='all') {
  return {...exampleVetFeedback(vetId,condition),tutorial:true};
}

// A deliberately schematic, offline map. It never implies these clinics exist
// near the address typed during practice and sends no location to a provider.
export function mountVetTutorialMap(root,{vets=[],onSelect=()=>{}}={}) {
  root.classList.add('vet-map-surface','vet-tutorial-map');
  root.setAttribute('role','region');
  root.setAttribute('aria-label','Illustrative map of fictional example clinics');
  root.dataset.noSettingsSwipe='';
  root.innerHTML=`<svg viewBox="0 0 360 240" preserveAspectRatio="none" aria-hidden="true"><rect width="360" height="240" fill="#e1e8e2"/><path d="M0 28 88 0 116 65 32 107ZM244 16 360 6 360 95 289 109ZM168 170 253 145 278 240 183 240Z" fill="#b9cfbc"/><path d="M-15 165 375 58M92 -10 168 250M296 -10 199 250" fill="none" stroke="#faf8ef" stroke-width="23"/><path d="M-15 165 375 58M92 -10 168 250M296 -10 199 250" fill="none" stroke="#c9d1cd" stroke-width="1"/><path d="M-10 211C80 178 55 244 166 211S262 143 371 177" fill="none" stroke="#b7d3dc" stroke-width="18"/></svg><span class="vet-tutorial-map-label">Illustrative map</span><span class="vet-map-search-point" style="left:49%;top:64%" title="Example search point"></span><div class="vet-map-markers"></div>`;
  const positions=vets.length===1?[[52,47]]:[[37,42],[72,38],[61,82]];
  const markers=root.querySelector('.vet-map-markers');
  const nodes=vets.map((vet,index)=>{
    const button=root.ownerDocument.createElement('button');
    button.type='button';button.className='vet-map-pin';button.textContent=String(index+1);
    button.setAttribute('aria-label',`${index+1}. ${vet.name}`);
    const [x,y]=positions[index]||[50,50];
    button.style.left=`${x}%`;button.style.top=`${y}%`;
    button.addEventListener('click',()=>{select(index);onSelect(index);});
    markers.append(button);return button;
  });
  function select(index){nodes.forEach((node,i)=>{node.classList.toggle('is-selected',i===index);node.setAttribute('aria-pressed',String(i===index));});}
  return {select,fit(){},destroy(){root.classList.remove('vet-tutorial-map');root.replaceChildren();}};
}
