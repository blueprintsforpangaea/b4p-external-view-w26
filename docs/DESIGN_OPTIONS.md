# B4P Request System: four visual directions

Pick one (or mix). All four share the same data, guest checkout, localStorage
cart, and AA accessibility rules from `REDESIGN_PLAN.md`. They differ in how the
catalog is laid out, what the memorable element is, and how much the app
guides the user.

Note: `REDESIGN_PLAN.md` makes a photo grid the default with a list toggle.
Option A below follows the plan as written. If the build ends up rows-first,
swap the default; nothing else in A changes.

Brand base (from blueprintsforpangaea.org): blue `#0337a3`, secondary blue
`#4269ba`, navy `#0b2f5b`, ink `#212121`, grey `#646464`, line `#e2e2e2`,
green `#3f7239`, red `#df3131`. Site fonts: Poppins (+ Playfair accent).

---

## Option A: "Requisition slip" (current plan)

**Concept:** a quiet photo catalog, with the request you are building shown as
a paper requisition slip that stays beside you.

### Desktop
```
+----------------------------------------------------------------------+
| [B4P]  Request supplies   My requests                 [Request (3)]  |
+----------------------------------------------------------------------+
| [ Search 1,137 supplies: gloves, syringes, gauze...               ]  |
| (All) (Needles & Syringes 213) (IV 152) (Wound care 108) ...         |
| 412 results   Sort [Most in stock v]   [ ] Hide expiring    [Grid|List]|
+--------------------------------------------------+-------------------+
| +------+ +------+ +------+ +------+              | REQUISITION SLIP  |
| |photo | |photo | |photo | |photo |              | Riverside Clinic  |
| |Telfa | |BD 3mL| |      | |      |              | - - - - - - - - - |
| |16 in | |Exp   | |      | |      |              | Telfa pad  [-2+]  |
| |stock | |2027  | |      | |      |              | BD syringe [-10+] |
| |[Add] | |[-3+] | |      | |      |              | - - - - - - - - - |
| +------+ +------+ +------+ +------+              | [Review request]  |
+--------------------------------------------------+-------------------+
```
### Mobile
```
+------------------------+
| [B4P]        [Req (3)] |
| [ Search supplies   ]  |
| (All)(Syringes)(IV)... |
| +----+ Telfa pad       |
| |img | 16 in stock     |
| +----+ [Add]           |
| +----+ BD 3mL syringe  |
| |img | Exp Mar 2027    |
| +----+ [-][3][+]       |
|========================|
| 3 items  [Review ->]   |
+------------------------+
```

- **Palette:** blue `#0337a3`, navy `#0b2f5b`, tint `#eaf1ff`, ink `#212121`,
  line `#e2e2e2`, ok green `#3f7239`.
- **Type:** Poppins 600 headings, Inter 400/500/600 body, tabular numerals.
- **Signature:** the slip. White paper panel with a dashed tear edge, org name
  at the top, line items with steppers, sticky.
- **Cart/status:** the slip is the cart. Status is a 4-dot track
  (Submitted, Under review, Approved, Shipped) on each request in My requests.
- **For clinic staff:**
  - Scan speed: good with photos, fair for very long lists (cards are tall).
  - Slow connections: 48 lazy thumbnails per page, acceptable.
  - Non-native English: photos carry meaning, numbers not words.
  - Mobile: good; the slip collapses into a bottom bar.
  - Con: the most generic of the four; the slip is the only distinct idea.

---

## Option B: "Packing list" (dense warehouse manifest)

**Concept:** the catalog looks like the packing list taped to a pallet:
one line per item, item code and quantity columns, a tally of what you have
ticked.

### Desktop
```
+----------------------------------------------------------------------+
| B4P / PACKING LIST          [ search or scan code...        ]  Tally 3|
+----------------------------------------------------------------------+
| Needles & Syringes  213 | IV Supplies 152 | Wound care 108 | ...      |
+----------------------------------------------------------------------+
|     | ITEM                      | CODE   | BOX | EXP     | AVAIL | QTY |
| [ ] | Telfa non-adherent pad    | ST/N-4 | 12  | 2027-03 |    16 | [ ] |
| [x] | BD syringe 3 mL           | ST/N-9 | 31  | 2027-08 |    40 | 10  |
| [ ] | Nitrile gloves, M         | DME-2  | 05  | 2028-01 |   220 | [ ] |
| (hover or focus a row: 120px photo pops out on the right)            |
+----------------------------------------------------------------------+
| Ticked: 1 line, 10 units                      [ Send request (1) ]   |
+----------------------------------------------------------------------+
```
### Mobile
```
+------------------------+
| PACKING LIST    Tally 3|
| [ search            ]  |
| Syringes v             |
| Telfa pad       16     |
|  exp 2027-03   [Add]   |
| BD syringe 3mL  40     |
|  exp 2027-08   [-10+]  |
|  (tap row: photo+info) |
|========================|
| 1 line, 10 units [Send]|
+------------------------+
```

- **Palette:** navy `#0b2f5b` header, blue `#0337a3` actions, paper `#f7f5ef`
  (warm off-white, manifest paper), rule `#d5d5d5`, ink `#212121`, red
  `#df3131` for expired and hold only.
- **Type:** IBM Plex Sans (body, 400/500/600) + IBM Plex Mono 500 for codes,
  dates and quantities. Both are tabular by nature and cover Latin, Cyrillic
  and Greek.
- **Signature:** the numerals. Monospace columns that line up like a real
  manifest, plus a bottom tally bar ("Ticked: 3 lines, 24 units") that updates
  live and a box-number column that mirrors warehouse labelling.
- **Cart/status:** no separate cart. Ticked rows are the request; the tally bar
  is the entry to review. Status is a one-line ledger: `SUBMITTED > REVIEW >
  APPROVED > SHIPPED` with the current stage filled and dated.
- **For clinic staff:**
  - Scan speed: best of the four; 30+ rows per screen.
  - Slow connections: best; no images until hover or tap.
  - Non-native English: columns are labels and numbers, little prose; but
    abbreviations like "AVAIL" and "EXP" need plain-word labels or tooltips.
  - Mobile: weakest; a table is squeezed into two-line rows, and photos are
    hidden so identifying a product depends on the name.
  - Con: feels like a back-office tool; less welcoming to occasional users.

---

## Option C: "Aisles" (photo-led shop shelves)

**Concept:** browse like walking warehouse aisles: each subcategory is a
labelled shelf with a horizontal row of big photo crates you can scroll.

### Desktop
```
+----------------------------------------------------------------------+
| [B4P]   [ What do you need?  search...        ]    Request (3)       |
+----------------------------------------------------------------------+
| AISLE 1  NEEDLES & SYRINGES (213)                       See all >    |
| +--------+ +--------+ +--------+ +--------+ +--------+ ->            |
| | big    | | big    | |        | |        | |        |              |
| | photo  | | photo  | |        | |        | |        |              |
| +--------+ +--------+ +--------+ +--------+ +--------+              |
| BD 3mL syr.  Telfa pad                                                |
| 40 in stock  16 in stock   [ + ]                                      |
|----------------------------------------------------------------------|
| AISLE 2  IV SUPPLIES (152)                              See all >    |
| +--------+ +--------+ ...                                             |
+----------------------------------------------------------------------+
| (cart opens as a right drawer; "See all" turns the shelf into a grid)|
+----------------------------------------------------------------------+
```
### Mobile
```
+------------------------+
| [B4P]  [search]  [3]   |
| AISLE 1 Syringes  >    |
| [img][img][img] ->     |
| Telfa  BD 3mL  ...     |
| AISLE 2 IV supplies >  |
| [img][img][img] ->     |
+------------------------+
```

- **Palette:** blue `#0337a3`, navy `#0b2f5b`, kraft `#c9a66b` (cardboard
  box colour, used for shelf labels and thumbnails' border), kraft tint
  `#f6efe2` page wells, ink `#212121`, green `#3f7239`.
- **Type:** Poppins 600/500 (large, friendly shelf titles; closest to the
  site) + Inter 400/500 body.
- **Signature:** the shelf label: a kraft shipping-tag shape with stencil-like
  aisle number, repeated down the page. It gives a landmark for every section.
- **Cart/status:** a right-hand drawer styled as a cardboard box tab; items
  appear as small thumbnails with steppers. Status is a horizontal tracker
  with a box icon moving along the stages.
- **For clinic staff:**
  - Scan speed: good for browsing, slow for targeted lookups. Search is the
    escape hatch, and results show as a grid.
  - Slow connections: worst; many large images load on the first screen
    (mitigate: 6 per shelf, lazy, 200px).
  - Non-native English: strong; people recognise products visually.
  - Mobile: good; swipeable shelves feel native. Horizontal scroll hides
    items, so every shelf needs "See all".
  - Con: a few hundred to 1,100+ items across 12 shelves is a lot of scrolling.

---

## Option D: "Pack a box" (guided wizard)

**Concept:** instead of a catalog, a three-step flow for clinics that know
their need but not our inventory: say what you need, choose items, confirm.

### Desktop
```
+----------------------------------------------------------------------+
| [B4P]   1 Need  ---  2 Items  ---  3 Send          [Box: 3 items]    |
+----------------------------------------------------------------------+
| STEP 1   What does your clinic need?                                 |
| +-----------+ +-----------+ +-----------+ +-----------+              |
| |  icon     | |  icon     | |  icon     | |  icon     |              |
| | Wound     | | Needles & | | IV        | | Exam      |              |
| | care      | | syringes  | | supplies  | | gloves    |              |
| +-----------+ +-----------+ +-----------+ +-----------+              |
| [ Not sure? Search all supplies...                       ]           |
|                                         [ Next: choose items -> ]   |
+----------------------------------------------------------------------+
Step 2 = the chosen categories as rows with photo + stepper; Step 3 =
org/email + review + Send.
```
### Mobile
```
+------------------------+
| 1 Need - 2 Items - 3 Send|
| What do you need?      |
| [Wound care ][Syringes]|
| [IV supplies][Gloves  ]|
| [ search all...      ] |
|========================|
|      [ Next -> ]       |
+------------------------+
```

- **Palette:** navy `#0b2f5b` step bar, blue `#0337a3` Next buttons, light
  blue `#eaf1ff` selected tiles, kraft `#c9a66b` box fill, ink `#212121`,
  line `#e2e2e2`.
- **Type:** Poppins 600 (big step titles) + Atkinson Hyperlegible Next
  400/600 for body; it was designed for character distinction and low vision
  and reads well at small sizes.
- **Signature:** a box icon in the corner that fills as you add items (fill
  level reflects item count) and a large single question per screen.
- **Cart/status:** the box is the cart; step 3 is the full review. Status
  tracker is a vertical timeline with plain sentences ("HQ is checking your
  request", "Approved: we are packing it") and the date for each stage.
- **For clinic staff:**
  - Scan speed: slowest for repeat users; fastest for first-timers.
  - Slow connections: good; each step loads little.
  - Non-native English: best; one decision per screen, big labels, plain
    sentences.
  - Mobile: very good.
  - Con: hides the catalog; people who want to browse everything have to use
    the search escape hatch. Experienced partners will find it slow.

---

## Comparison

| | A Slip | B Packing list | C Aisles | D Pack a box |
|---|---|---|---|---|
| Scan speed | good | best | fair | slow (repeat use) |
| Slow connection | ok | best | worst | good |
| Non-native English | good | fair | good | best |
| Mobile | good | weakest | good | very good |
| Build effort | in progress | low-medium | medium | medium-high |
| Distinctiveness | medium | high | high | high |

## Recommendation

**Keep Option A as the base, and borrow two things from B.**

- A already has the right structure (photo catalog, persistent slip, guest
  checkout), and it is in progress; switching base layout now costs time.
- From B, take the **List view** as a real design, not an afterthought:
  monospace tabular quantities, box number and expiry columns, and a live
  tally in the slip. Repeat clinics that know what they want will use it daily,
  and it is the best option on slow connections.
- Add plain-word column labels ("In stock", "Expires") instead of warehouse
  abbreviations, for non-native readers.
- Avoid C as the default: image-heavy first screens are the wrong trade for
  slow connections. D is the right idea for a first-time visitor, so consider a
  single "Not sure what you need?" entry point later, not a full redesign.

Note: I did not have the `frontend-design` skill available in this session
(it is not in my skill list), so these directions were written without it.
