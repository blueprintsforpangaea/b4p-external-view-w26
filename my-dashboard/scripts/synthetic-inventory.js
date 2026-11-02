// Synthetic supply names by subcategory: no real inventory, no patient IDs.
// Shared by scripts/mock-server.js and the icon coverage test (src/iconCoverage.test.js).
const TYPES = {
  'Wound Care & Bandages': ['Gauze pads 4x4', 'Adhesive bandages', 'Elastic bandage 4 in', 'Triangular bandage', 'Wound dressing, sterile', 'Medical tape 1 in', 'Hydrocolloid dressing', 'Petrolatum gauze', 'Café wrap bandage'],
  Gloves: ['Nitrile gloves (M)', 'Nitrile gloves (L)', 'Surgical masks', 'N95 respirator', 'Isolation gown', 'Face shield', 'Shoe covers', 'Bouffant cap', 'Digital thermometer', 'Elastic bandage', 'Stethoscope', 'Syringe 3 mL'],
  'Needles & Syringes': ['Syringe 3 mL', 'Syringe 5 mL', 'Syringe 10 mL', 'Needle 21G', 'Needle 25G', 'Safety needle 23G', 'Alcohol prep pads', 'Sharps container'],
  'Vitals & Home Health': ['Digital thermometer', 'Pulse oximeter', 'Blood pressure cuff', 'Glucose test strips', 'Urine test strips', 'Otoscope speculum', 'Stethoscope', 'Malaria rapid test'],
  'Airway & Oxygen': ['Nebulizer mask', 'Oxygen tubing', 'Nasal cannula', 'Peak flow meter', 'Spacer device', 'Suction catheter'],
  'Misc Surgical': ['Suture 3-0 nylon', 'Suture 4-0 vicryl', 'Scalpel blade #11', 'Scalpel blade #15', 'Surgical drape', 'Forceps, Adson', 'Needle driver', 'Hemostat', 'Nasal cannula', 'Stethoscope adult', 'Foley catheter 16Fr', 'Crutches, adult', 'Face shield', 'Respirator N95'],
  'IV Supplies': ['IV catheter 20G', 'IV catheter 22G', 'IV tubing set', 'Saline flush 10 mL', 'Tourniquet', 'IV start kit', 'Extension set'],
  'Apparel (Gowns, Shoe Covers, etc.)': ['Ankle brace', 'Knee brace', 'Wrist splint', 'Cervical collar', 'Crutches, adult', 'Cast padding'],
};

module.exports = { TYPES };
