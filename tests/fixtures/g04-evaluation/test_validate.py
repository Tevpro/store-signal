"""Regression probes for the invented target-store label contract."""
import json
import unittest

from validate import FILE, validate


class TargetInquiryTests(unittest.TestCase):
    def setUp(self):
        self.data = json.loads(FILE.read_text())

    def case(self, case_id):
        return next(case for case in self.data["cases"] if case["id"] == case_id)

    def test_fixture_is_valid(self):
        self.assertEqual(validate(self.data), 13)

    def test_not_risky_rejects_missing_target_inquiry(self):
        self.case("benign-new-no-reviews").pop("targetInquiry", None)
        with self.assertRaises(AssertionError):
            validate(self.data)

    def test_not_risky_rejects_unlinked_or_other_store_inquiry(self):
        case = self.case("benign-new-no-reviews")
        case["targetInquiry"]["evidenceId"] = "unlinked"
        with self.assertRaises(AssertionError):
            validate(self.data)
        case["targetInquiry"]["evidenceId"] = case["evidence"][0]["id"]
        case["evidence"][0]["subject"] = "other_business"
        with self.assertRaises(AssertionError):
            validate(self.data)

    def test_not_risky_rejects_no_match_as_inquiry(self):
        case = self.case("benign-new-no-reviews")
        case["targetInquiry"]["result"] = "no_match"
        with self.assertRaises(AssertionError):
            validate(self.data)
        case["targetInquiry"]["result"] = "no_qualifying_findings"
        case["evidence"][0]["source"] = "synthetic_search_no_match"
        with self.assertRaises(AssertionError):
            validate(self.data)

    def test_not_risky_rejects_unbounded_inquiry(self):
        self.case("benign-new-no-reviews")["targetInquiry"]["window"] = ""
        with self.assertRaises(AssertionError):
            validate(self.data)


if __name__ == "__main__":
    unittest.main()
