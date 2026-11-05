#!/usr/bin/env python3
"""Copy what the tests replay out of a recording of the services a cloud may not run.

The sibling of import-recording.py, for what services-<group>.sh records. It writes only
packages/Common/Tests/Fixtures/OpenStack/services-<group>/, and replaces only the groups it
is given, so it can never rewrite a release's fixtures:

    gh run download <run id> --pattern 'openstack-recording-services-*' --dir /tmp/recordings
    python3 -I import-services-recording.py /tmp/recordings packages/Common/Tests/Fixtures/OpenStack

What a group holds:

    scenes.txt                  every scene the run tried, and what became of it
    otlp.json                   one export per service, as the collector would have sent it,
                                and one of a service this cloud does not run
    <note>.txt                  what a group records once, such as Octavia's policy
    access-check/               access-matrix.sh on this cloud: what each credential could read
    <scene>/how.txt             how the cloud got there, in its own words or written into a row
    <scene>/exporter/<svc>.prom what the exporter said
    <scene>/exporter/status.txt each scrape's status and duration
    <scene>/api/<call>.json     what each API call answered
    <scene>/api-status.txt      each call's status
    <scene>/cli.txt             what the CLI said, for a person to check a page against
    <scene>/recon/              what Swift's recon said

A scene with a failed.txt never reached the state it was for, so it is left out, and
scenes.txt says why. Two names are refused because other things read them: a scene called
"healthy" would make the tests of the releases read a group as a release, and a folder called
"access" would put it in the generated access table.

Standard library only, and it reads a recording as data: nothing in one is run.
"""
import json
import os
import re
import shutil
import sys

# A scene_prefix narrows a part to the scenes that are about it, when one runner holds several
# services. A first_scene adds what only one scene needs to hold: what the others read the same.
GROUPS = {
    "services-octavia": {
        "notes": ("octavia-policy.txt",),
        "parts": ({
            "exporter": ("load-balancer",),
            "calls": ("octavia-",),
            "cli": ("openstack loadbalancer",),
            # An amphora is an instance: its compute_id finds its row here.
            "first_scene": {"scene": "baseline", "exporter": ("compute",), "calls": ("nova-servers",)},
        },),
    },
    "services-ironic": {
        "parts": ({
            "exporter": ("baremetal", "compute", "placement"),
            "calls": ("ironic-", "nova-hypervisors", "nova-services", "placement-providers"),
            "cli": ("openstack baremetal", "openstack hypervisor"),
        },),
    },
    "services-heat-magnum": {
        "parts": ({
            "scene_prefix": "heat-",
            "exporter": ("orchestration",),
            "calls": ("heat-",),
            "cli": ("openstack stack", "openstack orchestration"),
            # What a stack says it owns, beside what Nova and Cinder say they hold.
            "first_scene": {"scene": "heat-baseline", "exporter": ("compute", "volume"), "calls": ("nova-servers", "cinder-volumes")},
        }, {
            "scene_prefix": "magnum-",
            "exporter": ("container-infra",),
            "calls": ("magnum-",),
            "cli": ("openstack coe",),
            # A real cluster's stack and server, which is what its link to Kubernetes joins on.
            "first_scene": {"scene": "magnum-real-image", "exporter": ("compute", "orchestration"), "calls": ("nova-servers",), "cli": ("openstack server",)},
        },),
    },
    "services-manila": {
        "parts": ({
            "exporter": ("sharev2",),
            "calls": ("manila-",),
            "cli": ("openstack share",),
        },),
    },
    "services-designate-barbican-swift": {
        "notes": ("barbican-no-exporter.txt",),
        "parts": ({
            "scene_prefix": "designate-",
            "exporter": ("dns",),
            "calls": ("designate-",),
            "cli": ("openstack zone", "openstack recordset", "openstack dns"),
        }, {
            "scene_prefix": "barbican-",
            "exporter": (),
            "calls": ("barbican-",),
            "cli": ("openstack secret",),
        }, {
            "scene_prefix": "swift-",
            "exporter": ("object-store",),
            "calls": ("swift-",),
            "cli": ("openstack container", "openstack object"),
        },),
    },
    "services-trove": {
        "parts": ({
            "exporter": ("database",),
            "calls": ("trove-",),
            "cli": ("openstack database", "openstack datastore"),
        },),
    },
    "services-gnocchi": {
        "parts": ({
            "exporter": ("gnocchi",),
            "calls": ("gnocchi-",),
            "cli": ("gnocchi ",),
        },),
    },
}

# Names other things in the repository read a fixture folder by.
RESERVED_SCENES = ("healthy", "access")

TOKEN = re.compile(r"gAAAA[A-Za-z0-9_=-]+")
TOKEN_HEADER = re.compile(r'("?(?:X-Auth-Token|x-auth-token|x-subject-token)"?\s*[:=]\s*"?)[^"\s,]+', re.IGNORECASE)
ADDRESS_URL = re.compile(r"https?://[0-9]{1,3}(?:\.[0-9]{1,3}){3}(?::[0-9]+)?")
# Every item's own links are most of an OpenStack answer's bytes, and change nothing it says.
TRIMMED = ("links",)


def runner_of(folder):
    """The runner's names and address, as services-lib.sh wrote them, longest first."""
    path = os.path.join(folder, "runner-names.txt")
    if not os.path.isfile(path):
        return []
    with open(path, errors="replace") as handle:
        names = [line.strip() for line in handle if line.strip()]
    return sorted(set(names), key=len, reverse=True)


def stand_in(name):
    if re.fullmatch(r"[0-9]{1,3}(?:\.[0-9]{1,3}){3}", name):
        return "203.0.113.10"
    return "compute-01.example.internal" if "." in name else "compute-01"


def scrub(text, runner):
    text = TOKEN.sub("REDACTED-TOKEN", text)
    text = TOKEN_HEADER.sub(r"\1REDACTED-TOKEN", text)
    text = ADDRESS_URL.sub("https://openstack.example", text)
    for name in runner:
        text = text.replace(name, stand_in(name))
    return text


def read(path):
    with open(path, errors="replace") as handle:
        return handle.read()


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as handle:
        handle.write(text)


def trim(value):
    if isinstance(value, dict):
        return {key: trim(item) for key, item in value.items() if key not in TRIMMED}
    if isinstance(value, list):
        return [trim(item) for item in value]
    return value


def parts_of(group, scene):
    """The parts of a group this scene is about."""
    return [
        part
        for part in GROUPS[group]["parts"]
        if scene.startswith(part.get("scene_prefix", ""))
    ]


def wanted(scene, parts):
    """What to keep of a scene: exporter services, call prefixes, and CLI commands."""
    exporter, calls, cli = [], [], []
    for part in parts:
        exporter += part["exporter"]
        calls += part["calls"]
        cli += part["cli"]
        first = part.get("first_scene")
        if first and first["scene"] == scene:
            exporter += first["exporter"]
            calls += first["calls"]
            cli += first.get("cli", ())
    return tuple(exporter), tuple(calls), tuple(cli)


def import_exporter(source, target, services, runner):
    if not os.path.isdir(source):
        return
    for service in services:
        path = os.path.join(source, f"{service}.prom")
        if os.path.isfile(path):
            write(os.path.join(target, f"{service}.prom"), scrub(read(path), runner))
        # What another clouds.yaml entry got of the same service.
        for name in sorted(os.listdir(source)):
            if name.startswith(f"{service}-as-") and name.endswith(".prom"):
                write(os.path.join(target, name), scrub(read(os.path.join(source, name)), runner))
    path = os.path.join(source, "status.txt")
    if os.path.isfile(path):
        # Every service asked about, whether this cloud runs it or not: what a scrape of one it
        # does not run costs is part of what this says.
        write(os.path.join(target, "status.txt"), scrub(read(path), runner))


def import_calls(source, target, calls, runner):
    folder = os.path.join(source, "api")
    if not os.path.isdir(folder):
        return []
    kept = []
    for name in sorted(os.listdir(folder)):
        if not name.startswith(calls):
            continue
        path = os.path.join(folder, name)
        text = read(path)
        if name.endswith(".json"):
            try:
                text = json.dumps(trim(json.loads(text)))
            except ValueError:
                pass  # An error page is a recording too, and has nothing to trim.
        write(os.path.join(target, "api", name), scrub(text, runner))
        kept.append(name)
    return kept


def import_status(source, target, calls, runner):
    path = os.path.join(source, "api-status.txt")
    if not os.path.isfile(path):
        return
    lines = []
    for line in read(path).splitlines():
        fields = line.split()
        # Only the code and the call: the rest names the runner's own address.
        if len(fields) >= 2 and fields[1].startswith(calls):
            lines.append(f"{fields[0]} {fields[1]}")
    if lines:
        write(os.path.join(target, "api-status.txt"), scrub("\n".join(lines) + "\n", runner))


def import_cli(source, target, commands, runner):
    path = os.path.join(source, "cli.txt")
    if not os.path.isfile(path) or not commands:
        return
    prefixes = tuple(f"$ {command}" for command in commands)
    kept, keeping = [], False
    for line in read(path).splitlines():
        if line.startswith("$ "):
            keeping = line.startswith(prefixes)
        if keeping:
            kept.append(line)
    if kept:
        write(os.path.join(target, "cli.txt"), scrub("\n".join(kept) + "\n", runner))


def import_recon(source, target, runner):
    folder = os.path.join(source, "recon")
    if not os.path.isdir(folder):
        return
    for name in sorted(os.listdir(folder)):
        path = os.path.join(folder, name)
        if os.path.isfile(path):
            write(os.path.join(target, "recon", name), scrub(read(path), runner))


def service_of(resource_metrics):
    for scope in resource_metrics.get("scopeMetrics", []):
        for metric in scope.get("metrics", []):
            if metric.get("name") != "up":
                continue
            points = (metric.get("gauge") or metric.get("sum") or {}).get("dataPoints", [])
            for attribute in (points[0].get("attributes", []) if points else []):
                if attribute.get("key") == "openstack_service":
                    return attribute["value"].get("stringValue")
    return None


def series_in(resource_metrics):
    return sum(len(scope.get("metrics", [])) for scope in resource_metrics.get("scopeMetrics", []))


def import_otlp(folder, target, group, runner):
    """The fullest export of each of this group's services, and one of a service it lacks.

    The second is the point of it: an empty scrape, whose `up` reads 1, is what every cloud
    without one of these services sends OneUptime.
    """
    path = os.path.join(folder, "otlp", "metrics.json")
    if not os.path.isfile(path):
        return
    mine = set()
    for part in GROUPS[group]["parts"]:
        mine.update(part["exporter"])
    core = {"identity", "compute", "placement", "network", "volume", "image", "libvirt", "ceilometer"}
    chosen, absent = {}, None
    with open(path, errors="replace") as handle:
        for line in handle:
            try:
                export = json.loads(line)
            except ValueError:
                continue
            for resource_metrics in export.get("resourceMetrics", []):
                service = service_of(resource_metrics)
                if not service:
                    continue
                if service in mine:
                    if service not in chosen or series_in(resource_metrics) > series_in(chosen[service]):
                        chosen[service] = resource_metrics
                elif service not in core and absent is None:
                    absent = resource_metrics
    if absent is not None:
        chosen[service_of(absent)] = absent
    if chosen:
        text = json.dumps({"resourceMetrics": [chosen[key] for key in sorted(chosen)]}, indent=0)
        write(os.path.join(target, "otlp.json"), scrub(text, runner))


def import_access(folder, target, group, runner):
    """access-matrix.sh on this cloud. Never named "access": see the top of this file."""
    source = os.path.join(folder, "access")
    if not os.path.isdir(source):
        return
    for name in ("matrix-default-policy.json", "matrix.json", "matrix-access-rules.json"):
        path = os.path.join(source, name)
        if os.path.isfile(path):
            write(os.path.join(target, "access-check", name), scrub(read(path), runner))
    services = set()
    for part in GROUPS[group]["parts"]:
        services.update(part["exporter"])
    exporter = os.path.join(source, "exporter")
    if not os.path.isdir(exporter):
        return
    for level in sorted(os.listdir(exporter)):
        status = os.path.join(exporter, level, "status.txt")
        if os.path.isfile(status):
            write(os.path.join(target, "access-check", "exporter", f"{level}.txt"), scrub(read(status), runner))
        for service in sorted(services):
            path = os.path.join(exporter, level, f"{service}.prom")
            if os.path.isfile(path):
                write(os.path.join(target, "access-check", "exporter", level, f"{service}.prom"), scrub(read(path), runner))


def import_group(group, folder, fixtures):
    runner = runner_of(folder)
    scenes = sorted(
        name for name in os.listdir(folder)
        if os.path.isfile(os.path.join(folder, name, "how.txt"))
    )
    if not scenes:
        print(f"{group}: no scene in it, so leaving it out", file=sys.stderr)
        return False
    for scene in scenes:
        if scene in RESERVED_SCENES:
            raise SystemExit(f"{group}: a scene cannot be called {scene}: see the top of this script.")

    target = os.path.join(fixtures, group)
    shutil.rmtree(target, ignore_errors=True)
    left_out = []
    first_with_exporter = True
    for scene in scenes:
        source = os.path.join(folder, scene)
        if os.path.exists(os.path.join(source, "failed.txt")):
            left_out.append(scene)
            continue
        parts = parts_of(group, scene)
        exporter, calls, cli = wanted(scene, parts)
        scene_target = os.path.join(target, scene)
        write(os.path.join(scene_target, "how.txt"), scrub(read(os.path.join(source, "how.txt")), runner))
        import_exporter(os.path.join(source, "exporter"), os.path.join(scene_target, "exporter"), exporter, runner)
        # The exporter's last non-alpha release is compared once: what differs is the same in each.
        if first_with_exporter and os.path.isdir(os.path.join(source, "exporter-stable")):
            import_exporter(os.path.join(source, "exporter-stable"), os.path.join(scene_target, "exporter-stable"), exporter, runner)
            first_with_exporter = False
        if calls:
            import_calls(source, scene_target, calls, runner)
            import_status(source, scene_target, calls, runner)
        import_cli(source, scene_target, cli, runner)
        import_recon(source, scene_target, runner)

    path = os.path.join(folder, "scenes.txt")
    if os.path.isfile(path):
        write(os.path.join(target, "scenes.txt"), scrub(read(path), runner))
    for note in GROUPS[group].get("notes", ()):
        path = os.path.join(folder, note)
        if os.path.isfile(path):
            write(os.path.join(target, note), scrub(read(path), runner))
    import_otlp(folder, target, group, runner)
    import_access(folder, target, group, runner)

    total = sum(
        os.path.getsize(os.path.join(root, name))
        for root, _, names in os.walk(target)
        for name in names
    )
    kept = len(scenes) - len(left_out)
    print(f"{group}: {kept} scenes, {total // 1024} KiB" + (f", left out {', '.join(left_out)}" if left_out else ""))
    return True


def main():
    recordings, fixtures = sys.argv[1], sys.argv[2]
    found = False
    for entry in sorted(os.listdir(recordings)):
        if not entry.startswith("openstack-recording-services-"):
            continue
        group = entry[len("openstack-recording-"):]
        if group not in GROUPS:
            raise SystemExit(f"{group} is not a group this script knows: add it to GROUPS.")
        found = import_group(group, os.path.join(recordings, entry), fixtures) or found
    if not found:
        raise SystemExit(f"No services recording in {recordings}: nothing to import.")


if __name__ == "__main__":
    main()
