import urllib.request
import urllib.error
import json
import os
import sys
import time
import subprocess
import pytest

BASE_URL = os.environ.get("POKER_API_URL", "http://127.0.0.1:9001")


def api_request(method, path, data=None, expected_status=200, token=None, user_id=None, headers_extra=None):
    url = BASE_URL + path
    headers = {}
    if data:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if user_id:
        headers["X-User-Id"] = str(user_id)
    if headers_extra:
        headers.update(headers_extra)
    body = json.dumps(data).encode("utf-8") if data else None

    req = urllib.request.Request(url, data=body, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            response_data = json.loads(resp.read().decode("utf-8"))
            status = resp.getcode()
            if status != expected_status:
                pytest.fail(f"{method} {path} expected {expected_status}, got {status}")
            return response_data
    except urllib.error.HTTPError as e:
        response_data = json.loads(e.read().decode("utf-8"))
        if e.code != expected_status:
            pytest.fail(f"{method} {path} expected {expected_status}, got {e.code}")
        return response_data
    except Exception as e:
        pytest.fail(f"{method} {path} request failed: {e}")
        return None


@pytest.fixture(scope="session")
def server_process():
    server_dir = os.path.join(os.path.dirname(__file__), "..", "server")
    proc = None
    auto_start = os.environ.get("POKER_AUTO_START", "0") == "1"

    if auto_start:
        proc = subprocess.Popen(
            [sys.executable, os.path.join(server_dir, "app.py")],
            cwd=server_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        time.sleep(2)

    yield

    if proc is not None:
        proc.terminate()
        proc.wait(timeout=5)


@pytest.fixture(scope="session")
def registered_user(server_process):
    username = f"pytest_user_{int(time.time() * 1000) % 100000}"
    password = "pytest_pass_123"
    data = api_request("POST", "/api/register", {
        "username": username,
        "password": password,
    }, expected_status=201, headers_extra={"X-Forwarded-For": "10.0.0.100"})
    return {
        "user_id": data.get("user_id"),
        "username": username,
        "password": password,
    }


@pytest.fixture(scope="session")
def logged_in_user(registered_user):
    data = api_request("POST", "/api/login", {
        "username": registered_user["username"],
        "password": registered_user["password"],
    }, headers_extra={"X-Forwarded-For": "10.0.0.100"})
    return {
        "user_id": data.get("user_id"),
        "username": data.get("username"),
        "token": data.get("token"),
        "chips": data.get("chips"),
    }


class TestHealthCheck:
    def test_health(self, server_process):
        data = api_request("GET", "/api/health")
        assert data["status"] == "healthy"

    def test_config(self, server_process):
        data = api_request("GET", "/api/config")
        assert "ws_url" in data["config"]
        assert "phases" in data["config"]


class TestAuth:
    def test_register_success(self, registered_user):
        assert registered_user["user_id"] is not None

    def test_register_duplicate(self, registered_user):
        api_request("POST", "/api/register", {
            "username": registered_user["username"],
            "password": registered_user["password"],
        }, expected_status=400, headers_extra={"X-Forwarded-For": f"127.0.0.{int(time.time()*100)%200+2}"})

    def test_login_success(self, logged_in_user):
        assert "token" in logged_in_user
        assert logged_in_user["token"] is not None

    def test_login_wrong_password(self, registered_user):
        api_request("POST", "/api/login", {
            "username": registered_user["username"],
            "password": "wrong_password",
        }, expected_status=401, headers_extra={"X-Forwarded-For": "10.0.0.101"})

    def test_login_nonexistent_user(self):
        api_request("POST", "/api/login", {
            "username": "nonexistent_user_xyz",
            "password": "any_password",
        }, expected_status=401, headers_extra={"X-Forwarded-For": f"127.0.0.{int(time.time()*100)%200+50}"})


class TestUserAPI:
    def test_user_info(self, logged_in_user):
        data = api_request("GET", f"/api/users/{logged_in_user['user_id']}",
                           token=logged_in_user["token"], user_id=logged_in_user["user_id"])
        assert data["ok"] is True
        assert data["user"]["username"] == logged_in_user["username"]

    def test_user_not_found(self, logged_in_user):
        api_request("GET", "/api/users/999999", expected_status=404,
                    token=logged_in_user["token"], user_id=logged_in_user["user_id"])

    def test_user_info_unauthorized(self):
        api_request("GET", "/api/users/1", expected_status=401)


class TestRoomAPI:
    def test_create_room(self, logged_in_user):
        data = api_request("POST", "/api/rooms", {
            "name": "Pytest Room",
            "max_players": 6,
            "initial_chips": 1000,
            "created_by": logged_in_user["user_id"],
        }, expected_status=201)
        assert data["ok"] is True
        assert "room_id" in data

    def test_room_list(self, server_process):
        data = api_request("GET", "/api/rooms")
        assert data["ok"] is True
        assert isinstance(data["rooms"], list)

    def test_create_room_empty_name(self, logged_in_user):
        api_request("POST", "/api/rooms", {
            "name": "",
            "created_by": logged_in_user["user_id"],
        }, expected_status=400)

    def test_create_room_invalid_name(self, logged_in_user):
        api_request("POST", "/api/rooms", {
            "name": "<script>alert(1)</script>",
            "created_by": logged_in_user["user_id"],
        }, expected_status=400)


class TestCardAPI:
    def test_card_list(self, server_process):
        data = api_request("GET", "/api/cards")
        assert data["ok"] is True
        assert data["total"] == 52


class TestGameLogs:
    def test_game_logs(self, server_process):
        data = api_request("GET", "/api/game/logs")
        assert data["ok"] is True
        assert isinstance(data["logs"], list)
