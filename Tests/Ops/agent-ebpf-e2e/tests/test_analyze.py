#!/usr/bin/env python3
"""Unit tests of analyze.py, the end-to-end test's assertions, without a cluster.

Each test writes a synthetic capture directory shaped like the one run.sh
leaves behind (OTLP/JSON exactly as the sink's file exporter writes it, OBI and
profiler logs, the pod list, ...), healthy by default, applies one fault, and
checks that exactly the check guarding against that fault fails -- so a check
that silently stopped checking anything fails here, in seconds, instead of
passing in CI forever. Standard library only:

  python3 -m unittest discover -s Tests/Ops/agent-ebpf-e2e/tests -v
"""
import copy
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ANALYZE = os.path.join(HERE, '..', 'analyze.py')
CLUSTER = 'agent-ebpf-e2e'
APPS, CLIENT = 'e2e-worker', 'e2e-control-plane'
APP_PID = '4242'
ROUTES = [('GET', 'GET /api/items/:id', '/api/items/:id'), ('POST', 'POST /api/orders', '/api/orders'),
          ('GET', 'GET /status/ready', '/status/ready'), ('GET', 'GET /cpu/hash', '/cpu/hash')]
EXCLUDE = ['*/sh', '*/bash', '*/busybox', '*/otelcol*', '*/obi']
# Every check analyze.py reports with profiling on. A check that is dropped
# or renamed fails test_every_check_reports.
ALL_CHECKS = (['OBI-%d' % i for i in range(1, 10)] + ['TR-%d' % i for i in range(1, 13)] +
              ['PR-%d' % i for i in range(1, 8)])


def kv(key, value):
    if isinstance(value, bool):
        return {'key': key, 'value': {'boolValue': value}}
    if isinstance(value, int):
        return {'key': key, 'value': {'intValue': str(value)}}
    return {'key': key, 'value': {'stringValue': value}}


def hexid(rng, n):
    return ''.join(rng.choice('0123456789abcdef') for _ in range(n * 2))


class Capture:
    """A healthy capture as plain Python data; tests mutate it, then write()."""

    def __init__(self, requests=400, seed=7, host_profiler=False):
        rng = random.Random(seed)
        # kind: run.sh's second profiler, in the host's root PID namespace,
        # where the app has another PID than the one its node gives it
        self.host_profiler = host_profiler
        self.host_pid = '99001'
        self.host_log = ['info Using shared map for OBI span/trace ID communication',
                         'info Everything is ready.']
        self.pods = {'items': []}
        for comp in ('ebpf-instrument', 'profiling'):
            for node in (APPS, CLIENT):
                self.pods['items'].append({
                    'metadata': {'labels': {'component': comp}},
                    'spec': {'nodeName': node},
                    'status': {'containerStatuses': [{
                        'ready': True, 'restartCount': 0,
                        'image': 'docker.io/otel/ebpf-instrument:v0.14.0' if comp == 'ebpf-instrument'
                        else 'docker.io/otel/opentelemetry-collector-ebpf-profiler:0.152.0'}]}})
        self.obi_log = {
            APPS: ['time=t level=INFO msg="OpenTelemetry eBPF Instrumentation" Version=v0.14.0 Revision=13d9b0c',
                   'time=t level=INFO msg="instrumenting process" component=discover.traceAttacher '
                   'cmd=/usr/local/bin/node pid=%s ino=1 type=nodejs service="" logenricher=false' % APP_PID,
                   'time=t level=INFO msg="instrumenting process" component=discover.traceAttacher '
                   'cmd=/usr/local/bin/postgres pid=300 ino=2 type=cpp service="" logenricher=false',
                   'time=t level=INFO msg="Script successfully injected" component=nodejs.Injector'],
            CLIENT: ['time=t level=INFO msg="OpenTelemetry eBPF Instrumentation" Version=v0.14.0 Revision=13d9b0c'],
        }
        self.prof_log = {APPS: ['info Everything is ready.'], CLIENT: ['info Everything is ready.']}
        self.app_log = ['agent-ebpf-e2e app node v26.10.0 pid 1 listening on 3000', 'Debugger attached.']
        self.container_pids = [
            '%s %s shop app-abc-1 app' % (APPS, APP_PID),
            '%s 300 data postgres-abc-1 postgres' % APPS,
            '%s 310 shop sleeper-abc-1 sleeper' % APPS,
            '%s 500 sink sink-abc-1 proxy' % CLIENT,
        ]
        self.render = ('discovery:\n  exclude_instrument:\n' +
                       ''.join('    - exe_path: "%s"\n' % g for g in EXCLUDE) +
                       '    - k8s_namespace: "kube-system"\n  attributes:\n')
        per = requests // len(ROUTES)
        self.loadgen = {'event': 'done', 'total': per * len(ROUTES),
                        'stats': {r[2]: {'n': per, 'codes': {'200': per}} for r in ROUTES}}
        # traces: per request a server span, an INTERNAL "processing" child and
        # four CLIENT calls under it, plus downstream's server span
        self.spans = []  # (resource dict, span dict)
        self.app_spans = []
        for i in range(per * len(ROUTES)):
            method, name, route = ROUTES[i % len(ROUTES)]
            t = hexid(rng, 16)
            srv = {'traceId': t, 'spanId': hexid(rng, 8), 'parentSpanId': '', 'name': name, 'kind': 2,
                   'attributes': [kv('http.request.method', method), kv('http.route', route)]}
            proc = {'traceId': t, 'spanId': hexid(rng, 8), 'parentSpanId': srv['spanId'], 'name': 'processing',
                    'kind': 1, 'attributes': []}
            calls = [
                ('set', [kv('db.system.name', 'redis')], 'redis'),
                ('get', [kv('db.system.name', 'redis')], 'redis'),
                ('SELECT postgres', [kv('db.system.name', 'postgresql')], 'postgres'),
                ('GET /ping', [kv('http.request.method', 'GET')], 'downstream'),
            ]
            app_res = self.resource('shop', 'app')
            self.spans += [(app_res, srv), (app_res, proc)]
            self.app_spans += [srv, proc]
            for cname, cattrs, peer in calls:
                c = {'traceId': t, 'spanId': hexid(rng, 8), 'parentSpanId': proc['spanId'], 'name': cname,
                     'kind': 3, 'attributes': cattrs + [kv('service.peer.name', peer)]}
                self.spans.append((app_res, c))
                self.app_spans.append(c)
                if cname == 'GET /ping':
                    self.spans.append((self.resource('shop', 'downstream'),
                                       {'traceId': t, 'spanId': hexid(rng, 8), 'parentSpanId': c['spanId'],
                                        'name': 'GET /ping', 'kind': 2,
                                        'attributes': [kv('http.request.method', 'GET')]}))
        # an OBI metric (http.server.request.duration) per resource
        self.metric_resources = [self.resource('shop', 'app'), self.resource('', '')]
        self.metric_names = ['http.server.request.duration']
        # what the probe saw in traces_ctx_v1, and what the profiler sent
        self.ctx = [(int(APP_PID), int(APP_PID), s['traceId'], s['spanId'])
                    for s in self.app_spans if s['name'] == 'processing'][:20]
        self.profiles = []  # (resource dict, samples [(count, (trace, span) or None)])
        linked = [(3, (s['traceId'], s['spanId'])) for s in self.app_spans if s['name'] == 'processing'][:60]
        self.profiles.append(({'process.pid': APP_PID, 'process.executable.name': 'node'},
                              linked + [(40, None)]))
        self.profiles.append(({'process.pid': '77', 'process.executable.name': 'containerd'}, [(30, None)]))
        self.profile_cluster = CLUSTER

    @staticmethod
    def resource(ns, deployment):
        attrs = [kv('k8s.cluster.name', CLUSTER), kv('oneuptime.agent.version', '1.0.0')]
        if ns:
            attrs += [kv('k8s.namespace.name', ns), kv('k8s.deployment.name', deployment),
                      kv('service.name', deployment)]
        return {'attributes': attrs}

    def profiles_jsonl(self, profiles):
        plines = []
        for res, samples in profiles:
            st = ['']
            links = [{}]

            def s_idx(x):
                if x not in st:
                    st.append(x)
                return st.index(x)

            rattrs = [{'keyStrindex': s_idx('k8s.node.name'), 'value': {'stringValue': APPS}}]
            if self.profile_cluster:
                rattrs.append({'keyStrindex': s_idx('k8s.cluster.name'), 'value': {'stringValue': self.profile_cluster}})
            for k, v in res.items():
                if k == 'process.pid':
                    rattrs.append({'keyStrindex': s_idx(k), 'value': {'intValue': v}})
                else:
                    rattrs.append({'keyStrindex': s_idx(k), 'value': {'stringValueStrindex': s_idx(v)}})
            out_samples = []
            for count, link in samples:
                smp = {'stackIndex': 1, 'timestampsUnixNano': ['1'] * count}
                if link:
                    links.append({'traceId': link[0], 'spanId': link[1]})
                    smp['linkIndex'] = len(links) - 1
                out_samples.append(smp)
            plines.append(json.dumps({'dictionary': {'stringTable': st, 'linkTable': links, 'attributeTable': [{}]},
                                      'resourceProfiles': [{'resource': {'attributes': rattrs}, 'scopeProfiles': [
                                          {'profiles': [{'samples': out_samples}]}]}]}))
        plines += plines[:1]  # >=3 exports
        return '\n'.join(plines) + '\n'

    def write(self, out):
        os.makedirs(out, exist_ok=True)

        def w(name, text):
            with open(os.path.join(out, name), 'w') as f:
                f.write(text)

        w('agent-pods.json', json.dumps(self.pods))
        for node, lines in self.obi_log.items():
            w('ebpf-instrument-%s.log' % node, '\n'.join(lines) + '\n')
        for node, lines in self.prof_log.items():
            w('profiling-%s.log' % node, '\n'.join(lines) + '\n')
        w('app.log', '\n'.join(self.app_log) + '\n')
        w('loadgen.log', '{"event":"start"}\n' + json.dumps(self.loadgen, separators=(',', ':')) + '\n')
        w('container-pids.txt', '\n'.join(self.container_pids) + '\n')
        w('render.yaml', self.render)
        # traces: one export per 50 spans, grouped by resource like the collector does
        lines = []
        for i in range(0, len(self.spans), 50):
            chunk = self.spans[i:i + 50]
            rs = []
            for res, span in chunk:
                rs.append({'resource': res, 'scopeSpans': [{'scope': {'name': 'go.opentelemetry.io/obi'},
                                                            'spans': [span]}]})
            lines.append(json.dumps({'resourceSpans': rs}))
        w('traces.json', '\n'.join(lines) + '\n')
        mlines = [json.dumps({'resourceMetrics': [{'resource': r, 'scopeMetrics': [{'metrics': [
            {'name': n} for n in self.metric_names]}]} for r in self.metric_resources]})]
        w('metrics.json', '\n'.join(mlines) + '\n')
        # profiles: OTLP profiles JSON as the 0.152.0 file exporter writes it
        w('profiles.json', self.profiles_jsonl(self.profiles))
        if self.host_profiler:
            os.makedirs(os.path.join(out, 'host-profiler'), exist_ok=True)
            host = [(dict(res, **{'process.pid': self.host_pid}) if res.get('process.pid') == APP_PID else res, smp)
                    for res, smp in self.profiles]
            w('host-profiler/profiles-host.json', self.profiles_jsonl(host))
            w('host-profiler/pids.txt', 'appRootPid=%s\n' % self.host_pid)
            w('host-profiler/profiler.log', '\n'.join(self.host_log) + '\n')
        ctx = ['PROBE-READY'] + ['%s %s' % ((tgid << 32 | tid).to_bytes(8, 'little').hex(), t + s)
                                 for tgid, tid, t, s in self.ctx] + ['PROBE-DONE']
        w('ctxprobe.log', '\n'.join(ctx) + '\n')


def run(cap, platform='kind', profiling='true', bpffs='true', host_profiler=None, after_write=None):
    """analyze.py over cap, written to a temp dir: (exit code, {check: status}, output)."""
    if host_profiler is None:
        host_profiler = 'true' if cap.host_profiler else 'false'
    d = tempfile.mkdtemp(prefix='analyze-test-')
    try:
        cap.write(d)
        if after_write:
            after_write(d)
        p = subprocess.run([sys.executable, ANALYZE, d, '--apps-node', APPS, '--cluster-name', CLUSTER,
                            '--obi-image', 'otel/ebpf-instrument:v0.14.0', '--platform', platform,
                            '--profiling', profiling, '--bpffs', bpffs, '--host-profiler', host_profiler],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True)
        with open(os.path.join(d, 'analysis.json')) as f:
            result = json.load(f)
        status = {c['id']: c['status'] for c in result['checks']}
        return p.returncode, status, p.stdout
    finally:
        shutil.rmtree(d, ignore_errors=True)


class Healthy(unittest.TestCase):
    def test_kind_with_the_host_profiler_passes_everything(self):
        # what CI runs on kind
        rc, status, outp = run(Capture(host_profiler=True))
        self.assertEqual(rc, 0, outp)
        self.assertEqual({k for k, v in status.items() if v != 'PASS'}, {'PR-7'}, outp)
        self.assertEqual(status['PR-7'], 'INFO')

    def test_every_check_reports(self):
        _, status, outp = run(Capture(host_profiler=True))
        self.assertEqual(sorted(status), sorted(ALL_CHECKS), outp)

    def test_kind_without_the_host_profiler_skips_only_the_sample_link(self):
        rc, status, outp = run(Capture(), host_profiler='false')
        self.assertEqual(rc, 0, outp)
        self.assertEqual({k for k, v in status.items() if v != 'PASS'}, {'PR-5', 'PR-6', 'PR-7'}, outp)
        self.assertEqual({status[k] for k in ('PR-5', 'PR-6', 'PR-7')}, {'SKIP'}, outp)

    def test_k3s_passes_everything(self):
        # the chart's own profiler, in the root PID namespace
        rc, status, outp = run(Capture(), platform='k3s')
        self.assertEqual(rc, 0, outp)
        self.assertEqual({k for k, v in status.items() if v != 'PASS'}, {'PR-7'}, outp)
        self.assertEqual(sorted(status), sorted(ALL_CHECKS), outp)

    def test_profiling_off_skips_the_profiler_checks(self):
        rc, status, outp = run(Capture(), profiling='false')
        self.assertEqual(rc, 0, outp)
        self.assertFalse([k for k in status if k.startswith('PR-') and status[k] != 'SKIP'], outp)
        self.assertFalse([k for k in status if not k.startswith('PR-') and status[k] != 'PASS'], outp)

    def test_torn_last_line_is_tolerated(self):
        # the file exporter may be mid-write when the sink files are copied
        def tear(d):
            with open(os.path.join(d, 'traces.json'), 'a') as f:
                f.write('{"resourceSpans": [{"resource": ')

        rc, status, outp = run(Capture(host_profiler=True), after_write=tear)
        self.assertEqual(rc, 0, outp)


class EachFaultFailsItsCheck(unittest.TestCase):
    def assertOnlyFails(self, cap, expected, **kwargs):
        rc, status, outp = run(cap, **kwargs)
        self.assertEqual(rc, 1, outp)
        failed = {k for k, v in status.items() if v == 'FAIL'}
        self.assertEqual(failed, set(expected), outp)
        self.assertNotIn('Traceback', outp)

    # --- OBI ---------------------------------------------------------------
    def test_obi_restarted(self):
        c = Capture()
        c.pods['items'][0]['status']['containerStatuses'][0]['restartCount'] = 1
        self.assertOnlyFails(c, ['OBI-1'])

    def test_obi_not_ready(self):
        c = Capture()
        c.pods['items'][1]['status']['containerStatuses'][0]['ready'] = False
        self.assertOnlyFails(c, ['OBI-1'])

    def test_obi_other_image(self):
        c = Capture()
        c.pods['items'][0]['status']['containerStatuses'][0]['image'] = 'docker.io/otel/ebpf-instrument:v0.13.0'
        self.assertOnlyFails(c, ['OBI-2'])

    def test_obi_same_tag_from_another_repository(self):
        c = Capture()
        c.pods['items'][1]['status']['containerStatuses'][0]['image'] = 'docker.io/fork/ebpf-instrument:v0.14.0'
        self.assertOnlyFails(c, ['OBI-2'])

    def test_obi_reports_other_version(self):
        c = Capture()
        c.obi_log[APPS][0] = c.obi_log[APPS][0].replace('v0.14.0', 'v0.13.0')
        self.assertOnlyFails(c, ['OBI-3'])

    def test_obi_error_line(self):
        c = Capture()
        c.obi_log[APPS].append('time=t level=ERROR msg="cannot attach uprobe" component=x')
        self.assertOnlyFails(c, ['OBI-4'])

    def test_obi_without_bpffs(self):
        c = Capture()
        c.obi_log[APPS].append('time=t level=WARN msg="creating or accessing OTEL namespace in bpffs failed '
                               '(is bpffs mounted and accessible?)" bpffs_path=/sys/fs/bpf/')
        self.assertOnlyFails(c, ['OBI-5'])

    def test_bpffs_warning_ignored_when_bpffs_deliberately_off(self):
        c = Capture()
        c.obi_log[APPS].append('time=t level=WARN msg="creating or accessing OTEL namespace in bpffs failed"')
        rc, status, outp = run(c, bpffs='false')
        self.assertEqual(status['OBI-5'], 'SKIP', outp)

    def test_node26_seen_as_rust(self):
        # OBI before v0.14 checked for Rust first and Node 26 contains Rust code
        c = Capture()
        c.obi_log[APPS][1] = c.obi_log[APPS][1].replace('type=nodejs', 'type=rust')
        self.assertOnlyFails(c, ['OBI-6'])

    def test_app_never_instrumented(self):
        c = Capture()
        del c.obi_log[APPS][1]
        self.assertOnlyFails(c, ['OBI-6'])

    def test_nodejs_agent_not_injected(self):
        c = Capture()
        c.app_log = c.app_log[:1]
        self.assertOnlyFails(c, ['OBI-7'])

    def test_excluded_executable_instrumented(self):
        c = Capture()
        c.obi_log[APPS].append('time=t level=INFO msg="instrumenting process" cmd=/bin/busybox pid=310 type=generic')
        self.assertOnlyFails(c, ['OBI-8'])

    def test_excluded_namespace_instrumented(self):
        c = Capture()
        c.obi_log[CLIENT].append('time=t level=INFO msg="instrumenting process" cmd=/usr/local/bin/node pid=500 type=nodejs')
        self.assertOnlyFails(c, ['OBI-9'])

    def test_capture_cut_short_before_the_pods_were_listed(self):
        # run.sh died before it collected: fail the checks, do not crash
        def drop_pods(d):
            os.remove(os.path.join(d, 'agent-pods.json'))

        self.assertOnlyFails(Capture(), ['OBI-1', 'OBI-2', 'PR-1'], after_write=drop_pods)

    # --- traces -------------------------------------------------------------
    def test_load_failed(self):
        c = Capture()
        c.loadgen['stats']['/cpu/hash']['codes'] = {'200': 50, '500': 50}
        self.assertOnlyFails(c, ['TR-1'])

    def test_too_few_requests(self):
        self.assertOnlyFails(Capture(requests=200), ['TR-1'])

    def test_requests_missing(self):
        c = Capture()
        c.loadgen['total'] *= 2
        self.assertOnlyFails(c, ['TR-2'])

    def _move_calls_out(self, c, name, share):
        """Give `share` of the app's `name` CLIENT spans a parent in a foreign trace."""
        calls = [s for _, s in c.spans if s['kind'] == 3 and s['name'] == name]
        for s in calls[:int(len(calls) * share)]:
            s['traceId'] = 'f' * 32
        return c

    def test_select_not_in_own_trace(self):
        self.assertOnlyFails(self._move_calls_out(Capture(), 'SELECT postgres', 0.3), ['TR-3'])

    def test_downstream_get_not_in_own_trace(self):
        self.assertOnlyFails(self._move_calls_out(Capture(), 'GET /ping', 0.2), ['TR-4'])

    def test_redis_not_in_own_trace(self):
        c = self._move_calls_out(Capture(), 'set', 0.9)
        c = self._move_calls_out(c, 'get', 0.9)
        self.assertOnlyFails(c, ['TR-5'])

    def test_database_server_span(self):
        c = Capture()
        c.spans.append((Capture.resource('data', 'postgres'),
                        {'traceId': 'a' * 32, 'spanId': 'b' * 16, 'name': 'SELECT', 'kind': 2,
                         'attributes': [kv('db.system.name', 'postgresql')]}))
        self.assertOnlyFails(c, ['TR-6'])

    def test_parentless_database_client_span(self):
        c = Capture()
        c.spans.append((Capture.resource('shop', 'app'),
                        {'traceId': 'a' * 32, 'spanId': 'b' * 16, 'name': 'SELECT postgres', 'kind': 3,
                         'attributes': [kv('db.system.name', 'postgresql'), kv('service.peer.name', 'postgres')]}))
        self.assertOnlyFails(c, ['TR-7'])

    def test_span_without_cluster_name(self):
        c = Capture()
        res = copy.deepcopy(c.spans[0][0])
        res['attributes'] = [a for a in res['attributes'] if a['key'] != 'k8s.cluster.name']
        c.spans[0] = (res, c.spans[0][1])
        self.assertOnlyFails(c, ['TR-8'])

    def test_metric_without_cluster_name(self):
        c = Capture()
        c.metric_resources[0] = {'attributes': [kv('oneuptime.agent.version', '1.0.0')]}
        self.assertOnlyFails(c, ['TR-9'])

    def test_no_obi_metrics(self):
        c = Capture()
        c.metric_names = ['k8s.pod.cpu.usage']
        self.assertOnlyFails(c, ['TR-9'])

    def test_client_spans_without_service_peer_name(self):
        # OBI v0.14 made service.peer.name opt-in; the chart selects it
        c = Capture()
        for _, s in c.spans:
            if s['kind'] == 3:
                s['attributes'] = [a for a in s['attributes'] if a['key'] != 'service.peer.name']
        self.assertOnlyFails(c, ['TR-10'])

    def test_downstream_call_named_after_another_peer(self):
        c = Capture()
        for _, s in c.spans:
            if s['kind'] == 3 and s['name'] == 'GET /ping':
                for a in s['attributes']:
                    if a['key'] == 'service.peer.name':
                        a['value'] = {'stringValue': '10.96.0.12'}
        self.assertOnlyFails(c, ['TR-10'])

    def test_no_downstream_calls_at_all(self):
        c = Capture()
        c.spans = [(r, s) for r, s in c.spans if s['name'] != 'GET /ping']
        self.assertOnlyFails(c, ['TR-4', 'TR-10'])

    def test_routes_not_harvested(self):
        c = Capture()
        for _, s in c.spans:
            if s['name'] == 'GET /api/items/:id':
                s['name'] = 'GET /api/items/*'
        self.assertOnlyFails(c, ['TR-11'])

    def test_most_server_spans_not_named_by_a_harvested_route(self):
        # every route still seen once, but most requests named heuristically
        c = Capture()
        seen = set()
        for _, s in c.spans:
            if s['kind'] == 2 and s['name'].startswith(('GET /', 'POST /')) and s['name'] != 'GET /ping':
                if s['name'] in seen:
                    s['name'] = s['name'].rsplit('/', 1)[0] + '/*'
                seen.add(s['name'])
        self.assertOnlyFails(c, ['TR-11'])

    def test_span_from_excluded_workload(self):
        c = Capture()
        c.spans.append((Capture.resource('shop', 'sleeper'),
                        {'traceId': 'a' * 32, 'spanId': 'b' * 16, 'name': 'GET /ping', 'kind': 3,
                         'attributes': [kv('http.request.method', 'GET')]}))
        self.assertOnlyFails(c, ['TR-12'])

    def test_span_from_excluded_namespace(self):
        c = Capture()
        c.spans.append((Capture.resource('sink', 'sink'),
                        {'traceId': 'a' * 32, 'spanId': 'b' * 16, 'name': 'POST /otlp/v1/traces', 'kind': 2,
                         'attributes': [kv('http.request.method', 'POST')]}))
        self.assertOnlyFails(c, ['TR-12'])

    # --- profiling ------------------------------------------------------------
    def test_profiler_restarted(self):
        c = Capture()
        c.pods['items'][2]['status']['containerStatuses'][0]['restartCount'] = 2
        self.assertOnlyFails(c, ['PR-1'])

    def test_profiler_not_ready(self):
        c = Capture()
        c.pods['items'][3]['status']['containerStatuses'][0]['ready'] = False
        self.assertOnlyFails(c, ['PR-1'])

    def test_profiler_could_not_share_the_pin(self):
        c = Capture()
        c.prof_log[APPS].append("warn Failed to create '/sys/fs/bpf/otel'. OTel span/trace IDs can not be shared")
        self.assertOnlyFails(c, ['PR-2'])

    def test_no_profiles(self):
        c = Capture()
        c.profiles = []
        self.assertOnlyFails(c, ['PR-3'])

    def test_profiles_without_cluster_name(self):
        c = Capture()
        c.profile_cluster = None
        self.assertOnlyFails(c, ['PR-3'])

    def test_obi_not_populating_the_map(self):
        # OTEL_EBPF_BPF_POPULATE_TRACE_CONTEXT missing: the pin exists, stays empty
        c = Capture()
        c.ctx = []
        self.assertOnlyFails(c, ['PR-4'])

    def test_map_entries_name_no_exported_span(self):
        c = Capture()
        c.ctx = [(1, 1, 'e' * 32, 'd' * 16)] * 3 + [(2, 2, 'c' * 32, 'b' * 16)]
        self.assertOnlyFails(c, ['PR-4'])

    def test_app_samples_unlinked(self):
        c = Capture()
        c.profiles[0] = (c.profiles[0][0], [(200, None)])
        self.assertOnlyFails(c, ['PR-5'], platform='k3s')

    def test_app_samples_link_to_unknown_spans(self):
        c = Capture()
        c.profiles[0] = (c.profiles[0][0], [(3, ('e' * 32, 'd' * 16))] * 60 + [(40, None)])
        self.assertOnlyFails(c, ['PR-5'], platform='k3s')

    def test_too_few_app_samples(self):
        # all of them linked to app spans, but too few to say so (the app's
        # export is written twice: 2 x 20 samples)
        c = Capture()
        span = next(s for s in c.app_spans if s['name'] == 'processing')
        c.profiles[0] = (c.profiles[0][0], [(1, (span['traceId'], span['spanId']))] * 20)
        self.assertOnlyFails(c, ['PR-5'], platform='k3s')

    def test_another_process_links_to_app_spans(self):
        c = Capture()
        span = next(s for s in c.app_spans if s['name'] == 'processing')
        c.profiles[1] = (c.profiles[1][0], [(5, (span['traceId'], span['spanId']))])
        self.assertOnlyFails(c, ['PR-6'], platform='k3s')

    def test_host_profiler_did_not_read_the_pin(self):
        c = Capture(host_profiler=True)
        c.host_log = ['warn Failed to pin traces_ctx_v1', 'info Everything is ready.']
        self.assertOnlyFails(c, ['PR-5'])

    def test_host_profiler_app_samples_unlinked(self):
        c = Capture(host_profiler=True)
        c.profiles[0] = (c.profiles[0][0], [(200, None)])
        self.assertOnlyFails(c, ['PR-5'])

    def test_host_profiler_another_process_links_to_app_spans(self):
        c = Capture(host_profiler=True)
        span = next(s for s in c.app_spans if s['name'] == 'processing')
        c.profiles[1] = (c.profiles[1][0], [(5, (span['traceId'], span['spanId']))])
        self.assertOnlyFails(c, ['PR-6'])

    def test_host_profiler_capture_missing(self):
        # asked for (CI's kind legs) but never written: a failure, not a skip
        rc, status, outp = run(Capture(), host_profiler='true')
        self.assertEqual(rc, 1, outp)
        self.assertEqual({k for k, v in status.items() if v == 'FAIL'}, {'PR-5'}, outp)
        self.assertEqual((status['PR-6'], status['PR-7']), ('SKIP', 'SKIP'), outp)

    def test_host_profiler_app_pid_unknown(self):
        def forget_pid(d):
            with open(os.path.join(d, 'host-profiler', 'pids.txt'), 'w') as f:
                f.write('')

        self.assertOnlyFails(Capture(host_profiler=True), ['PR-5', 'PR-6'], after_write=forget_pid)

    def test_stray_links_are_reported_not_failed(self):
        c = Capture(host_profiler=True)
        c.profiles[1] = (c.profiles[1][0], [(15, ('e' * 32, 'd' * 16))])  # containerd with a link
        rc, status, outp = run(c)
        self.assertEqual(rc, 0, outp)
        self.assertEqual(status['PR-7'], 'INFO')
        self.assertIn('"containerd": 15', outp)


if __name__ == '__main__':
    unittest.main()
