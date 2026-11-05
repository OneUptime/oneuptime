#!/usr/bin/env python3
"""Lifts the commands a person copies out of the agent's docs page, so the rig runs them as written.

Usage: agent-install-docs.py <docs page> <folder> <this OneUptime's URL> <InstallScripts.ts>

Writes one script per block into <folder>, with the page's https://oneuptime.com replaced by the
URL given, as the page tells a self-hosted reader to. A block that moved or changed shape stops the
rig here, on a line saying which, rather than leaving it to test something nobody reads.

Also writes served-files.txt, the files a real OneUptime serves for this agent, so the stand-in
serves those and no others.
"""

import pathlib
import re
import sys

SERVED = "https://oneuptime.com"


def section(page, heading):
    """A section runs to the next heading of its level or higher. A "# comment" in a code block is no heading."""
    lines = page.split("\n")
    start = lines.index(heading)
    level = len(heading) - len(heading.lstrip("#"))
    body, fenced = [], False
    for line in lines[start + 1 :]:
        if line.startswith("```"):
            fenced = not fenced
        match = None if fenced else re.match(r"^(#{1,6})\s", line)
        if match and len(match.group(1)) <= level:
            break
        body.append(line)
    return "\n".join(body)


def tab(text, name):
    """One tab of a ":::tabs" block, up to the next tab or the ":::" that closes the block."""
    lines = text.split("\n")
    start = lines.index("@tab " + name)
    body, fenced, depth = [], False, 0
    for line in lines[start + 1 :]:
        if line.startswith("```"):
            fenced = not fenced
        elif not fenced:
            if line.startswith("@tab ") and depth == 0:
                break
            if line.strip() == ":::":
                if depth == 0:
                    break
                depth -= 1
            elif line.startswith(":::"):
                depth += 1
        body.append(line)
    return "\n".join(body)


def blocks(text):
    return re.findall(r"^```bash\n(.*?)\n```$", text, re.S | re.M)


def only(found, what):
    if len(found) != 1:
        raise SystemExit(f"Expected one block for {what} on the docs page, and found {len(found)}.")
    return found[0]


def starting(found, start, what):
    return only([block for block in found if block.startswith(start)], what)


def served_files(catalog):
    """What InstallScripts.ts lists for the agent. Two of the names are constants there."""
    entry = catalog[catalog.index("name: InstallScriptName.OpenStackAgent") :]
    listed = entry[entry.index("files: [") : entry.index("],", entry.index("files: ["))]
    names = re.findall(r'^\s*"([^"]+)",$', listed, re.M)
    if "INSTALL_SCRIPT_FILE" not in listed or "TROUBLESHOOT_SCRIPT_FILE" not in listed or not names:
        raise SystemExit("InstallScripts.ts no longer lists the agent's files as this reads them.")
    return ["install.sh", "troubleshoot.sh", *names]


def main():
    page = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
    out = pathlib.Path(sys.argv[2])
    url = sys.argv[3].rstrip("/")
    install = section(page, "### Install and start the agent")
    uninstall = blocks(section(page, "## Uninstalling the agent"))
    upgrade = blocks(section(page, "## Upgrading the agent"))
    troubleshooting = section(page, "## Troubleshooting")

    written = {
        "install-docker.sh": only(blocks(tab(install, "install.sh")), "the install script"),
        "install-without-docker.sh": only(blocks(tab(install, "Without Docker")), "the install without Docker"),
        "check-running.sh": only(blocks(section(page, "### Check the agent is running")), "checking it runs"),
        "systemd-unit.sh": only(blocks(section(page, "## Run as a systemd service")), "the systemd unit"),
        "upgrade.sh": starting(upgrade, "curl -fsSL ", "the upgrade"),
        "uninstall-docker.sh": starting(uninstall, "cd /opt", "the uninstall"),
        "uninstall-systemd-unit.sh": starting(
            uninstall, "sudo systemctl disable --now oneuptime-openstack-agent\n", "taking the systemd unit away"
        ),
        "uninstall-without-docker.sh": starting(
            uninstall, "sudo systemctl disable --now oneuptime-openstack-agent oneuptime-openstack-exporter",
            "the uninstall without Docker",
        ),
        "troubleshoot.sh": only(blocks(troubleshooting), "the diagnostic script"),
    }
    for name, text in written.items():
        (out / name).write_text(text.replace(SERVED, url) + "\n", encoding="utf-8")
    catalog = pathlib.Path(sys.argv[4]).read_text(encoding="utf-8")
    (out / "served-files.txt").write_text("\n".join(served_files(catalog)) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
