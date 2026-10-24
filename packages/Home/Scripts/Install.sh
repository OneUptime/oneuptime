#!/usr/bin/env bash
#
# Installs OneUptime with Docker Compose on this server:
#
#   curl -fsSL https://oneuptime.com/install.sh | bash
#
# It installs what is missing (Git, Node.js, Docker with its Compose plugin),
# fetches the latest release into ./oneuptime, asks which address people will
# open OneUptime at (HOST in config.env), and starts it with npm start - which
# checks the server, gives every secret its own random value, starts
# OneUptime and waits until it answers.
#
# Run it again to pick up where it stopped: an existing ./oneuptime is
# updated in place, and its config.env is kept.
#
# Without questions (cloud-init, CI), set any of these:
#
#   ONEUPTIME_HOST=oneuptime.example.com   the address people open (HOST)
#   ONEUPTIME_DIR=/opt/oneuptime           where to install (./oneuptime)
#   ONEUPTIME_BRANCH=release               what to fetch (release)
#
# For the tests (Tests/Ops/HomeInstallScript.test.js):
#   ONEUPTIME_INSTALL_INPUT   where answers are read from (/dev/tty)
#   ONEUPTIME_REPOSITORY      what to clone
#   ONEUPTIME_OS_RELEASE      the system's os-release file (/etc/os-release)

set -euo pipefail

REPOSITORY="${ONEUPTIME_REPOSITORY:-https://github.com/OneUptime/oneuptime.git}"
BRANCH="${ONEUPTIME_BRANCH:-release}"
INSTALL_DIR="${ONEUPTIME_DIR:-oneuptime}"
INPUT="${ONEUPTIME_INSTALL_INPUT:-/dev/tty}"
OS_RELEASE="${ONEUPTIME_OS_RELEASE:-/etc/os-release}"
DOCS_URL="https://oneuptime.com/docs/installation/docker-compose"

# The oldest Node.js npm start's scripts run on.
MINIMUM_NODE_MAJOR=14

# Colors, only on a terminal.
if [ -t 1 ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    NC='\033[0m'
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    NC=''
fi

say() {
    printf '%b\n' "$*"
}

step() {
    say "${BLUE}==>${NC} $*"
}

done_line() {
    say "${GREEN}✓${NC} $*"
}

warn() {
    say "${YELLOW}!${NC} $*"
}

fail() {
    say "${RED}✗${NC} $*" >&2
    exit 1
}

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Runs a command as root: directly when this is root, with sudo otherwise.
as_root() {
    if [ "$(id -u)" -eq 0 ]; then
        "$@"
    elif command_exists sudo; then
        sudo "$@"
    else
        fail "This needs root to run: $*. Install sudo, or run the installer as root."
    fi
}

# The package manager of this system, or "" when there is none it knows.
package_manager() {
    if [ "$(uname -s)" = "Darwin" ]; then
        if command_exists brew; then
            echo "brew"
        fi
        return 0
    fi

    for manager in apt-get dnf yum pacman apk zypper; do
        if command_exists "$manager"; then
            echo "$manager"
            return 0
        fi
    done
}

APT_UPDATED="false"

install_packages() {
    local manager
    manager=$(package_manager)

    case "$manager" in
        apt-get)
            if [ "$APT_UPDATED" != "true" ]; then
                as_root apt-get update -y
                APT_UPDATED="true"
            fi
            as_root apt-get install -y "$@"
            ;;
        dnf) as_root dnf install -y "$@" ;;
        yum) as_root yum install -y "$@" ;;
        pacman) as_root pacman -Sy --noconfirm "$@" ;;
        apk) as_root apk add "$@" ;;
        zypper) as_root zypper install -y "$@" ;;
        brew) brew install "$@" ;;
        *) fail "Could not find a package manager to install $* with. Install $* yourself, then run this again." ;;
    esac
}

node_major() {
    node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1
}

ensure_git_and_curl() {
    local missing=""

    for tool in git curl; do
        if ! command_exists "$tool"; then
            missing="$missing $tool"
        fi
    done

    if [ -n "$missing" ]; then
        step "Installing${missing}"
        # shellcheck disable=SC2086
        install_packages $missing
    fi
}

ensure_node() {
    local major
    major=$(node_major || true)

    if command_exists npm && [ -n "$major" ] && [ "$major" -ge "$MINIMUM_NODE_MAJOR" ] 2>/dev/null; then
        done_line "Node.js $(node --version)"
        return 0
    fi

    step "Installing Node.js (npm start runs a few small scripts with it)"

    case "$(package_manager)" in
        apt-get)
            curl -fsSL https://deb.nodesource.com/setup_lts.x | as_root bash -
            as_root apt-get install -y nodejs
            ;;
        dnf | yum)
            curl -fsSL https://rpm.nodesource.com/setup_lts.x | as_root bash -
            install_packages nodejs
            ;;
        pacman | apk | zypper) install_packages nodejs npm ;;
        brew) install_packages node ;;
        *) fail "Could not install Node.js here. Install Node.js ${MINIMUM_NODE_MAJOR} or later, then run this again." ;;
    esac

    command_exists npm || fail "Node.js was installed, but npm was not found. Install npm, then run this again."
    done_line "Node.js $(node --version)"
}

# The ID in /etc/os-release (ubuntu, debian, rocky, almalinux, ...), or "".
os_id() {
    if [ -r "$OS_RELEASE" ]; then
        # shellcheck disable=SC1090
        (. "$OS_RELEASE" && printf '%s' "${ID:-}")
    fi
}

# Docker's own repository for RHEL's rebuilds, which get.docker.com does not
# install on (it looks for a repository named after them that Docker does not
# publish): the CentOS one, as Docker's install guide for them says.
RHEL_REBUILDS="rocky almalinux ol centos"
DOCKER_CENTOS_REPOSITORY="https://download.docker.com/linux/centos/docker-ce.repo"

install_docker() {
    local id
    id=$(os_id)

    case " $RHEL_REBUILDS " in
        *" $id "*)
            if [ -n "$id" ] && command_exists dnf; then
                install_packages dnf-plugins-core
                as_root dnf config-manager --add-repo "$DOCKER_CENTOS_REPOSITORY"
                install_packages docker-ce docker-ce-cli containerd.io docker-compose-plugin
                return 0
            fi
            ;;
    esac

    curl -fsSL https://get.docker.com | as_root sh
}

ensure_docker() {
    if ! command_exists docker; then
        if [ "$(uname -s)" = "Darwin" ]; then
            fail "Docker is not installed. Install Docker Desktop (https://docs.docker.com/desktop/), start it, then run this again."
        fi

        step "Installing Docker"
        install_docker
    fi

    if ! docker compose version >/dev/null 2>&1; then
        step "Installing the Docker Compose plugin"
        case "$(package_manager)" in
            apt-get) install_packages docker-compose-plugin || install_packages docker-compose-v2 ;;
            dnf | yum | zypper) install_packages docker-compose-plugin ;;
            pacman) install_packages docker-compose ;;
            apk) install_packages docker-cli-compose ;;
            *) fail "Docker Compose v2 (the docker compose command) is missing. Install it (https://docs.docker.com/compose/install/linux/), then run this again." ;;
        esac
    fi

    # A daemon that is installed but not running: start it.
    if ! docker info >/dev/null 2>&1 && ! as_root docker info >/dev/null 2>&1; then
        if command_exists systemctl; then
            step "Starting Docker"
            as_root systemctl enable --now docker ||
                fail "Docker is installed but could not be started. Start it (sudo systemctl start docker, or by opening Docker Desktop), then run this again."
        fi
    fi

    done_line "Docker $(docker --version 2>/dev/null | sed 's/^Docker version //; s/,.*//')"
}

# How this user runs Docker: "" when it can, "sg" when it was just added to
# the docker group (this session does not have the group yet).
DOCKER_ACCESS=""

ensure_docker_access() {
    local answer
    answer=$(docker info 2>&1 >/dev/null) && return 0

    if [ "$(id -u)" -eq 0 ] || ! printf '%s' "$answer" | grep -qi "permission denied"; then
        fail "Docker does not answer (${answer%%$'\n'*}). Check it with docker info, then run this again."
    fi

    step "Letting $(id -un) use Docker (adding it to the docker group)"
    as_root usermod -aG docker "$(id -un)"

    if command_exists sg; then
        DOCKER_ACCESS="sg"
        warn "Sign out and back in once OneUptime is up: until then, only this installer's own commands can use Docker without sudo."
    else
        fail "Added $(id -un) to the docker group. Sign out and back in, then run this again."
    fi
}

fetch_oneuptime() {
    if [ -d "$INSTALL_DIR/.git" ]; then
        step "Updating OneUptime in $INSTALL_DIR"
        git -C "$INSTALL_DIR" pull --ff-only
    elif [ -e "$INSTALL_DIR" ]; then
        fail "$INSTALL_DIR already exists and is not a OneUptime folder. Move it away, or set ONEUPTIME_DIR to another folder."
    else
        step "Fetching the latest release into $INSTALL_DIR"
        git clone --depth 1 --single-branch --branch "$BRANCH" "$REPOSITORY" "$INSTALL_DIR"
    fi
}

# This server's first address, for the question's default, or "".
detected_address() {
    local address=""

    if command_exists hostname; then
        address=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+(\.[0-9]+){3}$' | head -n 1 || true)
    fi

    if [ -z "$address" ] && command_exists ipconfig; then
        address=$(ipconfig getifaddr en0 2>/dev/null || true)
    fi

    printf '%s' "$address"
}

# An address as people type it, without a scheme, a path or spaces.
cleaned_host() {
    printf '%s' "$1" | sed -e 's|^[A-Za-z][A-Za-z0-9+.-]*://||' -e 's|[/?#].*$||' | tr -d '[:space:]'
}

# HOST in config.env, as the last assignment of it says.
current_host() {
    { grep -E '^[[:space:]]*HOST[[:space:]]*=' config.env || true; } | tail -n 1 | cut -d= -f2- | tr -d "\"'[:space:]"
}

# Whether there is someone to ask: a terminal (also under curl | bash, whose
# input is the script), or the answers file the tests give.
can_ask() {
    if [ "$INPUT" != "/dev/tty" ]; then
        [ -r "$INPUT" ]
        return
    fi

    (: < /dev/tty) 2>/dev/null
}

set_host() {
    local host="$1"
    local temporary

    temporary=$(mktemp "config.env.XXXXXX")
    sed "s#^HOST=.*#HOST=${host}#" config.env > "$temporary"
    cat "$temporary" > config.env
    rm -f "$temporary"
}

configure_host() {
    if [ ! -f config.env ]; then
        cp config.example.env config.env
        done_line "Created config.env from config.example.env"
    fi

    local host
    host=$(current_host)

    if [ -n "${ONEUPTIME_HOST:-}" ]; then
        host=$(cleaned_host "$ONEUPTIME_HOST")
    elif [ "$host" = "localhost" ] && can_ask; then
        local suggested
        suggested=$(detected_address)
        suggested="${suggested:-localhost}"

        say ""
        say "Which address will people use to open OneUptime?"
        say "  A domain name (oneuptime.example.com) or this server's IP address. Type localhost to try OneUptime on this computer only."
        printf 'Address [%s]: ' "$suggested"

        local answer=""
        read -r answer < "$INPUT" || true
        answer=$(cleaned_host "$answer")
        host="${answer:-$suggested}"
    fi

    if ! printf '%s' "$host" | grep -Eq '^[][A-Za-z0-9.:_-]+$'; then
        fail "\"$host\" is not an address people can open. Run this again with a domain name or an IP address, such as ONEUPTIME_HOST=oneuptime.example.com."
    fi

    if [ "$host" != "$(current_host)" ]; then
        set_host "$host"
    fi

    done_line "HOST=$host in config.env"
}

start_oneuptime() {
    step "Starting OneUptime. The first start downloads the images and takes a few minutes."

    if [ "$DOCKER_ACCESS" = "sg" ]; then
        sg docker -c "npm start"
    else
        npm start
    fi
}

main() {
    printf '%b' "$BLUE"
    cat <<'BANNER'
  ___              _   _       _   _
 / _ \ _ __   ___ | | | |_ __ | |_(_)_ __ ___   ___
| | | | '_ \ / _ \| | | | '_ \| __| | '_ ` _ \ / _ \
| |_| | | | |  __/| |_| | |_) | |_| | | | | | |  __/
 \___/|_| |_|\___| \___/| .__/ \__|_|_| |_| |_|\___|
                        |_|
BANNER
    printf '%b' "$NC"
    say ""
    say "This installs OneUptime with Docker Compose. The guide: ${DOCS_URL}"
    say ""

    ensure_git_and_curl
    ensure_node
    ensure_docker
    ensure_docker_access
    fetch_oneuptime

    cd "$INSTALL_DIR"

    configure_host
    start_oneuptime
}

main "$@"
