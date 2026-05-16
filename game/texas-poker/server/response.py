import json
import mimetypes
from datetime import datetime, timezone


class Response:
    STATUS_MESSAGES = {
        200: "OK",
        201: "Created",
        204: "No Content",
        301: "Moved Permanently",
        302: "Found",
        304: "Not Modified",
        400: "Bad Request",
        401: "Unauthorized",
        403: "Forbidden",
        404: "Not Found",
        405: "Method Not Allowed",
        408: "Request Timeout",
        413: "Payload Too Large",
        415: "Unsupported Media Type",
        500: "Internal Server Error",
        502: "Bad Gateway",
        503: "Service Unavailable",
    }

    def __init__(self, status_code=200, body=b"", headers=None, content_type=None):
        self.status_code = status_code
        self._body = body if isinstance(body, bytes) else body.encode("utf-8")
        self.headers = headers or {}
        self.cookies = {}
        if content_type:
            self.headers["content-type"] = content_type

    @classmethod
    def html(cls, body, status_code=200):
        return cls(status_code=status_code, body=body, content_type="text/html; charset=utf-8")

    @classmethod
    def json(cls, data, status_code=200):
        body = json.dumps(data, ensure_ascii=False, indent=2)
        return cls(status_code=status_code, body=body, content_type="application/json; charset=utf-8")

    @classmethod
    def text(cls, body, status_code=200):
        return cls(status_code=status_code, body=body, content_type="text/plain; charset=utf-8")

    @classmethod
    def redirect(cls, url, status_code=302):
        resp = cls(status_code=status_code)
        resp.headers["location"] = url
        return resp

    @classmethod
    def error(cls, status_code, message=None):
        status_msg = cls.STATUS_MESSAGES.get(status_code, "Error")
        body = message or status_msg
        data = {"ok": False, "error": {"code": status_code, "message": body}}
        return cls(status_code=status_code, body=json.dumps(data, ensure_ascii=False), content_type="application/json; charset=utf-8")

    @classmethod
    def file(cls, data, filename, content_type=None):
        if content_type is None:
            content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        resp = cls(body=data, content_type=content_type)
        resp.headers["content-disposition"] = f'attachment; filename="{filename}"'
        return resp

    def set_cookie(self, name, value, max_age=None, path="/", http_only=False, secure=False, same_site="lax"):
        cookie_str = f"{name}={value}"
        if max_age is not None:
            cookie_str += f"; Max-Age={max_age}"
        cookie_str += f"; Path={path}"
        if http_only:
            cookie_str += "; HttpOnly"
        if secure:
            cookie_str += "; Secure"
        if same_site:
            cookie_str += f"; SameSite={same_site}"
        self.cookies[name] = cookie_str

    def set_header(self, name, value):
        self.headers[name.lower()] = value

    @property
    def body(self):
        return self._body

    @body.setter
    def body(self, value):
        self._body = value if isinstance(value, bytes) else value.encode("utf-8")

    def serialize(self):
        status_msg = self.STATUS_MESSAGES.get(self.status_code, "Unknown")
        status_line = f"HTTP/1.1 {self.status_code} {status_msg}\r\n"

        self.headers["content-length"] = str(len(self._body))
        if "date" not in self.headers:
            self.headers["date"] = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT")
        if "server" not in self.headers:
            self.headers["server"] = "TexasPoker/1.0"
        if "connection" not in self.headers:
            self.headers["connection"] = "close"

        header_lines = ""
        for key, value in self.headers.items():
            header_lines += f"{key}: {value}\r\n"

        for cookie_str in self.cookies.values():
            header_lines += f"set-cookie: {cookie_str}\r\n"

        raw = (status_line + header_lines + "\r\n").encode("utf-8") + self._body
        return raw

    def __repr__(self):
        return f"<Response {self.status_code}>"
