#!/usr/bin/env python3
"""Answers agent-install.sh's questions about what reached the stand-in OneUptime.

  agent-install-check.py <requests.jsonl> <since> reports <metric prefix>
      Has a metric starting so arrived since then? Prints the seconds to the first one.
  agent-install-check.py <requests.jsonl> <since> refused
      Has a batch with a bad key been refused since then?
  agent-install-check.py <requests.jsonl> <since> identity <cloud> <version> <region>
      Does every batch since then say this cloud, agent version and region, and carry neither
      service.name nor service.instance.id? Prints what is wrong with the first that does not.
  agent-install-check.py <requests.jsonl> <since> last <metric>
      The last value of that metric since then.
  agent-install-check.py <requests.jsonl> <since> summary
      How many batches, datapoints and metrics, per service.

<since> is seconds since the epoch. Each exits 0 for yes and 1 for no. Run with -I.
"""

import json
import sys

SERVICE_OF_PREFIX = {
    "openstack_identity_": "identity",
    "openstack_nova_": "compute",
    "openstack_placement_": "placement",
    "openstack_neutron_": "network",
    "openstack_cinder_": "volume",
    "openstack_glance_": "image",
}


def batches(path, since):
    try:
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                record = json.loads(line)
                if record["at"] >= since and record["path"] == "/otlp/v1/metrics":
                    yield record
    except FileNotFoundError:
        return


def reports(path, since, prefix):
    for record in batches(path, since):
        for resource in record.get("resources", []):
            for name in resource["metrics"]:
                if name.startswith(prefix):
                    print(round(record["at"] - since))
                    return 0
    return 1


def refused(path, since):
    return 0 if any(not record["keyAccepted"] for record in batches(path, since)) else 1


def identity(path, since, cloud, version, region):
    seen = 0
    for record in batches(path, since):
        if not record["keyAccepted"]:
            continue
        if "unreadable" in record:
            print(f"a batch could not be read: {record['unreadable']}")
            return 1
        for resource in record.get("resources", []):
            attributes = resource["attributes"]
            seen += 1
            wrong = []
            if attributes.get("openstack.cloud.name") != cloud:
                wrong.append(f"openstack.cloud.name is {attributes.get('openstack.cloud.name')!r}")
            if attributes.get("oneuptime.agent.version") != version:
                wrong.append(f"oneuptime.agent.version is {attributes.get('oneuptime.agent.version')!r}")
            for name in ("service.name", "service.instance.id"):
                if name in attributes:
                    wrong.append(f"it carries {name}")
            for metric, entry in resource["metrics"].items():
                if not metric.startswith("openstack_") or metric.startswith("openstack_exporter"):
                    continue
                if entry["regions"] != [region]:
                    wrong.append(f"{metric} says regions {entry['regions']}")
                    break
            if wrong:
                print("; ".join(wrong))
                return 1
    if not seen:
        print("no batch arrived")
        return 1
    return 0


def last(path, since, wanted):
    value = None
    for record in batches(path, since):
        for resource in record.get("resources", []):
            entry = resource["metrics"].get(wanted)
            if entry and entry["last"] is not None:
                value = entry["last"]
    if value is None:
        return 1
    print(value)
    return 0


def summary(path, since):
    count, services = 0, {}
    for record in batches(path, since):
        count += 1
        for resource in record.get("resources", []):
            for name, entry in resource["metrics"].items():
                service = next(
                    (it for prefix, it in SERVICE_OF_PREFIX.items() if name.startswith(prefix)),
                    "other",
                )
                totals = services.setdefault(service, {"metrics": set(), "points": 0})
                totals["metrics"].add(name)
                totals["points"] += entry["points"]
    print(f"{count} batches")
    for service in sorted(services):
        totals = services[service]
        print(f"  {service}: {len(totals['metrics'])} metrics, {totals['points']} datapoints")
    return 0 if count else 1


def main():
    path, since, question = sys.argv[1], float(sys.argv[2]), sys.argv[3]
    arguments = sys.argv[4:]
    answer = {
        "reports": reports,
        "refused": refused,
        "identity": identity,
        "last": last,
        "summary": summary,
    }[question]
    return answer(path, since, *arguments)


if __name__ == "__main__":
    sys.exit(main())
