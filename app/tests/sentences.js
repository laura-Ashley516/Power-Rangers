// Sentences the client might say, and what the parser should do with each.
// The test week is the example week from store.fresh(); "now" is Wednesday 21 Oct 2026, 10:00
// (so "today" = Wednesday, "tomorrow" = Thursday).
//
// expect:
//   { add: 'Name', day, period }           a new or library activity added there
//   { move: 'Name', day, period }          that activity moved there
//   { remove: 'Name' }                     that activity cancelled
//   { fail: true }                         kept aside "to sort" (not understood)
// A sentence with two commands has an array of expectations.

export const NOW = new Date(2026, 9, 21, 10, 0);

export const SENTENCES = [
  // Add, using the activity library
  ['Add groceries on Tuesday afternoon', { add: 'Groceries', day: 'Tuesday', period: 'Afternoon' }],
  ['Put laundry on Saturday morning', { add: 'Laundry', day: 'Saturday', period: 'Morning' }],
  ['Schedule a walk on Friday evening', { add: 'Walk', day: 'Friday', period: 'Evening' }],
  ['I want to go for a walk tomorrow afternoon', { add: 'Walk', day: 'Thursday', period: 'Afternoon' }],
  ['Walk tomorrow morning', { add: 'Walk', day: 'Thursday', period: 'Morning' }],
  ['Add grocery shopping Monday morning', { add: 'Groceries', day: 'Monday', period: 'Morning' }],
  ['Book physio for Friday morning', { add: 'Physiotherapy', day: 'Friday', period: 'Morning' }],
  ['Add cook dinner on Sunday evening', { add: 'Prepare a meal', day: 'Sunday', period: 'Evening' }],
  ['Read tonight', { add: 'Read / relax', day: 'Wednesday', period: 'Evening' }],
  ['Add call family on Thursday at 3 pm', { add: 'Call family', day: 'Thursday', period: 'Afternoon' }],
  ['Add laundry Saturday at 10 am', { add: 'Laundry', day: 'Saturday', period: 'Morning' }],
  ['Um, add the laundry on Sunday afternoon please', { add: 'Laundry', day: 'Sunday', period: 'Afternoon' }],
  ['Add walk on mondays evening', { add: 'Walk', day: 'Monday', period: 'Evening' }],

  // Add, new activities
  ['I have a doctor appointment on Friday morning', { add: 'Doctor appointment', day: 'Friday', period: 'Morning' }],
  ['Add dentist Thursday morning, it is hard', { add: 'Dentist', day: 'Thursday', period: 'Morning', energy: 'red' }],
  ['Add coffee with Anna on Saturday afternoon, easy', { add: 'Coffee anna', day: 'Saturday', period: 'Afternoon', energy: 'green' }],
  ['Add haircut on Tuesday', { add: 'Haircut', day: 'Tuesday', period: 'Afternoon' }], // Tuesday morning has laundry -> least busy
  ['Add water the plants the day after tomorrow in the evening', { add: 'Water plants', day: 'Friday', period: 'Evening' }],

  // Move
  ['Move my walk from Monday to Wednesday morning', { move: 'Walk', day: 'Wednesday', period: 'Morning' }],
  ['Move walk to Thursday', { move: 'Walk', day: 'Thursday', period: 'Afternoon' }],
  ['Move the laundry to the afternoon', { move: 'Laundry', day: 'Tuesday', period: 'Afternoon' }],
  ['Reschedule groceries to Friday morning', { move: 'Groceries', day: 'Friday', period: 'Morning' }],
  ['Push groceries to Saturday', { move: 'Groceries', day: 'Saturday', period: 'Afternoon' }],
  ['Change laundry from Tuesday morning to Thursday evening', { move: 'Laundry', day: 'Thursday', period: 'Evening' }],
  ['I will do the reading on Sunday instead', { move: 'Read / relax', day: 'Sunday', period: 'Evening' }],

  // Cancel
  ['Cancel groceries', { remove: 'Groceries' }],
  ['Remove the walk on Monday', { remove: 'Walk' }],
  ['Cancel physio tomorrow', { remove: 'Physiotherapy' }], // parser finds it; rules refuse (fixed routine)
  ['Delete laundry', { remove: 'Laundry' }],
  ['I am not going to the groceries on Wednesday', { remove: 'Groceries' }],

  // Two commands in one note
  ['Add laundry on Friday morning and move walk to Saturday', [
    { add: 'Laundry', day: 'Friday', period: 'Morning' },
    { move: 'Walk', day: 'Saturday', period: 'Afternoon' },
  ]],
  ['Cancel groceries. Add a walk on Wednesday evening', [
    { remove: 'Groceries' },
    { add: 'Walk', day: 'Wednesday', period: 'Evening' },
  ]],

  // Should be kept aside (to sort)
  ['Remember to call my sister', { fail: true }],
  ['Cancel physio', { fail: true }],               // twice in the week: which day?
  ['Move the walk', { fail: true }],               // move where?
  ['Hmm', { fail: true }],
  ['', { fail: true }],
  ['Cancel the gym', { fail: true }],              // not in the calendar
];
