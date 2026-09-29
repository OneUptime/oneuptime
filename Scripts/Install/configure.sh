#!/usr/bin/env bash

# Exit on error, undefined variables, and pipe failures
set -euo pipefail

# Global variables
DOCKER_COMPOSE_VERSION="2.12.2"
GOMPLATE_VERSION="3.11.8"
MINIMUM_DOCKER_VERSION="20.0.0"
MINIMUM_NODE_VERSION="14.0.0"
NVM_VERSION="0.40.1"
REQUIRED_PACKAGES="git curl"

# Print with color
print_info() {
    echo -e "\033[0;34m[INFO]\033[0m $1"
}

print_success() {
    echo -e "\033[0;32m[SUCCESS]\033[0m $1"
}

print_error() {
    echo -e "\033[0;31m[ERROR]\033[0m $1" >&2
}

# Check version meets minimum requirement
version_gt() {
    test "$(printf '%s\n' "$@" | sort -V | head -n 1)" != "$1"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Install system packages based on OS
install_system_packages() {
    # Skip the package-manager step entirely when every required package is
    # already available. On CI runners git and curl are always present, and the
    # `apt-get update` (or dnf/apk equivalent) is a slow network call that has
    # intermittently hung and timed out the docker-build "Preinstall" step
    # (nick-fields/retry then fails to kill the root-owned apt child with
    # "kill EPERM"). There is nothing to install when nothing is missing.
    local missing_packages=""
    for pkg in $REQUIRED_PACKAGES; do
        if ! command_exists "$pkg"; then
            missing_packages="$missing_packages $pkg"
        fi
    done
    if [[ -z "${missing_packages// /}" ]]; then
        print_success "Required packages already installed ($REQUIRED_PACKAGES); skipping package cache update."
        return 0
    fi
    print_info "Missing packages:${missing_packages}"

    if [[ "$OSTYPE" == "darwin"* ]]; then
        if ! command_exists brew; then
            print_error "Homebrew not installed. Please install homebrew and restart installer"
            exit 1
        fi
        brew install $REQUIRED_PACKAGES
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        local DISTRIB
        DISTRIB=$(awk -F= '/^ID/{print $2}' /etc/os-release)
        
        if [[ ${DISTRIB} = "ubuntu"* ]] || [[ ${DISTRIB} = "debian"* ]]; then
            print_info "Updating package cache..."
            sudo apt-get update
            sudo apt-get install -y $REQUIRED_PACKAGES
        elif [[ ${DISTRIB} = "fedora"* ]] || [[ ${DISTRIB} = "almalinux"* ]] || [[ ${DISTRIB} = "rockylinux"* ]] || [[ ${DISTRIB} = "rhel"* ]]; then
            print_info "Updating package cache..."
            sudo dnf install -y $REQUIRED_PACKAGES
        else
            print_error "Unsupported Linux distribution: $DISTRIB"
            exit 1
        fi
    elif [[ "$OSTYPE" == "linux-musl"* ]]; then
        local DISTRIB
        DISTRIB=$(awk -F= '/^ID/{print $2}' /etc/os-release)
        
        if [[ ${DISTRIB} = "alpine"* ]]; then
            print_info "Updating package cache..."
            sudo apk update
            sudo apk add $REQUIRED_PACKAGES
        else
            print_error "Unsupported Linux distribution: $DISTRIB"
            exit 1
        fi
    else
        print_error "Unsupported operating system: $OSTYPE"
        exit 1
    fi
}

setup_nodejs() {
    if ! command_exists node || ! command_exists npm; then
        print_info "Installing Node.js..."
        if [[ "$OSTYPE" == "darwin"* ]]; then
            brew install nodejs
        else
            curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v${NVM_VERSION}/install.sh | bash
            export NVM_DIR="$([ -z "${XDG_CONFIG_HOME-}" ] && printf %s "${HOME}/.nvm" || printf %s "${XDG_CONFIG_HOME}/nvm")"
            # shellcheck disable=SC1090
            [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
            nvm install lts/*
            nvm use lts/*
            sudo ln -s "$NVM_DIR/versions/node/$(nvm version)/bin/node" "/usr/local/bin/node"
            sudo ln -s "$NVM_DIR/versions/node/$(nvm version)/bin/npm" "/usr/local/bin/npm"
        fi
    fi

    # Verify Node.js version
    local NODE_VERSION
    NODE_VERSION=$(node --version | cut -d 'v' -f 2)
    if ! version_gt "$NODE_VERSION" "$MINIMUM_NODE_VERSION"; then
        print_error "Node.js version $NODE_VERSION is too old. Minimum required version is $MINIMUM_NODE_VERSION"
        exit 1
    fi
}

setup_docker() {
    if ! command_exists docker; then
        print_info "Installing Docker..."
        sudo curl -sSL https://get.docker.com/ | sh
        sudo usermod -aG docker "${USER}"
    fi

    # Verify Docker version
    local DOCKER_VERSION
    DOCKER_VERSION=$(docker --version | cut -d ' ' -f 3 | cut -d ',' -f 1)
    if ! version_gt "$DOCKER_VERSION" "$MINIMUM_DOCKER_VERSION"; then
        print_error "Docker version $DOCKER_VERSION is too old. Minimum required version is $MINIMUM_DOCKER_VERSION"
        exit 1
    fi

    if ! command_exists docker-compose && ! docker compose version >/dev/null 2>&1; then
        print_info "Installing Docker Compose..."
        mkdir -p /usr/local/lib/docker/cli-plugins
        sudo curl -SL "https://github.com/docker/compose/releases/download/v${DOCKER_COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" \
            -o /usr/local/lib/docker/cli-plugins/docker-compose
        sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
    fi
}

setup_gomplate() {
    if ! command_exists gomplate; then
        print_info "Installing gomplate..."
        local ARCHITECTURE
        ARCHITECTURE=$(uname -m)
        case $ARCHITECTURE in
            "aarch64") ARCHITECTURE="arm64" ;;
            "x86_64")  ARCHITECTURE="amd64" ;;
        esac

        # Download to a temp file first. `-f` makes curl exit non-zero on an
        # HTTP error (GitHub's release CDN intermittently answers 503) instead
        # of silently writing the error page to the binary path, and
        # `--retry ... --retry-all-errors` rides out transient failures.
        # Without `-f` a 503 HTML body was saved as /usr/local/bin/gomplate,
        # chmod'd executable and then run ("syntax error near unexpected token
        # `<'"); worse, the poisoned file then existed, so the outer retry saw
        # gomplate as installed and skipped the re-download, failing every
        # attempt identically.
        local GOMPLATE_TMP
        GOMPLATE_TMP=$(mktemp)
        if ! curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors \
            -o "$GOMPLATE_TMP" \
            "https://github.com/hairyhenderson/gomplate/releases/download/v${GOMPLATE_VERSION}/gomplate_$(uname -s)-$ARCHITECTURE"; then
            rm -f "$GOMPLATE_TMP"
            print_error "Failed to download gomplate v${GOMPLATE_VERSION}."
            return 1
        fi
        # Defence in depth: never install an HTML error page as the binary.
        if [ ! -s "$GOMPLATE_TMP" ] || head -c 4 "$GOMPLATE_TMP" | grep -qa '<'; then
            rm -f "$GOMPLATE_TMP"
            print_error "Downloaded gomplate is not a valid binary (got an error page?)."
            return 1
        fi
        sudo install -m 755 "$GOMPLATE_TMP" /usr/local/bin/gomplate
        rm -f "$GOMPLATE_TMP"
    fi
}

clone_oneuptime() {
    if [[ ${IS_DOCKER:-false} != "true" ]]; then
        local GIT_REPO_URL
        GIT_REPO_URL=$(git config --get remote.origin.url || echo "")
        
        if [[ $GIT_REPO_URL != *oneuptime* ]]; then
            print_info "Cloning OneUptime repository..."
            git clone https://github.com/OneUptime/oneuptime.git || true
            cd oneuptime
        fi

        # Update repository if not in CI/CD
        if [ -z "${CI_PIPELINE_ID:-}" ]; then
            git pull
        fi
    fi
}

setup_tsnode() {
    if ! command_exists ts-node; then
        print_info "Installing ts-node..."
        sudo "$(which npm)" install -g ts-node
    fi
}

# Main installation process
main() {
    print_info "Welcome to the OneUptime 🟢 Runner"
    echo ""
    
    # Request sudo access upfront
    print_info "Please enter your sudo password:"
    sudo echo ""
    print_success "Authentication successful! 🙏"
    
    install_system_packages
    setup_nodejs
    setup_docker
    setup_gomplate
    setup_tsnode

    
    clone_oneuptime
    
    # Configure environment
    touch config.env
    
    print_info "Merging environment templates..."
    node ./Scripts/Install/MergeEnvTemplate.js
    
    # Load environment variables
    # shellcheck disable=SC2046
    set -a
source config.env
set +a
    
    print_info "Generating Dockerfile configurations..."
    while IFS= read -r dockerfile_template; do
        cat "$dockerfile_template" | gomplate > "${dockerfile_template%.tpl}"
    done < <(find . -type f -name "Dockerfile.tpl" -not -path "*/node_modules/*")
    
    print_success "OneUptime installation completed successfully! 🚀"
}

# Run main function
main
