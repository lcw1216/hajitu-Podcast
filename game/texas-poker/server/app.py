import logging
import sqlite3
import os
import uuid
import re
import html
import bcrypt
import contextlib
import threading
import datetime as dt
import config
from server import Server
from response import Response
from errors import BadRequestError, UnauthorizedError, NotFoundError, ForbiddenError
from rate_limit import login_limiter, register_limiter

logging.basicConfig(level=getattr(logging, config.LOG_LEVEL), format=config.LOG_FORMAT)
logger = logging.getLogger(__name__)

_thread_local = threading.local()


def get_db():
    if not hasattr(_thread_local, 'connection') or _thread_local.connection is None:
        conn = sqlite3.connect(config.DB_PATH, timeout=30)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.row_factory = sqlite3.Row
        _thread_local.connection = conn
    return _thread_local.connection


def close_db():
    if hasattr(_thread_local, 'connection') and _thread_local.connection is not None:
        _thread_local.connection.close()
        _thread_local.connection = None


@contextlib.contextmanager
def get_db_context():
    conn = get_db()
    try:
        yield conn
    except Exception:
        conn.rollback()
        raise


def init_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            chips INTEGER DEFAULT 1000,
            token TEXT,
            token_expires_at TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            max_players INTEGER DEFAULT 8,
            initial_chips INTEGER DEFAULT 1000,
            created_by INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (created_by) REFERENCES users(id)
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS game_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id INTEGER,
            player_id INTEGER,
            action TEXT,
            amount INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (room_id) REFERENCES rooms(id),
            FOREIGN KEY (player_id) REFERENCES users(id)
        )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_game_logs_room_id ON game_logs(room_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_users_token ON users(token)")

    try:
        cursor.execute("ALTER TABLE users ADD COLUMN token_expires_at TEXT")
    except sqlite3.OperationalError:
        pass

    conn.commit()
    logger.info("Database initialized")


def require_json(request):
    content_type = request.get_header("content-type", "")
    if "application/json" not in content_type:
        from errors import HTTPError
        raise HTTPError(415, "Content-Type must be application/json")


def sanitize_room_name(name):
    name = html.escape(name, quote=True)
    allowed_pattern = re.compile(r'^[\w\u4e00-\u9fff\s\-·.,!?！？，。、]+$')
    if not allowed_pattern.match(name):
        raise BadRequestError("room name contains invalid characters")
    return name


def log_game_action(room_id, player_id, action, amount=0):
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO game_logs (room_id, player_id, action, amount) VALUES (?, ?, ?, ?)",
            (room_id, player_id, action, amount),
        )
        conn.commit()
    except Exception as e:
        logger.error(f"Failed to log game action: {e}")


def verify_token(user_id, token):
    if not user_id or not token:
        return False
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT token, token_expires_at FROM users WHERE id = ?", (int(user_id),))
        row = cursor.fetchone()
        if not row or row["token"] != token:
            return False
        if row["token_expires_at"]:
            expires = dt.datetime.fromisoformat(row["token_expires_at"])
            if dt.datetime.now(dt.timezone.utc) > expires.replace(tzinfo=dt.timezone.utc):
                return False
        return True
    except Exception as e:
        logger.error(f"Token verification failed: {e}")
        return False


def require_auth(request):
    user_id = request.get_header("x-user-id")
    token = request.get_header("authorization", "").replace("Bearer ", "")
    if not user_id or not token:
        cookie_token = None
        cookie_user_id = None
        cookie_header = request.get_header("cookie", "")
        for part in cookie_header.split(";"):
            part = part.strip()
            if part.startswith("token="):
                cookie_token = part[6:]
            elif part.startswith("user_id="):
                cookie_user_id = part[8:]
        if cookie_user_id and cookie_token:
            user_id = cookie_user_id
            token = cookie_token
    if not user_id or not token:
        raise UnauthorizedError("Authentication required")
    if not verify_token(user_id, token):
        raise UnauthorizedError("Invalid or expired token")
    return int(user_id)


def get_client_ip(request):
    return request.get_header("x-forwarded-for") or request.get_header("x-real-ip") or "unknown"


app = Server()


@app.get("/", name="index")
def index(request):
    return Response.json({"status": "ok", "service": "Texas Poker Server", "version": "1.0"})


@app.get("/api/health", name="health")
def health(request):
    return Response.json({"status": "healthy", "uptime": "running"})


@app.post("/api/register", name="register")
def register(request):
    require_json(request)
    client_ip = get_client_ip(request)
    if not register_limiter.is_allowed(client_ip):
        raise ForbiddenError("请求过于频繁，请稍后再试")

    data = request.json
    if not data or "username" not in data or "password" not in data:
        raise BadRequestError("username and password are required")

    username = data["username"].strip()
    password = data["password"].strip()
    if not username or not password:
        raise BadRequestError("username and password cannot be empty")
    if len(username) < 2 or len(username) > 20:
        raise BadRequestError("username must be 2-20 characters")
    if len(password) < 6:
        raise BadRequestError("password must be at least 6 characters")
    if len(password) > 128:
        raise BadRequestError("password must be at most 128 characters")

    hashed_password = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM users WHERE username = ?", (username,))
    if cursor.fetchone():
        raise BadRequestError("registration failed")
    cursor.execute("INSERT INTO users (username, password) VALUES (?, ?)", (username, hashed_password))
    conn.commit()
    user_id = cursor.lastrowid
    return Response.json({"ok": True, "user_id": user_id, "username": username}, status_code=201)


@app.post("/api/login", name="login")
def login(request):
    require_json(request)
    client_ip = get_client_ip(request)
    if not login_limiter.is_allowed(client_ip):
        raise ForbiddenError("请求过于频繁，请稍后再试")

    data = request.json
    if not data or "username" not in data or "password" not in data:
        raise BadRequestError("username and password are required")

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, username, chips, password FROM users WHERE username = ?",
                   (data["username"],))
    user = cursor.fetchone()
    if not user:
        raise UnauthorizedError("invalid username or password")

    stored_hash = user["password"]
    if not bcrypt.checkpw(data["password"].encode("utf-8"), stored_hash.encode("utf-8")):
        raise UnauthorizedError("invalid username or password")

    token = str(uuid.uuid4())
    token_expires = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=config.TOKEN_EXPIRE_HOURS)).isoformat()
    cursor.execute("UPDATE users SET token = ?, token_expires_at = ? WHERE id = ?",
                   (token, token_expires, user["id"]))
    conn.commit()

    resp = Response.json({
        "ok": True,
        "user_id": user["id"],
        "username": user["username"],
        "chips": user["chips"],
        "token": token,
    })
    resp.set_cookie("token", token, max_age=config.TOKEN_EXPIRE_HOURS * 3600,
                    http_only=True, secure=False, same_site="strict")
    resp.set_cookie("user_id", str(user["id"]), max_age=config.TOKEN_EXPIRE_HOURS * 3600,
                    http_only=True, secure=False, same_site="strict")
    return resp


@app.get("/api/users/:user_id", name="user_info")
def user_info(request, user_id):
    require_auth(request)
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, username, chips, created_at FROM users WHERE id = ?", (int(user_id),))
    user = cursor.fetchone()
    if not user:
        raise NotFoundError("user not found")
    return Response.json({"ok": True, "user": dict(user)})


@app.post("/api/rooms", name="create_room")
def create_room(request):
    require_json(request)
    data = request.json or {}
    name = data.get("name", "").strip()
    if not name:
        raise BadRequestError("room name is required")
    if len(name) < 2:
        raise BadRequestError("room name must be at least 2 characters")

    name = sanitize_room_name(name)

    max_players = data.get("max_players", 8)
    initial_chips = data.get("initial_chips", 1000)
    created_by = data.get("created_by")

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO rooms (name, max_players, initial_chips, created_by) VALUES (?, ?, ?, ?)",
        (name, max_players, initial_chips, created_by),
    )
    conn.commit()
    room_id = cursor.lastrowid
    return Response.json({"ok": True, "room_id": room_id, "name": name}, status_code=201)


@app.get("/api/rooms", name="room_list")
def room_list(request):
    page = int(request.get_param("page", "1"))
    page_size = int(request.get_param("page_size", "20"))
    page_size = min(page_size, 100)
    offset = (page - 1) * page_size

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) as total FROM rooms")
    total = cursor.fetchone()["total"]

    cursor.execute(
        "SELECT id, name, max_players, initial_chips, created_at FROM rooms ORDER BY id DESC LIMIT ? OFFSET ?",
        (page_size, offset),
    )
    rooms = [dict(row) for row in cursor.fetchall()]
    return Response.json({
        "ok": True,
        "rooms": rooms,
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total": total,
            "total_pages": (total + page_size - 1) // page_size if page_size > 0 else 0,
        },
    })


@app.get("/api/rooms/:room_id", name="room_info")
def room_info(request, room_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, max_players, initial_chips, created_at FROM rooms WHERE id = ?", (int(room_id),))
    room = cursor.fetchone()
    if not room:
        raise NotFoundError("room not found")
    return Response.json({"ok": True, "room": dict(room)})


@app.get("/api/rooms/:room_id/status", name="room_status")
def room_status(request, room_id):
    from main import manager
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, max_players, initial_chips FROM rooms WHERE id = ?", (int(room_id),))
    room = cursor.fetchone()
    if not room:
        raise NotFoundError("room not found")

    status_data = {
        "ok": True,
        "room": dict(room),
        "game_active": False,
        "player_count": 0,
        "phase": None,
    }

    game = manager.get_game(room_id)
    if game:
        status_data["game_active"] = game.phase != "idle"
        status_data["player_count"] = game.get_player_count()
        status_data["phase"] = game.phase

    return Response.json(status_data)


@app.post("/api/rooms/:room_id/join", name="join_room")
def join_room(request, room_id):
    require_json(request)
    data = request.json or {}
    user_id = data.get("user_id")
    if not user_id:
        raise BadRequestError("user_id is required")

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, max_players FROM rooms WHERE id = ?", (int(room_id),))
    room = cursor.fetchone()
    if not room:
        raise NotFoundError("room not found")

    cursor.execute("SELECT id, username FROM users WHERE id = ?", (int(user_id),))
    user = cursor.fetchone()
    if not user:
        raise NotFoundError("user not found")

    log_game_action(room_id, user_id, "join")

    return Response.json({
        "ok": True,
        "message": f"User {user['username']} joined room {room['name']}",
        "room": dict(room),
    })


@app.get("/api/game/logs", name="game_logs")
def game_logs(request):
    room_id = request.get_param("room_id")
    page = int(request.get_param("page", "1"))
    page_size = min(int(request.get_param("page_size", "50")), 200)
    offset = (page - 1) * page_size

    conn = get_db()
    cursor = conn.cursor()
    if room_id:
        cursor.execute(
            "SELECT id, room_id, player_id, action, amount, created_at FROM game_logs WHERE room_id = ? ORDER BY id DESC LIMIT ? OFFSET ?",
            (int(room_id), page_size, offset),
        )
    else:
        cursor.execute(
            "SELECT id, room_id, player_id, action, amount, created_at FROM game_logs ORDER BY id DESC LIMIT ? OFFSET ?",
            (page_size, offset),
        )
    logs = [dict(row) for row in cursor.fetchall()]
    return Response.json({"ok": True, "logs": logs, "page": page, "page_size": page_size})


@app.get("/api/cards", name="card_list")
def card_list(request):
    suits = ["spade", "heart", "diamond", "club"]
    suit_symbols = {"spade": "♠", "heart": "♥", "diamond": "♦", "club": "♣"}
    ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]
    cards = []
    for rank_idx, rank in enumerate(ranks):
        for suit_idx, suit in enumerate(suits):
            card_id = rank_idx * 4 + suit_idx
            cards.append({
                "id": card_id,
                "rank": rank,
                "suit": suit,
                "symbol": suit_symbols[suit],
                "display": f"{suit_symbols[suit]}{rank}",
            })
    return Response.json({"ok": True, "total": len(cards), "cards": cards})


@app.get("/api/config", name="game_config")
def game_config(request):
    return Response.json({
        "ok": True,
        "config": {
            "small_blind": 10,
            "big_blind": 20,
            "max_players": 8,
            "initial_chips": 1000,
            "phases": ["idle", "preflop", "flop", "turn", "river", "showdown"],
            "actions": ["fold", "check", "call", "raise"],
            "ws_url": "ws://127.0.0.1:9002",
        },
    })


if __name__ == "__main__":
    init_db()
    logger.info("=" * 50)
    logger.info("  Texas Poker Server")
    logger.info(f"  HTTP: http://{config.HOST}:{config.PORT}")
    logger.info(f"  Static: {config.STATIC_URL_PREFIX}")
    logger.info(f"  API: /api/*")
    logger.info("=" * 50)
    app.start()
