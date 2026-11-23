// A picture for each activity (client feedback, Nov 2026: a simpler day view, with images for the tasks).
// Pictures help people with memory problems recognise a task faster than words alone (picture-based
// schedules are a standard memory aid in brain-injury rehabilitation). The word is always shown too.
//
// The picture is chosen from the activity's name (English or French); she can pick another one in the
// activity form. Stored as `icon` on the activity; an empty value means "choose from the name".

// Whole words only (so "change" is not "hang", "split" is not "lit"); names are compared without accents.
const RULES = [
  [/\b(bed|beds|lit|towels?|serviettes?|sheets|draps|bedding)\b/, '🛏️'],
  [/\b(walk|walking|marche|promenade|stroll)\b/, '🚶'],
  [/\b(grocer\w*|shopping|epicerie|courses|magasin)\b/, '🛒'],
  [/\b(physio\w*|exercises?|exercice\w*|gym|stretch\w*|yoga)\b/, '🤸'],
  [/\b(church|eglise|messe|mass)\b/, '⛪'],
  [/\b(music|musique|piano|clarinet|lessons?)\b/, '🎵'],
  [/\b(doctor|medical|medecin|dentist\w*|clinic|clinique|hospital|hopital|appointment|rendez|vous|rdv)\b/, '🩺'],
  [/\b(friends?|amie?s?|coffee|cafe|visit|visite)\b/, '☕'],
  [/\b(meal|meals|repas|cook\w*|cuisine\w*|dinner|souper|lunch|diner|prep)\b/, '🍳'],
  [/\b(dish\w*|vaisselle|lave)\b/, '🍽️'],
  [/\b(laundry|lessive|linge|washer|dryer|hang|etendre)\b/, '🧺'],
  [/\b(vacuum\w*|aspirateur|hoover)\b/, '🧹'],
  [/\b(floors?|planchers?|mop\w*)\b/, '🧽'],
  [/\b(call|phone|appel\w*|telephone\w*)\b/, '📞'],
  [/\b(read\w*|lire|lecture|books?|livres?)\b/, '📖'],
  [/\b(hobby|loisirs?|paint\w*|peinture|crafts?|bricolage|garden\w*|jardin\w*|plants?)\b/, '🎨'],
  [/\b(rest|repos|nap|sieste|couch|divan|relax\w*)\b/, '🛋️'],
  [/\b(bills?|factures?|bank|banque|pay|payer)\b/, '💵'],
  [/\b(bath\w*|bain|shower|douche|clean\w*|nettoy\w*|menage)\b/, '🧼'],
  [/\b(medication\w*|pills?|pilules?|medicaments?|pharmac\w*)\b/, '💊'],
  [/\b(bus|car|drive|conduire|taxi|transport)\b/, '🚌'],
];

// The pictures offered in the activity form (big, common, calm).
export const ICON_CHOICES = ['🚶', '🛒', '🤸', '⛪', '🎵', '🩺', '🍳', '🍽️', '🧺', '🛏️', '🧹', '🧽', '☕', '📞', '📖', '🎨', '🛋️', '💵', '🧼', '💊', '🚌', '🐕', '🌳', '✉️', '💻', '📺', '🧑‍🤝‍🧑', '⭐'];

export function iconFor(a) {
  if (a?.icon) return a.icon;
  const name = String(a?.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const [re, icon] of RULES) if (re.test(name)) return icon;
  return '📌';
}
