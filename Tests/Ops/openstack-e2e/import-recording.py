#!/usr/bin/env python3
"""Copy what the tests replay out of a downloaded recording, into the repository.

A recording holds far more than the tests read, and every run names its own runner
and its own IDs, which would make every refresh a diff of the whole folder. So this
keeps what is read, and gives the runner one stable name:

    gh run download <run id> --pattern 'openstack-recording-*' --dir /tmp/recordings
    python3 -I import-recording.py /tmp/recordings packages/Common/Tests/Fixtures/OpenStack

Standard library only, and it reads a recording as data: nothing in one is run.
"""
import json
import os
import re
import shutil
import sys

SCENES = (
    "healthy",
    "compute-disabled",
    "compute-down",
    "network-agent-down",
    "volume-service-down",
    "scheduler-down",
    "compute-api-down",
    "recovered",
)

# Everything from one release at full depth, and the first scene from the others. The
# scenes differ between releases far less than the shape of a healthy cloud does.
DEEP_RELEASES = ("hibiscus-ovn", "gazpacho-ovs")

# Only what the product reads: quotas are off by default, and a service that is not in
# the catalog answers with nothing.
SERVICES = ("identity", "compute", "placement", "network", "volume", "image")

# What each API answered, for the probe's own collector to read: its parity tests hold it
# to what the exporter said about the same cloud at the same moment. Each call a scene
# holds costs about 150 KiB, so only the scenes that say something different to a reader
# of the APIs, and only from one release beyond a healthy cloud. Each scene's own
# api-status.txt says what status each answer came with.
API_SCENES = {
    "hibiscus-ovn": ("healthy", "compute-disabled", "compute-down", "compute-api-down"),
    "gazpacho-ovs": ("healthy", "compute-disabled"),
}
API_CALLS = (
    "cinder-backups",
    "cinder-pools",
    "cinder-services",
    "cinder-snapshots",
    "cinder-volumes",
    "glance-images",
    "keystone-domains",
    "keystone-endpoints",
    "keystone-groups",
    "keystone-projects",
    "keystone-regions",
    "keystone-services",
    "keystone-users",
    "neutron-agents",
    "neutron-extensions",
    "neutron-floatingips",
    "neutron-ip-availabilities",
    "neutron-networks",
    "neutron-ports-limited",
    "neutron-router-l3-agents",
    "neutron-routers",
    "neutron-security-groups",
    "neutron-subnets",
    "nova-aggregates",
    "nova-azs",
    "nova-azs-list",
    "nova-flavors",
    "nova-hypervisors",
    "nova-hypervisors-before-2-88",
    "nova-limits",
    "nova-servers",
    "nova-services",
    "nova-versions",
    "placement-allocations",
    "placement-inventories",
    "placement-providers",
    "placement-usages",
)

# Long answers the collector reads a word of. A rule list, a CPU's feature list and every
# item's own links change nothing about what it does, and are most of the bytes.
TRIMMED_FROM = {
    "neutron-extensions": ("links", "updated", "description"),
    "neutron-security-groups": ("security_group_rules",),
    "nova-hypervisors-before-2-88": ("features",),
}


def runner_names(folder):
    """The runner's short and full names, read from what Nova said about itself."""
    short, full = None, None
    for scene in SCENES:
        path = os.path.join(folder, scene, "exporter", "compute.prom")
        if not os.path.isfile(path):
            continue
        with open(path, errors="replace") as handle:
            text = handle.read()
        match = re.search(r'openstack_nova_agent_state\{[^}]*hostname="([^"]+)"', text)
        if match:
            short = match.group(1)
        match = re.search(r'openstack_nova_vcpus_used\{[^}]*hostname="([^"]+)"', text)
        if match:
            full = match.group(1)
        if short and full:
            break
    return short, full


def rename(text, short, full):
    # The full name first, because it starts with the short one.
    if full:
        text = text.replace(full, "compute-01.example.internal")
    if short:
        text = text.replace(short, "compute-01")
    return text


def copy_text(source, target, short, full):
    with open(source, errors="replace") as handle:
        text = handle.read()
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "w") as handle:
        handle.write(rename(text, short, full))


def import_exporter(folder, scene, release_target, name, short, full):
    source = os.path.join(folder, scene, name)
    if not os.path.isdir(source):
        return
    for service in SERVICES:
        path = os.path.join(source, f"{service}.prom")
        if os.path.isfile(path):
            copy_text(path, os.path.join(release_target, scene, name, f"{service}.prom"), short, full)


def trim(value, fields):
    if isinstance(value, dict):
        return {key: trim(item, fields) for key, item in value.items() if key not in fields}
    if isinstance(value, list):
        return [trim(item, fields) for item in value]
    return value


def import_api(folder, scene, release_target, short, full):
    """What each API answered in a scene, with what its answers came with."""
    source = os.path.join(folder, scene, "api")
    if not os.path.isdir(source):
        return
    for call in API_CALLS:
        path = os.path.join(source, f"{call}.json")
        if not os.path.isfile(path):
            continue
        with open(path, errors="replace") as handle:
            text = handle.read()
        if call in TRIMMED_FROM:
            try:
                text = json.dumps(trim(json.loads(text), TRIMMED_FROM[call]))
            except ValueError:
                pass  # An error page is a recording too, and has nothing to trim.
        target = os.path.join(release_target, scene, "api", f"{call}.json")
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "w") as handle:
            handle.write(rename(text, short, full))
    status = os.path.join(folder, scene, "api-status.txt")
    if os.path.isfile(status):
        with open(status, errors="replace") as handle:
            # Only the code and the call: the rest names the runner's own address.
            lines = [" ".join(line.split()[:2]) for line in handle if line.strip()]
        with open(os.path.join(release_target, scene, "api-status.txt"), "w") as handle:
            handle.write("\n".join(lines) + "\n")


def import_otlp(folder, release_target, short, full):
    """One export per OpenStack service: the shape OneUptime really receives."""
    path = os.path.join(folder, "otlp", "metrics.json")
    if not os.path.isfile(path):
        return
    chosen = {}
    with open(path, errors="replace") as handle:
        for line in handle:
            try:
                export = json.loads(line)
            except ValueError:
                continue
            for resource_metrics in export.get("resourceMetrics", []):
                service = None
                for scope in resource_metrics.get("scopeMetrics", []):
                    for metric in scope.get("metrics", []):
                        if metric.get("name") != "up":
                            continue
                        points = (metric.get("gauge") or metric.get("sum") or {}).get("dataPoints", [])
                        for attribute in (points[0].get("attributes", []) if points else []):
                            if attribute.get("key") == "openstack_service":
                                service = attribute["value"]["stringValue"]
                if service and service not in chosen:
                    chosen[service] = resource_metrics
    os.makedirs(release_target, exist_ok=True)
    with open(os.path.join(release_target, "otlp.json"), "w") as handle:
        text = json.dumps({"resourceMetrics": [chosen[key] for key in sorted(chosen)]}, indent=0)
        handle.write(rename(text, short, full))


def main():
    recordings, fixtures = sys.argv[1], sys.argv[2]
    for entry in sorted(os.listdir(recordings)):
        if not entry.startswith("openstack-recording-"):
            continue
        release = entry[len("openstack-recording-"):]
        folder = os.path.join(recordings, entry)
        short, full = runner_names(folder)
        if not short:
            print(f"{release}: no scene with Nova's services in it, so leaving it out", file=sys.stderr)
            continue
        target = os.path.join(fixtures, release)
        shutil.rmtree(target, ignore_errors=True)
        scenes = SCENES if release in DEEP_RELEASES else ("healthy",)
        for scene in scenes:
            import_exporter(folder, scene, target, "exporter", short, full)
        for scene in API_SCENES.get(release, ("healthy",)):
            import_api(folder, scene, target, short, full)
        # The non-alpha release is only compared on a healthy cloud.
        import_exporter(folder, "healthy", target, "exporter-stable", short, full)
        if release in DEEP_RELEASES:
            import_otlp(folder, target, short, full)
        access = os.path.join(folder, "access")
        for name in ("matrix-default-policy.json", "matrix.json", "matrix-access-rules.json"):
            path = os.path.join(access, name)
            if os.path.isfile(path):
                copy_text(path, os.path.join(target, "access", name), short, full)
        status = os.path.join(access, "exporter")
        if os.path.isdir(status):
            for level in sorted(os.listdir(status)):
                path = os.path.join(status, level, "status.txt")
                if os.path.isfile(path):
                    copy_text(path, os.path.join(target, "access", "exporter", f"{level}.txt"), short, full)
        total = sum(
            os.path.getsize(os.path.join(root, name))
            for root, _, names in os.walk(target)
            for name in names
        )
        print(f"{release}: {total // 1024} KiB")


if __name__ == "__main__":
    main()
