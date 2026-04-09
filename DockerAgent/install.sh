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

if [ -z "$ONEUPTIME_PROJECT_ID" ]; then
    read -rp "OneUptime Project ID: " ONEUPTIME_PROJECT_ID
fi

# Create installation directory
INSTALL_DIR="${INSTALL_DIR:-/opt/oneuptime-docker-agent}"
echo ""
echo "Installing to: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

# Download configuration files
REPO_BASE="https://raw.githubusercontent.com/nickatnight/OneUptime/master/DockerAgent"

echo "Downloading configuration files..."
curl -sSL "$REPO_BASE/docker-compose.yml" -o "$INSTALL_DIR/docker-compose.yml"
curl -sSL "$REPO_BASE/otel-collector-config.yaml" -o "$INSTALL_DIR/otel-collector-config.yaml"

# Create .env file
cat > "$INSTALL_DIR/.env" <<EOF
ONEUPTIME_URL=$ONEUPTIME_URL
ONEUPTIME_SERVICE_TOKEN=$ONEUPTIME_SERVICE_TOKEN
ONEUPTIME_PROJECT_ID=$ONEUPTIME_PROJECT_ID
EOF

# Start the agent
echo ""
echo "Starting OneUptime Docker Agent..."
cd "$INSTALL_DIR"
docker compose up -d

echo ""
echo "=========================================="
echo "  OneUptime Docker Agent is running!"
echo "=========================================="
echo ""
echo "To check status:  cd $INSTALL_DIR && docker compose ps"
echo "To view logs:     cd $INSTALL_DIR && docker compose logs -f"
echo "To stop:          cd $INSTALL_DIR && docker compose down"
echo "To restart:       cd $INSTALL_DIR && docker compose restart"
