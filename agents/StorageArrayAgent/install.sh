#!/bin/bash
set -e

echo "=========================================="
echo "  OneUptime Storage Array Agent Installer"
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
# Every user-supplied value goes through this helper. It prefers the literal
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

# An array's management address the way the collector and Pure's exporters
# want it: host name or IP (optionally :port), no scheme and no path —
# https://fa01.example.com/ becomes fa01.example.com.
normalize_endpoint() {
    local value="$1"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    value="${value#https://}"
    value="${value#http://}"
    value="${value%%/*}"
    printf '%s' "$value"
}

# The collector expands ${...} and $$ inside these values once more, and
# none of them ever needs a $: refuse one rather than ship a value the
# collector would rewrite.
reject_dollar() {
    case "$2" in
        *\$*)
            echo "Error: $1 must not contain a \$ character."
            exit 1
            ;;
    esac
}

# ----------------------------------------------------------------------------
# The platforms this agent reads: one line each, one collector config each
# ----------------------------------------------------------------------------
# Everything that differs between platforms is here, so a new platform is its
# collector config (and, when it needs one, its exporter's service in
# docker-compose.yml) and one line in this table. Fields, separated by |:
#
#   1  the collector config, shipped next to this script
#   2  the platform it stamps as storage.system
#   3  the compose profile that starts the exporter it scrapes (- for none)
#   4  the .env variable holding the array's management address
#   5  the .env variable holding the read-only user's API token, or its
#      password (field 12)
#   6  whether the agent itself talks TLS to the array (yes / no): the
#      collector, or an exporter that logs in to the array itself (NetApp
#      Harvest). Only then is the certificate question asked
#   7  what the array is called in a sentence
#   8  the menu's line for it
#   9  how the agent reads it, for the last message
#  10  the .env variable holding the read-only user's name, for a platform
#      that logs in with a user and a password (- for an API token alone)
#  11  the files besides the collector config that its exporter reads,
#      shipped next to this script, separated by commas (- for none)
#  12  what field 5 holds: token (an API token, which the collector reads
#      and expands once more, so it never holds a $) or password (the user's
#      password, which only the exporter reads, exactly as typed)
#
# The Dashboard's setup guide offers the same platforms (each platform's
# StorageArrayPlatform.agentConfigs); StorageArrayAgentPlatforms.test.ts
# holds the two lists in step.
PLATFORMS="
otel-collector-config.yaml|purestorage.flasharray|-|PURE_FA_ENDPOINT|PURE_FA_API_TOKEN|yes|FlashArray|Pure Storage FlashArray serving OpenMetrics itself (Purity//FA 6.7 and later)|directly (native OpenMetrics)|-|-|token
otel-collector-config.flasharray-exporter.yaml|purestorage.flasharray|flasharray-exporter|PURE_FA_ENDPOINT|PURE_FA_API_TOKEN|no|FlashArray|Pure Storage FlashArray on an older Purity//FA (through Pure's exporter)|through Pure's exporter (pure-fa-exporter)|-|-|token
otel-collector-config.flashblade.yaml|purestorage.flashblade|flashblade|PURE_FB_ENDPOINT|PURE_FB_API_TOKEN|no|FlashBlade|Pure Storage FlashBlade (through Pure's exporter)|through Pure's exporter (pure-fb-exporter)|-|-|token
otel-collector-config.netapp-ontap.yaml|netapp.ontap|netapp-ontap|NETAPP_ONTAP_ENDPOINT|NETAPP_ONTAP_PASSWORD|yes|ONTAP cluster|NetApp ONTAP 9.12.1 or later, or Amazon FSx for NetApp ONTAP (through NetApp Harvest)|through NetApp Harvest (netapp-harvest)|NETAPP_ONTAP_USERNAME|netapp-harvest.yml,netapp-harvest-rest.yaml,netapp-harvest-keyperf.yaml,netapp-harvest-restperf.yaml|password
"

# The table's lines, without the blank ones.
platform_lines() {
    printf '%s\n' "$PLATFORMS" | grep -v '^[[:space:]]*$'
}

# platform_field <line> <n>: one field of a line of the table.
platform_field() {
    printf '%s' "$1" | cut -d '|' -f "$2"
}

# Every collector config, every address, token, password and user
# variable, every exporter's own file and every exporter's profile, each
# once, in the table's order.
PLATFORM_CONFIGS="$(platform_lines | cut -d '|' -f 1 | awk '!seen[$0]++' | tr '\n' ' ')"
PLATFORM_CONFIGS="${PLATFORM_CONFIGS% }"
PLATFORM_VARIABLES="$(platform_lines | cut -d '|' -f 4,5,10 | tr '|' '\n' | grep -v '^-$' | awk '!seen[$0]++' | tr '\n' ' ')"
PLATFORM_VARIABLES="${PLATFORM_VARIABLES% }"
PLATFORM_EXTRA_FILES="$(platform_lines | cut -d '|' -f 11 | tr ',' '\n' | grep -v '^-$' | grep -v '^$' | awk '!seen[$0]++' | tr '\n' ' ')"
PLATFORM_EXTRA_FILES="${PLATFORM_EXTRA_FILES% }"
PLATFORM_PROFILES="$(platform_lines | cut -d '|' -f 3 | grep -v '^-$' | awk '!seen[$0]++' | tr '\n' ' ')"
PLATFORM_PROFILES="${PLATFORM_PROFILES% }"

# Installation directory (decided first so an existing .env can be reused)
INSTALL_DIR="${INSTALL_DIR:-/opt/oneuptime-storage-array-agent}"
ENV_FILE="$INSTALL_DIR/.env"

# Re-running the installer (e.g. to pick up a new collector pin) keeps the
# existing configuration: every value already in .env is reused unless the
# same variable is exported in the shell, and nothing is prompted for again.
# Edit .env directly, export the variable, or delete the file to change one.
if [ -f "$ENV_FILE" ]; then
    echo "Found an existing configuration in $ENV_FILE — reusing it."
    echo "(Exported variables override it; edit or delete the file to change a value.)"
    for name in ONEUPTIME_URL ONEUPTIME_TELEMETRY_INGESTION_KEY STORAGE_ARRAY_NAME \
                STORAGE_SYSTEM STORAGE_ARRAY_COLLECTOR_CONFIG \
                $PLATFORM_VARIABLES \
                STORAGE_ARRAY_INSECURE_SKIP_VERIFY; do
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
# The collector appends /otlp itself.
ONEUPTIME_URL="${ONEUPTIME_URL%/}"

if [ -z "$ONEUPTIME_TELEMETRY_INGESTION_KEY" ]; then
    read -rp "OneUptime Telemetry Ingestion Key: " ONEUPTIME_TELEMETRY_INGESTION_KEY
fi

# ----------------------------------------------------------------------------
# Which array, and how the agent reads it
# ----------------------------------------------------------------------------
# Each choice is one line of the PLATFORMS table: its collector config, and
# from it the platform stamped as storage.system and the compose profile that
# starts its exporter (when one is needed). A STORAGE_SYSTEM in the shell that
# only one config reads picks it without asking
# (STORAGE_SYSTEM=purestorage.flashblade picks the FlashBlade config).
if [ -z "$STORAGE_ARRAY_COLLECTOR_CONFIG" ] && [ -n "$STORAGE_SYSTEM" ]; then
    SYSTEM_LINES="$(platform_lines | awk -F '|' -v want="$(printf '%s' "$STORAGE_SYSTEM" | tr '[:upper:]' '[:lower:]')" '$2 == want')"
    if [ -n "$SYSTEM_LINES" ] && [ "$(printf '%s\n' "$SYSTEM_LINES" | wc -l)" -eq 1 ]; then
        STORAGE_ARRAY_COLLECTOR_CONFIG="$(platform_field "$SYSTEM_LINES" 1)"
    fi
fi

if [ -z "$STORAGE_ARRAY_COLLECTOR_CONFIG" ]; then
    echo "Which array does this agent monitor?"
    CHOICE_NUMBER=0
    while IFS= read -r line; do
        CHOICE_NUMBER=$((CHOICE_NUMBER + 1))
        echo "  $CHOICE_NUMBER) $(platform_field "$line" 8)"
    done <<PLATFORMS_EOF
$(platform_lines)
PLATFORMS_EOF
    echo "Not sure which? README.md has a curl test that tells them apart."
    read -rp "Choice [1]: " ARRAY_CHOICE
    case "$ARRAY_CHOICE" in
        '' | *[!0-9]*) ARRAY_CHOICE=1 ;;
    esac
    STORAGE_ARRAY_COLLECTOR_CONFIG="$(platform_lines | sed -n "${ARRAY_CHOICE}p" | cut -d '|' -f 1)"
    if [ -z "$STORAGE_ARRAY_COLLECTOR_CONFIG" ]; then
        STORAGE_ARRAY_COLLECTOR_CONFIG="$(platform_lines | head -n 1 | cut -d '|' -f 1)"
    fi
fi

PLATFORM_LINE="$(platform_lines | awk -F '|' -v want="$STORAGE_ARRAY_COLLECTOR_CONFIG" '$1 == want { print; exit }')"
if [ -z "$PLATFORM_LINE" ]; then
    echo "Error: STORAGE_ARRAY_COLLECTOR_CONFIG=\"$STORAGE_ARRAY_COLLECTOR_CONFIG\" is not one of the"
    echo "shipped configs: $(printf '%s' "$PLATFORM_CONFIGS" | sed 's/ /, /g')."
    exit 1
fi
STORAGE_SYSTEM="$(platform_field "$PLATFORM_LINE" 2)"
COMPOSE_PROFILES="$(platform_field "$PLATFORM_LINE" 3)"
if [ "$COMPOSE_PROFILES" = "-" ]; then
    COMPOSE_PROFILES=""
fi
ENDPOINT_VARIABLE="$(platform_field "$PLATFORM_LINE" 4)"
TOKEN_VARIABLE="$(platform_field "$PLATFORM_LINE" 5)"
TLS_TO_ARRAY="$(platform_field "$PLATFORM_LINE" 6)"
ARRAY_NOUN="$(platform_field "$PLATFORM_LINE" 7)"
READ_HOW="$(platform_field "$PLATFORM_LINE" 9)"
USER_VARIABLE="$(platform_field "$PLATFORM_LINE" 10)"
SECRET_KIND="$(platform_field "$PLATFORM_LINE" 12)"

while [ -z "$STORAGE_ARRAY_NAME" ]; do
    read -rp "Array name (shown in OneUptime, keep it stable, e.g. fa-prod-01): " STORAGE_ARRAY_NAME
done
reject_dollar STORAGE_ARRAY_NAME "$STORAGE_ARRAY_NAME"

# The address and token (or user and password) go in the variables this
# platform's config reads.
while [ -z "${!ENDPOINT_VARIABLE}" ]; do
    read -rp "$ARRAY_NOUN management address (host name or IP, no https://): " "$ENDPOINT_VARIABLE"
done
printf -v "$ENDPOINT_VARIABLE" '%s' "$(normalize_endpoint "${!ENDPOINT_VARIABLE}")"
reject_dollar "$ENDPOINT_VARIABLE" "${!ENDPOINT_VARIABLE}"
if [ "$USER_VARIABLE" != "-" ] && [ -n "$USER_VARIABLE" ]; then
    while [ -z "${!USER_VARIABLE}" ]; do
        read -rp "User name of the $ARRAY_NOUN's read-only user (README.md creates oneuptime): " "$USER_VARIABLE"
    done
fi
if [ "$SECRET_KIND" = "password" ]; then
    # Only the exporter reads it, exactly as typed: a $ is fine.
    while [ -z "${!TOKEN_VARIABLE}" ]; do
        # -s: never echo the password to the terminal.
        read -rsp "Password of the $ARRAY_NOUN's read-only user: " "$TOKEN_VARIABLE"
        echo ""
    done
else
    while [ -z "${!TOKEN_VARIABLE}" ]; do
        # -s: never echo the token to the terminal.
        read -rsp "API token of the $ARRAY_NOUN's read-only user: " "$TOKEN_VARIABLE"
        echo ""
    done
    reject_dollar "$TOKEN_VARIABLE" "${!TOKEN_VARIABLE}"
fi

# Only a config whose collector talks TLS to the array itself asks (an
# exporter does not verify the array's certificate).
if [ -z "$STORAGE_ARRAY_INSECURE_SKIP_VERIFY" ] && [ "$TLS_TO_ARRAY" = "yes" ]; then
    echo "${ARRAY_NOUN}s ship a self-signed certificate, which the agent cannot verify."
    read -rp "Verify the array's certificate anyway (it is signed by a CA you trust)? [y/N]: " VERIFY_TLS
    if [[ "$VERIFY_TLS" =~ ^[Yy] ]]; then
        STORAGE_ARRAY_INSECURE_SKIP_VERIFY="false"
    fi
fi
# Verification stays off unless the value is exactly "false".
if [ "$(printf '%s' "$STORAGE_ARRAY_INSECURE_SKIP_VERIFY" | tr '[:upper:]' '[:lower:]')" = "false" ]; then
    STORAGE_ARRAY_INSECURE_SKIP_VERIFY="false"
else
    STORAGE_ARRAY_INSECURE_SKIP_VERIFY="true"
fi

# Create installation directory
echo ""
echo "Installing to: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

# Download the compose file and every collector config of the PLATFORMS
# table, so switching the array type later is an .env edit. A re-run is the upgrade, so it must
# not discard an edit (an added label, a changed interval) silently. What
# was installed is recorded (a sha256 per file in .agent-files.sha256), so a
# file that no longer matches its record was edited: it is kept as
# <file>.bak.<timestamp> and named at the end. A file that still matches is
# simply replaced, however much the new version changed (a collector pin
# bump changes every config). Without a record — an agent installed
# before it was kept, or no sha256 tool — any file that differs from the new
# download is kept, and said to differ rather than to be edited.
# The compose file and every collector config of the PLATFORMS table. Every
# OneUptime serves each of them for this script
# (Common/Types/InstallScripts/InstallScripts.ts lists them, and
# Tests/Ops/AgentInstallScriptsServed.test.js holds the two in step).
AGENT_FILES="docker-compose.yml $PLATFORM_CONFIGS${PLATFORM_EXTRA_FILES:+ $PLATFORM_EXTRA_FILES}"
AGENT_FILES_RECORD="$INSTALL_DIR/.agent-files.sha256"
EDITED_FILES=()
DIFFERING_FILES=()

file_sha256() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | cut -d ' ' -f 1
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | cut -d ' ' -f 1
    fi
}

# ----------------------------------------------------------------------------
# Where the agent's files come from
# ----------------------------------------------------------------------------
# The OneUptime this agent reports to serves the files of its own release,
# and this script, at <ONEUPTIME_URL>/install/<agent>, so the agent always
# matches its OneUptime. A OneUptime older than that answers with a 404 or a
# page of its own instead: the files then come from GitHub, as this script
# downloaded them before. Any other answer (none at all, a server error)
# stops the install, and every file must arrive as plain text, wherever it
# comes from. Every agent's install.sh has this same block.
AGENT_FILES_PATH="install/storage-array-agent"
AGENT_FILES_ON_GITHUB="https://raw.githubusercontent.com/OneUptime/oneuptime/main/agents/StorageArrayAgent"
AGENT_FILES_URL=""
AGENT_FILE_ANSWER=""

# download_agent_text <url> <destination>: true when the URL answers 200 with
# plain text; AGENT_FILE_ANSWER holds its status and content type either way.
download_agent_text() {
    AGENT_FILE_ANSWER="$(curl -sSL -o "$2" -w '%{http_code} %{content_type}' "$1")" || AGENT_FILE_ANSWER="000"
    case "$AGENT_FILE_ANSWER" in
        "200 text/plain"*) return 0 ;;
        *) return 1 ;;
    esac
}

# fetch_agent_file <file> <destination>: one of the agent's files, from
# where the first one came from.
fetch_agent_file() {
    if [ -z "$AGENT_FILES_URL" ]; then
        AGENT_FILES_URL="${ONEUPTIME_URL%/}/$AGENT_FILES_PATH"
        if download_agent_text "$AGENT_FILES_URL/$1" "$2"; then
            return 0
        fi
        case "$AGENT_FILE_ANSWER" in
            "404 "* | "200 "*)
                echo "$ONEUPTIME_URL does not serve the agent's files: it runs a OneUptime older"
                echo "than this installer. Downloading them from GitHub instead."
                AGENT_FILES_URL="$AGENT_FILES_ON_GITHUB"
                if download_agent_text "$AGENT_FILES_URL/$1" "$2"; then
                    return 0
                fi
                ;;
        esac
    elif download_agent_text "$AGENT_FILES_URL/$1" "$2"; then
        return 0
    fi
    rm -f "$2"
    case "$AGENT_FILE_ANSWER" in
        000*) echo "Error: could not reach $AGENT_FILES_URL/$1" ;;
        *) echo "Error: $AGENT_FILES_URL/$1 answered ${AGENT_FILE_ANSWER%% *}, not the file" ;;
    esac
    exit 1
}

echo "Downloading configuration files..."
rm -f "$AGENT_FILES_RECORD.new"
for file in $AGENT_FILES; do
    download="$INSTALL_DIR/.$file.download"
    fetch_agent_file "$file" "$download"
    if [ -f "$INSTALL_DIR/$file" ] && ! cmp -s "$download" "$INSTALL_DIR/$file"; then
        recorded=""
        if [ -f "$AGENT_FILES_RECORD" ]; then
            recorded="$(awk -v name="$file" '$2 == name { sha = $1 } END { print sha }' "$AGENT_FILES_RECORD")"
        fi
        current="$(file_sha256 "$INSTALL_DIR/$file")"
        if [ -z "$recorded" ] || [ -z "$current" ]; then
            backup="$INSTALL_DIR/$file.bak.$(date +%Y%m%d%H%M%S)"
            cp -p "$INSTALL_DIR/$file" "$backup"
            DIFFERING_FILES+=("$backup")
        elif [ "$current" != "$recorded" ]; then
            backup="$INSTALL_DIR/$file.bak.$(date +%Y%m%d%H%M%S)"
            cp -p "$INSTALL_DIR/$file" "$backup"
            EDITED_FILES+=("$backup")
        fi
    fi
    mv "$download" "$INSTALL_DIR/$file"
    current="$(file_sha256 "$INSTALL_DIR/$file")"
    if [ -n "$current" ]; then
        printf '%s  %s\n' "$current" "$file" >> "$AGENT_FILES_RECORD.new"
    fi
done
# The record now describes the files just installed (none without a sha256
# tool: a stale one would read the new files as edited next time).
if [ -f "$AGENT_FILES_RECORD.new" ]; then
    mv -f "$AGENT_FILES_RECORD.new" "$AGENT_FILES_RECORD"
else
    rm -f "$AGENT_FILES_RECORD"
fi

# Every platform's address, token, user and password variable, quoted for
# Compose: the ones this platform does not read stay empty, so switching
# platforms later is an .env edit.
platform_env_lines() {
    local name
    for name in $PLATFORM_VARIABLES; do
        printf '%s=%s\n' "$name" "$(compose_env_quote "${!name}")"
    done
}

# Create .env file. It holds the array's API token or password, so it is created
# owner-read-only before anything is written to it. Every user-supplied
# value is quoted for Compose (see compose_env_quote); the platform, the
# config, the profile and the boolean are validated shapes and stay bare.
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
cat > "$ENV_FILE" <<ENVEOF
ONEUPTIME_URL=$(compose_env_quote "$ONEUPTIME_URL")
ONEUPTIME_TELEMETRY_INGESTION_KEY=$(compose_env_quote "$ONEUPTIME_TELEMETRY_INGESTION_KEY")
STORAGE_ARRAY_NAME=$(compose_env_quote "$STORAGE_ARRAY_NAME")
STORAGE_SYSTEM=$STORAGE_SYSTEM
STORAGE_ARRAY_COLLECTOR_CONFIG=$STORAGE_ARRAY_COLLECTOR_CONFIG
COMPOSE_PROFILES=$COMPOSE_PROFILES
$(platform_env_lines)
STORAGE_ARRAY_INSECURE_SKIP_VERIFY=$STORAGE_ARRAY_INSECURE_SKIP_VERIFY
ENVEOF
chmod 600 "$ENV_FILE"

# Start the agent. Stop whatever this directory ran before first — with
# every profile, so an exporter the new choice no longer needs goes away —
# then start what .env selects.
#
# --force-recreate, because running this again on an installed agent is how
# it picks up new files: Compose recreates a running container only when its
# service definition or environment changed, never for a new collector
# config (a bind mount), and the collector reads its config only when it
# starts. A plain `up -d` would keep the old config — and the old
# oneuptime.agent.version — running after the new one arrived whenever the
# `down` above left the container in place (it is allowed to fail).
echo ""
echo "Starting OneUptime Storage Array Agent..."
cd "$INSTALL_DIR"
PROFILE_ARGS=()
for profile in $PLATFORM_PROFILES; do
    PROFILE_ARGS+=(--profile "$profile")
done
docker compose "${PROFILE_ARGS[@]}" down --remove-orphans > /dev/null 2>&1 || true
if ! docker compose up -d --force-recreate; then
    echo ""
    echo "Error: the agent did not start. If Docker reports that the container name"
    echo "\"oneuptime-storage-array-agent\" is already in use, another array's agent runs on"
    echo "this machine: give this one its own container_name in $INSTALL_DIR/docker-compose.yml"
    echo "(see README.md, \"Monitoring several arrays\") and run: cd $INSTALL_DIR && docker compose up -d"
    exit 1
fi

echo ""
echo "=========================================="
echo "  OneUptime Storage Array Agent is running!"
echo "=========================================="
echo ""
echo "The array '$STORAGE_ARRAY_NAME' appears under Storage Arrays in OneUptime after"
echo "the first scrape (about a minute)."
echo "Reading the $ARRAY_NOUN at ${!ENDPOINT_VARIABLE} $READ_HOW."
if [ "${#EDITED_FILES[@]}" -gt 0 ]; then
    echo ""
    echo "You had edited these files since install.sh installed them. They were replaced by"
    echo "the current versions; your copies are kept next to them:"
    for backup in "${EDITED_FILES[@]}"; do
        echo "  $backup"
    done
    echo "Re-apply your changes to the new files, then: cd $INSTALL_DIR && docker compose up -d --force-recreate"
fi
if [ "${#DIFFERING_FILES[@]}" -gt 0 ]; then
    echo ""
    echo "These files differ from the new versions and were replaced. There was no record of"
    echo "what install.sh had installed, so they may hold changes of yours; the old copies are"
    echo "kept next to them:"
    for backup in "${DIFFERING_FILES[@]}"; do
        echo "  $backup"
    done
    echo "If they do, re-apply your changes to the new files, then: cd $INSTALL_DIR && docker compose up -d --force-recreate"
fi
echo ""
echo "To check status:  cd $INSTALL_DIR && docker compose ps"
echo "To view logs:     cd $INSTALL_DIR && docker compose logs -f"
echo "To stop:          cd $INSTALL_DIR && docker compose down"
echo "To restart:       cd $INSTALL_DIR && docker compose restart"
echo "If nothing shows up: curl -fsSL $AGENT_FILES_URL/troubleshoot.sh | bash -s -- -d $INSTALL_DIR"
