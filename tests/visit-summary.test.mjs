import test from 'node:test';
import assert from 'node:assert/strict';
import { groupVisitSummaryRecords } from '../dist/visit-summary.js';

test('preventive history stays visible even after many newer observations and medicines', () => {
  const vaccine = { id:'v', type:'vaccine', title:'Rabies entry', date:'2025-01-01', sample:true };
  const parasite = { id:'p', type:'parasite', title:'Flea treatment', date:'2025-02-01', details:'Flea treatment only' };
  const recent = Array.from({length:20},(_,i)=>({id:String(i),type:i%2?'observation':'medication',date:'2026-01-01'}));
  const records=[...recent,vaccine,parasite];
  const groups=groupVisitSummaryRecords(records);
  assert.deepEqual(groups.vaccine,[vaccine]);
  assert.deepEqual(groups.parasite,[parasite]);
  assert.equal(groups.medication.length,10);
  assert.equal(groups.observation.length,10);
  assert.equal(groups.parasite[0].title,'Flea treatment');
  assert.equal(groups.vaccine[0].sample,true);
});

test('summary grouping preserves source records, clinical detail and original collection order', () => {
  const prior={id:'a',type:'visit',date:'2024-01-01',diagnosis:'Recorded assessment',plan:'Recorded follow-up'};
  const recent={id:'b',type:'visit',date:'2025-01-01',medications:'Recorded medicine'};
  const retired={id:'c',type:'meal',date:'2025-02-01'};
  const records=[prior,recent,retired];
  const groups=groupVisitSummaryRecords(records);
  assert.deepEqual(groups.visit,[recent,prior]);
  assert.equal(groups.visit[1].plan,'Recorded follow-up');
  assert.deepEqual(records,[prior,recent,retired]);
  assert.equal(Object.values(groups).flat().length,2);
});

test('a green vaccination check accepts recorded past doses including legacy generic titles', async () => {
  const {isRecordedVaccination}=await import('../dist/visit-summary.js');
  const now=new Date('2026-11-13').valueOf();
  const named={type:'vaccine',title:'Rabies vaccine',date:'2026-10-01',details:'Administered at appointment.'};
  assert.equal(isRecordedVaccination(named,now),true);
  assert.equal(isRecordedVaccination({...named,title:'Vaccination recorded'},now),true);
  assert.equal(isRecordedVaccination({type:'vaccine',title:'Vaccination recorded',date:'2026-10-23'},now),true);
  for(const change of [{sample:true},{demo:true},{title:'Vaccination'},{title:'Rabies appointment'},{date:'2027-01-01'},{details:'Not administered due to illness.'},{details:'Not yet given.'},{details:'Scheduled for next week.'}]) assert.equal(isRecordedVaccination({...named,...change},now),false);
});

test('parasite care completion distinguishes past records from future, planned and unadministered entries',async()=>{
  const {isRecordedParasiteCare}=await import('../dist/visit-summary.js');
  const now=new Date('2026-11-13').valueOf();
  const past={type:'parasite',title:'Parasite care recorded',date:'2026-10-23'};
  for(const title of ['Parasite care recorded','Deworming completed','Flea and tick treatment']){
    assert.equal(isRecordedParasiteCare({...past,title},now),true);
  }
  for(const change of [
    {date:'2027-01-01'},{date:'invalid'},{type:'vaccine'},
    {title:'Deworming planned'},{title:'Flea treatment reminder'},
    {title:'Heartworm test only'},{details:'Not administered due to illness.'},
    {details:'Not yet given.'},{details:'No treatment recorded.'},{details:'未驱虫'},
  ]) assert.equal(isRecordedParasiteCare({...past,...change},now),false);
});

test('flea-only and unspecified parasite care are not relabelled as deworming', async () => {
  const {isDewormingRecord}=await import('../dist/visit-summary.js');
  assert.equal(isDewormingRecord({title:'Deworming tablet',details:'Recorded dose'}),true);
  assert.equal(isDewormingRecord({title:'体内驱虫'}),true);
  assert.equal(isDewormingRecord({title:'Flea and tick treatment'}),false);
  assert.equal(isDewormingRecord({title:'Heartworm test only'}),false);
  assert.equal(isDewormingRecord({title:'No deworming recorded'}),false);
  assert.equal(isDewormingRecord({title:'Parasite care recorded',details:'Product and schedule omitted.'}),false);
});

test('medical-history cards preserve the full case while showing a short reason and explicit location gaps', async () => {
  const {medicalHistoryPreview}=await import('../dist/visit-summary.js');
  const record={title:'Follow-up visit',symptoms:'Repeated coughing after exercise. '.repeat(9),clinic:'Example Animal Hospital',city:'London',diagnosis:'Recorded clinical assessment',plan:'Recorded full care plan'};
  const summary=medicalHistoryPreview(record);
  assert.equal(summary.reason.length<=100,true);
  assert.equal(summary.reason.endsWith('…'),true);
  assert.equal(summary.clinic,'Example Animal Hospital');
  assert.equal(summary.city,'London');
  assert.equal(record.symptoms.length>100,true);
  assert.equal(record.plan,'Recorded full care plan');
  assert.deepEqual(medicalHistoryPreview({title:'Wellness visit'}),{reason:'Wellness visit',clinic:'Clinic not recorded',city:'City not recorded'});
});
