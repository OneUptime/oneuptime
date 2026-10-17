#!/usr/bin/env python3
"""
Builds a marketplace edition of the OneUptime Helm chart: self-hosted OneUptime
Enterprise as a Kubernetes application sold on AWS Marketplace (Amazon EKS),
Microsoft Marketplace (AKS) or Google Cloud Marketplace (GKE), billed by the
user-hour through that marketplace.

    python3 HelmChart/Marketplace/build.py --marketplace aws --version 14.0.65 --out /tmp/oneuptime-aws

Every edition is the public chart (HelmChart/Public/oneuptime) with:

  - the Enterprise Edition images, every one of them - OneUptime's and the
    PostgreSQL, ClickHouse and Valkey images it bundles - taken from the
    marketplace's own registry (images.json, editions.json): written into the
    chart's values.yaml in the form that marketplace checks;
  - enterpriseMarketplace.provider set, so the installation reports its users
    to that marketplace every hour and is licensed by it;
  - no bundled subcharts (KEDA, CloudNativePG, the Altinity operator: off by
    default, and every marketplace refuses a chart that pulls images it does
    not host) and no helm test hook;
  - what the marketplace needs around the chart:
      aws           the chart, ready for `helm package` and `helm push` to
                    the Marketplace ECR repository;
      azure         the CNAB layout container-package-app builds: manifest.yaml,
                    createUIDefinition.json, mainTemplate.json and the chart;
      google-cloud  the deployer image's build context: Dockerfile,
                    schema.yaml, the chart with its Application resource, and
                    the tester.

It also writes images.json: each image's source and where it goes, for
mirror-images.sh. Standard library only, so the chart tests can run it
anywhere Python 3 is.
"""

import argparse
import json
import re
import shutil
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

HERE: Path = Path(__file__).resolve().parent
REPOSITORY: Path = HERE.parent.parent
PUBLIC_CHART: Path = REPOSITORY / "HelmChart" / "Public" / "oneuptime"
MARKETPLACES: Tuple[str, ...] = ("aws", "azure", "google-cloud")
VERSION_PATTERN: re.Pattern = re.compile(r"^\d+\.\d+\.\d+$")
PLAIN_KEY: re.Pattern = re.compile(r"^[A-Za-z0-9_-]+$")

# Azure fills these in when it installs the extension; the chart ships placeholders.
AZURE_PLACEHOLDER: str = "DONOTMODIFY"


class ValuesEditor:
    """
    Sets values in a values.yaml without disturbing the rest of it - its
    comments are the chart's documentation. Handles the block style the
    chart is written in (two-space indentation, one key per line): setting
    an existing key replaces its line and the block under it; a missing key
    is added at the end of its nearest existing parent.
    """

    def __init__(self, text: str) -> None:
        self.lines: List[str] = text.split("\n")

    def text(self) -> str:
        return "\n".join(self.lines)

    @staticmethod
    def indent_of(line: str) -> int:
        return len(line) - len(line.lstrip(" "))

    @staticmethod
    def is_content(line: str) -> bool:
        stripped: str = line.strip()
        return stripped != "" and not stripped.startswith("#")

    def block_end(self, index: int) -> int:
        """One past the last line of the block under the key at `index`."""
        indent: int = self.indent_of(self.lines[index])
        last: int = index

        for position in range(index + 1, len(self.lines)):
            line: str = self.lines[position]

            if not self.is_content(line):
                continue

            if self.indent_of(line) <= indent:
                break

            last = position

        return last + 1

    def find(self, path: List[str]) -> int:
        start: int = 0
        end: int = len(self.lines)
        indent: int = 0
        found: int = -1

        for depth, key in enumerate(path):
            pattern: re.Pattern = re.compile(
                "^" + " " * indent + re.escape(key) + r":(\s|$)"
            )
            found = -1

            for position in range(start, end):
                line: str = self.lines[position]

                if not self.is_content(line):
                    continue

                if self.indent_of(line) < indent:
                    break

                if self.indent_of(line) == indent and pattern.match(line):
                    found = position
                    break

            if found == -1:
                raise KeyError(".".join(path[: depth + 1]))

            start = found + 1
            end = self.block_end(found)
            indent += 2

        return found

    def get_scalar(self, path: List[str]) -> str:
        line: str = self.lines[self.find(path)]
        return line.split(":", 1)[1].strip()

    def set(self, path: List[str], value: Any) -> None:
        try:
            index: int = self.find(path)
        except KeyError:
            self.insert(path, value)
            return

        indent: int = self.indent_of(self.lines[index])
        self.lines[index : self.block_end(index)] = self.render_entry(
            path[-1], value, indent
        )

    def insert(self, path: List[str], value: Any) -> None:
        parent_length: int = 0
        parent_index: int = -1

        for length in range(len(path) - 1, 0, -1):
            try:
                parent_index = self.find(path[:length])
                parent_length = length
                break
            except KeyError:
                continue

        nested: Any = value

        for key in reversed(path[parent_length + 1 :]):
            nested = {key: nested}

        if parent_index == -1:
            while self.lines and self.lines[-1] == "":
                self.lines.pop()

            self.lines.extend(self.render_entry(path[0], nested, 0))
            self.lines.append("")
            return

        parent_line: str = self.lines[parent_index]

        if parent_line.rstrip().endswith("{}"):
            raise ValueError(
                f"Cannot add {'.'.join(path)} under an inline map; set the parent instead."
            )

        at: int = self.block_end(parent_index)
        indent: int = self.indent_of(parent_line) + 2
        self.lines[at:at] = self.render_entry(path[parent_length], nested, indent)

    @staticmethod
    def render_key(key: str) -> str:
        return key if PLAIN_KEY.match(key) else json.dumps(key)

    @staticmethod
    def render_scalar(value: Any) -> str:
        if value is None:
            return "null"

        if isinstance(value, bool):
            return "true" if value else "false"

        if isinstance(value, (int, float)):
            return str(value)

        return json.dumps(str(value))

    @staticmethod
    def render_entry(key: str, value: Any, indent: int) -> List[str]:
        prefix: str = " " * indent + ValuesEditor.render_key(key) + ":"

        if isinstance(value, dict):
            if not value:
                return [prefix + " {}"]

            lines: List[str] = [prefix]

            for child_key, child_value in value.items():
                lines.extend(
                    ValuesEditor.render_entry(child_key, child_value, indent + 2)
                )

            return lines

        if isinstance(value, list):
            if not value:
                return [prefix + " []"]

            lines = [prefix]

            for item in value:
                lines.append(
                    " " * (indent + 2) + "- " + ValuesEditor.render_scalar(item)
                )

            return lines

        return [prefix + " " + ValuesEditor.render_scalar(value)]


def remove_top_level_block(text: str, key: str) -> str:
    """Removes `key:` and everything under it from a top-level YAML map."""
    lines: List[str] = text.split("\n")
    output: List[str] = []
    skipping: bool = False

    for line in lines:
        if re.match("^" + re.escape(key) + r":", line):
            skipping = True
            continue

        if skipping:
            if line.strip() == "" or line.startswith((" ", "-", "#")):
                continue

            skipping = False

        output.append(line)

    return "\n".join(output).rstrip("\n") + "\n"


def split_reference(reference: str) -> Tuple[str, str]:
    """registry/repository:tag -> (registry/repository, tag)."""
    slash: int = reference.rfind("/")
    colon: int = reference.rfind(":")

    if colon <= slash:
        raise ValueError(f"{reference} has no tag.")

    return reference[:colon], reference[colon + 1 :]


def load_json(path: Path) -> Dict[str, Any]:
    with open(path, encoding="utf-8") as file:
        return json.load(file)


def plan_images(
    marketplace: str, version: str, edition: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """
    Where each image goes in the marketplace's registry. OneUptime's images
    are tagged with the release; third-party images keep their own version,
    except on Google Cloud, which needs every image of a release tagged with
    it (and with its track, major.minor).
    """
    images: Dict[str, Any] = load_json(HERE / "images.json")["images"]
    track: str = ".".join(version.split(".")[:2])
    plan: List[Dict[str, Any]] = []

    for key, image in images.items():
        source: str = image["source"].replace("{version}", version)
        _, source_tag = split_reference(source)
        tag: str = version if image["oneuptime"] else source_tag
        extra_tags: List[str] = []

        if marketplace == "aws":
            target: str = f"{edition['registry']}/{image['name']}:{tag}"
        elif marketplace == "azure":
            target = (
                f"{edition['registry']}/{edition['repositoryPrefix']}/"
                f"{image['name']}:{tag}"
            )
        else:
            # Google: the primary image at the root of the app's path, every other one beneath it.
            base: str = (
                edition["registry"]
                if key == "app"
                else f"{edition['registry']}/{image['name']}"
            )
            target = f"{base}:{version}"
            extra_tags = [track]

        plan.append(
            {
                "key": key,
                "source": source,
                "target": target,
                "extraTags": extra_tags,
            }
        )

    return plan


def copy_chart(destination: Path, version: str) -> None:
    """The public chart, without what no marketplace edition ships."""
    if destination.exists():
        shutil.rmtree(destination)

    # "tests" drops both the chart's unit tests and the helm test hook pod
    # (templates/tests), whose image no marketplace edition ships.
    shutil.copytree(
        PUBLIC_CHART,
        destination,
        ignore=shutil.ignore_patterns("charts", "Chart.lock", "tests"),
    )

    chart_yaml: Path = destination / "Chart.yaml"
    text: str = chart_yaml.read_text(encoding="utf-8")
    text = remove_top_level_block(text, "dependencies")
    text = re.sub(r"(?m)^version: .*$", f"version: {version}", text)
    text = re.sub(r'(?m)^appVersion: .*$', f'appVersion: "{version}"', text)
    chart_yaml.write_text(text, encoding="utf-8")


def common_values(editor: ValuesEditor, marketplace: str, version: str) -> None:
    editor.set(["image", "type"], "enterprise-edition")
    editor.set(["image", "tag"], version)
    editor.set(["image", "pullPolicy"], "IfNotPresent")
    editor.set(["enterpriseMarketplace", "provider"], marketplace)
    editor.set(["testHook", "enabled"], False)


def reference_values(
    editor: ValuesEditor, plan: List[Dict[str, Any]], field_images: bool
) -> None:
    """
    Every image as a full reference in image.overrides - the form AWS checks
    (each image written out in values.yaml) and the one Google's deployer
    fills in. With field_images, the bundled databases' own image fields
    point at the same references, so nothing in values.yaml names another
    registry.
    """
    references: Dict[str, str] = {entry["key"]: entry["target"] for entry in plan}
    editor.set(["image", "overrides"], references)

    if not field_images:
        return

    for key, path in (
        ("postgres", ["postgresql", "image"]),
        ("clickhouse", ["clickhouse", "image"]),
        ("valkey", ["valkey", "image"]),
    ):
        repository, tag = split_reference(references[key])
        editor.set(path + ["repository"], repository)
        editor.set(path + ["tag"], tag)


def build_aws(out: Path, version: str, edition: Dict[str, Any]) -> List[Dict[str, Any]]:
    plan: List[Dict[str, Any]] = plan_images("aws", version, edition)
    chart: Path = out / "oneuptime"
    copy_chart(chart, version)

    values_path: Path = chart / "values.yaml"
    editor: ValuesEditor = ValuesEditor(values_path.read_text(encoding="utf-8"))
    common_values(editor, "aws", version)
    reference_values(editor, plan, field_images=True)
    # Runs as the service account the buyer creates with an IAM role (eksctl, IRSA).
    editor.set(["serviceAccount", "create"], False)
    editor.set(["serviceAccount", "name"], edition["serviceAccountName"])
    values_path.write_text(editor.text(), encoding="utf-8")

    return plan


def build_azure(out: Path, version: str, edition: Dict[str, Any]) -> List[Dict[str, Any]]:
    plan: List[Dict[str, Any]] = plan_images("azure", version, edition)
    chart: Path = out / "oneuptime"
    copy_chart(chart, version)

    values_path: Path = chart / "values.yaml"
    editor: ValuesEditor = ValuesEditor(values_path.read_text(encoding="utf-8"))
    common_values(editor, "azure", version)

    # Microsoft copies every image listed here to its own registry and rewrites these values.
    azure_images: Dict[str, Dict[str, str]] = {}

    for entry in plan:
        repository, tag = split_reference(entry["target"])
        registry, _, image = repository.partition("/")
        azure_images[entry["key"]] = {
            "registry": registry,
            "image": image,
            "tag": tag,
        }

    editor.set(
        ["global", "azure"],
        {
            "identity": {"clientId": AZURE_PLACEHOLDER},
            "marketplace": {"planId": AZURE_PLACEHOLDER},
            "extension": {"resourceId": AZURE_PLACEHOLDER},
            "images": azure_images,
        },
    )
    values_path.write_text(editor.text(), encoding="utf-8")

    for name in ("createUIDefinition.json", "mainTemplate.json"):
        shutil.copyfile(HERE / "azure" / name, out / name)

    manifest: str = (HERE / "azure" / "manifest.yaml").read_text(encoding="utf-8")
    manifest = (
        manifest.replace("{version}", version)
        .replace("{applicationName}", edition["applicationName"])
        .replace("{publisher}", edition["publisher"])
        .replace("{registryServer}", edition["registry"])
        .replace("{namespace}", edition["namespace"])
    )
    (out / "manifest.yaml").write_text(manifest, encoding="utf-8")

    return plan


def build_google_cloud(
    out: Path, version: str, edition: Dict[str, Any]
) -> List[Dict[str, Any]]:
    plan: List[Dict[str, Any]] = plan_images("google-cloud", version, edition)
    chart: Path = out / "chart" / "oneuptime"
    copy_chart(chart, version)

    values_path: Path = chart / "values.yaml"
    editor: ValuesEditor = ValuesEditor(values_path.read_text(encoding="utf-8"))
    common_values(editor, "google-cloud", version)
    reference_values(editor, plan, field_images=False)
    editor.set(
        ["enterpriseMarketplace", "googleCloud", "serviceName"],
        edition["serviceName"],
    )
    # Google does not let a chart create service accounts; the deployer runs it.
    editor.set(["clickhouse", "serviceAccount", "create"], False)
    values_path.write_text(editor.text(), encoding="utf-8")

    google: Path = HERE / "google-cloud"
    shutil.copyfile(google / "application.yaml", chart / "templates" / "application.yaml")
    # Kept as deployer.Dockerfile: the repository ignores files named Dockerfile.
    shutil.copyfile(google / "deployer.Dockerfile", out / "Dockerfile")
    shutil.copyfile(google / "schema.yaml", out / "schema.yaml")

    apptest: Path = out / "apptest"

    if apptest.exists():
        shutil.rmtree(apptest)

    shutil.copytree(google / "apptest", apptest)

    tester_chart: Path = apptest / "deployer" / "oneuptime" / "Chart.yaml"
    tester_chart.write_text(
        tester_chart.read_text(encoding="utf-8").replace("{version}", version),
        encoding="utf-8",
    )

    return plan


BUILDERS = {
    "aws": build_aws,
    "azure": build_azure,
    "google-cloud": build_google_cloud,
}


def build(marketplace: str, version: str, out: Path) -> List[Dict[str, Any]]:
    if marketplace not in MARKETPLACES:
        raise ValueError(f"--marketplace must be one of {', '.join(MARKETPLACES)}.")

    if not VERSION_PATTERN.match(version):
        raise ValueError(
            "--version must be a release in #.#.# form (Microsoft and Google read no other)."
        )

    edition: Dict[str, Any] = load_json(HERE / "editions.json")[marketplace]
    out.mkdir(parents=True, exist_ok=True)
    plan: List[Dict[str, Any]] = BUILDERS[marketplace](out, version, edition)

    (out / "images.json").write_text(
        json.dumps(
            {"marketplace": marketplace, "version": version, "images": plan},
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    return plan


def main(argv: Optional[List[str]] = None) -> int:
    parser: argparse.ArgumentParser = argparse.ArgumentParser(
        description="Builds a marketplace edition of the OneUptime Helm chart."
    )
    parser.add_argument("--marketplace", required=True, choices=MARKETPLACES)
    parser.add_argument("--version", required=True)
    parser.add_argument("--out", required=True, type=Path)
    arguments: argparse.Namespace = parser.parse_args(argv)

    try:
        plan: List[Dict[str, Any]] = build(
            arguments.marketplace, arguments.version, arguments.out
        )
    except (ValueError, KeyError) as error:
        print(f"build.py: {error}", file=sys.stderr)
        return 1

    print(f"Built the {arguments.marketplace} edition of OneUptime {arguments.version} in {arguments.out}")

    for entry in plan:
        print(f"  {entry['source']} -> {entry['target']}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
