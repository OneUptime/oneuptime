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

# ----------------------------------------------------------------------------
# The agent's container names
# ----------------------------------------------------------------------------
# Two containers cannot share a name, so a second vCenter's agent on this
# machine, in a directory of its own, needs container names of its own: its
# collector's and its AI agent's. docker-compose.yml reads each from .env
# (container_name: ${VMWARE_AGENT_CONTAINER_NAME:-oneuptime-vmware-agent},
# and VMWARE_AI_AGENT_CONTAINER_NAME), and nothing asks for them. The
# collector's is, in this order:
#   - VMWARE_AGENT_CONTAINER_NAME exported, or in .env on a re-run, like
#     every other value;
#   - for an agent set up before .env held it, the name its docker-compose.yml
#     was given by hand: read from that file before this run replaces it,
#     else from the container this directory runs; and an agent that runs
#     under the default name keeps it. An upgrade never renames an agent;
#   - otherwise the directory's: oneuptime-vmware-agent-<project>, <project>
#     being the name Compose gives the directory's project (see "The agent's
#     Compose project" below: vcenter2 for /opt/vcenter2), or the project's
#     name itself when it starts with oneuptime-vmware-agent. One directory
#     is one project, and one name. The default directory's is the default
#     name, so a first agent is named as it always was.
# The AI agent's is VMWARE_AI_AGENT_CONTAINER_NAME the same way, else the
# name it was given by hand or runs as, else beside the collector's:
# oneuptime-vmware-ai-agent-vcenter2 beside oneuptime-vmware-agent-vcenter2.
# The compose services keep their names, so `docker compose ps` and `logs`
# in the directory find the containers whatever they are named.
AGENT_SERVICE="oneuptime-vmware-agent"
DEFAULT_CONTAINER_NAME="oneuptime-vmware-agent"
# The containers beside the collector, one a line: the .env variable of
# its name, its compose service, its default name, and what it is, for a
# name beside any other (companion_container_name_for).
COMPANION_CONTAINERS="VMWARE_AI_AGENT_CONTAINER_NAME|oneuptime-vmware-ai-agent|oneuptime-vmware-ai-agent|ai"

# Whether $1 is a name Docker gives a container: a letter or a digit, then at
# least one more letter, digit, _, . or -.
is_container_name() {
    case "$1" in
        "" | ? | [!a-zA-Z0-9]* | *[!a-zA-Z0-9_.-]*) return 1 ;;
    esac
    return 0
}

# compose_container_name <compose file>: the container_name the agent's
# service sets there, when it is a name written out (not ${...}), or nothing.
compose_container_name() {
    local value=""
    [ -f "$1" ] || return 0
    value="$(awk -v service="$AGENT_SERVICE" '
        /^[[:space:]]*(#.*)?$/ { next }
        {
            match($0, /^[[:space:]]*/)
            indent = RLENGTH
            if (inside && indent <= service_indent) { inside = 0 }
            if (!inside && $0 ~ ("^[[:space:]]+" service ":[[:space:]]*(#.*)?$")) {
                inside = 1
                service_indent = indent
                next
            }
            if (inside && $0 ~ /^[[:space:]]+container_name:/) {
                sub(/^[[:space:]]+container_name:[[:space:]]*/, "")
                sub(/[[:space:]]+#.*$/, "")
                sub(/[[:space:]]+$/, "")
                print
                exit
            }
        }' "$1" 2>/dev/null)" || true
    case "$value" in
        \"*\") value="${value#\"}"; value="${value%\"}" ;;
        \'*\') value="${value#\'}"; value="${value%\'}" ;;
    esac
    if is_container_name "$value"; then
        printf '%s' "$value"
    fi
}

# The name of the agent's container this directory's compose project runs
# (running or not), or nothing.
existing_container_name() {
    local id="" name=""
    [ -f "$INSTALL_DIR/docker-compose.yml" ] || return 0
    id="$(cd "$INSTALL_DIR" 2>/dev/null && docker compose ps -a -q "$AGENT_SERVICE" 2>/dev/null | head -n 1)" || true
    [ -n "$id" ] || return 0
    name="$(docker inspect -f '{{.Name}}' "$id" 2>/dev/null | head -n 1)" || true
    name="${name#/}"
    if is_container_name "$name"; then
        printf '%s' "$name"
    fi
}

# The name the newest docker-compose.yml.bak.<timestamp> gave the agent,
# when it is not the default one, or nothing.
backup_container_name() {
    local backup="" name="" found=""
    for backup in "$INSTALL_DIR"/docker-compose.yml.bak.*; do
        [ -f "$backup" ] || continue
        name="$(compose_container_name "$backup")"
        if [ -n "$name" ] && [ "$name" != "$DEFAULT_CONTAINER_NAME" ]; then
            found="$name"
        fi
    done
    printf '%s' "$found"
}

# The installation directory's container name for this agent: after the
# Compose project the directory runs (a-z 0-9 _ - only, so a container name
# too, once it starts with this agent's name).
directory_container_name() {
    local project=""
    project="$(compose_project_name)"
    case "$project" in
        "") printf '%s' "$DEFAULT_CONTAINER_NAME" ;;
        "$DEFAULT_CONTAINER_NAME"*) printf '%s' "$project" ;;
        *) printf '%s-%s' "$DEFAULT_CONTAINER_NAME" "$project" ;;
    esac
}

# Sets VMWARE_AGENT_CONTAINER_NAME when neither the shell nor .env gave it,
# as the block above says, and CONTAINER_NAME_SOURCE to where it came from.
choose_container_name() {
    local edited="" existing="" backed_up=""
    edited="$(compose_container_name "$INSTALL_DIR/docker-compose.yml")"
    existing="$(existing_container_name)"
    if [ -n "$edited" ] && [ "$edited" != "$DEFAULT_CONTAINER_NAME" ]; then
        VMWARE_AGENT_CONTAINER_NAME="$edited"
        CONTAINER_NAME_SOURCE="its docker-compose.yml"
    elif [ -n "$existing" ] && [ "$existing" != "$DEFAULT_CONTAINER_NAME" ]; then
        VMWARE_AGENT_CONTAINER_NAME="$existing"
        CONTAINER_NAME_SOURCE="the container it runs as"
    else
        backed_up="$(backup_container_name)"
        if [ -n "$backed_up" ]; then
            VMWARE_AGENT_CONTAINER_NAME="$backed_up"
            CONTAINER_NAME_SOURCE="its docker-compose.yml, kept as a backup by an earlier upgrade"
        elif [ -n "$existing" ]; then
            VMWARE_AGENT_CONTAINER_NAME="$existing"
            CONTAINER_NAME_SOURCE="the container it runs as"
        else
            VMWARE_AGENT_CONTAINER_NAME="$(directory_container_name)"
            CONTAINER_NAME_SOURCE="its directory"
        fi
    fi
}

# exported_container_names: which of COMPANION_CONTAINERS' variables the
# shell gives, before .env is read back into them.
exported_container_names() {
    local variable="" rest=""
    while IFS='|' read -r variable rest; do
        if [ -n "$variable" ] && [ -n "${!variable:-}" ]; then
            printf '%s ' "$variable"
        fi
    done <<COMPANIONS_EOF
$COMPANION_CONTAINERS
COMPANIONS_EOF
}

# kept_container_name <compose service> <its default name>: the name an agent
# set up before .env held it gave the service's container by hand, or the
# one it runs as, in choose_container_name's order; or nothing. The helpers
# above read AGENT_SERVICE and DEFAULT_CONTAINER_NAME, which this gives the
# service's for the time it asks them.
kept_container_name() {
    local AGENT_SERVICE="$1" DEFAULT_CONTAINER_NAME="$2"
    local edited="" existing="" backed_up=""
    edited="$(compose_container_name "$INSTALL_DIR/docker-compose.yml")"
    existing="$(existing_container_name)"
    if [ -n "$edited" ] && [ "$edited" != "$DEFAULT_CONTAINER_NAME" ]; then
        printf '%s' "$edited"
    elif [ -n "$existing" ] && [ "$existing" != "$DEFAULT_CONTAINER_NAME" ]; then
        printf '%s' "$existing"
    else
        backed_up="$(backup_container_name)"
        if [ -n "$backed_up" ]; then
            printf '%s' "$backed_up"
        else
            printf '%s' "$existing"
        fi
    fi
}

# companion_container_name_for <collector's container name> <companion's
# default> <role>: the name of a container that runs beside the collector,
# beside its name: the companion's default beside the default,
# <companion's default>-lab beside <collector's default>-lab, and
# <name>-<role> beside any other name.
companion_container_name_for() {
    case "$1" in
        "$DEFAULT_CONTAINER_NAME") printf '%s' "$2" ;;
        "$DEFAULT_CONTAINER_NAME"-*) printf '%s%s' "$2" "${1#"$DEFAULT_CONTAINER_NAME"}" ;;
        *) printf '%s-%s' "$1" "$3" ;;
    esac
}

# choose_companion_container_names <collector's container name>: sets each
# variable of COMPANION_CONTAINERS, as "The agent's container names" above
# says: exported or in .env, checked; else, for an agent set up before .env
# held them, the name the container was given by hand or runs as; else
# beside the collector's. A name .env holds that was beside the collector's
# old one, before the collector was given another, follows the new one.
choose_companion_container_names() {
    local collector="$1" variable="" service="" default="" role="" value=""
    while IFS='|' read -r variable service default role; do
        [ -n "$variable" ] || continue
        value="${!variable:-}"
        case " $EXPORTED_CONTAINER_NAMES " in
            *" $variable "*) ;;
            *)
                if [ -n "$value" ] && [ -n "$KEPT_CONTAINER_NAME" ] \
                    && [ "$value" = "$(companion_container_name_for "$KEPT_CONTAINER_NAME" "$default" "$role")" ]; then
                    value=""
                fi
                ;;
        esac
        if [ -n "$value" ]; then
            if ! is_container_name "$value"; then
                echo "Error: $variable=\"$value\" is not a container name: a letter or a digit, then"
                echo "letters, digits, _, . or - (e.g. $default-lab)."
                exit 1
            fi
        elif [ -z "$KEPT_CONTAINER_NAME" ]; then
            value="$(kept_container_name "$service" "$default")"
        fi
        if [ -z "$value" ]; then
            value="$(companion_container_name_for "$collector" "$default" "$role")"
        fi
        printf -v "$variable" '%s' "$value"
    done <<COMPANIONS_EOF
$COMPANION_CONTAINERS
COMPANIONS_EOF
}

# ----------------------------------------------------------------------------
# The agent's Compose project
# ----------------------------------------------------------------------------
# Compose names the project of a directory after the directory: lower case,
# only a-z 0-9 _ and -, no leading _ or - ("vCenter Lab (2)" is vcenterlab2),
# unless COMPOSE_PROJECT_NAME says otherwise. Two directories of the same name
# are one project to Compose, whatever their parents: the `up
# --force-recreate` below would recreate the other directory's agent from
# this directory's files, without a word. So an install whose project another
# directory runs stops before it changes anything, and asks for a directory
# of another name.


# The installation directory as Compose records it (an absolute path, with
# no trailing /).
absolute_install_dir() {
    local dir="$INSTALL_DIR"
    case "$dir" in
        /*) ;;
        *) dir="$(pwd)/$dir" ;;
    esac
    while [ "${dir%/}" != "$dir" ] && [ -n "${dir%/}" ]; do
        dir="${dir%/}"
    done
    printf '%s' "$dir"
}

# The name of the Compose project the installation directory runs as.
compose_project_name() {
    local name="${COMPOSE_PROJECT_NAME:-}" dir=""
    if [ -z "$name" ] && [ -f "$ENV_FILE" ]; then
        name="$(dotenv_get COMPOSE_PROJECT_NAME "$ENV_FILE")"
    fi
    if [ -z "$name" ]; then
        dir="$(absolute_install_dir)"
        name="${dir##*/}"
    fi
    printf '%s' "$name" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-' | sed 's/^[-_]*//'
}

# Whether $1 and $2 are one directory on this machine, however each is
# spelled (a symlink, a trailing /).
same_directory() {
    local first="" second=""
    first="$(cd "$1" 2>/dev/null && pwd -P)" || return 1
    second="$(cd "$2" 2>/dev/null && pwd -P)" || return 1
    [ "$first" = "$second" ]
}

# Another directory, still on this machine, whose containers run in the
# Compose project this one would run in, or nothing. A directory that is
# gone (the agent was moved) holds no agent but those containers, which are
# this one's to replace.
other_project_directory() {
    local project="" here="" dir=""
    project="$(compose_project_name)"
    [ -n "$project" ] || return 0
    here="$(absolute_install_dir)"
    while IFS= read -r dir; do
        dir="${dir%/}"
        [ -n "$dir" ] && [ "$dir" != "$here" ] && [ -d "$dir" ] || continue
        same_directory "$dir" "$here" && continue
        printf '%s' "$dir"
        return 0
    done <<PROJECT_DIRECTORIES_EOF
$(docker ps -a --filter "label=com.docker.compose.project=$project" \
    --format '{{.Label "com.docker.compose.project.working_dir"}}' 2>/dev/null | sort -u)
PROJECT_DIRECTORIES_EOF
}

# Installation directory (decided first so an existing .env can be reused)
INSTALL_DIR="${INSTALL_DIR:-/opt/oneuptime-vmware-agent}"
ENV_FILE="$INSTALL_DIR/.env"

# The container names the shell gives, and the collector's as .env has it
# (see "The agent's container names" above), before .env is read back.
EXPORTED_CONTAINER_NAMES="$(exported_container_names)"
KEPT_CONTAINER_NAME=""
if [ -f "$ENV_FILE" ]; then
    KEPT_CONTAINER_NAME="$(dotenv_get VMWARE_AGENT_CONTAINER_NAME "$ENV_FILE")"
fi

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
                ONEUPTIME_AI_AGENT_RESOURCE_NAME LOG_LEVEL \
                VMWARE_AGENT_CONTAINER_NAME VMWARE_AI_AGENT_CONTAINER_NAME; do
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

# The agent's container names (see "The agent's container names" above):
# the collector's exported or in .env, checked, or else the one this
# directory's agent already has, or its directory's; then its AI agent's.
CONTAINER_NAME_SOURCE=""
if [ -n "$VMWARE_AGENT_CONTAINER_NAME" ]; then
    if ! is_container_name "$VMWARE_AGENT_CONTAINER_NAME"; then
        echo "Error: VMWARE_AGENT_CONTAINER_NAME=\"$VMWARE_AGENT_CONTAINER_NAME\" is not a container name: a letter or"
        echo "a digit, then letters, digits, _, . or - (e.g. $DEFAULT_CONTAINER_NAME-vcenter2)."
        exit 1
    fi
else
    choose_container_name
fi
choose_companion_container_names "$VMWARE_AGENT_CONTAINER_NAME"
if [ "$VMWARE_AGENT_CONTAINER_NAME" != "$DEFAULT_CONTAINER_NAME" ]; then
    echo ""
    case "$CONTAINER_NAME_SOURCE" in
        "its directory")
            echo "The agent's containers are $VMWARE_AGENT_CONTAINER_NAME and $VMWARE_AI_AGENT_CONTAINER_NAME, named after"
            echo "its directory, so they do not take the names of another vCenter's agent on this machine."
            ;;
        "")
            echo "The agent's containers are $VMWARE_AGENT_CONTAINER_NAME and $VMWARE_AI_AGENT_CONTAINER_NAME"
            echo "(VMWARE_AGENT_CONTAINER_NAME, VMWARE_AI_AGENT_CONTAINER_NAME)."
            ;;
        *)
            echo "The agent's containers keep their names, $VMWARE_AGENT_CONTAINER_NAME and"
            echo "$VMWARE_AI_AGENT_CONTAINER_NAME, from $CONTAINER_NAME_SOURCE."
            ;;
    esac
fi

# Another directory of the same name runs this directory's Compose project
# (see "The agent's Compose project" above): stop before anything changes.
OTHER_PROJECT_DIR="$(other_project_directory)"
if [ -n "$OTHER_PROJECT_DIR" ]; then
    echo "Error: $OTHER_PROJECT_DIR already runs containers in the Docker Compose project"
    echo "\"$(compose_project_name)\": Compose names a project after its directory, and gives $INSTALL_DIR"
    echo "that name too. Installing here would recreate them and run this agent in their place. Install"
    echo "it into a directory of another name instead, e.g. INSTALL_DIR=$(absolute_install_dir)-2 bash install.sh"
    exit 1
fi

# Create installation directory
echo ""
echo "Installing to: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

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
AGENT_FILES_PATH="install/vmware-agent"
AGENT_FILES_ON_GITHUB="https://raw.githubusercontent.com/OneUptime/oneuptime/main/agents/VMwareAgent"
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

# Download configuration files
echo "Downloading configuration files..."
fetch_agent_file "docker-compose.yml" "$INSTALL_DIR/docker-compose.yml"
fetch_agent_file "otel-collector-config.yaml" "$INSTALL_DIR/otel-collector-config.yaml"

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
VMWARE_AGENT_CONTAINER_NAME=$(compose_env_quote "$VMWARE_AGENT_CONTAINER_NAME")
VMWARE_AI_AGENT_CONTAINER_NAME=$(compose_env_quote "$VMWARE_AI_AGENT_CONTAINER_NAME")
ENVEOF
chmod 600 "$ENV_FILE"

# Start the agent
echo ""
echo "Starting OneUptime VMware Agent..."
cd "$INSTALL_DIR"
# Compose gives variables in its environment precedence over .env: hand it
# none of the containers' names, so this start names them as every later
# `docker compose up` (and the systemd unit) will: from .env alone.
export -n VMWARE_AGENT_CONTAINER_NAME VMWARE_AI_AGENT_CONTAINER_NAME
# --force-recreate, because running this again on an installed agent is how
# it picks up new files: Compose recreates a running container only when its
# service definition or environment changed, never for a new
# otel-collector-config.yaml (a bind mount), and the collector reads its
# config only when it starts. A plain `up -d` would keep the old config —
# and the old oneuptime.agent.version — running after the new one arrived.
if ! docker compose up -d --force-recreate; then
    echo ""
    echo "Error: the agent did not start. If Docker reports that a container name is already in"
    echo "use (\"$VMWARE_AGENT_CONTAINER_NAME\" or \"$VMWARE_AI_AGENT_CONTAINER_NAME\"), another container on this"
    echo "machine has it (another vCenter's agent, say): give this agent names of its own and run this"
    echo "again, e.g."
    echo "  VMWARE_AGENT_CONTAINER_NAME=$DEFAULT_CONTAINER_NAME-<vcenter> VMWARE_AI_AGENT_CONTAINER_NAME=oneuptime-vmware-ai-agent-<vcenter> INSTALL_DIR=$INSTALL_DIR bash install.sh"
    echo "They are kept in $ENV_FILE from then on (see README.md, \"Monitoring several vCenters\")."
    exit 1
fi

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
echo "AI agent status:  docker exec $VMWARE_AI_AGENT_CONTAINER_NAME wget -qO- http://127.0.0.1:3877/status"
echo "To stop:          cd $INSTALL_DIR && docker compose down"
echo "To restart:       cd $INSTALL_DIR && docker compose restart"
echo "If nothing shows up: curl -fsSL $AGENT_FILES_URL/troubleshoot.sh | bash -s -- -d $INSTALL_DIR"
if [ "$CONTAINER_NAME_SOURCE" = "its docker-compose.yml" ]; then
    echo ""
    echo "Your docker-compose.yml gave the agent's containers names of their own. The new"
    echo "docker-compose.yml reads them from .env (VMWARE_AGENT_CONTAINER_NAME=$VMWARE_AGENT_CONTAINER_NAME,"
    echo "VMWARE_AI_AGENT_CONTAINER_NAME=$VMWARE_AI_AGENT_CONTAINER_NAME), so they keep them:"
    echo "leave its container_name lines as they are when you change it."
fi
