from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class DomainError(Exception):
    """Base for all typed domain errors. Carries a machine code + message."""

    code: str = "domain_error"

    def __init__(self, message: str, code: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        if code:
            self.code = code


class NotFoundError(DomainError):
    code = "not_found"  # → 404


class AuthError(DomainError):
    code = "unauthorized"  # → 401


class Forbidden(DomainError):
    code = "forbidden"  # → 403


class ValidationError(DomainError):
    code = "validation_error"  # → 422


class ConflictError(DomainError):
    code = "conflict"  # → 409


class SecretNotFoundError(DomainError):
    code = "secret_not_found"  # → 404 (internal; not user-triggerable in M0)


class AdapterError(DomainError):
    code = "adapter_error"  # → 502


_STATUS_MAP = {
    AuthError: 401,
    Forbidden: 403,
    NotFoundError: 404,
    SecretNotFoundError: 404,
    ConflictError: 409,
    ValidationError: 422,
    AdapterError: 502,
}


def register_exception_handlers(app: FastAPI) -> None:
    async def handler(request: Request, exc: DomainError) -> JSONResponse:
        status = next((s for t, s in _STATUS_MAP.items() if isinstance(exc, t)), 500)
        return JSONResponse(
            status_code=status,
            content={"error": {"code": exc.code, "message": exc.message}},
        )

    async def validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        """Convert ALL Pydantic RequestValidationError 422s to the standard error envelope.
        Uses the first error's location and message for the human-readable message.
        """
        first = exc.errors()[0]
        loc = first.get("loc", ())
        field = loc[-1] if loc else "unknown"
        msg = first.get("msg", "validation error")
        return JSONResponse(
            status_code=422,
            content={"error": {"code": "validation_error", "message": f"{field}: {msg}"}},
        )

    app.add_exception_handler(DomainError, handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]
