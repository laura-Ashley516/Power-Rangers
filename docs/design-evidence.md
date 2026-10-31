# Design evidence (v0.7 calm redesign)

Why the planner looks the way it does. Each row: what the research says → what we changed → source.
Numbers [n] are referenced in `app/css/styles.css`. Research done Oct 31; re-open each link before citing it in a deliverable.
Client facts (no names) are in [client-needs.md](client-needs.md).

## What changed and why

| # | Evidence | What we changed (v0.6 → v0.7) | Source |
|---|---|---|---|
| 1 | Older adults (mean age 70) read 14 pt text better than 12 pt; serif vs sans made no difference. Size matters more than the font family. | v0.7: body 19 px. **v0.7.2: one type scale with 4 sizes in Settings → Text size: Small 15 / Standard 17 / Large 19 (≈ the 14 pt of this study) / Extra large 22 px.** Default Standard, because 19 px felt bulky on a computer (team feedback) and Apple's default body size is 17 pt (row 7). Every size in the app is a step of that base, so everything grows together. | Bernard et al. 2001, https://portfolio.erau.edu/en/publications/examining-perceptions-of-online-text-size-and-typeface-legibility/ |
| 2 | **Atkinson Hyperlegible has no peer-reviewed evaluation** (only design rationale and awards). | It is no longer the default; kept as an option. | Braille Institute, https://www.brailleinstitute.org/freefont/ |
| 3 | Atkinson Hyperlegible **Next** (2025) has 7 weights; the original only Regular and Bold (one cause of the heavy, "sad" look). | The option uses Next with lighter weights. | Braille Institute (as above) |
| 5 | Each person's reading speed differed by 35 % between their best and worst font; preference did not predict speed. | **Settings → Text font** with a live preview: Clear modern (system, default), Extra clear letters (Atkinson Next), Book style (Georgia, serif: row 1 found no serif / sans difference, some people prefer it). Weights lowered (names Medium 500) so the default looks lighter. | Wallace et al., ACM TOCHI 2022, https://doi.org/10.1145/3502222 |
| 6 | Apple: system fonts are "designed for optimized legibility", adjust spacing per size, support Dynamic Type and Bold Text. | **Default font = the iPad's system font (SF Pro).** | Apple HIG Typography, https://developer.apple.com/design/human-interface-guidelines/typography |
| 7 | Apple: body text 17 pt by default (19–21 pt at larger settings), Regular weight; only titles Semibold; support 200 % zoom. | Body Regular, titles Semibold (600); "Larger text" setting 22 px. | Apple HIG Accessibility, https://developer.apple.com/design/human-interface-guidelines/accessibility |
| 9 | WCAG 1.4.12: layout must survive 1.5 line height and extra letter / word spacing. | Line height 1.5; nothing overlaps when text grows. | W3C, https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html |
| 10 | WCAG 1.4.8: lines ≤ 80 characters, not justified, user-chosen colours. | Paragraphs ≤ 65 characters wide; colour themes kept. | W3C, https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html |
| 11 | Capitals only help near the acuity limit; GOV.UK: block capitals are "quite hard to read". | **All 22 small ALL-CAPS labels removed**; sentence case everywhere. | Arditi & Cho 2007, https://europepmc.org/article/MED/17681579 ; GOV.UK style guide |
| 12 | GOV.UK: "Do not use italics". | No italics. | GOV.UK style guide, https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/style-guides/a-to-z-style-guide/ |
| 13 | NN/g: bold only the key points (≤ ~30 % of text); bolding everything slows scanning. | Bold text on the week **76 % → 28 %**; only titles and activity names. | NN/g 2023, https://www.nngroup.com/articles/formatting-long-form-content/ |
| 14 | After a brain injury, a target that "pops out" is found normally, but searching among look-alikes stays slow 8 months later. | Today: **only "Now" is large and framed**; the rest of the day is a quiet list. Week: fewer competing coloured chips (legend, badges and pills removed). | Schmitter-Edgecombe & Robertson 2015, https://doi.org/10.1080/13803395.2014.998170 |
| 15 | 61 % of concussion patients had symptoms provoked by eye-movement / motion tests. | **No motion at all** (no animations or transitions). | Mucha et al. 2014, https://doi.org/10.1177/0363546514543775 |
| 16 | W3C COGA: about 5 main choices per screen, extras under "More". | Week toolbar 9 buttons → **4 + "More"** (lighter week, split, copy, print). The "My activities" box stays **always visible** (client requirement, decision 27) but is one calm row with scroll buttons. | W3C COGA, https://www.w3.org/WAI/WCAG2/supplemental/patterns/o5p03-manageable-quantity/ |
| 17 | COGA: key information near the top, without scrolling. | The planner **opens on the week**; the whole week and the activities box fit one iPad screen (1180 × 820). | https://www.w3.org/WAI/WCAG2/supplemental/patterns/o2p04-page-important/ |
| 18 | COGA: the same function looks the same and sits in the same place on every page. | One top bar (Undo, Voice note, Print) and one tab row on every screen. | https://www.w3.org/WAI/WCAG2/supplemental/patterns/o1p03-consistent-design/ |
| 19 | COGA: white space around objects, adjustable by the user. | **Settings → Space between things**: Comfortable / More space. | https://www.w3.org/WAI/WCAG2/supplemental/patterns/o3p10-whitespace/ |
| 20 | Gestalt proximity and common region: items inside one boundary read as one group. | The week is a **timetable like a wall calendar** (v0.7.1): days across the top with a large date, Morning / Afternoon / Evening down the left with an icon and the word, one equal box per day and time with lines in both directions, today's column tinted and its date circled. Elsewhere, space instead of borders and shadows. | NN/g 2020, https://www.nngroup.com/articles/gestalt-proximity/ |
| 21 | Apple: controls 44 × 44 pt; WCAG 2.5.8: 24 px minimum with spacing. | Buttons and cards **48 px** high, gaps ≥ 12 px (helps balance problems and tremor). | Apple HIG; W3C, https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html |
| 22 | NN/g: most icons are ambiguous; "text labels are necessary". | **Emoji removed** from tabs and buttons (🎙 🖨 ⚖ ✂ ⧉ 🔒 …): plain words; one small line icon for "fixed". Symbols on the week **73 → 29** (the rest are the energy shapes, which carry information). | NN/g 2014, https://www.nngroup.com/articles/icon-usability/ |
| 23 | Apple: never use colour alone. | Energy keeps colour + shape (□ ● ◇ ◠) + word. | Apple HIG Accessibility |
| 24 | Light mode reads better for most people of all ages; dark mode helps some (e.g. cataract) and hurts older adults in bright rooms. | **Warm light theme is the default**; "Dark" is an option. | NN/g 2020, https://www.nngroup.com/articles/dark-mode/ ; Sethi & Ziat 2023, https://pubmed.ncbi.nlm.nih.gov/36533999/ |
| 25 | Migraine: at office brightness most colours of light made pain worse; brightness mattered more than hue. | Warm off-white background (not pure white), soft energy colours; a Settings hint to lower the iPad's brightness. | Noseda et al., Brain 2016, https://academic.oup.com/brain/article/139/7/1971/2464334 |
| 26 | Coloured tints / overlays: weak evidence. | Colour themes offered as preference only, never as therapy. | Griffiths et al. 2016, https://eprints.whiterose.ac.uk/id/eprint/104441/ |
| 28 | WCAG 1.4.6: 7:1 contrast compensates for about 20/80 vision. | Every text colour ≥ 7:1 (dark grey on warm off-white, ≈ 12:1). | W3C, https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html |
| 29 | WCAG 2.3.3 and Apple: motion can trigger dizziness and migraine; nothing the user can act on should vanish on a timer. | No animations. **Undo is always in the top bar**, so the short message with an Undo shortcut (8 s, with Close) never takes the only way to undo away. | W3C, https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html |
| 30 | NN/g (123 users aged 65+): tiny or light text and small targets hurt most; older adults are not a niche. Little research exists on what feels "childish". | Mature, standard layout: no cartoon emoji, no praise or reassurance messages (also the client's own request). | NN/g 2019, https://www.nngroup.com/articles/usability-for-senior-citizens/ |

Rows 4 (Lexend: no independent evidence), 8 (x-height), and 27 (TBI light sensitivity, Theis 2022, https://pubmed.ncbi.nlm.nih.gov/35311726/) informed the choices but did not need their own change.

## Measured on the screen (iPad landscape, 1180 × 820)

Counted automatically in the browser on the visible part of each screen.

| Measure | Week v0.6 | Week v0.7 | Today v0.6 | Today v0.7 |
|---|---|---|---|---|
| Text in bold | 76 % | 28 % | 36 % | 15 % |
| ALL-CAPS labels | 22 | 0 | 2 | 0 |
| Framed boxes (borders or shadows) | 95 | 35 | 27 | 12 |
| Symbols and emoji | 73 | 29 | 32 | 13 |
| Different background colours | 13 | 9 | 10 | 7 |
| Smallest text | 10.3 px | 15.2 px | 12.6 px | 15.2 px |
| Pieces of text | 181 | 111 | 73 | 55 |
| Whole week visible without scrolling | yes | yes | — | — |

## To check with the client (Client Meet 3)
- Show both fonts for a minute each and let her choose (row 5).
- Light or dark, and how bright her iPad is set (rows 24–25).
- Comfortable or More space (row 19).
