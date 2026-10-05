#!/bin/bash
set -e

echo "=========================================="
echo "  OneUptime VMware Agent Installer"
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

# ----------------------------------------------------------------------------
# .env quoting — Docker Compose v2 (compose-go dotenv) rules
# ----------------------------------------------------------------------------
# Compose does NOT read .env the way a shell would echo it back:
#   - unquoted and double-quoted values get $VAR / ${VAR} interpolation
#     (an unknown $ecret silently becomes ""), a space followed by # starts a
#     comment in unquoted values, and surrounding whitespace is trimmed;
#   - single-quoted values are literal, but Compose never unescapes \' and
#     treats a closing quote preceded by a backslash as escaped, so a value
#     containing ' or ending in \ cannot be single-quoted;
#   - double-quoted values honour \\ and \" and write a literal $ as $$.
# vSphere / Active Directory passwords routinely contain $, #, spaces and
# quotes, so every user-supplied value goes through this helper. It prefers
# the literal single-quoted form and falls back to the escaped double-quoted
# form only when single quotes cannot represent the value. Pure parameter
# expansion: the value never leaves this shell (no echo, no subprocess).
compose_env_quote() {
    local value="$1"
    case "$value" in
        *\'*|*\\)
            value="${value//\\/\\\\}"
            value="${value//\"/\\\"}"
            value="${value//\$/\$\$}"
            printf '"%s"' "$value"
            ;;
        *)
            printf "'%s'" "$value"
            ;;
    esac
}

# Read one variable back from an existing .env exactly as Compose would, so a
# re-run reuses what a previous run (or a hand edit) wrote: the last
# assignment wins, single quotes are literal, double quotes undo \\ \" and $$,
# and an unquoted value stops at " #" and is trimmed. Prints nothing when the
# variable is absent.
dotenv_get() {
    local name="$1" file="$2" raw="" value="" rest="" ch=""
    raw=$(grep "^[[:space:]]*$name=" "$file" 2>/dev/null | tail -1) || true
    [ -n "$raw" ] || return 0
    value="${raw#*=}"
    case "$value" in
        \'*\'*)
            value="${value#\'}"
            value="${value%%\'*}"
            ;;
        \"*\"*)
            value="${value#\"}"
            rest="$value"
            value=""
            while [ -n "$rest" ]; do
                ch="${rest:0:1}"
                if [ "$ch" = '\' ] && [ -n "${rest:1:1}" ] && [ "${rest:1:1}" != '$' ]; then
                    value="$value${rest:1:1}"
                    rest="${rest:2}"
                elif [ "$ch" = '$' ] && [ "${rest:1:1}" = '$' ]; then
                    value="$value\$"
                    rest="${rest:2}"
                elif [ "$ch" = '"' ]; then
                    break
                else
                    value="$value$ch"
                    rest="${rest:1}"
                fi
            done
            ;;
        *)
            value="${value%% #*}"
            value="${value#"${value%%[![:space:]]*}"}"
            value="${value%"${value##*[![:space:]]}"}"
            value="${value//\$\$/\$}"
            ;;
    esac
    printf '%s' "$value"
}

# Installation directory (decided first so an existing .env can be reused)
INSTALL_DIR="${INSTALL_DIR:-/opt/oneuptime-vmware-agent}"
ENV_FILE="$INSTALL_DIR/.env"

# Re-running the installer (e.g. to pick up a new collector pin) keeps the
# existing configuration: every value already in .env is reused unless the
# same variable is exported in the shell, and nothing is prompted for again
# (an .env written before the OneUptime AI agent existed keeps it read-only).
# Edit .env directly, export the variable, or delete the file to change one.
REUSED_ENV=0
if [ -f "$ENV_FILE" ]; then
    REUSED_ENV=1
    echo "Found an existing configuration in $ENV_FILE — reusing it."
    echo "(Exported variables override it; edit or delete the file to change a value.)"
    for name in ONEUPTIME_URL ONEUPTIME_TELEMETRY_INGESTION_KEY VMWARE_VCENTER_NAME \
                VCENTER_ENDPOINT VCENTER_USERNAME VCENTER_PASSWORD \
                VCENTER_INSECURE_SKIP_VERIFY VCENTER_COLLECTION_INTERVAL \
                ONEUPTIME_AI_INVESTIGATION ONEUPTIME_AI_FIXES \
                ONEUPTIME_AI_ALLOW_WRITES ONEUPTIME_AI_VCENTER_USERNAME \
                ONEUPTIME_AI_VCENTER_PASSWORD ONEUPTIME_AI_WRITE_TARGETS \
                ONEUPTIME_AI_PROTECTED_TARGETS VCENTER_CA_FILE GOVC_DATACENTER \
                ONEUPTIME_AI_AGENT_RESOURCE_NAME LOG_LEVEL; do
        if [ -z "${!name}" ]; then
            printf -v "$name" '%s' "$(dotenv_get "$name" "$ENV_FILE")"
        fi
    done
    echo ""
fi

# Prompt for configuration
if [ -z "$ONEUPTIME_URL" ]; then
    read -rp "OneUptime URL (e.g., https://oneuptime.com): " ONEUPTIME_URL
fi

if [ -z "$ONEUPTIME_TELEMETRY_INGESTION_KEY" ]; then
    read -rp "OneUptime Telemetry Ingestion Key: " ONEUPTIME_TELEMETRY_INGESTION_KEY
fi

if [ -z "$VMWARE_VCENTER_NAME" ]; then
    read -rp "vCenter name (shown in OneUptime, keep it stable) [vmware-vcenter]: " VMWARE_VCENTER_NAME
    VMWARE_VCENTER_NAME="${VMWARE_VCENTER_NAME:-vmware-vcenter}"
fi

if [ -z "$VCENTER_ENDPOINT" ]; then
    # Scheme + host only; the collector appends /sdk itself. A standalone
    # ESXi host (no vCenter) works the same way.
    while [ -z "$VCENTER_ENDPOINT" ]; do
        read -rp "vCenter endpoint (scheme + host, e.g. https://vcsa.example.com): " VCENTER_ENDPOINT
    done
fi
case "$VCENTER_ENDPOINT" in
    http://*|https://*) ;;
    *)
        # Be forgiving: a bare hostname almost always means https.
        VCENTER_ENDPOINT="https://${VCENTER_ENDPOINT}" ;;
esac
# The receiver wants <scheme>://<host> — strip a trailing slash or /sdk.
VCENTER_ENDPOINT="${VCENTER_ENDPOINT%/}"
VCENTER_ENDPOINT="${VCENTER_ENDPOINT%/sdk}"

if [ -z "$VCENTER_USERNAME" ]; then
    read -rp "vSphere read-only user (e.g. oneuptime@vsphere.local): " VCENTER_USERNAME
fi

if [ -z "$VCENTER_PASSWORD" ]; then
    # -s: never echo the password to the terminal (or into shell history
    # of a pasted session transcript). Any character is fine — the value is
    # quoted for Docker Compose when .env is written below.
    read -rsp "vSphere password: " VCENTER_PASSWORD
    echo ""
fi

if [ -z "$VCENTER_INSECURE_SKIP_VERIFY" ]; then
    echo "vCenter appliances ship a self-signed (VMCA) certificate by default."
    read -rp "Skip TLS certificate verification for vCenter? [y/N]: " SKIP_VERIFY
    if [[ "$SKIP_VERIFY" =~ ^[Yy] ]]; then
        VCENTER_INSECURE_SKIP_VERIFY="true"
    else
        VCENTER_INSECURE_SKIP_VERIFY="false"
    fi
fi

if [ -z "$VCENTER_COLLECTION_INTERVAL" ]; then
    read -rp "Collection interval (raise to 5m/10m for very large inventories) [2m]: " VCENTER_COLLECTION_INTERVAL
    VCENTER_COLLECTION_INTERVAL="${VCENTER_COLLECTION_INTERVAL:-2m}"
fi

# ----------------------------------------------------------------------------
# OneUptime AI agent (the oneuptime-vmware-ai-agent service)
# ----------------------------------------------------------------------------
# It runs next to the collector and lets OneUptime AI look at this vCenter
# with govc while it investigates an incident or alert — read-only, with the
# credentials above. Fixes (powering VMs on, rebooting, powering off or
# resetting them) are off unless ONEUPTIME_AI_ALLOW_WRITES=true, and then
# need a vSphere user whose role allows them. Asked on a fresh install only.
if [ -z "$ONEUPTIME_AI_ALLOW_WRITES" ] && [ "$REUSED_ENV" = 0 ]; then
    echo ""
    echo "The OneUptime AI agent lets OneUptime AI look at this vCenter (read-only)"
    echo "while it investigates incidents and alerts."
    read -rp "Also let it apply fixes (power VMs on, reboot, power off or reset them)? [y/N]: " AI_FIXES
    if [[ "$AI_FIXES" =~ ^[Yy] ]]; then
        ONEUPTIME_AI_ALLOW_WRITES="true"
    fi

    if [ "$ONEUPTIME_AI_ALLOW_WRITES" = "true" ]; then
        if [ -z "$ONEUPTIME_AI_VCENTER_USERNAME" ]; then
            echo "Fixes need a vSphere user whose role has VirtualMachine.Interact.PowerOn,"
            echo "PowerOff and Reset (see README.md). Leave empty to use $VCENTER_USERNAME."
            read -rp "vSphere user for fixes: " ONEUPTIME_AI_VCENTER_USERNAME
        fi
        if [ -n "$ONEUPTIME_AI_VCENTER_USERNAME" ] && [ -z "$ONEUPTIME_AI_VCENTER_PASSWORD" ]; then
            read -rsp "Password of $ONEUPTIME_AI_VCENTER_USERNAME: " ONEUPTIME_AI_VCENTER_PASSWORD
            echo ""
        fi
        if [ -z "$ONEUPTIME_AI_PROTECTED_TARGETS" ]; then
            echo "VMs OneUptime AI must never change, comma-separated: the VM this agent runs"
            echo "on, if it runs inside this vCenter, and the vCenter appliance's own VM unless"
            echo "it is named after the endpoint's host name (\"vcsa\" for https://vcsa.example.com)."
            echo "An endpoint given as an IP address protects no VM on its own."
            read -rp "Protected VMs [none]: " ONEUPTIME_AI_PROTECTED_TARGETS
        fi
    fi
fi
# Only "true" allows fixes; anything else (unset, a typo) keeps the agent read-only.
if [ "$(printf '%s' "$ONEUPTIME_AI_ALLOW_WRITES" | tr '[:upper:]' '[:lower:]')" = "true" ]; then
    ONEUPTIME_AI_ALLOW_WRITES="true"
else
    ONEUPTIME_AI_ALLOW_WRITES="false"
fi

# Create installation directory
echo ""
echo "Installing to: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

# Download configuration files
REPO_BASE="https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/VMwareAgent"

echo "Downloading configuration files..."
curl -fsSL "$REPO_BASE/docker-compose.yml" -o "$INSTALL_DIR/docker-compose.yml"
curl -fsSL "$REPO_BASE/otel-collector-config.yaml" -o "$INSTALL_DIR/otel-collector-config.yaml"

# Create .env file. It holds the vSphere passwords, so it is created
# owner-read-only before anything is written to it. Every user-supplied
# value is quoted for Compose (see compose_env_quote); the booleans and the
# duration are validated shapes and stay bare.
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
cat > "$ENV_FILE" <<ENVEOF
ONEUPTIME_URL=$(compose_env_quote "$ONEUPTIME_URL")
ONEUPTIME_TELEMETRY_INGESTION_KEY=$(compose_env_quote "$ONEUPTIME_TELEMETRY_INGESTION_KEY")
VMWARE_VCENTER_NAME=$(compose_env_quote "$VMWARE_VCENTER_NAME")
VCENTER_ENDPOINT=$(compose_env_quote "$VCENTER_ENDPOINT")
VCENTER_USERNAME=$(compose_env_quote "$VCENTER_USERNAME")
VCENTER_PASSWORD=$(compose_env_quote "$VCENTER_PASSWORD")
VCENTER_INSECURE_SKIP_VERIFY=$VCENTER_INSECURE_SKIP_VERIFY
VCENTER_COLLECTION_INTERVAL=$VCENTER_COLLECTION_INTERVAL
ONEUPTIME_AI_INVESTIGATION=$(compose_env_quote "$ONEUPTIME_AI_INVESTIGATION")
ONEUPTIME_AI_FIXES=$(compose_env_quote "$ONEUPTIME_AI_FIXES")
ONEUPTIME_AI_ALLOW_WRITES=$ONEUPTIME_AI_ALLOW_WRITES
ONEUPTIME_AI_VCENTER_USERNAME=$(compose_env_quote "$ONEUPTIME_AI_VCENTER_USERNAME")
ONEUPTIME_AI_VCENTER_PASSWORD=$(compose_env_quote "$ONEUPTIME_AI_VCENTER_PASSWORD")
ONEUPTIME_AI_WRITE_TARGETS=$(compose_env_quote "$ONEUPTIME_AI_WRITE_TARGETS")
ONEUPTIME_AI_PROTECTED_TARGETS=$(compose_env_quote "$ONEUPTIME_AI_PROTECTED_TARGETS")
VCENTER_CA_FILE=$(compose_env_quote "$VCENTER_CA_FILE")
GOVC_DATACENTER=$(compose_env_quote "$GOVC_DATACENTER")
ONEUPTIME_AI_AGENT_RESOURCE_NAME=$(compose_env_quote "$ONEUPTIME_AI_AGENT_RESOURCE_NAME")
LOG_LEVEL=$(compose_env_quote "$LOG_LEVEL")
ENVEOF
chmod 600 "$ENV_FILE"

# Start the agent
echo ""
echo "Starting OneUptime VMware Agent..."
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
echo "  OneUptime VMware Agent is running!"
echo "=========================================="
echo ""
echo "The vCenter '$VMWARE_VCENTER_NAME' appears under VMware in OneUptime after the"
echo "first collection (about $VCENTER_COLLECTION_INTERVAL)."
echo ""
if [ "$ONEUPTIME_AI_ALLOW_WRITES" = "true" ]; then
    echo "The OneUptime AI agent (oneuptime-vmware-ai-agent) may apply fixes. Choose on the"
    echo "vCenter's AI -> AI agent page in OneUptime whether a person approves each one."
else
    echo "The OneUptime AI agent (oneuptime-vmware-ai-agent) is read-only. To let it apply"
    echo "fixes, set ONEUPTIME_AI_ALLOW_WRITES=true in $ENV_FILE and run: docker compose up -d"
fi
echo ""
echo "To check status:  cd $INSTALL_DIR && docker compose ps"
echo "To view logs:     cd $INSTALL_DIR && docker compose logs -f"
echo "AI agent status:  docker exec oneuptime-vmware-ai-agent wget -qO- http://127.0.0.1:3877/status"
echo "To stop:          cd $INSTALL_DIR && docker compose down"
echo "To restart:       cd $INSTALL_DIR && docker compose restart"
echo "If nothing shows up: curl -fsSL $REPO_BASE/troubleshoot.sh | bash"
