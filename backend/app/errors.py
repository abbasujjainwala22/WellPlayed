from fastapi import HTTPException


class UserError(Exception):
    """A problem with what the user asked for. The message is shown to them as written (no "bad request:" prefix)."""

    def __init__(self, message: str, **extra: object) -> None:
        super().__init__(message)
        self.extra = extra


class ApiError(HTTPException):
    """An HTTP error with a machine-readable `code` next to the friendly `detail` (see diagnostics)."""

    def __init__(self, status_code: int, detail: str, code: str, headers: dict[str, str] | None = None) -> None:
        super().__init__(status_code, detail, headers)
        self.code = code
