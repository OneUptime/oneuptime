#!/usr/bin/env python3
"""Copy what the OpenStack AI agent printed on a real cloud into the repository.

ai-agent-record.sh keeps each command's exact output. The tests read those outputs, so this
writes them under ai-agent/<release>/ of the fixtures, outside a release's own folder, because
import-recording.py rewrites that whole folder and these come from a run of their own.

    gh run download <run id> --name openstack-ai-agent --dir /tmp/ai-agent
    python3 -I import-ai-agent-recording.py /tmp/ai-agent packages/Common/Tests/Fixtures/OpenStack hibiscus-ovn

Standard library only, and it reads a recording as data: nothing in one is run. A run that
reported a problem, or a scene it did not reach, is refused rather than kept as what a real
cloud said.
"""
import json
import os
import re
import shutil
import sys

SCENES = ("healthy", "compute-down")


def rename(text, short, full):
    # The full name first, because it starts with the short one.
    if full:
        text = text.replace(full, "compute-01.example.internal")
    if short:
        text = text.replace(short, "compute-01")
    return text


def full_name_of(folder, short):
    """The runner's full name, read from what Nova said of its hypervisor."""
    for name in sorted(os.listdir(folder)):
        with open(os.path.join(folder, name), errors="replace") as handle:
            match = re.search(re.escape(short) + r"\.[A-Za-z0-9.-]+", handle.read())
        if match:
            return match.group(0)
    return None


def summary_of(folder, scene):
    path = os.path.join(folder, "summary.json")
    if not os.path.isfile(path):
        sys.exit(f"{scene}: this run did not reach it, so nothing was imported.")
    with open(path, errors="replace") as handle:
        summary = json.load(handle)
    if summary.get("problems"):
        sys.exit(f"{scene}: this run reported problems, so nothing was imported.")
    return summary


def main():
    if len(sys.argv) != 4:
        sys.exit("Usage: import-ai-agent-recording.py <download> <fixtures> <release>")
    download, fixtures, release = sys.argv[1:]
    source = os.path.join(download, "ai-agent")
    target = os.path.join(fixtures, "ai-agent", release)

    # Read first, so a refused run leaves what is already there as it was.
    summaries = {
        scene: summary_of(os.path.join(source, scene), scene) for scene in SCENES
    }

    shutil.rmtree(target, ignore_errors=True)
    for scene in SCENES:
        folder = os.path.join(source, scene)
        short = summaries[scene]["host"]
        full = full_name_of(folder, short)
        os.makedirs(os.path.join(target, scene))
        for name in sorted(os.listdir(folder)):
            if not name.endswith(".txt"):
                continue
            with open(os.path.join(folder, name), errors="replace") as handle:
                text = handle.read()
            with open(os.path.join(target, scene, name), "w") as handle:
                handle.write(rename(text, short, full))


if __name__ == "__main__":
    main()
