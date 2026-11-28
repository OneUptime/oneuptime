#!/bin/bash
set -e

echo "=========================================="
echo "  OneUptime OpenStack Agent Installer"
echo "=========================================="
echo ""

# Every variable docker-compose.yml reads, and what this script and
# troubleshoot.sh read from .env. The .env holds all of them, so a value set by
# hand survives a re-run. The credential is not here: clouds.yaml alone holds it.
#
# The lists of targets are never asked for: what a cloud stands on is named by whoever
# knows where it runs, and README.md says how. Each is kept across a re-run.
TARGET_LIST_NAMES="OPENSTACK_RABBITMQ_TARGETS OPENSTACK_MARIADB_TARGETS OPENSTACK_MEMCACHED_TARGETS \
OPENSTACK_HAPROXY_TARGETS OPENSTACK_NETWORK_EXPORTER_TARGETS OPENSTACK_LIBVIRT_HEALTH_TARGETS \
OPENSTACK_LIBVIRT_EXPORTER_TARGETS OPENSTACK_CEILOMETER_EXPORTER_TARGETS"
# What only the largest clouds set, by hand: see "Very large clouds" in the docs. Never asked for,
# and kept across a re-run when they are set. The database URLs hold a password, and .env is 0600.
VERY_LARGE_CLOUD_NAMES="OPENSTACK_AGENT_SERVICES OPENSTACK_AGENT_MEMORY_LIMIT_MIB \
OPENSTACK_DATABASE_EXPORTER_TARGETS OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX \
OPENSTACK_WORKER_STATE_CLOUDS OPENSTACK_WORKER_STATE_EXPORTER_ADDRESS \
NOVA_DATABASE_URL NOVA_API_DATABASE_URL PLACEMENT_DATABASE_URL NEUTRON_DATABASE_URL \
CINDER_DATABASE_URL GLANCE_DATABASE_URL KEYSTONE_DATABASE_URL"
# The OneUptime AI agent's own settings, never asked for: its defaults read the cloud with the
# credential in clouds.yaml. Kept across a re-run when they are set.
AI_AGENT_NAMES="OPENSTACK_AI_CLOUDS_FILE ONEUPTIME_AI_OPENSTACK_CLOUD \
ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_ID ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_SECRET \
ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_ID ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_SECRET \
ONEUPTIME_AI_OPENSTACK_REGION ONEUPTIME_AI_OPENSTACK_INTERFACE ONEUPTIME_AI_OPENSTACK_CA_FILE \
ONEUPTIME_AI_INVESTIGATION ONEUPTIME_AI_FIXES ONEUPTIME_AI_ALLOW_WRITES \
ONEUPTIME_AI_WRITE_TARGETS ONEUPTIME_AI_PROTECTED_TARGETS ONEUPTIME_AI_AGENT_RESOURCE_NAME LOG_LEVEL"
# The containers' names, with Docker (see "The agent's container names" below).
CONTAINER_NAME_NAMES="OPENSTACK_AGENT_CONTAINER_NAME OPENSTACK_EXPORTER_CONTAINER_NAME \
OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME \
OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME OPENSTACK_AI_AGENT_CONTAINER_NAME"
ENV_NAMES="ONEUPTIME_URL ONEUPTIME_TELEMETRY_INGESTION_KEY OPENSTACK_CLOUD_NAME \
OPENSTACK_AUTH_URL OPENSTACK_EXPORTER_CLOUDS OPENSTACK_EXPORTER_ADDRESS \
OPENSTACK_EXPORTER_USER OPENSTACK_CA_FILE COMPOSE_PROFILES OPENSTACK_COLLECT_QUOTAS \
OPENSTACK_QUOTA_CLOUDS OPENSTACK_QUOTA_EXPORTER_ADDRESS \
OPENSTACK_CONTROL_PLANE_REGION OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS $TARGET_LIST_NAMES \
$VERY_LARGE_CLOUD_NAMES $AI_AGENT_NAMES $CONTAINER_NAME_NAMES"

# The answers that end up in clouds.yaml and nowhere else.
CREDENTIAL_NAMES="OPENSTACK_APPLICATION_CREDENTIAL_ID OPENSTACK_APPLICATION_CREDENTIAL_SECRET \
OPENSTACK_USERNAME OPENSTACK_PASSWORD OPENSTACK_PROJECT_NAME \
OPENSTACK_USER_DOMAIN_NAME OPENSTACK_PROJECT_DOMAIN_NAME"

# An answer given as an environment variable stays this script's, and is handed
# to no program it runs: not curl, not Docker, not Compose, which gives variables
# in its environment precedence over .env, so every start runs what every later
# `docker compose up` (and the systemd unit) will: .env alone.
for name in $ENV_NAMES $CREDENTIAL_NAMES; do
    export -n "$name"
done

# Every answer below also works as an environment variable, so a run can ask
# nothing at all (README.md lists them). They have names of their own rather
# than the OS_* ones an openrc file sets: an admin's sourced openrc must never
# become the agent's credential without anyone being asked.
#
# `bash install.sh --without-docker` (or OPENSTACK_AGENT_WITHOUT_DOCKER=true)
# runs the same collector and exporter releases as systemd services instead of
# Docker Compose. A re-run stays whichever it was.
WITHOUT_DOCKER="$(printf '%s' "${OPENSTACK_AGENT_WITHOUT_DOCKER:-false}" | tr '[:upper:]' '[:lower:]')"
for argument in "$@"; do
    case "$argument" in
        --without-docker) WITHOUT_DOCKER="true" ;;
        *)
            echo "Error: unknown argument $argument. Usage: bash install.sh [--without-docker]"
            exit 2
            ;;
    esac
done

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
# A cloud name can hold spaces and #, so every user-supplied value goes through
# this helper. It prefers the literal single-quoted form and falls back to the
# escaped double-quoted form only when single quotes cannot represent the
# value. Pure parameter expansion: the value never leaves this shell (no echo,
# no subprocess).
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

# The .env of an install without Docker is read by systemd, not Compose, and
# systemd has rules of its own: a $ is literal, and older versions (RHEL 8's)
# drop a backslash even inside single quotes. So there every value is written
# double-quoted with \ and " escaped, the one form every version reads as typed.
systemd_env_quote() {
    local value="$1"
    value="${value//\\/\\\\}"
    value="${value//\"/\\\"}"
    printf '"%s"' "$value"
}

# Read one variable back from such a file. A value written by hand may also be
# single-quoted or bare.
systemd_env_get() {
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
            rest="${value#\"}"
            value=""
            while [ -n "$rest" ]; do
                ch="${rest:0:1}"
                if [ "$ch" = '\' ] && [ -n "${rest:1:1}" ]; then
                    value="$value${rest:1:1}"
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
            value="${value#"${value%%[![:space:]]*}"}"
            value="${value%"${value##*[![:space:]]}"}"
            ;;
    esac
    printf '%s' "$value"
}

# A value as a JSON string, which is also a YAML double-quoted scalar: nothing
# in it means anything but itself, whatever a secret holds ($ # : ' " { % and
# the rest). The Keystone request and clouds.yaml both use it. Pure parameter
# expansion, for the same reason as compose_env_quote.
json_string() {
    local value="$1" tab=$'\t' newline=$'\n' return=$'\r'
    value="${value//\\/\\\\}"
    value="${value//\"/\\\"}"
    value="${value//$tab/\\t}"
    value="${value//$newline/\\n}"
    value="${value//$return/\\r}"
    printf '"%s"' "$value"
}

# Read one `key: value` back from clouds.yaml: the first one in the file, since
# every entry holds the same credential. Undoes what json_string wrote, and what
# someone editing the file by hand may write instead. Prints nothing when the
# key is absent.
clouds_yaml_get() {
    local line="" value="" rest="" ch="" decoded=""
    [ -r "$CLOUDS_FILE" ] || return 0
    line="$(grep -E "^[[:space:]]+$1:[[:space:]]" "$CLOUDS_FILE" 2>/dev/null | head -1)" || true
    [ -n "$line" ] || return 0
    value="${line#*:}"
    value="${value#"${value%%[![:space:]]*}"}"
    case "$value" in
        \"*)
            rest="${value#\"}"
            while [ -n "$rest" ]; do
                ch="${rest:0:1}"
                if [ "$ch" = '\' ]; then
                    case "${rest:1:1}" in
                        t) decoded="$decoded"$'\t' ;;
                        n) decoded="$decoded"$'\n' ;;
                        r) decoded="$decoded"$'\r' ;;
                        *) decoded="$decoded${rest:1:1}" ;;
                    esac
                    rest="${rest:2}"
                elif [ "$ch" = '"' ]; then
                    break
                else
                    decoded="$decoded$ch"
                    rest="${rest:1}"
                fi
            done
            ;;
        \'*)
            rest="${value#\'}"
            while [ -n "$rest" ]; do
                ch="${rest:0:1}"
                if [ "$ch" = "'" ] && [ "${rest:1:1}" = "'" ]; then
                    decoded="$decoded'"
                    rest="${rest:2}"
                elif [ "$ch" = "'" ]; then
                    break
                else
                    decoded="$decoded$ch"
                    rest="${rest:1}"
                fi
            done
            ;;
        *)
            decoded="${value%% #*}"
            decoded="${decoded%"${decoded##*[![:space:]]}"}"
            ;;
    esac
    printf '%s' "$decoded"
}

# Download an agent file, keeping a copy of the installed one when it holds
# edits. The docs ask for edits to these files (the slow metrics, the per-port
# series, the intervals), so a re-run — the upgrade path — must not discard
# them silently. What was installed is recorded (a sha256 per file in
# .agent-files.sha256), so a file that no longer matches its record was
# edited: it is kept as <file>.bak.<timestamp> and named at the end. A file
# that still matches is simply replaced, however much the new version changed
# (a collector pin bump changes both files). Without a record — an agent
# installed before it was kept, or no sha256 tool — any file that differs from
# the new download is kept, and said to differ rather than to be edited. The
# new file lands with the permissions curl -o would give it (the collector
# reads its config as a non-root user).
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
# Two containers cannot share a name, so a second OpenStack cloud's agent on
# this machine, in a directory of its own, needs container names of its own:
# its collector's, its exporters' and its AI agent's. docker-compose.yml reads
# each from .env (container_name:
# ${OPENSTACK_AGENT_CONTAINER_NAME:-oneuptime-openstack-agent}, and
# CONTAINER_NAME_NAMES' others), and nothing asks for them. With Docker only:
# an install without it runs no container. The collector's is, in this order:
#   - OPENSTACK_AGENT_CONTAINER_NAME exported, or in .env on a re-run, like
#     every other value;
#   - for an agent set up before .env held it, the name its docker-compose.yml
#     was given by hand: read from that file before this run replaces it,
#     else from the container this directory runs, else from the newest
#     docker-compose.yml.bak.<timestamp> an earlier upgrade kept; and an
#     agent that runs under the default name keeps it. An upgrade never
#     renames an agent;
#   - otherwise the directory's: oneuptime-openstack-agent-<project>,
#     <project> being the name Compose gives the directory's project (see
#     "The agent's Compose project" below: cloud2 for /opt/cloud2), or the
#     project's name itself when it starts with oneuptime-openstack-agent.
#     One directory is one project, and one name. The default directory's is
#     the default name, so a first agent is named as it always was.
# Each of the others is its variable the same way, else the name it was
# given by hand or runs as, else beside the collector's:
# oneuptime-openstack-exporter-cloud2 beside oneuptime-openstack-agent-cloud2.
# The compose services keep their names, so `docker compose ps` and `logs`
# in the directory, and the collector's scrape targets, find them whatever
# their containers are named.
AGENT_SERVICE="oneuptime-openstack-agent"
DEFAULT_CONTAINER_NAME="oneuptime-openstack-agent"
# The containers beside the collector, one a line: the .env variable of
# its name, its compose service, its default name, and what it is, for a
# name beside any other (companion_container_name_for).
COMPANION_CONTAINERS="OPENSTACK_EXPORTER_CONTAINER_NAME|openstack-exporter|oneuptime-openstack-exporter|exporter
OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME|openstack-quota-exporter|oneuptime-openstack-quota-exporter|quota-exporter
OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME|openstack-database-exporter|oneuptime-openstack-database-exporter|database-exporter
OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME|openstack-worker-state-exporter|oneuptime-openstack-worker-state-exporter|worker-state-exporter
OPENSTACK_AI_AGENT_CONTAINER_NAME|oneuptime-openstack-ai-agent|oneuptime-openstack-ai-agent|ai"

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

# Sets OPENSTACK_AGENT_CONTAINER_NAME when neither the shell nor .env gave it,
# as the block above says, and CONTAINER_NAME_SOURCE to where it came from.
choose_container_name() {
    local edited="" existing="" backed_up=""
    edited="$(compose_container_name "$INSTALL_DIR/docker-compose.yml")"
    existing="$(existing_container_name)"
    if [ -n "$edited" ] && [ "$edited" != "$DEFAULT_CONTAINER_NAME" ]; then
        OPENSTACK_AGENT_CONTAINER_NAME="$edited"
        CONTAINER_NAME_SOURCE="its docker-compose.yml"
    elif [ -n "$existing" ] && [ "$existing" != "$DEFAULT_CONTAINER_NAME" ]; then
        OPENSTACK_AGENT_CONTAINER_NAME="$existing"
        CONTAINER_NAME_SOURCE="the container it runs as"
    else
        backed_up="$(backup_container_name)"
        if [ -n "$backed_up" ]; then
            OPENSTACK_AGENT_CONTAINER_NAME="$backed_up"
            CONTAINER_NAME_SOURCE="its docker-compose.yml, kept as a backup by an earlier upgrade"
        elif [ -n "$existing" ]; then
            OPENSTACK_AGENT_CONTAINER_NAME="$existing"
            CONTAINER_NAME_SOURCE="the container it runs as"
        else
            OPENSTACK_AGENT_CONTAINER_NAME="$(directory_container_name)"
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
# only a-z 0-9 _ and -, no leading _ or - ("Cloud Lab (2)" is cloudlab2),
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

# Installation directory (decided first so an existing .env can be reused). Docker asks for
# the docker group and nothing else, so a person with no rights on /opt gets a folder in their
# home, and a re-run finds it there. A folder already in /opt stays the answer: if it is someone
# else's, the check on .env below says so, rather than a second agent starting beside it.
DEFAULT_INSTALL_DIR="/opt/oneuptime-openstack-agent"
INSTALL_DIR_IS_IN_HOME=0
if [ -z "${INSTALL_DIR:-}" ]; then
    INSTALL_DIR="$DEFAULT_INSTALL_DIR"
    if [ "$WITHOUT_DOCKER" != "true" ] && [ "$(id -u)" != "0" ] && [ -n "${HOME:-}" ] \
        && [ ! -e "$DEFAULT_INSTALL_DIR" ] && [ ! -w "${DEFAULT_INSTALL_DIR%/*}" ]; then
        INSTALL_DIR="$HOME/oneuptime-openstack-agent"
        INSTALL_DIR_IS_IN_HOME=1
    fi
fi
ENV_FILE="$INSTALL_DIR/.env"
CLOUDS_FILE="$INSTALL_DIR/clouds.yaml"
# What this script installed (see download_agent_file).
AGENT_FILES_RECORD="$INSTALL_DIR/.agent-files.sha256"

# ----------------------------------------------------------------------------
# With Docker, or without it
# ----------------------------------------------------------------------------
# An install without Docker keeps the collector's binary in its folder. The
# .env is written for whichever runs it, so it is read back the way it was
# written: a first run with --without-docker on a Docker install reads Compose's
# form, and writes systemd's.
ENV_FILE_IS_SYSTEMDS=0
RUNS_WITHOUT_DOCKER=0
if [ -x "$INSTALL_DIR/otelcol-contrib" ]; then
    ENV_FILE_IS_SYSTEMDS=1
    RUNS_WITHOUT_DOCKER=1
elif [ "$WITHOUT_DOCKER" = "true" ]; then
    RUNS_WITHOUT_DOCKER=1
fi

# The releases an install without Docker runs: the same versions
# docker-compose.yml pins, each archive held to a sha256 kept here rather than
# one fetched from the same release. Tests/Ops/OpenStackAgentWithoutDocker.test.js
# holds these to docker-compose.yml, so bump them together.
COLLECTOR_VERSION="0.165.0"
COLLECTOR_SHA256_AMD64="bd6e73d94bf3359ad6fac25529a8ee308adb9b0b8a0e8af034ed3891fbe5aa33"
COLLECTOR_SHA256_ARM64="376420729c862230807bc89811d07d10031eaeca3f6481fe371a2bdcefd2c8fa"
EXPORTER_VERSION="2.0.0-alpha"
EXPORTER_SHA256_AMD64="20c42022773fd2e8a41a609b698d3fe97843098ad81479c5e9decf58f349d002"
EXPORTER_SHA256_ARM64="d41800fc6170a5d44027f8fc6a0037e915b6ea3887076e6b96b78e06ebfba9f2"
# Where systemd reads the units, and the system user the exporter runs as: the
# one account that can read clouds.yaml.
UNIT_DIR="${SYSTEMD_UNIT_DIR:-/etc/systemd/system}"
COLLECTOR_SERVICE="oneuptime-openstack-agent"
EXPORTER_SERVICE="oneuptime-openstack-exporter"
QUOTA_EXPORTER_SERVICE="oneuptime-openstack-quota-exporter"
EXPORTER_SYSTEM_USER="oneuptime-openstack"

# Check prerequisites
if [ "$RUNS_WITHOUT_DOCKER" = 1 ]; then
    if [ "$(uname -s)" != "Linux" ]; then
        echo "Error: the install without Docker runs systemd services, so it needs Linux."
        exit 1
    fi
    if [ "$(id -u)" != "0" ]; then
        echo "Error: the install without Docker adds systemd services and a system user, so it needs root."
        echo "Try: sudo bash install.sh --without-docker"
        exit 1
    fi
    for tool in systemctl useradd tar; do
        if ! command -v "$tool" >/dev/null 2>&1; then
            echo "Error: the install without Docker needs $tool, and this machine has none."
            exit 1
        fi
    done
    if [ -z "$(command -v sha256sum)$(command -v shasum)" ]; then
        echo "Error: the install without Docker checks what it downloads, and this machine has no sha256sum."
        exit 1
    fi
    case "$(uname -m)" in
        x86_64 | amd64)
            RELEASE_ARCH="amd64"
            COLLECTOR_SHA256="$COLLECTOR_SHA256_AMD64"
            EXPORTER_SHA256="$EXPORTER_SHA256_AMD64"
            ;;
        aarch64 | arm64)
            RELEASE_ARCH="arm64"
            COLLECTOR_SHA256="$COLLECTOR_SHA256_ARM64"
            EXPORTER_SHA256="$EXPORTER_SHA256_ARM64"
            ;;
        *)
            echo "Error: the install without Docker has releases pinned for x86_64 and arm64, not $(uname -m)."
            exit 1
            ;;
    esac
else
    if ! command -v docker &> /dev/null; then
        echo "Error: Docker is not installed. Please install Docker first,"
        echo "or install without it, as systemd services: bash install.sh --without-docker"
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
fi

# The container names the shell gives, and the collector's as .env has it
# (see "The agent's container names" above), before .env is read back.
EXPORTED_CONTAINER_NAMES="$(exported_container_names)"
KEPT_CONTAINER_NAME=""
if [ -f "$ENV_FILE" ] && [ -r "$ENV_FILE" ] && [ "$ENV_FILE_IS_SYSTEMDS" = 0 ]; then
    KEPT_CONTAINER_NAME="$(dotenv_get OPENSTACK_AGENT_CONTAINER_NAME "$ENV_FILE")"
fi

# Re-running the installer is the upgrade, and it keeps the existing
# configuration: every value already in .env is reused unless the same
# variable is exported in the shell, and nothing is prompted for again.
# Edit .env directly, export the variable, or delete the file to change one.
REUSED_ENV=0
if [ -f "$ENV_FILE" ]; then
    if [ ! -r "$ENV_FILE" ]; then
        echo "Error: $ENV_FILE exists, but this user cannot read it. Run this as the user that installed the agent."
        exit 1
    fi
    REUSED_ENV=1
    echo "Found an existing configuration in $ENV_FILE — reusing it."
    echo "(Exported variables override it; edit or delete the file to change a value.)"
    for name in $ENV_NAMES; do
        if [ -z "${!name}" ]; then
            if [ "$ENV_FILE_IS_SYSTEMDS" = 1 ]; then
                printf -v "$name" '%s' "$(systemd_env_get "$name" "$ENV_FILE")"
            else
                printf -v "$name" '%s' "$(dotenv_get "$name" "$ENV_FILE")"
            fi
        fi
    done
    echo ""
fi

# Prompt for configuration
while [ -z "$ONEUPTIME_URL" ]; do
    read -rp "OneUptime URL (e.g., https://oneuptime.com): " ONEUPTIME_URL
done
ONEUPTIME_URL="${ONEUPTIME_URL%/}"

while [ -z "$ONEUPTIME_TELEMETRY_INGESTION_KEY" ]; do
    # -s: never echo it to the terminal.
    read -rsp "OneUptime Telemetry Ingestion Key: " ONEUPTIME_TELEMETRY_INGESTION_KEY
    echo ""
done

if [ -z "$OPENSTACK_CLOUD_NAME" ]; then
    read -rp "Cloud name (shown in OneUptime, keep it stable) [openstack]: " OPENSTACK_CLOUD_NAME
    OPENSTACK_CLOUD_NAME="${OPENSTACK_CLOUD_NAME:-openstack}"
fi

# A list of scrape targets as the collector reads it, in square brackets. It takes
# one with or without them, and a target may say which region it is in:
# [10.0.0.11:15692,RegionTwo@10.1.0.11:15692]. An IPv6 address goes in double quotes,
# because a bare [ opens a list inside the list.
normalized_target_list() {
    local name="$1" left="${!1}" item="" written=""
    left="${left#"${left%%[![:space:]]*}"}"
    left="${left%"${left##*[![:space:]]}"}"
    case "$left" in
        \[*\]) left="${left#\[}"; left="${left%\]}" ;;
    esac
    left="$left,"
    while [ -n "$left" ]; do
        item="${left%%,*}"
        left="${left#*,}"
        item="${item#"${item%%[![:space:]]*}"}"
        item="${item%"${item##*[![:space:]]}"}"
        item="${item#\"}"
        item="${item%\"}"
        [ -n "$item" ] || continue
        case "$item" in
            *[!A-Za-z0-9._:@\[\]\ -]* | *:)
                echo "Error: $name holds \"$item\", which is not a host:port to scrape." >&2
                return 1
                ;;
            *:[0-9]*) ;;
            *)
                echo "Error: $name holds \"$item\", which has no port. Each target is a host:port." >&2
                return 1
                ;;
        esac
        case "$item" in
            \[*) item="\"$item\"" ;;
        esac
        written="$written,$item"
    done
    printf '[%s]' "${written#,}"
}

for name in OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS OPENSTACK_DATABASE_EXPORTER_TARGETS $TARGET_LIST_NAMES; do
    NORMALIZED_TARGETS="$(normalized_target_list "$name")" || exit 1
    printf -v "$name" '%s' "$NORMALIZED_TARGETS"
    if [ "$RUNS_WITHOUT_DOCKER" = 0 ]; then
        case "$NORMALIZED_TARGETS" in
            *localhost:* | *127.0.0.1:*)
                # The agent runs as a container on the compose bridge network, so
                # "localhost" inside it is the agent itself.
                echo "Error: $name is $NORMALIZED_TARGETS, and the agent runs in a container, where that is the"
                echo "container itself. Use an address containers can reach: this machine's LAN IP or DNS name."
                exit 1
                ;;
        esac
    fi
done

# An exporter already running in single-cloud mode, such as Kolla-Ansible's. It has no
# /probe, so it is scraped on /metrics by a job of its own, and it reads one region.
SINGLE_CLOUD_EXPORTER=0
if [ "$OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS" != "[]" ]; then
    SINGLE_CLOUD_EXPORTER=1
fi

# The largest clouds' path: an exporter that reads each service's database, in place of
# OPENSTACK_EXPORTER_CLOUDS. The bundled exporter's image still reads what a database cannot
# say, for the entries of clouds.yaml in OPENSTACK_WORKER_STATE_CLOUDS. "The database path" in
# the docs turns it on in .env by hand. Written only when set, like the rest of those settings.
READS_DATABASES=1
if [ "$OPENSTACK_DATABASE_EXPORTER_TARGETS" = "[]" ]; then
    READS_DATABASES=0
    OPENSTACK_DATABASE_EXPORTER_TARGETS=""
fi

# Bring your own exporter: an address other than the bundled exporter's. The
# bundled one then never starts, and the exporter's own clouds.yaml holds the
# credential, so nothing asks for one here.
if [ "$RUNS_WITHOUT_DOCKER" = 1 ]; then
    BUNDLED_EXPORTER_ADDRESS="127.0.0.1:9180"
else
    BUNDLED_EXPORTER_ADDRESS="openstack-exporter:9180"
fi
OPENSTACK_EXPORTER_ADDRESS="${OPENSTACK_EXPORTER_ADDRESS#http://}"
OPENSTACK_EXPORTER_ADDRESS="${OPENSTACK_EXPORTER_ADDRESS%/}"
case "$OPENSTACK_EXPORTER_ADDRESS" in
    "" | "openstack-exporter:9180") OPENSTACK_EXPORTER_ADDRESS="$BUNDLED_EXPORTER_ADDRESS" ;;
esac
# Your own exporter leaves no clouds.yaml beside the AI agent, so it starts only when someone
# gave it a credential of its own and asked for it: a re-run keeps that.
OWN_EXPORTER_PROFILES=""
case ",$COMPOSE_PROFILES," in
    *,openstack-ai-agent,*) OWN_EXPORTER_PROFILES="openstack-ai-agent" ;;
esac
# The database exporter's profile, when it is the one the agent reads, or someone started it
# ahead of reading it. A target anywhere else is an exporter this file does not start.
STARTS_DATABASE_EXPORTER=0
case ",$COMPOSE_PROFILES,$OPENSTACK_DATABASE_EXPORTER_TARGETS" in
    *,openstack-database-exporter,* | *openstack-database-exporter:*) STARTS_DATABASE_EXPORTER=1 ;;
esac
if [ "$SINGLE_CLOUD_EXPORTER" = 1 ]; then
    BUNDLED_EXPORTER=0
    COMPOSE_PROFILES="$OWN_EXPORTER_PROFILES"
elif [ "$OPENSTACK_EXPORTER_ADDRESS" = "$BUNDLED_EXPORTER_ADDRESS" ]; then
    BUNDLED_EXPORTER=1
    if [ "$RUNS_WITHOUT_DOCKER" = 1 ]; then
        COMPOSE_PROFILES=""
    elif [ "$READS_DATABASES" = 1 ]; then
        # Nothing asks the exporter of the APIs anything here, and clouds.yaml is still here
        # for what a database cannot say, so the AI agent reads it as it does anywhere.
        COMPOSE_PROFILES="openstack-ai-agent"
    else
        # With a clouds.yaml to read, the AI agent runs beside the exporter.
        COMPOSE_PROFILES="openstack-exporter,openstack-ai-agent"
    fi
else
    BUNDLED_EXPORTER=0
    COMPOSE_PROFILES="$OWN_EXPORTER_PROFILES"
    if [ "$RUNS_WITHOUT_DOCKER" = 0 ]; then
        case "$OPENSTACK_EXPORTER_ADDRESS" in
            localhost:* | 127.0.0.1:*)
                # No localhost here: the agent runs as a container on the
                # compose bridge network, so "localhost" inside it is the agent
                # itself — it can never reach an exporter running on this host.
                echo "Error: OPENSTACK_EXPORTER_ADDRESS is $OPENSTACK_EXPORTER_ADDRESS, and the agent runs in a container,"
                echo "where that is the container itself. Use an address containers can reach: this"
                echo "machine's LAN IP or DNS name (or host.docker.internal on Docker Desktop)."
                exit 1
                ;;
        esac
    fi
fi
if [ "$STARTS_DATABASE_EXPORTER" = 1 ] && [ "$RUNS_WITHOUT_DOCKER" = 0 ]; then
    COMPOSE_PROFILES="openstack-database-exporter${COMPOSE_PROFILES:+,$COMPOSE_PROFILES}"
fi

# Each project's quotas: off until asked for, because of what they cost. They are read by an
# exporter this agent starts, so an exporter of your own has to read them itself.
case "$OPENSTACK_COLLECT_QUOTAS" in
    true) ;;
    "" | false) OPENSTACK_COLLECT_QUOTAS="false" ;;
    *)
        echo "Error: OPENSTACK_COLLECT_QUOTAS must be true or false, not: $OPENSTACK_COLLECT_QUOTAS"
        exit 1
        ;;
esac
READS_QUOTAS=0
if [ "$OPENSTACK_COLLECT_QUOTAS" = "true" ] && [ "$BUNDLED_EXPORTER" = 1 ]; then
    READS_QUOTAS=1
fi
if [ "$RUNS_WITHOUT_DOCKER" = 1 ]; then
    OPENSTACK_QUOTA_EXPORTER_ADDRESS="127.0.0.1:9182"
else
    OPENSTACK_QUOTA_EXPORTER_ADDRESS="openstack-quota-exporter:9180"
fi
if [ "$READS_QUOTAS" = 1 ] && [ "$RUNS_WITHOUT_DOCKER" = 0 ]; then
    COMPOSE_PROFILES="$COMPOSE_PROFILES,openstack-quotas"
fi

# The identity endpoint as this script writes it: no trailing slash, ending in /v3.
keystone_v3_url() {
    local url="$1"
    while [ "${url%/}" != "$url" ]; do
        url="${url%/}"
    done
    case "$url" in
        "" | */v3) printf '%s' "$url" ;;
        *) printf '%s/v3' "$url" ;;
    esac
}

# The Keystone to log in to. clouds.yaml also says, for an .env that does not. With your own
# exporter nothing here logs in, and what .env says stays: the AI agent's own credential logs
# in there, as README.md tells people to set it.
if [ "$BUNDLED_EXPORTER" = 1 ]; then
    if [ -z "$OPENSTACK_AUTH_URL" ]; then
        OPENSTACK_AUTH_URL="$(clouds_yaml_get auth_url)"
    fi
    while [ -z "$OPENSTACK_AUTH_URL" ]; do
        read -rp "Keystone auth URL (e.g., https://keystone.example.com:5000/v3): " OPENSTACK_AUTH_URL
    done
    case "$OPENSTACK_AUTH_URL" in
        http://* | https://*) ;;
        *)
            echo "Error: the Keystone auth URL must start with http:// or https://, not: $OPENSTACK_AUTH_URL"
            exit 1
            ;;
    esac
    OPENSTACK_AUTH_URL="$(keystone_v3_url "$OPENSTACK_AUTH_URL")"
fi

# One or several regions, comma-separated, with or without the square brackets
# the collector needs, which are added here. Each is the name of a clouds.yaml
# entry, and the collector stamps that name as the region on every series,
# because the exporter's series do not say which region they are from.
read_regions() {
    local left="${1#\[}" region=""
    REGIONS=()
    left="${left%\]},"
    while [ -n "$left" ]; do
        region="${left%%,*}"
        left="${left#*,}"
        region="${region#"${region%%[![:space:]]*}"}"
        region="${region%"${region##*[![:space:]]}"}"
        region="${region#[\"\']}"
        region="${region%[\"\']}"
        [ -n "$region" ] || continue
        case "$region" in
            *[!A-Za-z0-9._\ -]*)
                echo "Error: \"$region\" cannot be a region name here. A name can hold letters, digits, dots,"
                echo "dashes, underscores and spaces, and names are separated by commas."
                exit 1
                ;;
        esac
        case ",${REGIONS[*]+$(IFS=,; printf '%s' "${REGIONS[*]}")}," in
            *",$region,"*) ;;
            *) REGIONS+=("$region") ;;
        esac
    done
}

if [ "$SINGLE_CLOUD_EXPORTER" = 1 ]; then
    # It has no entry per region to name: the region is whatever its clouds.yaml says.
    if [ -z "$OPENSTACK_CONTROL_PLANE_REGION" ]; then
        read -rp "The region this exporter reads [RegionOne]: " OPENSTACK_CONTROL_PLANE_REGION
        OPENSTACK_CONTROL_PLANE_REGION="${OPENSTACK_CONTROL_PLANE_REGION:-RegionOne}"
    fi
    OPENSTACK_EXPORTER_CLOUDS="$OPENSTACK_CONTROL_PLANE_REGION"
elif [ "$READS_DATABASES" = 1 ]; then
    read_regions "$OPENSTACK_EXPORTER_CLOUDS"
    if [ "${#REGIONS[@]}" != 0 ]; then
        echo "Error: OPENSTACK_DATABASE_EXPORTER_TARGETS reads this cloud from its databases, and OPENSTACK_EXPORTER_CLOUDS"
        echo "reads it from its APIs, so every series would arrive twice. Set OPENSTACK_EXPORTER_CLOUDS=[] to read the"
        echo "databases alone, or take the targets out to read the APIs. Nothing was installed or changed."
        exit 1
    fi
    # What clouds.yaml has to hold: the entries read for what a database cannot say. With
    # none named, the region the databases are in, for the AI agent and whoever names them later.
    read_regions "$OPENSTACK_WORKER_STATE_CLOUDS"
    if [ "${#REGIONS[@]}" != 0 ]; then
        OPENSTACK_EXPORTER_CLOUDS="$OPENSTACK_WORKER_STATE_CLOUDS"
    else
        OPENSTACK_WORKER_STATE_CLOUDS=""
        if [ -z "$OPENSTACK_CONTROL_PLANE_REGION" ]; then
            read -rp "The region these databases are in [RegionOne]: " OPENSTACK_CONTROL_PLANE_REGION
            OPENSTACK_CONTROL_PLANE_REGION="${OPENSTACK_CONTROL_PLANE_REGION:-RegionOne}"
        fi
        OPENSTACK_EXPORTER_CLOUDS="$OPENSTACK_CONTROL_PLANE_REGION"
    fi
elif [ -z "$OPENSTACK_EXPORTER_CLOUDS" ]; then
    read -rp "Region names, comma-separated [RegionOne]: " OPENSTACK_EXPORTER_CLOUDS
    OPENSTACK_EXPORTER_CLOUDS="${OPENSTACK_EXPORTER_CLOUDS:-RegionOne}"
fi
read_regions "$OPENSTACK_EXPORTER_CLOUDS"
if [ "${#REGIONS[@]}" = 0 ]; then
    echo "Error: OPENSTACK_EXPORTER_CLOUDS names no region."
    echo "Reading this cloud from its databases instead? Name that exporter in OPENSTACK_DATABASE_EXPORTER_TARGETS too."
    exit 1
fi
OPENSTACK_EXPORTER_CLOUDS="$(IFS=,; printf '[%s]' "${REGIONS[*]}")"
# Each project's quotas, for the regions the agent reads, once they have been asked for.
if [ "$READS_QUOTAS" = 1 ]; then
    OPENSTACK_QUOTA_CLOUDS="$OPENSTACK_EXPORTER_CLOUDS"
else
    OPENSTACK_QUOTA_CLOUDS="[]"
fi
if [ "$SINGLE_CLOUD_EXPORTER" = 1 ]; then
    if [ "${#REGIONS[@]}" != 1 ]; then
        echo "Error: an exporter in single-cloud mode reads one region, and OPENSTACK_CONTROL_PLANE_REGION names ${#REGIONS[@]}."
        echo "Run one agent for each region, with the same cloud name."
        exit 1
    fi
    # The per-service jobs read this list, and that exporter has no /probe to ask.
    OPENSTACK_EXPORTER_CLOUDS="[]"
elif [ "$READS_DATABASES" = 1 ]; then
    if [ -n "$OPENSTACK_WORKER_STATE_CLOUDS" ]; then
        OPENSTACK_WORKER_STATE_CLOUDS="$OPENSTACK_EXPORTER_CLOUDS"
    fi
    # The per-service jobs read this list: with both, every series arrives twice.
    OPENSTACK_EXPORTER_CLOUDS="[]"
fi
# The region of a target that does not say its own.
OPENSTACK_CONTROL_PLANE_REGION="${OPENSTACK_CONTROL_PLANE_REGION:-${REGIONS[0]}}"

# ----------------------------------------------------------------------------
# The credential, the bundled exporter's alone
# ----------------------------------------------------------------------------
# An application credential by default. Exported values win, and what they
# leave out comes from the clouds.yaml a previous run wrote, so a re-run asks
# nothing and one exported secret changes one thing.
CREDENTIAL_KIND=""
CREDENTIAL_EXPORTED=0
if [ "$BUNDLED_EXPORTER" = 1 ]; then
    if [ -n "$OPENSTACK_APPLICATION_CREDENTIAL_ID$OPENSTACK_APPLICATION_CREDENTIAL_SECRET" ]; then
        CREDENTIAL_KIND="application_credential"
        CREDENTIAL_EXPORTED=1
    elif [ -n "$OPENSTACK_USERNAME$OPENSTACK_PASSWORD$OPENSTACK_PROJECT_NAME" ]; then
        CREDENTIAL_KIND="password"
        CREDENTIAL_EXPORTED=1
    elif [ -e "$CLOUDS_FILE" ] && [ ! -r "$CLOUDS_FILE" ]; then
        echo "Error: $CLOUDS_FILE exists, but this user cannot read it. Run this as the user that installed the agent."
        exit 1
    elif [ -n "$(clouds_yaml_get application_credential_id)" ]; then
        CREDENTIAL_KIND="application_credential"
    elif [ -n "$(clouds_yaml_get username)" ]; then
        CREDENTIAL_KIND="password"
    fi
    case "$CREDENTIAL_KIND" in
        application_credential)
            [ -n "$OPENSTACK_APPLICATION_CREDENTIAL_ID" ] || OPENSTACK_APPLICATION_CREDENTIAL_ID="$(clouds_yaml_get application_credential_id)"
            [ -n "$OPENSTACK_APPLICATION_CREDENTIAL_SECRET" ] || OPENSTACK_APPLICATION_CREDENTIAL_SECRET="$(clouds_yaml_get application_credential_secret)"
            ;;
        password)
            [ -n "$OPENSTACK_USERNAME" ] || OPENSTACK_USERNAME="$(clouds_yaml_get username)"
            [ -n "$OPENSTACK_PASSWORD" ] || OPENSTACK_PASSWORD="$(clouds_yaml_get password)"
            [ -n "$OPENSTACK_PROJECT_NAME" ] || OPENSTACK_PROJECT_NAME="$(clouds_yaml_get project_name)"
            [ -n "$OPENSTACK_USER_DOMAIN_NAME" ] || OPENSTACK_USER_DOMAIN_NAME="$(clouds_yaml_get user_domain_name)"
            [ -n "$OPENSTACK_PROJECT_DOMAIN_NAME" ] || OPENSTACK_PROJECT_DOMAIN_NAME="$(clouds_yaml_get project_domain_name)"
            ;;
    esac
fi

# A clouds.yaml with no credential this script can read (written by hand, say,
# with the secret elsewhere) is left alone unless something below has to change
# it, in which case the questions come after all.
credential_is_known() {
    case "$CREDENTIAL_KIND" in
        application_credential)
            [ -n "$OPENSTACK_APPLICATION_CREDENTIAL_ID" ] && [ -n "$OPENSTACK_APPLICATION_CREDENTIAL_SECRET" ]
            ;;
        password)
            [ -n "$OPENSTACK_USERNAME" ] && [ -n "$OPENSTACK_PASSWORD" ] && [ -n "$OPENSTACK_PROJECT_NAME" ] \
                && [ -n "$OPENSTACK_USER_DOMAIN_NAME" ] && [ -n "$OPENSTACK_PROJECT_DOMAIN_NAME" ]
            ;;
        *)
            return 1
            ;;
    esac
}

clouds_file_has_region() {
    grep -Eq "^[[:space:]]+[\"']?$1[\"']?:" "$CLOUDS_FILE"
}

clouds_file_is_current() {
    local region
    [ -f "$CLOUDS_FILE" ] || return 1
    [ "$CREDENTIAL_EXPORTED" = 0 ] || return 1
    [ "$(keystone_v3_url "$(clouds_yaml_get auth_url)")" = "$OPENSTACK_AUTH_URL" ] || return 1
    for region in "${REGIONS[@]}"; do
        clouds_file_has_region "$region" || return 1
    done
    if [ -n "$OPENSTACK_CA_FILE" ] && [ "$(clouds_yaml_get cacert)" != "$EXPECTED_CACERT" ]; then
        return 1
    fi
    return 0
}

# The private CA, for a cloud whose certificate comes from its own authority:
# the file to install as ./ca.pem, next to clouds.yaml, so it can move or go away
# afterwards, and what clouds.yaml calls it where the exporter runs.
CA_SOURCE=""
EXPECTED_CACERT=""
read_ca_file() {
    [ -n "$OPENSTACK_CA_FILE" ] || return 0
    CA_SOURCE="$OPENSTACK_CA_FILE"
    case "$CA_SOURCE" in
        "./ca.pem") CA_SOURCE="$INSTALL_DIR/ca.pem" ;;
        "~/"*) CA_SOURCE="$HOME/${CA_SOURCE#\~/}" ;;
    esac
    if [ ! -r "$CA_SOURCE" ]; then
        echo "Error: cannot read the CA file $CA_SOURCE"
        exit 1
    fi
    if ! grep -q 'BEGIN CERTIFICATE' "$CA_SOURCE"; then
        echo "Error: $CA_SOURCE holds no PEM certificate (no BEGIN CERTIFICATE line)."
        exit 1
    fi
    if [ "$RUNS_WITHOUT_DOCKER" = 1 ]; then
        EXPECTED_CACERT="$INSTALL_DIR/ca.pem"
    else
        EXPECTED_CACERT="/etc/openstack/ca.pem"
    fi
}

# Only the bundled exporter's is installed here. With your own, what .env says stays, for the
# AI agent to mount: the same goes for the Keystone above.
if [ "$BUNDLED_EXPORTER" = 1 ]; then
    read_ca_file
fi

WRITE_CLOUDS_FILE=0
if [ "$BUNDLED_EXPORTER" = 1 ] && ! clouds_file_is_current; then
    WRITE_CLOUDS_FILE=1
fi

if [ "$WRITE_CLOUDS_FILE" = 1 ]; then
    if [ -z "$CREDENTIAL_KIND" ]; then
        echo ""
        echo "The agent logs in with an application credential, or with a username and password."
        echo "An application credential is better: it can be limited to reading, it can expire,"
        echo "and replacing it never touches an account's password. README.md says how to make one."
        echo "Keep it on a project of its own that holds nothing: where Cinder has enforce_new_defaults"
        echo "off, its own default, any role on a project can create that project's volumes."
        read -rp "Use an application credential? [Y/n]: " USE_APPLICATION_CREDENTIAL
        case "${USE_APPLICATION_CREDENTIAL:-Y}" in
            [Yy]*) CREDENTIAL_KIND="application_credential" ;;
            *) CREDENTIAL_KIND="password" ;;
        esac
    fi
    if [ "$CREDENTIAL_KIND" = "application_credential" ]; then
        while [ -z "$OPENSTACK_APPLICATION_CREDENTIAL_ID" ]; do
            # -s: never echo it to the terminal.
            read -rsp "Application credential ID: " OPENSTACK_APPLICATION_CREDENTIAL_ID
            echo ""
        done
        while [ -z "$OPENSTACK_APPLICATION_CREDENTIAL_SECRET" ]; do
            # IFS=: as typed, with any space at either end.
            IFS= read -rsp "Application credential secret: " OPENSTACK_APPLICATION_CREDENTIAL_SECRET
            echo ""
        done
    else
        while [ -z "$OPENSTACK_USERNAME" ]; do
            read -rp "Username: " OPENSTACK_USERNAME
        done
        while [ -z "$OPENSTACK_PASSWORD" ]; do
            IFS= read -rsp "Password: " OPENSTACK_PASSWORD
            echo ""
        done
        while [ -z "$OPENSTACK_PROJECT_NAME" ]; do
            read -rp "Project name: " OPENSTACK_PROJECT_NAME
        done
        if [ -z "$OPENSTACK_USER_DOMAIN_NAME" ]; then
            read -rp "User domain name [Default]: " OPENSTACK_USER_DOMAIN_NAME
            OPENSTACK_USER_DOMAIN_NAME="${OPENSTACK_USER_DOMAIN_NAME:-Default}"
        fi
        if [ -z "$OPENSTACK_PROJECT_DOMAIN_NAME" ]; then
            read -rp "Project domain name [Default]: " OPENSTACK_PROJECT_DOMAIN_NAME
            OPENSTACK_PROJECT_DOMAIN_NAME="${OPENSTACK_PROJECT_DOMAIN_NAME:-Default}"
        fi
    fi
fi

# Asked on a fresh install only, where a person is answering: a re-run keeps what
# .env says, and a credential given in the environment is a run that asks nothing,
# which names a CA in the environment too if it has one.
if [ "$BUNDLED_EXPORTER" = 1 ] && [ -z "$OPENSTACK_CA_FILE" ] && [ "$REUSED_ENV" = 0 ] && [ "$CREDENTIAL_EXPORTED" = 0 ]; then
    case "$OPENSTACK_AUTH_URL" in
        https://*)
            read -rp "Private CA file (PEM), if this cloud's certificate comes from its own CA [none]: " OPENSTACK_CA_FILE
            read_ca_file
            ;;
    esac
fi

# ----------------------------------------------------------------------------
# Does Keystone accept it?
# ----------------------------------------------------------------------------
# Before anything is written or started, on a re-run too: a refused credential
# stops here, and an agent already running stays as it is. The credential reaches
# curl on stdin, never on its command line, where any local user could read it.
keystone_auth_body() {
    if [ "$CREDENTIAL_KIND" = "application_credential" ]; then
        printf '{"auth":{"identity":{"methods":["application_credential"],"application_credential":{"id":%s,"secret":%s}}}}' \
            "$(json_string "$OPENSTACK_APPLICATION_CREDENTIAL_ID")" \
            "$(json_string "$OPENSTACK_APPLICATION_CREDENTIAL_SECRET")"
    else
        printf '{"auth":{"identity":{"methods":["password"],"password":{"user":{"name":%s,"domain":{"name":%s},"password":%s}}},"scope":{"project":{"name":%s,"domain":{"name":%s}}}}}' \
            "$(json_string "$OPENSTACK_USERNAME")" \
            "$(json_string "$OPENSTACK_USER_DOMAIN_NAME")" \
            "$(json_string "$OPENSTACK_PASSWORD")" \
            "$(json_string "$OPENSTACK_PROJECT_NAME")" \
            "$(json_string "$OPENSTACK_PROJECT_DOMAIN_NAME")"
    fi
}

# The regions an answer's service catalog lists, one per line.
catalog_regions() {
    printf '%s' "$1" | tr ',{}' '\n\n\n' \
        | sed -n 's/^[[:space:]]*"region\(_id\)\{0,1\}"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\2/p' \
        | sort -u
}

check_keystone() {
    local answer="" status="" curl_exit=0 newline=$'\n' region regions
    echo ""
    echo "Checking the credential with Keystone at $OPENSTACK_AUTH_URL..."
    answer="$(keystone_auth_body | curl -sS --max-time 30 ${CA_SOURCE:+--cacert "$CA_SOURCE"} -X POST \
        -H "Content-Type: application/json" --data-binary @- \
        -w '\n%{http_code}' "$OPENSTACK_AUTH_URL/auth/tokens" 2>&1)" || curl_exit=$?
    status="${answer##*"$newline"}"
    case "$status" in
        200 | 201)
            regions="$(catalog_regions "$answer")"
            if [ -n "$regions" ]; then
                for region in "${REGIONS[@]}"; do
                    if ! printf '%s\n' "$regions" | grep -qxF "$region"; then
                        echo "Error: this cloud's service catalog has no region \"$region\". It lists:"
                        printf '%s\n' "$regions" | sed 's/^/  /'
                        echo "Region names are case sensitive. Nothing was installed or changed."
                        exit 1
                    fi
                done
            fi
            echo "Keystone accepted the credential."
            return 0
            ;;
        401)
            echo "Error: Keystone refused this credential (HTTP 401)."
            echo "The ID, secret or password is wrong, the credential has expired or been deleted, or"
            echo "its account lost its role on the project. Nothing was installed or changed."
            exit 1
            ;;
        403)
            echo "Error: Keystone refused this login (HTTP 403). The account may not use that project."
            echo "Nothing was installed or changed."
            exit 1
            ;;
        404)
            # What Keystone answers for an application credential it no longer has.
            case "$answer" in
                *[Aa]pplication\ [Cc]redential*)
                    echo "Error: Keystone has no such application credential (HTTP 404): it was deleted, or the ID is wrong."
                    echo "Make a new one (README.md, \"Access\"). Nothing was installed or changed."
                    exit 1
                    ;;
            esac
            echo "Error: nothing answers as Keystone at $OPENSTACK_AUTH_URL (HTTP 404). Check the auth URL:"
            echo "it is the identity endpoint, ending in /v3. Nothing was installed or changed."
            exit 1
            ;;
    esac
    case "$curl_exit" in
        0)
            echo "Error: Keystone answered HTTP $status at $OPENSTACK_AUTH_URL/auth/tokens, not a token."
            ;;
        6)
            echo "Error: this machine cannot resolve the host in $OPENSTACK_AUTH_URL (DNS)."
            ;;
        7)
            echo "Error: this machine could not connect to $OPENSTACK_AUTH_URL (refused, or no route)."
            ;;
        28)
            echo "Error: Keystone did not answer at $OPENSTACK_AUTH_URL in time."
            ;;
        35 | 51 | 58 | 60 | 77)
            echo "Error: the TLS check of $OPENSTACK_AUTH_URL failed: this machine does not trust its certificate."
            echo "If the certificate comes from the cloud's own CA, give that CA's file as OPENSTACK_CA_FILE."
            ;;
        *)
            echo "Error: could not ask Keystone at $OPENSTACK_AUTH_URL (curl exit $curl_exit)."
            ;;
    esac
    echo "Nothing was installed or changed. If Keystone is down for now, or only the containers"
    echo "can reach it, install anyway with OPENSTACK_SKIP_KEYSTONE_CHECK=true in the environment."
    exit 1
}

if [ "$BUNDLED_EXPORTER" = 1 ]; then
    if [ "$(printf '%s' "${OPENSTACK_SKIP_KEYSTONE_CHECK:-false}" | tr '[:upper:]' '[:lower:]')" = "true" ]; then
        echo ""
        echo "Skipping the check with Keystone (OPENSTACK_SKIP_KEYSTONE_CHECK)."
    elif ! credential_is_known; then
        echo ""
        echo "$CLOUDS_FILE holds no credential this script can read, so it was left as it is, unchecked."
    else
        check_keystone
    fi
fi

# The agent's container names (see "The agent's container names" above), with
# Docker: the collector's exported or in .env, checked, or else the one this
# directory's agent already has, or its directory's; then the others'. Then a
# directory of the same name that runs this directory's Compose project (see
# "The agent's Compose project" above) stops it, before anything changes.
CONTAINER_NAME_SOURCE=""
if [ "$RUNS_WITHOUT_DOCKER" = 0 ]; then
    if [ -n "$OPENSTACK_AGENT_CONTAINER_NAME" ]; then
        if ! is_container_name "$OPENSTACK_AGENT_CONTAINER_NAME"; then
            echo "Error: OPENSTACK_AGENT_CONTAINER_NAME=\"$OPENSTACK_AGENT_CONTAINER_NAME\" is not a container name: a letter"
            echo "or a digit, then letters, digits, _, . or - (e.g. $DEFAULT_CONTAINER_NAME-cloud2). Nothing was installed or changed."
            exit 1
        fi
    else
        choose_container_name
    fi
    choose_companion_container_names "$OPENSTACK_AGENT_CONTAINER_NAME"
    if [ "$OPENSTACK_AGENT_CONTAINER_NAME" != "$DEFAULT_CONTAINER_NAME" ]; then
        echo ""
        case "$CONTAINER_NAME_SOURCE" in
            "its directory")
                echo "The agent's containers are named after its directory, so they do not take the names of"
                echo "another cloud's agent on this machine: $OPENSTACK_AGENT_CONTAINER_NAME, and its exporters and"
                echo "AI agent beside it."
                ;;
            "")
                echo "The agent's containers are named as you gave them: $OPENSTACK_AGENT_CONTAINER_NAME"
                echo "(OPENSTACK_AGENT_CONTAINER_NAME), and its exporters and AI agent by theirs or beside it."
                ;;
            *)
                echo "The agent's containers keep their names, from $CONTAINER_NAME_SOURCE: $OPENSTACK_AGENT_CONTAINER_NAME,"
                echo "and its exporters and AI agent theirs."
                ;;
        esac
    fi

    OTHER_PROJECT_DIR="$(other_project_directory)"
    if [ -n "$OTHER_PROJECT_DIR" ]; then
        echo "Error: $OTHER_PROJECT_DIR already runs containers in the Docker Compose project"
        echo "\"$(compose_project_name)\": Compose names a project after its directory, and gives $INSTALL_DIR"
        echo "that name too. Installing here would recreate them and run this agent in their place. Install"
        echo "it into a directory of another name instead, e.g. INSTALL_DIR=$(absolute_install_dir)-2 bash install.sh"
        exit 1
    fi
fi

# Create installation directory
echo ""
echo "Installing to: $INSTALL_DIR"
if [ "$INSTALL_DIR_IS_IN_HOME" = 1 ]; then
    echo "This user has no rights on ${DEFAULT_INSTALL_DIR%/*}, so the agent goes in its home folder. It needs none:"
    echo "Docker runs it. Run this with sudo instead to put it in $DEFAULT_INSTALL_DIR."
fi
if ! mkdir -p "$INSTALL_DIR"; then
    echo "Error: could not create $INSTALL_DIR. Nothing was installed or changed."
    echo "Run this with sudo, or name a folder this user can write to: INSTALL_DIR=\$HOME/oneuptime-openstack-agent bash install.sh"
    exit 1
fi
# Root runs what this folder holds, so nobody else may change it, whatever this machine gives a
# new folder: on a GitHub runner it came out 777, even under a umask of 077.
chmod go-w "$INSTALL_DIR" 2>/dev/null || true

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
AGENT_FILES_PATH="install/openstack-agent"
AGENT_FILES_ON_GITHUB="https://raw.githubusercontent.com/OneUptime/oneuptime/main/agents/OpenStackAgent"
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

# ----------------------------------------------------------------------------
# Without Docker: the pinned releases and their units
# ----------------------------------------------------------------------------
RELEASE_WORK_DIR=""
trap '[ -z "$RELEASE_WORK_DIR" ] || rm -rf "$RELEASE_WORK_DIR"' EXIT

# download_release <url> <sha256> <binary>: the release archive, checked against
# its pinned sha256, unpacked in the work folder. Nothing is installed until
# every download is good.
download_release() {
    local url="$1" sha256="$2" binary="$3" archive actual
    archive="$RELEASE_WORK_DIR/$binary.tar.gz"
    echo "Downloading ${url##*/}..."
    if ! curl -fsSL --retry 3 -o "$archive" "$url"; then
        echo "Error: could not download $url"
        exit 1
    fi
    actual="$(file_sha256 "$archive")"
    if [ "$actual" != "$sha256" ]; then
        echo "Error: ${url##*/} does not match the sha256 this installer pins, so it was not installed."
        echo "  expected: $sha256"
        echo "  got:      $actual"
        exit 1
    fi
    tar --no-same-owner -xzf "$archive" -C "$RELEASE_WORK_DIR" "$binary"
    chmod 0755 "$RELEASE_WORK_DIR/$binary"
    release_runs_here "$binary"
}

# A release that passes its digest can still not run here. The exporter's is linked against
# a newer glibc than RHEL 8 has: on Rocky 8's 2.28 it asks for GLIBC_2.34 and exits, and systemd
# restarts it for ever with nothing to scrape. So each is run once before anything is installed,
# which on an upgrade leaves the running agent as it is.
release_runs_here() {
    local binary="$1" answer=""
    if answer="$("$RELEASE_WORK_DIR/$binary" --version 2>&1)"; then
        return 0
    fi
    echo "Error: the $binary release does not run on this machine, so nothing was installed or changed:"
    printf '%s\n' "$answer" | head -3 | sed 's/^/  /'
    case "$answer" in
        *GLIBC_*)
            echo "It needs glibc 2.34 or later, which RHEL 9, Ubuntu 22.04 and Debian 12 have. On this machine,"
            echo "install with Docker instead (bash install.sh), or name an exporter you already run with"
            echo "OPENSTACK_EXPORTER_ADDRESS: the collector's release runs here on its own."
            ;;
    esac
    exit 1
}

# install_unit <file> <service>: one of the agent's units where systemd reads it,
# edits kept as for any other file. The units name the default folder, so another
# one is written into the installed copy.
install_unit() {
    local file="$1" dest="$UNIT_DIR/$2.service" rendered
    download_agent_file "$file" "$dest"
    if [ "$INSTALL_DIR" != "$DEFAULT_INSTALL_DIR" ]; then
        rendered="$(mktemp "$dest.render.XXXXXX")"
        sed "s|$DEFAULT_INSTALL_DIR|$INSTALL_DIR|g" "$dest" > "$rendered"
        chmod 0644 "$rendered"
        mv -f "$rendered" "$dest"
        # What the record compares next time is what systemd reads.
        printf '%s  %s\n' "$(file_sha256 "$dest")" "$dest" >> "$AGENT_FILES_RECORD.new"
    fi
}

if [ "$RUNS_WITHOUT_DOCKER" = 1 ]; then
    # The services' users walk through this folder to the files they read.
    chmod 0755 "$INSTALL_DIR"
    RELEASE_WORK_DIR="$(mktemp -d "$INSTALL_DIR/.release.XXXXXX")"
    download_release \
        "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${COLLECTOR_VERSION}/otelcol-contrib_${COLLECTOR_VERSION}_linux_${RELEASE_ARCH}.tar.gz" \
        "$COLLECTOR_SHA256" "otelcol-contrib"
    if [ "$BUNDLED_EXPORTER" = 1 ]; then
        download_release \
            "https://github.com/openstack-exporter/openstack-exporter/releases/download/v${EXPORTER_VERSION}/openstack-exporter_${EXPORTER_VERSION}_linux_${RELEASE_ARCH}.tar.gz" \
            "$EXPORTER_SHA256" "openstack-exporter"
    fi
fi

# What install.sh had installed as docker-compose.yml, for
# only_container_names_edited once the download has replaced it.
INSTALLED_COMPOSE_SHA=""
if [ -f "$AGENT_FILES_RECORD" ]; then
    INSTALLED_COMPOSE_SHA="$(awk '$2 == "docker-compose.yml" { sha = $1 } END { print sha }' "$AGENT_FILES_RECORD")"
fi

# Download configuration files
echo "Downloading configuration files..."
rm -f "$AGENT_FILES_RECORD.new"
if [ "$RUNS_WITHOUT_DOCKER" = 1 ]; then
    download_agent_file "otel-collector-config.yaml" "$INSTALL_DIR/otel-collector-config.yaml"
    install_unit "systemd/oneuptime-openstack-agent-native.service" "$COLLECTOR_SERVICE"
    if [ "$BUNDLED_EXPORTER" = 1 ]; then
        install_unit "systemd/oneuptime-openstack-exporter-native.service" "$EXPORTER_SERVICE"
    fi
    if [ "$READS_QUOTAS" = 1 ]; then
        install_unit "systemd/oneuptime-openstack-quota-exporter-native.service" "$QUOTA_EXPORTER_SERVICE"
    fi
else
    download_agent_file "docker-compose.yml" "$INSTALL_DIR/docker-compose.yml"
    download_agent_file "otel-collector-config.yaml" "$INSTALL_DIR/otel-collector-config.yaml"
fi
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

if [ "$RUNS_WITHOUT_DOCKER" = 1 ]; then
    mv -f "$RELEASE_WORK_DIR/otelcol-contrib" "$INSTALL_DIR/otelcol-contrib"
    if [ "$BUNDLED_EXPORTER" = 1 ]; then
        mv -f "$RELEASE_WORK_DIR/openstack-exporter" "$INSTALL_DIR/openstack-exporter"
    fi
fi

# ----------------------------------------------------------------------------
# clouds.yaml: the credential, readable by the exporter alone
# ----------------------------------------------------------------------------
# One entry per region, NAMED FOR THE REGION: the exporter's series do not say
# which region they are from, and the collector stamps the entry's name on them.
# Every value is a YAML double-quoted scalar (json_string), so a secret reaches
# the exporter exactly as typed.
#
# Mode 0600 alone would lock the exporter out: its image runs as uid 65532, not as
# whoever ran this script. So the file belongs to the user the exporter runs as,
# and that is what OPENSTACK_EXPORTER_USER says in .env. Root can give the file to
# 65532. Any other user cannot, and the exporter runs as that user instead. Rootless
# Docker maps the container's root to the user who started it, so there it is 0:0.
if [ "$BUNDLED_EXPORTER" = 1 ] && [ "$RUNS_WITHOUT_DOCKER" = 0 ] && [ -z "$OPENSTACK_EXPORTER_USER" ]; then
    if [ "$(id -u)" = "0" ]; then
        OPENSTACK_EXPORTER_USER="65532:65532"
    elif docker info --format '{{.SecurityOptions}}' 2>/dev/null | grep -q rootless; then
        OPENSTACK_EXPORTER_USER="0:0"
    else
        OPENSTACK_EXPORTER_USER="$(id -u):$(id -g)"
    fi
fi
case "$OPENSTACK_EXPORTER_USER" in
    *[!0-9:]*)
        echo "Error: OPENSTACK_EXPORTER_USER must be a uid:gid, not: $OPENSTACK_EXPORTER_USER"
        exit 1
        ;;
esac

if [ "$RUNS_WITHOUT_DOCKER" = 1 ] && [ "$BUNDLED_EXPORTER" = 1 ]; then
    if ! id "$EXPORTER_SYSTEM_USER" >/dev/null 2>&1; then
        useradd --system --user-group --no-create-home --shell /usr/sbin/nologin "$EXPORTER_SYSTEM_USER"
    fi
fi

# give_clouds_file_to_the_exporter <file>: readable by that user alone.
give_clouds_file_to_the_exporter() {
    chmod 600 "$1"
    if [ "$(id -u)" = "0" ]; then
        if [ "$RUNS_WITHOUT_DOCKER" = 1 ]; then
            chown "$EXPORTER_SYSTEM_USER:$EXPORTER_SYSTEM_USER" "$1"
        else
            chown "$OPENSTACK_EXPORTER_USER" "$1"
        fi
    fi
}

write_clouds_file() {
    local tmp="" region="" backup=""
    tmp="$(mktemp "$INSTALL_DIR/.clouds.yaml.XXXXXX")"
    chmod 600 "$tmp"
    {
        echo "# Written by install.sh. One entry per region, named for the region: the"
        echo "# collector stamps the entry's name on the exporter's series as the region."
        echo "clouds:"
        for region in "${REGIONS[@]}"; do
            printf '  %s:\n' "$(json_string "$region")"
            printf '    region_name: %s\n' "$(json_string "$region")"
            printf '    identity_api_version: 3\n'
            if [ -n "$EXPECTED_CACERT" ]; then
                printf '    cacert: %s\n' "$(json_string "$EXPECTED_CACERT")"
            fi
            if [ "$CREDENTIAL_KIND" = "application_credential" ]; then
                printf '    auth_type: v3applicationcredential\n'
                printf '    auth:\n'
                printf '      auth_url: %s\n' "$(json_string "$OPENSTACK_AUTH_URL")"
                printf '      application_credential_id: %s\n' "$(json_string "$OPENSTACK_APPLICATION_CREDENTIAL_ID")"
                printf '      application_credential_secret: %s\n' "$(json_string "$OPENSTACK_APPLICATION_CREDENTIAL_SECRET")"
            else
                printf '    auth_type: v3password\n'
                printf '    auth:\n'
                printf '      auth_url: %s\n' "$(json_string "$OPENSTACK_AUTH_URL")"
                printf '      username: %s\n' "$(json_string "$OPENSTACK_USERNAME")"
                printf '      password: %s\n' "$(json_string "$OPENSTACK_PASSWORD")"
                printf '      project_name: %s\n' "$(json_string "$OPENSTACK_PROJECT_NAME")"
                printf '      user_domain_name: %s\n' "$(json_string "$OPENSTACK_USER_DOMAIN_NAME")"
                printf '      project_domain_name: %s\n' "$(json_string "$OPENSTACK_PROJECT_DOMAIN_NAME")"
            fi
        done
    } > "$tmp"
    if [ -f "$CLOUDS_FILE" ] && cmp -s "$tmp" "$CLOUDS_FILE"; then
        rm -f "$tmp"
        return 0
    fi
    # What this replaces may hold edits, and always holds the old credential, so
    # it is kept as privately as it was and named at the end.
    if [ -f "$CLOUDS_FILE" ]; then
        backup="$CLOUDS_FILE.bak.$(date +%Y%m%d%H%M%S)"
        cp -p "$CLOUDS_FILE" "$backup"
        CLOUDS_BACKUP="$backup"
    fi
    give_clouds_file_to_the_exporter "$tmp"
    mv -f "$tmp" "$CLOUDS_FILE"
}

CLOUDS_BACKUP=""
if [ -n "$CA_SOURCE" ]; then
    if ! cmp -s "$CA_SOURCE" "$INSTALL_DIR/ca.pem"; then
        cp "$CA_SOURCE" "$INSTALL_DIR/ca.pem"
    fi
    chmod 0644 "$INSTALL_DIR/ca.pem"
    OPENSTACK_CA_FILE="./ca.pem"
fi
if [ "$WRITE_CLOUDS_FILE" = 1 ]; then
    write_clouds_file
elif [ "$BUNDLED_EXPORTER" = 1 ]; then
    give_clouds_file_to_the_exporter "$CLOUDS_FILE"
fi

# Create .env file. It holds the ingestion key, so it is created owner-read-only
# before anything is written to it. Every user-supplied value is quoted for what
# reads the file (see compose_env_quote and systemd_env_quote); the exporter's
# user is a validated shape and stays bare.
env_value() {
    if [ "$RUNS_WITHOUT_DOCKER" = 1 ]; then
        systemd_env_quote "$1"
    else
        compose_env_quote "$1"
    fi
}

touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
cat > "$ENV_FILE" <<ENVEOF
ONEUPTIME_URL=$(env_value "$ONEUPTIME_URL")
ONEUPTIME_TELEMETRY_INGESTION_KEY=$(env_value "$ONEUPTIME_TELEMETRY_INGESTION_KEY")
OPENSTACK_CLOUD_NAME=$(env_value "$OPENSTACK_CLOUD_NAME")
OPENSTACK_AUTH_URL=$(env_value "$OPENSTACK_AUTH_URL")
OPENSTACK_EXPORTER_CLOUDS=$(env_value "$OPENSTACK_EXPORTER_CLOUDS")
OPENSTACK_EXPORTER_ADDRESS=$(env_value "$OPENSTACK_EXPORTER_ADDRESS")
OPENSTACK_EXPORTER_USER=$OPENSTACK_EXPORTER_USER
OPENSTACK_CA_FILE=$(env_value "$OPENSTACK_CA_FILE")
COMPOSE_PROFILES=$(env_value "$COMPOSE_PROFILES")
OPENSTACK_COLLECT_QUOTAS=$(env_value "$OPENSTACK_COLLECT_QUOTAS")
OPENSTACK_QUOTA_CLOUDS=$(env_value "$OPENSTACK_QUOTA_CLOUDS")
OPENSTACK_QUOTA_EXPORTER_ADDRESS=$(env_value "$OPENSTACK_QUOTA_EXPORTER_ADDRESS")
OPENSTACK_CONTROL_PLANE_REGION=$(env_value "$OPENSTACK_CONTROL_PLANE_REGION")
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=$(env_value "$OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS")
ENVEOF
for name in $TARGET_LIST_NAMES; do
    printf '%s=%s\n' "$name" "$(env_value "${!name}")" >> "$ENV_FILE"
done
# Only when set: an empty one would overrule the default each runs with.
for name in $VERY_LARGE_CLOUD_NAMES $AI_AGENT_NAMES; do
    if [ -n "${!name:-}" ]; then
        printf '%s=%s\n' "$name" "$(env_value "${!name}")" >> "$ENV_FILE"
    fi
done
# The containers' names, with Docker (CONTAINER_NAME_NAMES).
if [ "$RUNS_WITHOUT_DOCKER" = 0 ]; then
    cat >> "$ENV_FILE" <<CONTAINER_NAMES_EOF
OPENSTACK_AGENT_CONTAINER_NAME=$(compose_env_quote "$OPENSTACK_AGENT_CONTAINER_NAME")
OPENSTACK_EXPORTER_CONTAINER_NAME=$(compose_env_quote "$OPENSTACK_EXPORTER_CONTAINER_NAME")
OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME=$(compose_env_quote "$OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME")
OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME=$(compose_env_quote "$OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME")
OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME=$(compose_env_quote "$OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME")
OPENSTACK_AI_AGENT_CONTAINER_NAME=$(compose_env_quote "$OPENSTACK_AI_AGENT_CONTAINER_NAME")
CONTAINER_NAMES_EOF
fi
chmod 600 "$ENV_FILE"

# Start the agent
echo ""
echo "Starting OneUptime OpenStack Agent..."
if [ "$RUNS_WITHOUT_DOCKER" = 1 ]; then
    systemctl daemon-reload
    if [ "$BUNDLED_EXPORTER" = 1 ]; then
        systemctl enable "$EXPORTER_SERVICE"
        systemctl restart "$EXPORTER_SERVICE"
    else
        systemctl disable --now "$EXPORTER_SERVICE" >/dev/null 2>&1 || true
    fi
    if [ "$READS_QUOTAS" = 1 ]; then
        systemctl enable "$QUOTA_EXPORTER_SERVICE"
        systemctl restart "$QUOTA_EXPORTER_SERVICE"
    else
        systemctl disable --now "$QUOTA_EXPORTER_SERVICE" >/dev/null 2>&1 || true
    fi
    systemctl enable "$COLLECTOR_SERVICE"
    systemctl restart "$COLLECTOR_SERVICE"
else
    cd "$INSTALL_DIR"
    # Pull first, so a re-run moves images to the pins it just downloaded. A
    # failed pull (a host without registry access, its images loaded by hand) is
    # not fatal: `up` still pulls any image this machine does not have.
    if ! docker compose pull; then
        echo "Warning: could not pull the latest images; starting with the ones this machine has."
    fi
    # --force-recreate, because running this again on an installed agent is how
    # it picks up new files: Compose recreates a running container only when its
    # service definition or environment changed, never for a new
    # otel-collector-config.yaml or clouds.yaml (bind mounts), and the collector
    # reads its config only when it starts. A plain `up -d` would keep the old
    # config — and the old oneuptime.agent.version — running after the new one
    # arrived.
    if ! docker compose up -d --force-recreate; then
        echo ""
        echo "Error: the agent did not start. If Docker reports that a container name is already in"
        echo "use (\"$OPENSTACK_AGENT_CONTAINER_NAME\", or one of its exporters' or its AI agent's), another container"
        echo "on this machine has it (another cloud's agent, say): give this agent names of its own and run this"
        echo "again, e.g."
        echo "  OPENSTACK_AGENT_CONTAINER_NAME=$DEFAULT_CONTAINER_NAME-<cloud> INSTALL_DIR=$INSTALL_DIR bash install.sh"
        echo "(its exporters and AI agent are named beside it, or by their own variables in $ENV_FILE)."
        echo "They are kept in $ENV_FILE from then on (see README.md, \"Monitoring several clouds\")."
        exit 1
    fi
fi

echo ""
echo "=========================================="
echo "  OneUptime OpenStack Agent is running!"
echo "=========================================="
echo ""
echo "The cloud appears in OneUptime as \"$OPENSTACK_CLOUD_NAME\" after the first scrapes, within a few minutes."
echo ""

DOCTOR_ARGUMENTS=""
if [ "$INSTALL_DIR" != "$DEFAULT_INSTALL_DIR" ]; then
    DOCTOR_ARGUMENTS=" -s -- -d $INSTALL_DIR"
fi
if [ "$RUNS_WITHOUT_DOCKER" = 1 ]; then
    echo "To check status:  systemctl status $COLLECTOR_SERVICE $EXPORTER_SERVICE --no-pager"
    echo "To view logs:     journalctl -u $COLLECTOR_SERVICE -u $EXPORTER_SERVICE -f"
    echo "To stop:          systemctl stop $COLLECTOR_SERVICE $EXPORTER_SERVICE"
    echo "To restart:       systemctl restart $EXPORTER_SERVICE $COLLECTOR_SERVICE"
else
    echo "To check status:  cd $INSTALL_DIR && docker compose ps"
    echo "To view logs:     cd $INSTALL_DIR && docker compose logs -f"
    echo "To stop:          cd $INSTALL_DIR && docker compose down"
    echo "To restart:       cd $INSTALL_DIR && docker compose restart"
fi
echo "To upgrade:       run this installer again; it reuses $ENV_FILE"
echo "If nothing shows up: curl -fsSL $AGENT_FILES_URL/troubleshoot.sh | bash$DOCTOR_ARGUMENTS"
echo "That script also says what this credential can read, what each gap costs, and whether"
echo "its project holds anything it might be able to write to."

if [ "$SINGLE_CLOUD_EXPORTER" = 1 ]; then
    echo ""
    echo "NOTE: the agent reads your exporter at $OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS on /metrics, for region"
    echo "$OPENSTACK_CONTROL_PLANE_REGION. Exporter 1.7.0 says less than the bundled one: README.md says what the pages go without."
elif [ "$READS_DATABASES" = 1 ]; then
    echo ""
    echo "NOTE: the agent reads this cloud from its databases, at $OPENSTACK_DATABASE_EXPORTER_TARGETS, for region $OPENSTACK_CONTROL_PLANE_REGION."
    if [ -n "$OPENSTACK_WORKER_STATE_CLOUDS" ]; then
        echo "From the APIs it reads only what a database cannot say, in $OPENSTACK_WORKER_STATE_CLOUDS: whether each Nova"
        echo "worker is alive, and how full each storage pool is."
    else
        echo "Nothing says whether each Nova worker is alive, or how full each storage pool is: a database says neither."
        echo "Set OPENSTACK_WORKER_STATE_CLOUDS in $ENV_FILE to the entries of clouds.yaml to read them from,"
        echo "such as [${REGIONS[0]}], and run this again."
    fi
elif [ "$BUNDLED_EXPORTER" = 0 ]; then
    echo ""
    echo "NOTE: the agent reads your exporter at $OPENSTACK_EXPORTER_ADDRESS. It must run with --multi-cloud, and"
    echo "its clouds.yaml needs an entry named for each region: $OPENSTACK_EXPORTER_CLOUDS."
    echo "Started without --multi-cloud, as Kolla-Ansible starts it? Set OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS instead."
fi

if [ "$READS_QUOTAS" = 1 ]; then
    echo ""
    echo "NOTE: each project's quotas are read once an hour, by an exporter of their own: four API"
    echo "calls per project, per region, on each read. The first read is within the hour."
elif [ "$OPENSTACK_COLLECT_QUOTAS" = "true" ]; then
    echo ""
    echo "NOTE: OPENSTACK_COLLECT_QUOTAS reads quotas with an exporter this agent starts, and this agent"
    echo "reads yours, so it is left off. Yours reads them on every scrape unless its flags leave them out."
fi

if [ "${#EDITED_FILES[@]}" -gt 0 ]; then
    echo ""
    echo "NOTE: you had edited these files since install.sh installed them. They were replaced"
    echo "by the current versions; your copies are kept next to them:"
    for backup in "${EDITED_FILES[@]}"; do
        echo "  $backup"
    done
    echo "Re-apply your edits (the slow metrics, the per-port series, the intervals) to the new files, then:"
    if [ "$RUNS_WITHOUT_DOCKER" = 1 ]; then
        echo "systemctl daemon-reload && systemctl restart $EXPORTER_SERVICE $COLLECTOR_SERVICE"
    else
        echo "cd $INSTALL_DIR && docker compose up -d --force-recreate"
    fi
fi
if [ "${#DIFFERING_FILES[@]}" -gt 0 ]; then
    echo ""
    echo "NOTE: these files differ from the new versions and were replaced. There was no record"
    echo "of what install.sh had installed, so they may hold edits of yours; the old copies are"
    echo "kept next to them:"
    for backup in "${DIFFERING_FILES[@]}"; do
        echo "  $backup"
    done
    if [ "$RUNS_WITHOUT_DOCKER" = 1 ]; then
        echo "If they do, apply the same edits to the new files, then: systemctl daemon-reload && systemctl restart $EXPORTER_SERVICE $COLLECTOR_SERVICE"
    else
        echo "If they do, apply the same edits to the new files, then: cd $INSTALL_DIR && docker compose up -d --force-recreate"
    fi
fi
if [ -n "$RENAMED_COMPOSE_BACKUP" ]; then
    echo ""
    echo "Your docker-compose.yml gave the agent's containers names of their own, the one change you"
    echo "had made to it. The new docker-compose.yml reads the names from .env"
    echo "(OPENSTACK_AGENT_CONTAINER_NAME and the others), so there is nothing to make again."
    echo "Your copy is kept: $RENAMED_COMPOSE_BACKUP"
elif [ "$CONTAINER_NAME_SOURCE" = "its docker-compose.yml" ]; then
    echo ""
    echo "The new docker-compose.yml reads the containers' names from .env (OPENSTACK_AGENT_CONTAINER_NAME"
    echo "and the others): leave their container_name lines as they are when you make your other"
    echo "changes again."
fi
if [ -n "$CLOUDS_BACKUP" ]; then
    echo ""
    echo "NOTE: clouds.yaml changed. The old one is kept as $CLOUDS_BACKUP, as private as it was."
    echo "It holds the old credential: delete it once the agent reports with the new file."
fi
