"""Structured logging configuration with secret-redaction filter."""
import logging
from typing import Any

import structlog

# Keys whose values must never appear in logs
_SECRET_KEYS = frozenset(
    {"password", "api_key", "hashed_password", "token", "secret", "jwt_secret", "access_token"}
)


class SecretRedactionFilter(logging.Filter):
    """Scrubs known secret keys from LogRecord extra dict before emission."""

    def filter(self, record: logging.LogRecord) -> bool:
        # Scrub from record.__dict__ (extras end up there)
        for key in _SECRET_KEYS:
            if key in record.__dict__:
                record.__dict__[key] = "***REDACTED***"
        # Scrub from args if it's a dict
        if isinstance(record.args, dict):
            for key in _SECRET_KEYS:
                if key in record.args:
                    record.args = {**record.args, key: "***REDACTED***"}  # type: ignore[assignment]
        return True


def configure_logging(level: str = "INFO") -> None:
    """Configure structlog + standard logging. Call once at app startup."""
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.stdlib.add_log_level,
            structlog.stdlib.add_logger_name,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.ExceptionRenderer(),
            structlog.dev.ConsoleRenderer(),
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, level.upper(), logging.INFO))

    if not root_logger.handlers:
        handler = logging.StreamHandler()
        handler.addFilter(SecretRedactionFilter())
        root_logger.addHandler(handler)
    else:
        for handler in root_logger.handlers:
            handler.addFilter(SecretRedactionFilter())


def get_logger(name: str) -> Any:
    """Get a structlog logger bound to the given name."""
    return structlog.get_logger(name)
