#!/usr/bin/env python3
"""Copy what the OpenStack AI agent printed on a real cloud into the repository.

ai-agent-record.sh keeps each command's exact output. The tests read those outputs, so this
writes them under ai-agent/<release>/ of the fixtures, outside a release's own folder, because
import-recording.py rewrites that whole folder and these come from a run of their own.

    gh run download <run id> --name openstack-ai-agent --dir /tmp/ai-agent
    python3 -I import-ai-agent-recording.py /tmp/ai-agent packages/Common/Tests/Fixtures/OpenStack hibiscus-ovn

What ai-agent-fix.js did with real changes goes under fixes/. --only-fixes keeps the reads that
are already there, so a run that only adds changes doesn't rewrite them.

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

# What a run has to have left for its fixes to be kept.
FIX_FILES = (
    "writes-off.json",
    "enable-proposal.json",
    "enable-ladder.json",
    "enable-result.json",
    "enable-confirmed.txt",
    "evacuate-proposal.json",
    "evacuate-ladder.json",
    "evacuate-result.json",
    "evacuate-after.json",
    "least-privilege.json",
)

# A change's own record is named by its words, and an instance's ID says nothing to a reader.
ID_IN_A_NAME = re.compile(r"-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


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


def import_fixes(source, target, short):
    folder = os.path.join(source, "fixes")
    full = full_name_of(folder, short)
    kept = os.path.join(target, "fixes")
    shutil.rmtree(kept, ignore_errors=True)
    os.makedirs(kept)
    for name in sorted(os.listdir(folder)):
        with open(os.path.join(folder, name), errors="replace") as handle:
            text = handle.read()
        with open(os.path.join(kept, ID_IN_A_NAME.sub("", name)), "w") as handle:
            handle.write(rename(text, short, full))


def main():
    arguments = sys.argv[1:]
    only_fixes = "--only-fixes" in arguments
    arguments = [word for word in arguments if word != "--only-fixes"]
    if len(arguments) != 3:
        sys.exit(
            "Usage: import-ai-agent-recording.py <download> <fixtures> <release> [--only-fixes]"
        )
    download, fixtures, release = arguments
    source = os.path.join(download, "ai-agent")
    target = os.path.join(fixtures, "ai-agent", release)

    # Read first, so a refused run leaves what is already there as it was.
    summaries = {
        scene: summary_of(os.path.join(source, scene), scene) for scene in SCENES
    }
    has_fixes = os.path.isdir(os.path.join(source, "fixes"))
    for name in FIX_FILES:
        if has_fixes and not os.path.isfile(os.path.join(source, "fixes", name)):
            sys.exit(f"fixes: this run did not leave {name}, so nothing was imported.")
    if only_fixes and not has_fixes:
        sys.exit("fixes: this run made none, so nothing was imported.")

    if only_fixes:
        import_fixes(source, target, summaries["compute-down"]["host"])
        return

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
    if has_fixes:
        import_fixes(source, target, summaries["compute-down"]["host"])


if __name__ == "__main__":
    main()
