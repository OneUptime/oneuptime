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

# ----------------------------------------------------------------------------
# OneUptime AI agent (the oneuptime-ceph-ai-agent service)
# ----------------------------------------------------------------------------
# It runs next to the collector and lets OneUptime AI look at this cluster
# with the ceph CLI while it investigates an incident or alert, as its own
# Ceph client (client.oneuptime-ai) whose ceph.conf and keyring live in
# $INSTALL_DIR/ceph. The client's caps are the hard limit: read caps keep
# the cluster read-only whatever the agent's settings say. Fixes (marking
# OSDs in or out, noout, scrubs, daemon restarts) are off unless
# ONEUPTIME_AI_ALLOW_WRITES=true, and then need the client's fixes caps.
CEPH_CLIENT_ID="${CEPH_CLIENT_ID:-oneuptime-ai}"
CEPH_CLIENT_ID="${CEPH_CLIENT_ID#client.}"
if ! [[ "$CEPH_CLIENT_ID" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]*$ ]]; then
    echo "Error: CEPH_CLIENT_ID=\"$CEPH_CLIENT_ID\" is not a Ceph client name (e.g. oneuptime-ai)."
    exit 1
fi

if [ -z "$ONEUPTIME_AI_ALLOW_WRITES" ]; then
    echo ""
    echo "The OneUptime AI agent lets OneUptime AI look at this cluster (read-only, as the"
    echo "Ceph client client.$CEPH_CLIENT_ID) while it investigates incidents and alerts."
    read -rp "Also let it apply fixes (mark OSDs in/out, noout, scrubs, daemon restarts)? [y/N]: " AI_FIXES
    if [[ "$AI_FIXES" =~ ^[Yy] ]]; then
        ONEUPTIME_AI_ALLOW_WRITES="true"
    fi
fi
# Only "true" allows fixes; anything else (unset, a typo) keeps the agent read-only.
if [ "$(printf '%s' "$ONEUPTIME_AI_ALLOW_WRITES" | tr '[:upper:]' '[:lower:]')" = "true" ]; then
    ONEUPTIME_AI_ALLOW_WRITES="true"
else
    ONEUPTIME_AI_ALLOW_WRITES="false"
fi

# The caps of the AI agent's Ceph client (see README.md, "OneUptime AI agent").
AI_READ_MON_CAPS="allow r"
AI_READ_MGR_CAPS="allow r"
AI_FIX_MON_CAPS='allow r, allow command "osd in", allow command "osd out", allow command "osd down", allow command "osd set", allow command "osd unset", allow command "osd reweight", allow command "osd pool set" with var=size, allow command "osd pool set" with var=min_size, allow command "mgr fail"'
AI_FIX_MGR_CAPS='allow r, allow command "pg scrub", allow command "pg deep-scrub", allow command "pg repair", allow command "crash archive", allow command "crash archive-all", allow command "orch daemon" with action=start, allow command "orch daemon" with action=stop, allow command "orch daemon" with action=restart, allow command "orch" with action=restart, allow command "balancer on", allow command "balancer off"'

# Create installation directory
INSTALL_DIR="${INSTALL_DIR:-/opt/oneuptime-ceph-agent}"
echo ""
echo "Installing to: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

# Download configuration files
REPO_BASE="https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/CephAgent"

echo "Downloading configuration files..."
curl -fsSL "$REPO_BASE/docker-compose.yml" -o "$INSTALL_DIR/docker-compose.yml"
curl -fsSL "$REPO_BASE/otel-collector-config.yaml" -o "$INSTALL_DIR/otel-collector-config.yaml"

# The AI agent's ceph.conf and keyring, mounted read-only at /etc/ceph. The
# agent runs as UID 1000, so its keyring is owned by 1000 with mode 600.
CEPH_DIR="$INSTALL_DIR/ceph"
CEPH_CONF_FILE="$CEPH_DIR/ceph.conf"
CEPH_KEYRING_FILE="$CEPH_DIR/ceph.client.$CEPH_CLIENT_ID.keyring"
mkdir -p "$CEPH_DIR"
chmod 755 "$CEPH_DIR"

if [ ! -s "$CEPH_CONF_FILE" ] || [ ! -s "$CEPH_KEYRING_FILE" ]; then
    if command -v ceph &> /dev/null && ceph --connect-timeout 10 health &> /dev/null; then
        echo ""
        read -rp "Create the AI agent's Ceph client client.$CEPH_CLIENT_ID now, with this machine's ceph admin access? [Y/n]: " CREATE_AI_CLIENT
        if [[ ! "$CREATE_AI_CLIENT" =~ ^[Nn] ]]; then
            if ! ceph config generate-minimal-conf > "$CEPH_CONF_FILE"; then
                rm -f "$CEPH_CONF_FILE"
                echo "Warning: ceph config generate-minimal-conf failed. Put the cluster's ceph.conf at $CEPH_CONF_FILE yourself."
            fi
            # The keyring is a secret: create it private from the start.
            if ceph auth get "client.$CEPH_CLIENT_ID" &> /dev/null; then
                echo "client.$CEPH_CLIENT_ID already exists: exporting its keyring (its caps stay as they are)."
                (umask 077 && ceph auth get "client.$CEPH_CLIENT_ID" -o "$CEPH_KEYRING_FILE") \
                    || echo "Warning: could not export client.$CEPH_CLIENT_ID's keyring to $CEPH_KEYRING_FILE."
            elif [ "$ONEUPTIME_AI_ALLOW_WRITES" = "true" ]; then
                (umask 077 && ceph auth get-or-create "client.$CEPH_CLIENT_ID" mon "$AI_FIX_MON_CAPS" mgr "$AI_FIX_MGR_CAPS" osd "allow r" -o "$CEPH_KEYRING_FILE") \
                    || echo "Warning: could not create client.$CEPH_CLIENT_ID (see README.md, \"OneUptime AI agent\")."
            else
                (umask 077 && ceph auth get-or-create "client.$CEPH_CLIENT_ID" mon "$AI_READ_MON_CAPS" mgr "$AI_READ_MGR_CAPS" osd "allow r" -o "$CEPH_KEYRING_FILE") \
                    || echo "Warning: could not create client.$CEPH_CLIENT_ID (see README.md, \"OneUptime AI agent\")."
            fi
        fi
    fi
fi

if [ -f "$CEPH_KEYRING_FILE" ]; then
    chmod 600 "$CEPH_KEYRING_FILE"
    if ! chown 1000:1000 "$CEPH_KEYRING_FILE" 2> /dev/null; then
        echo "Warning: could not give $CEPH_KEYRING_FILE to UID 1000 (the AI agent's user). Run: sudo chown 1000:1000 $CEPH_KEYRING_FILE"
    fi
fi
if [ -f "$CEPH_CONF_FILE" ]; then
    chmod 644 "$CEPH_CONF_FILE"
fi

# Create .env file
cat > "$INSTALL_DIR/.env" <<EOF
ONEUPTIME_URL=$ONEUPTIME_URL
ONEUPTIME_TELEMETRY_INGESTION_KEY=$ONEUPTIME_TELEMETRY_INGESTION_KEY
CEPH_CLUSTER_NAME=$CEPH_CLUSTER_NAME
CEPH_MGR_ENDPOINTS=$CEPH_MGR_ENDPOINTS
CEPH_CLIENT_ID=$CEPH_CLIENT_ID
ONEUPTIME_AI_INVESTIGATION=${ONEUPTIME_AI_INVESTIGATION:-}
ONEUPTIME_AI_FIXES=${ONEUPTIME_AI_FIXES:-}
ONEUPTIME_AI_ALLOW_WRITES=$ONEUPTIME_AI_ALLOW_WRITES
ONEUPTIME_AI_WRITE_TARGETS=$ONEUPTIME_AI_WRITE_TARGETS
ONEUPTIME_AI_PROTECTED_TARGETS=$ONEUPTIME_AI_PROTECTED_TARGETS
EOF
chmod 600 "$INSTALL_DIR/.env"

# Start the agent
echo ""
echo "Starting OneUptime Ceph Agent..."
cd "$INSTALL_DIR"
# --force-recreate, because running this again on an installed agent is how
# it picks up new files: Compose recreates a running container only when its
# service definition or environment changed, never for a new
# otel-collector-config.yaml (a bind mount), and the collector reads its
# config only when it starts. A plain `up -d` would keep the old config —
# and the old oneuptime.agent.version — running after the new one arrived.
docker compose up -d --force-recreate

echo ""
echo "=========================================="
echo "  OneUptime Ceph Agent is running!"
echo "=========================================="
echo ""
if [ ! -s "$CEPH_CONF_FILE" ] || [ ! -s "$CEPH_KEYRING_FILE" ]; then
    echo "The OneUptime AI agent (oneuptime-ceph-ai-agent) waits for its Ceph client. On a"
    echo "Ceph admin node, create it and copy the two files into $CEPH_DIR:"
    echo "  ceph config generate-minimal-conf > ceph.conf"
    echo "  ceph auth get-or-create client.$CEPH_CLIENT_ID mon 'allow r' mgr 'allow r' osd 'allow r' -o ceph.client.$CEPH_CLIENT_ID.keyring"
    echo "then: sudo chown 1000:1000 $CEPH_KEYRING_FILE && sudo chmod 600 $CEPH_KEYRING_FILE"
elif [ "$ONEUPTIME_AI_ALLOW_WRITES" = "true" ]; then
    echo "The OneUptime AI agent (oneuptime-ceph-ai-agent) may apply fixes, within the caps of"
    echo "client.$CEPH_CLIENT_ID. ONEUPTIME_AI_FIXES in $INSTALL_DIR/.env (ask-for-approval,"
    echo "automatic or bypass-approval) sets whether a person approves each one."
else
    echo "The OneUptime AI agent (oneuptime-ceph-ai-agent) is read-only. To let it apply fixes,"
    echo "give client.$CEPH_CLIENT_ID the fixes caps (README.md, \"Allowing fixes\"), set"
    echo "ONEUPTIME_AI_ALLOW_WRITES=true and ONEUPTIME_AI_FIXES=ask-for-approval in"
    echo "$INSTALL_DIR/.env and run: docker compose up -d"
fi
echo ""
echo "To check status:  cd $INSTALL_DIR && docker compose ps"
echo "To view logs:     cd $INSTALL_DIR && docker compose logs -f"
echo "AI agent status:  docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status"
echo "To stop:          cd $INSTALL_DIR && docker compose down"
echo "To restart:       cd $INSTALL_DIR && docker compose restart"
