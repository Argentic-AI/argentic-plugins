"""The structured `results` field on a follow-up wake, and the fallback for an API that does not know it yet.

Run from adapters/python: python -m unittest discover -s tests -v
"""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from argentic_ai import Argentic, ArgenticError, Tool, run_durable  # noqa: E402
from fake_server import refund_handler, serve  # noqa: E402

SCHEMA = {"type": "object", "properties": {}}
TEXT = "Results of the tools you asked for:\n"


def refusing(inner):
    """An API with strict body validation that has never heard of `results`."""

    def handle(path, headers, body):
        if "results" in body:
            return 400, {"error": "bad_request", "detail": ["body: Unrecognized key(s) in object: 'results'"]}, None
        return inner(path, headers, body)

    return handle


class StructuredResultsTest(unittest.TestCase):
    def start(self, handler):
        server = serve(handler)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.client = Argentic(api_key="aek_test", base_url=server.url, sleep=lambda s: None, log=lambda s: None)
        return server

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.ran = []

    def tools(self):
        def make(name):
            def run(args, ctx):
                self.ran.append(name)
                return {"ok": name}

            return Tool(name, name, SCHEMA, run)

        return [make(n) for n in ("refund_order", "send_email", "close_ticket")]

    def run_it(self, ledger="ledger.json", **kw):
        return run_durable(self.client, agent=kw.pop("agent", "a1"), run_id=kw.pop("run_id", "r"), task="go", tools=self.tools(),
                           ledger_path=os.path.join(self.tmp.name, ledger), log=lambda s: None, **kw)

    def test_a_follow_up_wake_carries_results_and_still_the_text_message(self):
        server = self.start(refund_handler())
        self.assertEqual(self.run_it().status, "done")
        bodies = [r[2] for r in server.requests]
        self.assertEqual(len(bodies), 4)
        for i, tool in ((1, "refund_order"), (2, "send_email"), (3, "close_ticket")):
            self.assertEqual(bodies[i]["results"], [{"seq": i, "result": {"ok": tool}}])
            self.assertEqual(bodies[i]["message"], TEXT + json.dumps([{"tool": tool, "seq": i, "result": {"ok": tool}}]))

    def test_the_first_wake_has_no_results(self):
        server = self.start(refund_handler())
        self.run_it()
        self.assertNotIn("results", server.requests[0][2])
        self.assertEqual(server.requests[0][2]["message"], "go")

    def test_a_server_that_refuses_results_gets_the_same_wake_again_without_it_under_the_same_key(self):
        server = self.start(refusing(refund_handler()))
        self.assertEqual(self.run_it().status, "done")
        sent = [("results" in r[2], r[1]["idempotency-key"]) for r in server.requests]
        # wake 0; wake 1 refused with results, then resent without; then wakes 2 and 3 never carry results
        self.assertEqual(sent, [(False, "r.0"), (True, "r.1"), (False, "r.1"), (False, "r.2"), (False, "r.3")])
        self.assertEqual(server.requests[2][2]["message"], TEXT + json.dumps([{"tool": "refund_order", "seq": 1, "result": {"ok": "refund_order"}}]))
        # the client remembers: a second run on it never sends results
        before = len(server.requests)
        self.run_it(ledger="second.json", run_id="r2", agent="a2")
        self.assertTrue(all("results" not in r[2] for r in server.requests[before:]))

    def test_a_400_that_does_not_mention_results_is_raised(self):
        server = self.start(lambda path, headers, body: (400, {"error": "bad_request", "detail": ["body.model: Required"]}, None))
        with self.assertRaises(ArgenticError) as caught:
            self.client.wake("a1", "hi", model={"provider": "p", "id": "m", "prices": {}}, idempotency_key="k",
                             results=[{"seq": 1, "result": 1}])
        self.assertEqual(caught.exception.status, 400)
        self.assertEqual(len(server.requests), 1)

    def test_structured_results_false_sends_none(self):
        server = self.start(refund_handler())
        self.assertEqual(self.run_it(structured_results=False).status, "done")
        self.assertEqual(len(server.requests), 4)
        self.assertTrue(all("results" not in r[2] for r in server.requests))
        self.assertTrue(server.requests[1][2]["message"].startswith(TEXT))

    def test_the_result_of_an_action_the_ledger_already_finished_is_still_included(self):
        server = self.start(refund_handler())
        with open(os.path.join(self.tmp.name, "ledger.json"), "w") as f:
            json.dump({"entries": {"a1:1": {"tool": "refund_order", "args": {}, "result": {"cached": True}, "at": "x"}}}, f)
        self.run_it()
        self.assertEqual(self.ran, ["send_email", "close_ticket"])  # the refund was skipped
        self.assertEqual(server.requests[1][2]["results"], [{"seq": 1, "result": {"cached": True}}])


if __name__ == "__main__":
    unittest.main()
