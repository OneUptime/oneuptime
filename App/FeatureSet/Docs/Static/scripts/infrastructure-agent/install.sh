#!/bin/sh
set -e

usage() {
  echo "Usage: $0 [-b bindir] [-d]"
  echo "  -b sets the directory for the binary installation, default is./bin"
  echo "  -d enables debug mode"
  exit 1
}

# Set HOME environment variable if it's not set
if [ -z "$HOME" ]; then
  HOME=/usr
fi

# Default parameters
BINDIR=$HOME/bin

# Create bindir if it doesn't exist
if [! -d "$BINDIR" ]; then
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

# Install to specified directory
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
TAG=$(curl -s ${API_URL} | grep '"tag_name":' | sed -E's/.*"tag_name": "([^"]+)".*/\1/')

if [ "$TAG" = "" ]; then
  echo "Failed to find the latest release. Please check your internet connection or GitHub API limits."
  exit 1
fi

# Construct the URL for the binary release
URL="https://github.com/${REPO}/releases/download/${TAG}/oneuptime-infrastructure-agent_${OS}_${ARCH}.tar.gz"

# Check if wget is installed
if! command -v wget > /dev/null; then
  # Install wget for different OS'es
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

Here is the code with improved comments:

    # Exit with an error message if the installation fails
    echo "Failed to install oneuptime-infrastructure-agent"
  exit 1
fi

# Add the binary to the system's PATH
# This is done by appending the export statement to the corresponding configuration file
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

# Notify the user that the installation was successful
echo "oneuptime-infrastructure-agent has been installed to ${BINDIR}"
echo "oneuptime-infrastructure-agent installed successfully to ${BINDIR}. Please configure the agent using 'oneuptime-infrastructure-agent configure'."
echo "Please reload your shell or open a new shell session to use the oneuptime-infrastructure-agent command."