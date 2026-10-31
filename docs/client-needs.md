# What the client needs (summary)

From client meetings 1 and 2 and our deliverables (PD A–E). **No names or contact details here.** Use it to check every design choice. Sources are in the team's deliverables folder; anything marked *(guess)* is ours, not hers.

## Her week (used for the example week in `app/js/store.js`)

| Activity | When | Energy | Fixed? |
|---|---|---|---|
| Walk + small groceries | Every day, first thing (≈ 9:30, about 1 h). "Recharges me" | Easy | Non-negotiable |
| Church | Sunday morning | Moderate | Fixed |
| Exercise class | Wednesday morning (shorter walk that day) | Moderate *(guess)* | Fixed |
| Music lesson | Tuesday evening, 30 min | Moderate *(guess)* | Fixed |
| Physiotherapy | Friday morning (10–12), walks home tired | Moderate (harder with a new exercise) | Fixed |
| Medical / dental appointments | Occasional; she books them on Tuesday or Thursday | Moderate *(guess)* | Appointment |
| Meal prep | One meal over 3 days: meat, then vegetables, then rice or pasta; needs a stove timer | Easy (each part) | — |
| Unload dishwasher | Over 3 days: cutlery, plates, cups | Easy (each part) | — |
| Laundry in washer / dryer | — | Easy | — |
| Hang laundry | — | Between easy and moderate | — |
| Change bed and towels | Saturday; about 1 h on the couch after | High | — |
| Vacuum, then wash floors | Different days, vacuum first | Moderate *(guess)* | — |
| Lunch with a friend | Every few weeks | Moderate | — |

## Her rules
- At most **5 easy** activities a day; **1 moderate = 2–3 easy**; **1 high + 30 min rest = 1–2 easy**; never a high and a moderate on the same day; never two highs.
- She does **not** want rest forced into her week ("no forced relaxation"). The planner reminds her of her own 30-minute rule after a high activity and adds a rest only when she taps the button.

## How she plans and what she likes
- **Paper person**, colour printer, kitchen calendar that **starts on Sunday**, notes in her pocket, "triple reminders".
- Wants the **week at a glance**, **blocks of time (Morning / Afternoon / Evening), not clock times**, simple generic titles, **drag and drop**, **locked appointments**, **leftover activities at the bottom**, a printable week.
- **At most 2–3 clicks** per task; **15–20 items a day is far too much** (target ≤ 3 a day).
- **No reassurance messages**, nothing childish, **no percentages** ("2 out of 10" is fine).
- **No tracking**: the planner helps her schedule; it does not record how she feels (team decision 30, Oct 31).
- Prefers an app to a website (the planner installs as a home-screen icon).
- Devices: **iPad** at home, flip phone (SMS) outside, no smartphone. Reminder about **1 hour before** (she walks everywhere); a simple ding or **vibration**, no high-pitched sounds.

## Accessibility
- **Light-sensitive** (dark glasses, warm light preferred, bluish light bad), migraines, noise sensitivity, balance problems.
- Short-term memory loss; may need things repeated; anxiety with forms.
- Needs text **larger than 15 pt**; black text on beige; colours always with a word and a shape.

## How the planner answers this (v0.6)
| Need | In the planner |
|---|---|
| Week at a glance, 7 days visible | Opens on the week; calendar grid with clear day lines fits an iPad screen |
| Blocks, not clock times | Morning / Afternoon / Evening only |
| Drag and drop + locked appointments | **Always-visible "My activities" box above the calendar**: drag into a day (mouse, finger, or tap-then-tap); fixed routines locked. Permanent requirement (decision 27) |
| Leftovers at the bottom | "Later this week" tray under the week |
| ≤ 3 items a day, ≤ 3 clicks | Example week has ≤ 3 a day; a calm note above 3; every task in 1–3 taps |
| Her energy rules | Energy bar per day ("4½ of 5½", no %), one calm note, "Suggest a lighter week" |
| No forced rest | Rest reminder only; rest added only when she asks |
| Paper | Print week, print one day, "Print tomorrow", printable guide |
| Week starts Sunday | Default Sunday (Settings can change it) |
| Light sensitivity, large text | Dim theme, high contrast, larger text, Atkinson Hyperlegible font, 18 px base |
| Memory | Today screen: Now / Next only, steps checklists, "Mark done", Undo everywhere |
| Splitting chores over days | "Split a task over days" (e.g. meal in 3 parts) |

## Still open (ask at Client Meet 3)
- Energy of: exercise class, music lesson, vacuuming, washing floors, appointments.
- Rest after a high activity: 30 min (meeting 2) or about 1 h (meeting 1)?
- Home Wi-Fi (2.4 GHz?) and OK with an encrypted online relay for the device?
