"""Unit tests for BIDS event label normalization and practice-trial parsing."""
from pathlib import Path

from backend.catalog import normalize_event_type, parse_events


def test_event_label_variants():
    """Ensure spacing/case variants of ElectricalVAS7 and ElectricalVAS3 normalize cleanly."""
    assert normalize_event_type("ElectricalVAS7") == "VAS7"
    assert normalize_event_type("Electrical VAS 7") == "VAS7"
    assert normalize_event_type("Electrical VAS 3") == "VAS3"
    assert normalize_event_type("ElectricalVAS3") == "VAS3"


def test_practice_marker_and_ordering(tmp_path: Path):
    """Ensure negative `value` rows are flagged as practice trials and sorted by onset."""
    path = tmp_path / "events.tsv"
    path.write_text(
        "onset\tduration\ttrial_type\tvalue\n"
        "30\t5\tElectrical VAS 7\t-1\n"
        "60\t5\tElectricalVAS7\t1\n"
        "90\t5\tElectrical VAS 3\t1\n",
        encoding="utf-8",
    )
    events = parse_events(path)
    assert [e["type"] for e in events] == ["VAS7", "VAS7", "VAS3"]
    assert events[0]["practice"] is True
    assert events[1]["practice"] is False
    assert events[0]["onset"] == 30.0
