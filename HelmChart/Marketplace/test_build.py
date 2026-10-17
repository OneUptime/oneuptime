#!/usr/bin/env python3
"""
Unit tests for build.py, the builder of the marketplace editions of the
OneUptime Helm chart. Standard library only:

    python3 -m unittest discover -s HelmChart/Marketplace -p 'test_*.py'

The chart tests' marketplace suite (HelmChart/Tests/suites/marketplace.sh)
runs these, then renders each built edition with helm.
"""

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

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

        for entry in plan:
            self.assertIn(f'"{entry["target"]}"', values)

        self.assertNotIn("docker.io/library/postgres", values)
        self.assertIn('    repository: "709825985650.dkr.ecr.us-east-1.amazonaws.com/oneuptime/postgres"', values)

    def test_azure_lays_out_the_cnab(self) -> None:
        build.build("azure", "1.2.3", self.out)

        manifest: str = (self.out / "manifest.yaml").read_text()
        self.assertIn("version: 1.2.3\n", manifest)
        self.assertIn('helmChart: "./oneuptime"', manifest)
        self.assertNotIn("{", manifest.replace("{}", ""))

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


if __name__ == "__main__":
    unittest.main()
