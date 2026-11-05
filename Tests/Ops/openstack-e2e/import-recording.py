#!/usr/bin/env python3
"""Copy what the tests replay out of a downloaded recording, into the repository.

A recording holds far more than the tests read, and every run names its own runner
and its own IDs, which would make every refresh a diff of the whole folder. So this
keeps what is read, and gives the runner one stable name:

    gh run download <run id> --pattern 'openstack-recording-*' --dir /tmp/recordings
    python3 -I import-recording.py /tmp/recordings packages/Common/Tests/Fixtures/OpenStack

With --only-instance-metrics it refreshes only each release's instance-metrics and
instance-metrics-drill folders, which a run that recorded only one of them leaves the other of.

Standard library only, and it reads a recording as data: nothing in one is run.
"""
import gzip
import json
import os
import re
import shutil
import sys

SCENES = (
    "healthy",
    "compute-disabled",
    "compute-forced-down",
    "compute-down",
    "network-agent-down",
    "volume-service-down",
    "scheduler-down",
    "compute-api-down",
    "external-network-full",
    "router-agents-removed",
    "l3-agent-down",
    "recovered",
)

# Everything from one release at full depth, and the first scene from the others. The
# scenes differ between releases far less than the shape of a healthy cloud does.
DEEP_RELEASES = ("hibiscus-ovn", "gazpacho-ovs")

# Only what the product reads: quotas are off by default, and a service that is not in
# the catalog answers with nothing.
SERVICES = ("identity", "compute", "placement", "network", "volume", "image")

# The levels of access the docs describe: Full view, Infrastructure only, and Project view.
ACCESS_LEVELS_WALKED = ("monitoring-admin-get", "monitoring-role", "reader")

# What each API answered, for the probe's own collector to read: its parity tests hold it
# to what the exporter said about the same cloud at the same moment. Each call a scene
# holds costs about 150 KiB, so only the scenes that say something different to a reader
# of the APIs, and only from one release beyond a healthy cloud. Each scene's own
# api-status.txt says what status each answer came with.
API_SCENES = {
    "hibiscus-ovn": ("healthy", "compute-disabled", "compute-forced-down", "compute-down", "compute-api-down"),
    "gazpacho-ovs": ("healthy", "compute-disabled", "compute-forced-down", "router-agents-removed", "l3-agent-down"),
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
    "neutron-agent-dhcp-networks",
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


# Real VM metrics: every scrape from the releases read at depth, and enough from the others to
# cross three of Ceilometer's polling cycles, which is what a rate needs to be read on its own.
# Its servers.json is what joins a domain to its hypervisor.
INSTANCE_METRIC_SCRAPES_DEEP = 12
INSTANCE_METRIC_SCRAPES_OTHER = 8

# Only what the product reads of each exporter, which is under half of what it says, and the
# two series that say why it reads no others: the balloon's size, which reads as a flavor's
# memory on an idle instance, and a domain's state, which is what a CPU time of 0 means.
INSTANCE_METRIC_SERIES = re.compile(
    r"^(?:libvirt_domain_openstack_info"
    r"|libvirt_domain_info_(?:cpu_time_seconds_total|virtual_cpus|memory_usage_bytes|maximum_memory_bytes|state)"
    r"|libvirt_domain_memory_stats_(?:available|usable|unused|rss)_bytes"
    r"|libvirt_domain_block_stats_(?:read|write)_(?:bytes|requests|time_seconds)_total"
    r"|libvirt_domain_interface_stats_(?:receive|transmit)_bytes_total"
    r"|libvirt_domain_vcpu_delay_seconds_total"
    r"|libvirt_up"
    r"|ceilometer_(?:cpu|cpu_delay|vcpus|memory_usage|memory_resident)"
    r"|ceilometer_disk_device_(?:read|write)_(?:bytes|requests|latency)"
    r"|ceilometer_network_(?:incoming|outgoing)_bytes"
    r")(?:\{| )"
)


def copy_instance_metric_scrape(source, target, short, full):
    with open(source, errors="replace") as handle:
        lines = [line for line in handle if INSTANCE_METRIC_SERIES.match(line)]
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "w") as handle:
        handle.write(rename("".join(lines), short, full))


def import_instance_metrics(folder, release, release_target, short, full):
    source = os.path.join(folder, "instance-metrics")
    if not os.path.isdir(source):
        return
    target = os.path.join(release_target, "instance-metrics")
    shutil.rmtree(target, ignore_errors=True)
    keep = INSTANCE_METRIC_SCRAPES_DEEP if release in DEEP_RELEASES else INSTANCE_METRIC_SCRAPES_OTHER
    scrapes = sorted(name for name in os.listdir(source) if name.startswith("scrape-"))
    for scrape in scrapes[:keep]:
        for name in ("libvirt.prom", "ceilometer.prom"):
            path = os.path.join(source, scrape, name)
            if os.path.isfile(path):
                copy_instance_metric_scrape(path, os.path.join(target, scrape, name), short, full)
        path = os.path.join(source, scrape, "at.txt")
        if os.path.isfile(path):
            copy_text(path, os.path.join(target, scrape, "at.txt"), short, full)
    for name in ("servers.json", "hypervisors.json"):
        path = os.path.join(source, name)
        if os.path.isfile(path):
            copy_text(path, os.path.join(target, name), short, full)
    status = os.path.join(source, "status.txt")
    if os.path.isfile(status):
        chosen = set(scrapes[:keep])
        with open(status, errors="replace") as handle:
            lines = [line for line in handle if line.split(" ")[0] in chosen]
        with open(os.path.join(target, "status.txt"), "w") as handle:
            handle.write("".join(lines))


# The long drill: what the agent's collector really sent, as OneUptime would have received it,
# for as long as an alert template's window takes to fill and to empty. Only the series the
# product reads, and only the labels it reads of Ceilometer's, whose others are most of the
# bytes and say the same thing on every point. Compressed, because it is a lot of the same.
DRILL_SERIES = re.compile(
    r"^(?:libvirt_domain_openstack_info"
    r"|libvirt_domain_info_(?:cpu_time_seconds_total|virtual_cpus)"
    r"|libvirt_domain_memory_stats_(?:available|usable|unused|rss)_bytes"
    r"|libvirt_domain_block_stats_(?:read|write)_(?:bytes|requests|time_seconds)_total"
    r"|libvirt_domain_interface_stats_(?:receive|transmit)_bytes_total"
    r"|libvirt_domain_vcpu_delay_seconds_total"
    r"|ceilometer_(?:cpu|cpu_delay|vcpus|memory_usage|memory_resident)"
    r"|ceilometer_disk_device_(?:read|write)_(?:bytes|requests|latency)"
    r"|ceilometer_network_(?:incoming|outgoing)_bytes"
    # What every alert template's window reads beside what it compares.
    r"|openstack_nova_up"
    r")$"
)
DRILL_CEILOMETER_LABELS = {"resource", "resource_name", "project", "unit", "openstack_exporter_host", "openstack_service"}


def drill_metric(metric):
    """A metric as the drill keeps it, or nothing when it is none of the drill's."""
    if not DRILL_SERIES.match(metric.get("name", "")):
        return None
    kept = {key: value for key, value in metric.items() if key not in ("description", "metadata")}
    if metric["name"].startswith("ceilometer_"):
        for holder in ("gauge", "sum"):
            for point in (metric.get(holder) or {}).get("dataPoints", []):
                point["attributes"] = [
                    attribute
                    for attribute in point.get("attributes", [])
                    if attribute.get("key") in DRILL_CEILOMETER_LABELS
                ]
    return kept


def import_instance_metrics_drill(folder, release_target, short, full):
    source = os.path.join(folder, "instance-metrics-drill")
    path = os.path.join(folder, "otlp", "metrics.json")
    timeline = os.path.join(source, "timeline.txt")
    if not os.path.isfile(timeline) or not os.path.isfile(path):
        return
    target = os.path.join(release_target, "instance-metrics-drill")
    shutil.rmtree(target, ignore_errors=True)
    os.makedirs(target)
    copy_text(timeline, os.path.join(target, "timeline.txt"), short, full)
    for name in ("servers.json", "hypervisors.json"):
        if os.path.isfile(os.path.join(source, name)):
            copy_text(os.path.join(source, name), os.path.join(target, name), short, full)
    with open(path, errors="replace") as handle, gzip.open(
        os.path.join(target, "otlp.jsonl.gz"), "wt", compresslevel=9
    ) as out:
        for line in handle:
            try:
                export = json.loads(line)
            except ValueError:
                continue
            for resource_metrics in export.get("resourceMetrics", []):
                metrics = [
                    kept
                    for scope in resource_metrics.get("scopeMetrics", [])
                    for kept in (drill_metric(metric) for metric in scope.get("metrics", []))
                    if kept
                ]
                if metrics:
                    envelope = {
                        "resource": resource_metrics.get("resource", {}),
                        "scopeMetrics": [{"metrics": metrics}],
                    }
                    out.write(rename(json.dumps(envelope, separators=(",", ":")), short, full) + "\n")


def runner_names_of_instance_metrics(folder):
    """The same two names, from a recording whose scenes didn't have them to say."""
    for name in ("instance-metrics", "instance-metrics-drill"):
        path = os.path.join(folder, name, "servers.json")
        if os.path.isfile(path):
            break
    else:
        return None, None
    with open(path, errors="replace") as handle:
        try:
            hosts = [server.get("Host") for server in json.load(handle)]
        except ValueError:
            return None, None
    full = next((host for host in hosts if host), None)
    return (full.split(".")[0], full) if full else (None, None)


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
    # Only real VM metrics, leaving everything else a release holds as it is.
    only_instance_metrics = "--only-instance-metrics" in sys.argv
    arguments = [argument for argument in sys.argv[1:] if not argument.startswith("--")]
    recordings, fixtures = arguments[0], arguments[1]
    for entry in sorted(os.listdir(recordings)):
        if not entry.startswith("openstack-recording-"):
            continue
        release = entry[len("openstack-recording-"):]
        folder = os.path.join(recordings, entry)
        if only_instance_metrics:
            short, full = runner_names_of_instance_metrics(folder)
            import_instance_metrics(folder, release, os.path.join(fixtures, release), short, full)
            import_instance_metrics_drill(folder, os.path.join(fixtures, release), short, full)
            continue
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
        import_instance_metrics(folder, release, target, short, full)
        import_instance_metrics_drill(folder, target, short, full)
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
                # What that credential's exporter said, for a page's walk to read: "can't list
                # hypervisors" is only right if a real credential really gets what the page assumes.
                if level in ACCESS_LEVELS_WALKED:
                    for service in SERVICES:
                        path = os.path.join(status, level, f"{service}.prom")
                        if os.path.isfile(path):
                            copy_text(path, os.path.join(target, "access", "exporter", level, f"{service}.prom"), short, full)
        total = sum(
            os.path.getsize(os.path.join(root, name))
            for root, _, names in os.walk(target)
            for name in names
        )
        print(f"{release}: {total // 1024} KiB")


if __name__ == "__main__":
    main()
