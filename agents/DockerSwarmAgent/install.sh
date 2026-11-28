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

# What OneUptime AI may do on the cluster: ONEUPTIME_AI_INVESTIGATION (true or
# false) and ONEUPTIME_AI_FIXES (off, ask-for-approval, automatic or
# bypass-approval). Kept like the target lists: unset here, the .env's value
# stays; set (even to empty), it replaces it.
if [ -z "${ONEUPTIME_AI_INVESTIGATION+set}" ]; then
    ONEUPTIME_AI_INVESTIGATION="$(env_file_value ONEUPTIME_AI_INVESTIGATION)"
fi
if [ -z "${ONEUPTIME_AI_FIXES+set}" ]; then
    ONEUPTIME_AI_FIXES="$(env_file_value ONEUPTIME_AI_FIXES)"
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

# Enter takes the OneUptime URL in the environment, which the install
# command OneUptime shows sets to the reader's own OneUptime (the address
# this script and the agent's files come from), or else OneUptime Cloud's.
ONEUPTIME_URL_DEFAULT="${ONEUPTIME_URL:-https://oneuptime.com}"
printf "OneUptime URL [%s]: " "${ONEUPTIME_URL_DEFAULT}"
read -r ONEUPTIME_URL
ONEUPTIME_URL="${ONEUPTIME_URL:-${ONEUPTIME_URL_DEFAULT}}"

printf "OneUptime Telemetry Ingestion Key: "
read -r ONEUPTIME_SERVICE_TOKEN

printf "Docker Swarm cluster name (the join key) [my-swarm]: "
read -r DOCKER_SWARM_CLUSTER_NAME
DOCKER_SWARM_CLUSTER_NAME="${DOCKER_SWARM_CLUSTER_NAME:-my-swarm}"

if [ -z "${ONEUPTIME_SERVICE_TOKEN}" ]; then
    echo "ERROR: a telemetry ingestion key is required." >&2
    exit 1
fi

# This node's name, which the collector stamps as docker.swarm.node.name on
# the node's container metrics and logs (Swarm labels a task with its node's
# ID only). The daemon's name is the node's hostname, the name `docker node
# ls` shows. Set DOCKER_SWARM_NODE_NAME to name the node yourself. Only the
# characters a hostname has are kept: the name goes into the collector's
# config as it is.
if [ -z "${DOCKER_SWARM_NODE_NAME:-}" ]; then
    DOCKER_SWARM_NODE_NAME="$(docker info --format '{{.Name}}' 2>/dev/null || true)"
fi
DOCKER_SWARM_NODE_NAME="$(printf '%s' "${DOCKER_SWARM_NODE_NAME}" | tr -cd 'A-Za-z0-9._-')"

# ----------------------------------------------------------------------------
# Where the agent's files come from
# ----------------------------------------------------------------------------
# The OneUptime this agent reports to serves the files of its own release,
# and this script, at <ONEUPTIME_URL>/install/<agent>, so the agent always
# matches its OneUptime. A OneUptime older than that answers with a 404 or a
# page of its own instead: the files then come from GitHub, as this script
# downloaded them before. Any other answer (none at all, a server error)
# stops the install, and every file must arrive as plain text, wherever it
# comes from. Every agent's install.sh has this same block.
AGENT_FILES_PATH="install/docker-swarm-agent"
AGENT_FILES_ON_GITHUB="https://raw.githubusercontent.com/OneUptime/oneuptime/main/agents/DockerSwarmAgent"
AGENT_FILES_URL=""
AGENT_FILE_ANSWER=""

# download_agent_text <url> <destination>: true when the URL answers 200 with
# plain text; AGENT_FILE_ANSWER holds its status and content type either way.
download_agent_text() {
    AGENT_FILE_ANSWER="$(curl -sSL -o "$2" -w '%{http_code} %{content_type}' "$1")" || AGENT_FILE_ANSWER="000"
    case "$AGENT_FILE_ANSWER" in
        "200 text/plain"*) return 0 ;;
        *) return 1 ;;
    esac
}

# fetch_agent_file <file> <destination>: one of the agent's files, from
# where the first one came from.
fetch_agent_file() {
    if [ -z "$AGENT_FILES_URL" ]; then
        AGENT_FILES_URL="${ONEUPTIME_URL%/}/$AGENT_FILES_PATH"
        if download_agent_text "$AGENT_FILES_URL/$1" "$2"; then
            return 0
        fi
        case "$AGENT_FILE_ANSWER" in
            "404 "* | "200 "*)
                echo "$ONEUPTIME_URL does not serve the agent's files: it runs a OneUptime older"
                echo "than this installer. Downloading them from GitHub instead."
                AGENT_FILES_URL="$AGENT_FILES_ON_GITHUB"
                if download_agent_text "$AGENT_FILES_URL/$1" "$2"; then
                    return 0
                fi
                ;;
        esac
    elif download_agent_text "$AGENT_FILES_URL/$1" "$2"; then
        return 0
    fi
    rm -f "$2"
    case "$AGENT_FILE_ANSWER" in
        000*) echo "Error: could not reach $AGENT_FILES_URL/$1" ;;
        *) echo "Error: $AGENT_FILES_URL/$1 answered ${AGENT_FILE_ANSWER%% *}, not the file" ;;
    esac
    exit 1
}

mkdir -p "${INSTALL_DIR}"
cd "${INSTALL_DIR}"

echo "Downloading agent files into ${INSTALL_DIR}..."
fetch_agent_file docker-compose.yml docker-compose.yml
fetch_agent_file otel-collector-config.yaml otel-collector-config.yaml
fetch_agent_file inventory-snapshot.sh inventory-snapshot.sh
chmod +x inventory-snapshot.sh

# Log operators of your own (ONEUPTIME_LOG_OPERATOR_1 to _5), for a format
# the agent does not read: one collector (stanza) operator each, as JSON,
# kept in .env like the rest. Unset here, the .env's value is kept, as for the
# AI agent's settings; only a set one is written (an empty one would stop the
# collector), single-quoted, so Compose takes it as written.
LOG_OPERATOR_LINES=""
LOG_OPERATORS=0
for n in 1 2 3 4 5; do
    name="ONEUPTIME_LOG_OPERATOR_${n}"
    # POSIX sh has no ${!name}: this expands the variable the name names,
    # and its value is never itself evaluated.
    eval "value=\${${name}:-}"
    if [ -z "$value" ] && [ -f "${INSTALL_DIR}/.env" ]; then
        value="$(sed -n "s/^${name}='\(.*\)'\$/\1/p" "${INSTALL_DIR}/.env" | tail -n 1)"
    fi
    if [ -n "$value" ]; then
        case "$value" in
            *"'"*)
                echo "Error: ${name} holds a single quote, which .env cannot keep. Write the operator without one (JSON needs none)."
                exit 1
                ;;
        esac
        LOG_OPERATOR_LINES="${LOG_OPERATOR_LINES}${name}='${value}'
"
        LOG_OPERATORS=$((LOG_OPERATORS + 1))
    fi
done

# The .env holds the ingestion key: readable by its owner only. Written new
# beside the old one, which it replaces once the collector accepts it.
(
    umask 077
    cat > .env.new <<EOF
ONEUPTIME_URL=${ONEUPTIME_URL}
ONEUPTIME_SERVICE_TOKEN=${ONEUPTIME_SERVICE_TOKEN}
DOCKER_SWARM_CLUSTER_NAME=${DOCKER_SWARM_CLUSTER_NAME}
DOCKER_SWARM_NODE_NAME=${DOCKER_SWARM_NODE_NAME}
ONEUPTIME_AI_INVESTIGATION=${ONEUPTIME_AI_INVESTIGATION}
ONEUPTIME_AI_FIXES=${ONEUPTIME_AI_FIXES}
ONEUPTIME_AI_ALLOW_WRITES=${ONEUPTIME_AI_ALLOW_WRITES}
ONEUPTIME_AI_WRITE_TARGETS=${ONEUPTIME_AI_WRITE_TARGETS}
ONEUPTIME_AI_PROTECTED_TARGETS=${ONEUPTIME_AI_PROTECTED_TARGETS}
EOF
    printf '%s' "$LOG_OPERATOR_LINES" >> .env.new
)
chmod 600 .env.new

# Your log operators, run through the collector's own validate (the Compose
# file's config check) before anything is replaced: a bad one stops this
# script with the collector's message, and the agent you have keeps running,
# rather than starting one that restarts forever.
if [ "$LOG_OPERATORS" -gt 0 ]; then
    echo "Checking your log operators..."
    if ! VALIDATION="$(docker compose --env-file .env.new run --rm oneuptime-docker-swarm-agent-config-check 2>&1)"; then
        rm -f .env.new
        echo "Error: the agent's collector refuses your log operators (ONEUPTIME_LOG_OPERATOR_1 to _5):"
        printf '%s\n' "$VALIDATION" | sed 's/^/  /'
        echo "Fix or unset them and run this script again. The agent you have was left as it was."
        exit 1
    fi
    echo "The collector accepts your ${LOG_OPERATORS} log operator(s)."
fi
mv -f .env.new .env

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
# --force-recreate, because running this again on an installed agent is how
# it picks up new files: Compose recreates a running container only when its
# service definition or image changed, never for a new
# otel-collector-config.yaml or inventory-snapshot.sh (bind mounts). The
# collector reads its config only when it starts, and the inventory poller's
# loop is the script it started with, so a plain `up -d` would keep both
# running as they were.
docker compose up -d --force-recreate

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
    echo "OneUptime AI agent: ${AI_AGENT_SERVICE}. It may apply the fixes you allow (never"
    echo "to itself or the collector): ONEUPTIME_AI_FIXES in ${INSTALL_DIR}/.env sets how."
else
    echo "OneUptime AI agent: ${AI_AGENT_SERVICE}, read-only: OneUptime AI can look at the"
    echo "swarm's nodes, services and tasks while it investigates, but not change them."
    echo "To let it apply fixes (a rolling restart, rollback or scale of a service), set"
    echo "ONEUPTIME_AI_ALLOW_WRITES=true and ONEUPTIME_AI_FIXES=ask-for-approval (or"
    echo "automatic, or bypass-approval) in ${INSTALL_DIR}/.env and run:"
    echo "  cd ${INSTALL_DIR} && docker compose up -d"
fi
