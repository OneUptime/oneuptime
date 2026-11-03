#!/bin/sh
# OneUptime Docker Swarm Agent — inventory snapshot poller.
#
# MUST run on (or against) a swarm MANAGER node — the /nodes, /services,
# /tasks, /secrets, /configs endpoints are manager-only.
#
# Periodically walks the Swarm API and writes two files the collector reads:
#
#   - the inventory, one JSON line per resource, which the OTel filelog
#     receiver forwards to OneUptime as logs. Each line is the envelope the
#     backend inventory ingest expects:
#       {"oneuptime.dockerswarm.kind":"Node","data":{...flat fields...}}
#     The raw Docker Engine API JSON is reshaped with jq into the flat field
#     names the OneUptime DockerSwarmInventoryExtractor reads (Hostname,
#     Status, Mode, Replicas "X/Y", etc.) so the wire format matches.
#     Every DOCKER_INVENTORY_INTERVAL_SECONDS (5 minutes).
#
#   - the swarm's state as metrics, one OTLP JSON line the otlpjsonfile
#     receiver forwards: whether each node is ready, and how many replicas
#     each service wants and runs. Every
#     DOCKER_INVENTORY_METRICS_INTERVAL_SECONDS (1 minute), so OneUptime's
#     Node Not Ready and Service Replicas Mismatch alerts hear of a node or a
#     service in trouble within a minute or two, not five.
#
# Each file is written whole to a .tmp sibling and renamed, so the collector
# never reads a half-written one. And each starts with bytes of its own: the
# collector knows a file by its first kilobyte (its fingerprint), and a file
# that starts like one it has already read is taken for that file and read
# from where it stopped. The inventory used to start with the swarm's first
# node, the same bytes every time, so a calm swarm's identical snapshot was
# never read again - its inventory aged out of OneUptime 15 minutes after the
# agent started - and in a swarm whose snapshot filled a kilobyte, nothing
# past it changed in OneUptime unless the first kilobyte did. The inventory
# now opens with a Snapshot line (when it was taken, and a random id), and
# the metrics line with the time of its first reading.
# Tests/Ops/swarm-agent-inventory-behaviour.sh holds the collector to both.
#
# `--once` takes one snapshot of each and exits, for a check by hand (and for
# the tests).

set -eu

SOCKET="${DOCKER_INVENTORY_SOCKET:-/var/run/docker.sock}"
LOG_PATH="${DOCKER_INVENTORY_LOG_PATH:-/var/log/oneuptime-docker-swarm-inventory.log}"
METRICS_PATH="${DOCKER_INVENTORY_METRICS_PATH:-/var/log/oneuptime-docker-swarm-inventory-metrics.json}"
INTERVAL="${DOCKER_INVENTORY_INTERVAL_SECONDS:-300}"
METRICS_INTERVAL="${DOCKER_INVENTORY_METRICS_INTERVAL_SECONDS:-60}"
# Failed or rejected tasks this recent count toward a service's crash loop.
FAILED_TASK_WINDOW_SECONDS="${DOCKER_INVENTORY_FAILED_TASK_WINDOW_SECONDS:-3600}"
API_VERSION="${DOCKER_API_VERSION:-}"

# Follow the collector's DOCKER_API_VERSION, which is empty unless someone
# pins a version: the collector then negotiates the version with the daemon.
# curl has no negotiation, so empty drops the /v<version> prefix instead --
# the Docker API serves those unversioned paths at the daemon's own version,
# the same outcome, on any daemon (a pinned 1.44 was refused by Engine 20.10
# to 24 as "too new"). A version that IS set is used as it is.
# docker-compose.yml passes the variable to this sidecar as well as the collector.
if [ -n "${API_VERSION}" ]; then
    DOCKER_API="http://localhost/v${API_VERSION}"
else
    DOCKER_API="http://localhost"
fi

TMP_DIR="$(dirname "${LOG_PATH}")"
SERVICES_JSON="${TMP_DIR}/.oneuptime-swarm-services.json"
NODES_JSON="${TMP_DIR}/.oneuptime-swarm-nodes.json"
TASKS_JSON="${TMP_DIR}/.oneuptime-swarm-tasks.json"
METRICS_TMP_DIR="$(dirname "${METRICS_PATH}")"
METRICS_SERVICES_JSON="${METRICS_TMP_DIR}/.oneuptime-swarm-metrics-services.json"
METRICS_NODES_JSON="${METRICS_TMP_DIR}/.oneuptime-swarm-metrics-nodes.json"

fetch() {
    # $1 = endpoint. Echoes JSON to stdout, or "[]" on failure.
    curl --silent --fail --unix-socket "${SOCKET}" "${DOCKER_API}$1" 2>/dev/null || echo "[]"
}

# A random id for this snapshot: the kernel's, else the time and this shell's.
snapshot_id() {
    cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "$(date -u +%s)-$$"
}

snapshot() {
    # The line of its own the snapshot opens with (see the top of the file).
    jq -nc \
        --arg takenAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        --arg id "$(snapshot_id)" \
        '{"oneuptime.dockerswarm.kind":"Snapshot","data":{TakenAt: $takenAt, Id: $id}}' \
        > "${LOG_PATH}.tmp"

    # This node's hostname (for Volume node attribution). Prefer an
    # explicit override, else read the daemon's reported Name from /info.
    NODE_HOSTNAME="${DOCKER_SWARM_NODE_HOSTNAME:-}"
    if [ -z "${NODE_HOSTNAME}" ]; then
        NODE_HOSTNAME="$(fetch "/info" | jq -r '.Name // empty' 2>/dev/null || echo "")"
    fi

    # Cache services, nodes and tasks for the joins below.
    fetch "/services?status=true" > "${SERVICES_JSON}" || echo "[]" > "${SERVICES_JSON}"
    fetch "/nodes" > "${NODES_JSON}" || echo "[]" > "${NODES_JSON}"
    fetch "/tasks" > "${TASKS_JSON}" || echo "[]" > "${TASKS_JSON}"

    # Nodes. ManagerStatus is Leader, Reachable or Unreachable, as `docker
    # node ls` says it (it used to read Reachable for any manager that was not
    # the leader, an unreachable one too).
    jq -c '.[] | {"oneuptime.dockerswarm.kind":"Node","data":{
        ID: .ID,
        Hostname: .Description.Hostname,
        Status: .Status.State,
        Message: (.Status.Message // ""),
        Addr: (.Status.Addr // ""),
        Availability: .Spec.Availability,
        Role: .Spec.Role,
        ManagerStatus: (
          if .ManagerStatus == null then ""
          elif .ManagerStatus.Leader == true then "Leader"
          else ((.ManagerStatus.Reachability // "") | ascii_downcase
                | if . == "reachable" then "Reachable"
                  elif . == "unreachable" then "Unreachable"
                  else "Unknown" end)
          end),
        EngineVersion: .Description.Engine.EngineVersion,
        NanoCPUs: ((.Description.Resources.NanoCPUs // 0) | tostring),
        MemoryBytes: ((.Description.Resources.MemoryBytes // 0) | tostring)
      }}' "${NODES_JSON}" >> "${LOG_PATH}.tmp" 2>/dev/null \
      || echo "oneuptime-swarm-inventory: failed to emit Node" >&2

    # Services, with how their last rolling update went and the tasks that
    # failed or were rejected in the last FAILED_TASK_WINDOW_SECONDS - the
    # newest one's error is why a service runs short, or keeps restarting.
    jq -c \
        --slurpfile tasks "${TASKS_JSON}" \
        --argjson window "${FAILED_TASK_WINDOW_SECONDS}" '
        # A task timestamp ("2026-11-02T21:30:15.123456789Z") in seconds.
        def seconds: (. // "") | sub("\\.[0-9]+"; "") | (try fromdateiso8601 catch 0);
        (now - $window) as $since |
        (($tasks[0] // [])
          | map(select(((.Status.State // "") == "failed" or (.Status.State // "") == "rejected")
                       and ((.Status.Timestamp | seconds) >= $since)))
          | group_by(.ServiceID)
          | map({key: .[0].ServiceID, value: (sort_by(.Status.Timestamp | seconds))})
          | from_entries) as $failed |
        .[] | (($failed[.ID] // [])) as $recent | ($recent | last) as $last |
        {"oneuptime.dockerswarm.kind":"Service","data":{
        ID: .ID,
        Name: .Spec.Name,
        Mode: (if .Spec.Mode.Replicated then "replicated"
               elif .Spec.Mode.Global then "global"
               elif .Spec.Mode.ReplicatedJob then "replicated-job"
               elif .Spec.Mode.GlobalJob then "global-job"
               else "" end),
        Replicas: (((.ServiceStatus.RunningTasks // 0)|tostring) + "/" + ((.ServiceStatus.DesiredTasks // .Spec.Mode.Replicated.Replicas // 0)|tostring)),
        CompletedTasks: ((.ServiceStatus.CompletedTasks // 0) | tostring),
        Image: ((.Spec.TaskTemplate.ContainerSpec.Image // "") | sub("@sha256:.*";"")),
        StackNamespace: (.Spec.Labels["com.docker.stack.namespace"] // ""),
        CreatedAt: (.CreatedAt // ""),
        UpdatedAt: (.UpdatedAt // ""),
        UpdateState: (.UpdateStatus.State // ""),
        UpdateMessage: (.UpdateStatus.Message // ""),
        UpdateStartedAt: (.UpdateStatus.StartedAt // ""),
        UpdateCompletedAt: (.UpdateStatus.CompletedAt // ""),
        RecentFailedTasks: ($recent | length | tostring),
        LastTaskError: ($last.Status.Err // ""),
        LastTaskState: ($last.Status.State // ""),
        LastTaskErrorAt: ($last.Status.Timestamp // ""),
        LastTaskExitCode: (($last.Status.ContainerStatus.ExitCode // "") | tostring)
      }}' "${SERVICES_JSON}" >> "${LOG_PATH}.tmp" 2>/dev/null \
      || echo "oneuptime-swarm-inventory: failed to emit Service" >&2

    # Stacks — derived from the com.docker.stack.namespace service label.
    jq -c '[.[] | .Spec.Labels["com.docker.stack.namespace"] // empty]
            | group_by(.)
            | map({"oneuptime.dockerswarm.kind":"Stack","data":{Name: .[0], Services: (length|tostring)}})
            | .[]' "${SERVICES_JSON}" >> "${LOG_PATH}.tmp" 2>/dev/null \
      || echo "oneuptime-swarm-inventory: failed to emit Stack" >&2

    # Tasks — only the currently-desired (running) set; joined to service
    # name + node hostname via the cached files. A replicated service's task
    # is named after its slot (shop_web.2), a global one's after its node, as
    # `docker service ps` names them (each global task used to read ".0").
    # Since is when the task entered its current state; ContainerID its
    # container's (a task's page shows it, and its container's metrics and
    # logs are named after it).
    jq -c \
        --slurpfile svcs "${SERVICES_JSON}" \
        --slurpfile nodes "${NODES_JSON}" '
        (($svcs[0] // []) | map({(.ID): .Spec.Name}) | add // {}) as $svcmap |
        (($nodes[0] // []) | map({(.ID): .Description.Hostname}) | add // {}) as $nodemap |
        .[] | select(.DesiredState == "running")
        | {"oneuptime.dockerswarm.kind":"Task","data":{
            ID: .ID,
            Name: (($svcmap[.ServiceID] // .ServiceID) + "."
                   + (if (.Slot // 0) > 0 then (.Slot | tostring) else (.NodeID // "") end)),
            Service: ($svcmap[.ServiceID] // .ServiceID),
            Image: ((.Spec.ContainerSpec.Image // "") | sub("@sha256:.*";"")),
            Node: ($nodemap[.NodeID] // .NodeID),
            CurrentState: .Status.State,
            DesiredState: .DesiredState,
            Error: (.Status.Err // ""),
            Since: (.Status.Timestamp // ""),
            Slot: ((.Slot // "") | tostring),
            ContainerID: (.Status.ContainerStatus.ContainerID // ""),
            ExitCode: ((.Status.ContainerStatus.ExitCode // "") | tostring)
          }}' "${TASKS_JSON}" >> "${LOG_PATH}.tmp" 2>/dev/null \
      || echo "oneuptime-swarm-inventory: failed to emit Task" >&2

    # Networks — swarm-scoped (overlay/ingress) only.
    fetch "/networks" | jq -c '.[] | select(.Scope == "swarm")
        | {"oneuptime.dockerswarm.kind":"Network","data":{ID: .Id, Name: .Name, Driver: .Driver, Scope: .Scope}}' \
      >> "${LOG_PATH}.tmp" 2>/dev/null \
      || echo "oneuptime-swarm-inventory: failed to emit Network" >&2

    # Secrets
    fetch "/secrets" | jq -c '.[] | {"oneuptime.dockerswarm.kind":"Secret","data":{ID: .ID, Name: .Spec.Name, CreatedAt: .CreatedAt, UpdatedAt: .UpdatedAt}}' \
      >> "${LOG_PATH}.tmp" 2>/dev/null \
      || echo "oneuptime-swarm-inventory: failed to emit Secret" >&2

    # Configs
    fetch "/configs" | jq -c '.[] | {"oneuptime.dockerswarm.kind":"Config","data":{ID: .ID, Name: .Spec.Name, CreatedAt: .CreatedAt, UpdatedAt: .UpdatedAt}}' \
      >> "${LOG_PATH}.tmp" 2>/dev/null \
      || echo "oneuptime-swarm-inventory: failed to emit Config" >&2

    # Volumes (local to the manager node this agent runs on).
    fetch "/volumes" | jq -c --arg node "${NODE_HOSTNAME}" '.Volumes[]?
        | {"oneuptime.dockerswarm.kind":"Volume","data":{Name: .Name, Driver: .Driver, Scope: .Scope, Mountpoint: .Mountpoint, Node: $node}}' \
      >> "${LOG_PATH}.tmp" 2>/dev/null \
      || echo "oneuptime-swarm-inventory: failed to emit Volume" >&2

    mv "${LOG_PATH}.tmp" "${LOG_PATH}"
}

# The swarm's state as OTLP metrics, one resource per node and per service:
#   docker.swarm.node.ready                1 while the node is ready, else 0
#   docker.swarm.service.replicas.desired  the replicas the service wants
#   docker.swarm.service.replicas.running  the replicas it runs
# on resources named as the task containers' are (docker.swarm.node.name,
# docker.swarm.service.name); the collector stamps the cluster's name. A job
# service (replicated-job, global-job) runs to completion, so it has no
# replicas to fall short of and is left out. A read that fails writes
# nothing, never a swarm of no nodes: no data is not a node that is down.
# scopeMetrics is written before resource so the line's first reading, and
# its time, are in its first bytes (see the top of the file).
metrics() {
    fetch "/nodes" > "${METRICS_NODES_JSON}" || echo "[]" > "${METRICS_NODES_JSON}"
    fetch "/services?status=true" > "${METRICS_SERVICES_JSON}" || echo "[]" > "${METRICS_SERVICES_JSON}"

    jq -nc \
        --arg time "$(date -u +%s)000000000" \
        --slurpfile nodes "${METRICS_NODES_JSON}" \
        --slurpfile services "${METRICS_SERVICES_JSON}" '
        def attribute(key; value): {key: key, value: {stringValue: (value // "" | tostring)}};
        def gauge(name; unit; value): {name: name, unit: unit, gauge: {dataPoints: [{timeUnixNano: $time, asInt: (value | tostring)}]}};
        def scope(metrics): [{scope: {name: "oneuptime.docker-swarm.inventory"}, metrics: metrics}];
        {resourceMetrics: (
          [($nodes[0] // [])[] | select(type == "object") | {
            scopeMetrics: scope([gauge("docker.swarm.node.ready"; "1";
              (if (.Status.State // "") == "ready" then 1 else 0 end))]),
            resource: {attributes: [
              attribute("docker.swarm.node.name"; (.Description.Hostname // .ID)),
              attribute("docker.swarm.node.id"; .ID),
              attribute("docker.swarm.node.role"; .Spec.Role)
            ]}
          }]
          + [($services[0] // [])[] | select(type == "object")
            | select(.Spec.Mode.Replicated != null or .Spec.Mode.Global != null) | {
            scopeMetrics: scope([
              gauge("docker.swarm.service.replicas.desired"; "{replicas}";
                (.ServiceStatus.DesiredTasks // .Spec.Mode.Replicated.Replicas // 0)),
              gauge("docker.swarm.service.replicas.running"; "{replicas}";
                (.ServiceStatus.RunningTasks // 0))
            ]),
            resource: {attributes: (
              [attribute("docker.swarm.service.name"; .Spec.Name),
               attribute("docker.swarm.service.mode";
                 (if .Spec.Mode.Replicated then "replicated" else "global" end))]
              + (if (.Spec.Labels["com.docker.stack.namespace"] // "") != ""
                 then [attribute("docker.swarm.stack.namespace"; .Spec.Labels["com.docker.stack.namespace"])]
                 else [] end))}
          }]
        )}' > "${METRICS_PATH}.tmp" 2>/dev/null \
      || { echo "oneuptime-swarm-inventory: failed to emit metrics" >&2; rm -f "${METRICS_PATH}.tmp"; return 0; }

    mv "${METRICS_PATH}.tmp" "${METRICS_PATH}"
}

if [ "${1:-}" = "--once" ]; then
    metrics
    snapshot
    exit 0
fi

# Readings every METRICS_INTERVAL, the inventory every INTERVAL (counted in
# the readings' steps, so a metrics interval longer than the inventory's
# takes a snapshot every time).
case "${METRICS_INTERVAL}" in
    ''|*[!0-9]*|0) METRICS_INTERVAL=60 ;;
esac
case "${INTERVAL}" in
    ''|*[!0-9]*|0) INTERVAL=300 ;;
esac

UNTIL_SNAPSHOT=0
while :; do
    metrics || echo "oneuptime-swarm-inventory: metrics iteration failed" >&2
    if [ "${UNTIL_SNAPSHOT}" -le 0 ]; then
        snapshot || echo "oneuptime-swarm-inventory: snapshot iteration failed" >&2
        UNTIL_SNAPSHOT="${INTERVAL}"
    fi
    sleep "${METRICS_INTERVAL}"
    UNTIL_SNAPSHOT=$((UNTIL_SNAPSHOT - METRICS_INTERVAL))
done
