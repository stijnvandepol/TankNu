import time
from typing import Optional


class RateLimiter:
    def __init__(self, per_second: float = 3.0):
        self.interval = 1.0 / max(0.001, per_second)
        self._last: Optional[float] = None

    def wait(self):
        now = time.time()
        if self._last is None:
            self._last = now
            return
        delta = now - self._last
        if delta < self.interval:
            time.sleep(self.interval - delta)
        self._last = time.time()