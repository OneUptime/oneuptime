# Kubernetes agent eBPF end-to-end test

Installs [`HelmChart/Public/kubernetes-agent`](../../../HelmChart/Public/kubernetes-agent)
on a throwaway cluster, exactly as the chart renders it with
[`values-e2e.yaml`](values-e2e.yaml) — OBI (OpenTelemetry eBPF
Instrumentation), the agent collector and the eBPF profiler — drives a Node.js
26 app that calls Redis, Postgres and an HTTP downstream, and checks what
reaches a sink standing in for OneUptime.

The chart's other tests never load an eBPF program. The helm-unittest suites
pin the rendered config as text, and `Tests/Ops/agent-obi-config-load.sh` loads
OBI's config unprivileged. Only this test shows, on a real kernel, that:

- OBI loads its eBPF programs on this kernel and architecture and stays up with
  the chart's config, env and mounts;
- Node.js 26 is detected as Node.js and OBI's Node.js agent is injected, so a
  request's own Postgres and HTTP calls land in that request's trace;
- the collector's trace filters, `k8s.cluster.name`, `service.peer.name`, the
  harvested route names and the discovery exclusions hold on real OBI output;
- profiles reach OneUptime's `/otlp/v1/profiles` path, OBI keeps the app's span
  context in the `traces_ctx_v1` map it pins to bpffs, and the profiler tags
  the app's CPU samples with that span context.

It runs in CI as the "Kubernetes Agent eBPF E2E" workflow
([`.github/workflows/test.kubernetes-agent-ebpf-e2e.yaml`](../../../.github/workflows/test.kubernetes-agent-ebpf-e2e.yaml)):
on pull requests and pushes to master that touch the chart, this directory or
the workflow, weekly (the runner kernel changes under an unchanged chart), and
on demand, where `obi_image` tries another OBI build. The analyzer's unit tests
run on every pull request in "Ops Config Test".

## Run it locally

Needs docker, kind, kubectl, helm and python3 (standard library only). From the
repository root:

```sh
bash Tests/Ops/agent-ebpf-e2e/run.sh
```

It creates a KinD cluster named `agent-ebpf-e2e`, runs the test, prints one
line per check, and deletes the cluster. Every `kubectl` and `helm` call uses
the test cluster's own kubeconfig (written into the capture directory), never
your current context. Expect 10-15 minutes, and over 30 on a Docker Desktop VM
busy with other clusters; loading the images (about 2.3 GB, the profiler alone
is 1 GB) into two nodes is the slowest part. Its exit status is the
analyzer's.

| Variable                                                     | Default                     | Effect                                                                                                |
| ------------------------------------------------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------- |
| `E2E_PLATFORM`                                               | `kind`                      | `kind`, or `k3s` (see below; throwaway Linux hosts only)                                              |
| `E2E_OUT`                                                    | a new temp dir              | where the captures go                                                                                 |
| `E2E_CLUSTER`                                                | `agent-ebpf-e2e`            | KinD cluster name                                                                                     |
| `KEEP_CLUSTER`                                               | `false`                     | `true` leaves the cluster up afterwards                                                               |
| `E2E_REUSE_CLUSTER`                                          | `false`                     | `true` runs on an existing KinD cluster of that name (it uninstalls the previous run's release first) |
| `E2E_KIND_CONFIG`                                            | `kind-config.yaml` here     | another KinD config, e.g. one with longer kubeadm timeouts on a loaded laptop                         |
| `E2E_NODE_IMAGE`                                             | kind's own                  | KinD node image                                                                                       |
| `E2E_K3S_VERSION`                                            | `v1.34.1+k3s1`              | k3s: the release to install                                                                           |
| `E2E_OBI_IMAGE`                                              | the chart's                 | `repo:tag` of an OBI build to try instead of `ebpf.image`                                             |
| `E2E_HELM_ARGS`                                              | none                        | extra `helm install` arguments, e.g. `--set profiling.obiProcessContext=false`                        |
| `E2E_PROFILING`                                              | `true`                      | `false` skips the profiler half                                                                       |
| `E2E_HOST_PROFILER`                                          | `true`                      | kind: `false` skips the root-namespace profiler (PR-5 to PR-7 are then skipped)                       |
| `E2E_BPFFS`                                                  | `true`                      | kind: `false` does not mount bpffs in the nodes                                                       |
| `LOAD_SECONDS`, `CONCURRENCY`, `PAUSE_MS`, `WARMUP`, `FLUSH` | `90`, `8`, `50`, `30`, `30` | the load and the waits around it                                                                      |

PR-5 is the one check that is sensitive to a loaded machine. The profiler
drops every sample of a process until it has synchronized that process, and it
synchronizes them one at a time, in the order it first samples them. On a
Docker Desktop VM shared with other clusters (a load average around 100 on 10
CPUs), one run ended its load without a single sample of the app and failed
PR-5. `run.sh` starts the root-namespace profiler before the warmup so that the
backlog can drain first; CI runners are dedicated VMs.

### Re-checking a capture

`analyze.py` needs no cluster. Point it at a capture directory — one of yours
or the `agent-ebpf-e2e-*` artifact a CI run uploads — with the arguments
`run.sh` used, which `analysis.json` records under `args`:

```sh
python3 Tests/Ops/agent-ebpf-e2e/analyze.py <capture-dir> \
  --apps-node agent-ebpf-e2e-worker --cluster-name agent-ebpf-e2e \
  --obi-image otel/ebpf-instrument:v0.14.0
```

The capture holds the render, every agent log (and `--previous` log), the pod
list, the sink's `traces.json`, `metrics.json` and `profiles.json` (OTLP/JSON,
one export per line), `ctxprobe.log` (the `traces_ctx_v1` entries seen during
the load), `container-pids.txt`, and on kind `host-profiler/`.

### The analyzer's unit tests

```sh
python3 -m unittest discover -s Tests/Ops/agent-ebpf-e2e/tests -v
```

They build synthetic captures, healthy by default, inject one fault each and
assert that exactly the check guarding against it fails — so a check that
stopped checking anything fails in seconds here instead of passing in CI
forever. A new check needs a test like that, and its ID in `ALL_CHECKS`.

## How it works

Two nodes (`kind-config.yaml`). The worker is the `apps` node: the app,
`downstream`, Redis, Postgres and a busybox `sleeper` all run there, so one OBI
pod sees a whole request path. The control plane is the `client` node: the sink
and the load generator run there, in namespaces `values-e2e.yaml` excludes from
OBI discovery.

1. Render the chart with `values-e2e.yaml` and take the OBI and profiler images
   from the render, so bumping a tag in the chart tests the new image. The sink
   is `otel/opentelemetry-collector-contrib` of the profiler's release, so the
   profiles are decoded by the pdata version that encoded them.
2. Pull every image (with retries) and load it into the cluster.
3. On kind, mount bpffs on `/sys/fs/bpf` in each node. A real node gets it from
   systemd; a KinD node has a read-only sysfs and none, so OBI could not pin
   `traces_ctx_v1` and the profiler would have nothing to read. OBI and the
   profiler on a node both hostPath-mount the node's `/sys/fs/bpf`, so they
   share that one instance.
4. Deploy the sink ([`manifests/sink.yaml`](manifests/sink.yaml): a collector
   with file exporters, behind [`apps/sink-proxy.js`](apps/sink-proxy.js),
   which maps `/otlp/v1/profiles` to the receiver's hardcoded
   `/v1development/profiles`) and the workloads
   ([`manifests/workloads.yaml`](manifests/workloads.yaml); the app's npm
   dependencies are installed by an init container, so nothing is built). A
   workload that is not Ready within 10 minutes stops the run, with its pods
   described in `not-ready-<namespace>.txt`.
5. `helm install`, wait for the DaemonSets and for OBI's "Script successfully
   injected". An agent component that is not Ready within 5 minutes does not
   stop the run: its logs are collected and the checks (OBI-1, PR-1) report
   it. On kind, with profiling on, start the root-namespace profiler (below)
   here, so that it has caught up with the processes it samples before the
   load. Then a 30 s warmup.
6. With profiling on, start [`manifests/ctxprobe.yaml`](manifests/ctxprobe.yaml)
   (bpftool on the apps node's pin). Run the load
   ([`apps/loadgen.js`](apps/loadgen.js): one process, 8 loops over the app's 4
   routes for 90 s), wait 30 s for the exports to flush, collect, and run
   [`analyze.py`](analyze.py).

### kind and k3s

KinD nodes are containers in their own PID namespace, and the profiler has no
PID-namespace translation: it looks a sample's root-namespace PID up in the
node's `/proc` and attributes the sample to whatever process has that number
there. In KinD the chart's profiler pods therefore name the wrong processes and
none of the app's samples link to a span. So on kind the sample-to-span checks
(PR-5 to PR-7) use a second profiler: the chart's profiler image with the
receiver block of the chart's own rendered config, run by docker in the host's
root PID namespace and pointed at the apps node's pin through
`/proc/<node pid>/root/sys/fs/bpf`. It only reads the pin, writes its profiles
to a file, and is removed afterwards. The app's root-namespace PID is the
process whose cgroup path holds the app container's ID and whose `NSpid` chain
holds the PID the node gives it. PR-1 to PR-3 still check the chart's own
profiler pods (health, the pin, the export path).

With `E2E_PLATFORM=k3s`, k3s is installed on the host itself, so `hostPID`
pods are in the root PID namespace and bpffs is the host's own, as on a real
node, and PR-5 to PR-7 check the chart's own profiler. It installs a system
service and OBI on it sees every process of the host, so it is for throwaway CI
runners only. In CI that leg is not blocking until it has a green history.

## What it checks

Thresholds sit well below what a healthy run measures and well above what the
regressions they guard against measured. For example, OBI v0.13 (which did not
inject its Node.js agent into Node 26) put the app's own SELECT in 27-30% of
its request traces and its own downstream GET in 24-26%; healthy v0.14 runs
measured 94.2-99.6% and 99.8-100%.

| Check | Asserts                                                                                                                          |
| ----- | -------------------------------------------------------------------------------------------------------------------------------- |
| OBI-1 | OBI pods Ready, 0 restarts                                                                                                       |
| OBI-2 | the pods run the OBI image the chart renders                                                                                     |
| OBI-3 | OBI logs the version of the pinned tag                                                                                           |
| OBI-4 | no `level=ERROR` line in OBI's logs                                                                                              |
| OBI-5 | no "is bpffs mounted" warning: OBI pinned its maps                                                                               |
| OBI-6 | the Node.js 26 app is instrumented as `type=nodejs` (OBI before v0.14 took Node 26 for Rust)                                     |
| OBI-7 | OBI's Node.js agent is injected ("Script successfully injected", and the app logs "Debugger attached.")                          |
| OBI-8 | no process matching a rendered `exclude_instrument` glob (`ebpf.excludeExePaths`) is instrumented — the busybox `sleeper` is one |
| OBI-9 | nothing in a namespace excluded from `ebpfDiscovery` is instrumented                                                             |
| TR-1  | the load ran: at least 300 requests, at most 1% not 200                                                                          |
| TR-2  | the app's server spans number at least 80% of the requests                                                                       |
| TR-3  | at least 85% of the app's request traces hold their own Postgres SELECT                                                          |
| TR-4  | at least 90% hold their own downstream `GET /ping`                                                                               |
| TR-5  | at least 25% hold a Redis call of their own (a floor: OBI links Redis in about 45% of requests)                                  |
| TR-6  | no database SERVER spans reach the sink (`ebpf.dropDatabaseServerSpans`)                                                         |
| TR-7  | no parentless database CLIENT spans (`ebpf.dropUnlinkedDatabaseCalls`)                                                           |
| TR-8  | `k8s.cluster.name` on every span sent through the agent                                                                          |
| TR-9  | `k8s.cluster.name` on every metric resource sent through the agent, OBI's metrics among them                                     |
| TR-10 | `service.peer.name` on at least 99% of the app's CLIENT spans, and `downstream` on its `GET /ping`                               |
| TR-11 | at least 95% of the app's server spans are named by its 4 Express routes (`GET /api/items/:id`, ...), and all 4 appear           |
| TR-12 | no spans from the `sleeper` or from an excluded namespace                                                                        |
| PR-1  | profiler pods Ready, 0 restarts                                                                                                  |
| PR-2  | no pin or create failure in the profiler logs                                                                                    |
| PR-3  | at least 3 profile exports reached `/otlp/v1/profiles`, stamped with `k8s.cluster.name`                                          |
| PR-4  | at least 5 distinct `traces_ctx_v1` entries name exported app spans (`OTEL_EBPF_BPF_POPULATE_TRACE_CONTEXT`)                     |
| PR-5  | at least 50 app samples, at least 20 and 20% of them linked, and at least 80% of the links name app spans                        |
| PR-6  | no other process's sample links to an app span                                                                                   |
| PR-7  | report only: linked samples of processes OBI does not instrument                                                                 |

On kind, PR-5 also needs the root-namespace profiler to log that it uses
OBI's pin ("Using shared map for OBI span/trace ID communication").

PR-7 never fails. OBI v0.14.0 leaves `traces_ctx_v1` entries keyed by threads
it does not instrument (a containerd shim, runc, another cluster's containerd),
so the profiler links some of their samples to unknown trace IDs. PR-6 makes
sure none of those links names an app span.

With `E2E_HOST_PROFILER=false` on kind, PR-5 to PR-7 are skipped. Asked for
but missing, the root-namespace profiler's capture fails PR-5. With
`E2E_BPFFS=false`, OBI-5 is skipped. The CI job fails on any FAIL or SKIP.

Negative controls, on an arm64 KinD cluster: `E2E_BPFFS=false` fails exactly
PR-2, PR-4 and PR-5 (OBI-5 is skipped, as asked, and OBI logs its bpffs
warning); `E2E_OBI_IMAGE=otel/ebpf-instrument:v0.13.0` fails exactly OBI-6
(Node 26 taken for Rust), OBI-7, TR-3, TR-4 and TR-11 (v0.13 always filled
`traces_ctx_v1`, so PR-4 to PR-6 pass); and, in a run before the
root-namespace profiler was added,
`E2E_HELM_ARGS="--set profiling.obiProcessContext=false"` failed only PR-4.

## Network

Besides Docker Hub, a run needs the npm registry (the app's init container,
retried) and the Alpine package CDN (the probe's `apk add bpftool jq`,
retried); the k3s leg also needs get.k3s.io and GitHub releases.
