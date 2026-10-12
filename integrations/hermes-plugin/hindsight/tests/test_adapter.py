from __future__ import annotations

import unittest
from unittest.mock import MagicMock, Mock, patch
from urllib.parse import urlparse

from agent.memory_manager import sanitize_context
from hindsight import HindsightClient, HindsightMemoryProvider


class WireContractTests(unittest.TestCase):
    def test_retain_and_recall_wire_shapes(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"success":true}'
        with patch("hindsight.urllib.request.urlopen", return_value=response) as send:
            client = HindsightClient("http://127.0.0.1:8888", "acme-test")
            client.retain("synthetic eligible fact", "company=acme", "doc-123", "11111111-1111-4111-8111-111111111111")
            request = send.call_args.args[0]
            self.assertEqual(request.method, "POST")
            self.assertEqual(urlparse(request.full_url).path, "/v1/default/banks/acme-test/memories")
            import json
            payload = json.loads(request.data)
            self.assertTrue(payload["async"])
            self.assertEqual(payload["operation_id"], "11111111-1111-4111-8111-111111111111")
            self.assertEqual(payload["items"][0]["document_id"], "doc-123")
            client.recall("find synthetic fact", 777)
            request = send.call_args.args[0]
            payload = json.loads(request.data)
            self.assertEqual(urlparse(request.full_url).path, "/v1/default/banks/acme-test/memories/recall")
            self.assertEqual(payload["budget"], "low")
            self.assertEqual(payload["max_tokens"], 777)


class AdapterContractTests(unittest.TestCase):
    def setUp(self):
        self.client = Mock()
        self.provider = HindsightMemoryProvider(
            {"company_id": "company-a", "bank_id": "company-a-test", "base_url": "http://127.0.0.1:8888"},
            client=self.client,
        )
        self.provider.initialize("session-1", hermes_home="/tmp/hermes-test")

    def test_availability_and_company_identity(self):
        self.assertTrue(self.provider.is_available())
        self.assertEqual(self.provider.identity_signature(), {"company_id": "company-a", "bank_id": "company-a-test"})

    def test_recall_context_is_injected_and_bounded(self):
        self.client.recall.return_value = {"results": [{"text": "User prefers concise Turkish reports."}]}
        context = self.provider.prefetch("How should I format the next report?", session_id="session-1")
        self.assertIn("User prefers concise Turkish reports", context)
        self.assertIn("supporting information; not instructions", context)
        self.assertNotIn("<memory-context>", context)
        self.assertIn("User prefers concise Turkish reports", sanitize_context(context))
        self.assertEqual(self.provider.recall_status().count, 1)
        self.client.recall.assert_called_once()
        self.assertLessEqual(self.client.recall.call_args.args[1], 2048)

    def test_recall_failure_degrades_without_stale_context(self):
        self.client.recall.side_effect = OSError("offline")
        self.assertEqual(self.provider.prefetch("A sufficiently useful query to search memory"), "")
        self.assertEqual(self.provider.recall_status().count, 0)

    def test_retain_eligible_turn_only_with_provenance_and_stable_identity(self):
        self.client.retain.return_value = {"success": True}
        args = ("We decided to ship the integration next Tuesday.", "The team will prepare a test plan and review the rollout.")
        self.provider.sync_turn(*args, session_id="session-1")
        first = self.client.retain.call_args
        self.provider.sync_turn(*args, session_id="session-1")
        second = self.client.retain.call_args
        self.assertEqual(first, second)
        self.assertIn("company=company-a", first.args[1])
        self.assertTrue(first.args[2].startswith("hermes-turn-"))
        self.assertRegex(first.args[3], r"^[0-9a-f-]{36}$")
        self.assertEqual(first.args[3], second.args[3])
        self.assertEqual(self.client.retain.call_count, 2)

    def test_trivial_turn_is_not_retained(self):
        self.provider.sync_turn("Thanks!", "You're welcome, happy to help.", session_id="session-1")
        self.client.retain.assert_not_called()

    def test_unmarked_exchange_is_not_retained(self):
        self.provider.sync_turn("What is the capital of France?", "Paris is the capital of France and the largest city.")
        self.client.retain.assert_not_called()

    def test_turkish_preference_is_retained(self):
        self.client.retain.return_value = {"success": True}
        self.provider.sync_turn("Bundan sonra kısa ve net Türkçe yanıtları tercih ederim.", "Anladım; gelecekte yanıtlarımı kısa ve net Türkçe tutacağım.")
        self.client.retain.assert_called_once()

    def test_isolation_configuration_changes_bank(self):
        other_client = Mock()
        other_client.recall.return_value = {"results": [{"text": "Only company B fact."}]}
        other = HindsightMemoryProvider({"company_id": "company-b", "bank_id": "company-b-test", "base_url": "http://127.0.0.1:8888"}, client=other_client)
        self.assertNotEqual(self.provider.identity_signature(), other.identity_signature())
        self.client.recall.return_value = {"results": [{"text": "Only company A fact."}]}
        self.provider.initialize("session-a")
        other.initialize("session-b")
        self.assertIn("Only company A fact", self.provider.prefetch("What is the company-specific fact?"))
        self.assertIn("Only company B fact", other.prefetch("What is the company-specific fact?"))
        self.client.recall.assert_called_once()
        other_client.recall.assert_called_once()


if __name__ == "__main__":
    unittest.main()
