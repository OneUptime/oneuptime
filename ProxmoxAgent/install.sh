#!/bin/bash
set -e

echo "=========================================="
echo "  OneUptime Proxmox Agent Installer"
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

if [ -z "$PROXMOX_CLUSTER_NAME" ]; then
    read -rp "Proxmox cluster name (shown in OneUptime, keep it stable) [proxmox-cluster]: " PROXMOX_CLUSTER_NAME
    PROXMOX_CLUSTER_NAME="${PROXMOX_CLUSTER_NAME:-proxmox-cluster}"
fi

if [ -z "$PVE_HOST" ]; then
    read -rp "Proxmox VE API host the exporter should query (e.g., 192.168.1.10): " PVE_HOST
fi

# Decide whether to run the bundled prometheus-pve-exporter
COMPOSE_PROFILES=""
if [ -z "$PVE_EXPORTER_URL" ]; then
    read -rp "Run the bundled prometheus-pve-exporter? [Y/n]: " RUN_EXPORTER
    RUN_EXPORTER="${RUN_EXPORTER:-Y}"
    if [[ "$RUN_EXPORTER" =~ ^[Yy] ]]; then
        COMPOSE_PROFILES="pve-exporter"
        PVE_EXPORTER_URL="pve-exporter:9221"
        if [ -z "$PVE_API_TOKEN_ID" ]; then
            read -rp "Proxmox API token id (user@realm!tokenname): " PVE_API_TOKEN_ID
        fi
        if [ -z "$PVE_API_TOKEN_SECRET" ]; then
            read -rp "Proxmox API token secret: " PVE_API_TOKEN_SECRET
        fi
    else
        read -rp "Address of your existing pve-exporter (host:port) [localhost:9221]: " PVE_EXPORTER_URL
        PVE_EXPORTER_URL="${PVE_EXPORTER_URL:-localhost:9221}"
    fi
fi

# Create installation directory
INSTALL_DIR="${INSTALL_DIR:-/opt/oneuptime-proxmox-agent}"
echo ""
echo "Installing to: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

# Download configuration files
REPO_BASE="https://raw.githubusercontent.com/OneUptime/oneuptime/master/ProxmoxAgent"

echo "Downloading configuration files..."
curl -sSL "$REPO_BASE/docker-compose.yml" -o "$INSTALL_DIR/docker-compose.yml"
curl -sSL "$REPO_BASE/otel-collector-config.yaml" -o "$INSTALL_DIR/otel-collector-config.yaml"

# Create .env file
cat > "$INSTALL_DIR/.env" <<EOF
ONEUPTIME_URL=$ONEUPTIME_URL
ONEUPTIME_TELEMETRY_INGESTION_KEY=$ONEUPTIME_TELEMETRY_INGESTION_KEY
PROXMOX_CLUSTER_NAME=$PROXMOX_CLUSTER_NAME
PVE_HOST=$PVE_HOST
PVE_EXPORTER_URL=$PVE_EXPORTER_URL
PVE_API_TOKEN_ID=$PVE_API_TOKEN_ID
PVE_API_TOKEN_SECRET=$PVE_API_TOKEN_SECRET
COMPOSE_PROFILES=$COMPOSE_PROFILES
EOF
chmod 600 "$INSTALL_DIR/.env"

# Start the agent
echo ""
echo "Starting OneUptime Proxmox Agent..."
cd "$INSTALL_DIR"
docker compose up -d

echo ""
echo "=========================================="
echo "  OneUptime Proxmox Agent is running!"
echo "=========================================="
echo ""
echo "To check status:  cd $INSTALL_DIR && docker compose ps"
echo "To view logs:     cd $INSTALL_DIR && docker compose logs -f"
echo "To stop:          cd $INSTALL_DIR && docker compose down"
echo "To restart:       cd $INSTALL_DIR && docker compose restart"
