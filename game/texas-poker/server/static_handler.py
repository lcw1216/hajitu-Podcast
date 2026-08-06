import os
import logging
import config
from errors import NotFoundError, ForbiddenError, PayloadTooLargeError
from response import Response

logger = logging.getLogger(__name__)


class StaticFileHandler:
    def __init__(self, static_dir=None, url_prefix=None, max_file_size=None):
        self.static_dir = static_dir or config.STATIC_DIR
        self.url_prefix = url_prefix or config.STATIC_URL_PREFIX
        self.max_file_size = max_file_size or config.MAX_REQUEST_SIZE

    def can_handle(self, path):
        return path.startswith(self.url_prefix)

    def handle(self, request):
        relative_path = request.path[len(self.url_prefix):]
        if not relative_path:
            relative_path = config.STATIC_INDEX

        file_path = os.path.normpath(os.path.join(self.static_dir, relative_path))

        if not file_path.startswith(os.path.normpath(self.static_dir)):
            raise ForbiddenError("Access denied")

        if not os.path.isfile(file_path):
            raise NotFoundError(f"File not found: {relative_path}")

        file_size = os.path.getsize(file_path)
        if file_size > self.max_file_size:
            raise PayloadTooLargeError(f"File too large: {file_size} bytes")

        _, ext = os.path.splitext(file_path)
        content_type = config.MIME_TYPES.get(ext.lower(), config.DEFAULT_MIME)

        try:
            with open(file_path, "rb") as f:
                data = f.read()
        except IOError as e:
            logger.error(f"Failed to read file {file_path}: {e}")
            raise NotFoundError(f"Cannot read file: {relative_path}")

        resp = Response(body=data, content_type=content_type)
        resp.set_header("cache-control", "public, max-age=3600")
        resp.set_header("accept-ranges", "bytes")
        logger.debug(f"Served static file: {relative_path} ({content_type}, {file_size} bytes)")
        return resp
