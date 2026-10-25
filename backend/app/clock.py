import time


def now_ms() -> float:
    """Authoritative server clock in epoch milliseconds (patched in tests)."""
    return time.time() * 1000
