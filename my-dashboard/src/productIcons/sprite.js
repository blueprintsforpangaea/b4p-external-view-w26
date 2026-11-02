// Product line drawings, McMaster style. Original artwork for this project.
// Grid: 48x48. Stroke width, caps, joins and colour are set once on the
// <svg> that <use>s a symbol (see ProductIcon.js), so paths here carry
// geometry only. Dots are zero-length round-capped segments ("h0").

// Long thin things are drawn horizontally and turned to a 45° diagonal.
const R = (s) => `<g transform="rotate(-45 24 24)">${s}</g>`;
const T = (deg, s) => `<g transform="rotate(${deg} 24 24)">${s}</g>`;
const BIO = (x, y) => `<use href="#pi-bio" x="${x}" y="${y}"/>`;

// Syringe family: shared plunger, flange and barrel; variants change the barrel
// height (h), the tick marks and the tip.
const SYR = (tip, h = 10, marks = 'M24 19v4M28 19v4M32 19v4') => {
  const y = 24 - h / 2;
  return R(`<rect x="13" y="${y}" width="22" height="${h}" rx="1"/><path d="M3 ${y}v${h}M3 24h16M13 ${y - 3}v${h + 6}M19 ${y}v${h}${marks}${tip}"/>`);
};

// Shared detail: a small biohazard trefoil centred on (0,0).
const DEFS = '<defs><g id="pi-bio"><circle cy="-2.6" r="2.6"/><circle cx="-2.3" cy="1.4" r="2.6"/><circle cx="2.3" cy="1.4" r="2.6"/></g></defs>';

export const ICONS = {
  // Needles & syringes
  syringe: SYR('M35 22h4v4h-4'),
  'syringe-needle': SYR('M35 22h4v4h-4M39 24h7'),
  'oral-syringe': SYR('M35 21h5v6h-5', 14, 'M24 17v4M28 17v4M32 17v4'),
  'insulin-syringe': SYR('M35 22h10v4H35M37 22v4M38 22v4', 6, 'M24 21v2M27 21v2M30 21v2M33 21v2'),
  'tip-syringe': SYR('M35 21h3l6 2v2l-6 2h-3'),
  'flush-syringe': SYR('M35 22h4v4h-4M39 21h3v6h-3', 10, 'M23 19v10M31 19v10M25 24h4'),
  'abg-syringe': SYR('M35 22h4v4h-4M39 24h7M37 21l5-5 2 2-5 5', 10, 'M21 19v10M28 19v4M32 19v4'),
  'atomizer': SYR('M35 22h4v4h-4M39 24h2')+'<circle cx="38.1" cy="9.9" r="3"/>',
  needle: R('<path d="M5 17v14M5 19h6l4 3h6v4h-6l-4 3H5M8 19v10M21 24h23M41 22.5l3 1.5"/>'),
  'spinal-needle': R('<path d="M3 21v6M5 19h7v10H5M8 19v10M12 22h3v4h-3M15 24h29M41 22.5l3 1.5"/>'),
  'blunt-needle': R('<path d="M5 17v14M5 19h6l4 3h6v4h-6l-4 3H5M8 19v10M21 22.5h15v3H21"/>'),
  butterfly: '<rect x="23" y="19" width="13" height="4" rx="1"/><path d="M27 19l-2-9a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2l-1 9M27 23l-2 9a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l-1-9M36 21h9M23 21h-9c-5 0-9 4-9 9s4 9 9 9h12M26 36h6l2 2v2l-2 2h-6z"/>',
  'tube-holder': R('<path d="M8 12v24M8 15h22a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8M32 21h4v6h-4M36 24h9M14 20v8"/>'),
  'bc-needle': R('<path d="M4 22.5h11v3H4zM15 21h4v6h-4M16.5 21v6M19 19h10v10H19zM29 24h15M41 22.5l3 1.5"/>'),
  'blood-tube': '<rect x="16" y="3" width="16" height="10" rx="1.5"/><path d="M21 3v10M27 3v10M18 13v26a6 6 0 0 0 12 0V13M18 20h12M18 33h12"/>',
  'test-tube': T(25, '<path d="M15 6h18M18 6v30a6 6 0 0 0 12 0V6M18 25h12M22 30h0M26 34h0"/>'),
  'urine-tube': T(25, '<rect x="15" y="3" width="18" height="7" rx="1"/><path d="M20 3v7M28 3v7M17 10v24l7 9 7-9V10M17 25h14"/>'),
  vial: '<path d="M18 4h12v6H18zM20 10v3c0 1.5-5 2.5-5 5v21a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3V18c0-2.5-5-3.5-5-5v-3M15 24h18M15 35h18"/>',
  'tube-rack': '<path d="M4 20h40v6H4zM7 26v16M41 26v16M4 42h40M9 5h6v5H9zM21 5h6v5h-6zM33 5h6v5h-6zM10 10v10M14 10v10M22 10v10M26 10v10M34 10v10M38 10v10M10 26v6a2 2 0 0 0 4 0v-6M22 26v6a2 2 0 0 0 4 0v-6M34 26v6a2 2 0 0 0 4 0v-6"/>',
  lancet: R('<rect x="6" y="17" width="26" height="14" rx="4"/><path d="M32 21h5v6h-5M37 24h5M12 20v8M16 20v8"/>'),

  // IV
  'iv-catheter': R('<rect x="3" y="20" width="11" height="8" rx="1.5"/><path d="M6 24h5M14 22h2M14 26h2M16 20h8l3 3v2l-3 3h-8zM19 20l-1-6h4l1 6M19 28l-1 6h4l1-6M27 22.5h13a1.5 1.5 0 0 1 0 3H27M42 24h3"/>'),
  'arterial-catheter': R('<rect x="1" y="21" width="13" height="6" rx="1.5"/><path d="M6 21v-3h3v3M14 22h2M14 26h2M16 20h8l3 3v2l-3 3h-8zM19 20l-1-6h4l1 6M19 28l-1 6h4l1-6M27 22.5h13a1.5 1.5 0 0 1 0 3H27M42 24h3"/>'),
  'iv-bag': '<rect x="20" y="7" width="8" height="3" rx="1.5"/><path d="M14 3h20a2 2 0 0 1 2 2v23c0 3-2 5-5 5H17c-3 0-5-2-5-5V5a2 2 0 0 1 2-2zM16 15h5M16 19h3M16 23h5M24 33v3M21 36h6v7h-6zM24 39.5h0M24 43v3"/>',
  'iv-set': '<rect x="6" y="7" width="8" height="11" rx="1.5"/><rect x="20" y="25" width="8" height="10" rx="1.5"/><circle cx="24" cy="30" r="2"/><path d="M10 2v5M10 12.5h0M10 18v4c0 5 3 8 8 8h2M28 30h2c5 0 8 3 8 8M35 38h6v4h-6zM38 42v4"/>',
  'ext-set': '<rect x="20" y="17" width="8" height="8" rx="1.5"/><path d="M4 6h8v6H4zM12 9h18c8 0 8 12 0 12H18c-8 0-8 12 0 12h14M32 30h8v6h-8zM40 33h4"/>',
  'suction-tubing': '<path d="M2 5h4v8H2zM6 6.5h6v5H6zM12 9h18c8 0 8 12 0 12H18c-8 0-8 12 0 12h12M30 30.5h6v5h-6zM36 29h4v8h-4z"/>',
  'pressure-set': '<rect x="18" y="15" width="12" height="12" rx="2"/><circle cx="24" cy="21" r="2.5"/><path d="M4 6h8v6H4zM12 9h18c8 0 8 12 0 12M18 21c-8 0-8 12 0 12h14M32 30h8v6h-8zM40 33h4M27 15c0-6 5-9 10-9h7"/>',
  stopcock: '<circle cx="24" cy="26" r="6"/><path d="M4 23h14M4 29h14M30 23h14M30 29h14M4 23v6M44 23v6M21 31.5V42h6V31.5M24 20v-8M17 12h14M24 26h0"/>',
  connector: '<rect x="17" y="4" width="14" height="8" rx="3"/><path d="M15 12h18v11l-4 5H19l-4-5zM15 17h18M21 28v12h6V28M21 32h6M24 40v4"/>',
  cstd: '<rect x="11" y="4" width="26" height="20" rx="5"/><path d="M11 11h26M16 24l3 5h10l3-5M21 29v11h6V29M24 40v4"/>',
  'disinfecting-cap': '<path d="M14 14a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v22H14zM11 36h26v4H11zM19 11v25M24 11v25M29 11v25"/>',
  pipette: T(35, '<path d="M20 17c-2-2-3-5-3-8a7 7 0 0 1 14 0c0 3-1 6-3 8zM21 17l1 5v14l2 8 2-8V22l1-5M22 27h2M22 31h2"/>'),

  // Specimens
  'specimen-cup': '<rect x="10" y="6" width="28" height="7" rx="1.5"/><path d="M17 6v7M24 6v7M31 6v7M12 13l2 27a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2l2-27M16 23h5M16 29h3M16 35h5"/>',
  'specimen-bag': `<rect x="8" y="5" width="32" height="38" rx="2"/><path d="M8 11h32M8 33h32"/>${BIO(24, 22)}`,
  swab: R('<path d="M3 19h26M8 29h26"/><ellipse cx="34" cy="19" rx="5" ry="3"/><ellipse cx="39" cy="29" rx="5" ry="3"/>'),

  // Wound care
  gauze: '<path d="M8 8h24l8 8v24H8zM32 8v8h8"/><path stroke-width="1" d="M8 16h24M8 24h32M8 32h32M16 8v32M24 8v32M32 16v24"/>',
  'roll-bandage': '<ellipse cx="15" cy="24" rx="6" ry="13"/><ellipse cx="15" cy="24" rx="2.5" ry="5"/><path d="M15 11h17a6 13 0 0 1 0 26H15M32 37h11v-5h-6.3"/>',
  'adhesive-bandage': R('<rect x="3" y="16" width="42" height="16" rx="8"/><rect x="17" y="18.5" width="14" height="11" rx="1.5"/><path d="M9 21h0M9 27h0M13 24h0M39 21h0M39 27h0M35 24h0"/>'),
  tape: '<circle cx="21" cy="21" r="15"/><circle cx="21" cy="21" r="7"/><path d="M21 36h22v-5H32"/>',
  dressing: '<rect x="7" y="7" width="34" height="34" rx="6"/><rect x="15" y="15" width="18" height="18" rx="2"/><path d="M20 20h0M28 20h0M24 24h0M20 28h0M28 28h0"/>',
  suture: '<rect x="5" y="16" width="22" height="27" rx="1.5"/><path d="M9 22h14M9 26h10M24 10a9 9 0 0 1 17 5M41 15c1 8-3 14-9 16-4 1-4 5-1 8"/>',

  // Instruments
  scalpel: R('<path d="M4 21h21v6H4a3 3 0 0 1 0-6zM8 24h12M25 22h5c8 0 13 2 15 5H25z"/>'),
  scissors: T(45, '<circle cx="17" cy="38" r="5"/><circle cx="31" cy="38" r="5"/><path d="M20.5 34.5L24 22M27.5 34.5L24 22M22.5 22l6-18-2 18zM25.5 22l-6-18 2 18zM24 22h0"/>'),
  hemostat: T(45, '<circle cx="17" cy="40" r="4.5"/><circle cx="31" cy="40" r="4.5"/><rect x="21.5" y="19" width="5" height="4"/><path d="M19 35.8L22 23M29 35.8L26 23M22 19l1.3-15h1.4L26 19M20.6 30h2.4M27.4 30H25"/>'),
  tweezers: T(35, '<path d="M22 4h4M22 4l-8 39 2 1 8-36M26 4l8 39-2 1-8-36M19 21l2 .5M18.4 25l2 .5M29 21l-2 .5M29.6 25l-2 .5"/>'),

  // Gloves, masks, apparel
  glove: '<rect x="17" y="40" width="18" height="5" rx="1"/><path d="M18 40v-7l-6-6a2.1 2.1 0 0 1 3-3l3 3V13a2 2 0 0 1 4 0v9V10a2 2 0 0 1 4 0v12V11a2 2 0 0 1 4 0v11V14a2 2 0 0 1 4 0v26"/>',
  'glove-box': '<path d="M5 22h38v20H5zM5 22l4-6h30l4 6M16 19h16M18 19v-7a2 2 0 0 1 4 0V10a2 2 0 0 1 4 0v2a2 2 0 0 1 4 0v7M22 12v5M26 12v5M11 29h14M11 34h9"/>',
  mask: '<path d="M12 15c6-3 18-3 24 0v15c-6 4-18 4-24 0zM12 21c6 2 18 2 24 0M12 26c6 2 18 2 24 0M12 17c-5 0-8 3-8 7s3 7 8 7M36 17c5 0 8 3 8 7s-3 7-8 7M20 14.5h8"/>',
  n95: '<circle cx="24" cy="27" r="3.5"/><path d="M8 25c0-9 7-15 16-15s16 6 16 15c0 7-7 12-16 12S8 32 8 25zM19 13.5c3-1 7-1 10 0M9 20C6 14 8 8 13 6M39 20c3-6 1-12-4-14M10 31c-4 3-5 7-3 10M38 31c4 3 5 7 3 10"/>',
  'face-shield': '<path d="M11 7h26v5H11zM11 9.5H7M37 9.5h4M11 12L7 37c0 3 8 6 17 6s17-3 17-6l-4-25M31 18l2 15"/>',
  goggles: '<path d="M6 20c0-3 3-5 6-5h24c3 0 6 2 6 5v5c0 4-3 7-7 7-4 0-6-4-11-4s-7 4-11 4c-4 0-7-3-7-7zM6 21H3M42 21h3M13 19h4M31 19h4"/>',
  gown: '<path d="M19 5c1 3 9 3 10 0M19 5l-8 3-6 21 4 1 5-12-1 25h22l-1-25 5 12 4-1-6-21-8-3M14 26h20M34 26l3 6M34 26l4 3"/>',
  cap: '<path d="M5 30c0-13 8-22 19-22s19 9 19 22M5 30q2 3 4.2 0t4.2 0t4.2 0t4.2 0t4.2 0t4.2 0t4.2 0t4.2 0t4.2 0M11 25l1-3M17 25.5l.5-3M24 26v-3M31 25.5l-.5-3M37 25l-1-3M16 14c2-1.5 4-2.3 6-2.6"/>',
  'shoe-cover': '<path d="M10 14c-2 6-4 14-4 22a4 4 0 0 0 4 4h30a4 4 0 0 0 4-4c0-4-4-7-10-8l-8-3c-2-1-3-5-3-11M10 14q2.1 2 4.25 0t4.25 0t4.25 0t4.25 0M6 34h38"/>',

  // Catheters & continence
  foley: R('<ellipse cx="36" cy="24" rx="5" ry="4.5"/><circle cx="9" cy="10" r="2.5"/><path d="M15 22.5h16M15 25.5h16M41 22.5h2a1.5 1.5 0 0 1 0 3h-2M15 22.5L4 18v12l11-4.5M18 22.5l-8-10.5"/>'),
  catheter: R('<path d="M4 18l10 4.5v3L4 30zM14 22.5h26M14 25.5h26M40 22.5h2a1.5 1.5 0 0 1 0 3h-2M34 24h2"/>'),
  'suction-catheter': R('<path d="M4 18l10 4.5v3L4 30zM14 22.5h26M14 25.5h26M40 22.5h2a1.5 1.5 0 0 1 0 3h-2M17 22.5V19h5v3.5M36 24h2"/>'),
  'feeding-tube': R('<path d="M4 18l10 4.5v3L4 30zM14 22.5h26M14 25.5h26M40 22.5h2a1.5 1.5 0 0 1 0 3h-2M15 22.5l-5-7M7 14l3-3 3 3-3 3zM24 22.5v3M28 22.5v3M32 22.5v3"/>'),
  drain: R('<path d="M5 21h36a3 3 0 0 1 0 6H5zM9 24h14M28 24h1M33 24h1M38 24h1"/>'),
  'external-catheter': R('<ellipse cx="8" cy="24" rx="2" ry="7"/><path d="M8 17h17c4 0 6 3 7 5h4v4h-4c-1 2-3 5-7 5H8M36 24h8"/>'),
  'urine-bag': '<path d="M10 10h28v26c0 3-3 6-6 6H16c-3 0-6-3-6-6zM16 10V6c0-3 2-4 5-4h22M31 16h4M33 21h2M31 26h4M33 31h2M24 42v3M22 45h4"/>',
  brief: '<path d="M6 12h36l-2 10c-4 2-7 6-8 13l-1 7H17l-1-7c-1-7-4-11-8-13zM6.8 16h34.4M10 22c3 3 5 8 6 13M38 22c-3 3-5 8-6 13"/>',
  underpad: '<rect x="5" y="9" width="38" height="30" rx="2"/><rect x="10" y="14" width="28" height="20" rx="1" stroke-dasharray="2 2.5"/>',

  // Surgical soft goods
  drape: '<path d="M6 6h36v30q-3 4-6 0t-6 0t-6 0t-6 0t-6 0t-6 0zM15 6v28M33 6v28"/><rect x="18" y="15" width="12" height="9" rx="4.5"/>',
  towel: '<path d="M5 14h34a4 4 0 0 1 0 8H5zM5 26h34a4 4 0 0 1 0 8H5zM12 14v8M12 26v8"/>',
  sponge: '<rect x="6" y="12" width="36" height="24" rx="9"/><circle cx="15" cy="20" r="1.5"/><circle cx="25" cy="18" r="1.2"/><circle cx="33" cy="23" r="1.8"/><circle cx="19" cy="29" r="1.2"/><circle cx="28" cy="30" r="1.5"/>',
  kit: '<rect x="5" y="9" width="38" height="30" rx="3"/><rect x="10" y="17" width="5" height="14" rx="1"/><circle cx="31" cy="31" r="4"/><path d="M19 9v30M19 22h24M12.5 14v3M12.5 31v4M24 13h14v5H24z"/>',
  bowl: '<path d="M4 20h40M6 20c0 11 8 18 18 18s18-7 18-18M18 38l-2 4h16l-2-4"/>',
  applicator: R('<path d="M4 21h20l6-4v14l-6-4H4a3 3 0 0 1 0-6zM8 24h10"/><rect x="30" y="15" width="12" height="18" rx="3"/>'),
  depressor: R('<rect x="3" y="19" width="42" height="10" rx="5"/>'),

  // Airway & oxygen
  yankauer: T(-30, '<path d="M4 21h3v6H4M7 22h21c6 0 10 3 13 8M7 26h21c4 0 6 2 8 5M12 22v4M15 22v4M18 22v4"/><circle cx="39.5" cy="33" r="3"/>'),
  'suction-canister': '<rect x="9" y="8" width="30" height="6" rx="1.5"/><path d="M11 14h26v26a3 3 0 0 1-3 3H14a3 3 0 0 1-3-3zM16 8V4h5v4M27 8V4h5v4M31 20h3M32 25h2M31 30h3M32 35h2"/>',
  'o2-mask': '<path d="M24 4c-7 0-11 9-12 16-.6 6 5 10 12 10s12.6-4 12-10c-1-7-5-16-12-16zM12.5 18H4M35.5 18H44M21 30q-2 1.5 0 3t0 3t0 3t0 3v4M27 30q2 1.5 0 3t0 3t0 3t0 3v4M21 33h6M21 36h6M21 39h6"/>',
  'nasal-cannula': '<path d="M20 9h8M21.5 9V4.5M26.5 9V4.5M20 9c-4 0-8 2-10 6-4 8-2 22 12 24M28 9c4 0 8 2 10 6 4 8 2 22-12 24M22 37h4v5h-4zM24 42v4"/>',
  'et-tube': '<rect x="6" y="3" width="8" height="6" rx="1"/><path d="M8 9c0 16 9 27 27 31M12 9c0 13 8 23 24 27M35 40l1-4M12 16c4 0 9-3 12-7"/><ellipse cx="32" cy="37" rx="5" ry="3.5" transform="rotate(20 32 37)"/><ellipse cx="27" cy="6" rx="3" ry="3.5"/>',
  stylet: '<circle cx="10" cy="6" r="3"/><path d="M10 9c0 16 9 27 27 31M6 14h8"/>',
  laryngoscope: '<rect x="5" y="20" width="10" height="24" rx="2"/><path d="M8 25v14M12 25v14M8 20v-6h4v6M12 14c11 0 21 4 29 15l-2.5 1.5C31 21 22 18 12 18M30 21.5h0"/>',
  'co2-detector': '<rect x="14" y="15" width="20" height="18" rx="3"/><circle cx="24" cy="24" r="5"/><path d="M6 20h8v8H6zM34 20h8v8h-8zM24 24h0"/>',
  trach: '<path d="M5 14a3 3 0 0 1 3-3h32a3 3 0 0 1 3 3v1a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3zM9 14.5h3M36 14.5h3M19 11V6h10v5M19 18c0 12 4 19 14 24M29 18c0 8 3 13 9 16M33 42l5-8"/>',
  airway: '<rect x="8" y="4" width="20" height="5" rx="1.5"/><path d="M13 9v9c0 13 9 22 21 22 5 0 8-3 8-8M23 9v8c0 8 5 13 11 13 2 0 3-1 3-3M42 32l-5-5"/>',
  bvm: '<ellipse cx="16" cy="24" rx="12" ry="8"/><path d="M28 21.5h5v5h-5M33 24l7-9c3 2 4 5 4 9s-1 7-4 9zM4 24H2"/>',
  nebulizer: '<path d="M5 13h36v8H5zM5 13l-2 1v6l2 1M41 15h3v4h-3M18 21v14a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4V21M24 39v6M20 29h8"/>',

  // Vitals
  'bp-cuff': '<rect x="4" y="5" width="30" height="15" rx="3"/><ellipse cx="10" cy="39" rx="5" ry="6"/><circle cx="36" cy="34" r="8"/><path d="M11 5v15M14 20c0 6-1 10-3 13M24 20c0 5 2 9 5 10M36 34l4-4M36 28v1.5M42 34h-1.5M30 34h1.5"/>',
  stethoscope: '<circle cx="41" cy="25" r="4"/><path d="M14 5v11c0 6 4 10 10 10s10-4 10-10V5M24 26v6c0 6 4 10 9 10s8-4 8-9v-4M12 5h4M32 5h4M41 25h0"/>',
  thermometer: R('<rect x="3" y="18" width="25" height="12" rx="6"/><rect x="8" y="21" width="10" height="6" rx="1"/><path d="M23 24h0M28 22.5h13a1.5 1.5 0 0 1 0 3H28"/>'),
  'pulse-ox': '<path d="M14 18a6 6 0 0 1 6-6h16a6 6 0 0 1 6 6v12a6 6 0 0 1-6 6H20a6 6 0 0 1-6-6zM14 28h28M3 25.5h11M3 30.5h11M20 21h3l1.5-3 2 6 1.5-3h8"/>',
  'glucose-meter': '<rect x="12" y="4" width="22" height="34" rx="4"/><rect x="16" y="8" width="14" height="11" rx="1"/><circle cx="19" cy="28" r="2"/><circle cx="27" cy="28" r="2"/><path d="M19 13.5h8M21 38v7h4v-7"/>',
  electrode: '<circle cx="24" cy="29" r="14"/><circle cx="24" cy="29" r="7"/><circle cx="24" cy="29" r="2.5"/><rect x="21" y="6" width="6" height="7" rx="1"/><path d="M24 6V2"/>',

  // Containers & consumables
  sharps: `<path d="M10 17h28l-2 25H12zM7 11h34v6H7zM18 11l2-4h8l2 4"/>${BIO(24, 30)}`,
  wipes: '<path d="M12 17v23c0 2 5 4 12 4s12-2 12-4V17M12 17c0-2 5-4 12-4s12 2 12 4-5 4-12 4-12-2-12-4zM12 26c0 2 5 4 12 4s12-2 12-4M21 17c-1-4 0-9 3-12 1 2 4 2 5 1-1 3-2 6-2 11"/>',
  bottle: '<rect x="19" y="3" width="10" height="6" rx="1"/><path d="M20 9v4l-6 5v23a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V18l-6-5V9M14 25h20M14 36h20"/>',
  'ostomy-pouch': '<path d="M14 5h20a6 6 0 0 1 6 6v20c0 7-7 13-16 13S8 38 8 31V11a6 6 0 0 1 6-6z"/><circle cx="24" cy="17" r="7"/><circle cx="24" cy="17" r="3"/>',
  'ostomy-barrier': '<rect x="6" y="6" width="36" height="36" rx="9"/><circle cx="24" cy="24" r="10"/><circle cx="24" cy="24" r="5"/>',
  'feeding-bag': '<circle cx="30" cy="7" r="1.5"/><path d="M13 10h22v22c0 4-3 6-6 6H19c-3 0-6-2-6-6zM16 10V5h6v5M29 16h3M30 20h2M29 24h3M24 38v4M21 42h6v4h-6"/>',
  'emesis-bag': '<ellipse cx="24" cy="10" rx="13" ry="4"/><path d="M11 10c0 11 2 22 5 30 1 3 15 3 16 0 3-8 5-19 5-30M18 24h4M18 29h2M18 34h4"/>',
  stabilizer: '<rect x="5" y="14" width="38" height="20" rx="10"/><rect x="17" y="19" width="14" height="10" rx="2"/><path d="M2 24h15M31 24h15M21 19v10M27 19v10"/>',
  'tube-holder-airway': '<rect x="2" y="21" width="44" height="6" rx="3"/><rect x="16" y="13" width="16" height="22" rx="3"/><circle cx="24" cy="24" r="4"/><path d="M6 21v6M42 21v6"/>',
  cup: '<path d="M11 10h26M13 10l3 30h16l3-30M15 18h5M16 24h3M16 30h4"/>',
  tissues: '<path d="M6 22h36v20H6zM6 22l5-6h26l5 6M18 19c1-5 4-10 7-13 1 4 4 7 5 13"/>',
  'baby-bottle': '<path d="M20 11c0-3 1-4 2-5 1-2 3-2 4 0 1 1 2 2 2 5M15 11h18v5H15zM16 16v22a5 5 0 0 0 5 5h6a5 5 0 0 0 5-5V16M16 23h5M16 29h3M16 35h5"/>',
  packet: '<rect x="7" y="9" width="34" height="30" rx="1"/><rect x="11" y="13" width="26" height="22" stroke-dasharray="1.5 2"/><path d="M16 21h16M16 26h10"/>',
  label: '<circle cx="35" cy="24" r="2"/><path d="M5 13h27l11 11-11 11H5zM10 20h14M10 25h10M10 30h12"/>',
  pack: '<rect x="6" y="9" width="36" height="30" rx="7"/><path d="M13 20q2.75-3 5.5 0t5.5 0t5.5 0t5.5 0M13 28q2.75-3 5.5 0t5.5 0t5.5 0t5.5 0"/>',
  pillow: '<path d="M8 12c6-3 26-3 32 0 3 8 3 16 0 24-6 3-26 3-32 0-3-8-3-16 0-24zM8 12L5 9M40 12l3-3M8 36l-3 3M40 36l3 3"/>',
  brace: '<circle cx="24" cy="24" r="4"/><path d="M13 4h22c0 8-5 12-5 20s5 12 5 20H13c0-8 5-12 5-20S13 12 13 4zM10 11h28M10 37h28M10 9v4M38 9v4M10 35v4M38 35v4"/>',
  comb: '<path d="M6 16h36v6H6zM9 22v12M13 22v12M17 22v12M21 22v12M25 22v12M29 22v12M33 22v12M37 22v12"/>',
  box: '<path d="M6 15l18-9 18 9v18l-18 9-18-9zM6 15l18 9 18-9M24 24v18M15 10.5l18 9v6"/>',
};

export const ICON_IDS = Object.keys(ICONS);

// Own-property check, so ids like "constructor" or "__proto__" are never icons.
export const hasIcon = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(ICONS, id);

// Injected with dangerouslySetInnerHTML: keep it a static constant, never built from data.
export const SPRITE =
  DEFS + ICON_IDS.map((id) => `<symbol id="pi-${id}" viewBox="0 0 48 48">${ICONS[id]}</symbol>`).join('');
