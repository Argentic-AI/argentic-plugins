"""put_tools, get_tools, and the context / tool_choice wake fields, against the in-process server.

Run from adapters/python: python -m unittest discover -s tests -v
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from argentic_labs import Argentic  # noqa: E402
from fake_server import serve  # noqa: E402

TOOL = {"name": "book_slot", "description": "Book a slot.", "parameters": {"type": "object", "properties": {"day": {"type": "string"}}, "required": ["day"]}, "defer_loading": True}
MODEL = {"provider": "p", "id": "m", "prices": {"in": 0, "out": 0}}


class ToolsContextTest(unittest.TestCase):
    def client(self, handler):
        server = serve(handler)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server, Argentic(api_key="aek_test", base_url=server.url, sleep=lambda s: None, log=lambda s: None, backoff=())

    def test_put_tools_and_get_tools(self):
        server, c = self.client(lambda path, h, b: (200, {"agent": "a", "tools": [TOOL]}, None))
        self.assertEqual(c.put_tools("a b", [TOOL]), [TOOL])
        self.assertEqual(c.get_tools("a b"), [TOOL])
        self.assertEqual(server.methods, ["PUT", "GET"])
        self.assertEqual(server.requests[0][0], "/v1/agents/a%20b/tools")
        self.assertEqual(server.requests[0][2], {"tools": [TOOL]})

    def test_wake_sends_context_and_tool_choice(self):
        server, c = self.client(lambda path, h, b: (200, {"status": "done", "reply": "ok", "spent_usd": 0, "turns": 1, "wake_id": "wk_1"}, None))
        c.wake("a", "hi", model=MODEL, idempotency_key="k1", context="Plan: pro", tools=[TOOL], tool_choice={"type": "tool", "name": "book_slot"})
        sent = server.requests[0][2]
        self.assertEqual(sent["context"], "Plan: pro")
        self.assertEqual(sent["tool_choice"], {"type": "tool", "name": "book_slot"})

    def test_absent_fields_are_not_sent(self):
        server, c = self.client(lambda path, h, b: (200, {"status": "done", "reply": "ok", "spent_usd": 0, "turns": 1, "wake_id": "wk_1"}, None))
        c.wake("a", "hi", model=MODEL, idempotency_key="k1")
        self.assertNotIn("context", server.requests[0][2])
        self.assertNotIn("tool_choice", server.requests[0][2])


if __name__ == "__main__":
    unittest.main()
