#!/bin/sh
#
# OneUptime host collector installer (Linux and macOS).
#
# Adds this host to OneUptime in one command. It installs two programs from
# the OpenTelemetry Collector releases (github.com/open-telemetry/
# opentelemetry-collector-releases), each checked against the SHA-256 its
# release publishes:
#
#   - otelcol-contrib, the OpenTelemetry Collector, which reads this host;
#   - opampsupervisor, which runs the collector and keeps it on the config
#     OneUptime sends it over OpAMP. A config that does not start is rolled
#     back to the last one that worked.
#
# and runs them as the service "oneuptime-collector" (systemd on Linux,
# launchd on macOS). On Linux it runs as the unprivileged user
# "oneuptime-collector", in the systemd-journal and adm groups so it can read
# the journal and the logs in /var/log; on macOS as root, like any launchd
# daemon. Nothing else on the host changes.
#
# Usage, from the Hosts page of OneUptime (which fills in the values):
#
#   curl -fsSL <OneUptime URL>/docs/static/scripts/host-collector/install.sh \
#     | sudo sh -s -- --url <OneUptime URL> --key <ingestion key>
#
# Options:
#   --url URL            Where OneUptime is (https://oneuptime.com).
#   --key KEY            A telemetry ingestion key of your project.
#   --label KEY=VALUE    Label the host (repeatable): env=production makes
#                        the label env:production, which Collector Configs
#                        can pick hosts by.
#   --env NAME=VALUE     Give the collector an environment variable
#                        (repeatable), for configs that read ${env:NAME}.
#   --version VERSION    The collector release (default: the one this
#                        OneUptime pins).
#   --download-url URL   Download the releases from a mirror with the same
#                        layout as GitHub's releases/download.
#   --proxy URL          Send the downloads and the collector's traffic
#                        through this HTTP(S) proxy.
#   --replace-existing   Stop and disable a collector installed by hand
#                        (otelcol-contrib.service) on this host.
#   --uninstall          Remove the service and everything this installed.
#
# Run it again to change any of these, or to move to a new release: it
# replaces what it installed and keeps the host's identity.

set -eu

PINNED_VERSION="0.161.0"
DEFAULT_DOWNLOAD_URL="https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download"
SERVICE_NAME="oneuptime-collector"
SERVICE_USER="oneuptime-collector"
MACOS_LABEL="com.oneuptime.collector"

ONEUPTIME_URL=""
INGESTION_KEY=""
VERSION="$PINNED_VERSION"
DOWNLOAD_URL="$DEFAULT_DOWNLOAD_URL"
PROXY_URL=""
REPLACE_EXISTING="false"
UNINSTALL="false"
# Newline-separated KEY=VALUE pairs.
LABELS=""
ENV_VARS=""

# A line break: lists are built one item per line.
NL='
'

say() {
    printf '%s\n' "$*"
}

fail() {
    printf 'Error: %s\n' "$*" >&2
    exit 1
}

usage() {
    say "Usage: install.sh --url <OneUptime URL> --key <ingestion key> [--label KEY=VALUE]... [--env NAME=VALUE]..."
    say "       install.sh --uninstall"
}

# --- Checks on what this script is given --------------------------------

# A URL OneUptime can be reached at: http(s)://, no spaces or quotes.
is_url() {
    case "$1" in
        http://* | https://*) ;;
        *) return 1 ;;
    esac
    case "$1" in
        *[!A-Za-z0-9._:/@%+=~-]*) return 1 ;;
    esac
    return 0
}

# An ingestion key: letters, digits and - _ . only.
is_key() {
    case "$1" in
        "" | *[!A-Za-z0-9._-]*) return 1 ;;
    esac
    return 0
}

# A label key: a letter or digit, then letters, digits, _ - or . (64 at most).
is_label_key() {
    case "$1" in
        "" | [!A-Za-z0-9]* | *[!A-Za-z0-9_.-]*) return 1 ;;
    esac
    [ "${#1}" -le 64 ]
}

# A label value: a letter or digit, then also _ - . : / @ and spaces (128 at
# most), not ending in a space.
is_label_value() {
    case "$1" in
        "" | [!A-Za-z0-9]* | *" " | *[!A-Za-z0-9_.:/@\ -]*) return 1 ;;
    esac
    [ "${#1}" -le 128 ]
}

# An environment variable name.
is_env_name() {
    case "$1" in
        "" | [!A-Za-z_]* | *[!A-Za-z0-9_]*) return 1 ;;
    esac
    return 0
}

# A release number: digits and dots.
is_version() {
    case "$1" in
        "" | *[!0-9.]* | .* | *.) return 1 ;;
    esac
    return 0
}

# A value as a double-quoted YAML string: \ and " escaped. A value never
# holds a line break: --label and --env values are read one per line.
yaml_quote() {
    printf '"%s"' "$(printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
}

# The URL without the slashes it may end with.
trim_url() {
    url="$1"
    while [ "${url%/}" != "$url" ]; do
        url="${url%/}"
    done
    printf '%s' "$url"
}

# The whole script runs from main, called on its last line: piped into sh,
# nothing runs until all of it has arrived, so a download that breaks off
# halfway installs nothing.
main() {
    # The HTTP status OneUptime refused the supervisor's key with, if it did,
# read from this run's logs; empty while it has not.
refused_status() {
    if [ "$OS" = "linux" ]; then
        # This run of the service only: an earlier run's refusal (a wrong key
        # this run replaces) does not count.
        if [ -n "$INVOCATION_ID" ]; then
            logs="$(journalctl "_SYSTEMD_INVOCATION_ID=$INVOCATION_ID" --no-pager 2>/dev/null || true)"
        else
            logs="$(journalctl -u "$SERVICE_NAME" --since "$STARTED_AT" --no-pager 2>/dev/null || true)"
        fi
    else
        logs="$(cat "$LOG_DIR/collector.log" 2>/dev/null || true)"
    fi
    for status in 401 403 422; do
        case "$logs" in
            *"response from server: $status"*)
                printf '%s' "$status"
                return 0
                ;;
        esac
    done
    return 0
}

# --- Arguments --------------------------------------------------------------

    while [ "$#" -gt 0 ]; do
        case "$1" in
            --url)
                [ "$#" -ge 2 ] || fail "--url needs a value."
                ONEUPTIME_URL="$2"
                shift 2
                ;;
            --url=*)
                ONEUPTIME_URL="${1#--url=}"
                shift
                ;;
            --key)
                [ "$#" -ge 2 ] || fail "--key needs a value."
                INGESTION_KEY="$2"
                shift 2
                ;;
            --key=*)
                INGESTION_KEY="${1#--key=}"
                shift
                ;;
            --label)
                [ "$#" -ge 2 ] || fail "--label needs a value, such as env=production."
                LABELS="${LABELS}$2${NL}"
                shift 2
                ;;
            --label=*)
                LABELS="${LABELS}${1#--label=}${NL}"
                shift
                ;;
            --env)
                [ "$#" -ge 2 ] || fail "--env needs a value, such as DB_PASSWORD=secret."
                ENV_VARS="${ENV_VARS}$2${NL}"
                shift 2
                ;;
            --version)
                [ "$#" -ge 2 ] || fail "--version needs a value."
                VERSION="$2"
                shift 2
                ;;
            --download-url)
                [ "$#" -ge 2 ] || fail "--download-url needs a value."
                DOWNLOAD_URL="$2"
                shift 2
                ;;
            --proxy)
                [ "$#" -ge 2 ] || fail "--proxy needs a value, such as http://proxy:3128."
                PROXY_URL="$2"
                shift 2
                ;;
            --replace-existing)
                REPLACE_EXISTING="true"
                shift
                ;;
            --uninstall)
                UNINSTALL="true"
                shift
                ;;
            -h | --help)
                usage
                exit 0
                ;;
            *)
                usage >&2
                fail "Unknown option: $1"
                ;;
        esac
    done

    # --- Where this host is -----------------------------------------------------

    OS_NAME="$(uname -s)"
    case "$OS_NAME" in
        Linux) OS="linux" ;;
        Darwin) OS="darwin" ;;
        *) fail "This installer runs on Linux and macOS. On Windows, run install.ps1 from an elevated PowerShell." ;;
    esac

    if [ "$OS" = "linux" ]; then
        INSTALL_DIR="/opt/oneuptime-collector"
        CONFIG_DIR="/etc/oneuptime-collector"
        STATE_DIR="/var/lib/oneuptime-collector"
        UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
        # Where a config's file_storage extension keeps its queues by default.
        FILE_STORAGE_DIR="/var/lib/otelcol/file_storage"
    else
        INSTALL_DIR="/usr/local/oneuptime-collector"
        CONFIG_DIR="/usr/local/oneuptime-collector/etc"
        STATE_DIR="/usr/local/oneuptime-collector/state"
        LOG_DIR="/usr/local/oneuptime-collector/log"
        PLIST_FILE="/Library/LaunchDaemons/${MACOS_LABEL}.plist"
    fi
    CONFIG_FILE="${CONFIG_DIR}/supervisor.yaml"

    if [ "$(id -u)" != "0" ]; then
        fail "Run this as root: pipe it into 'sudo sh -s -- ...'."
    fi

    # --- Uninstall --------------------------------------------------------------

    stop_service() {
        if [ "$OS" = "linux" ]; then
            if [ -f "$UNIT_FILE" ]; then
                systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
            fi
        else
            launchctl bootout "system/${MACOS_LABEL}" >/dev/null 2>&1 ||
                launchctl unload "$PLIST_FILE" >/dev/null 2>&1 || true
        fi
    }

    if [ "$UNINSTALL" = "true" ]; then
        say "Removing the OneUptime collector from this host..."
        stop_service
        if [ "$OS" = "linux" ]; then
            systemctl disable "$SERVICE_NAME" >/dev/null 2>&1 || true
            rm -f "$UNIT_FILE"
            systemctl daemon-reload >/dev/null 2>&1 || true
            rm -rf "$INSTALL_DIR" "$CONFIG_DIR" "$STATE_DIR"
            # The queue folder the installer made, when nothing is left in it
            # (a collector installed by hand uses the same folder).
            rmdir "$FILE_STORAGE_DIR" /var/lib/otelcol >/dev/null 2>&1 || true
            if id "$SERVICE_USER" >/dev/null 2>&1; then
                userdel "$SERVICE_USER" >/dev/null 2>&1 || true
            fi
        else
            rm -f "$PLIST_FILE"
            rm -rf "$INSTALL_DIR"
        fi
        say "Done. The host stays in OneUptime with its history; delete it there if you no longer want it."
        exit 0
    fi

    # --- What to install --------------------------------------------------------

    [ -n "$ONEUPTIME_URL" ] || {
        usage >&2
        fail "--url is required: where your OneUptime is, such as https://oneuptime.com."
    }
    [ -n "$INGESTION_KEY" ] || {
        usage >&2
        fail "--key is required: a telemetry ingestion key of your project."
    }

    ONEUPTIME_URL="$(trim_url "$ONEUPTIME_URL")"
    DOWNLOAD_URL="$(trim_url "$DOWNLOAD_URL")"

    is_url "$ONEUPTIME_URL" || fail "--url must be an http:// or https:// address, such as https://oneuptime.com."
    is_key "$INGESTION_KEY" || fail "--key does not look like an ingestion key. Copy it again from OneUptime."
    is_url "$DOWNLOAD_URL" || fail "--download-url must be an http:// or https:// address."
    is_version "$VERSION" || fail "--version must be a release number, such as $PINNED_VERSION."
    if [ -n "$PROXY_URL" ]; then
        is_url "$PROXY_URL" || fail "--proxy must be an http:// or https:// address, such as http://proxy:3128."
    fi

    # Labels and environment variables: each checked, one per line.
    LABEL_LINES=""
    OLD_IFS="$IFS"
    IFS="$NL"
    for label in $LABELS; do
        label_key="${label%%=*}"
        label_value="${label#*=}"
        if [ "$label_key" = "$label" ]; then
            # key:value is taken too.
            label_key="${label%%:*}"
            label_value="${label#*:}"
        fi
        if ! is_label_key "$label_key" || ! is_label_value "$label_value"; then
            IFS="$OLD_IFS"
            fail "--label $label is not a label this installer takes: use key=value with letters, digits and _ - . (a value may also hold : / @ and spaces)."
        fi
        LABEL_LINES="${LABEL_LINES}      oneuptime.label.${label_key}: $(yaml_quote "$label_value")${NL}"
    done

    ENV_LINES=""
    for variable in $ENV_VARS; do
        env_name="${variable%%=*}"
        env_value="${variable#*=}"
        if [ "$env_name" = "$variable" ] || ! is_env_name "$env_name"; then
            IFS="$OLD_IFS"
            fail "--env $env_name must be NAME=VALUE, with a name of letters, digits and _."
        fi
        case "$env_name" in
            ONEUPTIME_URL | ONEUPTIME_INGESTION_KEY)
                IFS="$OLD_IFS"
                fail "--env $env_name is set by the installer from --url and --key."
                ;;
        esac
        ENV_LINES="${ENV_LINES}    ${env_name}: $(yaml_quote "$env_value")${NL}"
    done
    IFS="$OLD_IFS"

    case "$(uname -m)" in
        x86_64 | amd64) ARCH="amd64" ;;
        aarch64 | arm64) ARCH="arm64" ;;
        ppc64le)
            [ "$OS" = "linux" ] || fail "This installer does not support $(uname -m) on macOS."
            ARCH="ppc64le"
            ;;
        *) fail "This installer supports amd64 and arm64 hosts (and ppc64le on Linux); this host is $(uname -m)." ;;
    esac

    # What OneUptime's default config for Linux reads depends on what the
    # host has: the journal (journalctl and a journal) and systemd units (the
    # system D-Bus). A receiver that cannot start would stop the collector.
    HAS_JOURNALD="false"
    HAS_SYSTEMD_BUS="false"
    if [ "$OS" = "linux" ]; then
        if command -v journalctl >/dev/null 2>&1 && { [ -d /var/log/journal ] || [ -d /run/log/journal ]; }; then
            HAS_JOURNALD="true"
        fi
        if [ -S /run/dbus/system_bus_socket ] || [ -S /var/run/dbus/system_bus_socket ]; then
            HAS_SYSTEMD_BUS="true"
        fi
    fi

    if [ "$OS" = "linux" ]; then
        if ! command -v systemctl >/dev/null 2>&1 || [ ! -d /run/systemd/system ]; then
            fail "This installer runs the collector as a systemd service, and this host does not run systemd. Install the collector yourself instead: $ONEUPTIME_URL/docs/telemetry/host-otel-collector"
        fi
    fi

    command -v curl >/dev/null 2>&1 || fail "curl is required."
    command -v tar >/dev/null 2>&1 || fail "tar is required."

    if command -v sha256sum >/dev/null 2>&1; then
        SHA256="sha256sum"
    elif command -v shasum >/dev/null 2>&1; then
        SHA256="shasum -a 256"
    else
        fail "sha256sum (or shasum) is required to check the downloads."
    fi

    say "Installing the OneUptime collector (OpenTelemetry Collector $VERSION) on $(uname -n)..."

    WORK_DIR="$(mktemp -d)"
    trap 'rm -rf "$WORK_DIR"' EXIT

    # Downloads a file and checks it against the SHA-256 published beside it.
    download_checked() {
        url="$1"
        target="$2"
        if [ -n "$PROXY_URL" ]; then
            set -- --proxy "$PROXY_URL"
        else
            set --
        fi
        curl -fsSL --retry 3 "$@" -o "$target" "$url" ||
            fail "Could not download $url"
        curl -fsSL --retry 3 "$@" -o "$target.sha256" "$url.sha256" ||
            fail "Could not download $url.sha256"
        expected="$(tr -d ' \r\n' <"$target.sha256" | cut -c1-64)"
        actual="$($SHA256 "$target" | cut -d ' ' -f 1)"
        if [ "$expected" != "$actual" ]; then
            fail "The download of $url does not match its published SHA-256. Nothing was installed."
        fi
    }

    COLLECTOR_ARCHIVE="otelcol-contrib_${VERSION}_${OS}_${ARCH}.tar.gz"
    SUPERVISOR_BINARY="opampsupervisor_${VERSION}_${OS}_${ARCH}"

    download_checked "$DOWNLOAD_URL/v${VERSION}/${COLLECTOR_ARCHIVE}" "$WORK_DIR/$COLLECTOR_ARCHIVE"
    download_checked "$DOWNLOAD_URL/cmd%2Fopampsupervisor%2Fv${VERSION}/${SUPERVISOR_BINARY}" "$WORK_DIR/opampsupervisor"

    tar -xzf "$WORK_DIR/$COLLECTOR_ARCHIVE" -C "$WORK_DIR" otelcol-contrib ||
        fail "The collector archive does not hold otelcol-contrib."

    # --- Install ----------------------------------------------------------------

    stop_service

    if [ "$OS" = "linux" ]; then
        if ! id "$SERVICE_USER" >/dev/null 2>&1; then
            NOLOGIN="$(command -v nologin 2>/dev/null || printf '/usr/sbin/nologin')"
            if command -v useradd >/dev/null 2>&1; then
                useradd --system --user-group --no-create-home --home-dir "$STATE_DIR" --shell "$NOLOGIN" "$SERVICE_USER"
            else
                adduser --system --group --no-create-home --home "$STATE_DIR" --shell "$NOLOGIN" "$SERVICE_USER"
            fi
        fi
        # Read the journal and the logs in /var/log, as the manual guide's
        # collector does.
        for group in systemd-journal adm; do
            if getent group "$group" >/dev/null 2>&1; then
                usermod -a -G "$group" "$SERVICE_USER" >/dev/null 2>&1 || true
            fi
        done
    fi

    mkdir -p "$INSTALL_DIR" "$CONFIG_DIR" "$STATE_DIR"
    install -m 0755 "$WORK_DIR/otelcol-contrib" "$INSTALL_DIR/otelcol-contrib"
    install -m 0755 "$WORK_DIR/opampsupervisor" "$INSTALL_DIR/opampsupervisor"

    # A run of the installer starts the supervisor afresh: it asks OneUptime
    # for its config again, which is how the end of this script knows that
    # OneUptime answered. The last config that worked stays, to roll back to.
    rm -f "$STATE_DIR/last_recv_remote_config.dat" "$STATE_DIR/persistent_state.yaml"

    # The supervisor's config holds the key: only the service may read it.
    umask 077
    cat >"$CONFIG_FILE" <<EOF
# Written by the OneUptime host collector installer. To change it, run the
# installer again; the collector's own config comes from OneUptime.
server:
  endpoint: $(yaml_quote "$ONEUPTIME_URL/opamp/v1")
  headers:
    x-oneuptime-token: $(yaml_quote "$INGESTION_KEY")

capabilities:
  accepts_remote_config: true
  reports_health: true
  reports_heartbeat: true
  # The config the collector runs, as the supervisor put it together - with
  # \${env:...} still unread, so it holds no key.
  reports_effective_config: true
  reports_own_metrics: false
  reports_own_logs: false
  reports_own_traces: false

agent:
  executable: $(yaml_quote "$INSTALL_DIR/otelcol-contrib")
  # Check a new config with the collector before switching to it, and go
  # back to the last config that worked when one does not start.
  validate_config: true
  automatic_config_rollback: true
  config_apply_timeout: 20s
  bootstrap_timeout: 15s
  collector_crash_log_snippet_kib: 4
  passthrough_logs: true
  description:
    non_identifying_attributes:
      oneuptime.collector.installer: "host-collector"
      oneuptime.host.journald: "$HAS_JOURNALD"
      oneuptime.host.systemd: "$HAS_SYSTEMD_BUS"
${LABEL_LINES}  env:
    ONEUPTIME_URL: $(yaml_quote "$ONEUPTIME_URL")
    ONEUPTIME_INGESTION_KEY: $(yaml_quote "$INGESTION_KEY")
${ENV_LINES}
storage:
  directory: $(yaml_quote "$STATE_DIR")

telemetry:
  logs:
    level: info
    output_paths: ["stdout"]
EOF
    umask 022

    if [ "$OS" = "linux" ]; then
        mkdir -p "$FILE_STORAGE_DIR"
        chown -R "$SERVICE_USER:$SERVICE_USER" "$STATE_DIR" "$FILE_STORAGE_DIR"
        chown "$SERVICE_USER:$SERVICE_USER" "$CONFIG_FILE"
        chmod 0700 "$STATE_DIR"
        chmod 0600 "$CONFIG_FILE"

        if systemctl is-active --quiet otelcol-contrib 2>/dev/null; then
            if [ "$REPLACE_EXISTING" = "true" ]; then
                say "Stopping the collector installed by hand (otelcol-contrib.service): OneUptime runs this host's collector now."
                systemctl disable --now otelcol-contrib >/dev/null 2>&1 || true
            else
                say "Note: another OpenTelemetry Collector runs on this host (otelcol-contrib.service)."
                say "      If it sends this host's data to OneUptime too, stop it, or the host reports twice:"
                say "      sudo systemctl disable --now otelcol-contrib"
                say "      (or run this installer again with --replace-existing)."
            fi
        fi

        PROXY_ENVIRONMENT=""
        if [ -n "$PROXY_URL" ]; then
            PROXY_ENVIRONMENT="Environment=HTTPS_PROXY=$PROXY_URL HTTP_PROXY=$PROXY_URL"
        fi

        cat >"$UNIT_FILE" <<EOF
[Unit]
Description=OneUptime collector (OpenTelemetry Collector, configured by OneUptime)
Documentation=$ONEUPTIME_URL/docs/telemetry/hosts
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$INSTALL_DIR/opampsupervisor --config $CONFIG_FILE
User=$SERVICE_USER
Group=$SERVICE_USER
Restart=always
RestartSec=5
NoNewPrivileges=yes
ProtectSystem=full
PrivateTmp=yes
$PROXY_ENVIRONMENT

[Install]
WantedBy=multi-user.target
EOF

        systemctl daemon-reload
        systemctl enable "$SERVICE_NAME" >/dev/null 2>&1
        STARTED_AT="$(date '+%Y-%m-%d %H:%M:%S')"
        systemctl restart "$SERVICE_NAME"
        INVOCATION_ID="$(systemctl show -p InvocationID --value "$SERVICE_NAME" 2>/dev/null || true)"
        LOGS_COMMAND="sudo journalctl -u $SERVICE_NAME -n 50"
    else
        mkdir -p "$LOG_DIR"
        chmod 0700 "$STATE_DIR" "$CONFIG_DIR"
        chmod 0600 "$CONFIG_FILE"

        PROXY_ENVIRONMENT=""
        if [ -n "$PROXY_URL" ]; then
            PROXY_ENVIRONMENT="  <key>EnvironmentVariables</key>
  <dict>
    <key>HTTPS_PROXY</key><string>$PROXY_URL</string>
    <key>HTTP_PROXY</key><string>$PROXY_URL</string>
  </dict>"
        fi

        cat >"$PLIST_FILE" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$MACOS_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$INSTALL_DIR/opampsupervisor</string>
    <string>--config</string>
    <string>$CONFIG_FILE</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG_DIR/collector.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/collector.log</string>
$PROXY_ENVIRONMENT
</dict>
</plist>
EOF
        chmod 0644 "$PLIST_FILE"
        # A fresh log, so the wait below reads only this run's lines.
        if [ -f "$LOG_DIR/collector.log" ]; then
            mv -f "$LOG_DIR/collector.log" "$LOG_DIR/collector.log.1"
        fi
        launchctl bootstrap system "$PLIST_FILE" >/dev/null 2>&1 ||
            launchctl load -w "$PLIST_FILE"
        LOGS_COMMAND="sudo tail -n 50 $LOG_DIR/collector.log"
    fi

    # --- Wait for OneUptime -----------------------------------------------------

    say "Waiting for OneUptime to send this host its config..."
    waited=0
    while [ "$waited" -lt 60 ]; do
        refusal="$(refused_status)"
        if [ -n "$refusal" ]; then
            say ""
            say "OneUptime refused the key (HTTP $refusal)."
            if [ "$refusal" = "401" ]; then
                say "The key is wrong, has expired or was deleted. Copy it again from OneUptime, or"
                say "create one under Project Settings > Telemetry Ingestion Keys, and run this again."
            else
                say "The key is disabled, is a browser key, or is pinned to one service. Use an enabled"
                say "server ingestion key from Project Settings > Telemetry Ingestion Keys, and run this again."
            fi
            say "The collector stays installed and asks again every 30 seconds."
            exit 1
        fi
        if [ -f "$STATE_DIR/last_recv_remote_config.dat" ]; then
            say ""
            say "Done. $(uname -n) is connected to OneUptime and runs the config OneUptime sent it."
            say "It shows under Hosts now; its metrics and logs follow within a minute."
            say "Logs: $LOGS_COMMAND"
            exit 0
        fi
        sleep 2
        waited=$((waited + 2))
    done

    say ""
    say "The collector is installed and running, but OneUptime has not answered yet."
    say "Check that this host can reach $ONEUPTIME_URL, and read the logs: $LOGS_COMMAND"
    exit 0
}

main "$@"
