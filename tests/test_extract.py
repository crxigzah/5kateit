from tcf import extract
from tcf.store import resource_dir
import json

CFG = json.loads((resource_dir() / "sites.json").read_text(encoding="utf-8"))["defaults"]


def test_finds_codes_in_deal_text():
    text = """£5 off £20 at Deliveroo with code ROO5OFF - selected accounts
    Uber Eats: use EATS20 for 20% off. Code: FREEDEL25 works in the app.
    Just Eat voucher JUSTSAVE10 at checkout"""
    found = extract.find_codes(text)
    assert {"ROO5OFF", "EATS20", "FREEDEL25", "JUSTSAVE10"} <= set(found)


def test_ignores_noise():
    found = extract.find_codes("Promo code: FREE delivery. Use the APP. Code 2024. Voucher code needed: NONE")
    assert found == {}


def test_flags_expired():
    found = extract.find_codes("Update: code OLDDEAL10 has expired")
    assert found["OLDDEAL10"]["expired_hint"]


def test_ranking_prefers_multiple_sources():
    ranked = extract.merge_candidates([
        ("A", extract.find_codes("code AAAA11")),
        ("B", extract.find_codes("code BBBB22 and code AAAA11")),
    ])
    assert ranked[0]["code"] == "AAAA11" and ranked[0]["sources"] == ["A", "B"]


def test_classify_rejected():
    before = "Checkout\nTotal\n£20.99"
    after = before + "\nSorry, ABC123 isn't valid."
    status, msg, _ = extract.classify(before, after, CFG)
    assert status == "rejected" and "isn't valid" in msg


def test_classify_works_from_total_drop():
    before = "Checkout\nSubtotal\n£18.50\nTotal\n£20.99"
    after = "Checkout\nSubtotal\n£18.50\nPromo SAVE5: -£5.00\nTotal\n£15.99"
    status, _, saving = extract.classify(before, after, CFG)
    assert status == "works" and saving == 5.0


def test_classify_unknown():
    assert extract.classify("Total\n£10.00", "Total\n£10.00", CFG)[0] == "unknown"
