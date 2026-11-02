import { render } from '@testing-library/react';
import { iconFor, typeLabelFor, matchItem, iconForSubcategory, RULES } from './mapping';
import { ICONS, ICON_IDS, SPRITE } from './sprite';
import { ProductIcon, ProductIconSprite } from './ProductIcon';

// [General, expected icon, expected label]. Hand-written, shaped like the sheet.
const CASES = [
  ['syringe', 'syringe', 'Syringes'],
  ['10ml syringe', 'syringe', 'Syringes'],
  ['syringe with blunt fill needle', 'syringe-needle', 'Syringes with needles'],
  ['oral / enteral syringe', 'oral-syringe', 'Oral & enteral syringes'],
  ['saline flush syringe', 'flush-syringe', 'Flush syringes'],
  ['hypodermic safety needle', 'needle', 'Needles'],
  ['spinal needle', 'spinal-needle', 'Spinal needles'],
  ['blood collection set / butterfly needle', 'butterfly', 'Blood collection sets'],
  ['blood collection needle with holder', 'bc-needle', 'Blood collection needles'],
  ['vacutainer / blood collection tube holder', 'tube-holder', 'Tube holders'],
  ['blood collection tube', 'blood-tube', 'Blood collection tubes'],
  ['blood collection tubes', 'blood-tube', 'Blood collection tubes'],
  ['test tube', 'test-tube', 'Sample tubes'],
  ['sample vial', 'vial', 'Sample vials'],
  ['serum sample', 'tube-rack', 'Lab samples'],
  ['transfer pipette', 'pipette', 'Transfer pipettes'],
  ['iv catheter', 'iv-catheter', 'IV catheters'],
  ['i.v. catheter dressing', 'dressing', 'Securement dressings'],
  ['iv extension set', 'ext-set', 'Extension sets'],
  ['gravity iv set', 'iv-set', 'IV administration sets'],
  ['4-way stopcock', 'stopcock', 'Stopcocks'],
  ['needleless connector', 'connector', 'Connectors & adapters'],
  ['disinfecting caps for needleless connectors', 'disinfecting-cap', 'Disinfecting caps'],
  ['catheter stabilization device', 'stabilizer', 'Catheter securement devices'],
  ['specimen container', 'specimen-cup', 'Specimen containers'],
  ['specimen transport bag', 'specimen-bag', 'Specimen & biohazard bags'],
  ['cotton-tipped applicators', 'swab', 'Swabs & applicators'],
  ['skin antiseptic applicator', 'applicator', 'Skin prep applicators'],
  ['alcohol prep pads', 'packet', 'Alcohol prep pads'],
  ['gauze sponges', 'gauze', 'Gauze sponges & pads'],
  ['elastic bandage roll', 'roll-bandage', 'Bandage rolls & wraps'],
  ['adhesive bandage', 'adhesive-bandage', 'Adhesive bandages'],
  ['surgical tape', 'tape', 'Medical tape'],
  ['antimicrobial foam dressing', 'dressing', 'Wound dressings'],
  ['surgical suture with needle', 'suture', 'Sutures'],
  ['disposable scalpel', 'scalpel', 'Scalpels'],
  ['operating scissors', 'scissors', 'Scissors'],
  ['kelly forceps curved', 'hemostat', 'Forceps & hemostats'],
  ['needle holder', 'hemostat', 'Needle holders'],
  ['dressing forceps', 'tweezers', 'Dressing forceps'],
  ['surgical gloves', 'glove', 'Surgical gloves'],
  ['nitrile exam gloves', 'glove-box', 'Exam gloves'],
  ['procedure mask', 'mask', 'Face masks'],
  ['n95 respirator mask', 'n95', 'Respirators'],
  ['surgical mask with visor', 'face-shield', 'Face shields'],
  ['safety goggles', 'goggles', 'Safety glasses & goggles'],
  ['isolation gown', 'gown', 'Gowns'],
  ['bouffant cap', 'cap', 'Caps & bouffants'],
  ['shoe covers', 'shoe-cover', 'Shoe covers'],
  ['foley catheter', 'foley', 'Foley catheters'],
  ['urethral catheter', 'catheter', 'Urinary catheters'],
  ['suction catheter', 'suction-catheter', 'Suction catheters'],
  ['urinary drainage bag', 'urine-bag', 'Urinary drainage bags'],
  ['adult briefs', 'brief', 'Briefs & underwear'],
  ['underpads / chux', 'underpad', 'Underpads'],
  ['surgical drape', 'drape', 'Surgical drapes & covers'],
  ['o.r. towels', 'towel', 'Towels'],
  ['yankauer suction handle', 'yankauer', 'Suction tips & handles'],
  ['suction canister', 'suction-canister', 'Suction canisters'],
  ['oxygen mask with tubing', 'o2-mask', 'Oxygen masks'],
  ['nasal cannula', 'nasal-cannula', 'Nasal cannulas'],
  ['oral tracheal tube', 'et-tube', 'Endotracheal tubes'],
  ['endotracheal tube introducer (bougie)', 'stylet', 'Intubation stylets & bougies'],
  ['tracheostomy tube', 'trach', 'Tracheostomy tubes'],
  ['laryngeal mask airway', 'airway', 'Supraglottic airways'],
  ['manual resuscitator / bvm', 'bvm', 'Manual resuscitators'],
  ['nebulizer', 'nebulizer', 'Nebulizers & spacers'],
  ['blood pressure cuff', 'bp-cuff', 'Blood pressure cuffs'],
  ['dual head stethoscope', 'stethoscope', 'Stethoscopes'],
  ['thermometer probe covers', 'thermometer', 'Thermometers & probe covers'],
  ['pulse oximeter sensor', 'pulse-ox', 'Pulse oximeter sensors'],
  ['ecg foam electrodes', 'electrode', 'ECG electrodes & leads'],
  ['sharps container', 'sharps', 'Sharps containers'],
  ['body cleansing wipes / washcloths', 'wipes', 'Wipes & washcloths'],
  ['ostomy skin barrier', 'ostomy-barrier', 'Ostomy skin barriers'],
  ['urostomy pouch', 'ostomy-pouch', 'Ostomy pouches & supplies'],
  ['enteral feeding set', 'feeding-bag', 'Enteral feeding sets'],
  ['gastrostomy feeding tube', 'feeding-tube', 'Feeding & gastric tubes'],
  ['emesis bag', 'emesis-bag', 'Emesis bags'],
  ['sterile bowl', 'bowl', 'Bowls & basins'],
  ['iv start kit', 'kit', 'IV start kits'],
  ['plastic medicine cups', 'cup', 'Cups & utensils'],
  ['facial tissues', 'tissues', 'Tissues'],
  ['infant feeding bottle', 'baby-bottle', 'Infant feeding'],
  ['breast pump flange insert', 'baby-bottle', 'Infant feeding'],
  ['pediatric wrist splint', 'brace', 'Braces & splints'],
  ['ice bag', 'pack', 'Hot & cold packs'],
  ['percutaneous sheath introducer kit', 'kit', 'Procedure kits & trays'],
  ['foam head positioner', 'pillow', 'Positioners & pillows'],
  ['medical pillow / padding', 'pillow', 'Positioners & pillows'],
  ['biohazard labels', 'label', 'Labels, tags & cards'],
  ['lubricating jelly packet', 'packet', 'Lubricating jelly'],
  ['hair combs', 'comb', 'Personal care'],
];

describe('iconFor / typeLabelFor', () => {
  test.each(CASES)('%s -> %s / %s', (general, icon, label) => {
    const item = { general, name: '', subcategory: 'Misc Surgical' };
    expect(matchItem(item).via).toBe('general');
    expect(iconFor(item)).toBe(icon);
    expect(typeLabelFor(item)).toBe(label);
  });

  test('coverage over the synthetic list is complete', () => {
    const specific = CASES.filter(([g]) => matchItem({ general: g }).via === 'general').length;
    expect(specific / CASES.length).toBe(1);
  });

  test('rows that share a type label share one drawing', () => {
    const byLabel = new Map();
    for (const [, label, icon] of RULES) {
      if (byLabel.has(label)) expect([label, icon]).toEqual([label, byLabel.get(label)]);
      byLabel.set(label, icon);
    }
  });

  test('tube- and syringe-family types each have their own drawing', () => {
    const TUBE_FAMILY = [
      'Blood collection tubes', 'Sample tubes', 'Urine tubes', 'Sample vials', 'Lab samples',
      'Urinary catheters', 'Suction catheters', 'Feeding & gastric tubes', 'Surgical drains',
      'External catheters', 'Foley catheters', 'Endotracheal tubes', 'Intubation stylets & bougies',
      'Laryngoscopes', 'CO2 detectors', 'Tracheostomy tubes', 'Supraglottic airways',
      'Extension sets', 'Suction tubing', 'Pressure monitoring sets', 'IV administration sets',
      'IV catheters', 'Arterial catheter sets', 'Connectors & adapters', 'Closed system transfer devices',
      'Disinfecting caps', 'Catheter securement devices', 'Airway tube holders', 'Tube holders',
      'Blood collection needles', 'Blood collection sets', 'Needles', 'Spinal needles',
      'Blunt needles & cannulas',
      // Syringe family
      'Syringes', 'Syringes with needles', 'Oral & enteral syringes', 'Insulin syringes',
      'Catheter-tip syringes', 'Flush syringes', 'Arterial blood sampling kits', 'Atomization devices',
    ];
    const iconOf = new Map(RULES.map(([, label, icon]) => [label, icon]));
    for (const label of TUBE_FAMILY) expect(iconOf.has(label)).toBe(true);
    const icons = TUBE_FAMILY.map((l) => iconOf.get(l));
    expect(new Set(icons).size).toBe(TUBE_FAMILY.length);
  });

  test('accepts raw sheet rows as well as normalized items', () => {
    expect(iconFor({ General: 'Foley Catheter', Name: 'x', Subcategory: 'Catheters & Briefs' })).toBe('foley');
  });

  test('falls back to Name keywords, then subcategory, then box', () => {
    expect(matchItem({ general: '', name: 'BD Vacutainer Safety-Lok Blood Collection Set' })).toMatchObject({
      icon: 'butterfly',
      via: 'name',
    });
    expect(matchItem({ general: 'lead clippers', name: 'Unknown', subcategory: 'Gloves' })).toMatchObject({
      icon: 'glove',
      label: 'Other gloves',
      via: 'subcategory',
    });
    expect(matchItem({ general: '', name: 'Unknown', subcategory: '' })).toMatchObject({
      icon: 'box',
      label: 'Unsorted supplies',
      via: 'fallback',
    });
  });

  test('every subcategory has a drawing', () => {
    expect(iconForSubcategory('IV Supplies')).toBe('iv-bag');
    expect(iconForSubcategory('Apparel (Gowns, Shoe Covers, etc.)')).toBe('gown');
    expect(iconForSubcategory('nope')).toBe('box');
  });

  test.each(['constructor', '__proto__', 'toString'])('ignores Object.prototype keys: %s', (key) => {
    expect(matchItem({ general: key, name: key, subcategory: key })).toEqual({
      icon: 'box',
      label: 'Unsorted supplies',
      via: 'fallback',
    });
    expect(matchItem({ general: key, subcategory: 'Gloves' })).toMatchObject({ icon: 'glove', via: 'subcategory' });
    expect(iconForSubcategory(key)).toBe('box');
  });

  test('is deterministic and tolerates missing fields', () => {
    expect(iconFor({})).toBe('box');
    expect(iconFor({ general: 'Syringe' })).toBe(iconFor({ general: 'syringe ' }));
  });
});

describe('sprite', () => {
  test('stays within budget (40 KB raw)', () => {
    expect(SPRITE.length).toBeLessThan(40 * 1024);
  });

  test('every icon is a symbol and every mapped icon exists', () => {
    for (const id of ICON_IDS) expect(SPRITE).toContain(`<symbol id="pi-${id}"`);
    for (const [, icon] of CASES) expect(ICONS[icon]).toBeDefined();
  });
});

describe('ProductIcon', () => {
  test('references the symbol and falls back to box for unknown types', () => {
    const { container } = render(
      <>
        <ProductIconSprite />
        <ProductIcon type="syringe" size={32} />
        <ProductIcon type="nope" title="Unknown" />
      </>
    );
    const uses = container.querySelectorAll('svg.product-icon use');
    expect(uses[0].getAttribute('href')).toBe('#pi-syringe');
    expect(uses[1].getAttribute('href')).toBe('#pi-box');
    expect(container.querySelector('#pi-syringe')).not.toBeNull();
    expect(container.querySelector('[aria-label="Unknown"]')).not.toBeNull();
  });

  test.each(['constructor', '__proto__', 'toString'])('renders box for type=%s', (type) => {
    const { container } = render(<ProductIcon type={type} />);
    expect(container.querySelector('use').getAttribute('href')).toBe('#pi-box');
  });
});
