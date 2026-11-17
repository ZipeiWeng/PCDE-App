// A fictional, dated history for the demonstration pet. These are archived
// examples, not prescribing instructions, verified records or a care schedule.
export const MOCHI_HISTORY_VERSION = 3;
export const MOCHI_DEMO_ESSENTIALS = Object.freeze({
  allergies:'Environmental pollen sensitivity (fictional demo).',
  conditions:'Seasonal dermatitis — controlled; routine follow-up (fictional demo).',
});

const legacyCareText = {
  'mochi-history-v1-vac-06': {
    details:'Rabies vaccination recorded for a planned trip. A fictional travel document entry was completed by the clinic.',
  },
  'mochi-history-v1-visit-06': {
    diagnosis:'The example clinician assessment records an inflammatory skin flare; a definitive allergy was not established.',
    plan:'At the documented review, scratching had settled and no open lesions remained.',
  },
  'mochi-history-v1-visit-10': {
    diagnosis:'No active concern was identified in this fictional visit. Previous episodes were reviewed as resolved.',
    plan:'Vaccination and parasite-care documents were reconciled with the owner’s diary.',
  },
};
const clinic = 'Willow Park Veterinary · fictional';
const riverside = 'Riverside Animal Clinic · fictional';
const city = 'London';
const entry = (id,type,title,date,details,extra={}) => ({
  id:`mochi-history-v1-${id}`,type,title,date:`${date}T10:30:00.000Z`,
  details,sample:true,author:'Vet demo',clinic,city,...extra,
});
const vaccine = (id,title,date,details) => entry(id,'vaccine',title,date,details);
const parasite = (id,title,date,details) => entry(id,'parasite',title,date,details,{author:'Owner'});
const medicine = (id,title,date,details,extra={}) => entry(id,'medication',title,date,details,{dose:'Archived course · completed',...extra});
const visit = (id,title,date,symptoms,diagnosis,medications,plan,details,extra={}) => entry(id,'visit',title,date,details,{doctor:'Dr Morgan · fictional',symptoms,diagnosis,medications,plan,...extra});

const records = [
  vaccine('vac-01','DHP · first puppy vaccination','2023-05-12','Distemper, hepatitis and parvovirus vaccination recorded at the puppy visit. No immediate reaction was noted in the sample clinic record.'),
  vaccine('vac-02','Leptospirosis · first vaccination','2023-05-12','First leptospirosis vaccination entered in the puppy health booklet. The owner reported no reaction after returning home.'),
  vaccine('vac-03','DHP · second puppy vaccination','2023-06-09','Second puppy DHP vaccination recorded. Product and batch were checked by the fictional clinic team.'),
  vaccine('vac-04','Leptospirosis · second vaccination','2023-06-09','Second leptospirosis vaccination entered in the clinic history. The visit note records an uneventful recovery.'),
  vaccine('vac-05','Kennel cough · vaccination','2023-09-15','Bordetella vaccination recorded before a boarding stay. The boarding paperwork was updated at this visit.'),
  vaccine('vac-06','Rabies · travel vaccination','2024-04-18','Rabies vaccination recorded before a trip. A fictional travel document entry was completed by the clinic.'),
  vaccine('vac-07','Leptospirosis · booster recorded','2025-06-12','Booster vaccination documented during a routine examination. No reaction was reported in the follow-up note.'),
  vaccine('vac-08','DHP · booster recorded','2026-11-12','Booster vaccination entered in the archived clinic record. This example describes a past event, not current protection or a recommended interval.'),

  parasite('par-01','Deworming · roundworm & tapeworm','2024-05-03','Clinic-supplied oral deworming treatment recorded as given. The owner noted no change in appetite or behaviour afterwards.'),
  parasite('par-02','Deworming · autumn record','2024-10-01','An oral deworming treatment was logged against the existing veterinary plan. Administration was confirmed by the owner.'),
  parasite('par-03','Deworming · spring record','2025-04-01','Past intestinal-worm treatment entered from the owner’s care diary. The product was supplied by the fictional clinic.'),
  parasite('par-04','Flea & tick treatment','2025-06-09','A veterinarian-supplied flea and tick treatment was recorded after a countryside trip. No attached ticks were seen at the check.'),
  parasite('par-05','Deworming · autumn record','2025-10-01','Owner confirmed completion of the prescribed deworming treatment. No reaction was recorded in the sample diary.'),
  parasite('par-06','Deworming · spring record','2026-04-02','An intestinal-worm treatment was logged during a review of the previous care plan. This entry records a completed past treatment.'),
  parasite('par-07','Flea & tick treatment','2026-08-21','Flea and tick treatment entered by the owner. Coat and skin were noted as comfortable at the subsequent check.'),
  parasite('par-08','Deworming · completed treatment','2026-10-02','Clinic-dispensed deworming treatment recorded as administered. The care diary notes normal behaviour afterwards.'),
  parasite('par-09','Flea & tick treatment','2026-11-11','A completed flea and tick treatment was added before the annual review. No skin reaction was recorded.'),

  medicine('med-01','Ear cleanser · completed','2023-11-06','Veterinary ear cleanser was used during the documented left-ear treatment. The owner recorded improved comfort at the follow-up.',{clinic:riverside}),
  medicine('med-02','Prescription ear drops · completed','2023-11-06','A clinic-prescribed otic course was completed for the documented ear episode. The recheck note records no ongoing head shaking.',{clinic:riverside}),
  medicine('med-03','Paw antiseptic care · completed','2024-03-19','The prescribed topical care for the superficial paw wound was completed. The owner’s follow-up entry records a closed wound and normal walking.'),
  medicine('med-04','Veterinary probiotic · completed','2024-08-22','A short veterinarian-directed probiotic course was logged during recovery from a digestive episode. The final diary entry records resolution.'),
  medicine('med-05','Prescription itch treatment · completed','2025-02-14','A short clinic-prescribed antipruritic course was recorded for the skin flare. Scratching had settled at the documented review.'),
  medicine('med-06','Medicated skin wash · completed','2025-02-14','The veterinarian’s topical skin-care course was completed alongside the recorded skin treatment. No adverse reaction was noted.'),
  medicine('med-07','Prescription pain relief · completed','2025-07-03','Veterinary analgesia was recorded after the left-forelimb examination. The archived follow-up describes a return to a comfortable gait.',{clinic:riverside}),
  medicine('med-08','Post-dental pain relief · completed','2026-11-10','The clinic-prescribed post-procedure medicine course was logged as completed. The telephone follow-up records comfortable chewing and normal behaviour.'),

  visit('visit-01','First puppy health check','2023-05-12',
    'New-puppy examination and review of the breeder’s paperwork.',
    'The fictional examination recorded a bright, responsive puppy with no concern identified at that visit.',
    'Puppy vaccinations recorded separately; no other medicine entered.',
    'The clinic documented a follow-up appointment and supplied a puppy health booklet.',
    'First clinic record. Weight, identification details and the vaccination booklet were reviewed.'),
  visit('visit-02','Left-ear irritation','2023-11-06',
    'Owner reported head shaking and scratching at the left ear for two days.',
    'The sample clinician note records left-sided otitis externa following an ear examination and cytology.',
    'Veterinary ear cleanser and a prescribed otic course; completed entries appear in Medicines.',
    'A recheck was documented for 20 November. The owner was given individual instructions at the visit.',
    'Fictional examination: redness and discharge in the left ear; right ear unremarkable.',{clinic:riverside}),
  visit('visit-03','Ear-treatment recheck','2023-11-20',
    'Planned review after the left-ear treatment; owner reported that head shaking had stopped.',
    'The archived examination describes resolved inflammation and no continuing discharge.',
    'Previous ear-treatment course marked completed; no new prescription recorded.',
    'The episode was closed in the fictional clinic record. No further treatment was entered.',
    'Outcome: improved and resolved at recheck.',{clinic:riverside}),
  visit('visit-04','Minor paw-pad wound','2024-03-19',
    'Owner noticed licking of the right front paw after a park walk.',
    'The sample examination records a superficial paw-pad abrasion; no retained foreign material was found.',
    'Clinic-directed topical wound care, recorded separately in Medicines.',
    'A telephone review was documented five days later: wound closed and normal walking reported.',
    'Wound was cleaned and dressed at the fictional visit. Outcome: resolved.'),
  visit('visit-05','Digestive upset review','2024-08-22',
    'Owner reported a brief episode of loose stools with otherwise normal behaviour.',
    'The fictional clinician recorded a mild, self-limiting gastrointestinal episode after examination.',
    'Veterinarian-directed probiotic course; the historical medicine log is marked completed.',
    'The follow-up call two days later records normal stools and no further symptoms.',
    'The sample record notes that hydration and comfort were checked at the appointment. Outcome: resolved.'),
  visit('visit-06','Itchy-skin flare','2025-02-14',
    'Intermittent scratching around the chest and front legs over the preceding week.',
    'The fictional clinician assessment records seasonal dermatitis associated with environmental pollen sensitivity.',
    'A short prescribed itch-treatment course and medicated skin wash, both recorded in Medicines.',
    'The sample review records settled itching and no open lesions. Seasonal skin follow-up remains on file.',
    'The fictional record includes a skin examination and a review of earlier parasite-care entries. Outcome: improved.'),
  visit('visit-07','Limp after active play','2025-07-03',
    'Owner noticed intermittent left-forelimb limping after a long play session.',
    'The sample clinician assessment records a mild soft-tissue strain after a limb examination; no fracture was documented.',
    'A veterinarian-prescribed analgesic course was recorded and subsequently completed.',
    'A review two weeks later recorded a comfortable gait and closed the episode.',
    'The archived examination describes local tenderness without an open injury. Outcome: resolved at follow-up.',{clinic:riverside}),
  visit('visit-08','Dental assessment','2026-10-29',
    'Routine oral review after the owner noticed persistent breath odour.',
    'The fictional examination documents tartar and gingival inflammation; a dental procedure was discussed.',
    'No medicine was started at this assessment.',
    'A dental admission was booked for 5 November after the clinic’s pre-procedure review.',
    'A sample dental chart and planned procedure were recorded. The later admission appears as a separate visit.'),
  visit('visit-09','Dental cleaning & recovery','2026-11-05',
    'Planned admission following the earlier dental assessment.',
    'The example dental chart records gingivitis with calculus; no extraction was documented.',
    'Post-procedure pain relief supplied by the clinic; the historical course is marked completed.',
    'The sample recovery call records comfortable chewing and a return to normal behaviour.',
    'Fictional procedure: dental scale and polish with a documented recovery check. Outcome: recovered.'),
  visit('visit-10','Annual health review','2026-11-12',
    'Routine examination and review of past ear, skin, mobility and dental episodes.',
    'No active skin flare or other concern was identified in this fictional visit. Seasonal dermatitis remained controlled; prior ear, mobility and dental episodes were resolved.',
    'No ongoing prescription was recorded at this visit.',
    'Routine seasonal skin follow-up remained on file. Vaccination and parasite-care documents were reconciled with the owner’s diary.',
    'Recorded example weight: 28.5 kg. The clinician reviewed the historical care entries and completed the visit summary.'),
];

export function createMochiHistory() {
  return records.map(record=>({...record})).sort((a,b)=>new Date(b.date)-new Date(a.date));
}

export function upgradeMochiDemoCare(store) {
  const isDefault=value=>typeof value!=='string'||!value.trim()||value==='None recorded';
  const seedEssentials=Number(store.demoHistoryVersion||0)<2;
  return {...store,
    allergies:seedEssentials&&isDefault(store.allergies)?MOCHI_DEMO_ESSENTIALS.allergies:store.allergies,
    conditions:seedEssentials&&isDefault(store.conditions)?MOCHI_DEMO_ESSENTIALS.conditions:store.conditions,
    records:store.records.map(record=>{
      const old=legacyCareText[record.id];
      if(!old||record.sample!==true||record.author!=='Vet demo')return record;
      const current=records.find(item=>item.id===record.id),patch={};
      // Update only the exact earlier sample wording, never owner corrections.
      for(const [field,value] of Object.entries(old))if(record[field]===value)patch[field]=current[field];
      return Object.keys(patch).length?{...record,...patch}:record;
    }),
  };
}
