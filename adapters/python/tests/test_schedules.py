"""Schedules, due() and the wake URL settings, against the in-process server.

Run from adapters/python: python -m unittest discover -s tests -v
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from argentic_ai import Argentic, ArgenticError  # noqa: E402
from fake_server import serve  # noqa: E402

SCHED = {"name": "daily", "cron": "0 9 * * *", "message": "check", "enabled": True, "next_at": "2026-11-07T09:00:00.000Z", "last_fired_at": None, "fires": 0}


class SchedulesTest(unittest.TestCase):
    def client(self, handler):
        server = serve(handler)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        c = Argentic(api_key="aek_test", base_url=server.url, sleep=lambda s: None, log=lambda s: None, backoff=())
        return server, c

    def test_due_reads_the_queue(self):
        items = [{"agent": "a", "schedule": "daily", "scheduled_at": "2026-11-07T09:00:00.000Z"}]
        server, c = self.client(lambda path, h, b: (200, {"due": items}, None))
        self.assertEqual(c.due(limit=5), items)
        self.assertEqual(server.methods, ["GET"])
        self.assertEqual(server.requests[0][0], "/v1/due?limit=5")
        self.assertEqual(server.requests[0][1]["authorization"], "Bearer aek_test")

    def test_put_schedule_sends_put_with_the_body_and_memory(self):
        server, c = self.client(lambda path, h, b: (200, {"agent": "a", "schedule": SCHED}, None))
        out = c.put_schedule("a b", "daily", cron="0 9 * * *", message="check", memory="org")
        self.assertEqual(out, SCHED)
        self.assertEqual(server.methods, ["PUT"])
        self.assertEqual(server.requests[0][0], "/v1/agents/a%20b/schedules/daily?memory=org")
        self.assertEqual(server.requests[0][2], {"message": "check", "cron": "0 9 * * *"})

    def test_a_409_limit_is_an_error_not_a_queue(self):
        server, c = self.client(lambda path, h, b: (409, {"error": "schedule_limit", "detail": "an agent can have 5 schedules"}, None))
        with self.assertRaises(ArgenticError) as cm:
            c.put_schedule("a", "x", cron="0 9 * * *", message="m")
        self.assertEqual(cm.exception.status, 409)
        self.assertEqual(len(server.requests), 1)

    def test_list_and_delete(self):
        server, c = self.client(lambda path, h, b: (404, {"error": "not_found"}, None) if path.endswith("/nope") else (200, {"schedules": [SCHED]}, None))
        self.assertEqual(c.schedules("a"), [SCHED])
        with self.assertRaises(ArgenticError) as cm:
            c.delete_schedule("a", "nope")
        self.assertEqual(cm.exception.status, 404)
        self.assertEqual(server.methods, ["GET", "DELETE"])

    def test_wake_url_and_notices(self):
        def handler(path, h, b):
            if path == "/v1/settings/notices":
                return 200, {"wake_url": "https://app.example.com/due", "signing_secret": "whsec_abc"}, None
            return 200, {"wake_url": b.get("url")}, None

        server, c = self.client(handler)
        self.assertEqual(c.set_wake_url("https://app.example.com/due"), "https://app.example.com/due")
        self.assertEqual(c.notices()["signing_secret"], "whsec_abc")
        self.assertEqual(server.methods, ["PUT", "GET"])


if __name__ == "__main__":
    unittest.main()
