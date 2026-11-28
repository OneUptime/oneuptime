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
    local file="$1" dest="$2" tmp backup recorded current name
    name="${dest#"$INSTALL_DIR"/}"
    tmp="$(mktemp "$dest.download.XXXXXX")"
    fetch_agent_file "$file" "$tmp"
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

# ----------------------------------------------------------------------------
# The agent's container names
# ----------------------------------------------------------------------------
# Two containers cannot share a name, so a second Ceph cluster's agent on
# this machine, in a directory of its own, needs container names of its own:
# its collector's and its AI agent's. docker-compose.yml reads each from .env
# (container_name: ${CEPH_AGENT_CONTAINER_NAME:-oneuptime-ceph-agent}, and
# CEPH_AI_AGENT_CONTAINER_NAME), and nothing asks for them. The collector's
# is, in this order:
#   - CEPH_AGENT_CONTAINER_NAME exported, or in .env on a re-run, like every
#     other value;
#   - for an agent set up before .env held it, the name its docker-compose.yml
#     was given by hand: read from that file before this run replaces it,
#     else from the container this directory runs, else from the newest
#     docker-compose.yml.bak.<timestamp> an earlier upgrade kept; and an
#     agent that runs under the default name keeps it. An upgrade never
#     renames an agent;
#   - otherwise the directory's: oneuptime-ceph-agent-<project>, <project>
#     being the name Compose gives the directory's project (see "The agent's
#     Compose project" below: cluster2 for /opt/cluster2), or the project's
#     name itself when it starts with oneuptime-ceph-agent. One directory is
#     one project, and one name. The default directory's is the default
#     name, so a first agent is named as it always was.
# The AI agent's is CEPH_AI_AGENT_CONTAINER_NAME the same way, else the name
# it was given by hand or runs as, else beside the collector's:
# oneuptime-ceph-ai-agent-cluster2 beside oneuptime-ceph-agent-cluster2.
# The compose services keep their names, so `docker compose ps` and `logs`
# in the directory find the containers whatever they are named.
AGENT_SERVICE="oneuptime-ceph-agent"
DEFAULT_CONTAINER_NAME="oneuptime-ceph-agent"
# The containers beside the collector, one a line: the .env variable of
# its name, its compose service, its default name, and what it is, for a
# name beside any other (companion_container_name_for).
COMPANION_CONTAINERS="CEPH_AI_AGENT_CONTAINER_NAME|oneuptime-ceph-ai-agent|oneuptime-ceph-ai-agent|ai"

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

# Sets CEPH_AGENT_CONTAINER_NAME when neither the shell nor .env gave it,
# as the block above says, and CONTAINER_NAME_SOURCE to where it came from.
choose_container_name() {
    local edited="" existing="" backed_up=""
    edited="$(compose_container_name "$INSTALL_DIR/docker-compose.yml")"
    existing="$(existing_container_name)"
    if [ -n "$edited" ] && [ "$edited" != "$DEFAULT_CONTAINER_NAME" ]; then
        CEPH_AGENT_CONTAINER_NAME="$edited"
        CONTAINER_NAME_SOURCE="its docker-compose.yml"
    elif [ -n "$existing" ] && [ "$existing" != "$DEFAULT_CONTAINER_NAME" ]; then
        CEPH_AGENT_CONTAINER_NAME="$existing"
        CONTAINER_NAME_SOURCE="the container it runs as"
    else
        backed_up="$(backup_container_name)"
        if [ -n "$backed_up" ]; then
            CEPH_AGENT_CONTAINER_NAME="$backed_up"
            CONTAINER_NAME_SOURCE="its docker-compose.yml, kept as a backup by an earlier upgrade"
        elif [ -n "$existing" ]; then
            CEPH_AGENT_CONTAINER_NAME="$existing"
            CONTAINER_NAME_SOURCE="the container it runs as"
        else
            CEPH_AGENT_CONTAINER_NAME="$(directory_container_name)"
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

# only_container_names_edited <compose file> <sha256 of the one installed>:
# whether the file differs from the one install.sh installed in its
# containers' names alone (the collector's and every companion's), each
# given by hand: the edit a second agent on this machine needed, which .env
# carries now, so nothing needs making again.
only_container_names_edited() {
    local file="$1" recorded="$2" restored="" restored_sha="" names="" variable="" service="" default="" role=""
    [ -n "$recorded" ] || return 1
    names="$AGENT_SERVICE=$DEFAULT_CONTAINER_NAME"
    while IFS='|' read -r variable service default role; do
        [ -n "$variable" ] && names="$names $service=$default"
    done <<COMPANIONS_EOF
$COMPANION_CONTAINERS
COMPANIONS_EOF
    restored="$(mktemp)" || return 1
    awk -v names="$names" '
        BEGIN {
            count = split(names, pairs, " ")
            for (i = 1; i <= count; i++) {
                split(pairs[i], pair, "=")
                default_of[pair[1]] = pair[2]
            }
        }
        /^[[:space:]]*(#.*)?$/ { print; next }
        {
            match($0, /^[[:space:]]*/)
            indent = RLENGTH
            if (inside != "" && indent <= service_indent) { inside = "" }
            if (inside == "" && $0 ~ /^[[:space:]]+[A-Za-z0-9_.-]+:[[:space:]]*(#.*)?$/) {
                name = $0
                sub(/^[[:space:]]+/, "", name)
                sub(/:.*$/, "", name)
                if (name in default_of && !(name in done)) {
                    inside = name
                    service_indent = indent
                }
            } else if (inside != "" && $0 ~ /^[[:space:]]+container_name:/) {
                print "    container_name: " default_of[inside]
                done[inside] = 1
                inside = ""
                next
            }
            print
        }' "$file" > "$restored" 2>/dev/null || true
    restored_sha="$(file_sha256 "$restored")"
    rm -f "$restored"
    [ -n "$restored_sha" ] && [ "$restored_sha" = "$recorded" ]
}

# ----------------------------------------------------------------------------
# The agent's Compose project
# ----------------------------------------------------------------------------
# Compose names the project of a directory after the directory: lower case,
# only a-z 0-9 _ and -, no leading _ or - ("Ceph Lab (2)" is cephlab2), unless
# COMPOSE_PROJECT_NAME says otherwise. Two directories of the same name are one
# project to Compose, whatever their parents: the `up --force-recreate` below
# would recreate the other directory's agent from this directory's files,
# without a word. So an install whose project another directory runs stops
# before it changes anything, and asks for a directory of another name.


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
ONEUPTIME_AI_AGENT_RESOURCE_NAME LOG_LEVEL \
CEPH_AGENT_CONTAINER_NAME CEPH_AI_AGENT_CONTAINER_NAME"

# The container names the shell gives, and the collector's as .env has it
# (see "The agent's container names" above), before .env is read back.
EXPORTED_CONTAINER_NAMES="$(exported_container_names)"
KEPT_CONTAINER_NAME=""
if [ -f "$ENV_FILE" ]; then
    KEPT_CONTAINER_NAME="$(dotenv_get CEPH_AGENT_CONTAINER_NAME "$ENV_FILE")"
fi

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

# The agent's container names (see "The agent's container names" above):
# the collector's exported or in .env, checked, or else the one this
# directory's agent already has, or its directory's; then its AI agent's.
CONTAINER_NAME_SOURCE=""
if [ -n "$CEPH_AGENT_CONTAINER_NAME" ]; then
    if ! is_container_name "$CEPH_AGENT_CONTAINER_NAME"; then
        echo "Error: CEPH_AGENT_CONTAINER_NAME=\"$CEPH_AGENT_CONTAINER_NAME\" is not a container name: a letter or a"
        echo "digit, then letters, digits, _, . or - (e.g. $DEFAULT_CONTAINER_NAME-cluster2)."
        exit 1
    fi
else
    choose_container_name
fi
choose_companion_container_names "$CEPH_AGENT_CONTAINER_NAME"
if [ "$CEPH_AGENT_CONTAINER_NAME" != "$DEFAULT_CONTAINER_NAME" ]; then
    echo ""
    case "$CONTAINER_NAME_SOURCE" in
        "its directory")
            echo "The agent's containers are $CEPH_AGENT_CONTAINER_NAME and $CEPH_AI_AGENT_CONTAINER_NAME, named after"
            echo "its directory, so they do not take the names of another cluster's agent on this machine."
            ;;
        "")
            echo "The agent's containers are $CEPH_AGENT_CONTAINER_NAME and $CEPH_AI_AGENT_CONTAINER_NAME"
            echo "(CEPH_AGENT_CONTAINER_NAME, CEPH_AI_AGENT_CONTAINER_NAME)."
            ;;
        *)
            echo "The agent's containers keep their names, $CEPH_AGENT_CONTAINER_NAME and"
            echo "$CEPH_AI_AGENT_CONTAINER_NAME, from $CONTAINER_NAME_SOURCE."
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
AGENT_FILES_PATH="install/ceph-agent"
AGENT_FILES_ON_GITHUB="https://raw.githubusercontent.com/OneUptime/oneuptime/main/agents/CephAgent"
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

# What install.sh had installed as docker-compose.yml, for
# only_container_names_edited once the download has replaced it.
INSTALLED_COMPOSE_SHA=""
if [ -f "$AGENT_FILES_RECORD" ]; then
    INSTALLED_COMPOSE_SHA="$(awk '$2 == "docker-compose.yml" { sha = $1 } END { print sha }' "$AGENT_FILES_RECORD")"
fi

# Download configuration files
echo "Downloading configuration files..."
rm -f "$AGENT_FILES_RECORD.new"
download_agent_file "docker-compose.yml" "$INSTALL_DIR/docker-compose.yml"
download_agent_file "otel-collector-config.yaml" "$INSTALL_DIR/otel-collector-config.yaml"
# The record now describes the files just installed (none without a sha256
# tool: a stale one would read the new files as edited next time).
if [ -f "$AGENT_FILES_RECORD.new" ]; then
    mv -f "$AGENT_FILES_RECORD.new" "$AGENT_FILES_RECORD"
else
    rm -f "$AGENT_FILES_RECORD"
fi
# A docker-compose.yml whose one change was the containers' names is not a
# change to make again: .env carries the names now.
RENAMED_COMPOSE_BACKUP=""
KEPT_EDITS=()
for backup in "${EDITED_FILES[@]}"; do
    case "${backup##*/}" in
        docker-compose.yml.bak.*)
            if only_container_names_edited "$backup" "$INSTALLED_COMPOSE_SHA"; then
                RENAMED_COMPOSE_BACKUP="$backup"
                continue
            fi
            ;;
    esac
    KEPT_EDITS+=("$backup")
done
EDITED_FILES=("${KEPT_EDITS[@]}")

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
CEPH_AGENT_CONTAINER_NAME=$(compose_env_quote "$CEPH_AGENT_CONTAINER_NAME")
CEPH_AI_AGENT_CONTAINER_NAME=$(compose_env_quote "$CEPH_AI_AGENT_CONTAINER_NAME")
ENVEOF
chmod 600 "$ENV_FILE"

# Start the agent
echo ""
echo "Starting OneUptime Ceph Agent..."
cd "$INSTALL_DIR"
# Compose gives variables in its environment precedence over .env, and this
# script's variables are exported whenever the user exported them to answer
# a prompt (a mgr list without its brackets, say). Hand Compose none of them,
# so this start runs exactly what every later `docker compose up` (and the
# systemd unit) will: .env alone.
for name in $ENV_NAMES; do
    export -n "$name"
done
# Pull first, so a re-run also moves the AI agent, whose image tag (release)
# does not change. A failed pull (a host without registry access, its images
# loaded by hand) is not fatal: `up` still pulls any image this machine does
# not have.
if ! docker compose pull; then
    echo "Warning: could not pull the latest images; starting with the ones this machine has."
fi
# --force-recreate, because running this again on an installed agent is how
# it picks up new files: Compose recreates a running container only when its
# service definition or environment changed, never for a new
# otel-collector-config.yaml (a bind mount), and the collector reads its
# config only when it starts. A plain `up -d` would keep the old config —
# and the old oneuptime.agent.version — running after the new one arrived.
if ! docker compose up -d --force-recreate; then
    echo ""
    echo "Error: the agent did not start. If Docker reports that a container name is already in"
    echo "use (\"$CEPH_AGENT_CONTAINER_NAME\" or \"$CEPH_AI_AGENT_CONTAINER_NAME\"), another container on this"
    echo "machine has it (another cluster's agent, say): give this agent names of its own and run this"
    echo "again, e.g."
    echo "  CEPH_AGENT_CONTAINER_NAME=$DEFAULT_CONTAINER_NAME-<cluster> CEPH_AI_AGENT_CONTAINER_NAME=oneuptime-ceph-ai-agent-<cluster> INSTALL_DIR=$INSTALL_DIR bash install.sh"
    echo "They are kept in $ENV_FILE from then on (see README.md, \"Monitoring several clusters\")."
    exit 1
fi

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
echo "AI agent status:  docker exec $CEPH_AI_AGENT_CONTAINER_NAME wget -qO- http://127.0.0.1:3877/status"
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
if [ -n "$RENAMED_COMPOSE_BACKUP" ]; then
    echo ""
    echo "Your docker-compose.yml gave the agent's containers names of their own, the one change you"
    echo "had made to it. The new docker-compose.yml reads the names from .env"
    echo "(CEPH_AGENT_CONTAINER_NAME=$CEPH_AGENT_CONTAINER_NAME, CEPH_AI_AGENT_CONTAINER_NAME=$CEPH_AI_AGENT_CONTAINER_NAME),"
    echo "so there is nothing to make again. Your copy is kept: $RENAMED_COMPOSE_BACKUP"
elif [ "$CONTAINER_NAME_SOURCE" = "its docker-compose.yml" ]; then
    echo ""
    echo "The new docker-compose.yml reads the containers' names from .env"
    echo "(CEPH_AGENT_CONTAINER_NAME=$CEPH_AGENT_CONTAINER_NAME, CEPH_AI_AGENT_CONTAINER_NAME=$CEPH_AI_AGENT_CONTAINER_NAME):"
    echo "leave their container_name lines as they are when you make your other changes again."
fi
