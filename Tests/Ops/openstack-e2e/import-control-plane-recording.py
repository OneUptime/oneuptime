#!/usr/bin/env python3
"""Keep what the code reads of a recording of a cloud's control plane breaking.

    import-control-plane-recording.py clusters <control-plane-clusters folder>
    import-control-plane-recording.py cloud <release> <control-plane-cloud folder>

Writes packages/Common/Tests/Fixtures/OpenStack/control-plane/{clusters,cloud-<release>}/:
for each scene and reading, every endpoint's series that the agent's collector keeps (its own
metric_relabel_configs, read from agents/OpenStackAgent/otel-collector-config.yaml, so a series
it stops keeping leaves the fixtures), and how each endpoint answered. A cluster's scene keeps
only that cluster's endpoints, because the others are all fine and all alike.

The recording itself is an artifact of Tests/Ops/openstack-e2e/control-plane-clusters.sh and
control-plane-cloud.sh. It is data: this reads it as text, and runs nothing from it.
"""

import os
import re
import shutil
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
CONFIG = os.path.join(ROOT, "agents", "OpenStackAgent", "otel-collector-config.yaml")
FIXTURES = os.path.join(ROOT, "packages", "Common", "Tests", "Fixtures", "OpenStack", "control-plane")

# The job that reads each endpoint, by the name the rig gives the endpoint.
JOB_OF_ENDPOINT = (
    (re.compile(r"^rabbitmq-\d+-detailed$"), "oneuptime-openstack-rabbitmq-queues"),
    (re.compile(r"^rabbitmq(-\d+)?$"), "oneuptime-openstack-rabbitmq"),
    (re.compile(r"^mysqld(-\w+)?$"), "oneuptime-openstack-mariadb"),
    (re.compile(r"^memcached(-\d+)?$"), "oneuptime-openstack-memcached"),
    (re.compile(r"^haproxy(-\d+)?$"), "oneuptime-openstack-haproxy"),
    (re.compile(r"^(ovn-\d+|network)$"), "oneuptime-openstack-network-exporter"),
    (re.compile(r"^libvirt$"), "oneuptime-openstack-libvirt-health"),
)

# What a scene of the clusters' rig is about: the endpoints a scene keeps.
ENDPOINT_PREFIX_OF_SCENE = (
    ("rabbitmq-", "rabbitmq-"),
    ("mariadb-without-galera-", "mysqld-plain"),
    ("mariadb-", "mysqld-"),
    ("memcached-", "memcached-"),
    ("haproxy-", "haproxy"),
    ("ovn-", "ovn-"),
)

# openstack-exporter on a real DevStack: what says the services above have fallen.
EXPORTER_SERIES = re.compile(
    r"^openstack_(identity|nova|neutron|cinder|placement|glance)_up$"
    r"|^openstack_(nova|cinder|neutron)_agent_state$"
)


def job_keep_lists():
    """Each job's keep and drop rules, as (action, label, regex), from the agent's own config."""
    text = open(CONFIG, encoding="utf-8").read()
    jobs = {}
    for match in re.finditer(r"^\s*- job_name: (\S+)\n(.*?)(?=^\s*- job_name: |^  [a-z#]|\Z)", text, re.M | re.S):
        name, body = match.group(1), match.group(2)
        rules = []
        relabels = body.split("metric_relabel_configs:")[-1] if "metric_relabel_configs:" in body else ""
        for rule in re.finditer(
            r"- source_labels: \[([^\]]+)\]\s*\n\s*regex: (.+?)\s*\n\s*action: (\w+)", relabels
        ):
            rules.append((rule.group(3), [label.strip() for label in rule.group(1).split(",")], rule.group(2)))
        jobs[name] = rules
    return jobs


SERIES = re.compile(r"^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(\S+)")
LABEL = re.compile(r'([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"')


def is_kept(line, rules):
    match = SERIES.match(line)
    if not match:
        return False
    labels = dict(LABEL.findall(match.group(2) or ""))
    labels["__name__"] = match.group(1)
    kept = True
    for action, sources, regex in rules:
        value = ";".join(labels.get(source, "") for source in sources)
        matches = re.fullmatch(regex, value) is not None
        if action == "keep" and not matches:
            kept = False
        if action == "drop" and matches:
            kept = False
    return kept


def job_of(endpoint):
    for pattern, job in JOB_OF_ENDPOINT:
        if pattern.match(endpoint):
            return job
    return None


def import_reading(source, target, keep_endpoint, jobs):
    os.makedirs(target, exist_ok=True)
    statuses = []
    status_file = os.path.join(source, "status.txt")
    if os.path.exists(status_file):
        for line in open(status_file, encoding="utf-8"):
            parts = line.split()
            if len(parts) >= 2 and keep_endpoint(parts[1]):
                # Fetching a dead endpoint's address failed with curl's own 000, doubled by the rig.
                statuses.append(f"{parts[0][:3]} {parts[1]} {parts[2] if len(parts) > 2 else ''}".strip())
    with open(os.path.join(target, "status.txt"), "w", encoding="utf-8") as out:
        out.write("".join(line + "\n" for line in statuses))
    at = os.path.join(source, "at.txt")
    if os.path.exists(at):
        shutil.copyfile(at, os.path.join(target, "at.txt"))
    for name in sorted(os.listdir(source)):
        if not name.endswith(".prom"):
            continue
        endpoint = name[: -len(".prom")]
        if not keep_endpoint(endpoint):
            continue
        job = job_of(endpoint)
        lines = []
        for line in open(os.path.join(source, name), encoding="utf-8", errors="replace"):
            if line.startswith("#"):
                continue
            if job and is_kept(line, jobs[job]):
                lines.append(line)
            elif not job and SERIES.match(line) and EXPORTER_SERIES.match(SERIES.match(line).group(1)):
                lines.append(line)
        if lines:
            with open(os.path.join(target, name), "w", encoding="utf-8") as out:
                out.writelines(lines)


def import_clusters(source):
    jobs = job_keep_lists()
    target = os.path.join(FIXTURES, "clusters")
    shutil.rmtree(target, ignore_errors=True)
    for scene in sorted(os.listdir(source)):
        folder = os.path.join(source, scene)
        if not os.path.isdir(folder) or not os.path.isdir(os.path.join(folder, "first")):
            continue
        prefix = next((p for s, p in ENDPOINT_PREFIX_OF_SCENE if scene.startswith(s)), None)
        if prefix is None:
            continue
        for reading in ("first", "second"):
            import_reading(
                os.path.join(folder, reading),
                os.path.join(target, scene, reading),
                lambda endpoint, p=prefix: endpoint.startswith(p),
                jobs,
            )


def import_cloud(release, source):
    jobs = job_keep_lists()
    target = os.path.join(FIXTURES, f"cloud-{release}")
    shutil.rmtree(target, ignore_errors=True)
    for scene in sorted(os.listdir(source)):
        folder = os.path.join(source, scene)
        if not os.path.isdir(folder):
            continue
        if os.path.exists(os.path.join(folder, "status.txt")):
            readings = [("", folder)]
        else:
            readings = [
                (reading, os.path.join(folder, reading))
                for reading in sorted(os.listdir(folder))
                if os.path.exists(os.path.join(folder, reading, "status.txt"))
            ]
        for reading, reading_folder in readings:
            import_reading(
                reading_folder,
                os.path.join(target, scene, reading) if reading else os.path.join(target, scene, "reading"),
                # The exporter in single-cloud mode says the same as the per-service answers.
                lambda endpoint: endpoint != "single-cloud",
                jobs,
            )


def main():
    if len(sys.argv) >= 3 and sys.argv[1] == "clusters":
        import_clusters(sys.argv[2])
    elif len(sys.argv) >= 4 and sys.argv[1] == "cloud":
        import_cloud(sys.argv[2], sys.argv[3])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
