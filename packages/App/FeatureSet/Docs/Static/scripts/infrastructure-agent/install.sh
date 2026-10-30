#!/bin/sh
# Installs the OneUptime infrastructure agent from the latest GitHub release:
#
#   curl -sSL https://oneuptime.com/docs/static/scripts/infrastructure-agent/install.sh | sudo bash
#
# Run as root, as above, it installs the agent in /usr/local/bin, where
# `sudo oneuptime-infrastructure-agent ...` finds it. (It used to install it
# in $HOME/bin, which under sudo is /root/bin: not on sudo's path, so the next
# step, `sudo oneuptime-infrastructure-agent configure`, was not found.) Run
# as any other user, it installs it in $HOME/bin. -b <directory> installs it
# there instead.
set -e

usage() {
  echo "Usage: $0 [-b bindir] [-d]"
  echo "  -b sets the directory to install the agent in: /usr/local/bin when run as root, \$HOME/bin otherwise"
  echo "  -d enables debug mode"
  exit 1
}

if [ "$(id -u)" = "0" ]; then
  BINDIR=/usr/local/bin
else
  # if there's no $HOME env var then set it to /usr
  if [ -z "$HOME" ]; then
    HOME=/usr
  fi
  BINDIR=$HOME/bin
fi

# Parse command-line options
while getopts "b:d" opt; do
  case ${opt} in
    b )
      BINDIR=$OPTARG
      ;;
    d )
      set -x
      ;;
    \? )
      usage
      ;;
  esac
done

echo "Installing to ${BINDIR}"
mkdir -p "${BINDIR}"

# Detect platform and architecture. Each release has the agent for x86-64
# (amd64) and ARM64 (arm64).
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case $ARCH in
  x86_64 | amd64)
    ARCH=amd64
    ;;
  aarch64 | arm64)
    ARCH=arm64
    ;;
  *)
    echo "Architecture $ARCH is not supported"
    exit 1
    ;;
esac

# fetch prints what is at a URL, and download saves it to a file: with curl,
# which `curl ... | sudo bash` has already, or wget where there is no curl.
# Neither installs anything: a missing tool is for the person to install.
if command -v curl > /dev/null 2>&1; then
  fetch() {
    curl -fsSL "$1"
  }
  download() {
    curl -fsSL "$1" -o "$2"
  }
elif command -v wget > /dev/null 2>&1; then
  fetch() {
    wget -qO- "$1"
  }
  download() {
    wget -q "$1" -O "$2"
  }
else
  echo "Neither curl nor wget is installed. Install one of them, then run this script again."
  exit 1
fi

# Fetch the latest release tag from GitHub
REPO="oneuptime/oneuptime"
API_URL="https://api.github.com/repos/${REPO}/releases/latest"
TAG=$(fetch "${API_URL}" | grep '"tag_name":' | sed -E 's/.*"tag_name": "([^"]+)".*/\1/' || true)

if [ "$TAG" = "" ]; then
  echo "Failed to find the latest release. Please check your internet connection or GitHub API limits."
  exit 1
fi

echo "Fetching the latest release: $TAG"

# Construct the URL for the binary release
ARCHIVE="oneuptime-infrastructure-agent_${OS}_${ARCH}.tar.gz"
URL="https://github.com/${REPO}/releases/download/${TAG}/${ARCHIVE}"

# Download and unpack the release in a directory of its own, and install only
# the agent from it: the archive also holds the agent's README and LICENSE,
# which have no place in a directory of programs.
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

if ! download "${URL}" "${WORKDIR}/${ARCHIVE}"; then
  echo "Failed to download ${URL}"
  exit 1
fi

tar -xzf "${WORKDIR}/${ARCHIVE}" -C "${WORKDIR}"

# Put in place by a rename, which replaces the agent of an earlier install
# even while it runs: Linux refuses to write over a running program.
cp "${WORKDIR}/oneuptime-infrastructure-agent" "${BINDIR}/.oneuptime-infrastructure-agent.new"
chmod 755 "${BINDIR}/.oneuptime-infrastructure-agent.new"
mv -f "${BINDIR}/.oneuptime-infrastructure-agent.new" "${BINDIR}/oneuptime-infrastructure-agent"

# Check if the binary is executable
if [ ! -x "${BINDIR}/oneuptime-infrastructure-agent" ]; then
  echo "Failed to install oneuptime-infrastructure-agent"
  exit 1
fi

# The command to run the agent with: its name when the directory is on the
# path - under sudo, sudo's own path - and its full path when it is not.
AGENT=oneuptime-infrastructure-agent
case ":${PATH}:" in
  *":${BINDIR}:"*)
    ;;
  *)
    AGENT="${BINDIR}/oneuptime-infrastructure-agent"
    ;;
esac

echo "oneuptime-infrastructure-agent ${TAG} has been installed to ${BINDIR}"
echo ""
echo "Connect it to your Server / VM monitor and start it. The monitor's Documentation tab has these commands with its secret key and your OneUptime URL filled in:"
echo "  sudo ${AGENT} configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com"
echo "  sudo ${AGENT} start"
