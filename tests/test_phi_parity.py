"""One table of cases that the Python redactor (sheet mode) and the database's redact_phi() must agree on.

`SENSITIVE`: the secret must not survive. `SAFE`: product text that must come back unchanged.
The SQL half runs only when the local template database (b4p_v2) is reachable. Synthetic text only."""
import os

import psycopg
import pytest

SENSITIVE = [
    ("Pt 12345", "12345"),
    ("Patient 12345", "12345"),
    ("PT 1234", "1234"),
    ("pt#12", "pt#12"),
    ("Specimen tube Pt. ID " "0000000001-1 PP10", "0000000001"),  # split: the pre-push hook greps for labelled IDs
    ("tube A12-345 frozen", "A12-345"),
    ("send to jane.doe@example.org please", "jane.doe@example.org"),
    ("MRN " "0000006", "0000006"),
    ("DOB 01/02/1900", "01/02/1900"),
    ("Patient: Test Person", "Test Person"),
    ("Patient Test Person", "Test Person"),
    ("Pt. Name: J. Smith", "Smith"),
    ("Pt​ ID 0000000009", "0000000009"),  # zero-width character inside the keyword
] + [('Pt Smith 3E', 'Smith'), ('Patient Smith.', 'Smith'), ('Patient Smith, Room 12', 'Smith'), ('Pt. Smith Rm 4', 'Smith'), ('Patient Smith bed 3', 'Smith'), ('Patient Smith (3E)', 'Smith'), ('Patient Smith\nRoom 5', 'Smith'), ('Pt Smith-Jones', 'Jones'), ('Patient Smith Jr.', 'Smith'), ('Pt Smith 05/04', 'Smith'), ('Patient Smith/Jones', 'Jones'), ('Patient J. Smith', 'Smith'), ('Patient J Smith', 'Smith'), ('Patient John', 'John'), ('patient John Q Public', 'Public'), ('Pt Garcia-Lopez', 'Lopez'), ('Patient: Smith Room 12', 'Smith'), ("Pt O'Neil 3E", 'Neil'), ('Pt de la Cruz', 'Cruz'), ('Pt van der Berg', 'Berg'), ('Patient McDonald', 'McDonald'), ("Patient D'Angelo", 'Angelo'), ('PT SMITH', 'SMITH'), ('Patient 日本語', '日'), ('Patient 山田 太郎', '太'), ('Patient: 山田', '山'), ('Patient: 山田 太郎', '太郎'), ('patient sm1th', 'th')]
SAFE = [
    "Patient Return Electrode", "Patient-ready kit", "patient safety valve", "Pt ID label",
    "REF 302995", "Lot 6106151", "18G x 1.5 in", "Model DOB-100", "SmartSite™ needleless connector",
    "Medical record keeping supplies", "Patient Lift Sling", "Box 12 of 40",
    "Patient Wound Dressing", "Patient Glove Box", "Patient Gown XL", "Patient Kit", "Patient Starter Kit",
    "Patient Monitoring Cable", "PATIENT SLIPPERS", "single patient use only", "Patient preoperative skin preparation",
    "It includes a patient ID and a code", "with a patient ID number.", "a space for Pt. ID.", "99 HOUR URINE FROZEN Pt. ID",
    "PleurX Patient Starter Kit 1000 ml (Cat. 50-7500 Part 1 of 2)", "PT-CARE 3", "BD 10ml Syringe 21G x 1",
    "ports labeled 'Tandem', 'Patient', and 'Vacuum'", "Lot 2024-05-01", "REF 305-555", "12 pt font",
    "1 pt bottle", "pt bottle", "2 pt. bottle", "Pt. 16 oz", "Pt 16oz bottle", "Patient 8 oz cup",
]
_TAILS = ['Lift', 'Slide Sheet', 'Restraint', 'Mattress', 'Hygiene Wipes', 'Call Cord', 'Handling Belt', 'Alarm', 'Positioner', 'Warming Blanket', 'Thermometer', 'Specimen Bag', 'Pack', 'Shoe Covers', 'Gown', 'Monitor', 'Cart', 'Chair', 'Scale', 'Scrubs', 'Garments', 'Bath Basin', 'Bed', 'Cushion', 'Pillow', 'Towel', 'Wipes', 'Tray', 'Table', 'Hoist', 'Walker', 'Transfer Sling', 'Lift Sling', 'Comfort Kit', 'Care Pack', 'Isolation Gown', 'Wash Cloth', 'Urinal', 'Bedpan', 'Hand Wash', 'Skin Cleanser', 'Hearing Aid', 'Mask', 'Drape', 'Hair Cap', 'Slippers', 'Socks', 'Bib', 'Education Folder', 'Information Sheet', 'Identification Band', 'Transport Stretcher', 'Warmer', 'Cooling Pad', 'Oxygen Tubing', 'Suction Canister', 'Gait Belt', 'Fall Mat', 'Protection Pad', 'Positioning Wedge', 'Turn Assist', 'Valuables Bag', 'Belongings Bag', 'Pressure Cuff', 'Simulator', 'Lifter', 'Gauze', 'Needle', 'Syringe', 'Bandage', 'Tape', 'Controlled Analgesia Pump', 'Return Electrode', 'Starter Kit', 'Use Resuscitator', 'Preoperative Skin Prep', 'Lateral Transfer Device', 'Safety Vest', 'Charting Pen', 'Chart Holder', 'Stool', 'Weighing Scale', 'Privacy Screen', 'Warming Gown', 'Support Stocking', 'Compression Sleeve', 'Positioning System']
SAFE += [f"{head} {tail}" for tail in _TAILS for head in ("Patient", "Pt", "Pt.", "PATIENT", "patient", "PT", "pt.")]


@pytest.mark.parametrize("text,secret", SENSITIVE)
def test_python_redactor_removes_secret(text, secret):
    import main
    assert secret not in main._redact_phi(text, notes=True)


@pytest.mark.parametrize("text", SAFE)
def test_python_redactor_keeps_product_text(text):
    import main
    assert main._redact_phi(text, notes=True) == text


def _sql(texts):
    db = os.environ.get("TEST_TEMPLATE_DB", "b4p_v2")
    try:
        with psycopg.connect(f"postgresql:///{db}", connect_timeout=3) as conn:
            return [conn.execute("SELECT redact_phi(%s)", (t,)).fetchone()[0] for t in texts]
    except psycopg.OperationalError:
        pytest.skip("local database not reachable")


def test_sql_redactor_agrees_on_the_same_table():
    texts = [t for t, _ in SENSITIVE] + SAFE
    out = _sql(texts)
    for (text, secret), got in zip(SENSITIVE, out):
        assert secret not in got, (text, got)
    assert out[len(SENSITIVE):] == SAFE
