#!/bin/bash
set -e

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

echo ""
echo "=========================================="
echo "  OneUptime Docker Agent is running!"
echo "=========================================="
echo ""
echo "To check status:  docker ps --filter name=oneuptime-docker-agent"
echo "To view logs:     docker logs -f oneuptime-docker-agent"
echo "To stop:          docker rm -f oneuptime-docker-agent"
echo "To upgrade:       docker pull $IMAGE && docker rm -f oneuptime-docker-agent && re-run this script"
