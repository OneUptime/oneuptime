#!/usr/bin/env python3
"""
What a run of the Marketplace Release workflow does (its prepare job): which release, a dry
run or a real one, and which marketplaces it pushes to and publishes on.

    python3 HelmChart/Marketplace/automation/release_plan.py

Everything comes from the environment the workflow sets:

    EVENT_NAME           schedule (the weekly run) or workflow_dispatch (by hand)
    ACTION               release (default) or azure-go-live
    VERSION              the release: the one asked for, or else the newest release tag
    RELEASE_SHA          the commit of that release's tag; empty when it has none
    MARKETPLACES_INPUT   e.g. "aws,azure"; empty means every one
    DRY_RUN_INPUT        "true" builds everything and pushes and submits nothing
    MARKETPLACE_RELEASE_* the repository variables each marketplace signs in with

The weekly run ships the newest release. A marketplace that is not set up yet is skipped with
a notice, and one that has the release already is skipped by its own job. A run by hand that
asks for a real release on a marketplace that is not set up fails, saying what is missing, and a
real run only ever ships a version that was released (has its tag).

The Kubernetes agent's EKS add-on (aws-eks-addon) is one more: AWS takes days to publish each
version for testing, and OneUptime tests it on every Kubernetes version it names before it goes
public. So the weekly run (automatic=true) leaves it alone while a version of it is still being
published or tested; a run by hand ships it whatever.
"""

import os
import sys
from typing import Any, Dict, List, Optional

from release_common import (
    MARKETPLACES,
    ReleaseError,
    check_version,
    load_editions,
    parse_marketplaces,
    readiness_problems,
    track_of,
    write_outputs,
    write_summary,
)

ACTIONS = ("release", "azure-go-live")

# The repository variables each marketplace's jobs sign in with (OIDC: no secret).
REQUIRED_VARIABLES: Dict[str, tuple] = {
    "aws": ("MARKETPLACE_RELEASE_AWS_ROLE_ARN",),
    "azure": (
        "MARKETPLACE_RELEASE_AZURE_CLIENT_ID",
        "MARKETPLACE_RELEASE_AZURE_TENANT_ID",
        "MARKETPLACE_RELEASE_AZURE_SUBSCRIPTION_ID",
    ),
    "google-cloud": (
        "MARKETPLACE_RELEASE_GOOGLE_WORKLOAD_IDENTITY_PROVIDER",
        "MARKETPLACE_RELEASE_GOOGLE_SERVICE_ACCOUNT",
    ),
    # The add-on product is in the same seller account: the same role adds its versions.
    "aws-eks-addon": ("MARKETPLACE_RELEASE_AWS_ROLE_ARN",),
}

OUTPUT_NAMES: Dict[str, str] = {
    "aws": "aws",
    "azure": "azure",
    "google-cloud": "google_cloud",
    "aws-eks-addon": "aws_eks_addon",
}


def setup_problems(
    marketplace: str, editions: Dict[str, Any], variables: Dict[str, str]
) -> List[str]:
    problems: List[str] = readiness_problems(marketplace, editions.get(marketplace, {}))

    for name in REQUIRED_VARIABLES[marketplace]:
        if not (variables.get(name) or "").strip():
            problems.append(f"{marketplace}: the repository variable {name} is not set.")

    return problems


def make_plan(
    *,
    event: str,
    action: str,
    version: str,
    released: bool,
    marketplaces_input: str,
    dry_run_input: str,
    variables: Dict[str, str],
    editions: Dict[str, Any],
) -> Dict[str, Any]:
    if event not in ("schedule", "workflow_dispatch"):
        raise ReleaseError(f"Unexpected event {event}.")

    action = action or "release"

    if action not in ACTIONS:
        raise ReleaseError(f"Unknown action {action}; choose {' or '.join(ACTIONS)}.")

    automatic: bool = event == "schedule"

    if not (version or "").strip():
        raise ReleaseError("No release to ship: the repository has no release tag (#.#.#).")

    version = check_version(version.strip())
    # Going live is already gated by the approval it waits for: there is nothing to rehearse.
    dry_run: bool = (
        (not automatic)
        and action == "release"
        and (dry_run_input or "true").strip().lower() != "false"
    )

    if action == "azure-go-live":
        selected: List[str] = ["azure"]
    else:
        selected = list(MARKETPLACES) if automatic else parse_marketplaces(marketplaces_input)

    if action == "release" and not dry_run and not released:
        raise ReleaseError(
            f"{version} was not released (no tag {version}): a real run only ships a release."
        )

    runs: Dict[str, bool] = {name: False for name in MARKETPLACES}
    skipped: Dict[str, List[str]] = {}

    for name in selected:
        problems: List[str] = [] if dry_run else setup_problems(name, editions, variables)

        if not problems:
            runs[name] = True
        elif automatic:
            skipped[name] = problems
        else:
            raise ReleaseError(
                "A real run needs every marketplace it names set up:\n- " + "\n- ".join(problems)
            )

    return {
        "action": action,
        "version": version,
        "track": track_of(version),
        "dry_run": dry_run,
        "automatic": automatic,
        "runs": runs,
        "skipped": skipped,
    }


def outputs_of(plan: Dict[str, Any]) -> Dict[str, str]:
    values: Dict[str, str] = {
        "action": plan["action"],
        "version": plan["version"],
        "track": plan["track"],
        "dry_run": "true" if plan["dry_run"] else "false",
        "release": "true" if plan["action"] == "release" else "false",
        "automatic": "true" if plan["automatic"] else "false",
    }

    for name in MARKETPLACES:
        values[OUTPUT_NAMES[name]] = "true" if plan["runs"][name] else "false"

    values["any"] = "true" if any(plan["runs"].values()) else "false"
    return values


def summary_of(plan: Dict[str, Any]) -> str:
    mode: str = "dry run: builds and checks everything, pushes and submits nothing" if plan["dry_run"] else "real"
    lines: List[str] = [
        f"## Marketplace release {plan['version']} ({plan['action']}, {mode})",
        "",
        "| Marketplace | This run |",
        "| --- | --- |",
    ]

    for name in MARKETPLACES:
        if plan["runs"][name] and plan["dry_run"]:
            what: str = "builds and checks"
        elif plan["runs"][name] and plan["action"] == "azure-go-live":
            what = "publishes the newest preview to live"
        elif plan["runs"][name] and name == "google-cloud":
            what = "pushes it, unless it has it already; it is then added in Producer Portal by hand"
        elif plan["runs"][name] and name == "aws-eks-addon":
            what = (
                "adds it for testing, once approved, unless it has it already"
                + (", or a version of it is still being published or tested" if plan["automatic"] else "")
            )
        elif plan["runs"][name]:
            what = "ships it, once approved, unless it has it already"
        elif name in plan["skipped"]:
            what = "skipped: " + " ".join(plan["skipped"][name])
        else:
            what = "not asked for"
        lines.append(f"| {name} | {what} |")

    return "\n".join(lines)


def main(argv: Optional[List[str]] = None) -> int:
    env: Dict[str, str] = dict(os.environ)

    try:
        plan: Dict[str, Any] = make_plan(
            event=env.get("EVENT_NAME", ""),
            action=env.get("ACTION", ""),
            version=env.get("VERSION", ""),
            released=bool(env.get("RELEASE_SHA", "").strip()),
            marketplaces_input=env.get("MARKETPLACES_INPUT", ""),
            dry_run_input=env.get("DRY_RUN_INPUT", ""),
            variables=env,
            editions=load_editions(),
        )
    except ReleaseError as error:
        print(f"::error title=Marketplace release::{str(error).replace(chr(10), ' ')}")
        print(error, file=sys.stderr)
        return 1

    for name, problems in plan["skipped"].items():
        print(f"::notice title=Marketplace release skips {name}::{' '.join(problems)}")

    write_outputs(outputs_of(plan))
    write_summary(summary_of(plan))
    return 0


if __name__ == "__main__":
    sys.exit(main())
