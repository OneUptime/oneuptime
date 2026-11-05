#!/usr/bin/env python3
"""Copy what the usage tests replay out of a downloaded recording, into the repository.

Only usage's own scenes, under <release>/usage/: import-recording.py rewrites a release's whole
folder, and these come from a run of their own.

    gh run download <run id> --pattern 'openstack-usage-recording-*' --dir /tmp/recordings
    python3 -I import-usage-recording.py /tmp/recordings packages/Common/Tests/Fixtures/OpenStack

Standard library only, and it reads a recording as data: nothing in one is run.
"""
import os
import re
import shutil
import sys

SCENES = (
    "usage-start",
    "usage-before-resize",
    "usage-after-resize",
    "usage-before-delete",
    "usage-after-delete",
    "usage-end",
)

EXPORTER_SERVICES = ("identity", "compute", "placement", "network", "volume", "image")
API_CALLS = (
    "nova-servers",
    "cinder-volumes",
    "cinder-snapshots",
    "glance-images",
    "neutron-floatingips",
)
# The last reading is kept whole, so a probe's real read can replay it: which image each instance
# booted from, which volume came from which image, and how old a snapshot is. The same answers
# import-recording.py keeps of a scene, and about 300 KiB.
WHOLE_SCENE = "usage-end"
WHOLE_SCENE_API_CALLS = (
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
COMMANDS = (
    "unattached-volume",
    "spare-floating-ip",
    "shut-off-instance",
    "unused-image",
    "old-snapshot",
    "movable-host",
    "movable-host-instances",
)


def runner_hostnames(folder):
    """The runner's own name, so a recording diffs cleanly between runs."""
    names = set()
    for scene in SCENES:
        path = os.path.join(folder, scene, "exporter", "compute.prom")
        if not os.path.isfile(path):
            continue
        with open(path, errors="replace") as handle:
            for match in re.finditer(r'hostname="([^"]+)"', handle.read()):
                if not match.group(1).startswith("ou-use"):
                    names.add(match.group(1))
                    names.add(match.group(1).split(".")[0])
    return names


def copy_text(source, target, names):
    if not os.path.isfile(source):
        print(f"  missing: {source}")
        return
    with open(source, errors="replace") as handle:
        text = handle.read()
    # The longest first, because a runner's short name is how its full one starts.
    for name in sorted(names, key=len, reverse=True):
        text = text.replace(name, "compute-01.example.internal" if "." in name else "compute-01")
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "w") as handle:
        handle.write(text)


def copy_status(source, target):
    # Only the code and the call: the rest names the runner's own address.
    with open(source, errors="replace") as handle:
        lines = [" ".join(line.split()[:2]) for line in handle if line.strip()]
    with open(target, "w") as handle:
        handle.write("\n".join(lines) + "\n")


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        return 1

    downloads, fixtures = sys.argv[1], sys.argv[2]

    for artifact in sorted(os.listdir(downloads)):
        if not artifact.startswith("openstack-usage-recording-"):
            continue

        release = artifact[len("openstack-usage-recording-") :]
        folder = os.path.join(downloads, artifact)
        target = os.path.join(fixtures, release, "usage")
        names = runner_hostnames(folder)

        if os.path.isdir(target):
            shutil.rmtree(target)

        print(f"{release}: {sorted(names)}")

        for scene in SCENES:
            for service in EXPORTER_SERVICES:
                copy_text(
                    os.path.join(folder, scene, "exporter", f"{service}.prom"),
                    os.path.join(target, scene, "exporter", f"{service}.prom"),
                    names,
                )
            for call in WHOLE_SCENE_API_CALLS if scene == WHOLE_SCENE else API_CALLS:
                copy_text(
                    os.path.join(folder, scene, "api", f"{call}.json"),
                    os.path.join(target, scene, "api", f"{call}.json"),
                    names,
                )
            if scene == WHOLE_SCENE:
                copy_status(
                    os.path.join(folder, scene, "api-status.txt"),
                    os.path.join(target, scene, "api-status.txt"),
                )
            copy_text(
                os.path.join(folder, scene, "recorded-at.txt"),
                os.path.join(target, scene, "recorded-at.txt"),
                names,
            )

        for command in COMMANDS:
            copy_text(
                os.path.join(folder, "usage-commands", f"{command}.txt"),
                os.path.join(target, "commands", f"{command}.txt"),
                names,
            )

    return 0


if __name__ == "__main__":
    sys.exit(main())
