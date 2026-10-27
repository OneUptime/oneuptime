#!/usr/bin/env python3
"""
Unit tests for build.py, the builder of the marketplace editions of the
OneUptime Helm chart. Standard library only:

    python3 -m unittest discover -s HelmChart/Marketplace -p 'test_*.py'

The chart tests' marketplace suite (HelmChart/Tests/suites/marketplace.sh)
runs these, then renders each built edition with helm.
"""

import json
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict, List, Tuple
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import build  # noqa: E402

VALUES = """## A header comment the editor must keep.

global:
  storageClass:
  clusterDomain: &global-cluster-domain cluster.local

image:
  registry: docker.io
  repository: oneuptime
  # The tag comment.
  tag: release
  overrides: {}

postgresql:
  enabled: true # trailing comment
  image:
    repository: postgres
    tag: latest
  auth:
    database: oneuptimedb

list:
  - one
  - two

testHook:
  enabled: true
"""


class ValuesEditorTest(unittest.TestCase):
    def editor(self) -> build.ValuesEditor:
        return build.ValuesEditor(VALUES)

    def test_reads_a_scalar_by_path(self) -> None:
        editor: build.ValuesEditor = self.editor()

        self.assertEqual(editor.get_scalar(["image", "tag"]), "release")
        self.assertEqual(editor.get_scalar(["postgresql", "image", "tag"]), "latest")

    def test_sets_a_scalar_and_keeps_every_comment(self) -> None:
        editor: build.ValuesEditor = self.editor()
        editor.set(["image", "tag"], "14.0.65")
        text: str = editor.text()

        self.assertIn('  tag: "14.0.65"', text)
        self.assertIn("## A header comment the editor must keep.", text)
        self.assertIn("  # The tag comment.", text)
        self.assertIn("    tag: latest", text)

    def test_tells_nested_keys_of_the_same_name_apart(self) -> None:
        editor: build.ValuesEditor = self.editor()
        editor.set(["postgresql", "image", "tag"], "15.19-alpine")

        self.assertEqual(editor.get_scalar(["postgresql", "image", "tag"]), '"15.19-alpine"')
        self.assertEqual(editor.get_scalar(["image", "tag"]), "release")

    def test_writes_booleans_numbers_and_null_as_yaml(self) -> None:
        editor: build.ValuesEditor = self.editor()
        editor.set(["testHook", "enabled"], False)
        editor.set(["postgresql", "enabled"], True)
        editor.set(["global", "storageClass"], None)

        self.assertEqual(editor.get_scalar(["testHook", "enabled"]), "false")
        self.assertEqual(editor.get_scalar(["postgresql", "enabled"]), "true")
        self.assertEqual(editor.get_scalar(["global", "storageClass"]), "null")

    def test_replaces_an_inline_map_with_a_block(self) -> None:
        editor: build.ValuesEditor = self.editor()
        editor.set(["image", "overrides"], {"app": "registry.example.com/oneuptime/app:1.0.0"})
        text: str = editor.text()

        self.assertIn('  overrides:\n    app: "registry.example.com/oneuptime/app:1.0.0"\n', text)
        self.assertNotIn("overrides: {}", text)

    def test_replaces_a_block_with_a_block(self) -> None:
        editor: build.ValuesEditor = self.editor()
        editor.set(["postgresql", "image"], {"repository": "r", "tag": "t"})
        text: str = editor.text()

        self.assertIn('  image:\n    repository: "r"\n    tag: "t"\n  auth:', text)
        self.assertNotIn("repository: postgres", text)

    def test_writes_an_empty_map_inline(self) -> None:
        editor: build.ValuesEditor = self.editor()
        editor.set(["image", "overrides"], {})

        self.assertIn("  overrides: {}", editor.text())

    def test_adds_a_missing_key_under_its_parent(self) -> None:
        editor: build.ValuesEditor = self.editor()
        editor.set(["global", "azure", "identity", "clientId"], "DONOTMODIFY")
        text: str = editor.text()

        self.assertIn(
            '  clusterDomain: &global-cluster-domain cluster.local\n'
            '  azure:\n'
            '    identity:\n'
            '      clientId: "DONOTMODIFY"\n',
            text,
        )
        self.assertEqual(
            editor.get_scalar(["global", "azure", "identity", "clientId"]),
            '"DONOTMODIFY"',
        )

    def test_adds_a_missing_top_level_key_at_the_end(self) -> None:
        editor: build.ValuesEditor = self.editor()
        editor.set(["brandNew", "key"], 1)

        self.assertTrue(editor.text().endswith("brandNew:\n  key: 1\n"))

    def test_refuses_to_add_under_an_inline_map(self) -> None:
        editor: build.ValuesEditor = self.editor()

        with self.assertRaises(ValueError):
            editor.set(["image", "overrides", "app"], "x")

    def test_quotes_keys_that_are_not_plain(self) -> None:
        lines = build.ValuesEditor.render_entry(
            "eks.amazonaws.com/role-arn", "arn:aws:iam::1:role/r", 2
        )

        self.assertEqual(lines, ['  "eks.amazonaws.com/role-arn": "arn:aws:iam::1:role/r"'])

    def test_renders_lists(self) -> None:
        self.assertEqual(
            build.ValuesEditor.render_entry("tags", ["14.0"], 0),
            ["tags:", '  - "14.0"'],
        )
        self.assertEqual(build.ValuesEditor.render_entry("tags", [], 0), ["tags: []"])

    def test_raises_for_a_path_that_does_not_exist_when_reading(self) -> None:
        with self.assertRaises(KeyError):
            self.editor().get_scalar(["image", "nope"])

    def test_leaves_untouched_text_byte_for_byte(self) -> None:
        self.assertEqual(self.editor().text(), VALUES)

    def test_removes_a_block_and_only_that(self) -> None:
        editor: build.ValuesEditor = self.editor()
        editor.remove(["postgresql", "image"])
        text: str = editor.text()

        self.assertIn("postgresql:\n  enabled: true # trailing comment\n  auth:\n", text)
        self.assertNotIn("repository: postgres", text)
        # The image block of the same name elsewhere stays.
        self.assertIn("  tag: release", text)

    def test_removing_a_key_that_is_not_there_changes_nothing(self) -> None:
        editor: build.ValuesEditor = self.editor()
        editor.remove(["postgresql", "nope"])
        editor.remove(["nope"])

        self.assertEqual(editor.text(), VALUES)

    def test_reads_a_value_as_yaml_does(self) -> None:
        editor: build.ValuesEditor = self.editor()

        self.assertEqual(editor.get_value(["postgresql", "enabled"]), "true")
        editor.set(["image", "tag"], "1.2.3")
        self.assertEqual(editor.get_value(["image", "tag"]), "1.2.3")


class HelpersTest(unittest.TestCase):
    def test_removes_a_top_level_block_and_only_that(self) -> None:
        chart: str = (
            "name: oneuptime\n"
            "version: 0.1.0\n"
            "\n"
            "dependencies:\n"
            "- name: keda\n"
            "  # A comment inside.\n"
            "  version: \"2.20.1\"\n"
            "- name: cloudnative-pg\n"
            "  condition: postgresOperator.cnpg.enabled\n"
            "after: kept\n"
        )

        self.assertEqual(
            build.remove_top_level_block(chart, "dependencies"),
            "name: oneuptime\nversion: 0.1.0\n\nafter: kept\n",
        )

    def test_splits_a_reference_at_its_tag(self) -> None:
        self.assertEqual(
            build.split_reference("localhost:5000/oneuptime/app:14.0.65"),
            ("localhost:5000/oneuptime/app", "14.0.65"),
        )

        with self.assertRaises(ValueError):
            build.split_reference("localhost:5000/oneuptime/app")

    def test_reads_scalars_as_the_charts_write_them(self) -> None:
        self.assertEqual(build.scalar_value('"0.96.0"'), "0.96.0")
        self.assertEqual(build.scalar_value('""'), "")
        self.assertEqual(build.scalar_value("'v1.2.3'"), "v1.2.3")
        self.assertEqual(build.scalar_value("otel/ebpf-instrument"), "otel/ebpf-instrument")
        self.assertEqual(build.scalar_value('"v0.14.0" # the pin'), "v0.14.0")
        self.assertEqual(build.scalar_value("IfNotPresent  # a comment"), "IfNotPresent")
        self.assertEqual(build.scalar_value('"a \\"quoted\\" word"'), 'a "quoted" word')

        with self.assertRaises(ValueError):
            build.scalar_value("'unclosed")

    def test_spells_out_docker_hubs_short_names(self) -> None:
        self.assertEqual(
            build.docker_reference("otel/ebpf-instrument"), "docker.io/otel/ebpf-instrument"
        )
        self.assertEqual(build.docker_reference("busybox"), "docker.io/library/busybox")

        for full in (
            "registry.k8s.io/kube-state-metrics/kube-state-metrics",
            "ghcr.io/opencost/opencost",
            "quay.io/prometheus/prometheus",
            "localhost:5000/agent",
            "localhost/agent",
        ):
            self.assertEqual(build.docker_reference(full), full)


class PlanImagesTest(unittest.TestCase):
    def editions(self) -> dict:
        return build.load_json(build.HERE / "editions.json")

    def test_puts_every_image_in_the_aws_marketplace_repositories(self) -> None:
        plan = build.plan_images("aws", "14.0.65", self.editions()["aws"])
        targets = {entry["key"]: entry["target"] for entry in plan}
        registry: str = self.editions()["aws"]["registry"]

        self.assertEqual(targets["app"], f"{registry}/app:14.0.65")
        self.assertEqual(targets["postgres"], f"{registry}/postgres:15.19-alpine")
        self.assertEqual(
            {entry["source"] for entry in plan if entry["key"] == "app"},
            {"docker.io/oneuptime/app:enterprise-14.0.65"},
        )

    def test_puts_every_image_under_the_publishers_acr_prefix(self) -> None:
        edition = self.editions()["azure"]
        plan = build.plan_images("azure", "14.0.65", edition)

        for entry in plan:
            self.assertTrue(
                entry["target"].startswith(
                    f"{edition['registry']}/{edition['repositoryPrefix']}/"
                )
            )

    def test_tags_every_google_image_with_the_release_and_its_track(self) -> None:
        edition = self.editions()["google-cloud"]
        plan = build.plan_images("google-cloud", "14.0.65", edition)
        targets = {entry["key"]: entry["target"] for entry in plan}

        # The primary image at the root of the app's path; every other beneath it.
        self.assertEqual(targets["app"], f"{edition['registry']}:14.0.65")
        self.assertEqual(targets["valkey"], f"{edition['registry']}/valkey:14.0.65")

        for entry in plan:
            self.assertTrue(entry["target"].endswith(":14.0.65"))
            self.assertEqual(entry["extraTags"], ["14.0"])

    def test_plans_the_same_images_for_every_marketplace(self) -> None:
        keys = None

        for marketplace in build.MARKETPLACES:
            plan = build.plan_images(marketplace, "1.2.3", self.editions()[marketplace])
            these = sorted(entry["key"] for entry in plan)
            keys = keys or these
            self.assertEqual(these, keys)

        self.assertEqual(
            keys,
            sorted(["app", "nginx", "probe", "runner", "postgres", "clickhouse", "valkey"]),
        )

    def test_pins_every_third_party_image(self) -> None:
        images = build.load_json(build.HERE / "images.json")["images"]

        for key, image in images.items():
            _, tag = build.split_reference(image["source"].replace("{version}", "1.0.0"))
            self.assertNotEqual(tag, "latest", key)

            if not image["oneuptime"]:
                # A release, not a line: "15" or "26.7" would change under a
                # published version. PostgreSQL's releases have two parts
                # (15.19), the others three or more.
                pattern: str = r"^\d+\.\d+(-|$)" if key == "postgres" else r"^\d+\.\d+\.\d+"
                self.assertRegex(tag, pattern, key)


class BuildTest(unittest.TestCase):
    def setUp(self) -> None:
        self.out: Path = Path(tempfile.mkdtemp())

    def tearDown(self) -> None:
        shutil.rmtree(self.out, ignore_errors=True)

    def test_refuses_a_version_marketplaces_cannot_read(self) -> None:
        for version in ("14.0", "v14.0.65", "14.0.65-rc1", ""):
            with self.assertRaises(ValueError):
                build.build("aws", version, self.out)

    def test_refuses_an_unknown_marketplace(self) -> None:
        with self.assertRaises(ValueError):
            build.build("oracle", "1.2.3", self.out)

    def test_the_command_line_says_what_went_wrong(self) -> None:
        self.assertEqual(
            build.main(["--marketplace", "aws", "--version", "1.2", "--out", str(self.out)]),
            1,
        )

    def test_leaves_the_public_chart_alone(self) -> None:
        values: Path = build.PUBLIC_CHART / "values.yaml"
        chart: Path = build.PUBLIC_CHART / "Chart.yaml"
        before = (values.read_bytes(), chart.read_bytes())

        for marketplace in build.MARKETPLACES:
            build.build(marketplace, "1.2.3", self.out / marketplace)

        self.assertEqual((values.read_bytes(), chart.read_bytes()), before)

    def test_every_edition_upgrades_through_its_marketplace_alone(self) -> None:
        # Google's chart sits in the deployer's build context.
        charts = {"aws": "oneuptime", "azure": "oneuptime", "google-cloud": "chart/oneuptime"}

        for marketplace in build.MARKETPLACES:
            build.build(marketplace, "1.2.3", self.out / marketplace)
            values_path: Path = self.out / marketplace / charts[marketplace] / "values.yaml"
            values = build.ValuesEditor(values_path.read_text())

            self.assertEqual(values.get_scalar(["updateCheck", "disabled"]), "true", marketplace)

        public = build.ValuesEditor((build.PUBLIC_CHART / "values.yaml").read_text())
        self.assertEqual(public.get_scalar(["updateCheck", "disabled"]), "false")

    def test_no_edition_checks_in_with_oneuptime(self) -> None:
        charts = {"aws": "oneuptime", "azure": "oneuptime", "google-cloud": "chart/oneuptime"}

        for marketplace in build.MARKETPLACES:
            build.build(marketplace, "1.2.3", self.out / marketplace)
            values_path: Path = self.out / marketplace / charts[marketplace] / "values.yaml"
            values = build.ValuesEditor(values_path.read_text())

            self.assertEqual(values.get_scalar(["instanceCheckIn", "disabled"]), "true", marketplace)

        public = build.ValuesEditor((build.PUBLIC_CHART / "values.yaml").read_text())
        self.assertEqual(public.get_scalar(["instanceCheckIn", "disabled"]), "false")

    def test_writes_the_plan_for_the_mirror(self) -> None:
        build.build("aws", "1.2.3", self.out)
        plan = json.loads((self.out / "images.json").read_text())

        self.assertEqual(plan["marketplace"], "aws")
        self.assertEqual(plan["version"], "1.2.3")
        self.assertEqual(len(plan["images"]), 7)

    def test_ships_no_subcharts_lock_tests_or_hook(self) -> None:
        build.build("aws", "1.2.3", self.out)
        chart: Path = self.out / "oneuptime"

        self.assertFalse((chart / "charts").exists())
        self.assertFalse((chart / "Chart.lock").exists())
        self.assertFalse((chart / "tests").exists())
        self.assertFalse((chart / "templates" / "tests").exists())
        self.assertEqual(list(chart.rglob("*.tgz")), [])

        chart_yaml: str = (chart / "Chart.yaml").read_text()
        self.assertNotIn("dependencies:", chart_yaml)
        self.assertIn("\nversion: 1.2.3\n", chart_yaml)
        self.assertIn('\nappVersion: "1.2.3"\n', chart_yaml)

    def test_aws_writes_every_image_out_in_values_yaml(self) -> None:
        plan = build.build("aws", "1.2.3", self.out)
        values: str = (self.out / "oneuptime" / "values.yaml").read_text()
        references = build.values_image_references(values)

        # Each one as AWS reads it: a repository, with the registry and tag beside it.
        for entry in plan:
            self.assertIn(entry["target"], references)

        editor = build.ValuesEditor(values)
        self.assertEqual(editor.get_scalar(["image", "overrides", "app", "registry"]), '"709825985650.dkr.ecr.us-east-1.amazonaws.com"')
        self.assertEqual(editor.get_scalar(["image", "overrides", "app", "repository"]), '"oneuptime/app"')
        self.assertEqual(editor.get_scalar(["image", "overrides", "app", "tag"]), '"1.2.3"')
        self.assertNotIn("docker.io/library/postgres", values)
        self.assertIn('    repository: "709825985650.dkr.ecr.us-east-1.amazonaws.com/oneuptime/postgres"', values)

    def test_aws_refused_the_full_reference_form(self) -> None:
        # 14.0.72's AWS edition named OneUptime's images only as full references in
        # image.overrides, and AWS refused the version (MISSING_VALUES_IMAGE_REFERENCE) for app,
        # nginx, probe and runner - the bundled databases have repository and tag fields too.
        plan = build.build("aws", "14.0.72", self.out)
        editor = build.ValuesEditor((self.out / "oneuptime" / "values.yaml").read_text())
        build.reference_values(editor, plan, field_images=True, as_fields=False)
        references = build.values_image_references(editor.text())
        refused = sorted(entry["key"] for entry in plan if entry["target"] not in references)

        self.assertEqual(refused, ["app", "nginx", "probe", "runner"])

    def test_refuses_an_aws_edition_from_a_release_before_the_image_form(self) -> None:
        old_chart: Path = self.out / "old-chart"
        shutil.copytree(build.PUBLIC_CHART, old_chart)
        helpers: Path = old_chart / "templates" / "_helpers.tpl"
        helpers.write_text(helpers.read_text().replace(build.AWS_IMAGE_FORM, "$override.somethingElse"))

        with mock.patch.object(build, "PUBLIC_CHART", old_chart):
            with self.assertRaises(ValueError) as raised:
                build.build("aws", "1.2.3", self.out / "edition")

        self.assertIn(build.AWS_PREDATES, str(raised.exception))

    def test_reads_image_references_as_aws_does(self) -> None:
        values = "\n".join(
            [
                "image:",
                "  overrides:",
                "    app:",
                '      registry: "r.example.com"',
                '      repository: "team/app"',
                '      tag: "1.0"',
                "    probe:",
                "      repository: r.example.com/team/probe  # a comment",
                "      digest: sha256:abc",
                "postgresql:",
                "  image:",
                "    repository: 'r.example.com/team/postgres'",
                "    tag: 15-alpine",
                "    pullPolicy: IfNotPresent",
                "valkey:",
                "  image:",
                "    # repository: not.this/one",
                "    repository: r.example.com/team/valkey:9",
            ]
        )

        self.assertEqual(
            build.values_image_references(values),
            {
                "r.example.com/team/app:1.0",
                "r.example.com/team/probe@sha256:abc",
                "r.example.com/team/postgres:15-alpine",
                "r.example.com/team/valkey:9",
            },
        )

    def test_azure_lays_out_the_cnab(self) -> None:
        build.build("azure", "1.2.3", self.out)

        manifest: str = (self.out / "manifest.yaml").read_text()
        self.assertIn("version: 1.2.3\n", manifest)
        self.assertIn('helmChart: "./oneuptime"', manifest)
        self.assertIn('clusterArmTemplate: "./mainTemplate.json"', manifest)
        # The docs' spelling, which cpa 1.3.59 rejects ("clusterArmTemplate is required").
        self.assertNotIn("clusterARMTemplate:", manifest)
        self.assertIn('uiDefinition: "./createUIDefinition.json"', manifest)
        self.assertNotIn("{", manifest.replace("{}", ""))

        # Microsoft's field names, spelled exactly as container-package-app reads them.
        keys: set = {
            line.split(":", 1)[0]
            for line in manifest.splitlines()
            if line and not line.startswith((" ", "#"))
        }
        self.assertEqual(
            keys,
            {
                "applicationName",
                "publisher",
                "description",
                "version",
                "helmChart",
                "clusterArmTemplate",
                "uiDefinition",
                "registryServer",
                "extensionRegistrationParameters",
            },
        )

        for name in ("createUIDefinition.json", "mainTemplate.json"):
            json.loads((self.out / name).read_text())

        values: str = (self.out / "oneuptime" / "values.yaml").read_text()
        self.assertIn('      clientId: "DONOTMODIFY"', values)
        self.assertIn('        image: "oneuptime/app"', values)

    def test_google_lays_out_the_deployer(self) -> None:
        build.build("google-cloud", "1.2.3", self.out)

        for path in (
            "Dockerfile",
            "schema.yaml",
            "chart/oneuptime/Chart.yaml",
            "chart/oneuptime/templates/application.yaml",
            "apptest/deployer/schema.yaml",
            "apptest/deployer/oneuptime/templates/tester.yaml",
        ):
            self.assertTrue((self.out / path).exists(), path)

        tester_chart: str = (self.out / "apptest/deployer/oneuptime/Chart.yaml").read_text()
        self.assertIn("version: 1.2.3", tester_chart)

        values: str = (self.out / "chart/oneuptime/values.yaml").read_text()
        self.assertIn("    create: false", values)
        self.assertIn('provider: "google-cloud"', values)

    def test_schema_maps_every_image_the_chart_resolves(self) -> None:
        schema: str = (build.HERE / "google-cloud" / "schema.yaml").read_text()

        for key in build.load_json(build.HERE / "images.json")["images"]:
            self.assertIn(f"image.overrides.{key}:", schema)

        self.assertIn("type: REPORTING_SECRET", schema)
        self.assertIn('publishedVersion: "$TAG"', schema)


# --- The Kubernetes agent's Amazon EKS add-on -------------------------------------------

# The JSON Schema versions Amazon EKS takes for an add-on's configuration schema (AWS
# Marketplace Seller Guide, "Schema requirements"), in the form their meta-schemas name
# themselves. Draft 2020-12, the agent chart's own, is not one of them.
EKS_SCHEMA_VERSIONS = {
    "json-schema.org/draft-04/schema",
    "json-schema.org/draft-06/schema",
    "json-schema.org/draft-07/schema",
    "json-schema.org/draft/2019-09/schema",
}

# What the add-on's configuration schema may say: these validation keywords, which
# schema_errors() below checks in full, and annotations.
VALIDATION_KEYWORDS = {
    "type",
    "enum",
    "properties",
    "additionalProperties",
    "pattern",
    "minLength",
    "maxLength",
}
ANNOTATIONS = {"$schema", "title", "description", "default", "examples", "$comment"}

# A schema property AWS refuses as a place for a secret (INVALID_HELM_SENSITIVE_CONFIG):
# a buyer passes the name of a Secret they created, never the key itself.
SENSITIVE_NAME = re.compile(
    r"password|passwd|token|api[-_]?key|private[-_]?key|certificate|credential|license|secret",
    re.IGNORECASE,
)
CAMEL_CASE = re.compile(r"^[a-z][a-zA-Z0-9]*$")


def json_type_of(value: Any, name: str) -> bool:
    if name == "object":
        return isinstance(value, dict)
    if name == "array":
        return isinstance(value, list)
    if name == "string":
        return isinstance(value, str)
    if name == "boolean":
        return isinstance(value, bool)
    if name == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if name == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if name == "null":
        return value is None
    raise ValueError(f"Unknown JSON type {name}")


def schema_errors(schema: Dict[str, Any], value: Any, where: str = "") -> List[str]:
    """What Amazon EKS's validator would refuse in a configuration, for VALIDATION_KEYWORDS."""
    if "type" in schema:
        types = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]

        if not any(json_type_of(value, name) for name in types):
            return [f"{where or '/'}: {value!r} is not {types}"]

    errors: List[str] = []

    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{where}: {value!r} is not one of {schema['enum']}")

    if isinstance(value, str):
        if "pattern" in schema and not re.search(schema["pattern"], value):
            errors.append(f"{where}: {value!r} does not match {schema['pattern']}")
        if len(value) > schema.get("maxLength", len(value)):
            errors.append(f"{where}: longer than {schema['maxLength']}")
        if len(value) < schema.get("minLength", 0):
            errors.append(f"{where}: shorter than {schema['minLength']}")

    if isinstance(value, dict):
        properties: Dict[str, Any] = schema.get("properties", {})

        for key, item in value.items():
            if key in properties:
                errors.extend(schema_errors(properties[key], item, f"{where}/{key}"))
            elif schema.get("additionalProperties", True) is False:
                errors.append(f"{where}/{key}: not a configuration value of the add-on")
            elif isinstance(schema.get("additionalProperties"), dict):
                errors.extend(
                    schema_errors(schema["additionalProperties"], item, f"{where}/{key}")
                )

    return errors


def subschemas(schema: Dict[str, Any], path: Tuple[str, ...] = ()) -> List[Tuple[Tuple[str, ...], Dict[str, Any]]]:
    """Every schema in the tree, by the values path it describes ("*" for additionalProperties)."""
    found = [(path, schema)]

    for key, child in schema.get("properties", {}).items():
        found.extend(subschemas(child, path + (key,)))

    if isinstance(schema.get("additionalProperties"), dict):
        found.extend(subschemas(schema["additionalProperties"], path + ("*",)))

    return found


class EksAddonConfigurationSchemaTest(unittest.TestCase):
    def schema(self) -> Dict[str, Any]:
        return build.load_json(build.EKS_ADDON_DIR / "configuration-schema.json")

    def chart_schema(self) -> Dict[str, Any]:
        return build.load_json(build.AGENT_CHART / "values.schema.json")

    def test_uses_a_json_schema_version_eks_takes(self) -> None:
        version: str = self.schema()["$schema"]
        normalized: str = re.sub(r"^https?://", "", version).rstrip("#")

        self.assertIn(normalized, EKS_SCHEMA_VERSIONS)

    def test_says_only_what_the_validator_here_checks(self) -> None:
        for path, schema in subschemas(self.schema()):
            unknown = set(schema) - VALIDATION_KEYWORDS - ANNOTATIONS
            self.assertEqual(unknown, set(), ".".join(path))

    def test_describes_every_value_for_the_eks_console(self) -> None:
        for path, schema in subschemas(self.schema()):
            if path and path[-1] == "*":
                continue

            self.assertTrue(schema.get("description", "").strip(), ".".join(path) or "root")

    def test_names_every_value_in_camel_case(self) -> None:
        for path, _ in subschemas(self.schema()):
            for key in path:
                if key != "*":
                    self.assertRegex(key, CAMEL_CASE, ".".join(path))

    def test_takes_no_secret_only_the_name_of_a_secret(self) -> None:
        for path, _ in subschemas(self.schema()):
            for key in path:
                if key == "*" or key.endswith("SecretName"):
                    continue

                self.assertIsNone(SENSITIVE_NAME.search(key), ".".join(path))

        self.assertEqual(
            schema_errors(self.schema(), {"oneuptime": {"apiKey": "f0b3c3c4-key"}}),
            ["/oneuptime/apiKey: not a configuration value of the add-on"],
        )

    def test_takes_nothing_it_does_not_name(self) -> None:
        for path, schema in subschemas(self.schema()):
            if schema.get("type") == "object" and path[-1:] != ("labels",):
                self.assertIs(schema.get("additionalProperties"), False, ".".join(path) or "root")

        # Nor what a buyer must leave to EKS and the listing: the images, and the cluster's
        # name, which EKS fills in itself.
        for value in (
            {"clusterName": "prod"},
            {"image": {"repository": "otel/opentelemetry-collector-contrib"}},
            {"profiling": {"enabled": True}},
            {"debug": {"enabled": True}},
        ):
            self.assertNotEqual(schema_errors(self.schema(), value), [], value)

    def test_every_value_is_one_the_agent_chart_takes(self) -> None:
        chart: Dict[str, Any] = self.chart_schema()

        for path, schema in subschemas(self.schema()):
            if not path or "*" in path:
                continue

            node: Dict[str, Any] = chart

            for key in path:
                self.assertIn(key, node.get("properties", {}), ".".join(path))
                node = node["properties"][key]

            ours = set(schema["type"] if isinstance(schema["type"], list) else [schema["type"]])
            theirs = set(node["type"] if isinstance(node["type"], list) else [node["type"]])
            self.assertTrue(ours <= theirs, ".".join(path))

            if "enum" in node:
                self.assertTrue(set(schema["enum"]) <= set(node["enum"]), ".".join(path))

    def test_its_examples_are_configurations_eks_takes(self) -> None:
        schema = self.schema()
        self.assertTrue(schema["examples"])

        for example in schema["examples"]:
            self.assertEqual(schema_errors(schema, example), [])

    def test_refuses_what_would_break_the_agent(self) -> None:
        schema = self.schema()

        for value in (
            {"preset": "gke-autopilot"},
            {"preset": ""},
            {"oneuptime": {"url": "oneuptime.com"}},
            {"oneuptime": {"url": "https://oneuptime.com and more"}},
            {"oneuptime": {"existingSecretName": "Oneuptime_Key"}},
            {"oneuptime": {"existingSecretName": ""}},
            {"oneuptime": {"labels": {"team": ["a", "b"]}}},
            {"ebpf": {"enabled": "false"}},
        ):
            self.assertNotEqual(schema_errors(schema, value), [], value)

        for value in (
            {},
            {"oneuptime": {"url": "http://oneuptime.internal:3000/"}},
            {"oneuptime": {"labels": {"env": "prod", "tier": 1, "pci": True}}},
            {"preset": "eks-fargate", "ebpf": {"enabled": False}},
        ):
            self.assertEqual(schema_errors(schema, value), [], value)


class EksAddonBuildTest(unittest.TestCase):
    def setUp(self) -> None:
        self.out: Path = Path(tempfile.mkdtemp())
        self.edition: Dict[str, Any] = build.load_json(build.HERE / "editions.json")[build.EKS_ADDON]

    def tearDown(self) -> None:
        shutil.rmtree(self.out, ignore_errors=True)

    def built(self) -> Tuple[List[Dict[str, Any]], Path]:
        plan = build.build(build.EKS_ADDON, "14.0.65", self.out)
        return plan, self.out / "kubernetes-agent"

    def test_is_an_edition_but_not_of_the_oneuptime_chart(self) -> None:
        self.assertIn(build.EKS_ADDON, build.EDITIONS)
        self.assertNotIn(build.EKS_ADDON, build.MARKETPLACES)

    def test_ships_every_image_from_the_add_on_products_repositories(self) -> None:
        plan, _ = self.built()
        targets = {entry["key"]: entry["target"] for entry in plan}
        registry: str = self.edition["registry"]

        self.assertEqual(
            sorted(targets),
            sorted(
                [
                    "collector",
                    "ebpf",
                    "kubeStateMetrics",
                    "opencost",
                    "prometheus",
                    "logTailer",
                    "costAgent",
                    "aiAgent",
                ]
            ),
        )

        for entry in plan:
            self.assertTrue(entry["target"].startswith(f"{registry}/"), entry["key"])
            self.assertNotIn(":latest", entry["target"])

        # OneUptime's images at the release, not at the moving tag the chart runs.
        self.assertEqual(targets["aiAgent"], f"{registry}/kubernetes-ai-agent:14.0.65")
        self.assertEqual(targets["logTailer"], f"{registry}/kubernetes-log-tailer:14.0.65")
        self.assertEqual(
            {entry["source"] for entry in plan if entry["key"] == "costAgent"},
            {"docker.io/oneuptime/kubernetes-cost-agent:14.0.65"},
        )

    def test_takes_each_third_party_image_at_the_version_the_agent_chart_pins(self) -> None:
        plan, _ = self.built()
        chart = build.ValuesEditor((build.AGENT_CHART / "values.yaml").read_text())

        for entry in plan:
            path = entry["values"].split(".")
            repository: str = chart.get_value(path + ["repository"])

            if entry["key"] in ("logTailer", "costAgent", "aiAgent"):
                continue

            tag: str = chart.get_value(path + ["tag"])
            self.assertEqual(entry["source"], f"{build.docker_reference(repository)}:{tag}")
            self.assertTrue(entry["target"].endswith(f":{tag}"))

    def test_names_repositories_the_enterprise_product_does_not_use(self) -> None:
        addon = build.load_json(build.EKS_ADDON_DIR / "images.json")["images"]
        enterprise = build.load_json(build.HERE / "images.json")["images"]
        names = [image["name"] for image in addon.values()]

        self.assertEqual(len(names), len(set(names)))
        # "oneuptime" is the Enterprise chart's repository; "kubernetes-agent" is the add-on's.
        taken = {image["name"] for image in enterprise.values()} | {"oneuptime", "kubernetes-agent"}
        self.assertEqual(set(names) & taken, set())

    def test_writes_every_image_out_in_values_yaml_registry_and_all(self) -> None:
        plan, chart = self.built()
        values = build.ValuesEditor((chart / "values.yaml").read_text())

        for entry in plan:
            path = entry["values"].split(".")
            repository, tag = build.split_reference(entry["target"])
            self.assertEqual(values.get_value(path + ["repository"]), repository)
            self.assertEqual(values.get_value(path + ["tag"]), tag)

        text: str = (chart / "values.yaml").read_text()

        for outside in (
            "repository: otel/",
            "repository: oneuptime/",
            "repository: registry.k8s.io",
            "repository: ghcr.io",
            "repository: quay.io",
            "repository: nicolaka/",
        ):
            self.assertNotIn(outside, text)

    def test_offers_no_profiler_and_no_debug_sidecar_and_ships_neither_image(self) -> None:
        _, chart = self.built()
        values = build.ValuesEditor((chart / "values.yaml").read_text())

        for feature in ("profiling", "debug"):
            self.assertEqual(values.get_value([feature, "enabled"]), "false")

            with self.assertRaises(KeyError):
                values.get_scalar([feature, "image"])

    def test_sets_the_add_ons_defaults(self) -> None:
        _, chart = self.built()
        values = build.ValuesEditor((chart / "values.yaml").read_text())

        self.assertEqual(values.get_value(["oneuptime", "url"]), "https://oneuptime.com")
        self.assertEqual(
            values.get_value(["oneuptime", "existingSecretName"]), "oneuptime-ingestion-key"
        )
        # No key in values: the chart would refuse it next to existingSecretName.
        self.assertEqual(values.get_value(["oneuptime", "apiKey"]), "")
        self.assertEqual(values.get_value(["fullnameOverride"]), "kubernetes-agent")
        self.assertEqual(values.get_value(["preset"]), "standard")
        self.assertEqual(values.get_value(["clusterName"]), "set-by-amazon-eks")
        self.assertEqual(values.get_value(["chartDefaultsVersion"]), "14.0.65")

    def test_its_configuration_schema_says_what_values_yaml_does(self) -> None:
        _, chart = self.built()
        values = build.ValuesEditor((chart / "values.yaml").read_text())
        schema = build.load_json(chart / build.EKS_CONFIGURATION_SCHEMA)

        for path, node in subschemas(schema):
            if "default" not in node or not path or "*" in path:
                continue

            default = node["default"]
            written = default if isinstance(default, str) else json.dumps(default)
            self.assertEqual(values.get_value(list(path)), written, ".".join(path))

    def test_ships_the_configuration_schema_beside_chart_yaml(self) -> None:
        _, chart = self.built()

        self.assertEqual(
            (chart / build.EKS_CONFIGURATION_SCHEMA).read_text(),
            (build.EKS_ADDON_DIR / "configuration-schema.json").read_text(),
        )

    def test_opens_the_charts_own_schema_at_its_root_for_eks_alone(self) -> None:
        _, chart = self.built()
        schema = build.load_json(chart / "values.schema.json")
        public = build.load_json(build.AGENT_CHART / "values.schema.json")

        self.assertIs(public["additionalProperties"], False)
        self.assertIs(schema["additionalProperties"], True)
        self.assertIn("k8version", schema["$comment"])
        # Everything below the root is the chart's, word for word.
        self.assertEqual(schema["properties"], public["properties"])
        self.assertEqual(schema["required"], public["required"])

    def test_ships_the_chart_at_the_release_without_tests_or_scripts(self) -> None:
        _, chart = self.built()
        chart_yaml: str = (chart / "Chart.yaml").read_text()

        self.assertIn("\nversion: 14.0.65\n", chart_yaml)
        self.assertIn('\nappVersion: "14.0.65"\n', chart_yaml)
        self.assertIn("\nname: kubernetes-agent\n", chart_yaml)
        self.assertNotIn("dependencies:", chart_yaml)
        self.assertFalse((chart / "tests").exists())
        self.assertFalse((chart / "troubleshoot.sh").exists())
        self.assertFalse((chart / "charts").exists())

    def test_writes_the_plan_for_the_mirror(self) -> None:
        self.built()
        plan = json.loads((self.out / "images.json").read_text())

        self.assertEqual(plan["marketplace"], build.EKS_ADDON)
        self.assertEqual(plan["version"], "14.0.65")
        self.assertEqual(len(plan["images"]), 8)

    def test_leaves_the_agent_chart_alone(self) -> None:
        before = {
            name: (build.AGENT_CHART / name).read_bytes()
            for name in ("values.yaml", "Chart.yaml", "values.schema.json")
        }
        self.built()

        for name, content in before.items():
            self.assertEqual((build.AGENT_CHART / name).read_bytes(), content, name)

    def test_refuses_a_release_from_before_the_add_on(self) -> None:
        old_chart: Path = self.out / "old-agent-chart"
        shutil.copytree(build.AGENT_CHART, old_chart)
        values: Path = old_chart / "values.yaml"
        values.write_text(
            "\n".join(
                line
                for line in values.read_text().split("\n")
                if not line.startswith("  existingSecretName:")
            )
        )

        with mock.patch.object(build, "AGENT_CHART", old_chart):
            with self.assertRaises(ValueError) as raised:
                build.build(build.EKS_ADDON, "14.0.65", self.out / "edition")

        self.assertIn(build.EKS_ADDON_PREDATES, str(raised.exception))

    def test_refuses_an_image_the_agent_chart_does_not_pin(self) -> None:
        values = build.ValuesEditor((build.AGENT_CHART / "values.yaml").read_text())
        values.set(["image", "tag"], "")

        with self.assertRaises(ValueError):
            build.plan_addon_images("14.0.65", self.edition, values)


if __name__ == "__main__":
    unittest.main()
