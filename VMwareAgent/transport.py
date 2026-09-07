"""Bounded OTLP/HTTP JSON export, including partial-success validation."""

import json
import logging
import ssl
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener


MAX_REQUEST_BYTES = 1024 * 1024


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Exporter:
    def __init__(self, config, stop):
        self.config = config
        self.stop = stop
        self.opener = build_opener(
            NoRedirect(), HTTPSHandler(context=ssl.create_default_context())
        )

    def export(self, payload):
        # Large estates must not exceed the collector's HTTP request limit.
        # Split at resource boundaries, preserving sample times and identity.
        prefix, suffix = b'{"resourceMetrics":[', b"]}"
        parts = []
        size = len(prefix) + len(suffix)
        for resource in payload["resourceMetrics"]:
            encoded = json.dumps(
                resource, allow_nan=False, separators=(",", ":")
            ).encode()
            if len(encoded) + len(prefix) + len(suffix) > MAX_REQUEST_BYTES:
                logging.error("VMware resource exceeds OTLP request size limit")
                return False
            if parts and size + len(encoded) + 1 > MAX_REQUEST_BYTES:
                if not self._export_body(prefix + b",".join(parts) + suffix):
                    return False
                parts = []
                size = len(prefix) + len(suffix)
            size += len(encoded) + (1 if parts else 0)
            parts.append(encoded)
        return self._export_body(prefix + b",".join(parts) + suffix)

    def _export_body(self, body):
        for attempt in range(self.config.export_attempts):
            if self.stop.is_set():
                return False
            request = Request(
                self.config.otlp_endpoint,
                data=body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                with self.opener.open(request, timeout=self.config.timeout) as response:
                    content = response.read(65537)
                    if len(content) > 65536:
                        raise ValueError("OTLP response exceeds size limit")
                    result = json.loads(content) if content else {}
                    partial = result.get("partialSuccess", {})
                    if int(partial.get("rejectedDataPoints", 0)):
                        # OTLP partial success must not be retried (duplicates).
                        logging.error("Collector rejected VMware metric points")
                        return False
                    return True
            except HTTPError as error:
                if error.code not in (429, 502, 503, 504):
                    logging.error(
                        "Collector rejected VMware metrics (HTTP %d)", error.code
                    )
                    return False
            except (URLError, TimeoutError, OSError):
                pass
            except (ValueError, TypeError, AttributeError):
                logging.error("Invalid OTLP collector response")
                return False
            if attempt + 1 < self.config.export_attempts and self.stop.wait(
                min(2**attempt, 8)
            ):
                return False
        logging.error("VMware metric export failed after bounded retries")
        return False
