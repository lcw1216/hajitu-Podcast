import io
from urllib.parse import parse_qs, unquote


class Request:
    def __init__(self, method, path, headers, body, query_params=None):
        self.method = method.upper()
        self.path = path
        self.headers = headers
        self.body = body
        self.query_params = query_params or {}
        self._json = None
        self._form = None

    @classmethod
    def from_raw(cls, raw_data):
        if not raw_data:
            raise ValueError("Empty request data")

        header_end = raw_data.find(b"\r\n\r\n")
        if header_end == -1:
            raise ValueError("Malformed request: no header terminator")

        header_part = raw_data[:header_end].decode("utf-8", errors="replace")
        body_part = raw_data[header_end + 4:]

        lines = header_part.split("\r\n")
        if not lines:
            raise ValueError("Malformed request: empty header")

        request_line = lines[0]
        parts = request_line.split(" ")
        if len(parts) < 2:
            raise ValueError(f"Malformed request line: {request_line}")

        method = parts[0]
        raw_path = parts[1]

        if "?" in raw_path:
            path, query_string = raw_path.split("?", 1)
            query_params = parse_qs(query_string, keep_blank_values=True)
            query_params = {k: v[0] if len(v) == 1 else v for k, v in query_params.items()}
        else:
            path = raw_path
            query_params = {}

        path = unquote(path)

        headers = {}
        for line in lines[1:]:
            if ":" in line:
                key, value = line.split(":", 1)
                headers[key.strip().lower()] = value.strip()

        content_length = int(headers.get("content-length", 0))
        if content_length > 0:
            body = body_part[:content_length]
        else:
            body = b""

        return cls(method=method, path=path, headers=headers, body=body, query_params=query_params)

    @property
    def content_type(self):
        return self.headers.get("content-type", "")

    @property
    def content_length(self):
        return int(self.headers.get("content-length", 0))

    @property
    def json(self):
        if self._json is None and self.body:
            import json
            try:
                self._json = json.loads(self.body.decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                self._json = None
        return self._json

    @property
    def form(self):
        if self._form is None and self.body:
            if "application/x-www-form-urlencoded" in self.content_type:
                decoded = self.body.decode("utf-8")
                parsed = parse_qs(decoded, keep_blank_values=True)
                self._form = {k: v[0] if len(v) == 1 else v for k, v in parsed.items()}
            else:
                self._form = {}
        return self._form

    def get_header(self, name, default=None):
        return self.headers.get(name.lower(), default)

    def get_param(self, name, default=None):
        return self.query_params.get(name, default)

    def __repr__(self):
        return f"<Request {self.method} {self.path}>"
