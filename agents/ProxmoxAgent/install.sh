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
# A cluster name or a protected-guest list can hold spaces and #, so every
# user-supplied value goes through this helper. It prefers the literal
# single-quoted form and falls back to the escaped double-quoted form only
# when single quotes cannot represent the value. Pure parameter expansion:
# the value never leaves this shell (no echo, no subprocess).
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

# Download an agent file, keeping a copy of the installed one when it holds
# edits. The docs ask for edits to these files (the journald logs pipeline,
# its mounts and image, project labels, the CA file mount), so a re-run —
# the upgrade path — must not discard them silently. What was installed is
# recorded (a sha256 per file in .agent-files.sha256), so a file that no
# longer matches its record was edited: it is kept as
# <file>.bak.<timestamp> and named at the end. A file that still matches is
# simply replaced, however much the new version changed (a collector pin
# bump changes both files). Without a record — an agent installed before it
# was kept, or no sha256 tool — any file that differs from the new download
# is kept, and said to differ rather than to be edited. The new file lands
# with the permissions curl -o would give it (the collector reads its config
# as a non-root user).
EDITED_FILES=()
DIFFERING_FILES=()

file_sha256() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | cut -d ' ' -f 1
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | cut -d ' ' -f 1
    fi
}

download_agent_file() {
    local url="$1" dest="$2" tmp backup recorded current name
    name="${dest#"$INSTALL_DIR"/}"
    tmp="$(mktemp "$dest.download.XXXXXX")"
    if ! curl -fsSL "$url" -o "$tmp"; then
        rm -f "$tmp"
        echo "Error: could not download $url"
        exit 1
    fi
    chmod 0644 "$tmp"
    if [ -f "$dest" ] && ! cmp -s "$tmp" "$dest"; then
        recorded=""
        if [ -f "$AGENT_FILES_RECORD" ]; then
            recorded="$(awk -v name="$name" '$2 == name { sha = $1 } END { print sha }' "$AGENT_FILES_RECORD")"
        fi
        current="$(file_sha256 "$dest")"
        if [ -z "$recorded" ] || [ -z "$current" ]; then
            backup="$dest.bak.$(date +%Y%m%d%H%M%S)"
            cp -p "$dest" "$backup"
            DIFFERING_FILES+=("$backup")
        elif [ "$current" != "$recorded" ]; then
            backup="$dest.bak.$(date +%Y%m%d%H%M%S)"
            cp -p "$dest" "$backup"
            EDITED_FILES+=("$backup")
        fi
    fi
    mv -f "$tmp" "$dest"
    current="$(file_sha256 "$dest")"
    if [ -n "$current" ]; then
        printf '%s  %s\n' "$current" "$name" >> "$AGENT_FILES_RECORD.new"
    fi
}

# Installation directory (decided first so an existing .env can be reused)
INSTALL_DIR="${INSTALL_DIR:-/opt/oneuptime-proxmox-agent}"
ENV_FILE="$INSTALL_DIR/.env"
# What this script installed (see download_agent_file).
AGENT_FILES_RECORD="$INSTALL_DIR/.agent-files.sha256"

# Every variable docker-compose.yml reads. The .env holds all of them, so a
# value set by hand (PVE_VERIFY_SSL, PVE_CA_FILE, what OneUptime AI may do
# here) survives a re-run.
ENV_NAMES="ONEUPTIME_URL ONEUPTIME_TELEMETRY_INGESTION_KEY PROXMOX_CLUSTER_NAME \
PVE_HOST PVE_PORT PVE_EXPORTER_URL PVE_API_TOKEN_ID PVE_API_TOKEN_SECRET \
PVE_VERIFY_SSL PVE_CA_FILE COMPOSE_PROFILES \
ONEUPTIME_AI_INVESTIGATION ONEUPTIME_AI_FIXES ONEUPTIME_AI_ALLOW_WRITES \
ONEUPTIME_AI_PVE_API_TOKEN_ID ONEUPTIME_AI_PVE_API_TOKEN_SECRET \
ONEUPTIME_AI_WRITE_TARGETS ONEUPTIME_AI_PROTECTED_TARGETS \
ONEUPTIME_AI_AGENT_RESOURCE_NAME LOG_LEVEL"

# Re-running the installer is the upgrade, and it keeps the existing
# configuration: every value already in .env is reused unless the same
# variable is exported in the shell, and nothing is prompted for again (an
# .env written before the OneUptime AI agent existed keeps it read-only).
# Edit .env directly, export the variable, or delete the file to change one.
REUSED_ENV=0
if [ -f "$ENV_FILE" ]; then
    REUSED_ENV=1
    echo "Found an existing configuration in $ENV_FILE — reusing it."
    echo "(Exported variables override it; edit or delete the file to change a value.)"
    for name in $ENV_NAMES; do
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

if [ -z "$PROXMOX_CLUSTER_NAME" ]; then
    read -rp "Proxmox cluster name (shown in OneUptime, keep it stable) [proxmox-cluster]: " PROXMOX_CLUSTER_NAME
    PROXMOX_CLUSTER_NAME="${PROXMOX_CLUSTER_NAME:-proxmox-cluster}"
fi

if [ -z "$PVE_HOST" ]; then
    read -rp "Proxmox VE API host (any node; the exporter and the AI agent query it, e.g., 192.168.1.10): " PVE_HOST
fi

# Decide whether to run the bundled prometheus-pve-exporter. An .env that
# already starts it (COMPOSE_PROFILES=pve-exporter, as this script and the
# Docker Compose guide write it) is not asked again: the agent scrapes it
# at its address on the compose network.
case ",$COMPOSE_PROFILES," in
    *,pve-exporter,*)
        PVE_EXPORTER_URL="${PVE_EXPORTER_URL:-pve-exporter:9221}"
        ;;
esac
if [ -z "$PVE_EXPORTER_URL" ]; then
    read -rp "Run the bundled prometheus-pve-exporter? [Y/n]: " RUN_EXPORTER
    RUN_EXPORTER="${RUN_EXPORTER:-Y}"
    if [[ "$RUN_EXPORTER" =~ ^[Yy] ]]; then
        COMPOSE_PROFILES="pve-exporter"
        PVE_EXPORTER_URL="pve-exporter:9221"
    else
        # No localhost default here: the agent runs as a container on the
        # compose bridge network, so "localhost" inside it is the agent
        # itself — it can never reach an exporter running on this host.
        # Use an address reachable from containers: the host's LAN IP or
        # DNS name (or host.docker.internal on Docker Desktop).
        echo "Note: the agent runs in a container, so 'localhost' cannot reach an"
        echo "exporter on this host — use the host's LAN IP or DNS name instead."
        while [ -z "$PVE_EXPORTER_URL" ]; do
            read -rp "Address of your existing pve-exporter (host:port, e.g. 192.168.1.10:9221): " PVE_EXPORTER_URL
        done
    fi
fi

# The bundled exporter reads the Proxmox VE API with this token.
if [ "$PVE_EXPORTER_URL" = "pve-exporter:9221" ]; then
    if [ -z "$PVE_API_TOKEN_ID" ]; then
        read -rp "Proxmox API token id (user@realm!tokenname): " PVE_API_TOKEN_ID
    fi
    if [ -z "$PVE_API_TOKEN_SECRET" ]; then
        # -s: never echo the secret to the terminal.
        read -rsp "Proxmox API token secret: " PVE_API_TOKEN_SECRET
        echo ""
    fi
fi

# ----------------------------------------------------------------------------
# OneUptime AI agent (the oneuptime-proxmox-ai-agent service)
# ----------------------------------------------------------------------------
# It runs next to the collector and lets OneUptime AI read this cluster
# through the Proxmox VE API while it investigates an incident or alert, with
# a Proxmox API token from the .env: the collector's PVEAuditor token
# (PVE_API_TOKEN_ID) unless it is given one of its own. Fixes (starting,
# rebooting or shutting down guests, restarting PVE services) are off unless
# ONEUPTIME_AI_ALLOW_WRITES=true, and then need a token that may do them.
# Asked on a fresh install only: a re-run keeps what .env says.
if [ "$REUSED_ENV" = 0 ]; then
    echo ""
    echo "The OneUptime AI agent lets OneUptime AI read this cluster through the"
    echo "Proxmox VE API (read-only) while it investigates incidents and alerts."
    if [ -z "$PVE_API_TOKEN_ID" ] && [ -z "$ONEUPTIME_AI_PVE_API_TOKEN_ID" ]; then
        echo "It needs a Proxmox API token with the PVEAuditor role on / (see README.md)."
        read -rp "Proxmox API token id for the AI agent (user@realm!tokenname, empty to skip): " PVE_API_TOKEN_ID
        if [ -n "$PVE_API_TOKEN_ID" ] && [ -z "$PVE_API_TOKEN_SECRET" ]; then
            read -rsp "Proxmox API token secret: " PVE_API_TOKEN_SECRET
            echo ""
        fi
    fi

    if [ -z "$ONEUPTIME_AI_ALLOW_WRITES" ]; then
        read -rp "Also let it apply fixes (start, reboot or shut down guests; restart PVE services)? [y/N]: " AI_FIXES
        if [[ "$AI_FIXES" =~ ^[Yy] ]]; then
            ONEUPTIME_AI_ALLOW_WRITES="true"
        fi
    fi
fi

# Only "true" allows fixes; anything else (unset, a typo) keeps the agent read-only.
if [ "$(printf '%s' "$ONEUPTIME_AI_ALLOW_WRITES" | tr '[:upper:]' '[:lower:]')" = "true" ]; then
    ONEUPTIME_AI_ALLOW_WRITES="true"
else
    ONEUPTIME_AI_ALLOW_WRITES="false"
fi

if [ "$ONEUPTIME_AI_ALLOW_WRITES" = "true" ] && [ "$REUSED_ENV" = 0 ]; then
    if [ -z "$ONEUPTIME_AI_PVE_API_TOKEN_ID" ]; then
        echo "Fixes need a token of the AI agent's own that may power guests on and off"
        echo "(VM.PowerMgmt: the PVEVMUser role on /vms, see README.md). Leave it empty to"
        echo "use the read-only token above; Proxmox then refuses every fix."
        read -rp "Proxmox API token id for fixes (user@realm!tokenname): " ONEUPTIME_AI_PVE_API_TOKEN_ID
    fi
    if [ -n "$ONEUPTIME_AI_PVE_API_TOKEN_ID" ] && [ -z "$ONEUPTIME_AI_PVE_API_TOKEN_SECRET" ]; then
        read -rsp "Secret of that token: " ONEUPTIME_AI_PVE_API_TOKEN_SECRET
        echo ""
    fi
    if [ -z "$ONEUPTIME_AI_PROTECTED_TARGETS" ]; then
        echo "Guests (VMIDs) OneUptime AI must never change, comma-separated: at least"
        echo "the VM this agent runs in, if it runs on this cluster."
        read -rp "Protected VMIDs [none]: " ONEUPTIME_AI_PROTECTED_TARGETS
    fi
fi

# Create installation directory
echo ""
echo "Installing to: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

# Download configuration files
REPO_BASE="https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/ProxmoxAgent"

echo "Downloading configuration files..."
rm -f "$AGENT_FILES_RECORD.new"
download_agent_file "$REPO_BASE/docker-compose.yml" "$INSTALL_DIR/docker-compose.yml"
download_agent_file "$REPO_BASE/otel-collector-config.yaml" "$INSTALL_DIR/otel-collector-config.yaml"
# The record now describes the files just installed (none without a sha256
# tool: a stale one would read the new files as edited next time).
if [ -f "$AGENT_FILES_RECORD.new" ]; then
    mv -f "$AGENT_FILES_RECORD.new" "$AGENT_FILES_RECORD"
else
    rm -f "$AGENT_FILES_RECORD"
fi

# Create .env file. It holds the Proxmox API token secrets, so it is created
# owner-read-only before anything is written to it. Every user-supplied
# value is quoted for Compose (see compose_env_quote); the write switch is a
# validated shape and stays bare.
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
cat > "$ENV_FILE" <<ENVEOF
ONEUPTIME_URL=$(compose_env_quote "$ONEUPTIME_URL")
ONEUPTIME_TELEMETRY_INGESTION_KEY=$(compose_env_quote "$ONEUPTIME_TELEMETRY_INGESTION_KEY")
PROXMOX_CLUSTER_NAME=$(compose_env_quote "$PROXMOX_CLUSTER_NAME")
PVE_HOST=$(compose_env_quote "$PVE_HOST")
PVE_PORT=$(compose_env_quote "$PVE_PORT")
PVE_EXPORTER_URL=$(compose_env_quote "$PVE_EXPORTER_URL")
PVE_API_TOKEN_ID=$(compose_env_quote "$PVE_API_TOKEN_ID")
PVE_API_TOKEN_SECRET=$(compose_env_quote "$PVE_API_TOKEN_SECRET")
PVE_VERIFY_SSL=$(compose_env_quote "$PVE_VERIFY_SSL")
PVE_CA_FILE=$(compose_env_quote "$PVE_CA_FILE")
COMPOSE_PROFILES=$(compose_env_quote "$COMPOSE_PROFILES")
ONEUPTIME_AI_INVESTIGATION=$(compose_env_quote "$ONEUPTIME_AI_INVESTIGATION")
ONEUPTIME_AI_FIXES=$(compose_env_quote "$ONEUPTIME_AI_FIXES")
ONEUPTIME_AI_ALLOW_WRITES=$ONEUPTIME_AI_ALLOW_WRITES
ONEUPTIME_AI_PVE_API_TOKEN_ID=$(compose_env_quote "$ONEUPTIME_AI_PVE_API_TOKEN_ID")
ONEUPTIME_AI_PVE_API_TOKEN_SECRET=$(compose_env_quote "$ONEUPTIME_AI_PVE_API_TOKEN_SECRET")
ONEUPTIME_AI_WRITE_TARGETS=$(compose_env_quote "$ONEUPTIME_AI_WRITE_TARGETS")
ONEUPTIME_AI_PROTECTED_TARGETS=$(compose_env_quote "$ONEUPTIME_AI_PROTECTED_TARGETS")
ONEUPTIME_AI_AGENT_RESOURCE_NAME=$(compose_env_quote "$ONEUPTIME_AI_AGENT_RESOURCE_NAME")
LOG_LEVEL=$(compose_env_quote "$LOG_LEVEL")
ENVEOF
chmod 600 "$ENV_FILE"

# Start the agent
echo ""
echo "Starting OneUptime Proxmox Agent..."
cd "$INSTALL_DIR"
# Compose gives variables in its environment precedence over .env, and this
# script's variables are exported whenever the user exported them to answer
# a prompt. Start from .env alone, so this start runs exactly what every
# later `docker compose up` (and the systemd unit) will.
(
    for name in $ENV_NAMES; do
        unset "$name"
    done
    # Pull first, so a re-run also moves the images whose tag does not change
    # — the AI agent (release) and the bundled exporter (latest). A failed
    # pull (a host without registry access, its images loaded by hand) is
    # not fatal: `up` still pulls any image this machine does not have.
    if ! docker compose pull; then
        echo "Warning: could not pull the latest images; starting with the ones this machine has."
    fi
    # --force-recreate, because running this again on an installed agent is how
    # it picks up new files: Compose recreates a running container only when its
    # service definition or environment changed, never for a new
    # otel-collector-config.yaml (a bind mount), and the collector reads its
    # config only when it starts. A plain `up -d` would keep the old config —
    # and the old oneuptime.agent.version — running after the new one arrived.
    docker compose up -d --force-recreate
)

echo ""
echo "=========================================="
echo "  OneUptime Proxmox Agent is running!"
echo "=========================================="
echo ""
if [ -z "$PVE_API_TOKEN_ID" ] && [ -z "$ONEUPTIME_AI_PVE_API_TOKEN_ID" ]; then
    echo "The OneUptime AI agent (oneuptime-proxmox-ai-agent) has no Proxmox API token, so it"
    echo "cannot run anything. Set PVE_API_TOKEN_ID and PVE_API_TOKEN_SECRET in $INSTALL_DIR/.env and"
    echo "run: docker compose up -d"
elif [ "$ONEUPTIME_AI_ALLOW_WRITES" = "true" ]; then
    echo "The OneUptime AI agent (oneuptime-proxmox-ai-agent) may apply fixes. ONEUPTIME_AI_FIXES"
    echo "in $INSTALL_DIR/.env (ask-for-approval, automatic or bypass-approval) sets whether a"
    echo "person approves each one."
else
    echo "The OneUptime AI agent (oneuptime-proxmox-ai-agent) is read-only. To let it apply"
    echo "fixes, see \"OneUptime AI agent\" in README.md."
fi
echo ""
echo "To check status:  cd $INSTALL_DIR && docker compose ps"
echo "To view logs:     cd $INSTALL_DIR && docker compose logs -f"
echo "AI agent status:  docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status"
echo "To stop:          cd $INSTALL_DIR && docker compose down"
echo "To restart:       cd $INSTALL_DIR && docker compose restart"
echo "To upgrade:       run this installer again; it reuses $ENV_FILE"

if [ "${#EDITED_FILES[@]}" -gt 0 ]; then
    echo ""
    echo "NOTE: you had edited these files since install.sh installed them. They were replaced"
    echo "by the current versions; your copies are kept next to them:"
    for backup in "${EDITED_FILES[@]}"; do
        echo "  $backup"
    done
    echo "Re-apply your edits (the journald logs pipeline, its mounts and image, project labels,"
    echo "the CA file mount) to the new files, then: cd $INSTALL_DIR && docker compose up -d --force-recreate"
fi
if [ "${#DIFFERING_FILES[@]}" -gt 0 ]; then
    echo ""
    echo "NOTE: these files differ from the new versions and were replaced. There was no record"
    echo "of what install.sh had installed, so they may hold edits of yours; the old copies are"
    echo "kept next to them:"
    for backup in "${DIFFERING_FILES[@]}"; do
        echo "  $backup"
    done
    echo "If they do, apply the same edits to the new files, then: cd $INSTALL_DIR && docker compose up -d --force-recreate"
fi
