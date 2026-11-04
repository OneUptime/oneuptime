#!/usr/bin/env python3
"""Fit the application credential's access rules to this cloud's own endpoints.

An access rule names the path a service sees. A cloud that gives each service its own
port (Kolla-Ansible, OpenStack-Ansible) needs the rules as they ship. A cloud that puts
them behind a path, like https://cloud.example/compute/v2.1, has its services see
/compute/v2.1/servers, and the shipped rule for /v2.1/servers refuses that with a 401.
So this adds each rule again under its service's prefix, read from the cloud's catalog,
and keeps the original: some services strip their prefix before the check and some do
not, and a rule that never matches costs nothing.

    openstack catalog list -f json | ./access-rules-for-cloud.py \
      application-credential-access-rules.json > access-rules-for-this-cloud.json

Only standard library, because this runs wherever the openstack client does.
"""
import json
import re
import sys
import urllib.parse

# A version segment and what can follow it, which are not the prefix: /v3,
# /v2.1/<project id>, /v2.0.
VERSION = re.compile(r"/v[0-9]+(\.[0-9]+)?(/.*)?$")


def prefixes_of(catalog):
    found = {}
    for service in catalog:
        kind = service.get("Type") or service.get("type")
        for endpoint in service.get("Endpoints") or service.get("endpoints") or []:
            if endpoint.get("interface") != "public":
                continue
            path = urllib.parse.urlparse(endpoint["url"]).path.rstrip("/")
            found[kind] = VERSION.sub("", path)
    return found


def fitted(rules, prefixes):
    # Cinder's type depends on the cloud's age, and a rule can only name one.
    if "block-storage" in prefixes:
        prefixes.setdefault("volumev3", prefixes["block-storage"])
    if "volumev3" in prefixes:
        prefixes.setdefault("block-storage", prefixes["volumev3"])

    result = []
    seen = set()

    def add(rule):
        key = (rule["service"], rule["method"], rule["path"])
        if key not in seen:
            seen.add(key)
            result.append(rule)

    for rule in rules:
        add(rule)
        prefix = prefixes.get(rule["service"])
        if prefix:
            add(dict(rule, path=prefix + rule["path"]))
    return result


def main():
    with open(sys.argv[1]) as handle:
        rules = json.load(handle)
    catalog = json.load(sys.stdin)
    print(json.dumps(fitted(rules, prefixes_of(catalog)), indent=2))


if __name__ == "__main__":
    main()
