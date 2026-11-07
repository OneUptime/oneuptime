#!/usr/bin/env python3
"""Unit tests of the end-to-end test's own workloads (manifests/*.yaml), without a cluster (#6184).

On k3s under ubuntu-26.04, containerd's AppArmor profile labels a container's processes
cri-containerd.apparmor.d//&unconfined and then denies a signal to that stacked label, a
process's own threads included (containerd#12886, fixed in no k3s release yet). Go drops a
process's privileges by signalling every one of its threads (rtmin+1, for setuid and setgid),
so postgres's entrypoint, starting as root and dropping to postgres through gosu, spun
forever in gosu, and postgres never started: the run's capture showed
`apparmor="DENIED" operation="signal" comm="gosu" signal=rtmin+1`.

postgres now starts as the image's own user, so nothing drops privileges. These tests hold
that, and keep any workload of the e2e from dropping privileges through gosu again.
Standard library only:

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


class Workloads(unittest.TestCase):
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

    def test_the_reason_is_beside_the_setting(self):
        # The comment is what stops someone dropping the setting as noise.
        text = read('workloads.yaml')
        at = text.index('image: postgres:17-alpine')
        nearby = text[at:at + 1200]

        for words in ('gosu', 'rtmin+1', 'cri-containerd.apparmor.d//&unconfined', '#6184', 'containerd#12886'):
            self.assertIn(words, nearby)

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


if __name__ == '__main__':
    unittest.main()
