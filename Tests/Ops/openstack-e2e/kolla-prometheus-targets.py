#!/usr/bin/env python3
"""Each exporter the guide reads in Kolla-Ansible's prometheus.yml, one `job target` a line.

For the rig alone, which scrapes each as Kolla's Prometheus does and keeps what it answers. It
reads the file with control-plane-targets.py's own reader, so what the rig records is what
the guide's helper found: a job that helper misses is missing from the recording too.

Only standard library.
"""
import importlib.util
import os
import sys

HELPER = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "..", "agents", "OpenStackAgent", "control-plane-targets.py",
)

spec = importlib.util.spec_from_file_location("control_plane_targets", HELPER)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)

for job, targets in helper.targets_by_job(sys.stdin.read().splitlines()).items():
    if job not in helper.VARIABLE_OF_JOB:
        continue
    for number, target in enumerate(targets):
        print(job if number == 0 else f"{job}-{number + 1}", target)
