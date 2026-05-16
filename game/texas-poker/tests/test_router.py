import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))

from router import Router, Route


class TestRouter:
    def setup_method(self):
        self.router = Router()

    def test_add_route(self):
        def handler(req):
            pass
        self.router.add_route("GET", "/api/health", handler, name="health")
        assert len(self.router.routes) == 1

    def test_resolve_get_route(self):
        def handler(req):
            return "ok"
        self.router.add_route("GET", "/api/health", handler, name="health")
        resolved_handler, params = self.router.resolve("GET", "/api/health")
        assert resolved_handler == handler
        assert params == {}

    def test_resolve_post_route(self):
        def handler(req):
            return "ok"
        self.router.add_route("POST", "/api/login", handler, name="login")
        resolved_handler, params = self.router.resolve("POST", "/api/login")
        assert resolved_handler == handler

    def test_resolve_with_params(self):
        def handler(req, user_id):
            return user_id
        self.router.add_route("GET", "/api/users/:user_id", handler, name="user_info")
        resolved_handler, params = self.router.resolve("GET", "/api/users/123")
        assert params["user_id"] == "123"

    def test_method_not_allowed(self):
        def handler(req):
            return "ok"
        self.router.add_route("GET", "/api/health", handler)
        from errors import MethodNotAllowedError
        with pytest.raises(MethodNotAllowedError):
            self.router.resolve("POST", "/api/health")

    def test_not_found(self):
        def handler(req):
            return "ok"
        self.router.add_route("GET", "/api/health", handler)
        from errors import NotFoundError
        with pytest.raises(NotFoundError):
            self.router.resolve("GET", "/api/nonexistent")

    def test_url_for(self):
        def handler(req, user_id):
            return "ok"
        self.router.add_route("GET", "/api/users/:user_id", handler, name="user_info")
        url = self.router.url_for("user_info", user_id="456")
        assert url == "/api/users/456"

    def test_url_for_not_found(self):
        with pytest.raises(ValueError):
            self.router.url_for("nonexistent")

    def test_route_decorator(self):
        @self.router.route("/api/test", method="GET", name="test")
        def handler(req):
            return "ok"
        resolved_handler, params = self.router.resolve("GET", "/api/test")
        assert resolved_handler == handler

    def test_any_method(self):
        def handler(req):
            return "ok"
        self.router.add_route("ANY", "/api/any", handler)
        for method in ["GET", "POST", "PUT", "DELETE"]:
            resolved_handler, params = self.router.resolve(method, "/api/any")
            assert resolved_handler == handler
