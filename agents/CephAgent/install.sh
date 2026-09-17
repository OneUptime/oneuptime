#!/bin/bash
set -e

echo "=========================================="
echo "  OneUptime Ceph Agent Installer"
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

if ! docker compose version &> /dev/null 2>&1; then
    echo "Error: Docker Compose v2 is not available. Please install the docker compose plugin."
    exit 1
fi

# Prompt for configuration
if [ -z "$ONEUPTIME_URL" ]; then
    read -rp "OneUptime URL (e.g., https://oneuptime.com): " ONEUPTIME_URL
fi

if [ -z "$ONEUPTIME_TELEMETRY_INGESTION_KEY" ]; then
    read -rp "OneUptime Telemetry Ingestion Key: " ONEUPTIME_TELEMETRY_INGESTION_KEY
fi

if [ -z "$CEPH_CLUSTER_NAME" ]; then
    read -rp "Ceph cluster name (shown in OneUptime, keep it stable) [ceph]: " CEPH_CLUSTER_NAME
    CEPH_CLUSTER_NAME="${CEPH_CLUSTER_NAME:-ceph}"
fi

if [ -z "$CEPH_MGR_ENDPOINTS" ]; then
    echo "List ALL mgr daemons (active + standbys) so metrics survive mgr failover."
    read -rp "Ceph mgr endpoints (comma-separated host:port, e.g. mon1:9283,mon2:9283,mon3:9283): " CEPH_MGR_ENDPOINTS
fi

# The collector parses the endpoint list as YAML — wrap it in square
# brackets if the user entered a bare comma-separated list.
case "$CEPH_MGR_ENDPOINTS" in
    \[*) ;;
    *) CEPH_MGR_ENDPOINTS="[$CEPH_MGR_ENDPOINTS]" ;;
esac

# Create installation directory
INSTALL_DIR="${INSTALL_DIR:-/opt/oneuptime-ceph-agent}"
echo ""
echo "Installing to: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

# Download configuration files
REPO_BASE="https://raw.githubusercontent.com/OneUptime/oneuptime/master/CephAgent"

echo "Downloading configuration files..."
curl -sSL "$REPO_BASE/docker-compose.yml" -o "$INSTALL_DIR/docker-compose.yml"
curl -sSL "$REPO_BASE/otel-collector-config.yaml" -o "$INSTALL_DIR/otel-collector-config.yaml"

# Create .env file
cat > "$INSTALL_DIR/.env" <<EOF
ONEUPTIME_URL=$ONEUPTIME_URL
ONEUPTIME_TELEMETRY_INGESTION_KEY=$ONEUPTIME_TELEMETRY_INGESTION_KEY
CEPH_CLUSTER_NAME=$CEPH_CLUSTER_NAME
CEPH_MGR_ENDPOINTS=$CEPH_MGR_ENDPOINTS
EOF
chmod 600 "$INSTALL_DIR/.env"

# Start the agent
echo ""
echo "Starting OneUptime Ceph Agent..."
cd "$INSTALL_DIR"
docker compose up -d

echo ""
echo "=========================================="
echo "  OneUptime Ceph Agent is running!"
echo "=========================================="
echo ""
echo "To check status:  cd $INSTALL_DIR && docker compose ps"
echo "To view logs:     cd $INSTALL_DIR && docker compose logs -f"
echo "To stop:          cd $INSTALL_DIR && docker compose down"
echo "To restart:       cd $INSTALL_DIR && docker compose restart"
