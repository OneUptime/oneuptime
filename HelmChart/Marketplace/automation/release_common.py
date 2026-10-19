"""
What the marketplace release scripts share: the editions and when each is ready to release,
versions, running a CLI, waiting on a marketplace, and writing what a GitHub Actions step
reports (its outputs and its summary).
"""

import json
import os
import re
import subprocess
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

HERE: Path = Path(__file__).resolve().parent
MARKETPLACE_DIR: Path = HERE.parent
EDITIONS_FILE: Path = MARKETPLACE_DIR / "editions.json"
# Where the workflow ships: the three listings of OneUptime Enterprise, and the free Kubernetes
# agent's Amazon EKS add-on, a product of its own on AWS Marketplace.
MARKETPLACES: Tuple[str, ...] = ("aws", "azure", "google-cloud", "aws-eks-addon")
VERSION_PATTERN: re.Pattern = re.compile(r"^\d+\.\d+\.\d+$")

# What each edition needs, besides "ready", before anything is pushed or submitted.
REQUIRED_FIELDS: Dict[str, Tuple[str, ...]] = {
    "aws": ("registry", "serviceAccountName", "productId"),
    "azure": (
        "registry",
        "offerId",
        "planId",
        "clusterExtensionType",
        "resourceGroup",
        "bundleRepository",
    ),
    "google-cloud": ("registry", "serviceName"),
    "aws-eks-addon": ("registry", "productId", "sellerAlias"),
}


class ReleaseError(Exception):
    """A release step that cannot go on; the message says why, for the person reading the log."""


def load_editions(path: Path = EDITIONS_FILE) -> Dict[str, Any]:
    with open(path, encoding="utf-8") as file:
        return json.load(file)


def readiness_problems(marketplace: str, edition: Dict[str, Any]) -> List[str]:
    """Why an edition cannot be released yet; empty when it can."""
    if marketplace not in REQUIRED_FIELDS:
        return [f"{marketplace} is not a marketplace edition ({', '.join(MARKETPLACES)})."]

    problems: List[str] = []

    if edition.get("ready") is not True:
        problems.append(
            f"{marketplace}: editions.json does not mark it ready. Set \"ready\": true once every "
            "value of the edition is the one the marketplace's portal shows."
        )

    for field in REQUIRED_FIELDS[marketplace]:
        if not str(edition.get(field, "")).strip():
            problems.append(f"{marketplace}: editions.json has no {field}.")

    return problems


def check_version(version: str) -> str:
    if not VERSION_PATTERN.match(version or ""):
        raise ReleaseError(f"\"{version}\" is not a release version (#.#.#).")
    return version


def track_of(version: str) -> str:
    """A release's track (major.minor), as Google Cloud Marketplace tags images with it."""
    return ".".join(check_version(version).split(".")[:2])


def parse_marketplaces(text: str) -> List[str]:
    """A comma- or space-separated list of marketplaces; empty or "all" means every one."""
    names: List[str] = [name for name in re.split(r"[\s,]+", (text or "").strip()) if name]

    if not names or names == ["all"]:
        return list(MARKETPLACES)

    unknown: List[str] = [name for name in names if name not in MARKETPLACES]

    if unknown:
        raise ReleaseError(
            f"Unknown marketplace(s): {', '.join(unknown)}. Choose from {', '.join(MARKETPLACES)}."
        )

    return [name for name in MARKETPLACES if name in names]


def run(
    command: Sequence[str],
    *,
    input_text: Optional[str] = None,
    env: Optional[Dict[str, str]] = None,
) -> str:
    """Runs a command and returns what it printed; a failure raises with what it said."""
    result: subprocess.CompletedProcess = subprocess.run(
        list(command),
        input=input_text,
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )

    if result.returncode != 0:
        said: str = (result.stderr or result.stdout or "").strip()
        raise ReleaseError(
            f"`{' '.join(command[:3])} ...` failed ({result.returncode}): {said[-2000:]}"
        )

    return result.stdout


def wait_for(
    check: Callable[[], Tuple[bool, Any]],
    *,
    timeout_seconds: float,
    interval_seconds: float,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
) -> Tuple[bool, Any]:
    """
    Calls check until it says it is done, or the time is up. Returns (done, its last value):
    a marketplace that is still busy when the time is up is not a failure in itself.
    """
    deadline: float = clock() + timeout_seconds

    while True:
        done, value = check()

        if done or clock() + interval_seconds > deadline:
            return done, value

        sleep(interval_seconds)


def write_outputs(values: Dict[str, str], path: Optional[str] = None) -> None:
    """Step outputs, for the jobs after this one (GITHUB_OUTPUT); printed when there is none."""
    path = path if path is not None else os.environ.get("GITHUB_OUTPUT", "")
    lines: List[str] = [f"{name}={value}" for name, value in values.items()]

    for name, value in values.items():
        if "\n" in value:
            raise ReleaseError(f"Output {name} spans lines.")

    if path:
        with open(path, "a", encoding="utf-8") as file:
            file.write("\n".join(lines) + "\n")
    else:
        print("\n".join(lines))


def write_summary(markdown: str, path: Optional[str] = None) -> None:
    """The step's summary on the run's page (GITHUB_STEP_SUMMARY); printed as well."""
    path = path if path is not None else os.environ.get("GITHUB_STEP_SUMMARY", "")
    print(markdown)

    if path:
        with open(path, "a", encoding="utf-8") as file:
            file.write(markdown.rstrip("\n") + "\n\n")
