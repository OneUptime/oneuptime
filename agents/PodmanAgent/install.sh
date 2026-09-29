#!/bin/bash
set -e

# Also installs the OneUptime AI agent for this host (a second container,
# oneuptime-podman-ai-agent), read-only unless ONEUPTIME_AI_ALLOW_WRITES=true.
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
echo "  OneUptime Podman Agent Installer"
echo "=========================================="
echo ""

# Check prerequisites
if ! command -v podman &> /dev/null; then
    echo "Error: Podman is not installed. Please install Podman first."
    exit 1
fi

if ! podman info &> /dev/null 2>&1; then
    echo "Error: Podman is not available or you don't have permission to access it."
    echo "Ensure the Podman API socket is enabled, e.g. 'systemctl --user enable --now podman.socket'"
    echo "(rootless) or 'sudo systemctl enable --now podman.socket' (rootful), or run with sudo."
    exit 1
fi

# Prompt for configuration
if [ -z "$ONEUPTIME_URL" ]; then
    read -rp "OneUptime URL (e.g., https://oneuptime.com): " ONEUPTIME_URL
fi

if [ -z "$ONEUPTIME_SERVICE_TOKEN" ]; then
    read -rp "OneUptime Service Token: " ONEUPTIME_SERVICE_TOKEN
fi

if [ -z "$PODMAN_HOST_NAME" ]; then
    read -rp "Podman host name (friendly label shown in OneUptime) [podman-host]: " PODMAN_HOST_NAME
    PODMAN_HOST_NAME="${PODMAN_HOST_NAME:-podman-host}"
fi

IMAGE="${ONEUPTIME_PODMAN_AGENT_IMAGE:-oneuptime/podman-agent:release}"
AI_IMAGE="${ONEUPTIME_AI_AGENT_IMAGE:-oneuptime/resource-ai-agent:release}"
# "true" lets OneUptime AI apply fixes; anything else keeps the AI agent read-only.
ONEUPTIME_AI_ALLOW_WRITES="${ONEUPTIME_AI_ALLOW_WRITES:-false}"

echo ""
echo "Pulling image: $IMAGE"
podman pull "$IMAGE"

# Remove any existing container
if podman ps -a --format '{{.Names}}' | grep -q '^oneuptime-podman-agent$'; then
    echo "Removing existing oneuptime-podman-agent container..."
    podman rm -f oneuptime-podman-agent
fi

echo ""
echo "Starting OneUptime Podman Agent..."
podman run -d \
    --name oneuptime-podman-agent \
    --user 0:0 \
    --restart unless-stopped \
    -v /run/podman/podman.sock:/run/podman/podman.sock:ro \
    -v /var/lib/containers/storage:/var/lib/containers/storage:ro \
    -e ONEUPTIME_URL="$ONEUPTIME_URL" \
    -e ONEUPTIME_SERVICE_TOKEN="$ONEUPTIME_SERVICE_TOKEN" \
    -e PODMAN_HOST_NAME="$PODMAN_HOST_NAME" \
    --log-driver json-file \
    --log-opt max-size=10m \
    --log-opt max-file=3 \
    "$IMAGE"

# The AI agent: runs the docker commands OneUptime AI asks for on this host,
# through Podman's Docker-compatible socket. Root because the socket is
# root-owned; the socket's :ro mount does not make the API read-only
# (connect() works on a read-only bind mount). The agent's command policy is
# the limit: read-only commands unless ONEUPTIME_AI_ALLOW_WRITES=true, never
# exec/run/rm/prune, never itself or the collector.
install_ai_agent() {
    echo ""
    echo "Pulling image: $AI_IMAGE"
    podman pull "$AI_IMAGE" || return 1

    if podman ps -a --format '{{.Names}}' | grep -q '^oneuptime-podman-ai-agent$'; then
        echo "Removing existing oneuptime-podman-ai-agent container..."
        podman rm -f oneuptime-podman-ai-agent || return 1
    fi

    # Pinned only when you pinned it; otherwise the docker CLI negotiates.
    AI_EXTRA_ENV=()
    if [ -n "${DOCKER_API_VERSION:-}" ]; then
        AI_EXTRA_ENV+=(-e "DOCKER_API_VERSION=$DOCKER_API_VERSION")
    fi

    echo "Starting the OneUptime AI agent (writes allowed: $ONEUPTIME_AI_ALLOW_WRITES)..."
    podman run -d \
        --name oneuptime-podman-ai-agent \
        --user 0:0 \
        --restart unless-stopped \
        --read-only \
        --tmpfs /tmp \
        -v /run/podman/podman.sock:/run/podman/podman.sock:ro \
        -e ONEUPTIME_URL="$ONEUPTIME_URL" \
        -e ONEUPTIME_SERVICE_TOKEN="$ONEUPTIME_SERVICE_TOKEN" \
        -e ONEUPTIME_AI_AGENT_RESOURCE_TYPE=podman \
        -e PODMAN_HOST_NAME="$PODMAN_HOST_NAME" \
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
    if podman ps -a --format '{{.Names}}' | grep -q '^oneuptime-podman-ai-agent$'; then
        echo "An AI agent installed earlier is still there; remove it with: podman rm -f oneuptime-podman-ai-agent"
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
echo "  OneUptime Podman Agent is running!"
echo "=========================================="
echo ""
echo "To check status:  podman ps --filter name=oneuptime-podman-agent"
echo "To view logs:     podman logs -f oneuptime-podman-agent"
echo "To stop:          podman rm -f oneuptime-podman-agent"
echo "To upgrade:       podman pull $IMAGE && podman rm -f oneuptime-podman-agent && re-run this script"

if [ "$AI_AGENT_RUNNING" = "true" ]; then
    echo ""
    echo "OneUptime AI agent: oneuptime-podman-ai-agent (logs: podman logs -f oneuptime-podman-ai-agent)"
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
