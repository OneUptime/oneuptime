#!/bin/bash
set -e

# Also installs the OneUptime AI agent for this host (a second container,
# oneuptime-docker-ai-agent), read-only unless ONEUPTIME_AI_ALLOW_WRITES=true.
# Leave it out with --no-ai-agent or ONEUPTIME_INSTALL_AI_AGENT=false.
INSTALL_AI_AGENT="${ONEUPTIME_INSTALL_AI_AGENT:-true}"
for arg in "$@"; do
    case "$arg" in
        --no-ai-agent) INSTALL_AI_AGENT=false ;;
        *)
            echo "Unknown option: $arg (the only option is --no-ai-agent)"
            exit 1
            ;;
    esac
done

echo "=========================================="
echo "  OneUptime Docker Agent Installer"
echo "=========================================="
echo ""

# Check prerequisites
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is not installed. Please install Docker first."
    exit 1
fi

if ! docker info &> /dev/null 2>&1; then
    echo "Error: Docker daemon is not running or you don't have permission to access it."
    echo "Try running with sudo or add your user to the docker group."
    exit 1
fi

# Prompt for configuration
if [ -z "$ONEUPTIME_URL" ]; then
    read -rp "OneUptime URL (e.g., https://oneuptime.com): " ONEUPTIME_URL
fi

if [ -z "$ONEUPTIME_SERVICE_TOKEN" ]; then
    read -rp "OneUptime Service Token: " ONEUPTIME_SERVICE_TOKEN
fi

if [ -z "$DOCKER_HOST_NAME" ]; then
    read -rp "Docker host name (friendly label shown in OneUptime) [docker-host]: " DOCKER_HOST_NAME
    DOCKER_HOST_NAME="${DOCKER_HOST_NAME:-docker-host}"
fi

IMAGE="${ONEUPTIME_DOCKER_AGENT_IMAGE:-oneuptime/docker-agent:release}"
AI_IMAGE="${ONEUPTIME_AI_AGENT_IMAGE:-oneuptime/resource-ai-agent:release}"
# "true" lets OneUptime AI apply fixes; anything else keeps the AI agent
# read-only. Read the way the agent reads it (case and surrounding blanks
# ignored), and passed on as exactly true or false, so what this script says
# below is what the agent does.
case "$(printf '%s' "${ONEUPTIME_AI_ALLOW_WRITES:-}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | tr '[:upper:]' '[:lower:]')" in
    true) ONEUPTIME_AI_ALLOW_WRITES="true" ;;
    *) ONEUPTIME_AI_ALLOW_WRITES="false" ;;
esac

echo ""
echo "Pulling image: $IMAGE"
docker pull "$IMAGE"

# Remove any existing container
if docker ps -a --format '{{.Names}}' | grep -q '^oneuptime-docker-agent$'; then
    echo "Removing existing oneuptime-docker-agent container..."
    docker rm -f oneuptime-docker-agent
fi

echo ""
echo "Starting OneUptime Docker Agent..."
docker run -d \
    --name oneuptime-docker-agent \
    --user 0:0 \
    --restart unless-stopped \
    -v /var/run/docker.sock:/var/run/docker.sock:ro \
    -v /var/lib/docker/containers:/var/lib/docker/containers:ro \
    -e ONEUPTIME_URL="$ONEUPTIME_URL" \
    -e ONEUPTIME_SERVICE_TOKEN="$ONEUPTIME_SERVICE_TOKEN" \
    -e DOCKER_HOST_NAME="$DOCKER_HOST_NAME" \
    --log-driver json-file \
    --log-opt max-size=10m \
    --log-opt max-file=3 \
    "$IMAGE"

# The AI agent: runs the docker commands OneUptime AI asks for on this host.
# Root because the socket is root-owned; the socket's :ro mount does not make
# the Docker API read-only (connect() works on a read-only bind mount). The
# agent's command policy is the limit: read-only commands unless
# ONEUPTIME_AI_ALLOW_WRITES=true, never exec/run/rm/prune, never itself or the
# collector.
install_ai_agent() {
    echo ""
    echo "Pulling image: $AI_IMAGE"
    docker pull "$AI_IMAGE" || return 1

    if docker ps -a --format '{{.Names}}' | grep -q '^oneuptime-docker-ai-agent$'; then
        echo "Removing existing oneuptime-docker-ai-agent container..."
        docker rm -f oneuptime-docker-ai-agent || return 1
    fi

    # Pinned only when you pinned it; otherwise the docker CLI negotiates.
    AI_EXTRA_ENV=()
    if [ -n "${DOCKER_API_VERSION:-}" ]; then
        AI_EXTRA_ENV+=(-e "DOCKER_API_VERSION=$DOCKER_API_VERSION")
    fi

    echo "Starting the OneUptime AI agent (writes allowed: $ONEUPTIME_AI_ALLOW_WRITES)..."
    docker run -d \
        --name oneuptime-docker-ai-agent \
        --user 0:0 \
        --restart unless-stopped \
        --read-only \
        --tmpfs /tmp \
        -v /var/run/docker.sock:/var/run/docker.sock:ro \
        -e ONEUPTIME_URL="$ONEUPTIME_URL" \
        -e ONEUPTIME_SERVICE_TOKEN="$ONEUPTIME_SERVICE_TOKEN" \
        -e ONEUPTIME_AI_AGENT_RESOURCE_TYPE=docker \
        -e DOCKER_HOST_NAME="$DOCKER_HOST_NAME" \
        -e ONEUPTIME_AI_ALLOW_WRITES="$ONEUPTIME_AI_ALLOW_WRITES" \
        -e ONEUPTIME_AI_WRITE_TARGETS="${ONEUPTIME_AI_WRITE_TARGETS:-}" \
        -e ONEUPTIME_AI_PROTECTED_TARGETS="${ONEUPTIME_AI_PROTECTED_TARGETS:-}" \
        "${AI_EXTRA_ENV[@]}" \
        --health-cmd "wget -q -O /dev/null http://127.0.0.1:3877/status/live" \
        --health-interval 30s \
        --health-timeout 5s \
        --health-retries 3 \
        --log-driver json-file \
        --log-opt max-size=10m \
        --log-opt max-file=3 \
        "$AI_IMAGE" || return 1
}

AI_AGENT_RUNNING=false
if [ "$INSTALL_AI_AGENT" = "false" ]; then
    echo ""
    echo "Skipping the OneUptime AI agent (--no-ai-agent)."
    if docker ps -a --format '{{.Names}}' | grep -q '^oneuptime-docker-ai-agent$'; then
        echo "An AI agent installed earlier is still there; remove it with: docker rm -f oneuptime-docker-ai-agent"
    fi
elif install_ai_agent; then
    AI_AGENT_RUNNING=true
else
    echo ""
    echo "Warning: the OneUptime AI agent could not be started (the collector is running)."
    echo "Re-run this script to try again, or add --no-ai-agent to leave it out."
fi

echo ""
echo "=========================================="
echo "  OneUptime Docker Agent is running!"
echo "=========================================="
echo ""
echo "To check status:  docker ps --filter name=oneuptime-docker-agent"
echo "To view logs:     docker logs -f oneuptime-docker-agent"
echo "To stop:          docker rm -f oneuptime-docker-agent"
echo "To upgrade:       docker pull $IMAGE && docker rm -f oneuptime-docker-agent && re-run this script"

if [ "$AI_AGENT_RUNNING" = "true" ]; then
    echo ""
    echo "OneUptime AI agent: oneuptime-docker-ai-agent (logs: docker logs -f oneuptime-docker-ai-agent)"
    if [ "$ONEUPTIME_AI_ALLOW_WRITES" = "true" ]; then
        echo "It may apply the fixes you allow on the host's AI agent page in OneUptime"
        echo "(never to itself or the collector)."
    else
        echo "It is read-only: OneUptime AI can look at this host's containers while it"
        echo "investigates, but not change them. To let it apply fixes (restart, start,"
        echo "stop a container), re-run this script with ONEUPTIME_AI_ALLOW_WRITES=true"
        echo "(and ONEUPTIME_AI_WRITE_TARGETS=\"web-*,api-*\" to limit which containers),"
        echo "then choose on the host's AI agent page whether each fix needs approval."
    fi
fi
