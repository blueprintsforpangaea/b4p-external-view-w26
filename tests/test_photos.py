"""Product photos: only clean Google Drive links are sent, and never for rows about a patient."""
import pytest
from fastapi.testclient import TestClient

import main

FILE_ID = "1pOZb7UjIm_t98gR6Z86DZ84yGCjw59Pd"
VIEW = f"https://drive.google.com/file/d/{FILE_ID}/view"


def row(n, name, notes="", url=f"https://drive.google.com/file/d/{FILE_ID}/view?usp=drivesdk", lot="L1"):
    return {"Name": name, "Notes": notes, "Lot Number": lot, "Quantity": "5", "Subcategory": "Misc Surgical",
            "Image URL": url, "_sheet_row": n}


@pytest.fixture
def photos(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("USE_SAMPLE_DATA", "1")
    rows = []
    monkeypatch.setattr(main, "_load_inventory_records", lambda: [dict(r) for r in rows])
    client = TestClient(main.app)

    def get(*given):
        rows[:] = given
        return {r["_sheet_row"]: r for r in client.get("/api/supplies").json()}
    return get


@pytest.mark.parametrize("url", [
    f"https://drive.google.com/file/d/{FILE_ID}/view?usp=drivesdk",
    f"https://drive.google.com/open?id={FILE_ID}",
    f"https://drive.google.com/uc?id={FILE_ID}&export=download",
    f"https://docs.google.com/file/d/{FILE_ID}/edit",
])
def test_drive_links_become_one_clean_form(photos, url):
    assert photos(row(2, "Gauze pads", url=url))[2]["Image URL"] == VIEW


@pytest.mark.parametrize("url", [
    "", "not a url", f"http://drive.google.com/file/d/{FILE_ID}/view",  # not https
    f"https://evil.example/file/d/{FILE_ID}/view", f"https://drive.google.com.evil.example/file/d/{FILE_ID}",
    "https://drive.google.com/file/d/short/view", "https://drive.google.com/file/d/<script>/view",
    "javascript:alert(1)",
])
def test_anything_else_sends_no_photo(photos, url):
    assert "Image URL" not in photos(row(2, "Gauze pads", url=url))[2]


@pytest.mark.parametrize("name,notes", [
    ("Lavender top tube", "Pt. ID 000000000412-12 drawn 3/2"),  # redaction changes the text
    ("Specimen tube", "MRN 99812345"),
    ("Blood tube", "DOB 01/02/1960"),
    ("Patient sample tube", ""),  # mentions a patient, nothing to redact
    ("Gold top tube", "pt label on tube"),
    ("PK 4Hr Post 2", "The label reads 'PK 4Hr Post 2' and 'Subj No 22075'"),  # trial subject number
    ("AP237118K17 R5458-ONC-2257 C1D15 PREDOSE", ""),  # cycle/day and dose timing of a trial sample
])
def test_rows_about_a_patient_never_send_a_photo(photos, name, notes):
    out = photos(row(2, name, notes=notes), row(3, "Gauze pads"))
    assert "Image URL" not in out[2]
    assert out[3]["Image URL"] == VIEW  # an ordinary row in the same sheet still has its photo


def test_a_patient_id_copied_into_another_column_also_hides_the_photo(photos):
    out = photos(row(2, "Tube", notes="Pt ID 12345678", lot="12345678"))
    assert "Image URL" not in out[2]
    assert "12345678" not in str(out[2])


@pytest.mark.parametrize("general", ["sample tube", "sample vial", "test tube", "specimen collection tube",
                                     "blood collection tube", "specimen container", "urine cup"])
def test_sample_containers_never_send_a_photo(photos, general):
    r = row(2, "Unlabelled item")
    r["General"] = general
    assert "Image URL" not in photos(r)[2]


def test_collection_supplies_that_hold_no_sample_keep_the_photo(photos):
    needle, bag = row(2, "BD Vacutainer Eclipse Blood Collection Needle"), row(3, "Specimen Collection Bag")
    needle["General"], bag["General"] = "blood collection needle", "specimen bag"
    out = photos(needle, bag)
    assert out[2]["Image URL"] == VIEW and out[3]["Image URL"] == VIEW


@pytest.mark.parametrize("name", ["K012762892", "AP237146K01", "000412-1299"])
def test_items_named_only_by_a_code_send_no_photo(photos, name):
    assert "Image URL" not in photos(row(2, name))[2]


def test_product_names_with_numbers_keep_the_photo(photos):
    out = photos(row(2, "Adapt CeraRing Slim 8815"), row(3, "BD 309657 Luer-Lok 3 mL syringe"))
    assert out[2]["Image URL"] == VIEW and out[3]["Image URL"] == VIEW


@pytest.mark.parametrize("name,notes", [
    ("Patient label printer", ""),
    ("Specimen bag", "patient ID number on the label"),
    ("Hematology panel", "Shows 'Hematology Panel' and a patient's name"),
    ("Blood tube rack", "patient blood sample"),
])
def test_patient_next_to_an_identifier_or_sample_hides_the_photo(photos, name, notes):
    assert "Image URL" not in photos(row(2, name, notes=notes))[2]


@pytest.mark.parametrize("name,notes", [
    ("ChloraPrep 3 mL applicator", "Chlorhexidine gluconate cloth patient preoperative skin preparation"),
    ("Pulse oximeter sensor", "Single-patient use adult sensor"),
    ("Precision Flow disposable patient circuit", ""),
    ("Patient slippers, 3XL", ""),
    ("Suction canister", "Ports labeled 'vacuum', 'patient' and 'tandem'"),
])
def test_patient_as_product_wording_keeps_the_photo(photos, name, notes):
    assert photos(row(2, name, notes=notes))[2]["Image URL"] == VIEW


def test_words_that_only_look_similar_keep_the_photo(photos):
    # "Patty", "patch", "DOBUTamine" and lot numbers are not patient details.
    out = photos(row(2, "Hydrocolloid patch", notes="REF 302995"), row(3, "Dobutamine vial"))
    assert out[2]["Image URL"] == VIEW and out[3]["Image URL"] == VIEW
