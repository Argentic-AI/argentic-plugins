"""due() and wake_at: Argentic keeps no clock, the app wakes the agent. Against the in-process server.

Run from adapters/python: python -m unittest discover -s tests -v
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from argentic_ai import Argentic  # noqa: E402
from fake_server import serve  # noqa: E402

MODEL = {"provider": "p", "id": "m", "prices": {"in": 0, "out": 0}}


class DueTest(unittest.TestCase):
    def client(self, handler):
        server = serve(handler)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        c = Argentic(api_key="aek_test", base_url=server.url, sleep=lambda s: None, log=lambda s: None, backoff=())
        return server, c

    def test_due_reads_the_plans(self):
        items = [{"agent": "a", "memory": None, "plan_id": 3, "text": "check the refund", "wake_at": "2026-11-07T09:00:00.000Z"}]
        server, c = self.client(lambda path, h, b: (200, {"due": items}, None))
        self.assertEqual(c.due(limit=5), items)
        self.assertEqual(server.methods, ["GET"])
        self.assertEqual(server.requests[0][0], "/v1/due?limit=5")
        self.assertEqual(server.requests[0][1]["authorization"], "Bearer aek_test")

    def test_wake_at_is_on_the_answer(self):
        at = "2026-11-25T09:00:00.000Z"
        _, c = self.client(lambda path, h, b: (200, {"status": "done", "reply": "ok", "spent_usd": 0, "turns": 1, "wake_id": "wk_1", "wake_at": at}, None))
        self.assertEqual(c.wake("a", "hi", model=MODEL, idempotency_key="k1").wake_at, at)

    def test_fire_due_sends_no_message_and_a_null_wake_at_reads_as_none(self):
        server, c = self.client(lambda path, h, b: (200, {"status": "done", "reply": None, "spent_usd": 0, "turns": 0, "wake_id": "wk_2", "fired": 0, "wake_at": None}, None))
        r = c.wake("a", model=MODEL, idempotency_key="k2", fire_due=True)
        self.assertIsNone(r.wake_at)
        self.assertEqual(server.requests[0][2], {"model": MODEL, "fire_due": True})


if __name__ == "__main__":
    unittest.main()
