"""
Unit tests of the marketplace release automation: what a run does (release_plan), the AWS
change sets (aws_catalog), the Partner Center requests (partner_center), the Google steps
(google_cloud_release) and the one-time setup scripts (ci_setup). Nothing here calls a cloud:
the CLIs and the HTTP API are fakes.

    python3 -m unittest discover -s HelmChart/Marketplace -p 'test_*.py'
"""

import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from typing import Any, Dict, List, Optional

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import aws_catalog  # noqa: E402
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
ALL_VARIABLES = {name: "set" for names in release_plan.REQUIRED_VARIABLES.values() for name in names}


def ready_editions() -> Dict[str, Any]:
    return {"aws": dict(READY_AWS), "azure": dict(READY_AZURE), "google-cloud": dict(READY_GOOGLE)}


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
        self.assertEqual(release_common.parse_marketplaces(""), ["aws", "azure", "google-cloud"])
        self.assertEqual(release_common.parse_marketplaces("all"), ["aws", "azure", "google-cloud"])
        self.assertEqual(release_common.parse_marketplaces("google-cloud, aws"), ["aws", "google-cloud"])

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
            "version_input": "",
            "version_file": VERSION,
            "marketplaces_input": "",
            "dry_run_input": "",
            "variables": dict(ALL_VARIABLES),
            "editions": ready_editions(),
        }
        arguments.update(overrides)
        return release_plan.make_plan(**arguments)

    def test_after_a_release_it_releases_every_ready_marketplace_for_real(self) -> None:
        plan = self.plan(event="workflow_run", dry_run_input="true")
        self.assertFalse(plan["dry_run"])
        self.assertEqual(plan["runs"], {"aws": True, "azure": True, "google-cloud": True})
        self.assertEqual(plan["version"], VERSION)

    def test_after_a_release_it_skips_a_marketplace_that_is_not_set_up(self) -> None:
        editions = ready_editions()
        editions["azure"]["ready"] = False
        variables = dict(ALL_VARIABLES)
        del variables["MARKETPLACE_RELEASE_GOOGLE_SERVICE_ACCOUNT"]

        plan = self.plan(event="workflow_run", editions=editions, variables=variables)
        self.assertEqual(plan["runs"], {"aws": True, "azure": False, "google-cloud": False})
        self.assertIn("ready", " ".join(plan["skipped"]["azure"]))
        self.assertIn("MARKETPLACE_RELEASE_GOOGLE_SERVICE_ACCOUNT", " ".join(plan["skipped"]["google-cloud"]))

    def test_by_hand_it_is_a_dry_run_unless_asked_otherwise(self) -> None:
        editions = {name: {"ready": False} for name in release_common.MARKETPLACES}
        plan = self.plan(editions=editions, variables={})
        self.assertTrue(plan["dry_run"])
        self.assertEqual(plan["runs"], {"aws": True, "azure": True, "google-cloud": True})

    def test_by_hand_a_real_run_on_a_marketplace_not_set_up_fails(self) -> None:
        editions = ready_editions()
        editions["aws"]["productId"] = ""

        with self.assertRaises(release_common.ReleaseError) as raised:
            self.plan(dry_run_input="false", marketplaces_input="aws", editions=editions)

        self.assertIn("productId", str(raised.exception))

    def test_by_hand_it_releases_only_the_marketplaces_named(self) -> None:
        plan = self.plan(dry_run_input="false", marketplaces_input="azure")
        self.assertEqual(plan["runs"], {"aws": False, "azure": True, "google-cloud": False})

    def test_the_version_asked_for_wins_over_the_version_file(self) -> None:
        self.assertEqual(self.plan(version_input="14.0.60")["version"], "14.0.60")

        with self.assertRaises(release_common.ReleaseError):
            self.plan(version_input="latest")

    def test_azure_go_live_is_azure_only_and_never_a_dry_run(self) -> None:
        plan = self.plan(action="azure-go-live", dry_run_input="true", marketplaces_input="aws")
        self.assertEqual(plan["runs"], {"aws": False, "azure": True, "google-cloud": False})
        self.assertFalse(plan["dry_run"])
        self.assertEqual(release_plan.outputs_of(plan)["release"], "false")

        editions = ready_editions()
        editions["azure"]["ready"] = False

        with self.assertRaises(release_common.ReleaseError):
            self.plan(action="azure-go-live", editions=editions)

    def test_outputs_and_summary(self) -> None:
        editions = ready_editions()
        editions["google-cloud"]["ready"] = False
        plan = self.plan(event="workflow_run", editions=editions)
        outputs = release_plan.outputs_of(plan)
        self.assertEqual(
            outputs,
            {
                "action": "release",
                "version": VERSION,
                "track": "14.0",
                "dry_run": "false",
                "release": "true",
                "aws": "true",
                "azure": "true",
                "google_cloud": "false",
                "any": "true",
            },
        )
        nothing = self.plan(event="workflow_run", editions={name: {} for name in release_common.MARKETPLACES})
        self.assertEqual(release_plan.outputs_of(nothing)["any"], "false")
        summary = release_plan.summary_of(plan)
        self.assertIn("| google-cloud | skipped:", summary)
        self.assertIn("| aws | pushes, then publishes once approved |", summary)


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
            "identity": {"externalID": "enterprise"},
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
                "tenantID": "tenant",
                "subscriptionID": "subscription",
                "resourceGroupName": "oneuptime-marketplace",
                "registryName": "oneuptimemarketplace",
                "repositoryName": "com.oneuptime.enterprise",
                "tag": VERSION,
                "digest": "sha256:abc",
            },
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
                "configure/job-1/status": {"jobID": "job-1", "jobStatus": "completed", "jobResult": "succeeded"},
                "configure": {"jobID": "job-1", "jobStatus": "notStarted", "jobResult": "pending"},
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

    def test_the_aws_role_needs_the_product_and_its_registry(self) -> None:
        for bad in ({"productId": ""}, {"registry": "123456789012.dkr.ecr.us-east-1.amazonaws.com/x"}, {"registry": "709825985650.dkr.ecr.us-east-1.amazonaws.com"}):
            with self.assertRaises(release_common.ReleaseError):
                ci_setup.aws_permissions_policy(dict(READY_AWS, **bad))

    def test_the_azure_registry_is_basic_and_keeps_the_newest_releases(self) -> None:
        script = ci_setup.azure_registry_script(READY_AZURE, "eastus")
        self.assertIn("--sku Basic", script)
        self.assertNotIn("Standard", script)
        purge = ci_setup.azure_purge_command(READY_AZURE)
        self.assertIn("--keep 3", purge)
        self.assertIn(r"--filter 'com\.oneuptime\.enterprise:.*'", purge)
        self.assertIn("--filter 'oneuptime/.*:.*'", purge)

    def test_the_google_repository_keeps_the_newest_releases(self) -> None:
        policies = {policy["name"]: policy for policy in ci_setup.google_cleanup_policy()}
        self.assertEqual(policies["keep-the-newest-releases"]["mostRecentVersions"], {"keepCount": 3})
        self.assertEqual(policies["delete-older-releases"]["condition"], {"olderThan": "30d"})
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
