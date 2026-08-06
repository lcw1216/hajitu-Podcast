import sys
import os
import pytest
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))

from response import Response


class TestResponse:
    def test_json_response(self):
        resp = Response.json({"ok": True, "data": "test"})
        assert resp.status_code == 200
        assert "application/json" in resp.headers["content-type"]
        body = json.loads(resp.body.decode("utf-8"))
        assert body["ok"] is True

    def test_html_response(self):
        resp = Response.html("<h1>Hello</h1>")
        assert resp.status_code == 200
        assert "text/html" in resp.headers["content-type"]
        assert resp.body == b"<h1>Hello</h1>"

    def test_text_response(self):
        resp = Response.text("Hello World")
        assert resp.status_code == 200
        assert "text/plain" in resp.headers["content-type"]

    def test_error_response(self):
        resp = Response.error(400, "Bad input")
        assert resp.status_code == 400
        assert "application/json" in resp.headers["content-type"]
        body = json.loads(resp.body.decode("utf-8"))
        assert body["ok"] is False
        assert body["error"]["code"] == 400
        assert body["error"]["message"] == "Bad input"

    def test_redirect_response(self):
        resp = Response.redirect("/login")
        assert resp.status_code == 302
        assert resp.headers["location"] == "/login"

    def test_serialize_response(self):
        resp = Response.json({"ok": True})
        raw = resp.serialize()
        assert raw.startswith(b"HTTP/1.1 200 OK\r\n")
        assert b"content-type: application/json" in raw
        assert b"content-length:" in raw

    def test_set_cookie(self):
        resp = Response.text("OK")
        resp.set_cookie("session", "abc123", max_age=3600, http_only=True)
        assert "session=abc123" in resp.cookies["session"]
        assert "Max-Age=3600" in resp.cookies["session"]
        assert "HttpOnly" in resp.cookies["session"]

    def test_set_header(self):
        resp = Response.text("OK")
        resp.set_header("X-Custom", "value")
        assert resp.headers["x-custom"] == "value"

    def test_custom_status_code(self):
        resp = Response.json({"ok": True}, status_code=201)
        assert resp.status_code == 201

    def test_repr(self):
        resp = Response.json({"ok": True})
        assert repr(resp) == "<Response 200>"
