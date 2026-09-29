#!/bin/sh
# OneUptime Docker Swarm Agent — installer.
#
# Run this on a swarm MANAGER node. It downloads the compose file, the
# collector config and the inventory poller into
# /opt/oneuptime-docker-swarm-agent, writes a .env from your answers,
# and starts the agent with Docker Compose.
#
# The compose file also runs the OneUptime AI agent for the swarm
# (oneuptime-docker-swarm-ai-agent), read-only unless
# ONEUPTIME_AI_ALLOW_WRITES=true. Leave it out with --no-ai-agent or
# ONEUPTIME_INSTALL_AI_AGENT=false. On a node that is not a swarm manager it
# is always left out: it only works on a manager.

set -eu

INSTALL_DIR="${INSTALL_DIR:-/opt/oneuptime-docker-swarm-agent}"
RAW_BASE="https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/DockerSwarmAgent"
AI_AGENT_SERVICE="oneuptime-docker-swarm-ai-agent"
# The first line of the compose override --no-ai-agent writes.
AI_AGENT_OVERRIDE_MARKER="# Written by the OneUptime Docker Swarm Agent installer (--no-ai-agent)."

INSTALL_AI_AGENT="${ONEUPTIME_INSTALL_AI_AGENT:-true}"
for arg in "$@"; do
    case "$arg" in
        --no-ai-agent) INSTALL_AI_AGENT=false ;;
        *)
            echo "Unknown option: $arg (the only option is --no-ai-agent)" >&2
            exit 1
            ;;
    esac
done

# "true" lets OneUptime AI apply fixes; anything else keeps the AI agent
# read-only. Read the way the agent reads it (case and surrounding blanks
# ignored), and written to .env as exactly true or false, so what this script
# says below is what the agent does.
case "$(printf '%s' "${ONEUPTIME_AI_ALLOW_WRITES:-}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | tr '[:upper:]' '[:lower:]')" in
    true) ONEUPTIME_AI_ALLOW_WRITES=true ;;
    *) ONEUPTIME_AI_ALLOW_WRITES=false ;;
esac

# The value NAME has in the .env an earlier run (or you) wrote, as written;
# nothing when there is none.
env_file_value() {
    if [ -f "${INSTALL_DIR}/.env" ]; then
        sed -n "s/^$1=//p" "${INSTALL_DIR}/.env" | tail -n 1
    fi
}

# The targets fixes may touch, and the ones OneUptime AI must never change.
# Both go into .env, so every later docker compose up (the systemd unit, an
# upgrade, switching fixes on) keeps them. Unset here, the .env's value is
# kept: re-running this script never drops a list. Set (even to empty), it
# replaces it.
if [ -z "${ONEUPTIME_AI_WRITE_TARGETS+set}" ]; then
    ONEUPTIME_AI_WRITE_TARGETS="$(env_file_value ONEUPTIME_AI_WRITE_TARGETS)"
fi
if [ -z "${ONEUPTIME_AI_PROTECTED_TARGETS+set}" ]; then
    ONEUPTIME_AI_PROTECTED_TARGETS="$(env_file_value ONEUPTIME_AI_PROTECTED_TARGETS)"
fi

# The AI agent's node, service and task commands only work on a manager. On
# a worker, or an engine outside any swarm, it can run nothing, so it is left
# out there: a worker's agent would only wait. Only a definite answer counts
# (an active node that is no manager, or no swarm at all); a locked, joining
# or failing node, or a docker that cannot say, gets the agent, which finds
# out itself.
AI_AGENT_NOT_ON_MANAGER=false
if [ "${INSTALL_AI_AGENT}" != "false" ]; then
    case "$(docker info --format '{{.Swarm.LocalNodeState}} {{.Swarm.ControlAvailable}}' 2>/dev/null || true)" in
        "active false" | "inactive false")
            INSTALL_AI_AGENT=false
            AI_AGENT_NOT_ON_MANAGER=true
            ;;
    esac
fi

echo "OneUptime Docker Swarm Agent installer"
echo "--------------------------------------"
echo "Run this on a Docker Swarm MANAGER node (the inventory poller needs the manager API)."
if [ "${AI_AGENT_NOT_ON_MANAGER}" = "true" ]; then
    echo "This node is not a swarm manager, so the OneUptime AI agent is left out here."
fi
echo ""

printf "OneUptime URL [https://oneuptime.com]: "
read -r ONEUPTIME_URL
ONEUPTIME_URL="${ONEUPTIME_URL:-https://oneuptime.com}"

printf "OneUptime Telemetry Ingestion Key: "
read -r ONEUPTIME_SERVICE_TOKEN

printf "Docker Swarm cluster name (the join key) [my-swarm]: "
read -r DOCKER_SWARM_CLUSTER_NAME
DOCKER_SWARM_CLUSTER_NAME="${DOCKER_SWARM_CLUSTER_NAME:-my-swarm}"

if [ -z "${ONEUPTIME_SERVICE_TOKEN}" ]; then
    echo "ERROR: a telemetry ingestion key is required." >&2
    exit 1
fi

mkdir -p "${INSTALL_DIR}"
cd "${INSTALL_DIR}"

echo "Downloading agent files into ${INSTALL_DIR}..."
curl -fsSL "${RAW_BASE}/docker-compose.yml" -o docker-compose.yml
curl -fsSL "${RAW_BASE}/otel-collector-config.yaml" -o otel-collector-config.yaml
curl -fsSL "${RAW_BASE}/inventory-snapshot.sh" -o inventory-snapshot.sh
chmod +x inventory-snapshot.sh

# The .env holds the ingestion key: readable by its owner only.
(
    umask 077
    cat > .env <<EOF
ONEUPTIME_URL=${ONEUPTIME_URL}
ONEUPTIME_SERVICE_TOKEN=${ONEUPTIME_SERVICE_TOKEN}
DOCKER_SWARM_CLUSTER_NAME=${DOCKER_SWARM_CLUSTER_NAME}
ONEUPTIME_AI_ALLOW_WRITES=${ONEUPTIME_AI_ALLOW_WRITES}
ONEUPTIME_AI_WRITE_TARGETS=${ONEUPTIME_AI_WRITE_TARGETS}
ONEUPTIME_AI_PROTECTED_TARGETS=${ONEUPTIME_AI_PROTECTED_TARGETS}
EOF
)
chmod 600 .env

# --no-ai-agent (or a node that is not a manager): a compose override that
# puts the AI agent in a profile nothing enables, so neither this script nor
# the systemd unit (docker compose up) starts it. Otherwise only an override
# this script wrote is removed; one of your own is left alone.
if [ "${INSTALL_AI_AGENT}" = "false" ]; then
    cat > docker-compose.override.yml <<EOF
${AI_AGENT_OVERRIDE_MARKER}
# It keeps the OneUptime AI agent from starting. Delete this file and run
# docker compose up -d to start it.
services:
  ${AI_AGENT_SERVICE}:
    profiles: ["ai-agent-disabled"]
EOF
elif [ -f docker-compose.override.yml ] && \
    [ "$(head -n 1 docker-compose.override.yml)" = "${AI_AGENT_OVERRIDE_MARKER}" ]; then
    rm -f docker-compose.override.yml
fi

echo "Starting the agent..."
docker compose pull
docker compose up -d

echo ""
echo "Done. The cluster '${DOCKER_SWARM_CLUSTER_NAME}' should appear in OneUptime within a few minutes."
echo "Logs: docker compose -f ${INSTALL_DIR}/docker-compose.yml logs -f"

echo ""
if [ "${AI_AGENT_NOT_ON_MANAGER}" = "true" ]; then
    echo "The OneUptime AI agent was left out: this node is not a swarm manager, and the"
    echo "AI agent only works on one. Run this script on a manager node to install it there."
    if docker ps -a --format '{{.Names}}' | grep -q "^${AI_AGENT_SERVICE}\$"; then
        # docker stop, not rm -f: the agent signs off, so the manager's agent
        # is let in at once.
        echo "Removing the AI agent installed earlier on this node..."
        if docker stop "${AI_AGENT_SERVICE}" >/dev/null && docker rm "${AI_AGENT_SERVICE}" >/dev/null; then
            echo "Removed ${AI_AGENT_SERVICE}."
        else
            echo "Warning: could not remove it; run: docker stop ${AI_AGENT_SERVICE} && docker rm ${AI_AGENT_SERVICE}"
        fi
    fi
elif [ "${INSTALL_AI_AGENT}" = "false" ]; then
    echo "The OneUptime AI agent was left out (--no-ai-agent)."
    if docker ps -a --format '{{.Names}}' | grep -q "^${AI_AGENT_SERVICE}\$"; then
        echo "An AI agent installed earlier is still there; remove it with: docker rm -f ${AI_AGENT_SERVICE}"
    fi
elif [ "${ONEUPTIME_AI_ALLOW_WRITES}" = "true" ]; then
    echo "OneUptime AI agent: ${AI_AGENT_SERVICE}. It may apply the fixes you allow on the"
    echo "cluster's AI agent page in OneUptime (never to itself or the collector)."
else
    echo "OneUptime AI agent: ${AI_AGENT_SERVICE}, read-only: OneUptime AI can look at the"
    echo "swarm's nodes, services and tasks while it investigates, but not change them."
    echo "To let it apply fixes (a rolling restart, rollback or scale of a service), set"
    echo "ONEUPTIME_AI_ALLOW_WRITES=true in ${INSTALL_DIR}/.env and run:"
    echo "  cd ${INSTALL_DIR} && docker compose up -d"
    echo "then choose on the cluster's AI agent page whether each fix needs approval."
fi
