#!/usr/bin/env python3
"""
The AWS Marketplace container product, through the Catalog API (`aws marketplace-catalog`):

    aws_catalog.py plan --images-json <edition>/images.json --version X.Y.Z --out change-set.json
        the change set that adds the version (AddDeliveryOptions): the Helm chart and every
        image of the edition, as editions.json and aws/delivery-option.json describe them
    aws_catalog.py submit --change-set change-set.json --name "OneUptime X.Y.Z" [--wait-minutes 90]
        starts it and follows it until AWS has scanned and applied it (or the time is up)
    aws_catalog.py add-repositories [--wait-minutes 30]
        one-time: creates the product's repositories (AddRepositories), named as images.json
        names the images, plus "oneuptime" for the chart
    aws_catalog.py find-product
        lists the seller account's container products, to find the ID editions.json needs

It signs in as the AWS CLI does: in the workflow, the OIDC role
(MARKETPLACE_RELEASE_AWS_ROLE_ARN); by hand, the profile in AWS_PROFILE.
"""

import argparse
import json
import sys
import tempfile
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from release_common import (
    MARKETPLACE_DIR,
    ReleaseError,
    check_version,
    load_editions,
    run,
    wait_for,
    write_summary,
)

CATALOG = "AWSMarketplace"
ENTITY_TYPE = "ContainerProduct@1.0"
# The Catalog API lives in us-east-1, whatever Region the buyers run in.
REGION = "us-east-1"
DELIVERY_OPTION_FILE: Path = MARKETPLACE_DIR / "aws" / "delivery-option.json"
IMAGES_FILE: Path = MARKETPLACE_DIR / "images.json"
CHART_REPOSITORY = "oneuptime"
USAGE_INSTRUCTIONS_LIMIT = 4000
RELEASE_NOTES_LIMIT = 30000

Runner = Callable[[List[str]], str]


def load_json(path: Path) -> Dict[str, Any]:
    with open(path, encoding="utf-8") as file:
        return json.load(file)


def chart_uri(edition: Dict[str, Any], version: str) -> str:
    return f"{edition['registry']}/{CHART_REPOSITORY}:{check_version(version)}"


def release_notes_for(version: str, notes: str = "") -> str:
    text: str = (notes or "").strip() or (
        f"OneUptime Enterprise {version}. What changed: "
        f"https://github.com/OneUptime/oneuptime/releases/tag/{version}"
    )

    if len(text) >= RELEASE_NOTES_LIMIT:
        text = text[: RELEASE_NOTES_LIMIT - 200].rstrip() + (
            f"\n\nThe rest: https://github.com/OneUptime/oneuptime/releases/tag/{version}"
        )

    return text


def add_version_details(
    *,
    version: str,
    images_plan: Dict[str, Any],
    edition: Dict[str, Any],
    delivery: Dict[str, Any],
    release_notes: str,
) -> Dict[str, Any]:
    """The DetailsDocument of an AddDeliveryOptions change: one Helm delivery option."""
    check_version(version)

    if images_plan.get("marketplace") != "aws" or images_plan.get("version") != version:
        raise ReleaseError(
            f"The images plan is for {images_plan.get('marketplace')} {images_plan.get('version')}, "
            f"not aws {version}: build the AWS edition of this release first."
        )

    images: List[str] = [entry["target"] for entry in images_plan["images"]]

    if not images or len(images) > 50:
        raise ReleaseError(f"A delivery option takes 1 to 50 images, not {len(images)}.")

    usage: str = delivery["usageInstructions"]

    if len(usage) > USAGE_INSTRUCTIONS_LIMIT:
        raise ReleaseError(
            f"The usage instructions are {len(usage)} characters; AWS takes {USAGE_INSTRUCTIONS_LIMIT}."
        )

    return {
        "Version": {
            "VersionTitle": version,
            "ReleaseNotes": release_notes_for(version, release_notes),
        },
        "DeliveryOptions": [
            {
                "DeliveryOptionTitle": delivery["title"],
                "Details": {
                    "HelmDeliveryOptionDetails": {
                        "CompatibleServices": ["EKS"],
                        "ContainerImages": images,
                        "HelmChartUri": chart_uri(edition, version),
                        "Description": delivery["description"],
                        "UsageInstructions": usage,
                        "ReleaseName": delivery["releaseName"],
                        "Namespace": delivery["namespace"],
                        "OverrideParameters": delivery["overrideParameters"],
                    }
                },
            }
        ],
    }


def change(change_type: str, product_id: str, details: Dict[str, Any]) -> Dict[str, Any]:
    if not (product_id or "").strip():
        raise ReleaseError("editions.json has no aws.productId (find it with `aws_catalog.py find-product`).")

    return {
        "ChangeType": change_type,
        "Entity": {"Identifier": product_id, "Type": ENTITY_TYPE},
        "DetailsDocument": details,
    }


def add_repositories_details(names: List[str]) -> Dict[str, Any]:
    unique: List[str] = list(dict.fromkeys(names))
    return {"Repositories": [{"RepositoryName": name, "RepositoryType": "ECR"} for name in unique]}


def repository_names(images: Dict[str, Any]) -> List[str]:
    """The chart's repository, then one per image, as build.py names them."""
    return [CHART_REPOSITORY] + [image["name"] for image in images["images"].values()]


def change_set_state(described: Dict[str, Any]) -> Tuple[str, List[str]]:
    """running, succeeded, failed or cancelled, with the errors AWS gave."""
    status: str = described.get("Status", "")

    if status in ("PREPARING", "APPLYING"):
        return "running", []

    if status == "SUCCEEDED":
        return "succeeded", []

    errors: List[str] = []

    if described.get("FailureDescription"):
        errors.append(described["FailureDescription"])

    for entry in described.get("ChangeSet", []) or []:
        for detail in entry.get("ErrorDetailList", []) or []:
            errors.append(f"{detail.get('ErrorCode')}: {detail.get('ErrorMessage')}")

    return ("cancelled" if status == "CANCELLED" else "failed"), errors


class Catalog:
    """The Catalog API calls, through the AWS CLI."""

    def __init__(self, runner: Runner = run) -> None:
        self.runner: Runner = runner

    def call(self, *arguments: str) -> Dict[str, Any]:
        output: str = self.runner(
            ["aws", "marketplace-catalog", *arguments, "--region", REGION, "--output", "json"]
        )
        return json.loads(output or "{}")

    def start(self, changes: List[Dict[str, Any]], name: str) -> str:
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as file:
            json.dump(changes, file)
            path: str = file.name

        started: Dict[str, Any] = self.call(
            "start-change-set",
            "--catalog",
            CATALOG,
            "--change-set",
            f"file://{path}",
            "--change-set-name",
            name,
        )
        Path(path).unlink(missing_ok=True)
        return started["ChangeSetId"]

    def describe(self, change_set_id: str) -> Dict[str, Any]:
        return self.call("describe-change-set", "--catalog", CATALOG, "--change-set-id", change_set_id)

    def container_products(self) -> List[Dict[str, Any]]:
        listed: Dict[str, Any] = self.call(
            "list-entities", "--catalog", CATALOG, "--entity-type", "ContainerProduct"
        )
        return listed.get("EntitySummaryList", [])


def follow(
    catalog: Catalog, change_set_id: str, wait_minutes: float, sleep: Callable[[float], None] = None
) -> Tuple[str, List[str]]:
    def check() -> Tuple[bool, Tuple[str, List[str]]]:
        state: Tuple[str, List[str]] = change_set_state(catalog.describe(change_set_id))
        return state[0] != "running", state

    kwargs: Dict[str, Any] = {"timeout_seconds": wait_minutes * 60, "interval_seconds": 60}

    if sleep is not None:
        kwargs["sleep"] = sleep

    _, state = wait_for(check, **kwargs)
    return state


def report(change_set_id: str, state: Tuple[str, List[str]], what: str) -> int:
    status, errors = state
    console: str = (
        "https://aws.amazon.com/marketplace/management/requests/" + change_set_id
    )

    if status == "succeeded":
        write_summary(f"AWS Marketplace applied {what} (change set `{change_set_id}`).")
        return 0

    if status == "running":
        write_summary(
            f"AWS Marketplace is still applying {what} (change set `{change_set_id}`): it scans every "
            f"image, which can take hours. Follow it under Requests in the Management Portal ({console})."
        )
        return 0

    write_summary(
        f"AWS Marketplace {status} {what} (change set `{change_set_id}`):\n\n"
        + "\n".join(f"- {error}" for error in errors or ["no reason given"])
    )
    return 1


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)

    plan = commands.add_parser("plan")
    plan.add_argument("--images-json", required=True, type=Path)
    plan.add_argument("--version", required=True)
    plan.add_argument("--release-notes-file", type=Path)
    plan.add_argument("--out", required=True, type=Path)
    plan.add_argument("--product-id", help="Instead of editions.json's (a dry run before the product exists).")

    submit = commands.add_parser("submit")
    submit.add_argument("--change-set", required=True, type=Path)
    submit.add_argument("--name", required=True)
    submit.add_argument("--wait-minutes", type=float, default=90)

    repositories = commands.add_parser("add-repositories")
    repositories.add_argument("--wait-minutes", type=float, default=30)

    commands.add_parser("find-product")

    arguments = parser.parse_args(argv)

    try:
        edition: Dict[str, Any] = load_editions()["aws"]
        catalog = Catalog()

        if arguments.command == "plan":
            notes: str = (
                arguments.release_notes_file.read_text(encoding="utf-8")
                if arguments.release_notes_file and arguments.release_notes_file.exists()
                else ""
            )
            details: Dict[str, Any] = add_version_details(
                version=arguments.version,
                images_plan=load_json(arguments.images_json),
                edition=edition,
                delivery=load_json(DELIVERY_OPTION_FILE),
                release_notes=notes,
            )
            product_id: str = arguments.product_id or edition.get("productId", "")
            arguments.out.write_text(
                json.dumps([change("AddDeliveryOptions", product_id, details)], indent=2) + "\n",
                encoding="utf-8",
            )
            print(f"Wrote the change set adding {arguments.version} to {arguments.out}")
            return 0

        if arguments.command == "submit":
            changes: List[Dict[str, Any]] = load_json(arguments.change_set)
            change_set_id: str = catalog.start(changes, arguments.name)
            print(f"Started change set {change_set_id}")
            return report(
                change_set_id,
                follow(catalog, change_set_id, arguments.wait_minutes),
                f"\"{arguments.name}\"",
            )

        if arguments.command == "add-repositories":
            names: List[str] = repository_names(load_json(IMAGES_FILE))
            change_set_id = catalog.start(
                [change("AddRepositories", edition.get("productId", ""), add_repositories_details(names))],
                "OneUptime repositories",
            )
            print(f"Started change set {change_set_id} creating {', '.join(names)}")
            return report(
                change_set_id,
                follow(catalog, change_set_id, arguments.wait_minutes),
                f"the repositories {', '.join(names)}",
            )

        for product in catalog.container_products():
            print(f"{product.get('EntityId')}  {product.get('Name')}  ({product.get('Visibility')})")
        return 0
    except ReleaseError as error:
        print(f"::error title=AWS Marketplace::{str(error).replace(chr(10), ' ')}")
        print(error, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
