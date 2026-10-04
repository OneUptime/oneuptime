#!/usr/bin/env python3
"""Assertions of the agent eBPF end-to-end test (Tests/Ops/agent-ebpf-e2e).

Reads the captures run.sh leaves in <out-dir> and checks what the Kubernetes
agent -- OBI, its collector and the eBPF profiler, as the chart renders them --
delivered to the sink standing in for OneUptime. Standard library only.

  analyze.py <out-dir> --apps-node N --cluster-name C --obi-image I
             [--profiling true|false] [--platform kind|k3s]
             [--bpffs true|false] [--host-profiler true|false]

Prints one line per check (PASS / FAIL / SKIP / INFO, the measured value and
the threshold) and writes <out-dir>/analysis.json. Exits 1 if any check
failed. It needs no cluster, so a capture downloaded from CI can be re-checked
with the arguments run.sh logged in analysis.json.

Thresholds are set well below what a healthy run measures and well above what
the regressions they guard against measure, so CI noise does not flip them:
e.g. a Node.js 26 app whose requests are NOT linked to their own calls (OBI
before v0.14 skipped its Node.js agent on Node 26) put its own SELECT in ~27-30%
of its traces and its own downstream GET in ~24-26%; a healthy v0.14 run puts
them in >90% / >99%.
"""
import argparse
import collections
import fnmatch
import glob
import json
import os
import re
import sys

KIND = {0: 'UNSPECIFIED', 1: 'INTERNAL', 2: 'SERVER', 3: 'CLIENT', 4: 'PRODUCER', 5: 'CONSUMER',
        'SPAN_KIND_INTERNAL': 'INTERNAL', 'SPAN_KIND_SERVER': 'SERVER', 'SPAN_KIND_CLIENT': 'CLIENT',
        'SPAN_KIND_PRODUCER': 'PRODUCER', 'SPAN_KIND_CONSUMER': 'CONSUMER'}
# The literal Express routes apps/app.js declares, which OBI's route
# harvester has to find.
APP_ROUTES = ['GET /api/items/:id', 'POST /api/orders', 'GET /status/ready', 'GET /cpu/hash']
# Excluded from OBI discovery by values-e2e.yaml (kube-system by the chart's
# default rule).
EXCLUDED_NAMESPACES = {'kube-system', 'sink', 'loadgen'}


# --------------------------------------------------------------------- helpers
def anyval(v):
    if not isinstance(v, dict):
        return None
    for k in ('stringValue', 'intValue', 'doubleValue', 'boolValue'):
        if k in v:
            return v[k]
    if 'arrayValue' in v:
        return [anyval(x) for x in v['arrayValue'].get('values', [])]
    return None


def attrs(lst):
    return {a['key']: anyval(a.get('value')) for a in (lst or [])}


def jsonl(path):
    """OTLP/JSON lines; a torn last line (file still being written) is skipped."""
    if not os.path.exists(path):
        return
    with open(path, encoding='utf-8', errors='replace') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except ValueError:
                continue


def pct(a, b):
    return round(100.0 * a / b, 1) if b else 0.0


def read(path):
    try:
        with open(path, encoding='utf-8', errors='replace') as f:
            return f.read()
    except OSError:
        return ''


def kv(line, key):
    """The value of key=value (or key="quoted value") in an OBI log line."""
    m = re.search(r'\b' + re.escape(key) + r'=("(?:[^"\\]|\\.)*"|\S+)', line)
    if not m:
        return None
    v = m.group(1)
    return v[1:-1] if v.startswith('"') else v


class Checks:
    def __init__(self):
        self.rows = []

    def add(self, cid, ok, desc, measured, want):
        # ok: True / False, None = not checked here (SKIP), 'info' = measured
        # and reported, never fails the run
        status = 'INFO' if ok == 'info' else 'SKIP' if ok is None else ('PASS' if ok else 'FAIL')
        self.rows.append({'id': cid, 'status': status, 'check': desc, 'measured': measured, 'threshold': want})

    def failed(self):
        return [r for r in self.rows if r['status'] == 'FAIL']


# ---------------------------------------------------------------- the captures
def load_spans(out):
    spans = []
    for req in jsonl(os.path.join(out, 'traces.json')):
        for rs in req.get('resourceSpans', []):
            ra = attrs(rs.get('resource', {}).get('attributes'))
            for ss in rs.get('scopeSpans', []):
                for s in ss.get('spans', []):
                    spans.append({
                        'res': ra,
                        'ns': ra.get('k8s.namespace.name'),
                        'wl': ra.get('k8s.deployment.name') or ra.get('service.name'),
                        'trace': s.get('traceId', ''),
                        'id': s.get('spanId', ''),
                        'parent': s.get('parentSpanId', '') or '',
                        'name': s.get('name', ''),
                        'kind': KIND.get(s.get('kind', 0), str(s.get('kind'))),
                        'a': attrs(s.get('attributes')),
                    })
    return spans


def load_metric_resources(out):
    res = []
    for req in jsonl(os.path.join(out, 'metrics.json')):
        for rm in req.get('resourceMetrics', []):
            ra = attrs(rm.get('resource', {}).get('attributes'))
            names = [m.get('name') for sm in rm.get('scopeMetrics', []) for m in sm.get('metrics', [])]
            res.append((ra, names))
    return res


def profile_value(v, st):
    if not isinstance(v, dict):
        return None
    if 'stringValueStrindex' in v:
        return st[int(v['stringValueStrindex'])]
    return anyval(v)


def load_profiles(out, name='profiles.json'):
    """Every sample: (resource attributes, sample count, link (trace, span) or None).

    OTLP profiles as the 0.152.0 file exporter writes them: strings, links and
    attribute keys are indexes into the request's dictionary, and a sample's
    trace context is dictionary.linkTable[sample.linkIndex] (index 0 is the
    empty link).
    """
    samples = []
    exports = 0
    for req in jsonl(os.path.join(out, name)):
        exports += 1
        dic = req.get('dictionary', {})
        st = dic.get('stringTable', [])
        links = dic.get('linkTable', [])
        for rp in req.get('resourceProfiles', []):
            ra = {}
            for a in rp.get('resource', {}).get('attributes', []):
                key = a.get('key') or st[int(a.get('keyStrindex', 0))]
                ra[key] = profile_value(a.get('value'), st)
            for sp in rp.get('scopeProfiles', []):
                for p in sp.get('profiles', []):
                    for s in p.get('samples', []):
                        n = len(s.get('timestampsUnixNano', [])) or 1
                        li = int(s.get('linkIndex', 0) or 0)
                        link = None
                        if 0 < li < len(links):
                            link = (links[li].get('traceId', ''), links[li].get('spanId', ''))
                        samples.append((ra, n, link))
    return exports, samples


def load_ctx_probe(out):
    """traces_ctx_v1 entries the probe saw: (tgid, tid, trace hex, span hex)."""
    entries = set()
    for line in read(os.path.join(out, 'ctxprobe.log')).splitlines():
        parts = line.split()
        if len(parts) != 2 or len(parts[0]) != 16 or len(parts[1]) != 48:
            continue
        key = int.from_bytes(bytes.fromhex(parts[0]), 'little')
        entries.add((key >> 32, key & 0xffffffff, parts[1][:32], parts[1][32:]))
    return entries


def container_pids(out):
    """{(namespace, container): [(node, node-level pid, pod), ...]} from container-pids.txt."""
    m = collections.defaultdict(list)
    for line in read(os.path.join(out, 'container-pids.txt')).splitlines():
        p = line.split()
        if len(p) >= 5 and p[1].isdigit():
            m[(p[2], p[4])].append((p[0], p[1], p[3]))
    return m


def rendered_exclude_globs(out):
    """The exe_path globs of OBI's discovery.exclude_instrument, as rendered."""
    txt = read(os.path.join(out, 'render.yaml'))
    block = txt.split('exclude_instrument:', 1)[1] if 'exclude_instrument:' in txt else ''
    globs = []
    for line in block.splitlines()[1:]:
        m = re.match(r'\s*- exe_path: "([^"]+)"', line)
        if m:
            globs.append(m.group(1))
        elif re.match(r'\s*- k8s_namespace:', line):
            continue
        elif line.strip() and not line.strip().startswith('-'):
            break
    return globs


# ---------------------------------------------------------------------- checks
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out')
    ap.add_argument('--apps-node', required=True)
    ap.add_argument('--cluster-name', required=True)
    ap.add_argument('--obi-image', required=True)
    ap.add_argument('--profiling', default='true')
    ap.add_argument('--platform', default='kind')
    ap.add_argument('--bpffs', default='true')
    ap.add_argument('--host-profiler', default='true')
    args = ap.parse_args()
    out = args.out
    C = Checks()
    R = {'args': vars(args)}

    # --- agent pods ------------------------------------------------------------
    pods = json.loads(read(os.path.join(out, 'agent-pods.json')) or '{}').get('items', [])

    def pod_health(component):
        ps = [p for p in pods if p['metadata'].get('labels', {}).get('component') == component]
        rows = []
        for p in ps:
            st = (p.get('status', {}).get('containerStatuses') or [{}])[0]
            rows.append({'node': p['spec'].get('nodeName'), 'ready': bool(st.get('ready')),
                         'restarts': st.get('restartCount', -1), 'image': st.get('image', ''),
                         'imageID': st.get('imageID', '')})
        return rows

    obi = pod_health('ebpf-instrument')
    R['obiPods'] = obi
    want_tag = args.obi_image.rsplit(':', 1)[-1]
    C.add('OBI-1', bool(obi) and all(r['ready'] and r['restarts'] == 0 for r in obi),
          'OBI pods Ready with 0 restarts', [(r['node'], r['ready'], r['restarts']) for r in obi], 'all Ready, 0 restarts')
    C.add('OBI-2', bool(obi) and all(r['image'] == args.obi_image or r['image'].endswith('/' + args.obi_image)
                                     for r in obi),
          'OBI pods run the image the chart renders', sorted({r['image'] for r in obi}), args.obi_image)

    logs = {os.path.basename(f): read(f) for f in glob.glob(os.path.join(out, 'ebpf-instrument-*.log'))}
    versions = sorted({kv(line, 'Version') for t in logs.values() for line in t.splitlines()
                       if 'msg="OpenTelemetry eBPF Instrumentation"' in line})
    R['obiVersions'] = versions
    C.add('OBI-3', versions == [want_tag] if want_tag.startswith('v') else bool(versions),
          'OBI reports the version of the pinned tag', versions, want_tag)
    errors = [line for t in logs.values() for line in t.splitlines() if 'level=ERROR' in line]
    R['obiErrors'] = errors[:20]
    C.add('OBI-4', not errors, 'no ERROR lines in OBI logs', len(errors), 0)
    bpffs_warn = [line for t in logs.values() for line in t.splitlines()
                  if 'bpffs' in line and 'level=WARN' in line]
    R['obiBpffsWarnings'] = bpffs_warn
    if args.bpffs == 'true':
        C.add('OBI-5', not bpffs_warn, 'OBI pins its maps to bpffs (no "is bpffs mounted" warning)', len(bpffs_warn), 0)
    else:
        C.add('OBI-5', None, 'OBI pins its maps to bpffs', 'bpffs deliberately not mounted', '-')

    # which processes OBI instrumented, by owner
    cpids = container_pids(out)
    owner = {}
    for (ns, cname), lst in cpids.items():
        for node, pid, pod in lst:
            owner[(node, pid)] = (ns, pod, cname)
    inst = []
    for fn, t in logs.items():
        node = fn[len('ebpf-instrument-'):-len('.log')]
        for line in t.splitlines():
            if 'msg="instrumenting process"' in line:
                pid = kv(line, 'pid')
                inst.append({'node': node, 'pid': pid, 'cmd': kv(line, 'cmd'), 'type': kv(line, 'type'),
                             'owner': owner.get((node, pid))})
    R['instrumented'] = inst
    app_pids = [(n, p) for n, p, _ in cpids.get(('shop', 'app'), [])]
    app_inst = [x for x in inst if (x['node'], x['pid']) in app_pids]
    C.add('OBI-6', bool(app_inst) and all(x['type'] == 'nodejs' for x in app_inst),
          'the Node.js 26 app is instrumented as type=nodejs', [(x['cmd'], x['type']) for x in app_inst], 'type=nodejs')
    injected = sum(t.count('Script successfully injected') for t in logs.values())
    app_log = read(os.path.join(out, 'app.log'))
    node_ver = (re.search(r'node (v\d+\.\d+\.\d+)', app_log) or [None, None])[1]
    R['appNodeVersion'] = node_ver
    C.add('OBI-7', injected >= 1 and 'Debugger attached.' in app_log,
          "OBI's Node.js agent is injected into the app ('Script successfully injected', app sees the debugger)",
          {'injectedLines': injected, 'appDebuggerAttached': 'Debugger attached.' in app_log, 'node': node_ver},
          '>=1 and attached')
    globs = rendered_exclude_globs(out)
    bad = [x for x in inst if any(fnmatch.fnmatchcase(x['cmd'] or '', g) for g in globs)]
    bad_ns = [x for x in inst if x['owner'] and x['owner'][0] in EXCLUDED_NAMESPACES]
    R['excludeGlobs'] = globs
    C.add('OBI-8', bool(globs) and not bad,
          'no excluded executable (ebpf.excludeExePaths) is instrumented', [(x['cmd'], x['owner']) for x in bad],
          'none of %d globs' % len(globs))
    C.add('OBI-9', not bad_ns, 'no process in an ebpfDiscovery-excluded namespace is instrumented',
          [(x['cmd'], x['owner']) for x in bad_ns], 'none in %s' % sorted(EXCLUDED_NAMESPACES))

    # --- traces -------------------------------------------------------------------
    spans = load_spans(out)
    via = [s for s in spans if 'oneuptime.agent.version' in s['res']]
    R['spansAtSink'] = len(spans)
    R['spansViaAgent'] = len(via)
    lg = [json.loads(line) for line in read(os.path.join(out, 'loadgen.log')).splitlines()
          if line.startswith('{') and '"event":"done"' in line]
    load = lg[-1] if lg else {}
    total = load.get('total', 0)
    non200 = sum(n for st in load.get('stats', {}).values() for c, n in st.get('codes', {}).items() if c != '200')
    R['load'] = load
    C.add('TR-1', total >= 300 and non200 <= 0.01 * total, 'the load ran: >=300 requests, <=1% not 200',
          {'requests': total, 'not200': non200}, '>=300, <=1%')

    app = [s for s in via if s['ns'] == 'shop' and s['wl'] == 'app']
    srv = [s for s in app if s['kind'] == 'SERVER' and 'http.request.method' in s['a']]
    R['appSpans'] = len(app)
    R['appServerSpans'] = len(srv)
    C.add('TR-2', bool(total) and len(srv) >= 0.8 * total,
          "OBI captured the app's requests (server spans / requests)",
          '%d / %d (%.1f%%)' % (len(srv), total, pct(len(srv), total)), '>=80%')

    children = collections.defaultdict(list)
    for s in via:
        if s['parent']:
            children[(s['trace'], s['parent'])].append(s)

    def descendants(s):
        acc, stack = [], [s]
        while stack:
            x = stack.pop()
            for c in children.get((x['trace'], x['id']), []):
                acc.append(c)
                stack.append(c)
        return acc

    def db_system(s):
        return str(s['a'].get('db.system.name') or s['a'].get('db.system') or '')

    has_select = has_ping = has_redis = 0
    for s in srv:
        d = [x for x in descendants(s) if x['kind'] == 'CLIENT' and x['wl'] == 'app']
        if any(db_system(x).startswith('postgres') for x in d):
            has_select += 1
        if any(x['name'] == 'GET /ping' for x in d):
            has_ping += 1
        if any(db_system(x) in ('redis', 'valkey') for x in d):
            has_redis += 1
    R['ownCalls'] = {'select': pct(has_select, len(srv)), 'ping': pct(has_ping, len(srv)), 'redis': pct(has_redis, len(srv))}
    C.add('TR-3', pct(has_select, len(srv)) >= 85, "app requests whose trace holds their own Postgres SELECT",
          '%.1f%%' % pct(has_select, len(srv)), '>=85%')
    C.add('TR-4', pct(has_ping, len(srv)) >= 90, "app requests whose trace holds their own downstream GET /ping",
          '%.1f%%' % pct(has_ping, len(srv)), '>=90%')
    C.add('TR-5', None if not srv else pct(has_redis, len(srv)) >= 25,
          "app requests whose trace holds a Redis call of their own (OBI links Redis less reliably; floor only)",
          '%.1f%%' % pct(has_redis, len(srv)), '>=25%')

    def is_db(s):
        return 'db.system.name' in s['a'] or 'db.system' in s['a']

    db_server = [s for s in via if s['kind'] == 'SERVER' and (is_db(s) or s['ns'] == 'data')]
    unlinked_db = [s for s in via if s['kind'] == 'CLIENT' and is_db(s) and not s['parent']]
    C.add('TR-6', not db_server, 'no database SERVER spans at the sink (ebpf.dropDatabaseServerSpans)',
          len(db_server), 0)
    C.add('TR-7', not unlinked_db, 'no parentless database CLIENT spans at the sink (ebpf.dropUnlinkedDatabaseCalls)',
          len(unlinked_db), 0)
    cn = collections.Counter(s['res'].get('k8s.cluster.name') for s in via)
    C.add('TR-8', bool(via) and set(cn) == {args.cluster_name}, 'k8s.cluster.name on every span via the agent',
          dict(cn), args.cluster_name)
    mres = load_metric_resources(out)
    mcn = collections.Counter(ra.get('k8s.cluster.name') for ra, _ in mres if 'oneuptime.agent.version' in ra)
    obi_m = [(ra, n) for ra, n in mres if any((x or '').startswith(('http.', 'rpc.', 'db.', 'traces_', 'obi.')) for x in n)]
    C.add('TR-9', bool(mcn) and set(mcn) == {args.cluster_name} and bool(obi_m),
          'k8s.cluster.name on every metric resource via the agent (incl. OBI metrics)',
          {'byClusterName': dict(mcn), 'obiMetricResources': len(obi_m)}, args.cluster_name)
    app_clients = [s for s in app if s['kind'] == 'CLIENT']
    peer = [s for s in app_clients if s['a'].get('service.peer.name')]
    ping_peer = collections.Counter(s['a'].get('service.peer.name') for s in app_clients if s['name'] == 'GET /ping')
    top_ping_peer = ping_peer.most_common(1)[0][0] if ping_peer else None
    C.add('TR-10', bool(app_clients) and pct(len(peer), len(app_clients)) >= 99 and top_ping_peer == 'downstream',
          "service.peer.name on the app's CLIENT spans (GET /ping -> downstream)",
          {'withPeer': '%d/%d' % (len(peer), len(app_clients)), 'pingPeer': dict(ping_peer.most_common(3))},
          '>=99%, downstream')
    names = collections.Counter(s['name'] for s in srv)
    harvested = sum(n for k, n in names.items() if k in APP_ROUTES)
    R['appServerSpanNames'] = dict(names.most_common(10))
    C.add('TR-11', pct(harvested, len(srv)) >= 95 and all(r in names for r in APP_ROUTES),
          "app server spans named by the harvested Express routes (e.g. 'GET /api/items/:id')",
          {'harvestedPct': pct(harvested, len(srv)), 'top': dict(names.most_common(5))}, '>=95%, all 4 routes')
    sleeper = [s for s in via if s['wl'] == 'sleeper']
    plumbing = [s for s in via if s['ns'] in EXCLUDED_NAMESPACES]
    C.add('TR-12', not sleeper and not plumbing,
          'no spans from the excluded executable or the excluded namespaces',
          {'sleeper': len(sleeper), 'sink/loadgen/kube-system': len(plumbing)}, 0)

    # --- profiling -------------------------------------------------------------------
    if args.profiling != 'true':
        C.add('PR-*', None, 'profiling checks', 'profiling disabled', '-')
    else:
        prof = pod_health('profiling')
        C.add('PR-1', bool(prof) and all(r['ready'] and r['restarts'] == 0 for r in prof),
              'profiler pods Ready with 0 restarts', [(r['node'], r['ready'], r['restarts']) for r in prof],
              'all Ready, 0 restarts')
        plogs = '\n'.join(read(f) for f in glob.glob(os.path.join(out, 'profiling-*.log')))
        pin_fail = [line[:200] for line in plogs.splitlines()
                    if 'can not be shared' in line or 'Failed to pin' in line or 'Failed to create' in line]
        C.add('PR-2', not pin_fail, "the profiler shares OBI's traces_ctx_v1 pin (no pin/create failure)",
              pin_fail[:3], 'none')
        exports, samples = load_profiles(out)
        # Counted in samples, like nsamples: a sample record carries one
        # timestamp per occurrence.
        nodes, pcn = collections.Counter(), collections.Counter()
        for ra, n, _ in samples:
            nodes[ra.get('k8s.node.name')] += n
            pcn[ra.get('k8s.cluster.name')] += n
        nsamples = sum(n for _, n, _ in samples)
        R['profiles'] = {'exports': exports, 'samples': nsamples, 'byNode': dict(nodes), 'byClusterName': dict(pcn)}
        C.add('PR-3', exports >= 3 and nsamples > 0 and set(pcn) == {args.cluster_name},
              "profiles reach OneUptime's /otlp/v1/profiles, stamped with k8s.cluster.name",
              {'exports': exports, 'samples': nsamples, 'clusterName': dict(pcn)}, '>=3 exports')

        # OBI side of the correlation: what OBI keeps in the pinned map is the
        # context of the app's real, exported spans.
        app_by_id = {(s['trace'], s['id']): s for s in app}
        entries = load_ctx_probe(out)
        matched = [e for e in entries if (e[2], e[3]) in app_by_id]
        R['ctxProbe'] = {'entries': len(entries), 'matchingAppSpans': len(matched),
                         'matchedSpanKinds': dict(collections.Counter(
                             '%s %s' % (app_by_id[(e[2], e[3])]['kind'], app_by_id[(e[2], e[3])]['name'])
                             for e in matched))}
        C.add('PR-4', len(matched) >= 5,
              "OBI publishes the app's span context in the pinned traces_ctx_v1 map (entries == exported app spans)",
              R['ctxProbe'], '>=5 distinct entries')

        # Profiler side: samples of the app's process carry that context.
        # The profiler resolves a sample's (root-namespace) PID through its own
        # /proc and has no PID-namespace translation, so this needs a profiler
        # in the kernel's root PID namespace: on k3s, the chart's own
        # DaemonSet; on kind, whose nodes are nested PID namespaces, the
        # second profiler run.sh starts on the host (host-profiler/).
        link_samples, link_pids, shared, missing = samples, {p for _, p in app_pids}, True, None
        if args.platform == 'kind':
            host_dir = os.path.join(out, 'host-profiler')
            link_pids = set(re.findall(r'appRootPid=(\d+)', read(os.path.join(host_dir, 'pids.txt'))))
            shared = 'Using shared map for OBI span/trace ID communication' in read(
                os.path.join(host_dir, 'profiler.log'))
            if args.host_profiler != 'true':
                missing = 'root-namespace profiler deliberately off (E2E_HOST_PROFILER=false)'
            elif not os.path.exists(os.path.join(host_dir, 'profiles-host.json')):
                missing = 'no capture from the root-namespace profiler (host-profiler/profiles-host.json)'
            else:
                _, link_samples = load_profiles(host_dir, 'profiles-host.json')
        if missing:
            # Asked for and not there is a failure: a check that passes by
            # skipping would hide a profiler that never started.
            C.add('PR-5', None if args.host_profiler != 'true' else False,
                  "the app's profile samples carry trace context that names the app's own spans", missing, '-')
            C.add('PR-6', None, "no other process's samples link to the app's spans", missing, '-')
            C.add('PR-7', None, 'linked samples of processes OBI does not instrument', missing, '-')
        else:
            app_samples = [(n, link) for ra, n, link in link_samples if str(ra.get('process.pid')) in link_pids]
            n_app = sum(n for n, _ in app_samples)
            linked = [(n, link) for n, link in app_samples if link]
            n_linked = sum(n for n, _ in linked)
            n_match = sum(n for n, link in linked if link in app_by_id)
            R['appProfile'] = {'source': 'host-profiler' if args.platform == 'kind' else 'chart profiler',
                               'readsObiPin': shared, 'pids': sorted(link_pids), 'samples': n_app,
                               'linked': n_linked, 'linkedToAppSpans': n_match}
            C.add('PR-5', bool(shared) and n_app >= 50 and n_linked >= 20 and pct(n_linked, n_app) >= 20
                  and pct(n_match, n_linked) >= 80,
                  "the app's profile samples carry trace context that names the app's own spans",
                  R['appProfile'], 'reads the pin, >=50 samples, >=20 & >=20% linked, >=80% of links = app spans')
            foreign = sum(n for ra, n, link in link_samples
                          if link in app_by_id and str(ra.get('process.pid')) not in link_pids)
            C.add('PR-6', bool(link_pids) and foreign == 0, "no other process's samples link to the app's spans",
                  foreign, 0)
            # Samples of processes OBI does not instrument should carry no
            # trace context at all. OBI v0.14.0 leaves traces_ctx_v1 entries
            # keyed by such threads (seen: containerd-shim, runc, another
            # cluster's containerd), so this is reported, not asserted.
            workloads = {'node', 'redis-server', 'postgres'}
            stray = collections.Counter()
            for ra, n, link in link_samples:
                if link and ra.get('process.executable.name') not in workloads:
                    stray[str(ra.get('process.executable.name'))] += n
            C.add('PR-7', 'info', 'linked samples of processes OBI does not instrument (want 0; OBI v0.14.0 leaks some)',
                  dict(stray.most_common(8)), 'report only')

    # --- report ------------------------------------------------------------------------
    for r in C.rows:
        print('%-4s %-6s %s\n            measured: %s\n            threshold: %s' % (
            r['status'], r['id'], r['check'], json.dumps(r['measured'], default=str)[:400], r['threshold']))
    failed = C.failed()
    print('\n%d checks: %d passed, %d failed, %d skipped, %d informational' % (
        len(C.rows), sum(r['status'] == 'PASS' for r in C.rows), len(failed), sum(r['status'] == 'SKIP' for r in C.rows),
        sum(r['status'] == 'INFO' for r in C.rows)))
    R['checks'] = C.rows
    with open(os.path.join(out, 'analysis.json'), 'w', encoding='utf-8') as f:
        json.dump(R, f, indent=1, default=str)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
