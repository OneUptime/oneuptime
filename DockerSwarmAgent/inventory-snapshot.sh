#!/bin/sh
# OneUptime Docker Swarm Agent — inventory snapshot poller.
#
# MUST run on (or against) a swarm MANAGER node — the /nodes, /services,
# /tasks, /secrets, /configs endpoints are manager-only.
#
# Periodically walks the Swarm API and writes one JSON line per resource
# to a log file the OTel filelog receiver forwards to OneUptime. Each
# line is the envelope the backend inventory ingest expects:
#   {"oneuptime.dockerswarm.kind":"Node","data":{...flat fields...}}
#
# The raw Docker Engine API JSON is reshaped with jq into the flat field
# names the OneUptime DockerSwarmInventoryExtractor reads (Hostname,
# Status, Mode, Replicas "X/Y", etc.) so the wire format matches.
#
# Output is truncated each run (fresh snapshot, not a growing tail). We
# write to a .tmp sibling and atomically rename so the collector never
# reads a half-written file.

set -eu

SOCKET="${DOCKER_INVENTORY_SOCKET:-/var/run/docker.sock}"
LOG_PATH="${DOCKER_INVENTORY_LOG_PATH:-/var/log/oneuptime-docker-swarm-inventory.log}"
INTERVAL="${DOCKER_INVENTORY_INTERVAL_SECONDS:-300}"
DOCKER_API="http://localhost/v1.44"

TMP_DIR="$(dirname "${LOG_PATH}")"
SERVICES_JSON="${TMP_DIR}/.oneuptime-swarm-services.json"
NODES_JSON="${TMP_DIR}/.oneuptime-swarm-nodes.json"

fetch() {
    # $1 = endpoint. Echoes JSON to stdout, or "[]" on failure.
    curl --silent --fail --unix-socket "${SOCKET}" "${DOCKER_API}$1" 2>/dev/null || echo "[]"
}

snapshot() {
    : > "${LOG_PATH}.tmp"

    # This node's hostname (for Volume node attribution). Prefer an
    # explicit override, else read the daemon's reported Name from /info.
    NODE_HOSTNAME="${DOCKER_SWARM_NODE_HOSTNAME:-}"
    if [ -z "${NODE_HOSTNAME}" ]; then
        NODE_HOSTNAME="$(fetch "/info" | jq -r '.Name // empty' 2>/dev/null || echo "")"
    fi

    # Cache services + nodes for the task/stack joins below.
    fetch "/services?status=true" > "${SERVICES_JSON}" || echo "[]" > "${SERVICES_JSON}"
    fetch "/nodes" > "${NODES_JSON}" || echo "[]" > "${NODES_JSON}"

    # Nodes
    jq -c '.[] | {"oneuptime.dockerswarm.kind":"Node","data":{
        ID: .ID,
        Hostname: .Description.Hostname,
        Status: .Status.State,
        Availability: .Spec.Availability,
        Role: .Spec.Role,
        ManagerStatus: (if .ManagerStatus.Leader == true then "Leader" elif .ManagerStatus then "Reachable" else "" end),
        EngineVersion: .Description.Engine.EngineVersion
      }}' "${NODES_JSON}" >> "${LOG_PATH}.tmp" 2>/dev/null \
      || echo "oneuptime-swarm-inventory: failed to emit Node" >&2

    # Services
    jq -c '.[] | {"oneuptime.dockerswarm.kind":"Service","data":{
        ID: .ID,
        Name: .Spec.Name,
        Mode: (if .Spec.Mode.Replicated then "replicated" elif .Spec.Mode.Global then "global" else "" end),
        Replicas: (((.ServiceStatus.RunningTasks // 0)|tostring) + "/" + ((.ServiceStatus.DesiredTasks // .Spec.Mode.Replicated.Replicas // 0)|tostring)),
        Image: ((.Spec.TaskTemplate.ContainerSpec.Image // "") | sub("@sha256:.*";"")),
        StackNamespace: (.Spec.Labels["com.docker.stack.namespace"] // "")
      }}' "${SERVICES_JSON}" >> "${LOG_PATH}.tmp" 2>/dev/null \
      || echo "oneuptime-swarm-inventory: failed to emit Service" >&2

    # Stacks — derived from the com.docker.stack.namespace service label.
    jq -c '[.[] | .Spec.Labels["com.docker.stack.namespace"] // empty]
            | group_by(.)
            | map({"oneuptime.dockerswarm.kind":"Stack","data":{Name: .[0], Services: (length|tostring)}})
            | .[]' "${SERVICES_JSON}" >> "${LOG_PATH}.tmp" 2>/dev/null \
      || echo "oneuptime-swarm-inventory: failed to emit Stack" >&2

    # Tasks — only the currently-desired (running) set; joined to service
    # name + node hostname via the cached files.
    fetch "/tasks" | jq -c \
        --slurpfile svcs "${SERVICES_JSON}" \
        --slurpfile nodes "${NODES_JSON}" '
        (($svcs[0] // []) | map({(.ID): .Spec.Name}) | add // {}) as $svcmap |
        (($nodes[0] // []) | map({(.ID): .Description.Hostname}) | add // {}) as $nodemap |
        .[] | select(.DesiredState == "running")
        | {"oneuptime.dockerswarm.kind":"Task","data":{
            ID: .ID,
            Name: (($svcmap[.ServiceID] // .ServiceID) + "." + ((.Slot // 0)|tostring)),
            Image: ((.Spec.ContainerSpec.Image // "") | sub("@sha256:.*";"")),
            Node: ($nodemap[.NodeID] // .NodeID),
            CurrentState: .Status.State,
            DesiredState: .DesiredState,
            Error: (.Status.Err // "")
          }}' >> "${LOG_PATH}.tmp" 2>/dev/null \
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

while :; do
    snapshot || echo "oneuptime-swarm-inventory: snapshot iteration failed" >&2
    sleep "${INTERVAL}"
done
