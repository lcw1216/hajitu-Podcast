import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BASE_DIR)

HOST = "127.0.0.1"
PORT = 9001
BACKLOG = 128
MAX_REQUEST_SIZE = 1024 * 1024
REQUEST_TIMEOUT = 30

STATIC_DIR = PROJECT_ROOT
STATIC_URL_PREFIX = "/"
STATIC_INDEX = "index.html"

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml",
}

DEFAULT_MIME = "application/octet-stream"

LOG_LEVEL = "INFO"
LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"

DB_PATH = os.path.join(BASE_DIR, "poker.db")

CORS_ORIGINS = ["http://127.0.0.1:9001", "http://localhost:9001"]
CORS_METHODS = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
CORS_HEADERS = ["Content-Type", "Authorization"]
CORS_MAX_AGE = 86400

TOKEN_EXPIRE_HOURS = 24
