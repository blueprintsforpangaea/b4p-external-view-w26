// Maps an inventory row to a product drawing and a McMaster-style type label.
// Order matters: the first rule whose pattern matches wins, so specific rules
// sit above general ones. Pure and deterministic; results are cached per input.

import { hasIcon } from './sprite';

// [pattern, label, icon]. A label always uses the same icon (tested).
export const RULES = [
  // Strings that would otherwise be caught by a broader rule below
  [/dressing forceps/, 'Dressing forceps', 'tweezers'],
  [/needle holder/, 'Needle holders', 'hemostat'],
  [/suture/, 'Sutures', 'suture'],
  [/skin stapl|staple remover/, 'Skin staplers & removers', 'hemostat'],
  [/pill (crush|cut)/, 'Pill crushers & cutters', 'cup'],
  [/breast|nipple|nurser|pacifier|feeding bottle|milk/, 'Infant feeding', 'baby-bottle'],
  [/disinfecting|port (cap|protector)/, 'Disinfecting caps', 'disinfecting-cap'],

  // Blood collection (before generic needle/tube/holder rules)
  [/butterfly|blood collection (set|kit|sub ?kit|subassembly|transfer)|phlebotomy/, 'Blood collection sets', 'butterfly'],
  [/trach\w* tube holder|tube fastener/, 'Airway tube holders', 'tube-holder-airway'],
  [/blood collection needle|safety needles \/ blood/, 'Blood collection needles', 'bc-needle'],
  [/(tube|sampling) holder|needle adapter|collection adapter|vacutainer/, 'Tube holders', 'tube-holder'],
  [/blood (collection |test )?tubes?|draw tube/, 'Blood collection tubes', 'blood-tube'],
  [/lancet|heel incision/, 'Lancets', 'lancet'],

  // Syringes
  [/flush syringe/, 'Flush syringes', 'flush-syringe'],
  [/(oral|enteral)\b.*syringe/, 'Oral & enteral syringes', 'oral-syringe'],
  [/insulin/, 'Insulin syringes', 'insulin-syringe'],
  [/catheter tip|syringe with catheter/, 'Catheter-tip syringes', 'tip-syringe'],
  [/arterial blood sampling/, 'Arterial blood sampling kits', 'abg-syringe'],
  [/syringe.*needle|needle.*syringe/, 'Syringes with needles', 'syringe-needle'],
  [/syringe/, 'Syringes', 'syringe'],
  [/atomiz/, 'Atomization devices', 'atomizer'],

  // Needles
  [/spinal needle/, 'Spinal needles', 'spinal-needle'],
  [/blunt (fill )?needle|blunt cannula|vial access cannula/, 'Blunt needles & cannulas', 'blunt-needle'],
  [/\bneedles?\b/, 'Needles', 'needle'],

  // Specimens and lab
  [/\bvials?\b/, 'Sample vials', 'vial'],
  [/urine (sample|collection)? ?tube/, 'Urine tubes', 'urine-tube'],
  [/(sample|specimen|collection|centrifuge|test) tubes?|microcentrifuge|saliva collection/, 'Sample tubes', 'test-tube'],
  [/serum|plasma|hematology|predose|(dna|surgical) sample/, 'Lab samples', 'tube-rack'],
  [/pipette/, 'Transfer pipettes', 'pipette'],
  [/slide\b/, 'Microscope slides', 'label'],
  [/collection pan|\bbowl|basin/, 'Bowls & basins', 'bowl'],
  [/specimen collection kit/, 'Specimen collection kits', 'kit'],
  [/urine (sample|collection container|specimen)|specimen (collection )?container|collection container/, 'Specimen containers', 'specimen-cup'],
  [/body bag/, 'Body bags', 'specimen-bag'],
  [/specimen (transport )?bags?|biohazard (waste )?bags?|stool collection bag|transport bag/, 'Specimen & biohazard bags', 'specimen-bag'],
  [/fecal occult/, 'Diagnostic tests', 'label'],
  [/reagent strip|test strip|glucose|glucometer/, 'Test strips & meters', 'glucose-meter'],

  // Skin prep (before swabs and wipes)
  [/alcohol prep/, 'Alcohol prep pads', 'packet'],
  [/prep (wipes|cloths)/, 'Skin prep wipes', 'packet'],
  [/skin (antiseptic|prep)|preoperative skin|antiseptic applicator/, 'Skin prep applicators', 'applicator'],
  [/swab|cotton-tipped|toothbrush|dna collection/, 'Swabs & applicators', 'swab'],

  // Ostomy (before generic barrier/pouch/belt rules)
  [/ostomy skin barrier|barrier ring|ostomy ring|barrier extender|ostomy barrier|flange/, 'Ostomy skin barriers', 'ostomy-barrier'],
  [/ostomy (paste|strip paste|belt|pouch deodorant)|odor eliminator|urostomy drain|\bostomy.*accessory/, 'Ostomy accessories', 'ostomy-pouch'],
  [/\b(ostomy|urostomy|colostomy|ileostomy)|fecal collector/, 'Ostomy pouches & supplies', 'ostomy-pouch'],

  // IV
  [/(iv|catheter) (site|catheter) dressing|securement dressing/, 'Securement dressings', 'dressing'],
  [/arter(ial|y) catheter/, 'Arterial catheter sets', 'arterial-catheter'],
  [/iv catheter/, 'IV catheters', 'iv-catheter'],
  [/iv start kit/, 'IV start kits', 'kit'],
  [/enteral transition|needleless|luer access/, 'Connectors & adapters', 'connector'],
  [/enteral|feeding (set|bag)/, 'Enteral feeding sets', 'feeding-bag'],
  [/manometer|stopcock/, 'Stopcocks', 'stopcock'],
  [/pressure (monitoring|tubing)|transducer/, 'Pressure monitoring sets', 'pressure-set'],
  [/suction tubing/, 'Suction tubing', 'suction-tubing'],
  [/extension (set|tubing)|connecting tubing|tubing sleeve|blood chamber/, 'Extension sets', 'ext-set'],
  [/(gravity|primary|secondary|vented|pump|infusion|administration).*set|iv set|infusion set|capd|y-set/, 'IV administration sets', 'iv-set'],
  [/iv (bag|solution)|saline bag/, 'IV solutions', 'iv-bag'],
  [/site protect|iv site|securement|stabiliz/, 'Catheter securement devices', 'stabilizer'],
  [/closed system transfer/, 'Closed system transfer devices', 'cstd'],
  [/connector|adapter|transfer device|dispensing pin|injection site|anti-reflux|water trap|\bvalve/, 'Connectors & adapters', 'connector'],

  // Wound care
  [/dressing kit|dressing change/, 'Dressing kits', 'kit'],
  [/adhesive bandage|band-?aid/, 'Adhesive bandages', 'adhesive-bandage'],
  [/plaster|casting/, 'Casting materials', 'roll-bandage'],
  [/tubular|stockinette|net (bandage|dressing)|dressing retainer/, 'Tubular bandages', 'roll-bandage'],
  [/self-adherent|elastic bandage|bandage roll|conforming|gauze bandage|tourniquet/, 'Bandage rolls & wraps', 'roll-bandage'],
  [/gauze|sponges|packing strip|bandage pads/, 'Gauze sponges & pads', 'gauze'],
  [/label tape|emergency tape|tape measure/, 'Labels, tags & cards', 'label'],
  [/\btape\b/, 'Medical tape', 'tape'],
  [/negative pressure wound/, 'Negative pressure wound therapy', 'dressing'],
  [/dressing|xeroform|petrolatum/, 'Wound dressings', 'dressing'],
  [/barrier film|skin protectant|protective powder/, 'Skin protectants', 'packet'],
  [/hemosta|gelatin/, 'Hemostatic agents', 'bottle'],
  [/wound care|bandage/, 'Wound dressings', 'dressing'],

  // Catheters, drains, continence
  [/foley/, 'Foley catheters', 'foley'],
  [/drainage bag|urine bag|leg bag/, 'Urinary drainage bags', 'urine-bag'],
  [/urinal\b/, 'Urinals', 'bottle'],
  [/external catheter|incontinence catheter/, 'External catheters', 'external-catheter'],
  [/suction catheter/, 'Suction catheters', 'suction-catheter'],
  [/feeding tube|nasogastric|gastrostomy|stomach tube|gastric/, 'Feeding & gastric tubes', 'feeding-tube'],
  [/penrose|chest tube|drainage starter/, 'Surgical drains', 'drain'],
  [/urine specimen collector/, 'Specimen containers', 'specimen-cup'],
  [/intermittent|urethral|utility catheter|sterile catheter|^catheter$/, 'Urinary catheters', 'catheter'],
  [/newborn diaper|baby diaper/, 'Baby diapers', 'brief'],
  [/brief|diaper|underwear|knit pants/, 'Briefs & underwear', 'brief'],
  [/underpad|chux/, 'Underpads', 'underpad'],

  // Airway & oxygen
  [/tracheal hook/, 'Surgical instruments', 'hemostat'],
  [/tracheostomy|inner cannula/, 'Tracheostomy tubes', 'trach'],
  [/bougie|stylet/, 'Intubation stylets & bougies', 'stylet'],
  [/endotracheal|oral tracheal|tracheal tube|endobronchial/, 'Endotracheal tubes', 'et-tube'],
  [/laryngoscope/, 'Laryngoscopes', 'laryngoscope'],
  [/carbon dioxide detector/, 'CO2 detectors', 'co2-detector'],
  [/laryngeal mask|supraglottic|airway device|bite block/, 'Supraglottic airways', 'airway'],
  [/nasal cannula/, 'Nasal cannulas', 'nasal-cannula'],
  [/(resuscitation|anesthesia|cushioned) .*mask|mask .*resuscitation/, 'Resuscitation & anesthesia masks', 'o2-mask'],
  [/resuscitator|bvm/, 'Manual resuscitators', 'bvm'],
  [/breathing circuit|anesthesia circuit/, 'Breathing circuits', 'bvm'],
  [/oxygen|full face mask/, 'Oxygen masks', 'o2-mask'],
  [/nebuliz|holding chamber|spacer/, 'Nebulizers & spacers', 'nebulizer'],
  [/suction canister|canister lid/, 'Suction canisters', 'suction-canister'],
  [/yankauer|suction (handle|tip|instrument|device)|poole/, 'Suction tips & handles', 'yankauer'],
  [/percussor/, 'Percussors', 'cup'],

  // Masks, eyes
  [/n95|r95|respirator|duckbill/, 'Respirators', 'n95'],
  [/face shield|visor/, 'Face shields', 'face-shield'],
  [/goggles|safety glasses|eye shield|moisture chamber/, 'Safety glasses & goggles', 'goggles'],
  [/mask/, 'Face masks', 'mask'],

  // Gloves
  [/restraint|limb holder|mitts/, 'Restraints', 'brace'],
  [/surgical (under)?gloves?|undergloves?|latex surgical/, 'Surgical gloves', 'glove'],
  [/glove/, 'Exam gloves', 'glove-box'],

  // Apparel
  [/gown/, 'Gowns', 'gown'],
  [/shampoo/, 'Bathing supplies', 'wipes'],
  [/bouffant|scrub cap|surgical cap/, 'Caps & bouffants', 'cap'],
  [/walk(ing|er) boot|brace|splint|sling|collar|binder/, 'Braces & splints', 'brace'],
  [/stocking|compression garment/, 'Compression stockings', 'brace'],
  [/shoe cover/, 'Shoe covers', 'shoe-cover'],
  [/slipper|shoes/, 'Patient footwear', 'shoe-cover'],
  [/apparel|sweatshirt|\bppe\b/, 'Apparel', 'gown'],

  // Instruments
  [/scalpel/, 'Scalpels', 'scalpel'],
  [/scissors/, 'Scissors', 'scissors'],
  [/forceps|hemostat/, 'Forceps & hemostats', 'hemostat'],
  [/clamp|clips/, 'Clamps', 'hemostat'],
  [/retractor|instrument|cassette|inspection mirror/, 'Surgical instruments', 'hemostat'],
  [/electrosurgical|marker/, 'Markers & electrosurgical pencils', 'scalpel'],
  [/drape|probe cover(?!s?$)|ultrasound/, 'Surgical drapes & covers', 'drape'],
  [/towel(?!ette)/, 'Towels', 'towel'],
  [/scrub brush|nail cleaner/, 'Scrub brushes', 'sponge'],
  [/sharps/, 'Sharps containers', 'sharps'],

  // Vitals
  [/thermometer|probe cover/, 'Thermometers & probe covers', 'thermometer'],
  [/blood pressure/, 'Blood pressure cuffs', 'bp-cuff'],
  [/stethoscope/, 'Stethoscopes', 'stethoscope'],
  [/oximeter/, 'Pulse oximeter sensors', 'pulse-ox'],
  [/electrode|ecg|lead ?wires|fetal monitoring/, 'ECG electrodes & leads', 'electrode'],

  // Everyday and non-medical
  [/emesis/, 'Emesis bags', 'emesis-bag'],
  [/lubricat|jelly/, 'Lubricating jelly', 'packet'],
  [/washcloth|cloths|towelette|cleansing|wipe|cleaning pads|nail polish/, 'Wipes & washcloths', 'wipes'],
  [/tissue/, 'Tissues', 'tissues'],
  [/cups?\b|cutlery|spoon|straw/, 'Cups & utensils', 'cup'],
  [/blanket/, 'Blankets', 'underpad'],
  [/\bheat\b|ice bag|gel pak|warmer/, 'Hot & cold packs', 'pack'],
  [/positioner|pillow|padding/, 'Positioners & pillows', 'pillow'],
  [/\blabels?\b|sticker|identification band|reference card|security (tag|tracking)|footprint/, 'Labels, tags & cards', 'label'],
  [/sterilization pouch|plastic wrap|packaging|carrying pouch/, 'Packaging & pouches', 'packet'],
  [/comb|brush|emery/, 'Personal care', 'comb'],
  [/medication|pharmacy|medicine/, 'Medications', 'bottle'],
  [/stent|exclusion system/, 'Cardiac devices', 'kit'],
  [/kit|tray|pack\b|set\b|surgical suppl|medical suppl|supply pack/, 'Procedure kits & trays', 'kit'],
];

// Representative drawing and catch-all label for each subcategory. A Map, so
// data values like "constructor" never resolve through Object.prototype.
const SUBCATEGORIES = new Map(Object.entries({
  'needles & syringes': ['syringe', 'Other needles & syringes'],
  'iv supplies': ['iv-bag', 'Other IV supplies'],
  'misc surgical': ['kit', 'Other surgical supplies'],
  'misc non-medical': ['box', 'Other non-medical supplies'],
  'wound care & bandages': ['adhesive-bandage', 'Other wound care'],
  'catheters & briefs': ['foley', 'Other catheter & continence supplies'],
  'vitals & home health': ['stethoscope', 'Other vitals & home health'],
  'airway & oxygen': ['o2-mask', 'Other airway & oxygen supplies'],
  gloves: ['glove', 'Other gloves'],
  'masks & face shields': ['mask', 'Other masks & face protection'],
  'apparel (gowns, shoe covers, etc.)': ['gown', 'Other apparel'],
  sutures: ['suture', 'Other sutures'],
}));
export const FALLBACK_ICON = 'box';
export const FALLBACK_LABEL = 'Unsorted supplies';

for (const [, , icon] of RULES) if (!hasIcon(icon)) throw new Error(`Unknown icon in rules: ${icon}`);

const clean = (v) =>
  (v == null ? '' : String(v))
    .toLowerCase()
    .replace(/\bi\.v\./g, 'iv')
    .replace(/\bo\.r\./g, 'or')
    .replace(/\s+/g, ' ')
    .trim();

function findRule(text) {
  if (!text || text === 'unknown') return null;
  for (const rule of RULES) if (rule[0].test(text)) return rule;
  return null;
}

const cache = new Map();

// Full result: { icon, label, via } where via is 'general' | 'name' | 'subcategory' | 'fallback'.
export function matchItem(item) {
  const general = clean(item.general ?? item.General);
  const name = clean(item.rawName ?? item.name ?? item.Name);
  const sub = clean(item.subcategory ?? item.Subcategory);
  const key = `${general}\u0000${name}\u0000${sub}`;
  let hit = cache.get(key);
  if (hit) return hit;

  let rule = findRule(general);
  let via = 'general';
  if (!rule) {
    rule = findRule(name);
    via = 'name';
  }
  if (rule) {
    hit = { icon: rule[2], label: rule[1], via };
  } else if (SUBCATEGORIES.has(sub)) {
    const [icon, label] = SUBCATEGORIES.get(sub);
    hit = { icon, label, via: 'subcategory' };
  } else {
    hit = { icon: FALLBACK_ICON, label: FALLBACK_LABEL, via: 'fallback' };
  }
  cache.set(key, hit);
  return hit;
}

export const iconFor = (item) => matchItem(item).icon;
export const typeLabelFor = (item) => matchItem(item).label;

// Icon for a subcategory heading or tree entry.
export function iconForSubcategory(subcategory) {
  const entry = SUBCATEGORIES.get(clean(subcategory));
  return entry ? entry[0] : FALLBACK_ICON;
}
