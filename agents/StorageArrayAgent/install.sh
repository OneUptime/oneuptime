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

# The same for a value that may hold a $ (an SNMP community: OneFS's default is
# I$ilonpublic): only $$ and ${, which the collector would rewrite, are refused.
reject_collector_expansion() {
    case "$2" in
        *\$\$* | *\$\{*)
            echo "Error: $1 must not contain \$\$ or \${ (the collector would rewrite them)."
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
#   5  the .env variable holding the read-only user's API token, or the
#      password of the user field 10 names
#   6  whether the agent itself talks TLS to the array (yes / no): the
#      collector, or an exporter that logs in to the array itself (NetApp
#      Harvest). Only then is the certificate question asked
#   7  what the array is called in a sentence
#   8  the menu's line for it
#   9  how the agent reads it, for the last message
#  10  for an exporter that logs in to the array itself with a user and a
#      password: the .env variable holding the user's name (- for an API
#      token, which the collector sends). The collector never reads that
#      password, so it may hold a $.
#  11  the files it runs with besides its collector config, shipped next to
#      this script (- for none)
#  12  the optional .env settings it reads, which a re-run keeps (- for none)
#  13  optional: a setup step of the platform's own (a function below), run
#      before the address and token are asked for; it asks in its own words
#      and for settings of its own, and the generic questions then ask only
#      for what it left empty (- for none)
#
# The Dashboard's setup guide offers the same platforms (each platform's
# StorageArrayPlatform.agentConfigs); StorageArrayAgentPlatforms.test.ts
# holds the two lists in step.
PLATFORMS="
otel-collector-config.yaml|purestorage.flasharray|-|PURE_FA_ENDPOINT|PURE_FA_API_TOKEN|yes|FlashArray|Pure Storage FlashArray serving OpenMetrics itself (Purity//FA 6.7 and later)|directly (native OpenMetrics)|-|-|-|-
otel-collector-config.flasharray-exporter.yaml|purestorage.flasharray|flasharray-exporter|PURE_FA_ENDPOINT|PURE_FA_API_TOKEN|no|FlashArray|Pure Storage FlashArray on an older Purity//FA (through Pure's exporter)|through Pure's exporter (pure-fa-exporter)|-|-|-|-
otel-collector-config.flashblade.yaml|purestorage.flashblade|flashblade|PURE_FB_ENDPOINT|PURE_FB_API_TOKEN|no|FlashBlade|Pure Storage FlashBlade (through Pure's exporter)|through Pure's exporter (pure-fb-exporter)|-|-|-|-
otel-collector-config.powerstore.yaml|dell.powerstore|powerstore|POWERSTORE_ENDPOINT|POWERSTORE_PASSWORD|no|PowerStore|Dell PowerStore (through Dell's exporter, with its alerts by syslog)|through Dell's exporter (powerstore-exporter). Its alerts arrive once the PowerStore's remote logging points at this machine, port 5514 (see README.md)|POWERSTORE_USERNAME|powerstore-exporter.Dockerfile powerstore-syslog.yaml|POWERSTORE_BULK_METRICS POWERSTORE_API_VERSION POWERSTORE_REQUEST_LIMIT POWERSTORE_SYSLOG_PORT|-
otel-collector-config.netapp-ontap.yaml|netapp.ontap|netapp-ontap|NETAPP_ONTAP_ENDPOINT|NETAPP_ONTAP_PASSWORD|yes|ONTAP cluster|NetApp ONTAP 9.12.1 or later, or Amazon FSx for NetApp ONTAP (through NetApp Harvest)|through NetApp Harvest (netapp-harvest)|NETAPP_ONTAP_USERNAME|netapp-harvest.yml netapp-harvest-rest.yaml netapp-harvest-keyperf.yaml netapp-harvest-restperf.yaml|-|-
otel-collector-config.powerscale.yaml|dell.powerscale|-|POWERSCALE_ENDPOINT|POWERSCALE_SNMP_COMMUNITY|no|PowerScale cluster|Dell PowerScale (Isilon), polled over SNMP|over SNMP (ISILON-MIB)|-|-|-|setup_powerscale
"

# The table's lines, without the blank ones.
platform_lines() {
    printf '%s\n' "$PLATFORMS" | grep -v '^[[:space:]]*$'
}

# platform_field <line> <n>: one field of a line of the table.
platform_field() {
    printf '%s' "$1" | cut -d '|' -f "$2"
}

# ----------------------------------------------------------------------------
# Setup steps of a platform's own (the table's tenth field)
# ----------------------------------------------------------------------------
# A step may fill the address and token variables itself, set
# TOKEN_REQUIRED=no when the platform reads no token (TOKEN_MAY_HOLD_DOLLAR=yes
# when its token may hold a $, which it checks itself), list the variables of
# its own it writes to .env in PLATFORM_EXTRA_VARIABLES, and say how it reads
# the array in PLATFORM_SUMMARY. It reuses its own settings from .env.
TOKEN_REQUIRED="yes"
TOKEN_MAY_HOLD_DOLLAR="no"
PLATFORM_EXTRA_VARIABLES=""
PLATFORM_SUMMARY=""

# A variable of a setup step's own, from .env when the shell does not set it.
reuse_from_env_file() {
    local name
    for name; do
        if [ -z "${!name}" ] && [ -f "$ENV_FILE" ]; then
            printf -v "$name" '%s' "$(dotenv_get "$name" "$ENV_FILE")"
        fi
    done
}

# Dell PowerScale (otel-collector-config.powerscale.yaml): ISILON-MIB's node
# objects - a node's health, drives, sensors, ports and protocol performance
# - describe only the node that answers, so the agent polls every node with a
# receiver of its own, slots snmp/node-1 to snmp/node-252 of the config.
# POWERSCALE_NODES lists the nodes' addresses; the first answers for the
# cluster too (POWERSCALE_ENDPOINT), unless that is set. SNMP v2c with a
# read-only community, or v3 with a user (POWERSCALE_SNMP_VERSION=v3).
POWERSCALE_MAX_NODES=252
setup_powerscale() {
    local node address count list receivers nodes
    reuse_from_env_file POWERSCALE_NODES POWERSCALE_SNMP_VERSION \
        POWERSCALE_SNMP_USER POWERSCALE_SNMP_SECURITY_LEVEL \
        POWERSCALE_SNMP_AUTH_PROTOCOL POWERSCALE_SNMP_AUTH_PASSWORD \
        POWERSCALE_SNMP_PRIVACY_PROTOCOL POWERSCALE_SNMP_PRIVACY_PASSWORD

    if [ -z "$POWERSCALE_NODES" ]; then
        echo "The agent polls each node of the cluster over SNMP: a node answers for its own"
        echo "drives, sensors and ports. Use each node's own address, not the SmartConnect name."
        while [ -z "$POWERSCALE_NODES" ]; do
            if [ -n "$POWERSCALE_ENDPOINT" ]; then
                read -rp "Every node's address, separated by commas [$POWERSCALE_ENDPOINT]: " POWERSCALE_NODES
                POWERSCALE_NODES="${POWERSCALE_NODES:-$POWERSCALE_ENDPOINT}"
            else
                read -rp "Every node's address, separated by commas (e.g. 10.20.0.11,10.20.0.12): " POWERSCALE_NODES
            fi
        done
    fi
    reject_dollar POWERSCALE_NODES "$POWERSCALE_NODES"

    # One receiver slot per node, each address once, IPv6 in brackets.
    count=0
    list=""
    receivers="snmp/cluster, snmp/quotas"
    IFS=',' read -ra nodes <<< "$POWERSCALE_NODES"
    for node in "${nodes[@]}"; do
        address="$(normalize_endpoint "$node")"
        address="${address#[}"
        address="${address%]}"
        if [ -z "$address" ]; then
            continue
        fi
        case "$address" in
            *:*:*) ;;
            *:*)
                echo "Error: \"$address\" in POWERSCALE_NODES names a port: OneFS answers SNMP on"
                echo "port 161 only, so give each node's address alone."
                exit 1
                ;;
        esac
        case ",$list," in
            *",$address,"*) continue ;;
        esac
        count=$((count + 1))
        if [ "$count" -gt "$POWERSCALE_MAX_NODES" ]; then
            echo "Error: POWERSCALE_NODES lists more than $POWERSCALE_MAX_NODES nodes, OneFS's largest cluster."
            exit 1
        fi
        case "$address" in
            *:*) printf -v "POWERSCALE_NODE_$count" '[%s]' "$address" ;;
            *) printf -v "POWERSCALE_NODE_$count" '%s' "$address" ;;
        esac
        list="${list:+$list,}$address"
        receivers="$receivers, snmp/node-$count"
        PLATFORM_EXTRA_VARIABLES="$PLATFORM_EXTRA_VARIABLES POWERSCALE_NODE_$count"
    done
    if [ "$count" -eq 0 ]; then
        echo "Error: POWERSCALE_NODES names no node address."
        exit 1
    fi
    POWERSCALE_NODES="$list"
    POWERSCALE_SNMP_RECEIVERS="[$receivers]"
    # The cluster's own objects are read through the first node.
    if [ -z "$POWERSCALE_ENDPOINT" ]; then
        POWERSCALE_ENDPOINT="$POWERSCALE_NODE_1"
    else
        POWERSCALE_ENDPOINT="$(normalize_endpoint "$POWERSCALE_ENDPOINT")"
        POWERSCALE_ENDPOINT="${POWERSCALE_ENDPOINT#[}"
        POWERSCALE_ENDPOINT="${POWERSCALE_ENDPOINT%]}"
        case "$POWERSCALE_ENDPOINT" in
            *:*:*) POWERSCALE_ENDPOINT="[$POWERSCALE_ENDPOINT]" ;;
        esac
    fi

    if [ -z "$POWERSCALE_SNMP_VERSION" ]; then
        read -rp "SNMP version the cluster answers, 2c or 3 [2c]: " POWERSCALE_SNMP_VERSION
    fi
    case "$(printf '%s' "${POWERSCALE_SNMP_VERSION:-v2c}" | tr '[:upper:]' '[:lower:]')" in
        v2c | 2c | 2) POWERSCALE_SNMP_VERSION="v2c" ;;
        v3 | 3) POWERSCALE_SNMP_VERSION="v3" ;;
        *)
            echo "Error: POWERSCALE_SNMP_VERSION must be v2c or v3."
            exit 1
            ;;
    esac
    POWERSCALE_SNMP_SECURITY_LEVEL="$(printf '%s' "${POWERSCALE_SNMP_SECURITY_LEVEL:-auth_priv}" | tr '[:upper:]' '[:lower:]')"
    case "$POWERSCALE_SNMP_SECURITY_LEVEL" in
        auth_priv | auth_no_priv | no_auth_no_priv) ;;
        *)
            echo "Error: POWERSCALE_SNMP_SECURITY_LEVEL must be auth_priv, auth_no_priv or no_auth_no_priv."
            exit 1
            ;;
    esac
    POWERSCALE_SNMP_AUTH_PROTOCOL="$(printf '%s' "${POWERSCALE_SNMP_AUTH_PROTOCOL:-SHA}" | tr '[:lower:]' '[:upper:]')"
    case "$POWERSCALE_SNMP_AUTH_PROTOCOL" in
        MD5 | SHA | SHA224 | SHA256 | SHA384 | SHA512) ;;
        *)
            echo "Error: POWERSCALE_SNMP_AUTH_PROTOCOL must be MD5, SHA, SHA224, SHA256, SHA384 or SHA512."
            exit 1
            ;;
    esac
    POWERSCALE_SNMP_PRIVACY_PROTOCOL="$(printf '%s' "${POWERSCALE_SNMP_PRIVACY_PROTOCOL:-AES}" | tr '[:lower:]' '[:upper:]')"
    case "$POWERSCALE_SNMP_PRIVACY_PROTOCOL" in
        DES | AES | AES192 | AES256 | AES192C | AES256C) ;;
        *)
            echo "Error: POWERSCALE_SNMP_PRIVACY_PROTOCOL must be DES, AES, AES192, AES256, AES192C or AES256C."
            exit 1
            ;;
    esac

    if [ "$POWERSCALE_SNMP_VERSION" = "v3" ]; then
        # SNMPv3 reads no community.
        TOKEN_REQUIRED="no"
        while [ -z "$POWERSCALE_SNMP_USER" ]; do
            read -rp "SNMPv3 user the cluster answers (isi snmp settings view): " POWERSCALE_SNMP_USER
        done
        if [ "$POWERSCALE_SNMP_SECURITY_LEVEL" != "no_auth_no_priv" ]; then
            while [ -z "$POWERSCALE_SNMP_AUTH_PASSWORD" ]; do
                # -s: never echo a password to the terminal.
                read -rsp "SNMPv3 authentication password ($POWERSCALE_SNMP_AUTH_PROTOCOL): " POWERSCALE_SNMP_AUTH_PASSWORD
                echo ""
            done
        fi
        if [ "$POWERSCALE_SNMP_SECURITY_LEVEL" = "auth_priv" ]; then
            while [ -z "$POWERSCALE_SNMP_PRIVACY_PASSWORD" ]; do
                read -rsp "SNMPv3 privacy password ($POWERSCALE_SNMP_PRIVACY_PROTOCOL): " POWERSCALE_SNMP_PRIVACY_PASSWORD
                echo ""
            done
        fi
    else
        while [ -z "$POWERSCALE_SNMP_COMMUNITY" ]; do
            read -rsp "Read-only SNMP community of the PowerScale cluster: " POWERSCALE_SNMP_COMMUNITY
            echo ""
        done
    fi
    reject_dollar POWERSCALE_SNMP_USER "$POWERSCALE_SNMP_USER"
    TOKEN_MAY_HOLD_DOLLAR="yes"
    reject_collector_expansion POWERSCALE_SNMP_COMMUNITY "$POWERSCALE_SNMP_COMMUNITY"
    reject_collector_expansion POWERSCALE_SNMP_AUTH_PASSWORD "$POWERSCALE_SNMP_AUTH_PASSWORD"
    reject_collector_expansion POWERSCALE_SNMP_PRIVACY_PASSWORD "$POWERSCALE_SNMP_PRIVACY_PASSWORD"

    # Written to .env in this order, each a value, never an empty default.
    PLATFORM_EXTRA_VARIABLES="POWERSCALE_SNMP_VERSION POWERSCALE_SNMP_USER POWERSCALE_SNMP_SECURITY_LEVEL POWERSCALE_SNMP_AUTH_PROTOCOL POWERSCALE_SNMP_AUTH_PASSWORD POWERSCALE_SNMP_PRIVACY_PROTOCOL POWERSCALE_SNMP_PRIVACY_PASSWORD POWERSCALE_NODES POWERSCALE_SNMP_RECEIVERS$PLATFORM_EXTRA_VARIABLES"
    if [ "$count" -eq 1 ]; then
        PLATFORM_SUMMARY="Polling 1 node over SNMP $POWERSCALE_SNMP_VERSION: $list."
    else
        PLATFORM_SUMMARY="Polling $count nodes over SNMP $POWERSCALE_SNMP_VERSION: $(printf '%s' "$list" | sed 's/,/, /g')."
    fi
}

# Every collector config, every address, token, user and optional variable,
# every other file and every exporter's profile, each once, in the table's
# order.
PLATFORM_CONFIGS="$(platform_lines | cut -d '|' -f 1 | awk '!seen[$0]++' | tr '\n' ' ')"
PLATFORM_CONFIGS="${PLATFORM_CONFIGS% }"
PLATFORM_VARIABLES="$(platform_lines | cut -d '|' -f 4,5,10,12 | tr '|' '\n' | tr ' ' '\n' | grep -v '^-$' | grep -v '^$' | awk '!seen[$0]++' | tr '\n' ' ')"
PLATFORM_VARIABLES="${PLATFORM_VARIABLES% }"
PLATFORM_FILES="$(platform_lines | cut -d '|' -f 11 | tr ' ' '\n' | grep -v '^-$' | grep -v '^$' | awk '!seen[$0]++' | tr '\n' ' ')"
PLATFORM_FILES="${PLATFORM_FILES% }"
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
if [ "$USER_VARIABLE" = "-" ]; then
    USER_VARIABLE=""
fi
PLATFORM_SETUP="$(platform_field "$PLATFORM_LINE" 13)"

while [ -z "$STORAGE_ARRAY_NAME" ]; do
    read -rp "Array name (shown in OneUptime, keep it stable, e.g. fa-prod-01): " STORAGE_ARRAY_NAME
done
reject_dollar STORAGE_ARRAY_NAME "$STORAGE_ARRAY_NAME"

# The platform's own setup step, when the table names one.
if [ -n "$PLATFORM_SETUP" ] && [ "$PLATFORM_SETUP" != "-" ]; then
    if ! declare -F "$PLATFORM_SETUP" > /dev/null; then
        echo "Error: this installer has no setup step $PLATFORM_SETUP."
        exit 1
    fi
    "$PLATFORM_SETUP"
fi

# The address and token (or user and password) go in the variables this
# platform's config reads.
while [ -z "${!ENDPOINT_VARIABLE}" ]; do
    read -rp "$ARRAY_NOUN management address (host name or IP, no https://): " "$ENDPOINT_VARIABLE"
done
printf -v "$ENDPOINT_VARIABLE" '%s' "$(normalize_endpoint "${!ENDPOINT_VARIABLE}")"
reject_dollar "$ENDPOINT_VARIABLE" "${!ENDPOINT_VARIABLE}"
if [ -n "$USER_VARIABLE" ]; then
    # The exporter logs in with a user and a password, which only it reads
    # (from .env, through Compose): the collector never sees them, so they
    # may hold a $.
    while [ -z "${!USER_VARIABLE}" ]; do
        read -rp "User name the agent logs in to the $ARRAY_NOUN with (see README.md for its role): " "$USER_VARIABLE"
    done
    while [ -z "${!TOKEN_VARIABLE}" ]; do
        # -s: never echo the password to the terminal.
        read -rsp "That user's password: " "$TOKEN_VARIABLE"
        echo ""
    done
else
    while [ "$TOKEN_REQUIRED" = "yes" ] && [ -z "${!TOKEN_VARIABLE}" ]; do
        # -s: never echo the token to the terminal.
        read -rsp "API token of the $ARRAY_NOUN's read-only user: " "$TOKEN_VARIABLE"
        echo ""
    done
    # A platform's own step checks a token that may hold a $ itself.
    if [ "$TOKEN_MAY_HOLD_DOLLAR" != "yes" ]; then
        reject_dollar "$TOKEN_VARIABLE" "${!TOKEN_VARIABLE}"
    fi
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
# The compose file, every collector config of the PLATFORMS table and every
# other file a platform runs with. Every OneUptime serves each of them for
# this script (Common/Types/InstallScripts/InstallScripts.ts lists them, and
# Tests/Ops/AgentInstallScriptsServed.test.js holds the two in step).
AGENT_FILES="docker-compose.yml $PLATFORM_CONFIGS $PLATFORM_FILES"
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
    # And the settings of the platform's own setup step, when it has one.
    for name in $PLATFORM_EXTRA_VARIABLES; do
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
if [ -n "$PLATFORM_SUMMARY" ]; then
    echo "$PLATFORM_SUMMARY"
fi
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
