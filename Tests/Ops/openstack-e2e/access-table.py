#!/usr/bin/env python3
"""The docs' tables of what each level of access gets, from what real clouds answered.

access-matrix.sh records each release in
packages/Common/Tests/Fixtures/OpenStack/<release>/access/:

    matrix-access-rules.json     level 1: an application credential on an admin
                                 account, limited by access rules
    matrix.json                  level 2: oneuptime_monitoring and reader, on a project
                                 that holds nothing, with the policy overrides
    matrix-default-policy.json   level 3: plain reader on a real project, default policy
    exporter/<level>.txt         what the agent's exporter got with each of them

The tables on the agent's docs page, its README and its in-app guide are this script's
output, so they are never written from memory. OpenStackAgentAccessTable.test.js fails
when one of them differs. After a new recording, run this and paste what it prints.

A cell is what the recordings can show, and no more:

    all               the same rows an admin saw
    own project only  fewer rows than an admin saw, or rows that depend on the project
                      the credential is on: that project's own, and anything shared
    refused           401 or 403
    what anyone sees  every credential saw every row with default policy. The recorded
                      clouds hold only public flavors, volume types and images
    nothing           a 200 with no rows, on a project that holds some or one that doesn't
    none recorded     a 200 with no rows, where an admin saw none either: there was
                      nothing to tell by
    409, expected     Neutron's answer to an empty project with zero quota

Where releases disagree, the cell says which said what. Only standard library, because
this runs wherever the recordings are.

    access-table.py [--series] [fixtures folder]
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.join(HERE, "..", "..", "..", "packages", "Common", "Tests", "Fixtures", "OpenStack")

ALL = "all"
OWN = "own project only"
REFUSED = "refused"
ANYONE = "what anyone sees"
NOTHING = "nothing"
NONE_RECORDED = "none recorded"
QUOTA_CONFLICT = "409, expected"

SERVICE_NAMES = {
    "identity": "Keystone",
    "compute": "Nova",
    "placement": "Placement",
    "network": "Neutron",
    "block-storage": "Cinder",
    "image": "Glance",
    "load-balancer": "Octavia",
    "baremetal": "Ironic",
}

ACCESS_RULES = "matrix-access-rules"
OVERRIDES = "matrix"
DEFAULT_POLICY = "matrix-default-policy"

ADMIN = "admin"
LEVEL_1 = "monitoring-admin-get"
LEVEL_2 = "monitoring-role"
LEVEL_2_ON_A_REAL_PROJECT = "role-on-a-project"
LEVEL_3 = "reader"

LEVEL_NAMES = ["Level 1: Full view", "Level 2: Infrastructure only", "Level 3: Project view"]

# Beside an admin, because level 1 is measured against one.
SERIES_LEVELS = [
    ("Admin", "admin"),
    (LEVEL_NAMES[0], LEVEL_1),
    (LEVEL_NAMES[1], LEVEL_2),
    (LEVEL_NAMES[2], LEVEL_3),
]


def releases_in(folder):
    found = []
    for name in sorted(os.listdir(folder)):
        if os.path.isdir(os.path.join(folder, name, "access")):
            found.append(name)
    if not found:
        raise SystemExit(f"No recordings in {folder}: nothing to make a table from.")
    return found


# "gazpacho-ovn" is Gazpacho: its network backend does not change what a credential reads.
def release_name(release):
    return release.split("-")[0].capitalize()


def read_matrices(folder, release):
    matrices = {}
    for name in (ACCESS_RULES, OVERRIDES, DEFAULT_POLICY):
        with open(os.path.join(folder, release, "access", f"{name}.json")) as handle:
            matrices[name] = {
                (row["service"], row["read"]): row["results"]
                for row in json.load(handle)["reads"]
            }
    return matrices


def answered(result):
    return result["status"] == 200


# Every credential saw every row with default policy, and there were rows to see.
def open_to_anyone(default_policy):
    admin = default_policy[ADMIN]["count"]
    return bool(admin) and all(
        answered(result) and result["count"] >= admin
        for name, result in default_policy.items()
    )


def refused_or_conflict(result):
    if result["status"] in (401, 403):
        return REFUSED
    if result["status"] == 409:
        return QUOTA_CONFLICT
    # A service that was failing says nothing about the credential, and a table must not.
    raise SystemExit(f"HTTP {result['status']} in a recording: record it again.")


def cell_for_admin_role(results):
    mine = results[LEVEL_1]
    if not answered(mine):
        return refused_or_conflict(mine)
    return ALL if mine["count"] >= results[ADMIN]["count"] else OWN


# The credential, the same access on a project that holds other things, and what default
# policy gave. A list that answers differently from one project to another is per project,
# however many rows it happened to show.
def cell_below_admin(results, credential, twin, default_policy):
    mine = results[credential]
    if not answered(mine):
        return refused_or_conflict(mine)
    count = mine["count"]
    admin = results[ADMIN]["count"]
    other = results[twin]
    other_count = other["count"] if answered(other) else None

    if not admin:
        # No rows anywhere. One a plain reader is refused and this credential is not has
        # been opened by a policy override, which is all such a list needs. Any other
        # was going to answer anyway, and there was nothing to tell by.
        opened = not answered(default_policy[LEVEL_3])
        return ALL if opened else NONE_RECORDED
    if count < admin:
        return NOTHING if not count and not other_count else OWN
    if other_count != count:
        return OWN
    return ANYONE if open_to_anyone(default_policy) else ALL


def cells_of(matrices, key):
    default_policy = matrices[DEFAULT_POLICY][key]
    return [
        cell_for_admin_role(matrices[ACCESS_RULES][key]),
        cell_below_admin(matrices[OVERRIDES][key], LEVEL_2, LEVEL_2_ON_A_REAL_PROJECT, default_policy),
        cell_below_admin(default_policy, LEVEL_3, LEVEL_2, default_policy),
    ]


# One label for all releases, or which said what.
def agreed(cells_by_release):
    labels = []
    for release, label in cells_by_release:
        if label not in labels:
            labels.append(label)
    if len(labels) == 1:
        return labels[0]
    parts = []
    for label in labels:
        names = []
        for release, said in cells_by_release:
            name = release_name(release)
            if said == label and name not in names:
                names.append(name)
        parts.append(f"{label} on {', '.join(names)}")
    return "; ".join(parts)


def table_row(cells):
    return "| " + " | ".join(cells) + " |"


def reads_table(folder):
    releases = releases_in(folder)
    matrices = {release: read_matrices(folder, release) for release in releases}
    first = matrices[releases[0]][OVERRIDES]
    for release in releases[1:]:
        if list(matrices[release][OVERRIDES]) != list(first):
            raise SystemExit(f"{release} recorded other reads than {releases[0]}: record it again.")

    lines = [table_row(["Read", *LEVEL_NAMES]), table_row(["---"] * 4)]
    for key in first:
        by_release = [cells_of(matrices[release], key) for release in releases]
        cells = [
            agreed([(release, by_release[index][level]) for index, release in enumerate(releases)])
            for level in range(3)
        ]
        service, label = key
        lines.append(table_row([f"{SERVICE_NAMES.get(service, service)}: {label}", *cells]))
    return "\n".join(lines)


# "identity 200 14 series", one line per service.
def series_of(folder, release, level):
    series = {}
    with open(os.path.join(folder, release, "access", "exporter", f"{level}.txt")) as handle:
        for line in handle:
            match = re.fullmatch(r"(\S+) (\d+) (\d+) series\n?", line)
            if not match:
                raise SystemExit(f"{release} {level}: cannot read {line!r}")
            if match.group(2) != "200":
                raise SystemExit(f"{release} {level}: the exporter answered {line.strip()}")
            series[match.group(1)] = int(match.group(3))
    return series


# A count that varies with what the cloud held when it was asked is a range.
def span(counts):
    low, high = min(counts), max(counts)
    return str(low) if low == high else f"{low} to {high}"


def series_table(folder):
    releases = releases_in(folder)
    recorded = {
        level: [series_of(folder, release, level) for release in releases]
        for _, level in SERIES_LEVELS
    }
    services = list(recorded[ADMIN][0])
    lines = [
        table_row(["Exporter service", *[name for name, _ in SERIES_LEVELS]]),
        table_row(["---"] * (len(SERIES_LEVELS) + 1)),
    ]
    for service in services:
        lines.append(table_row([
            service,
            *[span([one[service] for one in recorded[level]]) for _, level in SERIES_LEVELS],
        ]))
    return "\n".join(lines)


def main():
    arguments = sys.argv[1:]
    series = "--series" in arguments
    arguments = [argument for argument in arguments if argument != "--series"]
    folder = arguments[0] if arguments else FIXTURES
    print(series_table(folder) if series else reads_table(folder))


if __name__ == "__main__":
    main()
