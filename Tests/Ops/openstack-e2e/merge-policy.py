#!/usr/bin/env python3
"""Merge a policy override file over a service's existing policy file.

Both are flat maps of rule to check string, and either can be JSON or YAML with one
`"rule": "check"` per line, so this needs nothing outside the standard library: the
runner's system Python has no YAML module to rely on. The override wins.

    sudo cat /etc/neutron/policy.json | merge-policy.py overrides.yaml > merged.yaml
"""
import json
import re
import sys

LINE = re.compile(r'^\s*"(?P<rule>[^"]+)"\s*:\s*"(?P<check>.*)"\s*,?\s*$')


def parse(text):
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return dict(parsed)
    except ValueError:
        pass
    rules = {}
    for line in text.splitlines():
        match = LINE.match(line)
        if match:
            rules[match.group("rule")] = match.group("check")
    return rules


def main():
    with open(sys.argv[1]) as handle:
        overrides = parse(handle.read())
    if not overrides:
        raise SystemExit(f"{sys.argv[1]} holds no rules")
    merged = parse(sys.stdin.read())
    merged.update(overrides)
    for rule, check in sorted(merged.items()):
        print(f"{json.dumps(rule)}: {json.dumps(check)}")


if __name__ == "__main__":
    main()
