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


def test_flags_member_and_new_customer_codes():
    found = extract.find_codes(
        "Deliveroo Plus members: use code PLUSFEAST for £5 off.\n\n\n\n"
        + "x " * 80
        + "\nNew customers get £10 off with code HELLO10 on your first order.\n"
        + "y " * 80
        + "\nAnyone can use code EVERYONE7 this week.")
    assert found["PLUSFEAST"]["member_only"] and not found["PLUSFEAST"]["new_only"]
    assert found["HELLO10"]["new_only"] and not found["HELLO10"]["member_only"]
    assert not found["EVERYONE7"]["member_only"] and not found["EVERYONE7"]["new_only"]


def test_uber_one_and_just_eat_plus_count_as_member():
    assert extract.find_codes("Uber One members get code ONEEATS15")["ONEEATS15"]["member_only"]
    assert extract.find_codes("Just Eat+ exclusive: code JEPLUS4")["JEPLUS4"]["member_only"]
