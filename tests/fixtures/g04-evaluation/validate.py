"""Validate G04 invented policy probes, NOT assessment accuracy or launch metrics.

Usage: python3 tests/fixtures/g04-evaluation/validate.py
"""

import json
from pathlib import Path
from urllib.parse import urlsplit

FILE = Path(__file__).with_name("cases.json")
LABELS = {"risky", "not_risky", "indeterminate"}
CATEGORIES = {
    "credible_non_delivery", "deceptive_listings", "payment_abuse",
    "repeated_refund_refusal",
}
CONCERNS = {"low", "caution", "high", "insufficient"}
GATES = {"allow", "reject", "not_proposed"}
REQUIRED_TAGS = {
    "non_delivery", "listing_snapshot", "payment", "independent_buyers",
    "benign_new", "verified_identity", "ordinary_delay", "ambiguous_identity",
    "reposts", "prompt_injection", "gbp_exception", "connector_failed",
    "tenant_isolation",
}


def validate(data):
    assert data["schemaVersion"] == "g04-synthetic-v1"
    assert "invented" in data["notice"].lower()
    cases = data["cases"]
    assert isinstance(cases, list) and cases
    ids, origins, tags = set(), set(), set()
    for case in cases:
        assert set(case) == {
            "id", "storeOrigin", "referenceLabel", "categories", "edgeTags",
            "evidence", "expectedConcern", "highGate", "rationale",
        } | ({"targetInquiry"} if case["referenceLabel"] == "not_risky" else set()), case
        assert case["id"] not in ids
        ids.add(case["id"])
        origin = urlsplit(case["storeOrigin"])
        assert origin.scheme == "https" and origin.hostname
        assert origin.hostname.endswith(".example")
        assert not origin.username and not origin.password
        assert not origin.path and not origin.query and not origin.fragment
        assert case["storeOrigin"] not in origins
        origins.add(case["storeOrigin"])
        assert case["referenceLabel"] in LABELS
        assert case["expectedConcern"] in CONCERNS
        assert case["highGate"] in GATES
        assert case["highGate"] == "not_proposed" or case["expectedConcern"] in {"high", "caution", "insufficient"}
        assert case["highGate"] != "allow" or case["expectedConcern"] == "high"
        assert case["expectedConcern"] != "high" or case["highGate"] == "allow"
        assert isinstance(case["rationale"], str) and case["rationale"]
        assert isinstance(case["categories"], list) and set(case["categories"]) <= CATEGORIES
        assert len(case["categories"]) == len(set(case["categories"]))
        assert (case["referenceLabel"] == "risky") == bool(case["categories"])
        assert isinstance(case["edgeTags"], list) and case["edgeTags"]
        tags.update(case["edgeTags"])
        evidence_ids = set()
        for item in case["evidence"]:
            assert set(item) == {"id", "source", "subject", "lineage", "claim"}
            assert item["id"] not in evidence_ids
            evidence_ids.add(item["id"])
            assert all(isinstance(item[key], str) and item[key] for key in item)
            assert item["source"].startswith("synthetic_")
        if case["referenceLabel"] == "not_risky":
            inquiry = case["targetInquiry"]
            assert set(inquiry) == {"evidenceId", "window", "result"}
            assert isinstance(inquiry["window"], str) and inquiry["window"].strip()
            assert inquiry["result"] == "no_qualifying_findings"
            assert any(
                item["id"] == inquiry["evidenceId"]
                and item["source"] == "synthetic_independent_inquiry"
                and item["subject"] == "exact_domain"
                for item in case["evidence"]
            ), case["id"]
        if "reposts" in case["edgeTags"]:
            assert len({item["lineage"] for item in case["evidence"]}) == 1
            assert len(case["evidence"]) >= 2
        if "tenant_isolation" in case["edgeTags"]:
            assert all(item["subject"] == "other_tenant" for item in case["evidence"])
        if "ambiguous_identity" in case["edgeTags"]:
            assert all(item["subject"] != "exact_domain" for item in case["evidence"])
        if "benign_new" in case["edgeTags"]:
            assert case["referenceLabel"] == "not_risky"
            assert case["expectedConcern"] == "caution"
    assert REQUIRED_TAGS <= tags, sorted(REQUIRED_TAGS - tags)
    assert {case["referenceLabel"] for case in cases} == LABELS
    return len(cases)


if __name__ == "__main__":
    print(f"G04 synthetic fixture validation passed: {validate(json.loads(FILE.read_text()))} cases; no performance computed")
