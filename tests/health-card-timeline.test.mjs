import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.document={getElementById:()=>({addEventListener(){}})};
const { initHealthCard } = await import('../dist/health-card.js');

function cardMarkup(records,tab='timeline',filter='all') {
  const handlers={};
  globalThis.document={getElementById:()=>({})};
  const root={ownerDocument:{},innerHTML:'',addEventListener:(type,handler)=>{handlers[type]=handler;},contains:()=>true,querySelector:()=>null};
  initHealthCard(root,{getStore:()=>({profile:{name:'Pip',breed:'Mixed',age:3,weight:12},records}),getSnapshot:()=>({}),getRole:()=> 'owner',persist:()=>true,onChange(){}});
  const click=dataset=>handlers.click({target:{closest:()=>({dataset})}});
  click({cardTab:tab});
  if(filter!=='all')click({cardFilter:filter});
  return root.innerHTML;
}
const timeline=(records,filter='all')=>cardMarkup(records,'timeline',filter);
const careIcons=markup=>[...markup.matchAll(/<svg class="icon medical-icon\b[^]*?<\/svg>/g)].map(match=>match[0]);
const summaryModule=(markup,id,nextId)=>markup.slice(markup.indexOf(`data-summary-module="${id}"`),markup.indexOf(`data-summary-module="${nextId}"`));

test('Timeline is newest-first and each event exposes its date before title and concise content',()=>{
  const markup=timeline([
    {id:'old',type:'observation',title:'Older note',date:'2026-10-02',details:'Earlier detail'},
    {id:'new',type:'visit',title:'Latest visit',date:'2026-11-12T14:35:00Z',symptoms:'Recent detail',sample:true},
  ]);
  assert.match(markup,/<ol class="card-timeline" aria-label="Health history, newest first">/);
  assert.ok(markup.indexOf('data-card-record="new"')<markup.indexOf('data-card-record="old"'));
  const event=markup.slice(markup.indexOf('data-card-record="new"'),markup.indexOf('</li>'));
  assert.ok(event.indexOf('<time')<event.indexOf('Latest visit'));
  assert.ok(event.indexOf('Latest visit')<event.indexOf('Recent detail'));
  assert.match(event,/<time[^>]*>[^<]*\d{2}:\d{2}[^<]*<\/time>/);
  assert.match(event,/card-timeline-source">Sample/);
  assert.match(markup,/<button type="button" class="card-timeline-event"/);
});

test('date-only and scanned records do not invent times, and event text remains escaped',()=>{
  const markup=timeline([
    {id:'date-only',type:'visit',title:'<img onerror=alert(1)>',date:'2026-10-02',details:'A & B'},
    {id:'scan',type:'visit',title:'Scanned note',date:'2026-11-12T12:00:00Z',source:'scan',details:'Reviewed document'},
  ]);
  for(const [,label] of markup.matchAll(/<time[^>]*>([^<]*)<\/time>/g))assert.doesNotMatch(label,/\d{2}:\d{2}/);
  assert.match(markup,/Scanned · owner reviewed/);
  assert.match(markup,/&lt;img onerror=alert\(1\)&gt;/);assert.match(markup,/A &amp; B/);
  assert.doesNotMatch(markup,/<img onerror/);
});

test('Timeline filtering retains total category counts and shared care markers while excluding retired meals',()=>{
  const records=[
    {id:'vaccine',type:'vaccine',title:'Rabies vaccination recorded',date:'2024-04-18T10:30:00Z',details:'Rabies vaccination recorded before a trip. A fictional travel document entry was completed by the clinic.',sample:true,author:'Vet demo'},
    {id:'worms',type:'parasite',title:'Deworming completed',date:'2026-11-11',details:'Treatment recorded'},
    {id:'meal',type:'meal',title:'Retired meal',date:'2026-11-13',details:'Old entry'},
  ];
  const all=timeline(records),filtered=timeline(records,'vaccine');
  assert.match(all,/medical-icon--vaccine/);assert.match(all,/medical-icon--deworming/);
  assert.doesNotMatch(all,/Retired meal/);
  assert.match(filtered,/data-card-filter="all">All<span class="card-filter-count">2<\/span>/);
  assert.match(filtered,/data-card-record="vaccine"/);assert.doesNotMatch(filtered,/data-card-record="worms"/);
});

test('legacy vaccination and all parasite care share consistent markers in Summary and Timeline',()=>{
  const records=[
    {id:'internal',type:'parasite',title:'Deworming completed',date:'2024-04-01',details:'Treatment recorded'},
    {id:'legacy-vaccine',type:'vaccine',title:'Vaccination recorded',date:'2024-05-01',sample:true},
    {id:'unspecified',type:'parasite',title:'Parasite care recorded',date:'2024-06-01',details:'Product not recorded',sample:true},
    {id:'named-vaccine',type:'vaccine',title:'DHP booster',date:'2024-03-01',details:'Administered by vet'},
    {id:'external',type:'parasite',title:'Flea and tick treatment',date:'2024-05-01',details:'Treatment recorded'},
  ];
  const summary=cardMarkup(records,'overview'),history=timeline(records);
  const vaccines=summaryModule(summary,'vaccination','parasite');
  const parasite=summaryModule(summary,'parasite','medication');
  assert.equal((summary.match(/data-summary-module="parasite"/g)||[]).length,1);
  assert.doesNotMatch(summary,/Other parasite care|data-summary-module="deworming"/);
  assert.match(parasite,/<h3>Parasite care<\/h3><span class="card-summary-count">3<\/span>/);
  assert.ok(parasite.indexOf('Parasite care recorded')<parasite.indexOf('Flea and tick treatment'));
  assert.ok(parasite.indexOf('Flea and tick treatment')<parasite.indexOf('Deworming completed'));
  assert.equal((vaccines.match(/medical-icon--vaccine/g)||[]).length,2);
  assert.doesNotMatch(vaccines,/#i-plus/);
  assert.equal((parasite.match(/medical-icon--deworming/g)||[]).length,3);
  assert.match(parasite,/aria-label="Deworming record"/);
  assert.match(parasite,/aria-label="Parasite care record"/);
  assert.match(parasite,/aria-label="Sample · Parasite care record"/);
  assert.deepEqual(careIcons(summary).sort(),careIcons(history).sort());
  assert.equal(careIcons(summary).length,5);
});

test('future, planned and unadministered parasite records keep the same base icon without a completion check',()=>{
  const records=[
    {id:'future',type:'parasite',title:'Flea treatment',date:'2099-01-01'},
    {id:'planned',type:'parasite',title:'Deworming planned',date:'2024-06-01'},
    {id:'not-given',type:'parasite',title:'Parasite care note',date:'2024-05-01',details:'Not yet administered.'},
  ];
  for(const markup of [cardMarkup(records,'overview'),timeline(records)]){
    const icons=careIcons(markup);
    assert.equal(icons.length,3);
    for(const svg of icons){
      assert.match(svg,/medical-icon--deworming/);
      assert.match(svg,/stroke="#273138"/);
      assert.doesNotMatch(svg,/stroke="#63a14b"/);
    }
  }
});
