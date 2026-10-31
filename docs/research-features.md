# Research-based features (brain injury / concussion)

Draft, Oct 25 · statuses updated Oct 31 (v0.6). Sources were opened and checked during web research; re-check each link before citing it in a deliverable. Most evidence on technology for memory after brain injury comes from small studies (Leopold et al. 2015, https://doi.org/10.3233/NRE-151267).

**Status:** HAS = the planner already does it · NEW = doable for Prototype 2 · LATER = Prototype 3 or after.

| # | Feature | Why (evidence) | Source | Status |
|---|---|---|---|---|
| 1 | Timed reminders on the device (vibration + short text) | NeuroPage trial (143 people, mostly brain injury / stroke): over 80 % did everyday tasks significantly better | Wilson et al., *J Neurol Neurosurg Psychiatry* 2001, https://doi.org/10.1136/jnnp.70.4.477 | HAS |
| 2 | A wearable / pocket device as the main reminder | Memory performance dropped when the smartwatch reminders were taken away | Jamieson et al., *Neuropsychol Rehabil* 2019, https://doi.org/10.1080/09602011.2017.1310658 | HAS |
| 3 | Daily energy budget, neutral overload alerts | Activity pacing, spreading activity across the day, staying under the symptom threshold | Ontario Neurotrauma Foundation, Concussion/mTBI guideline 3rd ed., Fatigue (2018), https://concussionsontario.org/sites/default/files/2023-03/11._Fatigue02-20.pdf | HAS |
| 4 | Suggest a 15-min rest block per hour of activity | Pacing = rest breaks built into the day, about 15 min per hour | LHSC Trauma Program, Mild TBI education (2018), https://lhsc.on.ca/media/8135/download | HAS (v0.6: reminder of her 30-min rule; rest added only when she taps) |
| 5 | "Thinking" vs "doing" tag, with a nudge to alternate | Alternate activity types (e.g. banking, then dishes) | LHSC 2018 | NEW |
| 6 | "Good day" guard: warn if a day is overloaded to catch up; at most 1 big activity a day | Avoid the boom-and-bust cycle; do only one larger activity a day if needed | Gloucestershire Hospitals NHS, Managing fatigue after brain injury (2025), https://www.gloshospitals.nhs.uk/your-visit/patient-information-leaflets/managing-fatigue-after-brain-injury/ | HAS (v0.6: rules + “Suggest a lighter week”) |
| 7 | 1-tap end-of-day energy check-in (3 faces) | Keep a diary to see fatigue patterns | ONF 2018, Fatigue | REMOVED (v0.8.1): the client does not want to be tracked |
| 8 | Step-by-step checklist inside an activity | Electronic reminders are the preferred memory aid; step-by-step prompts for complex tasks | Velikonja et al., INCOG 2.0 Memory, *J Head Trauma Rehabil* 2023, https://doi.org/10.1097/HTR.0000000000000837 | HAS (steps shown as a "Remember" list on Today; nothing ticked or saved since v0.8.1) |
| 9 | Planning nudge ("Anything to add for tomorrow?") | 4 prompts a day roughly doubled the reminders people set | Jamieson et al., *Disabil Rehabil Assist Technol* 2022, https://doi.org/10.1080/17483107.2020.1785560 | NEW |
| 10 | Client chooses reminder lead time, type and how many | The user is the best judge of reminders; avoid unwanted ones | W3C COGA, Provide Reminders, https://www.w3.org/WAI/WCAG2/supplemental/patterns/o7p07-reminders/ | HAS (lead time) · NEW (type, count) |
| 11 | "Now / Next" screen with 1–3 items | Some people hold only 1–3 items in working memory | W3C, Making Content Usable for People with Cognitive and Learning Disabilities (2021), https://www.w3.org/TR/coga-usable/ | HAS (v0.6: Today screen) |
| 12 | Undo everywhere; nothing moves unless the client moves it; stable layout | User controls changes; a new interface can take weeks to learn | W3C COGA 2021 | HAS (v0.6: Undo for every change) |
| 13 | Voice notes recorded on the device | A voice-recorder app improved remembering to do things (older adults with mild memory problems) | Scullin et al., *J Am Geriatr Soc* 2022, https://doi.org/10.1111/jgs.17551 | HAS |
| 14 | Helper can set up reminders for the client | Remotely set reminders improved task completion, independence and mood (6 people, brain injury) | Ferguson et al., *Brain Injury* 2015, https://doi.org/10.3109/02699052.2014.1002109 | LATER |
| 15 | Practice mode + 1-page printed quick guide | About 1 in 3 users needed more than one training session; safe trial and error raised confidence | Ramirez-Hernandez et al., *Neuropsychol Rehabil* 2022, https://doi.org/10.1080/09602011.2021.1879875 | HAS (v0.6: Help page + printable guide) · practice mode LATER |
| 16 | Adult, non-stigmatising look | A mainstream calendar was accepted because other aids felt stigmatising | Baldwin & Powell, *Neuropsychol Rehabil* 2015, https://doi.org/10.1080/09602011.2014.956764 | HAS |
| 17 | "Dim" low-brightness theme | Screen intolerance is common after concussion; light sensitivity differs a lot between people | Tosta et al., *Brain Sci* 2026, https://doi.org/10.3390/brainsci16080838 | HAS (v0.6: Dim theme) |
| 18 | Optional screen-break nudge; printed week as a screen-free option | Less screen time early after concussion was linked to faster recovery (youth data) | Macnow et al., *JAMA Pediatrics* 2021, https://doi.org/10.1001/jamapediatrics.2021.2782 | HAS (print, “Print tomorrow”) · nudge LATER |
| 19 | No password to remember | WCAG 2.2 SC 3.3.8: no memory test to log in | W3C WCAG 2.2, https://www.w3.org/TR/WCAG22/ | HAS |
| 20 | Location-based reminders | Time + place reminders worked better than time only (Alzheimer's population) | El Haj et al., *Curr Alzheimer Res* 2024 | LATER |

## Design numbers to test against (PD F)

| Topic | Target | Source |
|---|---|---|
| Text contrast | ≥ 7:1 (our spec, WCAG AAA) | WCAG 2.2 SC 1.4.6 |
| Energy shapes / icons | ≥ 3:1 against neighbours | WCAG 1.4.11 |
| Text size | Up to 200 % with nothing lost | WCAG 1.4.4 |
| Touch targets | 44 × 44 px | WCAG 2.5.5 |
| Flashing | None | WCAG 2.3.1 |
| Items on screen at once (Now / Next) | 1–3 | W3C COGA |
| Rest | 15 min per hour of activity | LHSC 2018 |
| Big activities | 1 per day | Gloucestershire NHS |
| Training | Plan 2 sessions + printed guide | Ramirez-Hernandez 2022 |

## Similar tools
- **Google Calendar:** mainstream, accepted, but no energy rules (Baldwin & Powell 2015).
- **Brain in Hand:** planning app + human support; goals improved at 6 months in a 10-person brain injury study (Kettlewell et al. 2022, https://doi.org/10.1177/20556683221117759).
- **Visible:** energy budget ("PacePoints") for energy-limiting illness; a good model for our load score.
- **Tiimo:** visual timeline, colours + icons, routines by energy (made for ADHD / autism).

## Also used in v0.6
- **Atkinson Hyperlegible** typeface (Braille Institute of America, made for low-vision readers; SIL Open Font License), kept inside the app so it works offline.
- Client-specific choices (week starts Sunday, no clock times, no percentages, no forced rest, leftovers at the bottom): see [client-needs.md](client-needs.md).
