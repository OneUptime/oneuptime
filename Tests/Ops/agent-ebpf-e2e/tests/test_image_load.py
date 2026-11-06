#!/usr/bin/env python3
"""Unit tests of run.sh's image loading into KinD, without Docker or a cluster (#6180).

kind imports an image with `ctr images import --all-platforms`, which needs every
platform the archive's index names. Docker 29's containerd image store saves a pulled
multi-platform image's whole index while it holds only this machine's platform, so
`kind load docker-image` failed on ubuntu-latest: "ctr: content digest ...: not found".

Here a fake `docker` writes real OCI archives the way each image store does - the
containerd store's whole index with one platform's blobs, or the classic store's one
platform - and a fake `kind` imports them the way ctr's --all-platforms does, walking
the index down to every layer. run.sh's own functions run against both, so what is
checked is that every archive kind gets is whole, not which flags were passed.
Standard library only:

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
RUN_SH = os.path.join(HERE, '..', 'run.sh')
with open(RUN_SH, encoding='utf-8') as handle:
    RUN = handle.read()

# A docker that answers what run.sh asks of it while loading images, and records it.
FAKE_DOCKER = r'''#!/usr/bin/env python3
import hashlib, io, json, os, sys, tarfile
args = sys.argv[1:]
store, platform = os.environ['FAKE_STORE'], os.environ['FAKE_PLATFORM']
with open(os.environ['FAKE_CALLS'], 'a') as calls:
    calls.write('docker %s\n' % ' '.join(args))
# alpine:3.20's index names these, and more.
PLATFORMS = ['linux/amd64', 'linux/arm64/v8', 'linux/arm/v6']


def digest(data):
    return 'sha256:' + hashlib.sha256(data).hexdigest()


if args == ['image', 'save', '--help']:
    lines = ['Usage:  docker image save [OPTIONS] IMAGE [IMAGE...]', '', 'Options:']
    if store == 'containerd':
        lines.append('      --platform strings   Save only the given platform(s).')
    lines.append('  -o, --output string      Write to a file, instead of STDOUT')
    sys.stdout.write('\n'.join(lines) + '\n')
    if os.environ.get('FAKE_LONG_HELP'):
        # Far more than a pipe holds: a reader that stops early breaks the pipe.
        for _ in range(20000):
            sys.stdout.write('filler line of help text that nobody reads\n')
    sys.exit(0)
if args[:2] == ['version', '--format']:
    os_name, arch = platform.split('/')[:2]
    print(args[2].replace('{{.Server.Os}}', os_name).replace('{{.Server.Arch}}', arch))
    sys.exit(0)
if args[:2] == ['image', 'save']:
    rest, only, out, image = args[2:], None, None, None
    while rest:
        arg = rest.pop(0)
        if arg == '--platform':
            if store != 'containerd':
                print('unknown flag: --platform', file=sys.stderr)
                sys.exit(125)
            only = rest.pop(0)
            if '/' not in only:
                # As docker reads a platform of an architecture alone: this OS's.
                only = 'linux/' + only
        elif arg == '-o':
            out = rest.pop(0)
        else:
            image = arg
    files = {}

    def put(data):
        name = digest(data)
        files['blobs/' + name.replace(':', '/')] = data
        return name

    described = {}
    for each in PLATFORMS:
        parts = each.split('/')
        config = json.dumps({'os': parts[0], 'architecture': parts[1], 'platform': each}).encode()
        layer = ('%s for %s' % (image, each)).encode()
        manifest = json.dumps({
            'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.manifest.v1+json',
            'config': {'mediaType': 'application/vnd.oci.image.config.v1+json',
                       'digest': digest(config), 'size': len(config)},
            'layers': [{'mediaType': 'application/vnd.oci.image.layer.v1.tar',
                        'digest': digest(layer), 'size': len(layer)}]}).encode()
        # The store holds this machine's platform only: the rest are named, not held.
        if each.startswith(platform):
            put(config)
            put(layer)
            put(manifest)
        found = {'os': parts[0], 'architecture': parts[1]}
        if len(parts) > 2:
            found['variant'] = parts[2]
        described[each] = {'mediaType': 'application/vnd.oci.image.manifest.v1+json',
                           'digest': digest(manifest), 'size': len(manifest), 'platform': found}
    if only or store == 'classic':
        wanted = only or platform
        top = [d for each, d in described.items() if each == wanted or each.startswith(wanted + '/')]
    else:
        index = json.dumps({'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.index.v1+json',
                            'manifests': list(described.values())}).encode()
        top = [{'mediaType': 'application/vnd.oci.image.index.v1+json', 'digest': put(index),
                'size': len(index)}]
    for descriptor in top:
        descriptor['annotations'] = {'io.containerd.image.name': image}
    files['index.json'] = json.dumps({'schemaVersion': 2, 'manifests': top}).encode()
    files['oci-layout'] = b'{"imageLayoutVersion": "1.0.0"}'
    with tarfile.open(out, 'w') as tar:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    sys.exit(0)
print('fake docker: no such command: %s' % ' '.join(args), file=sys.stderr)
sys.exit(2)
'''

# A kind that imports archives as `ctr images import --all-platforms` does.
FAKE_KIND = r'''#!/usr/bin/env python3
import json, os, subprocess, sys, tarfile, tempfile
args = sys.argv[1:]
with open(os.environ['FAKE_CALLS'], 'a') as calls:
    calls.write('kind %s\n' % ' '.join(args))
failures = os.environ['FAKE_KIND_FAILURES']
left = int(open(failures).read() or '0')
if left:
    open(failures, 'w').write(str(left - 1))
    print('ERROR: failed to load image: the node did not answer', file=sys.stderr)
    sys.exit(1)


def import_all_platforms(path):
    tar = tarfile.open(path)
    names = set(tar.getnames())

    def held(digest):
        return 'blobs/' + digest.replace(':', '/') in names

    def read(digest):
        return json.load(tar.extractfile('blobs/' + digest.replace(':', '/')))

    platforms = []

    def walk(descriptor):
        if not held(descriptor['digest']):
            raise LookupError(descriptor['digest'])
        if descriptor['mediaType'].endswith('index.v1+json'):
            for child in read(descriptor['digest'])['manifests']:
                walk(child)
            return
        manifest = read(descriptor['digest'])
        for part in [manifest['config']] + manifest['layers']:
            if not held(part['digest']):
                raise LookupError(part['digest'])
        platforms.append(read(manifest['config']['digest'])['platform'])

    index = json.load(tar.extractfile('index.json'))
    for descriptor in index['manifests']:
        walk(descriptor)
    return index['manifests'][0]['annotations']['io.containerd.image.name'], platforms


if args[:1] == ['load'] and args[1:2] in (['image-archive'], ['docker-image']):
    rest, cluster, target = args[2:], None, None
    while rest:
        arg = rest.pop(0)
        if arg == '--name':
            cluster = rest.pop(0)
        else:
            target = arg
    archive = target
    if args[1] == 'docker-image':
        # As kind does: the whole image, saved by docker as it is.
        archive = tempfile.mktemp()
        subprocess.run(['docker', 'image', 'save', '-o', archive, target], check=True)
    try:
        image, platforms = import_all_platforms(archive)
    except LookupError as missing:
        print('ERROR: failed to load image: ctr: content digest %s: not found' % missing.args[0],
              file=sys.stderr)
        sys.exit(1)
    with open(os.environ['FAKE_LOADED'], 'a') as loaded:
        loaded.write('%s %s %s\n' % (cluster, image, ','.join(platforms)))
    sys.exit(0)
print('fake kind: no such command: %s' % ' '.join(args), file=sys.stderr)
sys.exit(2)
'''


def shell_function(name):
    """run.sh's own text of a function, from `name() {` to the `}` that closes it."""
    match = re.search(r'^%s\(\) \{.*?^\}$' % re.escape(name), RUN, re.M | re.S)
    if not match:
        raise AssertionError('run.sh has no function %s' % name)
    return match.group(0)


class ImageLoad(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix='ebpf-image-load-')
        self.bin = os.path.join(self.dir, 'bin')
        self.out = os.path.join(self.dir, 'out')
        self.tmp = os.path.join(self.dir, 'tmp')
        for path in (self.bin, self.out, self.tmp):
            os.mkdir(path)
        for name, text in (('docker', FAKE_DOCKER), ('kind', FAKE_KIND)):
            path = os.path.join(self.bin, name)
            with open(path, 'w', encoding='utf-8') as handle:
                handle.write(text)
            os.chmod(path, 0o755)
        self.calls = os.path.join(self.dir, 'calls')
        self.loaded = os.path.join(self.dir, 'loaded')
        self.failures = os.path.join(self.dir, 'kind-failures')
        for path in (self.calls, self.loaded):
            open(path, 'w').close()

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def run_bash(self, commands, store='containerd', platform='linux/amd64', kind_failures=0,
                 long_help=False):
        with open(self.failures, 'w') as handle:
            handle.write(str(kind_failures))
        script = '\n'.join([
            'set -euo pipefail',
            'PLATFORM=kind CLUSTER=agent-ebpf-e2e OUT=%s' % self.out,
            'ALL_IMAGES="alpine:3.20 busybox:1.37"',
            'log() { printf "%s\\n" "$*" >>"${OUT}/run.log"; }',
            'die() { log "ERROR: $*"; exit 1; }',
            'sleep() { :; }',
            shell_function('retry'),
            shell_function('save_image_for_nodes'),
            shell_function('kind_load_image'),
            shell_function('platform_load_images'),
            commands,
        ])
        env = dict(os.environ, PATH=self.bin + os.pathsep + os.environ['PATH'], TMPDIR=self.tmp,
                   FAKE_STORE=store, FAKE_PLATFORM=platform, FAKE_CALLS=self.calls,
                   FAKE_LOADED=self.loaded, FAKE_KIND_FAILURES=self.failures)
        if long_help:
            env['FAKE_LONG_HELP'] = '1'
        return subprocess.run(['bash', '-c', script], env=env, capture_output=True, text=True)

    def read(self, path):
        with open(path, encoding='utf-8') as handle:
            return handle.read()

    def loaded_images(self):
        return [line.split(' ') for line in self.read(self.loaded).splitlines()]

    def test_on_the_containerd_store_each_image_loads_as_this_machines_platform(self):
        result = self.run_bash('platform_load_images')

        self.assertEqual(result.returncode, 0, result.stderr + self.read(self.calls))
        self.assertEqual(self.loaded_images(), [
            ['agent-ebpf-e2e', 'alpine:3.20', 'linux/amd64'],
            ['agent-ebpf-e2e', 'busybox:1.37', 'linux/amd64'],
        ])
        saves = [line for line in self.read(self.calls).splitlines()
                 if line.startswith('docker image save --platform')]
        self.assertEqual(len(saves), 2)
        for line in saves:
            self.assertTrue(line.startswith('docker image save --platform linux/amd64 -o '), line)
        self.assertNotIn('kind load docker-image', self.read(self.calls))

    def test_the_load_the_gate_failed_on_still_fails_on_the_containerd_store(self):
        # Proves the fakes reproduce ubuntu-latest's failure, so the pass above means something.
        result = self.run_bash('kind load docker-image --name "${CLUSTER}" alpine:3.20')

        self.assertNotEqual(result.returncode, 0)
        self.assertRegex(result.stderr, r'ctr: content digest sha256:[0-9a-f]{64}: not found')
        self.assertEqual(self.loaded_images(), [])

    def test_on_the_classic_store_a_docker_without_save_platform_saves_the_image_as_it_is(self):
        result = self.run_bash('platform_load_images', store='classic')

        self.assertEqual(result.returncode, 0, result.stderr + self.read(self.calls))
        self.assertEqual([image[1:] for image in self.loaded_images()], [
            ['alpine:3.20', 'linux/amd64'],
            ['busybox:1.37', 'linux/amd64'],
        ])
        self.assertNotIn('--platform', self.read(self.calls).replace('image save --help', ''))

    def test_an_arm64_runner_loads_arm64(self):
        result = self.run_bash('platform_load_images', platform='linux/arm64')

        self.assertEqual(result.returncode, 0, result.stderr + self.read(self.calls))
        # alpine's index names arm64 as linux/arm64/v8, which --platform linux/arm64 picks.
        self.assertEqual([image[2] for image in self.loaded_images()], ['linux/arm64/v8', 'linux/arm64/v8'])
        self.assertIn('docker image save --platform linux/arm64 -o ', self.read(self.calls))

    def test_reading_a_long_help_under_pipefail_still_finds_save_platform(self):
        # Piped to `grep -q`, the help would break the pipe once grep had its line, and under
        # pipefail the save would go without --platform - and fail to load, as on main.
        result = self.run_bash('platform_load_images', long_help=True)

        self.assertEqual(result.returncode, 0, result.stderr + self.read(self.calls))
        self.assertEqual(len(self.loaded_images()), 2)

    def test_a_load_that_fails_once_is_retried(self):
        result = self.run_bash('platform_load_images', kind_failures=1)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(self.loaded_images()), 2)
        self.assertIn('failed (attempt 1/3): kind_load_image alpine:3.20',
                      self.read(os.path.join(self.out, 'image-load.log')))

    def test_a_load_that_keeps_failing_stops_the_run_and_names_the_image(self):
        result = self.run_bash('platform_load_images', kind_failures=3)

        self.assertEqual(result.returncode, 1)
        self.assertIn('ERROR: kind load alpine:3.20 failed', self.read(os.path.join(self.out, 'run.log')))
        log = self.read(os.path.join(self.out, 'image-load.log'))
        self.assertIn('failed (attempt 1/3)', log)
        self.assertIn('failed (attempt 2/3)', log)
        self.assertEqual(self.loaded_images(), [])

    def test_no_archive_is_left_behind_whether_a_load_works_or_not(self):
        for failures in (0, 3):
            self.run_bash('platform_load_images', kind_failures=failures)
            self.assertEqual(os.listdir(self.tmp), [], 'kind failures: %d' % failures)

    def test_run_sh_never_hands_kind_a_whole_saved_image(self):
        code = [line for line in RUN.splitlines() if not line.lstrip().startswith('#')]
        self.assertEqual([line for line in code if 'kind load docker-image' in line], [])
        self.assertEqual([line.strip() for line in code if 'kind load image-archive' in line],
                         ['kind load image-archive --name "${CLUSTER}" "${archive}" || status=$?'])


if __name__ == '__main__':
    unittest.main()
