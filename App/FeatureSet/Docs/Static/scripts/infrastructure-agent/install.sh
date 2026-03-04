#!/bin/sh
set -e

usage() {
  echo "Usage: $0 [-b bindir] [-d]"
  echo "  -b sets the directory for the binary installation, default is ./bin"
  echo "  -d enables debug mode"
  exit 1
}

# if there's no $HOME env var then set it to /usr

if [ -z "$HOME" ]; then
  HOME=/usr
fi

# Default parameters
BINDIR=$HOME/bin

# Make sure bindir exists
if [ ! -d "$BINDIR" ]; then
  mkdir -p "$BINDIR"
fi

DEBUG=0

# Parse command-line options
while getopts "b:d" opt; do
  case ${opt} in
    b )
      BINDIR=$OPTARG
      ;;
    d )
      set -x
      DEBUG=1
      ;;
    \? )
      usage
      ;;
  esac
done

echo "Installing to ${BINDIR}"
mkdir -p "${BINDIR}"

# Detect platform and architecture
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case $ARCH in
  x86_64)
    ARCH=amd64
    ;;
  aarch64)
    ARCH=arm64
    ;;
  *arm64*)
    ARCH=arm64
    ;;
  *arm*)
    ARCH=arm
    ;;
  *)
    echo "Architecture $ARCH is not supported"
    exit 1
    ;;
esac

# Fetch the latest release tag from GitHub
REPO="oneuptime/oneuptime"
API_URL="https://api.github.com/repos/${REPO}/releases/latest"
TAG=$(curl -s ${API_URL} | grep '"tag_name":' | sed -E 's/.*"tag_name": "([^"]+)".*/\1/')

if [ "$TAG" = "" ]; then
  echo "Failed to find the latest release. Please check your internet connection or GitHub API limits."
  exit 1
fi

echo "Fetching the latest release: $TAG"

# Construct the URL for the binary release
URL="https://github.com/${REPO}/releases/download/${TAG}/oneuptime-infrastructure-agent_${OS}_${ARCH}.tar.gz"

# Check if wget is installed otherwise install it, do it for all os'es

if ! command -v wget > /dev/null; then
  if [ "$OS" = "darwin" ]; then
    brew install wget
  fi
  if [ "$OS" = "linux" ]; then
    apt-get install wget
  fi
  if [ "$OS" = "freebsd" ]; then
    pkg install wget
  fi
  if [ "$OS" = "openbsd" ]; then
    pkg_add wget
  fi
fi

# Download and extract the binary
wget "${URL}" 

# if darwin

tar -xvzf "oneuptime-infrastructure-agent_${OS}_${ARCH}.tar.gz" -C "${BINDIR}"

# delete the downlaoded file
rm "oneuptime-infrastructure-agent_${OS}_${ARCH}.tar.gz"

# Check if the binary is executable
if [ ! -x "${BINDIR}/oneuptime-infrastructure-agent" ]; then
  echo "Failed to install oneuptime-infrastructure-agent"
  exit 1
fi

# Now add binary to path

if [ -f "$HOME/.bashrc" ]; then
  echo "export PATH=$PATH:$BINDIR" >> $HOME/.bashrc
  source $HOME/.bashrc
fi

if [ -f "$HOME/.bash_profile" ]; then
  echo "export PATH=$PATH:$BINDIR" >> $HOME/.bash_profile
  source $HOME/.bash_profile
fi

if [ -f "$HOME/.zshrc" ]; then
  echo "export PATH=$PATH:$BINDIR" >> $HOME/.zshrc
  source $HOME/.zshrc
fi

if [ -f "$HOME/.profile" ]; then
  echo "export PATH=$PATH:$BINDIR" >> $HOME/.profile
  source $HOME/.profile
fi

if [ -f "$HOME/.bash_login" ]; then
  echo "export PATH=$PATH:$BINDIR" >> $HOME/.bash_login
  source $HOME/.bash_login
fi

if [ -f "$HOME/.bash_logout" ]; then
  echo "export PATH=$PATH:$BINDIR" >> $HOME/.bash_logout
  source $HOME/.bash_logout
fi

if [ -f "$HOME/.bash_aliases" ]; then
  echo "export PATH=$PATH:$BINDIR" >> $HOME/.bash_aliases
  source $HOME/.bash_aliases
fi

if [ -f "$HOME/.bashrc" ]; then
  echo "export PATH=$PATH:$BINDIR" >> $HOME/.bashrc
  source $HOME/.bashrc
fi


echo "oneuptime-infrastructure-agent has been installed to ${BINDIR}"
echo "oneuptime-infrastructure-agent installed successfully to ${BINDIR}. Please configure the agent using 'oneuptime-infrastructure-agent configure'."
echo "Please reload your shell or open a new shell session to use the oneuptime-infrastructure-agent command."
