#!/usr/bin/env python3
"""Unit tests of the end-to-end test's own workloads (manifests/*.yaml), without a cluster (#6184).

On k3s under ubuntu-26.04, AppArmor labels a container's processes
cri-containerd.apparmor.d//&unconfined, and containerd's generated profile denies every signal
to that label (containerd#12886, fixed in no k3s release yet). Two runs showed what that does:

- postgres's entrypoint, dropping root through gosu, spun forever: Go drops privileges by
  signalling each of its threads (`apparmor="DENIED" ... comm="gosu" signal=rtmin+1`);
- run as postgres's own user, its entrypoint's pg_ctl could not stop its init server
  ("could not send stop signal (PID: 34): Permission denied"), and the container exited.

So the e2e's own workloads - every pod of manifests/, none of which is what the test tests -
run with the pod-level appArmorProfile Unconfined, while the chart's pods keep the runtime's
profile, as on a customer's node. These tests hold both, keep postgres as its own user, and
keep any workload from dropping privileges through gosu. Standard library only:

  python3 -m unittest discover -s Tests/Ops/agent-ebpf-e2e/tests -v
"""
import os
import re
import unittest

MANIFESTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'manifests')


def read(name):
    with open(os.path.join(MANIFESTS, name), encoding='utf-8') as handle:
        return handle.read()


def documents(text):
    """The YAML documents of a manifest file, comments dropped."""
    without_comments = '\n'.join(line for line in text.splitlines() if not line.lstrip().startswith('#'))
    return [doc for doc in re.split(r'^---\s*$', without_comments, flags=re.M) if doc.strip()]


def deployment(name):
    for doc in documents(read('workloads.yaml')):
        if re.search(r'^kind: Deployment$', doc, re.M) and re.search(r'^  name: %s$' % re.escape(name), doc, re.M):
            return doc
    raise AssertionError('workloads.yaml has no Deployment %s' % name)


def container_block(doc, name):
    """The lines of one container, from its `- name:` to the next container or the end."""
    match = re.search(r'^(\s+)- name: %s\n(.*?)(?=^\1- name: |\Z)' % re.escape(name), doc, re.M | re.S)
    if not match:
        raise AssertionError('no container %s' % name)
    return match.group(0)


def security_context(block):
    """A container's securityContext, as {field: text value}."""
    match = re.search(r'^(\s+)securityContext:\n((?:\1  .*\n?)+)', block, re.M)
    if not match:
        return {}
    pairs = re.findall(r'^\s+(\w+):\s*(\S+)\s*$', match.group(2), re.M)
    return dict(pairs)


def pod_templates(name):
    """(kind and name, pod spec text) of each workload of a manifest file that has a pod template."""
    found = []
    for doc in documents(read(name)):
        kind = re.search(r'^kind: (\w+)$', doc, re.M)
        if not kind or kind.group(1) not in ('Deployment', 'Job', 'DaemonSet', 'StatefulSet'):
            continue
        title = re.search(r'^  name: (\S+)$', doc, re.M)
        spec = re.search(r'^    spec:\n(.*)', doc, re.M | re.S)
        if not spec:
            raise AssertionError('%s %s has no pod template' % (kind.group(1), title and title.group(1)))
        found.append(('%s %s' % (kind.group(1), title.group(1) if title else '?'), spec.group(1)))
    return found


def pod_apparmor_type(spec):
    """The pod-level appArmorProfile's type, or None."""
    match = re.search(r'^      securityContext:\n(?:        .*\n)*?        appArmorProfile:\n          type: (\w+)',
                      spec, re.M)
    return match.group(1) if match else None


FIXTURE_FILES = ('workloads.yaml', 'sink.yaml', 'loadgen-job.yaml')
REASON = ('cri-containerd.apparmor.d//&unconfined', 'every signal', 'pg_ctl', 'gosu', "chart's own pods",
          '#6184', 'containerd#12886')


class Workloads(unittest.TestCase):
    def test_every_pod_of_the_e2es_own_runs_unconfined(self):
        templates = [(name, title, spec) for name in FIXTURE_FILES for title, spec in pod_templates(name)]

        # redis, postgres, downstream, app and sleeper; the sink; the load generator.
        self.assertEqual(len(templates), 7)
        for name, title, spec in templates:
            self.assertEqual((name, title, pod_apparmor_type(spec)), (name, title, 'Unconfined'))

    def test_the_privileged_context_probe_needs_no_profile_of_its_own(self):
        # A privileged container runs unconfined already; it is the only pod not set above.
        self.assertRegex(read('ctxprobe.yaml'), re.compile(r'^\s+privileged: true$', re.M))

    def test_the_chart_keeps_the_runtimes_profile(self):
        # What the e2e tests is the chart: its pods stay as a customer's node runs them.
        values = open(os.path.join(MANIFESTS, '..', 'values-e2e.yaml'), encoding='utf-8').read()

        self.assertNotIn('appArmorProfile', values)
        self.assertNotIn('Unconfined', values)

    def test_each_file_says_why_at_its_first_workload(self):
        # The comment is what stops someone dropping the setting as noise.
        for name in FIXTURE_FILES:
            text = read(name)
            at = text.index('      securityContext:\n        appArmorProfile:')
            reason = text[max(0, at - 900):at]
            for words in REASON:
                self.assertIn(words, reason, '%s: %s' % (name, words))

    def test_postgres_starts_as_its_own_user_so_its_entrypoint_drops_nothing(self):
        block = container_block(deployment('postgres'), 'postgres')

        self.assertIn('image: postgres:17-alpine', block)
        # 70 is postgres in the alpine variants (999 in the Debian ones): the entrypoint
        # skips its chown and gosu when it does not run as root.
        self.assertEqual(security_context(block), {
            'runAsUser': '70',
            'runAsGroup': '70',
            'runAsNonRoot': 'true',
            'allowPrivilegeEscalation': 'false',
        })

    def test_postgres_still_answers_the_probe_it_did(self):
        block = container_block(deployment('postgres'), 'postgres')

        self.assertIn('command: ["pg_isready", "-U", "postgres", "-h", "127.0.0.1"]', block)

    def test_no_workload_drops_privileges_through_gosu(self):
        for name in sorted(os.listdir(MANIFESTS)):
            if not name.endswith('.yaml'):
                continue
            for doc in documents(read(name)):
                self.assertNotRegex(doc, r'\bgosu\b', '%s runs gosu' % name)

    def test_the_helpers_read_what_they_say(self):
        doc = '\n'.join([
            'kind: Deployment',
            'metadata:',
            '  name: x',
            'spec:',
            '      containers:',
            '        - name: a',
            '          image: a',
            '          securityContext:',
            '            runAsUser: 1',
            '        - name: b',
            '          image: b',
        ])

        self.assertEqual(security_context(container_block(doc, 'a')), {'runAsUser': '1'})
        self.assertEqual(security_context(container_block(doc, 'b')), {})
        self.assertEqual(pod_apparmor_type('      securityContext:\n        appArmorProfile:\n'
                                           '          type: Unconfined\n'), 'Unconfined')
        self.assertEqual(pod_apparmor_type('      nodeSelector:\n        x: "y"\n'), None)


if __name__ == '__main__':
    unittest.main()
