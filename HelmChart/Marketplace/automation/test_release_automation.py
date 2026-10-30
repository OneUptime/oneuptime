"""
Unit tests of the marketplace release automation: what a run does (release_plan), the AWS
change sets (aws_catalog), the Partner Center requests (partner_center), the Google steps
(google_cloud_release) and the one-time setup scripts (ci_setup). Nothing here calls a cloud:
the CLIs and the HTTP API are fakes.

    python3 -m unittest discover -s HelmChart/Marketplace -p 'test_*.py'
"""

import contextlib
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from typing import Any, Dict, List, Optional
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(1, str(HERE.parent))

import aws_catalog  # noqa: E402
import build  # noqa: E402
import ci_setup  # noqa: E402
import google_cloud_release  # noqa: E402
import partner_center  # noqa: E402
import release_common  # noqa: E402
import release_plan  # noqa: E402

VERSION = "14.0.66"
READY_AWS = {
    "ready": True,
    "registry": "709825985650.dkr.ecr.us-east-1.amazonaws.com/hackerbay",
    "serviceAccountName": "oneuptime",
    "productId": "prod-abc123",
}
READY_AZURE = {
    "ready": True,
    "registry": "oneuptimemarketplace.azurecr.io",
    "repositoryPrefix": "oneuptime",
    "offerId": "oneuptime-enterprise",
    "planId": "enterprise",
    "clusterExtensionType": "HackerBay.OneUptimeEnterprise",
    "resourceGroup": "oneuptime-marketplace",
    "bundleRepository": "com.oneuptime.enterprise",
}
READY_GOOGLE = {
    "ready": True,
    "registry": "us-docker.pkg.dev/oneuptime-marketplace/oneuptime/oneuptime-enterprise",
    "serviceName": "oneuptime-enterprise.endpoints.oneuptime-marketplace.cloud.goog",
}
READY_ADDON = {
    "ready": True,
    "registry": "709825985650.dkr.ecr.us-east-1.amazonaws.com/hackerbay",
    "productId": "prod-addon456",
    "sellerAlias": "oneuptime",
}
ALL_VARIABLES = {name: "set" for names in release_plan.REQUIRED_VARIABLES.values() for name in names}
EVERY = {"aws": True, "azure": True, "google-cloud": True, "aws-eks-addon": True}
NONE = {name: False for name in EVERY}


def ready_editions() -> Dict[str, Any]:
    return {
        "aws": dict(READY_AWS),
        "azure": dict(READY_AZURE),
        "google-cloud": dict(READY_GOOGLE),
        "aws-eks-addon": dict(READY_ADDON),
    }


def run_cli(main: Any, argv: List[str], **patches: Any) -> Dict[str, Any]:
    """Runs a CLI's main with the module's names patched; its exit code, outputs and summary."""
    module = sys.modules[main.__module__]

    with tempfile.TemporaryDirectory() as directory:
        outputs = Path(directory) / "outputs"
        summary = Path(directory) / "summary"
        environment = {"GITHUB_OUTPUT": str(outputs), "GITHUB_STEP_SUMMARY": str(summary)}
        environment.update(patches.pop("environment", {}))

        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.dict(os.environ, environment))
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            stack.enter_context(contextlib.redirect_stderr(io.StringIO()))

            for name, value in patches.items():
                stack.enter_context(mock.patch.object(module, name, value))

            code = main(argv)

        return {
            "code": code,
            "outputs": outputs.read_text() if outputs.exists() else "",
            "summary": summary.read_text() if summary.exists() else "",
        }


def aws_images_plan(count: int = 3, version: str = VERSION) -> Dict[str, Any]:
    return {
        "marketplace": "aws",
        "version": version,
        "images": [
            {"key": f"image{index}", "target": f"{READY_AWS['registry']}/image{index}:{version}"}
            for index in range(count)
        ],
    }


class ReleaseCommonTest(unittest.TestCase):
    def test_versions_are_releases(self) -> None:
        self.assertEqual(release_common.check_version("14.0.66"), "14.0.66")

        for bad in ("14.0", "v14.0.66", "14.0.66-rc1", ""):
            with self.assertRaises(release_common.ReleaseError):
                release_common.check_version(bad)

    def test_track_is_major_minor(self) -> None:
        self.assertEqual(release_common.track_of("14.0.66"), "14.0")

    def test_marketplaces_list(self) -> None:
        every = ["aws", "azure", "google-cloud", "aws-eks-addon"]
        self.assertEqual(release_common.parse_marketplaces(""), every)
        self.assertEqual(release_common.parse_marketplaces("all"), every)
        self.assertEqual(release_common.parse_marketplaces("google-cloud, aws"), ["aws", "google-cloud"])
        self.assertEqual(release_common.parse_marketplaces("aws-eks-addon"), ["aws-eks-addon"])

        with self.assertRaises(release_common.ReleaseError):
            release_common.parse_marketplaces("aws,gcp")

    def test_readiness(self) -> None:
        self.assertEqual(release_common.readiness_problems("aws", READY_AWS), [])

        problems = release_common.readiness_problems("aws", dict(READY_AWS, ready=False, productId=""))
        self.assertEqual(len(problems), 2)
        self.assertIn("ready", problems[0])
        self.assertIn("productId", problems[1])

    def test_every_edition_in_editions_json_names_its_readiness(self) -> None:
        editions = release_common.load_editions()

        for name in release_common.MARKETPLACES:
            self.assertIn("ready", editions[name], name)
            self.assertIsInstance(editions[name]["ready"], bool, name)

            for field in release_common.REQUIRED_FIELDS[name]:
                self.assertIn(field, editions[name], f"{name}.{field}")

    def test_wait_for_returns_when_done(self) -> None:
        calls: List[int] = []

        def check() -> Any:
            calls.append(1)
            return len(calls) == 3, len(calls)

        done, value = release_common.wait_for(
            check, timeout_seconds=600, interval_seconds=10, sleep=lambda seconds: None
        )
        self.assertEqual((done, value), (True, 3))

    def test_wait_for_gives_up_when_the_time_is_up(self) -> None:
        now: List[float] = [0.0]

        def sleep(seconds: float) -> None:
            now[0] += seconds

        done, value = release_common.wait_for(
            lambda: (False, "busy"), timeout_seconds=60, interval_seconds=25, sleep=sleep, clock=lambda: now[0]
        )
        self.assertEqual((done, value), (False, "busy"))
        self.assertLessEqual(now[0], 60)

    def test_outputs_are_written_one_per_line(self) -> None:
        with tempfile.NamedTemporaryFile("r", delete=False) as file:
            path = file.name

        release_common.write_outputs({"version": VERSION, "aws": "true"}, path=path)
        self.assertEqual(Path(path).read_text(), f"version={VERSION}\naws=true\n")

        with self.assertRaises(release_common.ReleaseError):
            release_common.write_outputs({"notes": "two\nlines"}, path=path)

        os.unlink(path)


class ReleasePlanTest(unittest.TestCase):
    def plan(self, **overrides: Any) -> Dict[str, Any]:
        arguments: Dict[str, Any] = {
            "event": "workflow_dispatch",
            "action": "release",
            "version": VERSION,
            "released": True,
            "marketplaces_input": "",
            "dry_run_input": "",
            "variables": dict(ALL_VARIABLES),
            "editions": ready_editions(),
        }
        arguments.update(overrides)
        return release_plan.make_plan(**arguments)

    def test_weekly_it_ships_to_every_ready_marketplace_for_real(self) -> None:
        plan = self.plan(event="schedule", dry_run_input="true", marketplaces_input="aws")
        self.assertFalse(plan["dry_run"])
        self.assertTrue(plan["automatic"])
        self.assertEqual(plan["runs"], EVERY)
        self.assertEqual(plan["version"], VERSION)

    def test_runs_on_nothing_but_the_week_and_by_hand(self) -> None:
        for event in ("workflow_run", "push", ""):
            with self.assertRaises(release_common.ReleaseError):
                self.plan(event=event)

    def test_weekly_it_skips_a_marketplace_that_is_not_set_up(self) -> None:
        editions = ready_editions()
        editions["azure"]["ready"] = False
        variables = dict(ALL_VARIABLES)
        del variables["MARKETPLACE_RELEASE_GOOGLE_SERVICE_ACCOUNT"]

        plan = self.plan(event="schedule", editions=editions, variables=variables)
        self.assertEqual(plan["runs"], dict(EVERY, azure=False, **{"google-cloud": False}))
        self.assertIn("ready", " ".join(plan["skipped"]["azure"]))
        self.assertIn("MARKETPLACE_RELEASE_GOOGLE_SERVICE_ACCOUNT", " ".join(plan["skipped"]["google-cloud"]))

    def test_by_hand_it_is_a_dry_run_unless_asked_otherwise(self) -> None:
        editions = {name: {"ready": False} for name in release_common.MARKETPLACES}
        plan = self.plan(editions=editions, variables={})
        self.assertTrue(plan["dry_run"])
        self.assertEqual(plan["runs"], EVERY)

    def test_by_hand_a_real_run_on_a_marketplace_not_set_up_fails(self) -> None:
        editions = ready_editions()
        editions["aws"]["productId"] = ""

        with self.assertRaises(release_common.ReleaseError) as raised:
            self.plan(dry_run_input="false", marketplaces_input="aws", editions=editions)

        self.assertIn("productId", str(raised.exception))

    def test_by_hand_it_releases_only_the_marketplaces_named(self) -> None:
        plan = self.plan(dry_run_input="false", marketplaces_input="azure")
        self.assertEqual(plan["runs"], dict(NONE, azure=True))

    def test_the_version_is_a_release_number(self) -> None:
        self.assertEqual(self.plan(version=" 14.0.60 ")["version"], "14.0.60")

        for bad in ("latest", "v14.0.60", "14.0"):
            with self.assertRaises(release_common.ReleaseError):
                self.plan(version=bad)

    def test_without_a_release_tag_there_is_nothing_to_ship(self) -> None:
        for event in ("schedule", "workflow_dispatch"):
            with self.assertRaises(release_common.ReleaseError) as raised:
                self.plan(event=event, version="", released=False)

            self.assertIn("no release tag", str(raised.exception))

    def test_a_real_run_ships_only_a_version_that_was_released(self) -> None:
        for arguments in ({"event": "schedule"}, {"dry_run_input": "false"}):
            with self.assertRaises(release_common.ReleaseError) as raised:
                self.plan(released=False, **arguments)

            self.assertIn("was not released", str(raised.exception))

        # A dry run may try a version that has no tag yet: it builds from this checkout's chart.
        self.assertTrue(self.plan(released=False)["dry_run"])
        # Going live publishes what is in preview already, whatever the newest tag.
        self.assertEqual(self.plan(action="azure-go-live", released=False)["action"], "azure-go-live")

    def test_azure_go_live_is_azure_only_and_never_a_dry_run(self) -> None:
        plan = self.plan(action="azure-go-live", dry_run_input="true", marketplaces_input="aws")
        self.assertEqual(plan["runs"], dict(NONE, azure=True))
        self.assertFalse(plan["dry_run"])
        self.assertEqual(release_plan.outputs_of(plan)["release"], "false")

        editions = ready_editions()
        editions["azure"]["ready"] = False

        with self.assertRaises(release_common.ReleaseError):
            self.plan(action="azure-go-live", editions=editions)

    def test_outputs_and_summary(self) -> None:
        editions = ready_editions()
        editions["google-cloud"]["ready"] = False
        plan = self.plan(event="schedule", editions=editions)
        outputs = release_plan.outputs_of(plan)
        self.assertEqual(
            outputs,
            {
                "action": "release",
                "version": VERSION,
                "track": "14.0",
                "dry_run": "false",
                "release": "true",
                "automatic": "true",
                "aws": "true",
                "azure": "true",
                "google_cloud": "false",
                "aws_eks_addon": "true",
                "any": "true",
            },
        )
        self.assertEqual(release_plan.outputs_of(self.plan())["automatic"], "false")
        nothing = self.plan(event="schedule", editions={name: {} for name in release_common.MARKETPLACES})
        self.assertEqual(release_plan.outputs_of(nothing)["any"], "false")
        summary = release_plan.summary_of(plan)
        self.assertIn("| google-cloud | skipped:", summary)
        self.assertIn("| aws | ships it, once approved, unless it has it already |", summary)
        self.assertIn("| azure | builds and checks |", release_plan.summary_of(self.plan()))
        self.assertIn(
            "| google-cloud | pushes it, unless it has it already; it is then added in Producer Portal by hand |",
            release_plan.summary_of(self.plan(event="schedule")),
        )
        self.assertIn(
            "| azure | publishes the newest preview to live |",
            release_plan.summary_of(self.plan(action="azure-go-live")),
        )

    def test_main_reads_the_workflow_s_environment(self) -> None:
        environment = dict(ALL_VARIABLES, EVENT_NAME="workflow_dispatch", VERSION=VERSION, RELEASE_SHA="", DRY_RUN_INPUT="false")
        failed = run_cli(release_plan.main, [], environment=environment, load_editions=ready_editions)
        self.assertEqual((failed["code"], failed["outputs"]), (1, ""))

        environment["RELEASE_SHA"] = "0123456789abcdef0123456789abcdef01234567"
        shipped = run_cli(release_plan.main, [], environment=environment, load_editions=ready_editions)
        self.assertEqual(shipped["code"], 0)
        self.assertIn(f"version={VERSION}\n", shipped["outputs"])
        self.assertIn("dry_run=false\n", shipped["outputs"])
        self.assertIn("any=true\n", shipped["outputs"])


class AwsCatalogTest(unittest.TestCase):
    def delivery(self) -> Dict[str, Any]:
        return aws_catalog.load_json(aws_catalog.DELIVERY_OPTION_FILE)

    def test_a_version_ships_the_chart_and_every_image(self) -> None:
        details = aws_catalog.add_version_details(
            version=VERSION, images_plan=aws_images_plan(), edition=READY_AWS, delivery=self.delivery(), release_notes=""
        )
        option = details["DeliveryOptions"][0]["Details"]["HelmDeliveryOptionDetails"]
        self.assertEqual(details["Version"]["VersionTitle"], VERSION)
        self.assertIn(f"releases/tag/{VERSION}", details["Version"]["ReleaseNotes"])
        self.assertEqual(option["HelmChartUri"], f"{READY_AWS['registry']}/oneuptime:{VERSION}")
        self.assertEqual(option["ContainerImages"], [entry["target"] for entry in aws_images_plan()["images"]])
        self.assertEqual(option["CompatibleServices"], ["EKS"])
        self.assertEqual(option["Namespace"], "oneuptime")

    def test_the_buyer_s_service_account_reaches_the_chart(self) -> None:
        parameters = {entry["Key"]: entry["DefaultValue"] for entry in self.delivery()["overrideParameters"]}
        self.assertEqual(parameters["serviceAccount.name"], "${AWSMP_SERVICE_ACCOUNT}")
        self.assertEqual(set(parameters), {"host", "httpProtocol", "serviceAccount.name"})

        for key in parameters:
            self.assertRegex(key, r"^[A-Za-z0-9.]+$")

    def test_the_delivery_option_fits_aws_s_limits(self) -> None:
        delivery = self.delivery()
        self.assertLessEqual(len(delivery["usageInstructions"]), aws_catalog.USAGE_INSTRUCTIONS_LIMIT)
        self.assertNotIn("--set", delivery["usageInstructions"])

    def test_the_usage_instructions_create_the_role_oneuptime_meters_with(self) -> None:
        # The launch page's eksctl command attaches a role the buyer already has (--attach-role-arn)
        # and names no policy. So the instructions give the one that creates the role, for the
        # service account the chart runs as, with the policy MeterUsage needs:
        # AWSMarketplaceMeteringRegisterUsage allows only RegisterUsage.
        delivery = self.delivery()
        usage: str = delivery["usageInstructions"]
        account: str = release_common.load_editions()["aws"]["serviceAccountName"]

        self.assertIn(
            f"\n   eksctl create iamserviceaccount --name {account} --namespace {delivery['namespace']} "
            "--cluster <cluster> --attach-policy-arn arn:aws:iam::aws:policy/AWSMarketplaceMeteringFullAccess "
            "--approve --override-existing-serviceaccounts\n",
            usage,
        )
        self.assertIn(f"\n   serviceAccount.name={account} ", usage)
        self.assertNotIn("--attach-role-arn", usage)
        self.assertNotIn("RegisterUsage", usage)

    def test_the_usage_instructions_set_every_override_parameter(self) -> None:
        # The buyer sets each one in the launch page's helm install command, which has them all.
        delivery = self.delivery()

        for entry in delivery["overrideParameters"]:
            self.assertIn(f"\n   {entry['Key']}=", delivery["usageInstructions"], entry["Key"])

    def test_the_runbook_shows_the_usage_instructions_the_workflow_sends(self) -> None:
        # Wrapped for reading there, word for word the same.
        runbook: str = (
            HERE.parents[2] / "packages/Common/Server/Utils/Marketplace/SELF_HOSTED_RELEASING.md"
        ).read_text(encoding="utf-8")
        copy: str = runbook.split("**Usage instructions (AWS delivery option):**\n\n```text\n", 1)[1]
        copy = copy.split("\n```", 1)[0]

        self.assertEqual(copy.split(), self.delivery()["usageInstructions"].split())

    def test_the_listing_s_links_go_straight_to_their_pages(self) -> None:
        # AWS's review refused the first request to make the listing public for broken links, naming
        # none. Two of its links redirected then (/docs/... to /docs/en/...), and the support
        # description's last link, the docs, was the listing's Get support button.
        runbook: str = (
            HERE.parents[2] / "packages/Common/Server/Utils/Marketplace/SELF_HOSTED_RELEASING.md"
        ).read_text(encoding="utf-8")
        support: str = runbook.split("**Support description (AWS):**", 1)[1].split("```text\n", 1)[1]
        support = support.split("\n```", 1)[0]
        resources: str = runbook.split("**Additional resources (AWS):**", 1)[1].split("\n\n", 2)[1]
        delivery = self.delivery()
        link = re.compile(r"https?://[^\s<>()\"']*[^\s<>()\"'.,;:]")

        self.assertEqual(link.findall(support), ["https://oneuptime.com/support"])

        docs_links: List[str] = [
            found
            for text in (resources, delivery["description"], delivery["usageInstructions"])
            for found in link.findall(text)
            if found.startswith("https://oneuptime.com/docs")
        ]
        self.assertEqual(len(docs_links), 4)

        for found in docs_links:
            self.assertTrue(found.startswith("https://oneuptime.com/docs/en/"), found)
            page: Path = HERE.parents[2] / "packages/App/FeatureSet/Docs/Content" / (
                found[len("https://oneuptime.com/docs/") :] + ".md"
            )
            self.assertTrue(page.is_file(), f"{found}: no docs page {page}")

    def test_refuses_another_marketplace_s_or_release_s_images(self) -> None:
        for plan in (dict(aws_images_plan(), marketplace="azure"), aws_images_plan(version="14.0.65")):
            with self.assertRaises(release_common.ReleaseError):
                aws_catalog.add_version_details(
                    version=VERSION, images_plan=plan, edition=READY_AWS, delivery=self.delivery(), release_notes=""
                )

    def test_refuses_more_than_fifty_images(self) -> None:
        with self.assertRaises(release_common.ReleaseError):
            aws_catalog.add_version_details(
                version=VERSION, images_plan=aws_images_plan(51), edition=READY_AWS, delivery=self.delivery(), release_notes=""
            )

    def test_long_release_notes_are_cut_with_a_link(self) -> None:
        notes = aws_catalog.release_notes_for(VERSION, "x" * 40000)
        self.assertLess(len(notes), aws_catalog.RELEASE_NOTES_LIMIT)
        self.assertTrue(notes.endswith(f"releases/tag/{VERSION}"))

    def test_a_change_needs_the_product(self) -> None:
        with self.assertRaises(release_common.ReleaseError):
            aws_catalog.change("AddDeliveryOptions", "", {})

        self.assertEqual(
            aws_catalog.change("AddRepositories", "prod-abc123", {})["Entity"],
            {"Identifier": "prod-abc123", "Type": "ContainerProduct@1.0"},
        )

    def test_repositories_are_the_chart_s_and_one_per_image(self) -> None:
        names = aws_catalog.repository_names(aws_catalog.load_json(aws_catalog.IMAGES_FILE))
        self.assertEqual(names[0], "oneuptime")
        self.assertIn("app", names)
        self.assertEqual(len(names), len(set(names)))
        details = aws_catalog.add_repositories_details(names + ["app"])
        self.assertEqual(len(details["Repositories"]), len(names))
        self.assertEqual({entry["RepositoryType"] for entry in details["Repositories"]}, {"ECR"})

    def test_change_set_states(self) -> None:
        self.assertEqual(aws_catalog.change_set_state({"Status": "APPLYING"}), ("running", []))
        self.assertEqual(aws_catalog.change_set_state({"Status": "SUCCEEDED"}), ("succeeded", []))
        state, errors = aws_catalog.change_set_state(
            {
                "Status": "FAILED",
                "FailureDescription": "Validation failed",
                "ChangeSet": [{"ErrorDetailList": [{"ErrorCode": "INVALID_HELM_LINT", "ErrorMessage": "lint"}]}],
            }
        )
        self.assertEqual(state, "failed")
        self.assertEqual(errors, ["Validation failed", "INVALID_HELM_LINT: lint"])
        self.assertEqual(aws_catalog.change_set_state({"Status": "CANCELLED"})[0], "cancelled")

    def test_the_versions_a_product_has(self) -> None:
        versions = [{"VersionTitle": "14.0.64", "Id": "a"}, {"VersionTitle": "14.0.65", "Id": "b"}]
        self.assertEqual(aws_catalog.product_versions({"DetailsDocument": {"Versions": versions}}), ["14.0.64", "14.0.65"])
        self.assertEqual(aws_catalog.product_versions({"Details": json.dumps({"Versions": versions})}), ["14.0.64", "14.0.65"])
        # AWS leaves Versions out while the product has none.
        self.assertEqual(aws_catalog.product_versions({"DetailsDocument": {"Description": {}}}), [])

        for bad in ({}, {"DetailsDocument": {"Versions": "14.0.65"}}):
            with self.assertRaises(release_common.ReleaseError):
                aws_catalog.product_versions(bad)

    def test_shipped_says_whether_the_product_has_the_version(self) -> None:
        real = aws_catalog.Catalog
        calls: List[List[str]] = []

        def runner(command: List[str]) -> str:
            calls.append(command)
            return json.dumps({"DetailsDocument": {"Versions": [{"VersionTitle": "14.0.65"}]}})

        def shipped(version: str, editions: Dict[str, Any]) -> Dict[str, Any]:
            return run_cli(
                aws_catalog.main,
                ["shipped", "--version", version],
                load_editions=lambda: editions,
                Catalog=lambda: real(runner),
            )

        has_it = shipped("14.0.65", ready_editions())
        self.assertEqual((has_it["code"], has_it["outputs"]), (0, "shipped=true\n"))
        self.assertIn("has 14.0.65 already", has_it["summary"])
        self.assertEqual(calls[0][2], "describe-entity")
        self.assertEqual(calls[0][calls[0].index("--entity-id") + 1], "prod-abc123")
        self.assertEqual(calls[0][calls[0].index("--catalog") + 1], "AWSMarketplace")

        new = shipped(VERSION, ready_editions())
        self.assertEqual((new["code"], new["outputs"], new["summary"]), (0, "shipped=false\n", ""))

        editions = ready_editions()
        editions["aws"]["productId"] = ""
        calls.clear()
        self.assertEqual(shipped(VERSION, editions)["code"], 1)
        self.assertEqual(calls, [])

    def test_the_catalog_is_called_in_us_east_1_and_followed(self) -> None:
        calls: List[List[str]] = []
        states = iter(["PREPARING", "APPLYING", "SUCCEEDED"])
        sent: List[Any] = []

        def runner(command: List[str]) -> str:
            calls.append(command)

            if command[2] == "start-change-set":
                path = command[command.index("--change-set") + 1].replace("file://", "")
                sent.append(json.loads(Path(path).read_text()))
                return json.dumps({"ChangeSetId": "cs-1"})

            return json.dumps({"Status": next(states)})

        catalog = aws_catalog.Catalog(runner)
        changes = [aws_catalog.change("AddDeliveryOptions", "prod-abc123", {"Version": {}})]
        self.assertEqual(catalog.start(changes, f"OneUptime {VERSION}"), "cs-1")
        self.assertEqual(sent, [changes])
        self.assertEqual(
            aws_catalog.follow(catalog, "cs-1", wait_minutes=10, sleep=lambda seconds: None), ("succeeded", [])
        )

        for command in calls:
            self.assertEqual(command[:2], ["aws", "marketplace-catalog"])
            self.assertEqual(command[command.index("--region") + 1], "us-east-1")

        self.assertIn("AWSMarketplace", calls[0])


def addon_images_plan(count: int = 3, version: str = VERSION) -> Dict[str, Any]:
    return {
        "marketplace": "aws-eks-addon",
        "version": version,
        "images": [
            {"key": f"image{index}", "target": f"{READY_ADDON['registry']}/image{index}:{version}"}
            for index in range(count)
        ],
    }


def addon_product(*versions: Any) -> Dict[str, Any]:
    """The add-on product as DescribeEntity describes it, given (version, visibility) pairs."""
    return {
        "DetailsDocument": {
            "Versions": [
                {
                    "Id": f"version-{title}",
                    "VersionTitle": title,
                    "DeliveryOptions": [
                        {
                            "Id": f"do-{title}",
                            "Type": "EksAddOn",
                            "Visibility": visibility,
                            "AddOnName": "kubernetes-agent",
                        }
                    ],
                }
                for title, visibility in versions
            ]
        }
    }


class FakeCatalog:
    """The AWS CLI's marketplace-catalog commands, answered from a product and its change sets."""

    def __init__(self, product: Dict[str, Any], open_change_sets: Optional[List[Dict[str, Any]]] = None) -> None:
        self.product = product
        self.open = open_change_sets or []
        self.calls: List[List[str]] = []
        self.started: List[Any] = []

    def __call__(self, command: List[str]) -> str:
        self.calls.append(command)
        operation = command[2]

        if operation == "describe-entity":
            return json.dumps(self.product)

        if operation == "list-change-sets":
            return json.dumps({"ChangeSetSummaryList": self.open})

        if operation == "start-change-set":
            path = command[command.index("--change-set") + 1].replace("file://", "")
            self.started.append(json.loads(Path(path).read_text()))
            return json.dumps({"ChangeSetId": "cs-addon"})

        if operation == "describe-change-set":
            return json.dumps({"Status": "SUCCEEDED"})

        raise AssertionError(f"Unexpected call {command}")

    def operations(self) -> List[str]:
        return [command[2] for command in self.calls]


class AwsCatalogEksAddonTest(unittest.TestCase):
    def delivery(self) -> Dict[str, Any]:
        return aws_catalog.load_json(aws_catalog.EKS_ADDON_DELIVERY_OPTION_FILE)

    def details(self, **overrides: Any) -> Dict[str, Any]:
        arguments: Dict[str, Any] = {
            "version": VERSION,
            "images_plan": addon_images_plan(),
            "edition": READY_ADDON,
            "delivery": self.delivery(),
        }
        arguments.update(overrides)
        return aws_catalog.add_addon_version_details(**arguments)

    def cli(self, catalog: FakeCatalog, argv: List[str], editions: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        real = aws_catalog.Catalog
        return run_cli(
            aws_catalog.main,
            argv,
            load_editions=lambda: editions or ready_editions(),
            Catalog=lambda: real(catalog),
            follow=lambda catalog_, change_set_id, wait_minutes: ("succeeded", []),
        )

    def test_a_version_is_one_eks_add_on_delivery_option_for_testing(self) -> None:
        details = self.details()
        self.assertEqual(details["Version"]["VersionTitle"], VERSION)
        self.assertIn(f"releases/tag/{VERSION}", details["Version"]["ReleaseNotes"])
        self.assertIn("Kubernetes agent", details["Version"]["ReleaseNotes"])

        [option] = details["DeliveryOptions"]
        # AWS takes an add-on version as Limited alone, and publishes it for testing first.
        self.assertEqual(option["Visibility"], "Limited")
        self.assertEqual(list(option["Details"]), ["EksAddOnDeliveryOptionDetails"])
        addon = option["Details"]["EksAddOnDeliveryOptionDetails"]
        self.assertEqual(addon["HelmChartUri"], f"{READY_ADDON['registry']}/kubernetes-agent:{VERSION}")
        self.assertEqual(addon["ContainerImages"], [entry["target"] for entry in addon_images_plan()["images"]])
        self.assertEqual(addon["AddOnName"], "kubernetes-agent")
        self.assertEqual(addon["AddOnVersion"], VERSION)
        self.assertEqual(addon["AddOnType"], "monitoring")
        self.assertEqual(addon["Namespace"], "oneuptime-agent")
        self.assertEqual(addon["SupportedArchitectures"], ["amd64", "arm64"])
        self.assertEqual(addon["CompatibleKubernetesVersions"], ["1.34", "1.35", "1.36", "1.37"])
        self.assertEqual(
            addon["EnvironmentOverrideParameters"], [{"Key": "clusterName", "Value": "${AWS_EKS_CLUSTER_NAME}"}]
        )
        # The name buyers type: AWS puts the seller alias before the listing's.
        self.assertIn("--addon-name oneuptime_kubernetes-agent", addon["UsageInstructions"])
        self.assertNotIn("{addOnName}", addon["UsageInstructions"])
        self.assertNotIn("HelmDeliveryOptionDetails", json.dumps(details))

    def test_the_delivery_option_says_what_aws_policy_asks_and_fits_its_limits(self) -> None:
        delivery = self.delivery()
        self.assertLessEqual(len(delivery["title"]), aws_catalog.DELIVERY_OPTION_TITLE_LIMIT)
        self.assertLessEqual(len(delivery["description"]), aws_catalog.DESCRIPTION_LIMIT)
        self.assertLessEqual(len(delivery["usageInstructions"]), aws_catalog.USAGE_INSTRUCTIONS_LIMIT)
        # An add-on to another product says so, and so does a product that needs a connection.
        self.assertIn("extends the functionality of OneUptime", delivery["description"])
        self.assertIn("very limited utility", delivery["description"])
        self.assertIn("ongoing internet connection", delivery["usageInstructions"])
        # Configured with the add-on's values: never Helm, never a key on the command line.
        self.assertNotIn("--set", delivery["usageInstructions"])
        self.assertNotIn("helm ", delivery["usageInstructions"])
        self.assertNotIn("apiKey", delivery["usageInstructions"])

    def test_the_delivery_option_agrees_with_the_add_on_build(self) -> None:
        delivery = self.delivery()
        usage: str = delivery["usageInstructions"]
        self.assertIn(f"--namespace {delivery['namespace']}", usage)
        self.assertIn(f"kubectl create namespace {delivery['namespace']}", usage)
        self.assertIn(build.EKS_ADDON_VALUES["oneuptime.existingSecretName"], usage)
        self.assertIn(build.EKS_ADDON_VALUES["oneuptime.url"], usage)
        self.assertIn("api-key=", usage)

        # Every value EKS fills in is one the agent chart reads.
        chart = build.ValuesEditor((build.AGENT_CHART / "values.yaml").read_text())

        for entry in delivery["environmentOverrideParameters"]:
            chart.get_scalar(entry["Key"].split("."))

        # The configuration values the instructions show are ones the add-on takes.
        schema = build.load_json(build.EKS_ADDON_DIR / "configuration-schema.json")
        properties = schema["properties"]
        self.assertIn("url", properties["oneuptime"]["properties"])
        self.assertIn("existingSecretName", properties["oneuptime"]["properties"])
        self.assertIn("eks-fargate", properties["preset"]["enum"])
        self.assertIn("enabled", properties["ebpf"]["properties"])

    def test_refuses_what_aws_would_refuse(self) -> None:
        delivery = self.delivery()

        for bad in (
            dict(delivery, addOnName="kubernetes_agent"),
            dict(delivery, addOnName="-agent"),
            dict(delivery, addOnType="apm"),
            dict(delivery, namespace="OneUptime_Agent"),
            dict(delivery, compatibleKubernetesVersions=[]),
            dict(delivery, compatibleKubernetesVersions=["1.35", "1.35"]),
            dict(delivery, compatibleKubernetesVersions=["v1.35"]),
            dict(delivery, supportedArchitectures=["amd64"]),
            dict(delivery, supportedArchitectures=["amd64", "arm64", "s390x"]),
            dict(delivery, environmentOverrideParameters=[{"Key": "clusterName", "Value": "${CLUSTER}"}]),
            dict(delivery, environmentOverrideParameters=[{"Key": "a", "Value": "${AWS_REGION}"}] * 2),
            dict(delivery, title="x" * 73),
            dict(delivery, description="y" * 1001),
            dict(delivery, description=" starts with a space"),
            dict(delivery, usageInstructions="z" * 4001),
        ):
            with self.assertRaises(release_common.ReleaseError):
                self.details(delivery=bad)

        for plan in (
            dict(addon_images_plan(), marketplace="aws"),
            addon_images_plan(version="14.0.65"),
            addon_images_plan(count=51),
            addon_images_plan(count=0),
        ):
            with self.assertRaises(release_common.ReleaseError):
                self.details(images_plan=plan)

        with self.assertRaises(release_common.ReleaseError):
            self.details(edition=dict(READY_ADDON, sellerAlias=""))

    def test_the_cli_plans_the_add_on_version_for_its_own_product(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            images = Path(directory) / "images.json"
            images.write_text(json.dumps(addon_images_plan()))
            out = Path(directory) / "change-set.json"
            result = self.cli(
                FakeCatalog(addon_product()),
                ["plan", "--edition", "aws-eks-addon", "--images-json", str(images), "--version", VERSION, "--out", str(out)],
            )
            self.assertEqual(result["code"], 0)
            [entry] = json.loads(out.read_text())

        self.assertEqual(entry["ChangeType"], "AddDeliveryOptions")
        self.assertEqual(entry["Entity"], {"Identifier": "prod-addon456", "Type": "ContainerProduct@1.0"})
        self.assertTrue(aws_catalog.is_addon_change_set([entry]))
        self.assertFalse(
            aws_catalog.is_addon_change_set(
                [
                    aws_catalog.change(
                        "AddDeliveryOptions",
                        "prod-abc123",
                        aws_catalog.add_version_details(
                            version=VERSION,
                            images_plan=aws_images_plan(),
                            edition=READY_AWS,
                            delivery=aws_catalog.load_json(aws_catalog.DELIVERY_OPTION_FILE),
                            release_notes="",
                        ),
                    )
                ]
            )
        )

    def test_shipped_asks_the_add_on_product(self) -> None:
        catalog = FakeCatalog(addon_product(("14.0.60", "Public"), (VERSION, "Limited")))
        has_it = self.cli(catalog, ["shipped", "--edition", "aws-eks-addon", "--version", VERSION, "--wait-while-testing"])
        self.assertEqual((has_it["code"], has_it["outputs"]), (0, "shipped=true\n"))
        self.assertIn(f"has {VERSION} already as a version of the EKS add-on", has_it["summary"])
        describe = catalog.calls[0]
        self.assertEqual(describe[describe.index("--entity-id") + 1], "prod-addon456")

    def test_the_weekly_run_waits_while_a_version_is_in_testing(self) -> None:
        catalog = FakeCatalog(addon_product(("14.0.60", "Public"), ("14.0.65", "Limited")))
        waits = self.cli(catalog, ["shipped", "--edition", "aws-eks-addon", "--version", VERSION, "--wait-while-testing"])
        self.assertEqual((waits["code"], waits["outputs"]), (0, "shipped=true\n"))
        self.assertIn("version 14.0.65 is in testing (Limited)", waits["summary"])
        self.assertIn("go-public --version 14.0.65", waits["summary"])
        self.assertIn(f"Run the workflow by hand to add {VERSION} anyway", waits["summary"])

        # By hand, it ships whatever is in testing.
        by_hand = self.cli(FakeCatalog(addon_product(("14.0.65", "Limited"))), ["shipped", "--edition", "aws-eks-addon", "--version", VERSION])
        self.assertEqual((by_hand["code"], by_hand["outputs"], by_hand["summary"]), (0, "shipped=false\n", ""))

    def test_the_weekly_run_waits_while_aws_is_still_publishing_a_version(self) -> None:
        catalog = FakeCatalog(
            addon_product(("14.0.60", "Public")),
            open_change_sets=[{"ChangeSetId": "cs-1", "ChangeSetName": "OneUptime Kubernetes agent 14.0.65", "Status": "APPLYING"}],
        )
        waits = self.cli(catalog, ["shipped", "--edition", "aws-eks-addon", "--version", VERSION, "--wait-while-testing"])
        self.assertEqual(waits["outputs"], "shipped=true\n")
        self.assertIn('still applying the change set "OneUptime Kubernetes agent 14.0.65" (`cs-1`)', waits["summary"])

        listing = catalog.calls[catalog.operations().index("list-change-sets")]
        filters = json.loads(listing[listing.index("--filter-list") + 1])
        self.assertEqual(
            filters,
            [
                {"Name": "EntityId", "ValueList": ["prod-addon456"]},
                {"Name": "Status", "ValueList": ["PREPARING", "APPLYING"]},
            ],
        )

    def test_the_weekly_run_adds_a_version_once_the_last_one_is_public(self) -> None:
        catalog = FakeCatalog(addon_product(("14.0.60", "Public"), ("14.0.65", "Public")))
        ships = self.cli(catalog, ["shipped", "--edition", "aws-eks-addon", "--version", VERSION, "--wait-while-testing"])
        self.assertEqual((ships["code"], ships["outputs"], ships["summary"]), (0, "shipped=false\n", ""))

        # Enterprise versions are public once applied: its weekly check asks nothing more.
        enterprise = FakeCatalog({"DetailsDocument": {"Versions": []}})
        self.cli(enterprise, ["shipped", "--version", VERSION])
        self.assertEqual(enterprise.operations(), ["describe-entity"])

    def test_shipped_needs_the_add_on_product(self) -> None:
        editions = ready_editions()
        editions["aws-eks-addon"]["productId"] = ""
        catalog = FakeCatalog(addon_product())
        result = self.cli(catalog, ["shipped", "--edition", "aws-eks-addon", "--version", VERSION], editions)
        self.assertEqual(result["code"], 1)
        self.assertEqual(catalog.calls, [])

    def test_go_public_makes_the_tested_version_public(self) -> None:
        catalog = FakeCatalog(addon_product(("14.0.60", "Public"), (VERSION, "Limited")))
        result = self.cli(catalog, ["go-public", "--version", VERSION])
        self.assertEqual(result["code"], 0)
        self.assertEqual(
            catalog.started,
            [
                [
                    {
                        "ChangeType": "UpdateDeliveryOptionsVisibility",
                        "Entity": {"Identifier": "prod-addon456", "Type": "ContainerProduct@1.0"},
                        "DetailsDocument": {"DeliveryOptions": [{"Id": f"do-{VERSION}", "TargetVisibility": "Public"}]},
                    }
                ]
            ],
        )

        public = FakeCatalog(addon_product((VERSION, "Public")))
        self.assertEqual(self.cli(public, ["go-public", "--version", VERSION])["code"], 0)
        self.assertEqual(public.started, [])

        missing = FakeCatalog(addon_product(("14.0.60", "Public")))
        self.assertEqual(self.cli(missing, ["go-public", "--version", VERSION])["code"], 1)
        self.assertEqual(missing.started, [])

    def test_submitting_an_add_on_version_says_how_to_test_it(self) -> None:
        change = aws_catalog.change("AddDeliveryOptions", "prod-addon456", self.details())

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "change-set.json"
            path.write_text(json.dumps([change]))
            catalog = FakeCatalog(addon_product())
            result = self.cli(catalog, ["submit", "--change-set", str(path), "--name", f"OneUptime Kubernetes agent {VERSION}"])

        self.assertEqual(result["code"], 0)
        self.assertIn("ap-northeast-2", result["summary"])
        self.assertIn("`oneuptime_kubernetes-agent`", result["summary"])

        for kubernetes_version in self.delivery()["compatibleKubernetesVersions"]:
            self.assertIn(kubernetes_version, result["summary"])

        self.assertIn(f"go-public --version {VERSION}", result["summary"])

    def test_the_add_on_repositories_are_its_chart_s_and_one_per_image(self) -> None:
        names = aws_catalog.repository_names(
            aws_catalog.load_json(aws_catalog.EKS_ADDON_IMAGES_FILE), aws_catalog.EKS_ADDON_CHART_REPOSITORY
        )
        self.assertEqual(names[0], "kubernetes-agent")
        self.assertIn("kubernetes-ai-agent", names)
        self.assertEqual(len(names), len(set(names)))

        catalog = FakeCatalog(addon_product())
        result = self.cli(catalog, ["add-repositories", "--edition", "aws-eks-addon"])
        self.assertEqual(result["code"], 0)
        [[entry]] = catalog.started
        self.assertEqual(entry["ChangeType"], "AddRepositories")
        self.assertEqual(entry["Entity"]["Identifier"], "prod-addon456")
        self.assertEqual([repository["RepositoryName"] for repository in entry["DetailsDocument"]["Repositories"]], names)

    def test_the_real_edition_is_not_ready_until_its_product_exists(self) -> None:
        edition = release_common.load_editions()["aws-eks-addon"]
        self.assertEqual(edition["registry"], release_common.load_editions()["aws"]["registry"])

        if not edition["productId"]:
            self.assertFalse(edition["ready"])


class ReleasePlanEksAddonTest(unittest.TestCase):
    def plan(self, **overrides: Any) -> Dict[str, Any]:
        arguments: Dict[str, Any] = {
            "event": "schedule",
            "action": "release",
            "version": VERSION,
            "released": True,
            "marketplaces_input": "",
            "dry_run_input": "",
            "variables": dict(ALL_VARIABLES),
            "editions": ready_editions(),
        }
        arguments.update(overrides)
        return release_plan.make_plan(**arguments)

    def test_the_weekly_run_says_it_waits_for_a_version_in_testing(self) -> None:
        summary = release_plan.summary_of(self.plan())
        self.assertIn(
            "| aws-eks-addon | adds it for testing, once approved, unless it has it already, "
            "or a version of it is still being published or tested |",
            summary,
        )
        by_hand = release_plan.summary_of(
            self.plan(event="workflow_dispatch", dry_run_input="false", marketplaces_input="aws-eks-addon")
        )
        self.assertIn("| aws-eks-addon | adds it for testing, once approved, unless it has it already |", by_hand)

    def test_the_weekly_run_skips_the_add_on_until_it_is_set_up(self) -> None:
        editions = ready_editions()
        editions["aws-eks-addon"] = {"ready": False, "registry": READY_ADDON["registry"], "productId": "", "sellerAlias": "oneuptime"}
        plan = self.plan(editions=editions)
        self.assertFalse(plan["runs"]["aws-eks-addon"])
        self.assertTrue(plan["runs"]["aws"])
        self.assertIn("productId", " ".join(plan["skipped"]["aws-eks-addon"]))

    def test_the_add_on_signs_in_with_the_aws_role(self) -> None:
        self.assertEqual(release_plan.REQUIRED_VARIABLES["aws-eks-addon"], ("MARKETPLACE_RELEASE_AWS_ROLE_ARN",))
        self.assertEqual(release_plan.outputs_of(self.plan())["aws_eks_addon"], "true")


class FakeResponse(io.BytesIO):
    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()


class FakePartnerCenter:
    """Answers the Product Ingestion API's requests from a table, and keeps them."""

    def __init__(self, answers: Dict[str, Any]) -> None:
        self.answers: Dict[str, Any] = answers
        self.requests: List[Dict[str, Any]] = []

    def __call__(self, request: Any) -> FakeResponse:
        path = request.full_url.split("/product-ingestion/", 1)[1]
        body = json.loads(request.data.decode("utf-8")) if request.data else None
        self.requests.append(
            {"method": request.get_method(), "path": path, "body": body, "headers": dict(request.header_items())}
        )

        for prefix, answer in self.answers.items():
            if path.startswith(prefix):
                if isinstance(answer, Exception):
                    raise answer
                return FakeResponse(json.dumps(answer).encode("utf-8"))

        raise AssertionError(f"unexpected request {path}")


PRODUCT = "product/1111"
PLAN = "plan/1111/2222"
TREE = {
    "resources": [
        {"$schema": f"{partner_center.SCHEMA}/product/2022-03-01-preview3", "id": PRODUCT},
        {
            "$schema": f"{partner_center.SCHEMA}/plan/2022-03-01-preview2",
            "id": PLAN,
            "identity": {"externalId": "enterprise"},
        },
        {
            "$schema": f"{partner_center.SCHEMA}/container-plan-technical-configuration/2022-03-01-preview4",
            "id": "container-plan-technical-configuration/1111/2222",
            "product": PRODUCT,
            "plan": PLAN,
            "payloadType": "cnab",
            "clusterExtensionType": "HackerBay.OneUptimeEnterprise",
            "cnabReferences": [{"tag": "14.0.65"}],
        },
    ]
}


class PartnerCenterTest(unittest.TestCase):
    def reference(self) -> Dict[str, str]:
        return partner_center.cnab_reference(
            READY_AZURE, tenant_id="tenant", subscription_id="subscription", tag=VERSION, digest="sha256:abc"
        )

    def test_the_bundle_reference(self) -> None:
        self.assertEqual(
            self.reference(),
            {
                "tenantId": "tenant",
                "subscriptionId": "subscription",
                "resourceGroupName": "oneuptime-marketplace",
                "registryName": "oneuptimemarketplace",
                "repositoryName": "com.oneuptime.enterprise",
                "tag": VERSION,
                "digest": "sha256:abc",
            },
        )

        # Exactly the properties Microsoft's schema allows on a bundle reference
        # (container-plan-technical-configuration/2022-03-01-preview3: all required, no others).
        self.assertEqual(
            sorted(self.reference()),
            sorted(["tenantId", "subscriptionId", "resourceGroupName", "registryName", "repositoryName", "tag", "digest"]),
        )

        for bad in ({"digest": "abc"}, {"tag": "latest"}, {"tenant_id": ""}):
            arguments = dict(tenant_id="tenant", subscription_id="subscription", tag=VERSION, digest="sha256:abc")
            arguments.update(bad)
            with self.assertRaises(release_common.ReleaseError):
                partner_center.cnab_reference(READY_AZURE, **arguments)

    def test_the_plan_s_technical_configuration_keeps_what_partner_center_has(self) -> None:
        existing = partner_center.find_technical_configuration(TREE["resources"], PLAN)
        updated = partner_center.technical_configuration(
            existing,
            product_id=PRODUCT,
            plan_id=PLAN,
            cluster_extension_type="HackerBay.OneUptimeEnterprise",
            reference=self.reference(),
        )
        self.assertEqual(updated["$schema"], existing["$schema"])
        self.assertEqual(updated["id"], existing["id"])
        self.assertEqual(updated["cnabReferences"], [self.reference()])
        self.assertEqual(existing["cnabReferences"], [{"tag": "14.0.65"}])

    def test_a_new_technical_configuration(self) -> None:
        created = partner_center.technical_configuration(
            None, product_id=PRODUCT, plan_id=PLAN, cluster_extension_type="HackerBay.OneUptimeEnterprise", reference=self.reference()
        )
        self.assertEqual(created["$schema"], partner_center.TECHNICAL_CONFIGURATION_SCHEMA)
        self.assertEqual((created["product"], created["plan"], created["payloadType"]), (PRODUCT, PLAN, "cnab"))

    def test_the_cluster_extension_type_never_changes(self) -> None:
        existing = dict(partner_center.find_technical_configuration(TREE["resources"], PLAN), clusterExtensionType="Other.Name")

        with self.assertRaises(release_common.ReleaseError):
            partner_center.technical_configuration(
                existing, product_id=PRODUCT, plan_id=PLAN, cluster_extension_type="HackerBay.OneUptimeEnterprise", reference=self.reference()
            )

    def test_the_bundle_tags_the_plan_names(self) -> None:
        self.assertEqual(partner_center.configured_tags(TREE["resources"], "enterprise"), ["14.0.65"])
        self.assertEqual(partner_center.configured_tags(TREE["resources"], "gold"), [])
        self.assertEqual(partner_center.configured_tags(TREE["resources"][:2], "enterprise"), [])
        self.assertEqual(partner_center.configured_tags([], "enterprise"), [])

    def test_an_offer_never_published_to_preview_has_nothing_there(self) -> None:
        def not_found() -> urllib.error.HTTPError:
            return urllib.error.HTTPError(
                "https://graph.microsoft.com/rp/product-ingestion/resource-tree", 404, "Not Found", {}, io.BytesIO(b"{}")
            )

        fake = FakePartnerCenter({"resource-tree/": not_found()})
        self.assertEqual(partner_center.PartnerCenter("the-token", opener=fake).resource_tree(PRODUCT, "preview"), [])
        self.assertIn("targetType=preview", fake.requests[0]["path"])

        # What Partner Center really answers for a new offer (2026-10-18): 400, not 404.
        never = urllib.error.HTTPError(
            "https://graph.microsoft.com/rp/product-ingestion/resource-tree", 400, "Bad Request", {},
            io.BytesIO(
                b'{"error":{"code":"badRequest","message":"Publisher 92156140 Product 1111 has no published '
                b'submission in Preview.","details":[]}}'
            ),
        )
        center = partner_center.PartnerCenter("the-token", opener=FakePartnerCenter({"resource-tree/": never}))
        self.assertEqual(center.resource_tree(PRODUCT, "preview"), [])

        # Any other 400 is an error.
        other = urllib.error.HTTPError(
            "https://graph.microsoft.com/rp/product-ingestion/resource-tree", 400, "Bad Request", {},
            io.BytesIO(b'{"error":{"code":"badRequest","message":"The Version query parameter is not valid."}}'),
        )
        with self.assertRaises(release_common.ReleaseError):
            partner_center.PartnerCenter("the-token", opener=FakePartnerCenter({"resource-tree/": other})).resource_tree(
                PRODUCT, "preview"
            )

        # The draft is always there: a 404 for it is an error.
        with self.assertRaises(release_common.ReleaseError):
            partner_center.PartnerCenter("the-token", opener=FakePartnerCenter({"resource-tree/": not_found()})).resource_tree(PRODUCT)

    def test_reads_ids_as_partner_center_spells_them(self) -> None:
        # The schemas, and the API's answers, say externalId and jobId; Microsoft's examples say
        # externalID and jobID.
        self.assertEqual(partner_center.external_id({"identity": {"externalId": "enterprise"}}), "enterprise")
        self.assertEqual(partner_center.external_id({"identity": {"externalID": "enterprise"}}), "enterprise")
        self.assertEqual(partner_center.external_id({}), "")

        for job in ({"jobId": "job-1"}, {"jobID": "job-1"}):
            fake = FakePartnerCenter(
                {"configure/job-1/status": {"jobId": "job-1", "jobStatus": "completed", "jobResult": "succeeded"}}
            )
            center = partner_center.PartnerCenter("the-token", opener=fake)
            self.assertEqual(
                partner_center.follow(center, job, wait_minutes=1, sleep=lambda seconds: None), ("succeeded", [], "job-1")
            )

    def test_shipped_asks_the_offer_s_preview(self) -> None:
        real = partner_center.PartnerCenter

        def shipped(tag: str) -> Any:
            fake = FakePartnerCenter({"product?": {"value": [{"id": PRODUCT}]}, "resource-tree/": TREE})
            result = run_cli(
                partner_center.main,
                ["shipped", "--tag", tag],
                environment={"PARTNER_CENTER_TOKEN": "the-token"},
                load_editions=ready_editions,
                PartnerCenter=lambda token: real(token, opener=fake),
            )
            return result, fake

        has_it, fake = shipped("14.0.65")
        self.assertEqual((has_it["code"], has_it["outputs"]), (0, "shipped=true\n"))
        self.assertIn("preview has bundle 14.0.65 already", has_it["summary"])
        self.assertTrue(fake.requests[1]["path"].startswith(f"resource-tree/{PRODUCT}?targetType=preview&"))
        self.assertEqual([request["method"] for request in fake.requests], ["GET", "GET"])

        new, _ = shipped(VERSION)
        self.assertEqual((new["code"], new["outputs"], new["summary"]), (0, "shipped=false\n", ""))
        self.assertEqual(shipped("latest")[0]["code"], 1)

    def test_finds_the_plan_by_its_id(self) -> None:
        self.assertEqual(partner_center.find_plan(TREE["resources"], "enterprise"), PLAN)

        with self.assertRaises(release_common.ReleaseError):
            partner_center.find_plan(TREE["resources"], "gold")

    def test_submissions(self) -> None:
        self.assertEqual(
            partner_center.submission(PRODUCT, "preview"),
            {"$schema": partner_center.SUBMISSION_SCHEMA, "product": PRODUCT, "target": {"targetType": "preview"}},
        )
        self.assertEqual(partner_center.submission(PRODUCT, "live", "submission/1111/9")["id"], "submission/1111/9")

        newest = partner_center.newest_succeeded(
            [
                {"id": "a", "target": {"targetType": "preview"}, "status": "completed", "result": "succeeded", "created": "2026-10-01"},
                {"id": "b", "target": {"targetType": "preview"}, "status": "completed", "result": "succeeded", "created": "2026-10-09"},
                {"id": "c", "target": {"targetType": "preview"}, "status": "completed", "result": "failed", "created": "2026-10-10"},
                {"id": "d", "target": {"targetType": "live"}, "status": "completed", "result": "succeeded", "created": "2026-10-11"},
            ],
            "preview",
        )
        self.assertEqual(newest["id"], "b")
        self.assertIsNone(partner_center.newest_succeeded([], "preview"))

    def test_job_states(self) -> None:
        self.assertEqual(partner_center.job_state({"jobStatus": "running", "jobResult": "pending"}), ("running", []))
        self.assertEqual(partner_center.job_state({"jobStatus": "completed", "jobResult": "succeeded"}), ("succeeded", []))
        state, errors = partner_center.job_state(
            {
                "jobStatus": "completed",
                "jobResult": "failed",
                "errors": [{"code": "invalidResource", "message": "Bad bundle", "details": [{"message": "no such tag"}]}],
            }
        )
        self.assertEqual(state, "failed")
        self.assertEqual(errors, ["invalidResource: Bad bundle (no such tag)"])

    def test_requests_sign_in_and_name_the_api_version(self) -> None:
        fake = FakePartnerCenter(
            {
                "product?": {"value": [{"id": PRODUCT}]},
                "resource-tree/": TREE,
                "configure/job-1/status": {"jobId": "job-1", "jobStatus": "completed", "jobResult": "succeeded"},
                "configure": {"jobId": "job-1", "jobStatus": "notStarted", "jobResult": "pending"},
            }
        )
        center = partner_center.PartnerCenter("the-token", opener=fake)
        self.assertEqual(center.product_id("oneuptime-enterprise"), PRODUCT)
        resources = center.resource_tree(PRODUCT)
        job = center.configure([partner_center.submission(PRODUCT, "preview")])
        state = partner_center.follow(center, job, wait_minutes=5, sleep=lambda seconds: None)
        self.assertEqual(state, ("succeeded", [], "job-1"))
        self.assertEqual(len(resources), 3)

        self.assertEqual(fake.requests[0]["path"], "product?externalID=oneuptime-enterprise&$version=2022-03-01-preview3")
        self.assertTrue(fake.requests[1]["path"].startswith(f"resource-tree/{PRODUCT}?$version="))
        configure = fake.requests[2]
        self.assertEqual(configure["method"], "POST")
        self.assertEqual(configure["path"], "configure?$version=2022-03-01-preview2")
        self.assertEqual(configure["body"]["$schema"], partner_center.CONFIGURE_SCHEMA)

        for request in fake.requests:
            self.assertEqual(request["headers"].get("Authorization"), "Bearer the-token")

    def test_an_error_names_the_request_but_never_the_token(self) -> None:
        error = urllib.error.HTTPError(
            "https://graph.microsoft.com/rp/product-ingestion/product", 401, "Unauthorized", {}, io.BytesIO(b'{"error":"no access"}')
        )
        center = partner_center.PartnerCenter("secret-token", opener=FakePartnerCenter({"product?": error}))

        with self.assertRaises(release_common.ReleaseError) as raised:
            center.product_id("oneuptime-enterprise")

        self.assertIn("401", str(raised.exception))
        self.assertNotIn("secret-token", str(raised.exception))

    def test_needs_a_token(self) -> None:
        with self.assertRaises(release_common.ReleaseError):
            partner_center.PartnerCenter("")


class GoogleCloudReleaseTest(unittest.TestCase):
    def test_says_what_to_add_in_producer_portal(self) -> None:
        steps = google_cloud_release.producer_portal_steps(READY_GOOGLE, VERSION, "sha256:abc")
        self.assertIn(f"`{READY_GOOGLE['registry']}/deployer:{VERSION}` (digest `sha256:abc`)", steps)
        self.assertIn("`14.0` track", steps)
        self.assertIn("Submit it for review", steps)
        # Google's review tests the version: nothing here asks for a cluster of our own.
        self.assertNotIn("mpdev", steps)

        with self.assertRaises(release_common.ReleaseError):
            google_cloud_release.producer_portal_steps(READY_GOOGLE, VERSION, "abc")


def bash_syntax_problems(script: str) -> str:
    result = subprocess.run(["bash", "-n"], input=script, capture_output=True, text=True, check=False)
    return result.stderr


class CiSetupTest(unittest.TestCase):
    def test_the_aws_role_trusts_only_the_workflow_s_environments(self) -> None:
        trust = ci_setup.aws_trust_policy()
        condition = trust["Statement"][0]["Condition"]["StringEquals"]
        self.assertEqual(condition["token.actions.githubusercontent.com:aud"], "sts.amazonaws.com")
        self.assertEqual(
            condition["token.actions.githubusercontent.com:sub"],
            [
                "repo:OneUptime/oneuptime:environment:marketplace-push",
                "repo:OneUptime/oneuptime:environment:marketplace-publish",
            ],
        )

    def test_the_aws_role_can_push_to_this_product_and_add_versions_only(self) -> None:
        policy = ci_setup.aws_permissions_policy(READY_AWS)
        statements = {statement["Sid"]: statement for statement in policy["Statement"]}
        self.assertEqual(
            statements["PushToTheProductRepositories"]["Resource"],
            "arn:aws:ecr:us-east-1:709825985650:repository/hackerbay/*",
        )
        self.assertEqual(
            statements["AddVersionsOnly"]["Condition"], {"StringEquals": {"catalog:ChangeType": ["AddDeliveryOptions"]}}
        )
        self.assertIn("ContainerProduct/prod-abc123", statements["AddVersionsOnly"]["Resource"][0])

        for statement in policy["Statement"]:
            actions = statement["Action"] if isinstance(statement["Action"], list) else [statement["Action"]]

            for action in actions:
                self.assertNotIn("*", action)

    def test_the_aws_role_adds_add_on_versions_once_the_add_on_product_exists(self) -> None:
        unchanged = ci_setup.aws_permissions_policy(READY_AWS, dict(READY_ADDON, productId=""))
        self.assertEqual(unchanged, ci_setup.aws_permissions_policy(READY_AWS))
        self.assertNotIn("ListChangeSets", json.dumps(unchanged))

        policy = ci_setup.aws_permissions_policy(READY_AWS, READY_ADDON)
        statements = {statement["Sid"]: statement for statement in policy["Statement"]}

        for sid in ("AddVersionsOnly", "FollowTheChanges"):
            resources = " ".join(statements[sid]["Resource"])
            self.assertIn("ContainerProduct/prod-abc123", resources)
            self.assertIn("ContainerProduct/prod-addon456", resources)

        self.assertEqual(
            statements["AddVersionsOnly"]["Condition"], {"StringEquals": {"catalog:ChangeType": ["AddDeliveryOptions"]}}
        )
        # Both products' repositories are under the seller's one prefix.
        self.assertEqual(
            statements["PushToTheProductRepositories"]["Resource"],
            "arn:aws:ecr:us-east-1:709825985650:repository/hackerbay/*",
        )
        self.assertEqual(statements["SeeTheAddOnVersionsOnTheirWay"]["Action"], "aws-marketplace:ListChangeSets")
        # Making a version public stays the maintainer's.
        self.assertNotIn("UpdateDeliveryOptionsVisibility", json.dumps(policy))

        elsewhere = ci_setup.aws_permissions_policy(
            READY_AWS, dict(READY_ADDON, registry="709825985650.dkr.ecr.us-east-1.amazonaws.com/other")
        )
        push = [statement for statement in elsewhere["Statement"] if statement["Sid"] == "PushToTheProductRepositories"]
        self.assertEqual(
            push[0]["Resource"],
            [
                "arn:aws:ecr:us-east-1:709825985650:repository/hackerbay/*",
                "arn:aws:ecr:us-east-1:709825985650:repository/other/*",
            ],
        )

        script = ci_setup.aws_script(READY_AWS, READY_ADDON)
        self.assertEqual(bash_syntax_problems(script), "")
        self.assertIn("ContainerProduct/prod-addon456", script)

    def test_the_aws_role_needs_the_product_and_its_registry(self) -> None:
        for bad in ({"productId": ""}, {"registry": "123456789012.dkr.ecr.us-east-1.amazonaws.com/x"}, {"registry": "709825985650.dkr.ecr.us-east-1.amazonaws.com"}):
            with self.assertRaises(release_common.ReleaseError):
                ci_setup.aws_permissions_policy(dict(READY_AWS, **bad))

    def test_the_azure_registry_is_basic_and_keeps_the_newest_releases(self) -> None:
        script = ci_setup.azure_registry_script(READY_AZURE, "eastus")
        self.assertIn("--sku Basic", script)
        self.assertNotIn("Standard", script)
        purge = ci_setup.azure_purge_command(READY_AZURE)
        self.assertIn(r"--filter 'com\.oneuptime\.enterprise:.*'", purge)
        self.assertIn("--filter 'oneuptime/.*:.*'", purge)
        # The newest release only, but never one from the last 7 days: Microsoft copies a release
        # while it certifies it (up to 2 business days), and serves buyers from its own copy.
        self.assertIn("--keep 1 ", purge)
        self.assertIn("--ago 7d ", purge)
        self.assertIn("--untagged", purge)

    def test_the_azure_purge_runs_daily_and_a_changed_rule_takes_effect(self) -> None:
        script = ci_setup.azure_registry_script(READY_AZURE, "eastus")
        self.assertIn('--schedule "0 3 * * *"', script)
        delete = script.index("az acr task delete --registry oneuptimemarketplace --name purge-old-releases --yes")
        create = script.index("az acr task create --registry oneuptimemarketplace --name purge-old-releases")
        self.assertLess(delete, create)
        self.assertNotIn("if ! az acr task show", script)

    def test_the_google_repository_keeps_the_newest_releases(self) -> None:
        policies = {policy["name"]: policy for policy in ci_setup.google_cleanup_policy()}
        self.assertEqual(policies["keep-the-newest-releases"]["mostRecentVersions"], {"keepCount": 3})
        self.assertEqual(policies["delete-older-releases"]["condition"], {"olderThan": "1d"})
        self.assertEqual(policies["keep-the-newest-releases"]["action"], {"type": "Keep"})
        self.assertIn("--no-dry-run", ci_setup.google_script())
        self.assertIn(
            """--attribute-condition='assertion.repository == "OneUptime/oneuptime" """
            """&& assertion.environment.startsWith("marketplace-")'""",
            ci_setup.google_script(),
        )

    def test_github_needs_a_reviewer_and_takes_only_known_variables(self) -> None:
        with self.assertRaises(release_common.ReleaseError):
            ci_setup.github_script([], {}, False)

        with self.assertRaises(release_common.ReleaseError):
            ci_setup.github_script(["bad login"], {}, False)

        for bad in (["SOMETHING=1"], ["MARKETPLACE_RELEASE_AWS_ROLE_ARN"], ["MARKETPLACE_RELEASE_AWS_ROLE_ARN=a\nb"]):
            with self.assertRaises(release_common.ReleaseError):
                ci_setup.parse_settings(bad)

    def test_values_reach_the_script_quoted(self) -> None:
        script = ci_setup.github_script(
            ["nawazdhandala"], ci_setup.parse_settings(["MARKETPLACE_RELEASE_AWS_ROLE_ARN=$(touch pwned)"]), True
        )
        self.assertIn("--body '$(touch pwned)'", script)
        self.assertIn("gh variable set MARKETPLACE_RELEASES --repo OneUptime/oneuptime --body enabled", script)
        self.assertIn("gh api users/nawazdhandala --jq .id", script)

    def test_every_script_is_valid_bash(self) -> None:
        scripts = {
            "aws": ci_setup.aws_script(READY_AWS),
            "azure-registry": ci_setup.azure_registry_script(READY_AZURE, "eastus"),
            "azure": ci_setup.azure_script(READY_AZURE),
            "google": ci_setup.google_script(),
            "github": ci_setup.github_script(["nawazdhandala", "simlarsen"], {}, False),
        }

        for name, script in scripts.items():
            self.assertEqual(bash_syntax_problems(script), "", name)
            self.assertTrue(script.startswith("set -euo pipefail\n"), name)

    def test_the_policies_in_the_aws_script_are_json(self) -> None:
        script = ci_setup.aws_script(READY_AWS)
        blocks = script.split('<<JSON\n')[1:]

        for block in blocks:
            document = block.split("\nJSON\n", 1)[0].replace("${ACCOUNT_ID}", "176820170339")
            json.loads(document)

        self.assertEqual(len(blocks), 2)


if __name__ == "__main__":
    unittest.main()
