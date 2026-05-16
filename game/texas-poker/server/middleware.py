import time
import logging
import config
from response import Response

logger = logging.getLogger(__name__)


class Middleware:
    def before(self, request):
        return request

    def after(self, request, response):
        return response


class LoggingMiddleware(Middleware):
    def before(self, request):
        request._start_time = time.time()
        logger.info(f"--> {request.method} {request.path}")
        return request

    def after(self, request, response):
        elapsed = time.time() - getattr(request, "_start_time", time.time())
        elapsed_ms = elapsed * 1000
        logger.info(f"<-- {request.method} {request.path} {response.status_code} ({elapsed_ms:.1f}ms)")
        return response


class CORSMiddleware(Middleware):
    def __init__(self, origins=None, methods=None, headers=None, max_age=None):
        self.origins = origins or config.CORS_ORIGINS
        self.methods = methods or config.CORS_METHODS
        self.headers = headers or config.CORS_HEADERS
        self.max_age = max_age or config.CORS_MAX_AGE

    def after(self, request, response):
        origin = request.get_header("origin", "")
        if "*" in self.origins:
            response.set_header("access-control-allow-origin", "*")
        elif origin in self.origins:
            response.set_header("access-control-allow-origin", origin)
            response.set_header("access-control-allow-credentials", "true")

        response.set_header("access-control-allow-methods", ", ".join(self.methods))
        response.set_header("access-control-allow-headers", ", ".join(self.headers))
        response.set_header("access-control-max-age", str(self.max_age))
        return response


class RequestSizeLimitMiddleware(Middleware):
    def __init__(self, max_size=None):
        self.max_size = max_size or config.MAX_REQUEST_SIZE

    def before(self, request):
        content_length = request.content_length
        if content_length > self.max_size:
            from errors import PayloadTooLargeError
            raise PayloadTooLargeError(f"Request body exceeds {self.max_size} bytes")
        return request


class XSSProtectionMiddleware(Middleware):
    def after(self, request, response):
        response.set_header("x-content-type-options", "nosniff")
        response.set_header("x-xss-protection", "1; mode=block")
        response.set_header("x-frame-options", "DENY")
        response.set_header("referrer-policy", "strict-origin-when-cross-origin")
        return response


class MiddlewareChain:
    def __init__(self):
        self.middlewares = []

    def add(self, middleware):
        if isinstance(middleware, Middleware):
            self.middlewares.append(middleware)
        return self

    def process_request(self, request):
        for mw in self.middlewares:
            request = mw.before(request)
        return request

    def process_response(self, request, response):
        for mw in reversed(self.middlewares):
            response = mw.after(request, response)
        return response
