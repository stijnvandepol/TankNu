import time
from typing import Optional


class RateLimiter:
    def __init__(self, per_second: float = 3.0) -> None:
        self.interval = 1.0 / max(per_second, 0.001)
        self._last: Optional[float] = None

    def wait(self) -> None:
        now = time.monotonic()
        if self._last is not None:
            delta = now - self._last
            if delta < self.interval:
                time.sleep(self.interval - delta)
        self._last = time.monotonic()
