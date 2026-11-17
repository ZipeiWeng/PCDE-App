// Public directory snapshots, not a live Google Places feed. Match the branch,
// never the brand alone; links let people check the original public listing.
export const PUBLIC_VET_RATINGS = [
  {
    branch: 'Village Vet · Brackenbury', name: 'village vet', postcode: 'W12 8HH', street: '146 Goldhawk Road',
    rating: 4.5, reviewCount: 213, source: 'Google · via Pawthority',
    sourceUrl: 'https://pawthority.co.uk/vet-hammersmith-fulham/village-vet-brackenbury/',
    retrievedAt: '2026-11-13',
  },
  {
    branch: 'Village Vet · St Helens', name: 'village vet', postcode: 'W10 6LL', street: '71 St Helens Gardens',
    rating: 4.2, reviewCount: 186, source: 'Google · via VetPriceGuide',
    sourceUrl: 'https://vetpriceguide.co.uk/vet/96',
    retrievedAt: '2026-11-13', sourceAsOf: '2026-08',
  },

  {branch:'Village Vet · Brook Green',name:'village vet',postcode:'W14 0LR',street:'75 Masbro Road',rating:4.8,reviewCount:323,source:'Google · via Vethound',sourceUrl:'https://www.vethound.co.uk/vets/village-vet-brook-green',retrievedAt:'2026-11-13'},
  {branch:'Village Vet · Chiswick',name:'village vet',postcode:'W4 2ED',street:'113 Chiswick High Road',rating:4.7,reviewCount:304,source:'Google · via Vethound',sourceUrl:'https://www.vethound.co.uk/vets/village-vet-chiswick',retrievedAt:'2026-11-13'},
  {branch:'Medivet · Notting Hill',name:'medivet',aliases:['notting hill vet'],postcode:'W11 1JR',street:'106 Talbot Road',rating:4.6,reviewCount:174,source:'Google · via Medivet',sourceUrl:'https://www.medivetgroup.com/vet-practices/notting-hill/',retrievedAt:'2026-11-13'},
  {branch:'Medivet · Acton',name:'medivet',postcode:'W3 8NX',street:'346 Acton Lane',rating:4.2,reviewCount:290,source:'Google · via Medivet',sourceUrl:'https://www.medivetgroup.com/vet-practices/acton/',retrievedAt:'2026-11-13'},
  {branch:'Medivet · West Kensington',name:'medivet',aliases:['barons court veterinary'],postcode:'W14 9HP',street:'2 Comeragh Road',rating:4.2,reviewCount:140,source:'Google · via Medivet',sourceUrl:'https://www.medivetgroup.com/vet-practices/west-kensington/',retrievedAt:'2026-11-13'},


  {branch:'Addison & Holland Park Veterinary Clinic',name:'addison & holland park',aliases:['addison and holland park'],postcode:'W11 4QS',street:'9 Addison Avenue',rating:4.8,reviewCount:250,source:'Google · via VetPricer',sourceUrl:'https://vetpricer.co.uk/vets/hammersmith/',retrievedAt:'2026-11-13'},
  {branch:'Creature Comforts · Notting Hill',name:'creature comforts',postcode:'W11 2SE',street:'241 Westbourne Grove',rating:5.0,reviewCount:256,source:'Google · via VetPricer',sourceUrl:'https://vetpricer.co.uk/vets/hammersmith/',retrievedAt:'2026-11-13'},
  {branch:'Blue Cross Pet Clinic',name:'blue cross',postcode:'W6 0RQ',street:'Argyle Place',rating:4.5,reviewCount:316,source:'Google · via VetPricer',sourceUrl:'https://vetpricer.co.uk/practice/blue-cross-pet-clinic-hammersmith-and-fulham/',retrievedAt:'2026-11-13'},
  // OSM currently has NW10 5LG; the public rating directory has NW10 5LE.
  // Match the same 748 Harrow Road address without changing the listed postcode.
  {branch:'Village Vet · Kensal Green',name:'village vet',postcode:'NW10 5LE',street:'748 Harrow Road',rating:4.3,reviewCount:193,source:'Google · via Vethound',sourceUrl:'https://vethound.co.uk/vets/village-vet-kensal-green',retrievedAt:'2026-11-13'},

];
const normalize = value => String(value || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
const addressWords = value => String(value || '').normalize('NFKD').toLowerCase()
  .replace(/[’']/g, '').replace(/[^a-z0-9]/g, ' ').trim().replace(/\s+/g, ' ')
  .replace(/\broad\b/g, 'rd').replace(/\bgardens\b/g, 'gdns');
function matchesPostcode(address, postcode) {
  const compact=normalize(postcode),outward=compact.slice(0,-3),inward=compact.slice(-3);
  return new RegExp(`(?:^| )${outward} ?${inward}(?: |$)`).test(addressWords(address));
}
function matchesStreet(address, street) {
  // Whole address tokens prevent 146 matching 1146, 146A, or Roadside.
  return (` ${addressWords(address)} `).includes(` ${addressWords(street)} `);
}
export function publicVetRating(vet) {
  if (!vet || vet.tutorial) return null;
  const name = normalize(vet.name);
  return PUBLIC_VET_RATINGS.find(entry => [entry.name,...(entry.aliases||[])].some(alias=>name.includes(normalize(alias))) &&
    (matchesPostcode(vet.address,entry.postcode) || matchesStreet(vet.address,entry.street))) || null;
}
