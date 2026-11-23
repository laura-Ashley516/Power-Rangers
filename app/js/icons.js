// A picture for each activity (client feedback, Nov 2026: a simpler day view, with images for the tasks;
// team decision: drawings that are calm and adult, matching the planner's look, not emoji or cartoons).
//
// One set of line drawings, drawn for the planner: 24 × 24, rounded 1.7 px lines in the colour of the
// activity's energy, the same style as the Morning / Afternoon / Evening icons. Pictures help people with
// memory problems recognise a task faster than words alone; the word is always shown too.
//
// The picture is chosen from the activity's name (English or French); she can pick another one in the
// activity form. Stored as `icon` (the drawing's id) on the activity; empty = "choose from the name".

const D = {
  walk: '<circle cx="13" cy="4.5" r="2"/><path d="M11.5 8.5 9 14l3.5 2.5L13 21"/><path d="M9 14l-2.5 7"/><path d="M11.5 8.5 15 11l3 .5"/><path d="M11.5 8.5 8 10.5 7 13"/>',
  groceries: '<path d="M3 4h2.5l2.2 10.5h9.8L20 7H6.6"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>',
  exercise: '<circle cx="12" cy="4.5" r="2"/><path d="M5 8l7 2 7-2"/><path d="M12 10v5l-3 6"/><path d="M12 15l3 6"/>',
  church: '<path d="M12 2.5v4M10.3 4.2h3.4"/><path d="M7 21V11l5-4.5 5 4.5v10"/><path d="M4 21h16"/><path d="M10.5 21v-4a1.5 1.5 0 0 1 3 0v4"/>',
  music: '<path d="M9 18V5.5l10-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  medical: '<path d="M6 3v5a4 4 0 0 0 8 0V3"/><path d="M10 12v3a4.5 4.5 0 0 0 9 0v-1.5"/><circle cx="19" cy="11.5" r="2"/>',
  meal: '<path d="M3 11h13v1.5A5.5 5.5 0 0 1 10.5 18h-2A5.5 5.5 0 0 1 3 12.5z"/><path d="M16 12h5"/><path d="M8 4.5c0 1.5 1.5 1.5 1.5 3M11.5 4.5c0 1.5 1.5 1.5 1.5 3"/>',
  dishes: '<circle cx="13" cy="12" r="5.5"/><circle cx="13" cy="12" r="2.3"/><path d="M4 3v18M2.5 3v4.5a1.5 1.5 0 0 0 3 0V3"/><path d="M21.5 3c-1.5 1-2 3-2 6h2v12"/>',
  laundry: '<path d="M3.5 9h17l-1.8 11H5.3z"/><path d="M7 9a5 5 0 0 1 10 0"/><path d="M9 13v4M12 13v4M15 13v4"/>',
  bed: '<path d="M3 19V6"/><path d="M3 14h18v5"/><path d="M21 14v-2.5A2.5 2.5 0 0 0 18.5 9H11v5"/><circle cx="7" cy="11" r="1.8"/>',
  vacuum: '<path d="M15 3l-4.5 9"/><path d="M7 12h7l1.5 9h-10z"/><path d="M8.5 15.5V21M11.5 15.5V21"/>',
  floors: '<path d="M4.5 8h15l-1.7 12H6.2z"/><path d="M7 8a5 5 0 0 1 10 0"/><path d="M12 11.5c-1.2 1.6-1.8 2.6-1.8 3.4a1.8 1.8 0 0 0 3.6 0c0-.8-.6-1.8-1.8-3.4z"/>',
  coffee: '<path d="M4 8h12v5.5A5.5 5.5 0 0 1 10.5 19h-1A5.5 5.5 0 0 1 4 13.5z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3c0 1.2 1 1.2 1 2.4M11.5 3c0 1.2 1 1.2 1 2.4"/>',
  phone: '<path d="M5 3.5h3.5l1.5 4.5-2.2 1.4a11 11 0 0 0 4.8 4.8l1.4-2.2 4.5 1.5V17a2.5 2.5 0 0 1-2.7 2.5A15.5 15.5 0 0 1 2.5 6.2 2.5 2.5 0 0 1 5 3.5z"/>',
  book: '<path d="M12 6.5c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5z"/><path d="M12 6.5v13"/>',
  hobby: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.2-1-1.6-1-2.7 0-1 .8-1.6 1.8-1.6H17a4 4 0 0 0 4-4C21 6.5 17 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
  rest: '<path d="M5 11V8.5A2.5 2.5 0 0 1 7.5 6h9A2.5 2.5 0 0 1 19 8.5V11"/><path d="M3 13a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v4.5H3z"/><path d="M5 17.5V20M19 17.5V20"/>',
  money: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9.5v5M18 9.5v5"/>',
  clean: '<path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8z"/><path d="M18.5 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  pill: '<rect x="3.2" y="8.5" width="17.6" height="7" rx="3.5" transform="rotate(-45 12 12)"/><path d="M9.5 9.5l5 5"/>',
  bus: '<rect x="5" y="3.5" width="14" height="14" rx="2.5"/><path d="M5 11h14M8 21v-3.5M16 21v-3.5"/><circle cx="8.5" cy="14.5" r=".8"/><circle cx="15.5" cy="14.5" r=".8"/>',
  pet: '<circle cx="7" cy="9" r="1.8"/><circle cx="11" cy="6" r="1.8"/><circle cx="15" cy="6.5" r="1.8"/><circle cx="18" cy="10" r="1.8"/><path d="M8.5 17.5c0-3 2-5.5 4-5.5s4 2.5 4 5.5a2.5 2.5 0 0 1-2.5 2.5h-3a2.5 2.5 0 0 1-2.5-2.5z"/>',
  garden: '<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z"/><path d="M5 19l8-8"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/>',
  computer: '<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M2.5 19h19"/>',
  tv: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M9 21h6M8.5 2.5 12 6l3.5-3.5"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14a4.5 4.5 0 0 1 5.5 4.5"/>',
  appointment: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 14h3"/>',
  task: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
};

// Whole words only (so "change" is not "hang", "split" is not "lit"); names are compared without accents.
// Order matters: the first rule that matches wins.
const RULES = [
  [/\b(bed|beds|lit|towels?|serviettes?|sheets|draps|bedding)\b/, 'bed'],
  [/\b(walk|walking|marche|promenade|stroll)\b/, 'walk'],
  [/\b(grocer\w*|shopping|epicerie|courses|magasin)\b/, 'groceries'],
  [/\b(physio\w*|exercises?|exercice\w*|gym|stretch\w*|yoga)\b/, 'exercise'],
  [/\b(church|eglise|messe|mass)\b/, 'church'],
  [/\b(music|musique|piano|clarinet|lessons?)\b/, 'music'],
  [/\b(doctor|medical|medecin|dentist\w*|clinic|clinique|hospital|hopital|rdv)\b/, 'medical'],
  [/\b(appointment|rendez|vous)\b/, 'appointment'],
  [/\b(friends?|amie?s?|coffee|cafe|visit|visite)\b/, 'coffee'],
  [/\b(meal|meals|repas|cook\w*|cuisine\w*|dinner|souper|lunch|diner|prep)\b/, 'meal'],
  [/\b(dish\w*|vaisselle|lave)\b/, 'dishes'],
  [/\b(laundry|lessive|linge|washer|dryer|hang|etendre)\b/, 'laundry'],
  [/\b(vacuum\w*|aspirateur|hoover)\b/, 'vacuum'],
  [/\b(floors?|planchers?|mop\w*)\b/, 'floors'],
  [/\b(call|phone|appel\w*|telephone\w*)\b/, 'phone'],
  [/\b(read\w*|lire|lecture|books?|livres?)\b/, 'book'],
  [/\b(garden\w*|jardin\w*|plants?)\b/, 'garden'],
  [/\b(hobby|loisirs?|paint\w*|peinture|crafts?|bricolage)\b/, 'hobby'],
  [/\b(rest|repos|nap|sieste|couch|divan|relax\w*)\b/, 'rest'],
  [/\b(bills?|factures?|bank|banque|pay|payer)\b/, 'money'],
  [/\b(bath\w*|bain|shower|douche|clean\w*|nettoy\w*|menage)\b/, 'clean'],
  [/\b(medication\w*|pills?|pilules?|medicaments?|pharmac\w*)\b/, 'pill'],
  [/\b(bus|car|drive|conduire|taxi|transport)\b/, 'bus'],
  [/\b(dogs?|chiens?|cats?|chats?|pets?)\b/, 'pet'],
  [/\b(mail|letters?|lettres?|courrier|post)\b/, 'mail'],
  [/\b(computer|ordinateur|email|courriel|internet)\b/, 'computer'],
  [/\b(tv|tele|television|movie|film)\b/, 'tv'],
  [/\b(family|famille|group|groupe|club)\b/, 'people'],
];

// The drawings offered in the activity form.
export const ICON_CHOICES = Object.keys(D);

export function iconId(a) {
  if (a?.icon && D[a.icon]) return a.icon;
  const name = String(a?.name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const [re, id] of RULES) if (re.test(name)) return id;
  return 'task';
}

export const drawing = (id) => `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${D[id] || D.task}</svg>`;

// The picture of an activity, as a drawing.
export const iconFor = (a) => drawing(iconId(a));
