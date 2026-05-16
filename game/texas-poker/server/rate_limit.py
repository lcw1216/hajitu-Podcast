import time
import threading
from collections import defaultdict


class RateLimiter:
    def __init__(self, max_requests=10, window_seconds=60):
        self.max_requests = max_requests
        self.window = window_seconds
        self._requests = defaultdict(list)
        self._lock = threading.Lock()

    def is_allowed(self, key):
        now = time.time()
        with self._lock:
            self._requests[key] = [t for t in self._requests[key] if now - t < self.window]
            if len(self._requests[key]) >= self.max_requests:
                return False
            self._requests[key].append(now)
            return True

    def cleanup(self):
        now = time.time()
        with self._lock:
            expired_keys = [k for k, v in self._requests.items() if not v or now - v[-1] > self.window * 2]
            for k in expired_keys:
                del self._requests[k]

    def reset(self, key=None):
        with self._lock:
            if key:
                self._requests.pop(key, None)
            else:
                self._requests.clear()


login_limiter = RateLimiter(max_requests=5, window_seconds=60)
register_limiter = RateLimiter(max_requests=3, window_seconds=300)
