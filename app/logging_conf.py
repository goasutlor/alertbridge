import logging
import os
import sys
from typing import Iterable

from pythonjsonlogger import jsonlogger


class _DefaultFieldsFilter(logging.Filter):
    def __init__(self, fields: Iterable[str]) -> None:
        super().__init__()
        self._fields = list(fields)

    def filter(self, record: logging.LogRecord) -> bool:
        for field in self._fields:
            if not hasattr(record, field):
                setattr(record, field, None)
        return True


def configure_logging() -> None:
    log_level = os.getenv("LOG_LEVEL", "INFO").upper()
    logger = logging.getLogger()
    logger.setLevel(log_level)

    handler = logging.StreamHandler(sys.stdout)
    formatter = jsonlogger.JsonFormatter(
        "%(asctime)s %(levelname)s %(name)s %(message)s "
        "%(request_id)s %(source)s %(route)s %(forward_result)s "
        "%(http_status)s %(duration_ms)s",
        rename_fields={"asctime": "ts", "levelname": "level"},
        datefmt="%Y-%m-%dT%H:%M:%S%z",
    )
    handler.setFormatter(formatter)
    handler.addFilter(
        _DefaultFieldsFilter(
            [
                "request_id",
                "source",
                "route",
                "forward_result",
                "http_status",
                "duration_ms",
            ]
        )
    )

    logger.handlers = [handler]
