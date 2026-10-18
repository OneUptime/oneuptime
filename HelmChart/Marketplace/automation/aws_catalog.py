#!/usr/bin/env python3
"""
The AWS Marketplace container products, through the Catalog API (`aws marketplace-catalog`):
OneUptime Enterprise (--edition aws, the default), and the Kubernetes agent's Amazon EKS
add-on (--edition aws-eks-addon), a free product of its own in the same seller account.

    aws_catalog.py plan [--edition E] --images-json <edition>/images.json --version X.Y.Z --out change-set.json
        the change set that adds the version (AddDeliveryOptions): the Helm chart and every
        image of the edition, as editions.json and the edition's delivery-option.json describe
        them. The add-on's version is an EKS add-on delivery option, which AWS publishes as
        Limited: in the EKS add-on catalog of the seller account, in ap-northeast-2, for testing
    aws_catalog.py submit --change-set change-set.json --name "OneUptime X.Y.Z" [--wait-minutes 90]
        starts it and follows it until AWS has scanned and applied it (or the time is up)
    aws_catalog.py shipped [--edition E] --version X.Y.Z [--wait-while-testing]
        whether the product has that version already (its title); writes shipped=true|false
        for the next steps, so a release is never added twice. With --wait-while-testing (the
        weekly run), the add-on's also says true while AWS is still publishing a version of it,
        or one is still in testing (Limited)
    aws_catalog.py go-public --version X.Y.Z [--wait-minutes 60]
        the add-on only, by hand, once that version has been tested on every Kubernetes version
        its delivery option names: asks AWS to make it public (UpdateDeliveryOptionsVisibility)
    aws_catalog.py add-repositories [--edition E] [--wait-minutes 30]
        one-time: creates the product's repositories (AddRepositories), named as the edition's
        images.json names the images, plus its chart's ("oneuptime", "kubernetes-agent")
    aws_catalog.py find-product
        lists the seller account's container products, to find the IDs editions.json needs

It signs in as the AWS CLI does: in the workflow, the OIDC role
(MARKETPLACE_RELEASE_AWS_ROLE_ARN); by hand, the profile in AWS_PROFILE.
"""

import argparse
import json
import re
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
    write_outputs,
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

# The Kubernetes agent's EKS add-on (build.py --marketplace aws-eks-addon).
EKS_ADDON = "aws-eks-addon"
EDITIONS: Tuple[str, ...] = ("aws", EKS_ADDON)
EKS_ADDON_DELIVERY_OPTION_FILE: Path = MARKETPLACE_DIR / EKS_ADDON / "delivery-option.json"
EKS_ADDON_IMAGES_FILE: Path = MARKETPLACE_DIR / EKS_ADDON / "images.json"
EKS_ADDON_CHART_REPOSITORY = "kubernetes-agent"
# What an EKS add-on delivery option takes (the Catalog API's AddDeliveryOptions, as AWS's own
# shapes check it: awslabs/aws-marketplace-catalog-api-shapes-for-python).
DESCRIPTION_LIMIT = 1000
DELIVERY_OPTION_TITLE_LIMIT = 72
ADDON_NAME_PATTERN: re.Pattern = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]{1,62}[A-Za-z0-9]$")
ADDON_NAMESPACE_PATTERN: re.Pattern = re.compile(r"^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$")
KUBERNETES_VERSION_PATTERN: re.Pattern = re.compile(r"^1\.\d+$")
ADDON_TYPES: Tuple[str, ...] = (
    "Gitops",
    "monitoring",
    "logging",
    "cert-management",
    "policy-management",
    "cost-management",
    "autoscaling",
    "storage",
    "kubernetes-management",
    "service-mesh",
    "etcd-backup",
    "ingress-service-type",
    "load-balancer",
    "local-registry",
    "networking",
    "Security",
    "backup",
    "ingress-controller",
    "observability",
)
# An EKS add-on runs on both: AWS takes no add-on that does not.
ADDON_ARCHITECTURES: Tuple[str, ...] = ("amd64", "arm64")
# What EKS fills in at install, in place of an environment override's value.
ENVIRONMENT_OVERRIDE_VALUES: Tuple[str, ...] = ("${AWS_REGION}", "${AWS_EKS_CLUSTER_NAME}")
ADDON_DELIVERY_OPTION_TYPE = "EksAddOn"
# A change set AWS has not finished with.
OPEN_CHANGE_SET_STATUSES: Tuple[str, ...] = ("PREPARING", "APPLYING")
# Where AWS lists an add-on version for its seller to test before it goes public.
ADDON_TEST_REGION = "ap-northeast-2"

Runner = Callable[[List[str]], str]


def load_json(path: Path) -> Dict[str, Any]:
    with open(path, encoding="utf-8") as file:
        return json.load(file)


def chart_uri(edition: Dict[str, Any], version: str, repository: str = CHART_REPOSITORY) -> str:
    return f"{edition['registry']}/{repository}:{check_version(version)}"


def check_edition(name: str) -> str:
    if name not in EDITIONS:
        raise ReleaseError(f"{name} is not an AWS Marketplace product here ({', '.join(EDITIONS)}).")

    return name


def addon_name(edition: Dict[str, Any], delivery: Dict[str, Any]) -> str:
    """The add-on's name in EKS: AWS puts the seller's alias before the name the listing gives."""
    alias: str = (edition.get("sellerAlias") or "").strip()

    if not alias:
        raise ReleaseError("editions.json has no aws-eks-addon.sellerAlias.")

    return f"{alias}_{delivery['addOnName']}"


def addon_release_notes(version: str) -> str:
    return (
        f"The OneUptime Kubernetes agent of OneUptime {version}. What changed: "
        f"https://github.com/OneUptime/oneuptime/releases/tag/{version}"
    )


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


def add_addon_version_details(
    *,
    version: str,
    images_plan: Dict[str, Any],
    edition: Dict[str, Any],
    delivery: Dict[str, Any],
) -> Dict[str, Any]:
    """
    The DetailsDocument of an AddDeliveryOptions change of the add-on product: one EKS add-on
    delivery option, held to what AWS takes before it is sent (a refusal there costs a day).
    """
    check_version(version)

    if images_plan.get("marketplace") != EKS_ADDON or images_plan.get("version") != version:
        raise ReleaseError(
            f"The images plan is for {images_plan.get('marketplace')} {images_plan.get('version')}, "
            f"not {EKS_ADDON} {version}: build the EKS add-on edition of this release first."
        )

    images: List[str] = [entry["target"] for entry in images_plan["images"]]
    problems: List[str] = []

    if not images or len(images) > 50:
        problems.append(f"A delivery option takes 1 to 50 images, not {len(images)}.")

    if len(images) != len(set(images)):
        problems.append("The images plan names an image twice.")

    for name, limit in (
        ("title", DELIVERY_OPTION_TITLE_LIMIT),
        ("description", DESCRIPTION_LIMIT),
        ("usageInstructions", USAGE_INSTRUCTIONS_LIMIT),
    ):
        text: str = delivery.get(name) or ""

        if not text.strip() or text != text.lstrip() or len(text) > limit:
            problems.append(f"The {name} must be 1 to {limit} characters, starting with one that is not a space.")

    if not ADDON_NAME_PATTERN.match(delivery.get("addOnName") or ""):
        problems.append(f"\"{delivery.get('addOnName')}\" is not a name AWS takes for an add-on.")

    if delivery.get("addOnType") not in ADDON_TYPES:
        problems.append(f"\"{delivery.get('addOnType')}\" is not an add-on type: {', '.join(ADDON_TYPES)}.")

    if not ADDON_NAMESPACE_PATTERN.match(delivery.get("namespace") or ""):
        problems.append(f"\"{delivery.get('namespace')}\" is not a Kubernetes namespace name.")

    kubernetes_versions: List[str] = delivery.get("compatibleKubernetesVersions") or []

    if not 1 <= len(kubernetes_versions) <= 30 or len(set(kubernetes_versions)) != len(kubernetes_versions):
        problems.append("compatibleKubernetesVersions names 1 to 30 Kubernetes versions, each once.")

    for kubernetes_version in kubernetes_versions:
        if not KUBERNETES_VERSION_PATTERN.match(kubernetes_version):
            problems.append(f"\"{kubernetes_version}\" is not a Kubernetes version as EKS names them (1.35).")

    if sorted(delivery.get("supportedArchitectures") or []) != sorted(ADDON_ARCHITECTURES):
        problems.append(f"An EKS add-on runs on {' and '.join(ADDON_ARCHITECTURES)}, both and nothing else.")

    overrides: List[Dict[str, str]] = delivery.get("environmentOverrideParameters") or []
    keys: List[str] = [entry.get("Key", "") for entry in overrides]

    if len(overrides) > 15 or len(keys) != len(set(keys)):
        problems.append("environmentOverrideParameters takes at most 15 parameters, each key once.")

    for entry in overrides:
        if entry.get("Value") not in ENVIRONMENT_OVERRIDE_VALUES or not entry.get("Key", "").strip():
            problems.append(
                f"An environment override sets a values key to one of {', '.join(ENVIRONMENT_OVERRIDE_VALUES)}, "
                f"not {entry}."
            )

    if problems:
        raise ReleaseError("The EKS add-on delivery option is not one AWS takes:\n- " + "\n- ".join(problems))

    return {
        "Version": {
            "VersionTitle": version,
            "ReleaseNotes": addon_release_notes(version),
        },
        "DeliveryOptions": [
            {
                "DeliveryOptionTitle": delivery["title"],
                # AWS publishes an add-on version for its seller to test first; it goes public on
                # request (go-public), once tested.
                "Visibility": "Limited",
                "Details": {
                    "EksAddOnDeliveryOptionDetails": {
                        "ContainerImages": images,
                        "HelmChartUri": chart_uri(edition, version, EKS_ADDON_CHART_REPOSITORY),
                        "Description": delivery["description"],
                        "UsageInstructions": delivery["usageInstructions"].replace(
                            "{addOnName}", addon_name(edition, delivery)
                        ),
                        "AddOnName": delivery["addOnName"],
                        "AddOnVersion": version,
                        "AddOnType": delivery["addOnType"],
                        "CompatibleKubernetesVersions": kubernetes_versions,
                        "SupportedArchitectures": list(ADDON_ARCHITECTURES),
                        "Namespace": delivery["namespace"],
                        "EnvironmentOverrideParameters": overrides,
                    }
                },
            }
        ],
    }


def go_public_details(option_id: str) -> Dict[str, Any]:
    """The DetailsDocument of an UpdateDeliveryOptionsVisibility change: the tested add-on version, public."""
    return {"DeliveryOptions": [{"Id": option_id, "TargetVisibility": "Public"}]}


def change(change_type: str, product_id: str, details: Dict[str, Any]) -> Dict[str, Any]:
    if not (product_id or "").strip():
        raise ReleaseError("editions.json has no productId for this product (find it with `aws_catalog.py find-product`).")

    return {
        "ChangeType": change_type,
        "Entity": {"Identifier": product_id, "Type": ENTITY_TYPE},
        "DetailsDocument": details,
    }


def add_repositories_details(names: List[str]) -> Dict[str, Any]:
    unique: List[str] = list(dict.fromkeys(names))
    return {"Repositories": [{"RepositoryName": name, "RepositoryType": "ECR"} for name in unique]}


def repository_names(images: Dict[str, Any], chart_repository: str = CHART_REPOSITORY) -> List[str]:
    """The chart's repository, then one per image, as build.py names them."""
    return [chart_repository] + [image["name"] for image in images["images"].values()]


def described_versions(described: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    The versions of a container product, as DescribeEntity gives them: ContainerProduct@1.0's
    Versions, which AWS leaves out while the product has none (the shape AWS publishes in
    awslabs/aws-marketplace-catalog-api-shapes-for-python).
    """
    document: Any = described.get("DetailsDocument")

    if document is None and isinstance(described.get("Details"), str):
        document = json.loads(described["Details"] or "{}")

    if not isinstance(document, dict):
        raise ReleaseError(
            "AWS did not describe the product (DescribeEntity has no details): "
            "check the product ID in editions.json."
        )

    versions: Any = document.get("Versions", [])

    if not isinstance(versions, list):
        raise ReleaseError("AWS listed the product's versions as something other than a list.")

    return [version for version in versions if isinstance(version, dict)]


def product_versions(described: Dict[str, Any]) -> List[str]:
    """The version titles of a container product."""
    return [str(version.get("VersionTitle", "")) for version in described_versions(described)]


def addon_options(version: Dict[str, Any]) -> List[Dict[str, Any]]:
    """A version's EKS add-on delivery options (one, for a version the add-on product has)."""
    return [
        option
        for option in version.get("DeliveryOptions", []) or []
        if isinstance(option, dict)
        and (option.get("Type") == ADDON_DELIVERY_OPTION_TYPE or "AddOnName" in option)
    ]


def addon_versions_in_testing(described: Dict[str, Any]) -> List[str]:
    """The add-on versions AWS has published for testing (Limited) and not made public yet."""
    return [
        str(version.get("VersionTitle", ""))
        for version in described_versions(described)
        if any(option.get("Visibility") == "Limited" for option in addon_options(version))
    ]


def addon_option_id(described: Dict[str, Any], version_title: str) -> Tuple[str, str]:
    """The ID and visibility of the EKS add-on delivery option of one version of the add-on product."""
    for version in described_versions(described):
        if str(version.get("VersionTitle", "")) != version_title:
            continue

        options: List[Dict[str, Any]] = addon_options(version)

        if not options or not options[0].get("Id"):
            raise ReleaseError(f"Version {version_title} of the add-on product has no EKS add-on delivery option.")

        return str(options[0]["Id"]), str(options[0].get("Visibility", ""))

    raise ReleaseError(
        f"The add-on product has no version {version_title} yet: AWS lists a version only once it has "
        "published it for testing."
    )


def is_addon_change_set(changes: List[Dict[str, Any]]) -> bool:
    """Whether a change set adds an EKS add-on version."""
    for entry in changes:
        for option in (entry.get("DetailsDocument") or {}).get("DeliveryOptions", []) or []:
            if "EksAddOnDeliveryOptionDetails" in (option.get("Details") or {}):
                return True

    return False


def addon_testing_steps(version: str, delivery: Dict[str, Any], edition: Dict[str, Any]) -> str:
    """What a maintainer does once AWS has published an add-on version for testing."""
    kubernetes_versions: str = ", ".join(delivery["compatibleKubernetesVersions"])
    return (
        f"AWS Marketplace publishes {version} of the EKS add-on for testing (Limited) once it has ingested it, "
        "which takes 5 to 10 business days (Requests, in the Management Portal). Then, in the seller account:\n\n"
        f"1. In {ADDON_TEST_REGION} (Seoul), create the add-on `{addon_name(edition, delivery)}` {version} on an EKS "
        f"cluster of each Kubernetes version it names ({kubernetes_versions}), with the Secret "
        "`oneuptime-ingestion-key` in `oneuptime-agent`, and check each cluster appears in OneUptime under its "
        "EKS name.\n"
        "2. Keep the test clusters until AWS has made the version public.\n"
        f"3. Make it public: `python3 HelmChart/Marketplace/automation/aws_catalog.py go-public --version {version}`.\n\n"
        "Until then, the weekly run adds no newer version of the add-on."
    )


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

    def describe_entity(self, entity_id: str) -> Dict[str, Any]:
        return self.call("describe-entity", "--catalog", CATALOG, "--entity-id", entity_id)

    def container_products(self) -> List[Dict[str, Any]]:
        listed: Dict[str, Any] = self.call(
            "list-entities", "--catalog", CATALOG, "--entity-type", "ContainerProduct"
        )
        return listed.get("EntitySummaryList", [])

    def open_change_sets(self, entity_id: str) -> List[Dict[str, Any]]:
        """The product's change sets AWS has not finished with."""
        listed: Dict[str, Any] = self.call(
            "list-change-sets",
            "--catalog",
            CATALOG,
            "--filter-list",
            json.dumps(
                [
                    {"Name": "EntityId", "ValueList": [entity_id]},
                    {"Name": "Status", "ValueList": list(OPEN_CHANGE_SET_STATUSES)},
                ]
            ),
        )
        return [
            summary
            for summary in listed.get("ChangeSetSummaryList", []) or []
            if summary.get("Status") in OPEN_CHANGE_SET_STATUSES
        ]


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
    plan.add_argument("--edition", choices=EDITIONS, default="aws")
    plan.add_argument("--images-json", required=True, type=Path)
    plan.add_argument("--version", required=True)
    plan.add_argument("--release-notes-file", type=Path)
    plan.add_argument("--out", required=True, type=Path)
    plan.add_argument("--product-id", help="Instead of editions.json's (a dry run before the product exists).")

    submit = commands.add_parser("submit")
    submit.add_argument("--change-set", required=True, type=Path)
    submit.add_argument("--name", required=True)
    submit.add_argument("--wait-minutes", type=float, default=90)

    shipped = commands.add_parser("shipped")
    shipped.add_argument("--edition", choices=EDITIONS, default="aws")
    shipped.add_argument("--version", required=True)
    shipped.add_argument("--wait-while-testing", action="store_true")

    public = commands.add_parser("go-public")
    public.add_argument("--version", required=True)
    public.add_argument("--wait-minutes", type=float, default=60)

    repositories = commands.add_parser("add-repositories")
    repositories.add_argument("--edition", choices=EDITIONS, default="aws")
    repositories.add_argument("--wait-minutes", type=float, default=30)

    commands.add_parser("find-product")

    arguments = parser.parse_args(argv)

    try:
        editions: Dict[str, Any] = load_editions()
        # go-public is the add-on's alone: Enterprise versions are public once AWS applies them.
        name: str = EKS_ADDON if arguments.command == "go-public" else getattr(arguments, "edition", "aws")
        edition: Dict[str, Any] = editions[check_edition(name)]
        addon: bool = name == EKS_ADDON
        catalog = Catalog()

        if arguments.command == "plan":
            if addon:
                details: Dict[str, Any] = add_addon_version_details(
                    version=arguments.version,
                    images_plan=load_json(arguments.images_json),
                    edition=edition,
                    delivery=load_json(EKS_ADDON_DELIVERY_OPTION_FILE),
                )
            else:
                notes: str = (
                    arguments.release_notes_file.read_text(encoding="utf-8")
                    if arguments.release_notes_file and arguments.release_notes_file.exists()
                    else ""
                )
                details = add_version_details(
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
            code: int = report(
                change_set_id,
                follow(catalog, change_set_id, arguments.wait_minutes),
                f"\"{arguments.name}\"",
            )

            if code == 0 and is_addon_change_set(changes):
                version_title: str = changes[0]["DetailsDocument"]["Version"]["VersionTitle"]
                write_summary(
                    addon_testing_steps(version_title, load_json(EKS_ADDON_DELIVERY_OPTION_FILE), editions[EKS_ADDON])
                )

            return code

        if arguments.command == "go-public":
            version = check_version(arguments.version)
            entity_id = edition.get("productId", "")

            if not entity_id:
                raise ReleaseError(f"editions.json has no {EKS_ADDON}.productId: the product must exist first.")

            option_id, visibility = addon_option_id(catalog.describe_entity(entity_id), version)

            if visibility == "Public":
                write_summary(f"Version {version} of the EKS add-on is public already.")
                return 0

            change_set_id = catalog.start(
                [change("UpdateDeliveryOptionsVisibility", entity_id, go_public_details(option_id))],
                f"Kubernetes agent {version} public",
            )
            print(f"Started change set {change_set_id} making {version} of the EKS add-on public")
            return report(
                change_set_id,
                follow(catalog, change_set_id, arguments.wait_minutes),
                f"making {version} of the EKS add-on public",
            )

        if arguments.command == "shipped":
            version = check_version(arguments.version)
            entity_id = edition.get("productId", "")

            if not entity_id:
                raise ReleaseError(f"editions.json has no {name}.productId: the product must exist first.")

            described: Dict[str, Any] = catalog.describe_entity(entity_id)

            if version in product_versions(described):
                write_outputs({"shipped": "true"})
                write_summary(
                    f"AWS Marketplace has {version} already"
                    + (" as a version of the EKS add-on" if addon else "")
                    + ": nothing to push or add."
                )
                return 0

            if addon and arguments.wait_while_testing:
                waiting: List[str] = [
                    f"AWS is still applying the change set \"{summary.get('ChangeSetName', '')}\" "
                    f"(`{summary.get('ChangeSetId', '')}`)"
                    for summary in catalog.open_change_sets(entity_id)
                ] + [
                    f"version {title} is in testing (Limited): test it, then make it public with "
                    f"`aws_catalog.py go-public --version {title}`"
                    for title in addon_versions_in_testing(described)
                ]

                if waiting:
                    write_outputs({"shipped": "true"})
                    write_summary(
                        f"The weekly run adds no new version of the EKS add-on while another is on its way: "
                        + "; ".join(waiting)
                        + f". Run the workflow by hand to add {version} anyway."
                    )
                    return 0

            write_outputs({"shipped": "false"})
            return 0

        if arguments.command == "add-repositories":
            names: List[str] = (
                repository_names(load_json(EKS_ADDON_IMAGES_FILE), EKS_ADDON_CHART_REPOSITORY)
                if addon
                else repository_names(load_json(IMAGES_FILE))
            )
            change_set_id = catalog.start(
                [change("AddRepositories", edition.get("productId", ""), add_repositories_details(names))],
                "Kubernetes agent repositories" if addon else "OneUptime repositories",
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
