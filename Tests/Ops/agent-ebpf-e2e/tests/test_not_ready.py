#!/usr/bin/env python3
"""Unit tests of what run.sh gathers when a workload is not Ready (#6184), without a cluster.

On k3s under ubuntu-26.04, postgres ran, logged nothing through `kubectl logs` and never
passed its exec readiness probe, and the capture held only `kubectl describe pods`: the
probe's own error is in the events, and a runtime that cannot exec into a container shows
itself only to the runtime and the kernel. not_ready now gathers all of it, with set -e
off, so one failing look never hides the rest.

run.sh's own functions run against fakes of kubectl, crictl, k3s, docker, dmesg and
journalctl that record what they are asked; /proc is read for real, from a sleeping
process standing in for a container's. Standard library only:

  python3 -m unittest discover -s Tests/Ops/agent-ebpf-e2e/tests -v
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
RIG = os.path.abspath(os.path.join(HERE, '..'))
with open(os.path.join(RIG, 'run.sh'), encoding='utf-8') as handle:
    RUN = handle.read()

FAKE_KUBECTL = r'''#!/usr/bin/env python3
import json, os, sys
args, rest = sys.argv[1:], []
while args:
    arg = args.pop(0)
    if arg in ('--kubeconfig', '-n'):
        args.pop(0)
    elif not arg.startswith('--request-timeout'):
        rest.append(arg)
with open(os.environ['FAKE_CALLS'], 'a') as calls:
    calls.write('kubectl ' + json.dumps(rest) + '\n')
if os.environ.get('FAKE_ALL_FAIL'):
    print('error: the server could not be reached', file=sys.stderr)
    sys.exit(1)
if rest[:2] == ['describe', 'pods']:
    print('Name: postgres-745ccd74f4-9v7fw\nStatus: Running\nReady: False')
elif rest[:2] == ['get', 'events']:
    print('Warning Unhealthy pod/postgres-745ccd74f4-9v7fw Readiness probe failed: '
          'OCI runtime exec failed: exec failed: unable to start container process: permission denied')
elif rest[:1] == ['logs']:
    pass
elif rest[:1] == ['exec']:
    print('OCI runtime exec failed: exec failed: unable to start container process: permission denied',
          file=sys.stderr)
    sys.exit(126)
elif rest[:1] == ['get'] and rest[2:3] == ['-o']:
    print(os.environ['FAKE_PROBE'], end='')
else:
    print('fake kubectl: no such command: %s' % rest, file=sys.stderr)
    sys.exit(2)
'''

FAKE_CRICTL = r'''#!/usr/bin/env python3
import os, sys
args = sys.argv[1:]
with open(os.environ['FAKE_CALLS'], 'a') as calls:
    calls.write('crictl %s\n' % ' '.join(args))
if os.environ.get('FAKE_ALL_FAIL'):
    print('crictl: connect: connection refused', file=sys.stderr)
    sys.exit(1)
pid = os.environ['FAKE_PID']
if args[:1] == ['ps']:
    print('c1postgres\nc2redis' if 'io.kubernetes.pod.namespace=data' in args else '')
elif args[:1] == ['inspect']:
    template, cid = args[args.index('--template') + 1], args[-1]
    name = cid[2:]
    if template == '{{.info.pid}}':
        print(pid, end='')
    else:
        print('%s CONTAINER_RUNNING exit=0 reason= pid=%s' % (name, pid), end='')
elif args[:1] == ['logs']:
    print('' if args[-1] == 'c1postgres' else 'Ready to accept connections tcp')
else:
    print('fake crictl: no such command: %s' % args, file=sys.stderr)
    sys.exit(2)
'''

FAKE_SH_TOOLS = {
    # sudo runs what it is given, as the runner's root would.
    'sudo': '#!/bin/sh\nexec "$@"\n',
    'k3s': '#!/bin/sh\n[ "$1" = crictl ] || exit 2\nshift\nexec crictl "$@"\n',
    # A KinD node is a container: here, a shell that says which node it is.
    'docker': '#!/bin/sh\necho "docker $*" | head -c 60 >>"$FAKE_CALLS"; echo >>"$FAKE_CALLS"\n'
              '[ "$1" = exec ] || exit 2\nshift\nNODE="$1"; shift\nexport NODE\nexec "$@"\n',
    # As ubuntu-26.04 logs: a denial when a container starts, then two change_onexec AUDIT
    # lines for every probe after it, far more of them than any tail keeps.
    'dmesg': '#!/bin/sh\n[ -n "$FAKE_ALL_FAIL" ] && exit 1\n'
             'echo "[ 1.0] Linux version 7.0.0-1019-azure"\n'
             'echo "[ 90.1] audit: type=1400 apparmor=\\"DENIED\\" operation=\\"signal\\" '
             'profile=\\"cri-containerd.apparmor.d\\" comm=\\"gosu\\" requested_mask=\\"receive\\""\n'
             'echo "[ 91.0] eth0: link up"\n'
             'i=0\nwhile [ $i -lt 400 ]; do\n'
             '  echo "[ 9$i.5] audit: type=1400 apparmor=\\"AUDIT\\" operation=\\"change_onexec\\" '
             'info=\\"change_profile unprivileged unconfined converted to stacking\\" '
             'name=\\"/usr/local/bin/pg_isready\\""\n'
             '  i=$((i + 1))\ndone\n',
    'journalctl': '#!/bin/sh\n[ -n "$FAKE_ALL_FAIL" ] && exit 1\n'
                  'echo "journal of ${NODE:-the runner}: $*"\n',
}


def shell_function(name):
    """run.sh's own text of a function: a one-line one, or `name() {` to the `}` closing it."""
    one_line = re.search(r'^%s\(\) \{.*\}$' % re.escape(name), RUN, re.M)
    if one_line:
        return one_line.group(0)
    match = re.search(r'^%s\(\) \{.*?^\}$' % re.escape(name), RUN, re.M | re.S)
    if not match:
        raise AssertionError('run.sh has no function %s' % name)
    return match.group(0)


class NotReady(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix='ebpf-not-ready-')
        self.bin = os.path.join(self.dir, 'bin')
        self.out = os.path.join(self.dir, 'out')
        os.mkdir(self.bin)
        os.mkdir(self.out)
        tools = dict(FAKE_SH_TOOLS, kubectl=FAKE_KUBECTL, crictl=FAKE_CRICTL)
        for name, text in tools.items():
            path = os.path.join(self.bin, name)
            with open(path, 'w', encoding='utf-8') as handle:
                handle.write(text)
            os.chmod(path, 0o755)
        self.calls = os.path.join(self.dir, 'calls')
        open(self.calls, 'w').close()
        # Stands in for a container's main process, so /proc is read for real.
        self.container = subprocess.Popen(['sleep', '300'])

    def tearDown(self):
        self.container.kill()
        self.container.wait()
        shutil.rmtree(self.dir, ignore_errors=True)

    def not_ready(self, platform='k3s', nodes='runnervmwuk1x', probe=None, all_fail=False):
        if probe is None:
            probe = json.dumps(['pg_isready', '-U', 'postgres', '-h', '127.0.0.1'])
        script = '\n'.join([
            'set -euo pipefail',
            'PLATFORM=%s OUT=%s KC=%s/kubeconfig HERE=%s' % (platform, self.out, self.out, RIG),
            'NODES="%s"' % nodes,
            'log() { printf "%s\\n" "$*" >>"${OUT}/run.log"; }',
            'die() { log "ERROR: $*"; exit 1; }',
            shell_function('node_sh'),
            shell_function('crictl_cmd'),
            shell_function('not_ready'),
            shell_function('not_ready_facts'),
            'not_ready data deploy/postgres',
            'echo "not_ready returned"',
        ])
        env = dict(os.environ, PATH=self.bin + os.pathsep + os.environ['PATH'], FAKE_CALLS=self.calls,
                   FAKE_PID=str(self.container.pid), FAKE_PROBE=probe)
        if all_fail:
            env['FAKE_ALL_FAIL'] = '1'
        result = subprocess.run(['bash', '-c', script], env=env, capture_output=True, text=True)
        capture = os.path.join(self.out, 'not-ready-data.txt')
        with open(capture, encoding='utf-8') as handle:
            text = handle.read()
        return result, text

    def kubectl_calls(self):
        with open(self.calls, encoding='utf-8') as handle:
            return [json.loads(line[len('kubectl '):]) for line in handle if line.startswith('kubectl ')]

    def assertInOrder(self, text, parts):
        at = 0
        for part in parts:
            found = text.find(part, at)
            self.assertNotEqual(found, -1, 'missing, or out of order: %r' % part)
            at = found + len(part)

    def test_k3s_gathers_kubernetes_the_runtime_and_the_kernel_then_stops_the_run(self):
        result, text = self.not_ready()

        self.assertEqual(result.returncode, 1)
        self.assertNotIn('not_ready returned', result.stdout)
        with open(os.path.join(self.out, 'run.log'), encoding='utf-8') as handle:
            self.assertIn('ERROR: deploy/postgres in namespace data is not Ready; what its pods, Kubernetes, '
                          'the runtime and the kernel said is in %s/not-ready-data.txt' % self.out, handle.read())
        self.assertInOrder(text, [
            '=== kubectl describe pods', 'Status: Running',
            '=== events', 'Readiness probe failed: OCI runtime exec failed',
            '=== logs of deploy/postgres',
            '=== kubectl exec deploy/postgres -- true', 'permission denied', 'exit 126',
            '=== its readiness probe, by hand: pg_isready -U postgres -h 127.0.0.1', 'exit 126',
            "=== runnervmwuk1x: the runtime's containers in namespace data",
            '--- container c1postgres', 'postgres CONTAINER_RUNNING exit=0 reason= pid=%d' % self.container.pid,
            'Name:\tsleep', 'State:', 'wchan:',
            'apparmor:', 'Max open files', 'syscall:',
            'thread %d: State: S (sleeping)' % self.container.pid, 'SigBlk:', 'SigCgt:',
            '--- its last lines',
            '--- container c2redis', 'Ready to accept connections tcp',
            '=== kernel messages (AppArmor, seccomp, audit, oops)', 'change_onexec lines: 400',
            'apparmor="DENIED" operation="signal"',
            "=== k3s's journal", 'journal of the runner: -u k3s --no-pager -n 300',
        ])
        # Only what can explain a stuck container comes from the kernel's ring: not the
        # probes' change_onexec lines, which buried the start's lines under a tail.
        self.assertNotIn('eth0: link up', text)
        self.assertNotIn('operation="change_onexec"', text)
        self.assertNotIn('containerd\'s journal', text)

    def test_the_probe_runs_by_hand_with_exactly_its_own_arguments(self):
        self.not_ready(probe=json.dumps(['sh', '-c', 'pg_isready -U postgres && echo up']))

        execs = [call for call in self.kubectl_calls() if call[:1] == ['exec']]
        self.assertEqual(execs, [
            ['exec', 'deploy/postgres', '--', 'true'],
            ['exec', 'deploy/postgres', '--', 'sh', '-c', 'pg_isready -U postgres && echo up'],
        ])

    def test_a_workload_with_no_exec_probe_is_not_probed_by_hand(self):
        result, text = self.not_ready(probe='')

        self.assertEqual(result.returncode, 1)
        self.assertNotIn('its readiness probe, by hand', text)
        self.assertEqual([call for call in self.kubectl_calls() if call[:1] == ['exec']],
                         [['exec', 'deploy/postgres', '--', 'true']])

    def test_every_look_failing_still_writes_every_section_and_stops_the_run(self):
        result, text = self.not_ready(all_fail=True)

        self.assertEqual(result.returncode, 1)
        self.assertNotIn('not_ready returned', result.stdout)
        self.assertInOrder(text, [
            '=== kubectl describe pods', 'error: the server could not be reached',
            '=== events', '=== logs of deploy/postgres', '=== kubectl exec deploy/postgres -- true', 'exit 1',
            "=== runnervmwuk1x: the runtime's containers in namespace data", 'connection refused',
            '=== kernel messages', "=== k3s's journal",
        ])

    def test_kind_asks_each_node_its_runtime_and_containerd(self):
        result, text = self.not_ready(platform='kind', nodes='agent-ebpf-e2e-control-plane agent-ebpf-e2e-worker')

        self.assertEqual(result.returncode, 1)
        self.assertInOrder(text, [
            "=== agent-ebpf-e2e-control-plane: the runtime's containers in namespace data", '--- container c1postgres',
            "=== agent-ebpf-e2e-worker: the runtime's containers in namespace data", '--- container c1postgres',
            '=== kernel messages',
            "=== agent-ebpf-e2e-control-plane: containerd's journal",
            'journal of agent-ebpf-e2e-control-plane: -u containerd --no-pager -n 200',
            "=== agent-ebpf-e2e-worker: containerd's journal",
            'journal of agent-ebpf-e2e-worker: -u containerd --no-pager -n 200',
        ])
        self.assertNotIn("k3s's journal", text)
        with open(self.calls, encoding='utf-8') as handle:
            calls = handle.read()
        # A KinD node has crictl itself; only k3s goes through `k3s crictl`.
        self.assertIn('crictl ps -a -q --label io.kubernetes.pod.namespace=data', calls)
        self.assertIn('docker exec agent-ebpf-e2e-worker sh -c', calls)

    def test_container_facts_says_nothing_of_a_namespace_with_no_containers(self):
        with open(os.path.join(RIG, 'container-facts.sh'), encoding='utf-8') as handle:
            script = "NS='empty' CRICTL='crictl'; " + handle.read()
        env = dict(os.environ, PATH=self.bin + os.pathsep + os.environ['PATH'], FAKE_CALLS=self.calls,
                   FAKE_PID=str(self.container.pid))
        result = subprocess.run(['sh', '-c', script], env=env, capture_output=True, text=True)

        self.assertEqual((result.returncode, result.stdout, result.stderr), (0, '', ''))

    def test_container_facts_is_plain_sh(self):
        result = subprocess.run(['sh', '-n', os.path.join(RIG, 'container-facts.sh')],
                                capture_output=True, text=True)

        self.assertEqual((result.returncode, result.stderr), (0, ''))


if __name__ == '__main__':
    unittest.main()
