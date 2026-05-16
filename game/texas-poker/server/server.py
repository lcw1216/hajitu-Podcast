import socket
import threading
import logging
import signal
import sys
import config
from request import Request
from response import Response
from router import Router
from static_handler import StaticFileHandler
from middleware import (
    MiddlewareChain,
    LoggingMiddleware,
    CORSMiddleware,
    RequestSizeLimitMiddleware,
    XSSProtectionMiddleware,
)
from errors import HTTPError, NotFoundError

logger = logging.getLogger(__name__)


class Server:
    def __init__(self, host=None, port=None, router=None, static_handler=None, middleware_chain=None):
        self.host = host or config.HOST
        self.port = port or config.PORT
        self.router = router or Router()
        self.static_handler = static_handler or StaticFileHandler()
        self.middleware_chain = middleware_chain or MiddlewareChain()
        self.running = False
        self._socket = None
        self._setup_default_middleware()

    def _setup_default_middleware(self):
        if not self.middleware_chain.middlewares:
            self.middleware_chain.add(LoggingMiddleware())
            self.middleware_chain.add(CORSMiddleware())
            self.middleware_chain.add(RequestSizeLimitMiddleware())
            self.middleware_chain.add(XSSProtectionMiddleware())

    def route(self, pattern, method="GET", name=None):
        return self.router.route(pattern, method, name)

    def get(self, pattern, name=None):
        return self.router.get(pattern, name)

    def post(self, pattern, name=None):
        return self.router.post(pattern, name)

    def put(self, pattern, name=None):
        return self.router.put(pattern, name)

    def delete(self, pattern, name=None):
        return self.router.delete(pattern, name)

    def use(self, middleware):
        self.middleware_chain.add(middleware)

    def _create_socket(self):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.settimeout(config.REQUEST_TIMEOUT)
        sock.bind((self.host, self.port))
        sock.listen(config.BACKLOG)
        return sock

    def _handle_connection(self, client_socket, client_address):
        try:
            client_socket.settimeout(config.REQUEST_TIMEOUT)
            raw_data = self._recv_request(client_socket)
            if not raw_data:
                return

            request = Request.from_raw(raw_data)
            request = self.middleware_chain.process_request(request)

            if request.method == "OPTIONS":
                response = Response(status_code=204)
            elif request.path.startswith("/api/") or request.path == "/":
                response = self._dispatch_request(request)
            elif self.static_handler.can_handle(request.path):
                response = self.static_handler.handle(request)
            else:
                response = self._dispatch_request(request)

            response = self.middleware_chain.process_response(request, response)
            client_socket.sendall(response.serialize())

        except HTTPError as e:
            self._send_error(client_socket, e.status_code, e.message)
        except ConnectionResetError:
            logger.debug(f"Connection reset by {client_address}")
        except socket.timeout:
            self._send_error(client_socket, 408, "Request Timeout")
        except Exception as e:
            logger.exception(f"Unexpected error handling {client_address}: {e}")
            self._send_error(client_socket, 500, "Internal Server Error")
        finally:
            try:
                client_socket.close()
            except Exception:
                pass

    def _recv_request(self, sock):
        buffer = bytearray()
        while True:
            try:
                chunk = sock.recv(4096)
                if not chunk:
                    return None
                buffer.extend(chunk)
                if b"\r\n\r\n" in buffer:
                    header_end = buffer.find(b"\r\n\r\n")
                    header_part = buffer[:header_end].decode("utf-8", errors="replace")
                    headers = {}
                    for line in header_part.split("\r\n")[1:]:
                        if ":" in line:
                            k, v = line.split(":", 1)
                            headers[k.strip().lower()] = v.strip()
                    content_length = int(headers.get("content-length", 0))
                    total_needed = header_end + 4 + content_length
                    if len(buffer) >= total_needed:
                        return bytes(buffer[:total_needed])
                if len(buffer) > config.MAX_REQUEST_SIZE:
                    from errors import PayloadTooLargeError
                    raise PayloadTooLargeError()
            except socket.timeout:
                if buffer:
                    return bytes(buffer)
                return None

    def _dispatch_request(self, request):
        try:
            handler, params = self.router.resolve(request.method, request.path)
            request.params = params
            return handler(request, **params)
        except NotFoundError:
            return self._serve_fallback(request)
        except HTTPError:
            raise
        except Exception as e:
            logger.exception(f"Handler error: {e}")
            raise

    def _serve_fallback(self, request):
        fallback_paths = ["/index.html", "/"]
        if request.path in fallback_paths:
            try:
                return self.static_handler.handle(request)
            except Exception:
                pass
        raise NotFoundError(f"Not found: {request.path}")

    def _send_error(self, sock, status_code, message):
        try:
            response = Response.error(status_code, message)
            data = response.serialize()
            sock.sendall(data)
        except Exception:
            pass

    def start(self):
        self._socket = self._create_socket()
        self.running = True

        def signal_handler(sig, frame):
            logger.info("Shutting down server...")
            self.running = False
            self.stop()
            sys.exit(0)

        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)

        logger.info(f"Server started on http://{self.host}:{self.port}")
        logger.info(f"Static files: {self.static_handler.static_dir}")
        logger.info(f"Routes:\n{self.router}")

        while self.running:
            try:
                client_socket, client_address = self._socket.accept()
                thread = threading.Thread(
                    target=self._handle_connection,
                    args=(client_socket, client_address),
                    daemon=True,
                )
                thread.start()
            except socket.timeout:
                continue
            except OSError:
                if self.running:
                    logger.error("Socket error on accept")
                break
            except Exception as e:
                if self.running:
                    logger.error(f"Accept error: {e}")

    def stop(self):
        self.running = False
        if self._socket:
            try:
                self._socket.close()
            except Exception:
                pass
        logger.info("Server stopped")
