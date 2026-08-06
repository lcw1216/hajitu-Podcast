import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))

from request import Request


class TestRequest:
    def test_parse_basic_get(self):
        raw = b"GET /api/health HTTP/1.1\r\nHost: localhost:9001\r\n\r\n"
        req = Request.from_raw(raw)
        assert req.method == "GET"
        assert req.path == "/api/health"
        assert req.headers["host"] == "localhost:9001"

    def test_parse_post_with_body(self):
        body = b'{"username": "test", "password": "123"}'
        raw = b"POST /api/login HTTP/1.1\r\nHost: localhost:9001\r\nContent-Type: application/json\r\nContent-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body
        req = Request.from_raw(raw)
        assert req.method == "POST"
        assert req.path == "/api/login"
        assert req.content_type == "application/json"
        assert req.json["username"] == "test"

    def test_parse_query_params(self):
        raw = b"GET /api/users?page=1&limit=10 HTTP/1.1\r\n\r\n"
        req = Request.from_raw(raw)
        assert req.path == "/api/users"
        assert req.get_param("page") == "1"
        assert req.get_param("limit") == "10"

    def test_parse_url_encoded_path(self):
        raw = b"GET /api/users/John%20Doe HTTP/1.1\r\n\r\n"
        req = Request.from_raw(raw)
        assert req.path == "/api/users/John Doe"

    def test_get_header(self):
        raw = b"GET / HTTP/1.1\r\nContent-Type: application/json\r\n\r\n"
        req = Request.from_raw(raw)
        assert req.get_header("content-type") == "application/json"
        assert req.get_header("nonexistent", "default") == "default"

    def test_empty_request(self):
        with pytest.raises(ValueError):
            Request.from_raw(b"")

    def test_malformed_request(self):
        with pytest.raises(ValueError):
            Request.from_raw(b"GET / HTTP/1.1\r\n")
