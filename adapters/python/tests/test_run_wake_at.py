"""run() for an app that owns the clock: wake_at comes back, schedule goes out, fire_due replaces the task, no ledger file is needed.

Run from adapters/python: python -m unittest discover -s tests -v
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from argentic_ai import Argentic, Tool, run  # noqa: E402
from fake_server import serve  # noqa: E402

WAKE_AT = "2026-11-25T01:00:00.000Z"
MODEL = {"provider": "anthropic", "id": "claude-haiku-5-5", "prices": {"in": 0.1, "out": 0.5, "cache_hit": 0.01}}


def handler_factory():
    """Wake 0 asks for `ping` (seq 1); wake 1 finishes and says when to wake next."""
    seen = []

    def handle(path, headers, body):
        seen.append(body)
        if len(seen) == 1:
            return 200, {"status": "done", "reply": "", "spent_usd": 0, "turns": 1, "wake_id": "wk_0", "wake_at": None,
                         "actions": [{"id": "a1", "tool": "ping", "args": {}, "seq": 1}]}, None
        return 200, {"status": "done", "reply": "finished", "spent_usd": 0, "turns": 1, "wake_id": "wk_1", "wake_at": WAKE_AT}, None

    return handle


class RunWakeAtTest(unittest.TestCase):
    def start(self):
        server = serve(handler_factory())
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.client = Argentic(api_key="aek_test", base_url=server.url, sleep=lambda s: None, log=lambda s: None)
        return server

    def setUp(self):
        self.ran = []
        self.tool = Tool("ping", "ping", {"type": "object", "properties": {}}, lambda args, ctx: self.ran.append("ping") or {"pong": True})

    def test_wake_at_comes_back_and_schedule_goes_out_on_every_wake(self):
        server = self.start()
        out = run(self.client, agent="a", run_id="r1", task="ping it", tools=[self.tool], model=MODEL, schedule=True, log=lambda s: None)
        self.assertEqual(out.wake_at, WAKE_AT)
        self.assertEqual(self.ran, ["ping"])
        self.assertEqual([r[2].get("schedule") for r in server.requests], [True, True])
        self.assertNotIn("fire_due", server.requests[0][2])

    def test_without_schedule_the_field_is_not_sent(self):
        server = self.start()
        run(self.client, agent="a", run_id="r2", task="x", tools=[self.tool], model=MODEL, log=lambda s: None)
        self.assertTrue(all("schedule" not in r[2] for r in server.requests))

    def test_fire_due_wakes_with_no_message_and_the_follow_up_carries_results(self):
        server = self.start()
        out = run(self.client, agent="a", run_id="due-1", fire_due=True, tools=[self.tool], model=MODEL, schedule=True, log=lambda s: None)
        first, second = server.requests[0][2], server.requests[1][2]
        self.assertIs(first.get("fire_due"), True)
        self.assertNotIn("message", first)
        self.assertNotIn("fire_due", second)
        self.assertEqual(second["results"], [{"seq": 1, "result": {"pong": True}}])
        self.assertEqual(out.wake_at, WAKE_AT)

    def test_a_task_or_fire_due_exactly_one(self):
        client = Argentic(api_key="aek_test", base_url="http://127.0.0.1:1", log=lambda s: None)
        with self.assertRaises(ValueError):
            run(client, agent="a", run_id="x", tools=[], model=MODEL)
        with self.assertRaises(ValueError):
            run(client, agent="a", run_id="x", task="hi", fire_due=True, tools=[], model=MODEL)

    def test_no_ledger_path_writes_nothing(self):
        self.start()
        with tempfile.TemporaryDirectory() as d:
            cwd = os.getcwd()
            os.chdir(d)
            try:
                run(self.client, agent="a", run_id="r3", task="x", tools=[self.tool], model=MODEL, log=lambda s: None)
                self.assertEqual(os.listdir(d), [])
            finally:
                os.chdir(cwd)
        self.assertEqual(self.ran, ["ping"])


if __name__ == "__main__":
    unittest.main()
