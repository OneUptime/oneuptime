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
  - updateCheck.disabled: an installation upgrades through its marketplace,
    which takes a release a week, so it is not compared with the releases on
    GitHub (several a day) and makes no call to GitHub;
  - instanceCheckIn.disabled: the marketplace knows each buyer and which
    release it ships them, so the installation does not check in with
    oneuptime.com either;
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

One more edition is not of the OneUptime chart: aws-eks-addon is the free
Kubernetes agent (HelmChart/Public/kubernetes-agent) as an Amazon EKS add-on,
sold through AWS Marketplace for nothing, which buyers add from the EKS
console. It is the agent chart with:

  - every image it can run taken from the add-on product's AWS Marketplace
    repositories (aws-eks-addon/images.json): third-party images at the
    version the chart pins, OneUptime's at the release rather than the moving
    `release` tag;
  - the defaults an add-on needs: OneUptime Cloud's address, the ingestion key
    read from a Secret the buyer creates (EKS takes no secrets in an add-on's
    configuration), resources named as the Helm install names them, and a
    cluster name EKS replaces with the cluster's own at install;
  - no profiler and no debug sidecar, which the add-on does not offer, and no
    images for them;
  - aws_mp_configuration_schema.json beside Chart.yaml: what a buyer may set
    (aws-eks-addon/configuration-schema.json), and the chart's own schema open
    at its root for the k8version value EKS renders the add-on with.

    python3 HelmChart/Marketplace/build.py --marketplace aws-eks-addon --version 14.0.65 --out /tmp/oneuptime-eks-addon
"""

import argparse
import json
import re
import shutil
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

HERE: Path = Path(__file__).resolve().parent
REPOSITORY: Path = HERE.parent.parent
PUBLIC_CHART: Path = REPOSITORY / "HelmChart" / "Public" / "oneuptime"
AGENT_CHART: Path = REPOSITORY / "HelmChart" / "Public" / "kubernetes-agent"
# The editions of the OneUptime chart.
MARKETPLACES: Tuple[str, ...] = ("aws", "azure", "google-cloud")
# The Kubernetes agent's Amazon EKS add-on, an edition of the agent chart.
EKS_ADDON: str = "aws-eks-addon"
EDITIONS: Tuple[str, ...] = MARKETPLACES + (EKS_ADDON,)
EKS_ADDON_DIR: Path = HERE / EKS_ADDON
# Where Amazon EKS reads an add-on's configuration schema from: beside Chart.yaml.
EKS_CONFIGURATION_SCHEMA: str = "aws_mp_configuration_schema.json"
# How build.py refuses a release from before the add-on (the marketplace suite skips it).
EKS_ADDON_PREDATES: str = "This release predates the EKS add-on"
# AWS Marketplace takes an image only as values.yaml spells it out in a block with a repository,
# and the registry, tag or digest beside it (MISSING_VALUES_IMAGE_REFERENCE otherwise), and
# rewrites those when it copies the product to another Region. The chart reads image.overrides
# in that form from the release whose image helper has this; an older one cannot go to AWS.
AWS_PREDATES: str = "This release predates AWS Marketplace's image form"
AWS_IMAGE_FORM: str = "$override.repository"
VERSION_PATTERN: re.Pattern = re.compile(r"^\d+\.\d+\.\d+$")
PLAIN_KEY: re.Pattern = re.compile(r"^[A-Za-z0-9_-]+$")
DOUBLE_QUOTED: re.Pattern = re.compile(r'^"((?:[^"\\]|\\.)*)"')

# Azure fills these in when it installs the extension; the chart ships placeholders.
AZURE_PLACEHOLDER: str = "DONOTMODIFY"

# The add-on's own defaults, by values path. A buyer changes the first two with
# configuration values (aws-eks-addon/configuration-schema.json, whose defaults
# say the same); the others are the add-on's.
EKS_ADDON_VALUES: Dict[str, Any] = {
    # Where most clusters send: OneUptime Cloud.
    "oneuptime.url": "https://oneuptime.com",
    # The Secret the buyer creates in the add-on's namespace, with the ingestion
    # key under api-key: an add-on's configuration takes no secrets.
    "oneuptime.existingSecretName": "oneuptime-ingestion-key",
    "preset": "standard",
    # The names the Helm install gives its resources (kubernetes-agent-ai-agent,
    # ...), so the docs and troubleshoot.sh fit both, whatever release name EKS
    # renders the add-on with.
    "fullnameOverride": "kubernetes-agent",
    # Amazon EKS puts the cluster's name here at install (the delivery option's
    # environment override, ${AWS_EKS_CLUSTER_NAME}). AWS's own checks render
    # the chart without it, and the chart renders nothing without a name.
    "clusterName": "set-by-amazon-eks",
}


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

    def remove(self, path: List[str]) -> None:
        """Removes a key and the block under it. A key that is not there stays not there."""
        try:
            index: int = self.find(path)
        except KeyError:
            return

        del self.lines[index : self.block_end(index)]

    def get_value(self, path: List[str]) -> str:
        """A scalar as YAML reads it: unquoted, without a trailing comment."""
        return scalar_value(self.get_scalar(path))

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


def scalar_value(raw: str) -> str:
    """
    A scalar as the charts write them in values.yaml: bare, "double-quoted" or
    'single-quoted', with an optional trailing comment.
    """
    text: str = raw.strip()
    quoted: Optional[re.Match] = DOUBLE_QUOTED.match(text)

    if quoted:
        return json.loads(quoted.group(0))

    if text.startswith("'"):
        end: int = text.find("'", 1)

        if end == -1:
            raise ValueError(f"{raw} opens a quote it does not close.")

        return text[1:end]

    return re.split(r"\s+#", text, maxsplit=1)[0].strip()


def docker_reference(repository: str) -> str:
    """A repository with its registry spelled out, as a pull reads Docker Hub's short names."""
    first: str = repository.split("/", 1)[0]

    if "/" in repository and ("." in first or ":" in first or first == "localhost"):
        return repository

    if "/" not in repository:
        return f"docker.io/library/{repository}"

    return f"docker.io/{repository}"


def split_reference(reference: str) -> Tuple[str, str]:
    """registry/repository:tag -> (registry/repository, tag)."""
    slash: int = reference.rfind("/")
    colon: int = reference.rfind(":")

    if colon <= slash:
        raise ValueError(f"{reference} has no tag.")

    return reference[:colon], reference[colon + 1 :]


def values_image_references(values: str) -> Set[str]:
    """
    The image references a values.yaml spells out the way AWS Marketplace checks them: each block
    with a repository, and the registry, tag or digest beside it - registry/repository:tag, or a
    repository that is a whole reference. A rendered image with none of these is the
    MISSING_VALUES_IMAGE_REFERENCE AWS refuses a version for.
    """
    lines: List[str] = values.split("\n")
    found: Set[str] = set()

    def scalar(line: str) -> str:
        value: str = line.split(":", 1)[1].strip()
        if value.startswith(("'", '"')):
            return value[1 : value.index(value[0], 1)]
        return value.split(" #", 1)[0].strip()

    for index, line in enumerate(lines):
        match = re.match(r"^( *)repository:\s*\S", line)
        if not match:
            continue

        indent: int = len(match.group(1))
        fields: Dict[str, str] = {"repository": scalar(line)}

        for step in (-1, 1):
            other: int = index + step
            while 0 <= other < len(lines):
                sibling: str = lines[other]
                if sibling.strip() and not sibling.lstrip().startswith("#"):
                    sibling_indent: int = len(sibling) - len(sibling.lstrip(" "))
                    if sibling_indent < indent:
                        break
                    key = re.match(r"^ *(registry|tag|digest):\s*\S", sibling)
                    if sibling_indent == indent and key:
                        fields[key.group(1)] = scalar(sibling)
                other += step

        name: str = fields["repository"]
        if fields.get("registry"):
            name = f"{fields['registry']}/{name}"

        if fields.get("digest"):
            found.add(f"{name}@{fields['digest']}")
        elif fields.get("tag"):
            found.add(f"{name}:{fields['tag']}")
        else:
            found.add(name)

    return found


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
    # Upgrades come through the marketplace, a release a week: told of each GitHub release,
    # an admin would see an upgrade their marketplace does not have yet.
    editor.set(["updateCheck", "disabled"], True)
    # The marketplace knows its buyers and the release it ships them: no daily check-in.
    editor.set(["instanceCheckIn", "disabled"], True)
    editor.set(["testHook", "enabled"], False)


def reference_values(
    editor: ValuesEditor, plan: List[Dict[str, Any]], field_images: bool, as_fields: bool = False
) -> None:
    """
    Every image in image.overrides: as a full reference, the form Google's
    deployer fills in, or with as_fields as registry, repository and tag, the
    form AWS checks and rewrites. With field_images, the bundled databases' own
    image fields point at the same references, so nothing in values.yaml names
    another registry.
    """
    references: Dict[str, str] = {entry["key"]: entry["target"] for entry in plan}

    if as_fields:
        fields: Dict[str, Dict[str, str]] = {}

        for key, reference in references.items():
            name, tag = split_reference(reference)
            registry, repository = name.split("/", 1)
            fields[key] = {"registry": registry, "repository": repository, "tag": tag}

        editor.set(["image", "overrides"], fields)
    else:
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

    if AWS_IMAGE_FORM not in (chart / "templates" / "_helpers.tpl").read_text(encoding="utf-8"):
        raise ValueError(
            f"{AWS_PREDATES}: its chart reads image.overrides only as full references, and AWS "
            "takes an image only as registry, repository and tag (MISSING_VALUES_IMAGE_REFERENCE)."
        )

    values_path: Path = chart / "values.yaml"
    editor: ValuesEditor = ValuesEditor(values_path.read_text(encoding="utf-8"))
    common_values(editor, "aws", version)
    reference_values(editor, plan, field_images=True, as_fields=True)
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


def plan_addon_images(
    version: str, edition: Dict[str, Any], values: ValuesEditor
) -> List[Dict[str, Any]]:
    """
    Where each image of the agent goes in the add-on product's AWS Marketplace
    repositories, read from the agent chart's values.yaml: a third-party image
    at the version the chart pins, and OneUptime's own, which the chart runs at
    the moving `release` tag, at the release.
    """
    images: Dict[str, Any] = load_json(EKS_ADDON_DIR / "images.json")["images"]
    plan: List[Dict[str, Any]] = []

    for key, image in images.items():
        path: List[str] = image["values"].split(".")
        repository: str = values.get_value(path + ["repository"])
        tag: str = version if image["oneuptime"] else values.get_value(path + ["tag"])

        if not repository or not tag or tag == "latest":
            raise ValueError(
                f"The agent chart's values.yaml gives {image['values']} no repository or no pinned tag."
            )

        plan.append(
            {
                "key": key,
                "values": image["values"],
                "source": f"{docker_reference(repository)}:{tag}",
                "target": f"{edition['registry']}/{image['name']}:{tag}",
                "extraTags": [],
            }
        )

    return plan


def copy_agent_chart(destination: Path, version: str) -> None:
    """The agent chart, without its unit tests and troubleshoot.sh: neither installs anything."""
    if destination.exists():
        shutil.rmtree(destination)

    shutil.copytree(
        AGENT_CHART,
        destination,
        ignore=shutil.ignore_patterns("charts", "Chart.lock", "tests", "troubleshoot.sh"),
    )

    chart_yaml: Path = destination / "Chart.yaml"
    text: str = chart_yaml.read_text(encoding="utf-8")
    text = remove_top_level_block(text, "dependencies")
    text = re.sub(r"(?m)^version: .*$", f"version: {version}", text)
    text = re.sub(r'(?m)^appVersion: .*$', f'appVersion: "{version}"', text)
    chart_yaml.write_text(text, encoding="utf-8")


def build_aws_eks_addon(
    out: Path, version: str, edition: Dict[str, Any]
) -> List[Dict[str, Any]]:
    chart: Path = out / "kubernetes-agent"
    copy_agent_chart(chart, version)

    values_path: Path = chart / "values.yaml"
    editor: ValuesEditor = ValuesEditor(values_path.read_text(encoding="utf-8"))

    try:
        editor.get_scalar(["oneuptime", "existingSecretName"])
    except KeyError:
        raise ValueError(
            f"{EKS_ADDON_PREDATES}: its Kubernetes agent chart cannot read the ingestion key from a "
            "Secret (oneuptime.existingSecretName), and an add-on's configuration takes no key."
        )

    plan: List[Dict[str, Any]] = plan_addon_images(version, edition, editor)

    # Each image written out in values.yaml, its registry beside its name: the
    # form AWS checks, and the one it rewrites for every other Region.
    for entry in plan:
        repository, tag = split_reference(entry["target"])
        path: List[str] = entry["values"].split(".")
        editor.set(path + ["repository"], repository)
        editor.set(path + ["tag"], tag)

    # Off, and with no image to run: the add-on ships no image it does not offer.
    for feature in ("profiling", "debug"):
        editor.set([feature, "enabled"], False)
        editor.remove([feature, "image"])

    for path, value in EKS_ADDON_VALUES.items():
        editor.set(path.split("."), value)

    # The version the chart's notes compare their defaults with, stamped as
    # the release workflow stamps the chart it publishes.
    editor.set(["chartDefaultsVersion"], version)
    values_path.write_text(editor.text(), encoding="utf-8")

    # EKS renders an add-on with --set k8version=<the cluster's version>, a value
    # the chart does not have. Buyers' values are held to the add-on's own schema
    # before they get here, so the chart's may take what it does not know.
    schema_path: Path = chart / "values.schema.json"
    schema: Dict[str, Any] = load_json(schema_path)
    schema["additionalProperties"] = True
    schema["$comment"] = (
        "Open at the root for the k8version value Amazon EKS renders the add-on with. "
        f"What a buyer may set is {EKS_CONFIGURATION_SCHEMA}."
    )
    schema_path.write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8")

    shutil.copyfile(
        EKS_ADDON_DIR / "configuration-schema.json", chart / EKS_CONFIGURATION_SCHEMA
    )

    return plan


BUILDERS = {
    "aws": build_aws,
    "azure": build_azure,
    "google-cloud": build_google_cloud,
    EKS_ADDON: build_aws_eks_addon,
}


def build(marketplace: str, version: str, out: Path) -> List[Dict[str, Any]]:
    if marketplace not in EDITIONS:
        raise ValueError(f"--marketplace must be one of {', '.join(EDITIONS)}.")

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
    parser.add_argument("--marketplace", required=True, choices=EDITIONS)
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
