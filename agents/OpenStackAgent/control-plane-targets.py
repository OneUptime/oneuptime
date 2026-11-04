#!/usr/bin/env python3
"""Turn Kolla-Ansible's rendered prometheus.yml into settings for the OpenStack agent.

Kolla-Ansible already runs an exporter for each thing under the cloud, and its Prometheus
already knows where every one of them is. So this reads that, rather than asking anyone to
type the address of each compute node:

    sudo cat /etc/kolla/prometheus-server/prometheus.yml \
      | python3 control-plane-targets.py --region RegionOne >> .env

Then `docker compose up -d` in the agent's folder. openstack-exporter's own job is printed
as a comment, because reading it means going without what exporter 1.7.0 does not say, and
that is a choice: README.md says what.

A line at a time rather than with a YAML parser, because this runs on a host that may have
none, and the file is one Kolla-Ansible generates: each job names itself, then its targets.

Only standard library, as access-rules-for-cloud.py is.
"""
import argparse
import re
import sys

# Kolla-Ansible's job names, from ansible/roles/prometheus/templates/prometheus.yml.j2.
VARIABLE_OF_JOB = {
    "rabbitmq": "OPENSTACK_RABBITMQ_TARGETS",
    "mysqld": "OPENSTACK_MARIADB_TARGETS",
    "memcached": "OPENSTACK_MEMCACHED_TARGETS",
    "haproxy": "OPENSTACK_HAPROXY_TARGETS",
    "network_exporter": "OPENSTACK_NETWORK_EXPORTER_TARGETS",
    "libvirt_exporter": "OPENSTACK_LIBVIRT_HEALTH_TARGETS",
}
SINGLE_CLOUD_EXPORTER_JOB = "openstack_exporter"
SINGLE_CLOUD_EXPORTER_VARIABLE = "OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS"

# A key at the top of the file ends the scrape jobs: the targets under `alerting:` are
# Alertmanager's, and must not land on whichever job came last.
TOP_LEVEL_KEY = re.compile(r"^[A-Za-z_]")
JOB = re.compile(r"""^\s*-?\s*job_name:\s*['"]?([\w.-]+)['"]?\s*$""")
TARGET = r"""(?:\[[0-9A-Fa-f:.]+\]|[^'"\s,\[\]]+):\d+"""
LIST_ITEM = re.compile(r"""^\s*-\s*['"]?(""" + TARGET + r""")['"]?\s*$""")
FLOW_LIST = re.compile(r"""^\s*-?\s*targets:\s*\[(.*)\]\s*$""")


def targets_by_job(lines):
    found = {}
    job = None
    for line in lines:
        if TOP_LEVEL_KEY.match(line):
            job = None
            continue
        named = JOB.match(line)
        if named:
            job = named.group(1)
            continue
        if job is None:
            continue
        flow = FLOW_LIST.match(line)
        if flow:
            found.setdefault(job, []).extend(
                item.strip().strip("'\"")
                for item in flow.group(1).split(",")
                if item.strip()
            )
            continue
        item = LIST_ITEM.match(line)
        if item:
            found.setdefault(job, []).append(item.group(1))
    return found


def as_list(targets):
    # In double quotes for IPv6, as install.sh writes it: a bare [ opens a list in the list.
    written = [f'"{target}"' if target.startswith("[") else target for target in targets]
    return f"[{','.join(written)}]"


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--region",
        help="The region these run in, which a multi-region cloud has one of per file.",
    )
    arguments = parser.parse_args()

    found = targets_by_job(sys.stdin.read().splitlines())
    if not found:
        print(
            "No scrape jobs found: this reads the prometheus.yml Kolla-Ansible rendered.",
            file=sys.stderr,
        )
        sys.exit(1)

    if arguments.region:
        print(f"OPENSTACK_CONTROL_PLANE_REGION={arguments.region}")

    for job, variable in VARIABLE_OF_JOB.items():
        targets = found.get(job)
        if targets:
            print(f"{variable}={as_list(targets)}")
        else:
            # Said rather than left out: the Control Plane card will say it is not watched.
            print(f"# {variable}: Kolla-Ansible's Prometheus has no {job} job.")

    exporter = found.get(SINGLE_CLOUD_EXPORTER_JOB)
    if exporter:
        print("# To read its openstack-exporter rather than the agent's own, take these out")
        print("# of the comment, knowing what exporter 1.7.0 does not say (see README.md):")
        print(f"# {SINGLE_CLOUD_EXPORTER_VARIABLE}={as_list(exporter)}")
        print("# OPENSTACK_EXPORTER_CLOUDS=[]")


if __name__ == "__main__":
    main()
