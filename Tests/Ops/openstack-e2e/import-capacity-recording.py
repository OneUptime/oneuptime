#!/usr/bin/env python3
"""Copy what the capacity tests replay out of a downloaded recording, into the repository.

Only capacity's own scenes, under <release>/capacity/: import-recording.py rewrites a release's
whole folder, and these come from a run of their own.

    gh run download <run id> --pattern 'openstack-capacity-recording-*' --dir /tmp/recordings
    python3 -I import-capacity-recording.py /tmp/recordings packages/Common/Tests/Fixtures/OpenStack

Standard library only, and it reads a recording as data: nothing in one is run.
"""
import os
import re
import shutil
import sys

SCENES = (
    "capacity-healthy",
    "capacity-host-lost",
    "capacity-host-disabled",
    "capacity-orphan",
    "capacity-orphan-fixed",
)

EXPORTER_SERVICES = ("compute", "placement")
API_CALLS = ("nova-aggregates", "nova-services", "nova-hypervisors", "nova-servers")


def runner_names(folder):
    for scene in SCENES:
        path = os.path.join(folder, scene, "exporter", "compute.prom")
        if not os.path.isfile(path):
            continue
        with open(path, errors="replace") as handle:
            text = handle.read()
        for match in re.finditer(
            r'openstack_nova_vcpus_used\{[^}]*hostname="([^"]+)"', text
        ):
            if not match.group(1).startswith("ou-cap"):
                full = match.group(1)
                return full.split(".")[0], full
    return None, None


def rename(text, short, full):
    # The full name first, because it starts with the short one.
    if full:
        text = text.replace(full, "compute-01.example.internal")
    if short:
        text = text.replace(short, "compute-01")
    return text


def write_text(target, text):
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "w") as handle:
        handle.write(text)


def copy_folder(source, target, short, full):
    if not os.path.isdir(source):
        return
    for name in sorted(os.listdir(source)):
        with open(os.path.join(source, name), errors="replace") as handle:
            text = handle.read()
        write_text(os.path.join(target, rename(name, short, full)), rename(text, short, full))


def main():
    recordings, fixtures = sys.argv[1], sys.argv[2]
    for entry in sorted(os.listdir(recordings)):
        if not entry.startswith("openstack-capacity-recording-"):
            continue
        release = entry[len("openstack-capacity-recording-") :]
        folder = os.path.join(recordings, entry)
        short, full = runner_names(folder)
        if not short:
            continue
        target = os.path.join(fixtures, release, "capacity")
        shutil.rmtree(target, ignore_errors=True)
        for scene in SCENES:
            source = os.path.join(folder, scene)
            if not os.path.isdir(source):
                continue
            into = os.path.join(target, scene[len("capacity-") :])
            for service in EXPORTER_SERVICES:
                path = os.path.join(source, "exporter", f"{service}.prom")
                if os.path.isfile(path):
                    with open(path, errors="replace") as handle:
                        write_text(
                            os.path.join(into, "exporter", f"{service}.prom"),
                            rename(handle.read(), short, full),
                        )
            for call in API_CALLS:
                path = os.path.join(source, "api", f"{call}.json")
                if os.path.isfile(path):
                    with open(path, errors="replace") as handle:
                        write_text(
                            os.path.join(into, "api", f"{call}.json"),
                            rename(handle.read(), short, full),
                        )
            copy_folder(
                os.path.join(source, "placement"),
                os.path.join(into, "placement"),
                short,
                full,
            )
            copy_folder(
                os.path.join(source, "candidates"),
                os.path.join(into, "candidates"),
                short,
                full,
            )
            for name in ("nova-manage-audit.txt", "orphan-consumer.txt"):
                path = os.path.join(source, name)
                if os.path.isfile(path):
                    with open(path, errors="replace") as handle:
                        write_text(
                            os.path.join(into, name), rename(handle.read(), short, full)
                        )
        total = sum(
            os.path.getsize(os.path.join(root, name))
            for root, _, names in os.walk(target)
            for name in names
        )
        print(f"{release}: {total // 1024} KiB of capacity")


if __name__ == "__main__":
    main()
