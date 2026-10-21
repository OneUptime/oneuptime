#!/usr/bin/env bash
# SC2024: the sudo'd commands read root-owned files into the caller's own
# files, on purpose. SC2086: image and node lists are word-split on purpose.
# shellcheck disable=SC2024,SC2086
#
# End-to-end test of the Kubernetes agent's eBPF pipeline on a real kernel:
# installs HelmChart/Public/kubernetes-agent -- OBI (OpenTelemetry eBPF
# Instrumentation), the agent collector and the eBPF profiler, exactly as the
# chart renders them -- into a throwaway cluster, drives a Node.js 26 app that
# calls Redis, Postgres and an HTTP downstream, and checks what reaches a sink
# standing in for OneUptime. analyze.py holds every assertion; README.md next
# to this file lists them.
#
# What only this test covers (the helm-unittest suites and the Tests/Ops
# config-load scripts never load an eBPF program):
#   - OBI loads its eBPF programs on this kernel and architecture and stays up
#     (Ready, 0 restarts) with the chart's config, env and mounts.
#   - Node.js 26 is detected as Node.js and OBI's Node.js agent is injected, so
#     a request's own Postgres/HTTP calls land in that request's trace.
#   - The collector's trace filters, k8s.cluster.name, service.peer.name,
#     harvested route names and the discovery exclusions, on real OBI output.
#   - Profiling: profiles reach OneUptime's /otlp/v1/profiles path, OBI keeps
#     the app's span context in the traces_ctx_v1 map it pins to bpffs, and
#     the profiler tags the app's CPU samples with that span context.
#
# Platforms (E2E_PLATFORM):
#   kind (default) -- two KinD nodes (`apps`, `client`). Runs anywhere docker
#        runs, laptops included. KinD nodes are containers in their own PID
#        namespace, and the profiler has no PID-namespace translation: it looks
#        a sample's root-namespace PID up in the node's /proc and attributes it
#        to whatever process has that number there. So on kind the sample<->
#        span check (PR-5) uses a second profiler: the same image with the
#        chart's receiver settings, run by docker in the HOST's root PID
#        namespace and pointed at the apps node's traces_ctx_v1 pin (through
#        /proc/<node>/root). It reads, never writes, and is removed afterwards.
#   k3s -- k3s installed on the (throwaway, Linux) host itself: hostPID pods
#        are in the root PID namespace and bpffs is the host's own, as on a
#        real node, so the chart's own profiler is the one checked. For CI
#        runners only: it installs a system service, and OBI on it sees every
#        process of the host.
#
# Usage:  bash Tests/Ops/agent-ebpf-e2e/run.sh
# Env:    E2E_PLATFORM=kind|k3s    (default kind)
#         E2E_OUT=<dir>            captures (default: a new temp dir)
#         E2E_CLUSTER=<name>       KinD cluster name (default agent-ebpf-e2e)
#         KEEP_CLUSTER=true        leave the cluster up afterwards
#         E2E_REUSE_CLUSTER=true   use an existing KinD cluster of that name
#         E2E_KIND_CONFIG=<file>   KinD config (default kind-config.yaml here)
#         E2E_NODE_IMAGE=<image>   KinD node image (default: kind's own)
#         E2E_K3S_VERSION=<ver>    k3s release (default below)
#         E2E_BPFFS=false          kind: do NOT mount bpffs in the nodes
#         E2E_PROFILING=false      skip the profiler half
#         E2E_HOST_PROFILER=false  kind: skip the root-namespace profiler (above)
#         LOAD_SECONDS / CONCURRENCY / PAUSE_MS / WARMUP / FLUSH
#         E2E_HELM_ARGS            extra `helm install` arguments (word-split)
#         E2E_OBI_IMAGE=repo:tag   override ebpf.image, e.g. to try a build
#
# Needs docker, kubectl, helm, python3, and kind (kind) or sudo + curl (k3s).
# Every kubectl/helm call names the test cluster's own kubeconfig file, never
# the caller's current context. bash 3.2 compatible (macOS).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "${HERE}/../../.." && pwd)}"
CHART="${CHART:-${REPO_ROOT}/HelmChart/Public/kubernetes-agent}"
PLATFORM="${E2E_PLATFORM:-kind}"
CLUSTER="${E2E_CLUSTER:-agent-ebpf-e2e}"
KIND_CONFIG="${E2E_KIND_CONFIG:-${HERE}/kind-config.yaml}"
K3S_VERSION="${E2E_K3S_VERSION:-v1.34.1+k3s1}"
KEEP_CLUSTER="${KEEP_CLUSTER:-false}"
REUSE_CLUSTER="${E2E_REUSE_CLUSTER:-false}"
BPFFS="${E2E_BPFFS:-true}"
PROFILING="${E2E_PROFILING:-true}"
HOST_PROFILER="${E2E_HOST_PROFILER:-true}"
LOAD_SECONDS="${LOAD_SECONDS:-90}"
CONCURRENCY="${CONCURRENCY:-8}"
PAUSE_MS="${PAUSE_MS:-50}"
WARMUP="${WARMUP:-30}"
FLUSH="${FLUSH:-30}"
OUT="${E2E_OUT:-$(mktemp -d "${TMPDIR:-/tmp}/agent-ebpf-e2e.XXXXXX")}"
mkdir -p "${OUT}"
OUT="$(cd "${OUT}" && pwd)"
KC="${OUT}/kubeconfig"
CLUSTER_NAME=agent-ebpf-e2e # clusterName in values-e2e.yaml
SINK_DIR=/var/lib/agent-ebpf-e2e-sink # hostPath in manifests/sink.yaml
AGENT_NS=oneuptime-agent
REL=e2e
FULL="${REL}-kubernetes-agent"
HOST_PROFILER_NAME="${CLUSTER}-host-profiler"
HOST_PROFILER_STARTED=false
CREATED=false

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "${OUT}/run.log" >&2; }
die() {
  log "ERROR: $*"
  exit 1
}

# Retried: a busy runner (or laptop) intermittently times out talking to the
# API server. Every call made through k is idempotent.
k() {
  local i
  for i in 1 2 3 4 5; do
    kubectl --kubeconfig "${KC}" --request-timeout=120s "$@" && return 0
    [ "$i" = 5 ] && return 1
    echo "kubectl $* failed (attempt $i), retrying" >&2
    sleep $((i * 3))
  done
}
# Waits are retried only within one budget: a busy API server can drop the
# call (as above), but a wait that timed out has spent its budget, and k would
# wait it out five times over, past the CI job's timeout.
wait_for() { # wait_for <seconds> <kubectl args...>: kubectl ... --timeout=<what is left>
  local end left
  end=$(($(date +%s) + $1))
  shift
  while left=$((end - $(date +%s))) && [ "${left}" -gt 0 ]; do
    kubectl --kubeconfig "${KC}" "$@" --timeout="${left}s" && return 0
    sleep 3
  done
  return 1
}
# A workload that never got Ready: nothing downstream of it measures
# anything, so stop, with what its pods say (e.g. the app's npm install).
not_ready() { # not_ready <namespace> <deploy/name>
  local f="${OUT}/not-ready-$1.txt"
  kubectl --kubeconfig "${KC}" --request-timeout=60s -n "$1" describe pods >"$f" 2>&1 || true
  kubectl --kubeconfig "${KC}" --request-timeout=60s -n "$1" logs "$2" --all-containers --prefix >>"$f" 2>&1 || true
  die "$2 in namespace $1 is not Ready; its pods are described in $f"
}
h() { helm --kubeconfig "${KC}" "$@"; }
retry() { # retry <attempts> <cmd...>
  local n="$1" i
  shift
  for i in $(seq 1 "$n"); do
    "$@" && return 0
    [ "$i" = "$n" ] && return 1
    echo "failed (attempt $i/$n): $*" >&2
    sleep $((i * 5))
  done
}

# --- platform layer: the only place kind and k3s differ ---------------------
node_sh() { # node_sh <node> <shell command>: run on the node, as root
  case "${PLATFORM}" in
    kind) docker exec "$1" sh -c "$2" ;;
    k3s) sudo sh -c "$2" ;;
  esac
}
node_fetch() { # node_fetch <node> <path on node> <local file>
  case "${PLATFORM}" in
    kind) docker cp "$1:$2" "$3" ;;
    k3s) sudo cat "$2" >"$3" ;;
  esac
}
crictl_cmd() { [ "${PLATFORM}" = k3s ] && echo "k3s crictl" || echo "crictl"; }

platform_up() {
  case "${PLATFORM}" in
    kind)
      if printf '%s\n' "$(kind get clusters 2>/dev/null)" | grep -qx "${CLUSTER}"; then
        [ "${REUSE_CLUSTER}" = true ] || die "KinD cluster ${CLUSTER} exists (E2E_REUSE_CLUSTER=true to use it)"
        kind get kubeconfig --name "${CLUSTER}" >"${KC}"
      else
        log "creating KinD cluster ${CLUSTER}"
        local args=()
        [ -n "${E2E_NODE_IMAGE:-}" ] && args=(--image "${E2E_NODE_IMAGE}")
        CREATED=true
        kind create cluster --name "${CLUSTER}" --config "${KIND_CONFIG}" --kubeconfig "${KC}" \
          ${args[@]+"${args[@]}"} --wait 600s >"${OUT}/kind-create.log" 2>&1 ||
          { cat "${OUT}/kind-create.log" >&2; die "kind create cluster failed"; }
      fi
      [ "$(kubectl --kubeconfig "${KC}" config current-context)" = "kind-${CLUSTER}" ] ||
        die "${KC} does not point at kind-${CLUSTER}"
      NODES="$(kind get nodes --name "${CLUSTER}" | sort)"
      ;;
    k3s)
      [ "$(uname -s)" = Linux ] || die "E2E_PLATFORM=k3s needs a Linux host"
      if [ ! -x /usr/local/bin/k3s ]; then
        log "installing k3s ${K3S_VERSION}"
        CREATED=true
        # The install script checks the binary against the release's sha256 list.
        curl -sfL --retry 5 https://get.k3s.io |
          sudo INSTALL_K3S_VERSION="${K3S_VERSION}" INSTALL_K3S_EXEC="--disable=traefik --disable=metrics-server --write-kubeconfig-mode=644" sh - \
          >"${OUT}/k3s-install.log" 2>&1 || { cat "${OUT}/k3s-install.log" >&2; die "k3s install failed"; }
      fi
      sudo cat /etc/rancher/k3s/k3s.yaml >"${KC}"
      for i in $(seq 1 60); do
        case "$(kubectl --kubeconfig "${KC}" get nodes 2>/dev/null)" in *' Ready'*) break ;; esac
        sleep 3
      done
      NODES="$(kubectl --kubeconfig "${KC}" get nodes -o jsonpath='{.items[0].metadata.name}')"
      ;;
    *) die "unknown E2E_PLATFORM ${PLATFORM}" ;;
  esac
}

platform_load_images() {
  local img
  case "${PLATFORM}" in
    kind)
      for img in ${ALL_IMAGES}; do
        log "loading ${img} into the KinD nodes"
        retry 3 kind load docker-image --name "${CLUSTER}" "${img}" >>"${OUT}/image-load.log" 2>&1 ||
          die "kind load ${img} failed"
      done
      ;;
    k3s)
      for img in ${ALL_IMAGES}; do
        log "importing ${img} into k3s"
        docker save "${img}" | sudo k3s ctr -n k8s.io images import - >>"${OUT}/image-load.log" 2>&1 ||
          die "k3s import ${img} failed"
      done
      ;;
  esac
}

platform_down() {
  # Only this run's: a run that stopped at "cluster exists" must not remove
  # the root-namespace profiler of the run that owns the cluster.
  [ "${HOST_PROFILER_STARTED}" != true ] || docker rm -f -v "${HOST_PROFILER_NAME}" >/dev/null 2>&1 || true
  [ "${CREATED}" = true ] && [ "${KEEP_CLUSTER}" != true ] || return 0
  case "${PLATFORM}" in
    kind)
      log "deleting KinD cluster ${CLUSTER}"
      kind delete cluster --name "${CLUSTER}" --kubeconfig "${KC}" >/dev/null 2>&1 || true
      ;;
    k3s)
      log "uninstalling k3s"
      sudo /usr/local/bin/k3s-uninstall.sh >/dev/null 2>&1 || true
      ;;
  esac
}

cleanup() {
  local rc=$?
  platform_down
  log "captures in ${OUT} (exit ${rc})"
  exit "${rc}"
}
trap cleanup EXIT

for tool in docker kubectl helm python3; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is required"
done
[ "${PLATFORM}" != kind ] || command -v kind >/dev/null 2>&1 || die "kind is required"

{
  echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "platform: ${PLATFORM}"
  echo "uname: $(uname -a)"
  echo "docker: $(docker version --format '{{.Server.Version}} {{.Server.Os}}/{{.Server.Arch}} kernel {{.Server.KernelVersion}}' 2>/dev/null || true)"
  echo "kind: $(kind version 2>/dev/null || true)"
  echo "helm: $(helm version --short 2>/dev/null)"
} >"${OUT}/host.txt"

# --- 1. images: the ones the chart renders, plus the test's own --------------
SET_ARGS=(--set "profiling.enabled=${PROFILING}")
if [ -n "${E2E_OBI_IMAGE:-}" ]; then
  SET_ARGS+=(--set "ebpf.image.repository=${E2E_OBI_IMAGE%:*}" --set "ebpf.image.tag=${E2E_OBI_IMAGE##*:}")
fi
# shellcheck disable=SC2206
EXTRA_HELM=(${E2E_HELM_ARGS:-})
helm template "${REL}" "${CHART}" -n "${AGENT_NS}" -f "${HERE}/values-e2e.yaml" \
  "${SET_ARGS[@]}" ${EXTRA_HELM[@]+"${EXTRA_HELM[@]}"} >"${OUT}/render.yaml"
image_of() { # image_of <component label>: the image of that DaemonSet in the render
  python3 - "${OUT}/render.yaml" "$1" <<'PY'
import re
import sys

render, component = sys.argv[1:3]
with open(render, encoding='utf-8') as f:
    docs = f.read().split('\n---\n')
for doc in docs:
    if re.search(r'^kind: DaemonSet$', doc, re.M) and re.search(
            r'^    component: %s$' % re.escape(component), doc, re.M):
        m = re.search(r'^ +image: *"?([^"\s]+)"? *$', doc, re.M)
        print(m.group(1) if m else '')
        break
PY
}
OBI_IMAGE="$(image_of ebpf-instrument)"
[ -n "${OBI_IMAGE}" ] || die "no OBI image in the render"
PROFILER_IMAGE="$(image_of profiling)"
# The sink is the contrib collector of the profiler's own release, so the
# profiles it decodes were encoded by the same pdata version.
SINK_IMAGE="otel/opentelemetry-collector-contrib:${PROFILER_IMAGE:+${PROFILER_IMAGE##*:}}"
[ -n "${PROFILER_IMAGE}" ] || SINK_IMAGE="otel/opentelemetry-collector-contrib:0.152.0"
CHART_IMAGES="$(sed -n 's/^ *image: *"\{0,1\}\([^"]*\)"\{0,1\} *$/\1/p' "${OUT}/render.yaml" | sort -u)"
ALL_IMAGES="$(printf '%s\n' ${CHART_IMAGES} "${SINK_IMAGE}" node:26-alpine redis:7-alpine postgres:17-alpine \
  busybox:1.37 alpine:3.20 | sort -u)"
log "OBI ${OBI_IMAGE}; profiler ${PROFILER_IMAGE:-off}; sink ${SINK_IMAGE}"
for img in ${ALL_IMAGES}; do
  if ! docker image inspect "${img}" >/dev/null 2>&1; then
    log "pulling ${img}"
    retry 4 docker pull -q "${img}" >/dev/null || die "cannot pull ${img}"
  fi
  echo "${img} $(docker image inspect -f '{{.Id}} {{.Os}}/{{.Architecture}}' "${img}")"
done >"${OUT}/images.txt"

# --- 2. cluster ---------------------------------------------------------------
platform_up
CLIENT_NODE="$(printf '%s\n' ${NODES} | grep -- '-control-plane$' | head -1 || true)"
APPS_NODE="$(printf '%s\n' ${NODES} | grep -v -- '-control-plane$' | head -1 || true)"
[ -n "${CLIENT_NODE}" ] || CLIENT_NODE="${APPS_NODE}"
[ -n "${APPS_NODE}" ] || APPS_NODE="${CLIENT_NODE}"
# Two keys, so a single node (k3s) can hold both roles.
k label node "${CLIENT_NODE}" e2e.oneuptime.com/client=true --overwrite >/dev/null
k label node "${APPS_NODE}" e2e.oneuptime.com/apps=true --overwrite >/dev/null
echo "platform=${PLATFORM} client=${CLIENT_NODE} apps=${APPS_NODE}" >"${OUT}/nodes.txt"

# A real node gets bpffs on /sys/fs/bpf from systemd. A KinD node is a
# container with a fresh, read-only sysfs and no bpffs there, so OBI cannot
# pin traces_ctx_v1 ("is bpffs mounted and accessible?" warning, falls back to
# process-internal maps) and the profiler finds nothing to read. One bpffs
# per node, mounted before the agent starts: OBI and the profiler on a node
# both hostPath-mount the node's /sys/fs/bpf, so they share that instance.
for n in ${NODES}; do
  if [ "${PLATFORM}" = kind ] && [ "${BPFFS}" = true ]; then
    node_sh "$n" 'mountpoint -q /sys/fs/bpf || mount -t bpf -o rw,nosuid,nodev,noexec,relatime,mode=700 bpf /sys/fs/bpf'
  fi
  {
    echo "== $n"
    node_sh "$n" 'uname -r; uname -m; ls -la /sys/kernel/btf/vmlinux 2>&1; mount | grep -E " /sys/fs/bpf | /sys/kernel/(tracing|debug) " || true; readlink /proc/1/ns/pid'
  } >>"${OUT}/node-facts.txt" 2>&1
done
if [ "${REUSE_CLUSTER}" = true ]; then
  # Leftovers of a previous run on a reused cluster: the workloads must be
  # fresh processes (OBI injects its Node.js agent once per process).
  h uninstall "${REL}" -n "${AGENT_NS}" --wait >/dev/null 2>&1 || true
  k delete namespace shop data sink loadgen "${AGENT_NS}" --ignore-not-found --wait=true >/dev/null
fi
node_sh "${CLIENT_NODE}" "rm -rf ${SINK_DIR}"
platform_load_images

# --- 3. sink and workloads -------------------------------------------------------
log "deploying the sink and the workloads"
for ns in sink shop loadgen; do
  k create namespace "$ns" --dry-run=client -o yaml | k apply -f - >/dev/null
  k -n "$ns" create configmap e2e-src --from-file="${HERE}/apps" --dry-run=client -o yaml | k apply -f - >/dev/null
done
sed "s#otel/opentelemetry-collector-contrib:0.152.0#${SINK_IMAGE}#" "${HERE}/manifests/sink.yaml" | k apply -f - >/dev/null
k apply -f "${HERE}/manifests/workloads.yaml" >/dev/null
wait_for 600 -n sink rollout status deploy/sink >/dev/null || not_ready sink deploy/sink
for d in redis postgres; do wait_for 600 -n data rollout status "deploy/$d" >/dev/null || not_ready data "deploy/$d"; done
for d in downstream app sleeper; do wait_for 600 -n shop rollout status "deploy/$d" >/dev/null || not_ready shop "deploy/$d"; done
k -n shop logs deploy/app -c app --tail=5 | tee -a "${OUT}/run.log" >&2

# --- 4. the agent ---------------------------------------------------------------------
log "helm install ${CHART}"
h install "${REL}" "${CHART}" -n "${AGENT_NS}" --create-namespace -f "${HERE}/values-e2e.yaml" \
  "${SET_ARGS[@]}" ${EXTRA_HELM[@]+"${EXTRA_HELM[@]}"} >"${OUT}/helm-install.txt" 2>&1 ||
  { cat "${OUT}/helm-install.txt" >&2; die "helm install failed"; }
# An agent component that is not Ready is what this test is here to catch:
# go on, so that its logs are collected and the checks (OBI-1, PR-1, ...)
# report it.
wait_for 300 -n "${AGENT_NS}" rollout status "ds/${FULL}-ebpf" || log "OBI is not Ready"
wait_for 300 -n "${AGENT_NS}" rollout status "deploy/${FULL}" || log "the agent collector is not Ready"
[ "${PROFILING}" != true ] || wait_for 300 -n "${AGENT_NS}" rollout status "ds/${FULL}-profiling" ||
  log "the profiler is not Ready"
# (items[*], not items[0], which fails when the node has no OBI pod at all.)
OBI_APPS_POD="$(k -n "${AGENT_NS}" get pod -l component=ebpf-instrument --field-selector "spec.nodeName=${APPS_NODE}" -o jsonpath='{.items[*].metadata.name}')"
OBI_APPS_POD="${OBI_APPS_POD%% *}"
log "waiting for OBI (${OBI_APPS_POD:-no pod on ${APPS_NODE}}) to inject its Node.js agent"
# (Each poll reads the whole log into a variable first: `k ... | grep -q`
# would SIGPIPE kubectl on a match, which k then retries and pipefail fails.)
for i in $(seq 1 60); do
  [ -n "${OBI_APPS_POD}" ] || break
  obi_log="$(kubectl --kubeconfig "${KC}" -n "${AGENT_NS}" logs "${OBI_APPS_POD}" 2>/dev/null || true)"
  case "${obi_log}" in *'Script successfully injected'*) break ;; esac
  sleep 5
done
if [ "${PLATFORM}" = kind ] && [ "${PROFILING}" = true ] && [ "${HOST_PROFILER}" = true ]; then
  # The root-namespace profiler (see the top of this file): the chart's own
  # receiver settings (configmap-profiling.yaml as rendered), with the pin
  # read through the apps node's mount namespace and the profiles written to
  # a file instead of exported. Started before the warmup: the profiler only
  # unwinds a process once it has synchronized it, one process at a time,
  # starting from each one's first sample, and on a busy host the backlog of
  # every other process it samples first has to drain before the load starts.
  mkdir -p "${OUT}/host-profiler"
  APPS_NODE_PID="$(docker inspect -f '{{.State.Pid}}' "${APPS_NODE}")"
  python3 - "${OUT}/render.yaml" "${OUT}/host-profiler/config.yaml" "${APPS_NODE_PID}" <<'PY'
import re
import sys

render, out, node_pid = sys.argv[1:4]
with open(render, encoding='utf-8') as f:
    docs = f.read().split('\n---\n')
doc = [d for d in docs if 'kind: ConfigMap' in d and re.search(r'name: \S+-profiling\n', d)][0]
cfg = '\n'.join(line[4:] for line in doc.split('config.yaml: |\n', 1)[1].splitlines())
receiver = cfg.split('receivers:\n', 1)[1].split('\nprocessors:', 1)[0].rstrip()
assert '  profiling:' in receiver, receiver
with open(out, 'w', encoding='utf-8') as f:
    f.write(
        'receivers:\n' + receiver + '\n'
        '    bpf_fs_root: /proc/%s/root/sys/fs/bpf/\n'
        'exporters:\n  file:\n    path: /out/profiles-host.json\n    format: json\n    flush_interval: 1s\n'
        'service:\n  pipelines:\n    profiles:\n      receivers: [profiling]\n      exporters: [file]\n' % node_pid)
PY
  docker rm -f -v "${HOST_PROFILER_NAME}" >/dev/null 2>&1 || true
  # /out is an anonymous volume, copied out with `docker cp` below: the file
  # exporter writes 0600 as root, which the caller could not read through a
  # bind mount on a Linux host.
  HOST_PROFILER_STARTED=true
  docker run -d --name "${HOST_PROFILER_NAME}" --privileged --pid=host \
    -v /out -v "${OUT}/host-profiler/config.yaml:/etc/profiler/config.yaml:ro" \
    -v /sys/kernel/debug:/sys/kernel/debug -v /sys/kernel/tracing:/sys/kernel/tracing \
    "${PROFILER_IMAGE}" --config=/etc/profiler/config.yaml --feature-gates=+service.profilesSupport >/dev/null
  for i in $(seq 1 60); do
    case "$(docker logs "${HOST_PROFILER_NAME}" 2>&1)" in *'Everything is ready'*) break ;; esac
    sleep 2
  done
  # The app's PID in the root namespace: the process in the app container
  # (its ID is in the cgroup path) whose NSpid chain has the PID the apps
  # node gives it.
  APP_CID="$(node_sh "${APPS_NODE}" "crictl inspect --output go-template --template '{{.status.id}}' \$(crictl ps -q --name '^app\$' | head -1)")"
  APP_NODE_PID="$(node_sh "${APPS_NODE}" "crictl inspect --output go-template --template '{{.info.pid}}' ${APP_CID}")"
  docker run --rm --pid=host alpine:3.20 sh -c "
    for s in /proc/[0-9]*/status; do
      p=\${s%/status}; p=\${p#/proc/}
      grep -q '${APP_CID}' /proc/\$p/cgroup 2>/dev/null || continue
      set -- \$(sed -n 's/^NSpid://p' \$s)
      [ \"\$2\" = '${APP_NODE_PID}' ] && echo \"appRootPid=\$1\"
    done" >"${OUT}/host-profiler/pids.txt" 2>/dev/null || true
  log "host profiler up; $(cat "${OUT}/host-profiler/pids.txt" 2>/dev/null) (node pid ${APP_NODE_PID})"
fi
log "warmup ${WARMUP}s"
sleep "${WARMUP}"

# --- 5. load (and, with profiling, the traces_ctx_v1 probe) -----------------------------
if [ "${PROFILING}" = true ]; then
  sed "s/@DURATION@/$((LOAD_SECONDS + 10))/" "${HERE}/manifests/ctxprobe.yaml" | k apply -f - >/dev/null
  for i in $(seq 1 90); do
    probe_log="$(kubectl --kubeconfig "${KC}" -n loadgen logs ctxprobe 2>/dev/null || true)"
    case "${probe_log}" in *PROBE-READY* | *PROBE-ERROR*) break ;; esac
    sleep 2
  done
  case "${probe_log}" in *PROBE-READY*) ;; *) log "traces_ctx_v1 probe not ready: $(printf '%s' "${probe_log}" | tail -3)" ;; esac
fi
log "load: ${LOAD_SECONDS}s, ${CONCURRENCY} loops, ${PAUSE_MS}ms pause"
sed -e "s/@DURATION@/${LOAD_SECONDS}/" -e "s/@CONCURRENCY@/${CONCURRENCY}/" -e "s/@PAUSE_MS@/${PAUSE_MS}/" \
  "${HERE}/manifests/loadgen-job.yaml" | k apply -f - >/dev/null
wait_for $((LOAD_SECONDS + 300)) -n loadgen wait --for=condition=complete job/loadgen >/dev/null ||
  log "the load generator did not complete"
k -n loadgen logs job/loadgen >"${OUT}/loadgen.log" 2>&1 || true
tail -1 "${OUT}/loadgen.log" | tee -a "${OUT}/run.log" >&2
log "flush ${FLUSH}s"
sleep "${FLUSH}"
if [ "${HOST_PROFILER_STARTED}" = true ]; then
  docker stop -t 30 "${HOST_PROFILER_NAME}" >/dev/null 2>&1 || true
  docker logs "${HOST_PROFILER_NAME}" >"${OUT}/host-profiler/profiler.log" 2>&1 || true
  docker cp "${HOST_PROFILER_NAME}:/out/profiles-host.json" "${OUT}/host-profiler/profiles-host.json" >/dev/null 2>&1 ||
    log "the host profiler wrote no profiles"
  docker rm -f -v "${HOST_PROFILER_NAME}" >/dev/null 2>&1 || true
fi

# --- 6. collect ---------------------------------------------------------------------------
log "collecting"
k get pods -A -o wide >"${OUT}/pods.txt"
k -n "${AGENT_NS}" get pods -o json >"${OUT}/agent-pods.json"
for P in $(k -n "${AGENT_NS}" get pod -l 'component in (ebpf-instrument,profiling)' -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}'); do
  node="$(k -n "${AGENT_NS}" get pod "$P" -o jsonpath='{.spec.nodeName}')"
  comp="$(k -n "${AGENT_NS}" get pod "$P" -o jsonpath='{.metadata.labels.component}')"
  k -n "${AGENT_NS}" logs "$P" >"${OUT}/${comp}-${node}.log" 2>&1 || true
  k -n "${AGENT_NS}" logs "$P" --previous >"${OUT}/${comp}-${node}.previous.txt" 2>&1 || true
done
k -n "${AGENT_NS}" logs "deploy/${FULL}" >"${OUT}/agent-collector.log" 2>&1 || true
k -n sink logs deploy/sink -c otelcol >"${OUT}/sink.log" 2>&1 || true
k -n sink logs deploy/sink -c proxy >"${OUT}/sink-proxy.log" 2>&1 || true
k -n shop logs deploy/app -c app >"${OUT}/app.log" 2>&1 || true
[ "${PROFILING}" != true ] || k -n loadgen logs ctxprobe >"${OUT}/ctxprobe.log" 2>&1 || true
# Node-level PIDs of every container: OBI logs name processes by the PID its
# node sees, and the profiler by the kernel's (root namespace) PID -- the same
# number on k3s, not on kind.
for n in ${NODES}; do
  node_sh "$n" "for id in \$($(crictl_cmd) ps -q); do $(crictl_cmd) inspect --output go-template --template '{{.info.pid}} {{index .status.labels \"io.kubernetes.pod.namespace\"}} {{index .status.labels \"io.kubernetes.pod.name\"}} {{index .status.labels \"io.kubernetes.container.name\"}}' \$id 2>/dev/null; echo; done" |
    sed "/^\$/d; s/^/$n /"
done >"${OUT}/container-pids.txt" 2>/dev/null || true
for f in traces metrics profiles; do
  node_fetch "${CLIENT_NODE}" "${SINK_DIR}/${f}.json" "${OUT}/${f}.json" 2>/dev/null || : >"${OUT}/${f}.json"
done
wc -c "${OUT}"/traces.json "${OUT}"/metrics.json "${OUT}"/profiles.json | tee -a "${OUT}/run.log" >&2

# --- 7. assertions ----------------------------------------------------------------------------
log "analyzing"
python3 "${HERE}/analyze.py" "${OUT}" --apps-node "${APPS_NODE}" --cluster-name "${CLUSTER_NAME}" \
  --obi-image "${OBI_IMAGE}" --profiling "${PROFILING}" --platform "${PLATFORM}" --bpffs "${BPFFS}" \
  --host-profiler "${HOST_PROFILER}" | tee "${OUT}/result.txt"
