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
# A cluster name or a protected-target list can hold spaces and #, so every
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
# edits. The docs ask for edits to these files (the cluster log receiver and
# its mount, project labels, network_mode: host), so a re-run — the upgrade
# path — must not discard them silently. What was installed is recorded (a
# sha256 per file in .agent-files.sha256), so a file that no longer matches
# its record was edited: it is kept as <file>.bak.<timestamp> and named at
# the end. A file that still matches is simply replaced, however much the
# new version changed (a collector pin bump changes both files). Without a
# record — an agent installed before it was kept, or no sha256 tool — any
# file that differs from the new download is kept, and said to differ rather
# than to be edited. The new file lands with the permissions curl -o would
# give it (the collector reads its config as a non-root user).
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
INSTALL_DIR="${INSTALL_DIR:-/opt/oneuptime-ceph-agent}"
ENV_FILE="$INSTALL_DIR/.env"
# What this script installed (see download_agent_file).
AGENT_FILES_RECORD="$INSTALL_DIR/.agent-files.sha256"

# Every variable docker-compose.yml reads. The .env holds all of them, so a
# value set by hand (what OneUptime AI may do here, the AI agent's log
# level) survives a re-run.
ENV_NAMES="ONEUPTIME_URL ONEUPTIME_TELEMETRY_INGESTION_KEY CEPH_CLUSTER_NAME \
CEPH_MGR_ENDPOINTS CEPH_CLIENT_ID \
ONEUPTIME_AI_INVESTIGATION ONEUPTIME_AI_FIXES ONEUPTIME_AI_ALLOW_WRITES \
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
# Asked on a fresh install only: a re-run keeps what .env says.
CEPH_CLIENT_ID="${CEPH_CLIENT_ID:-oneuptime-ai}"
CEPH_CLIENT_ID="${CEPH_CLIENT_ID#client.}"
if ! [[ "$CEPH_CLIENT_ID" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]*$ ]]; then
    echo "Error: CEPH_CLIENT_ID=\"$CEPH_CLIENT_ID\" is not a Ceph client name (e.g. oneuptime-ai)."
    exit 1
fi

if [ -z "$ONEUPTIME_AI_ALLOW_WRITES" ] && [ "$REUSED_ENV" = 0 ]; then
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
echo ""
echo "Installing to: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

# Download configuration files
REPO_BASE="https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/CephAgent"

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

# The AI agent's ceph.conf and keyring, mounted read-only at /etc/ceph. The
# agent runs as UID 1000, so its keyring is owned by 1000 with mode 600.
CEPH_DIR="$INSTALL_DIR/ceph"
CEPH_CONF_FILE="$CEPH_DIR/ceph.conf"
CEPH_KEYRING_FILE="$CEPH_DIR/ceph.client.$CEPH_CLIENT_ID.keyring"
mkdir -p "$CEPH_DIR"
chmod 755 "$CEPH_DIR"

# Offered on a fresh install only: a re-run keeps the answer, and the
# message at the end says how to add the client later.
if [ "$REUSED_ENV" = 0 ] && { [ ! -s "$CEPH_CONF_FILE" ] || [ ! -s "$CEPH_KEYRING_FILE" ]; }; then
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

# Create .env file. It is created owner-read-only before anything is
# written to it. Every user-supplied value is quoted for Compose (see
# compose_env_quote); the client name and the write switch are validated
# shapes and stay bare.
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
cat > "$ENV_FILE" <<ENVEOF
ONEUPTIME_URL=$(compose_env_quote "$ONEUPTIME_URL")
ONEUPTIME_TELEMETRY_INGESTION_KEY=$(compose_env_quote "$ONEUPTIME_TELEMETRY_INGESTION_KEY")
CEPH_CLUSTER_NAME=$(compose_env_quote "$CEPH_CLUSTER_NAME")
CEPH_MGR_ENDPOINTS=$(compose_env_quote "$CEPH_MGR_ENDPOINTS")
CEPH_CLIENT_ID=$CEPH_CLIENT_ID
ONEUPTIME_AI_INVESTIGATION=$(compose_env_quote "$ONEUPTIME_AI_INVESTIGATION")
ONEUPTIME_AI_FIXES=$(compose_env_quote "$ONEUPTIME_AI_FIXES")
ONEUPTIME_AI_ALLOW_WRITES=$ONEUPTIME_AI_ALLOW_WRITES
ONEUPTIME_AI_WRITE_TARGETS=$(compose_env_quote "$ONEUPTIME_AI_WRITE_TARGETS")
ONEUPTIME_AI_PROTECTED_TARGETS=$(compose_env_quote "$ONEUPTIME_AI_PROTECTED_TARGETS")
ONEUPTIME_AI_AGENT_RESOURCE_NAME=$(compose_env_quote "$ONEUPTIME_AI_AGENT_RESOURCE_NAME")
LOG_LEVEL=$(compose_env_quote "$LOG_LEVEL")
ENVEOF
chmod 600 "$ENV_FILE"

# Start the agent
echo ""
echo "Starting OneUptime Ceph Agent..."
cd "$INSTALL_DIR"
# Compose gives variables in its environment precedence over .env, and this
# script's variables are exported whenever the user exported them to answer
# a prompt (a mgr list without its brackets, say). Start from .env alone, so
# this start runs exactly what every later `docker compose up` (and the
# systemd unit) will.
(
    for name in $ENV_NAMES; do
        unset "$name"
    done
    # Pull first, so a re-run also moves the AI agent, whose image tag
    # (release) does not change. A failed pull (a host without registry
    # access, its images loaded by hand) is not fatal: `up` still pulls any
    # image this machine does not have.
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
echo "To upgrade:       run this installer again; it reuses $ENV_FILE"

if [ "${#EDITED_FILES[@]}" -gt 0 ]; then
    echo ""
    echo "NOTE: you had edited these files since install.sh installed them. They were replaced"
    echo "by the current versions; your copies are kept next to them:"
    for backup in "${EDITED_FILES[@]}"; do
        echo "  $backup"
    done
    echo "Re-apply your edits (the cluster log receiver and its mount, project labels,"
    echo "network_mode: host) to the new files, then: cd $INSTALL_DIR && docker compose up -d --force-recreate"
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
