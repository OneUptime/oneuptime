"""Validated configuration. Credentials remain local to the agent."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit


@dataclass(frozen=True)
class Config:
    source_id: str
    source_name: str
    endpoint: str
    username: str
    password: str = field(repr=False)
    ca_file: str | None = None
    interval: float = 60
    timeout: float = 15
    max_objects: int = 10000
    state_file: Path = Path("/var/lib/oneuptime-vmware/inventory.json")
    policy_file: Path | None = None
    otlp_endpoint: str = "http://127.0.0.1:4318/v1/metrics"
    export_attempts: int = 3

    def __post_init__(self):
        endpoint = urlsplit(self.endpoint)
        if (
            endpoint.scheme != "https"
            or not endpoint.hostname
            or endpoint.username
            or endpoint.password
            or endpoint.path not in ("", "/")
            or endpoint.query
            or endpoint.fragment
            or endpoint.port == 0
        ):
            raise ValueError(
                "VMWARE_ENDPOINT must be an HTTPS origin without credentials or path"
            )
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", self.source_id):
            raise ValueError(
                "VMWARE_SOURCE_ID must be a stable 1-128 character identifier"
            )
        if not self.source_name.strip() or not self.username or not self.password:
            raise ValueError("Source name, VMware username and password are required")
        if not 10 <= self.interval <= 3600 or not 1 <= self.timeout <= 60:
            raise ValueError(
                "Polling interval must be 10-3600s and request timeout 1-60s"
            )
        if not 1 <= self.max_objects <= 100000 or not 1 <= self.export_attempts <= 5:
            raise ValueError("Object limit or export attempts outside supported bounds")
        target = urlsplit(self.otlp_endpoint)
        if (
            target.scheme not in ("http", "https")
            or not target.hostname
            or target.username
            or target.password
            or target.query
            or target.fragment
            or target.port == 0
        ):
            raise ValueError("Invalid OTLP metrics endpoint")
        # The bundled collector shares the companion's network namespace.
        if target.scheme == "http" and target.hostname not in (
            "localhost",
            "127.0.0.1",
            "::1",
        ):
            raise ValueError("Unencrypted OTLP is allowed only on loopback")

    @classmethod
    def from_env(cls):
        password_file = os.environ.get("VMWARE_PASSWORD_FILE")
        password = (
            Path(password_file).read_text().rstrip("\r\n")
            if password_file
            else os.environ.get("VMWARE_PASSWORD", "")
        )
        return cls(
            source_id=os.environ.get("VMWARE_SOURCE_ID", ""),
            source_name=os.environ.get("VMWARE_SOURCE_NAME", ""),
            endpoint=os.environ.get("VMWARE_ENDPOINT", ""),
            username=os.environ.get("VMWARE_USERNAME", ""),
            password=password,
            ca_file=os.environ.get("VMWARE_CA_FILE") or None,
            interval=float(os.environ.get("VMWARE_COLLECTION_INTERVAL_SECONDS", "60")),
            timeout=float(os.environ.get("VMWARE_REQUEST_TIMEOUT_SECONDS", "15")),
            max_objects=int(os.environ.get("VMWARE_MAX_OBJECTS", "10000")),
            state_file=Path(
                os.environ.get(
                    "VMWARE_STATE_FILE", "/var/lib/oneuptime-vmware/inventory.json"
                )
            ),
            policy_file=(
                Path(os.environ["VMWARE_POLICY_FILE"])
                if os.environ.get("VMWARE_POLICY_FILE")
                else None
            ),
            otlp_endpoint=os.environ.get(
                "VMWARE_OTLP_ENDPOINT", "http://127.0.0.1:4318/v1/metrics"
            ),
        )


def read_policy(path):
    """Reload operator intent each poll; invalid policy must not reset intent."""
    if path is None:
        return set(), set()
    data = json.loads(path.read_text())
    if not isinstance(data, dict) or set(data) - {
        "expected_running_vm_ids",
        "retired_resources",
    }:
        raise ValueError("Invalid VMware policy fields")
    expected = data.get("expected_running_vm_ids", [])
    retired = data.get("retired_resources", [])
    for values in (expected, retired):
        if not isinstance(values, list) or any(
            not isinstance(x, str) or not x for x in values
        ):
            raise ValueError("Policy selections must be non-empty string lists")
    if any(not re.fullmatch(r"(host|vm|datastore|cluster)/.+", key) for key in retired):
        raise ValueError("Retired resources must use type/resource-id")
    return set(expected), set(retired)
