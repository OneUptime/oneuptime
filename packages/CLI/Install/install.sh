#!/usr/bin/env bash
#
# Installs the OneUptime CLI (`oneuptime`, the npm package @oneuptime/cli)
# of the version of the OneUptime it talks to.
#
# Every OneUptime serves this script itself, at <your OneUptime>/install/cli:
#
#   curl -fsSL https://oneuptime.com/install/cli -o install.sh
#   ONEUPTIME_URL=https://oneuptime.com bash install.sh
#
# With ONEUPTIME_URL it asks that OneUptime for its version (GET /api/version,
# which needs no key) and installs the CLI of the same version, so the CLI's
# commands match the resources that server has. Without it, it installs the
# newest CLI. ONEUPTIME_CLI_VERSION picks a version of your own.
#
# It needs Node.js 22 or later, and npm. It installs nothing else, changes no
# system setting, and needs no root unless npm's global folder does.

set -euo pipefail

PACKAGE="@oneuptime/cli"
MINIMUM_NODE_MAJOR=22
# What a development build of OneUptime reports: it names no release.
DEVELOPMENT_VERSION="1.0.0"

say() {
  printf '%s\n' "$*"
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

# A release's version: three numbers and nothing else.
is_release_version() {
  case "$1" in
    "" | *[!0-9.]* | .* | *. | *..*) return 1 ;;
  esac

  local dots="${1//[^.]/}"

  [ "${#dots}" -eq 2 ] && [ "$1" != "$DEVELOPMENT_VERSION" ]
}

if ! command -v node > /dev/null 2>&1 || ! command -v npm > /dev/null 2>&1; then
  fail "The OneUptime CLI needs Node.js ${MINIMUM_NODE_MAJOR} or later, with npm. Install it from https://nodejs.org, or with your package manager, then run this script again."
fi

NODE_VERSION="$(node --version 2> /dev/null || true)"
NODE_MAJOR="${NODE_VERSION#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"

case "$NODE_MAJOR" in
  "" | *[!0-9]*) fail "Could not read the version of Node.js (node --version said \"${NODE_VERSION}\")." ;;
esac

if [ "$NODE_MAJOR" -lt "$MINIMUM_NODE_MAJOR" ]; then
  fail "The OneUptime CLI needs Node.js ${MINIMUM_NODE_MAJOR} or later, and this is Node.js ${NODE_VERSION}. Install a newer one from https://nodejs.org, then run this script again."
fi

ONEUPTIME_URL="${ONEUPTIME_URL:-}"
ONEUPTIME_URL="${ONEUPTIME_URL%/}"
VERSION="${ONEUPTIME_CLI_VERSION:-}"

if [ -n "$VERSION" ]; then
  is_release_version "$VERSION" || fail "ONEUPTIME_CLI_VERSION takes a version such as 14.0.101, and \"${VERSION}\" is not one."
  say "Installing the OneUptime CLI ${VERSION}, as ONEUPTIME_CLI_VERSION says."
elif [ -n "$ONEUPTIME_URL" ]; then
  if ! command -v curl > /dev/null 2>&1; then
    fail "This script asks ${ONEUPTIME_URL} for its version with curl, which is not installed. Install curl, or set ONEUPTIME_CLI_VERSION to your OneUptime's version."
  fi

  ANSWER="$(curl -fsS --max-time 30 "${ONEUPTIME_URL}/api/version" 2> /dev/null || true)"
  # {"version":"14.0.101","commit":"..."}: the version's value.
  SERVER_VERSION="$(printf '%s' "$ANSWER" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"

  if [ -z "$ANSWER" ]; then
    fail "Could not reach ${ONEUPTIME_URL}/api/version. Check ONEUPTIME_URL: it is the address you open OneUptime at, such as https://oneuptime.com."
  fi

  if is_release_version "$SERVER_VERSION"; then
    VERSION="$SERVER_VERSION"
    say "${ONEUPTIME_URL} is OneUptime ${VERSION}: installing the OneUptime CLI of the same version."
  else
    say "${ONEUPTIME_URL} did not say which release it is: installing the newest OneUptime CLI."
  fi
else
  say "Installing the newest OneUptime CLI. To install the one of your OneUptime's version, run this script with ONEUPTIME_URL set to its address."
fi

SPEC="$PACKAGE"

if [ -n "$VERSION" ]; then
  SPEC="${PACKAGE}@${VERSION}"
fi

if ! npm install --global --no-fund --no-audit "$SPEC"; then
  PREFIX="$(npm config get prefix 2> /dev/null || true)"

  if [ -n "$PREFIX" ] && [ ! -w "$PREFIX" ]; then
    fail "npm could not write to its global folder, ${PREFIX}. Run this script with sudo, or give npm a folder of your own: npm config set prefix ~/.npm-global, add ~/.npm-global/bin to your PATH, and run it again."
  fi

  fail "npm could not install ${SPEC}. Its messages above say why."
fi

if ! command -v oneuptime > /dev/null 2>&1; then
  fail "npm installed ${SPEC}, but oneuptime is not on your PATH. Add npm's global bin folder to it: $(npm config get prefix 2> /dev/null || true)/bin."
fi

INSTALLED="$(oneuptime --version 2> /dev/null || true)"

say ""
say "Installed the OneUptime CLI ${INSTALLED}."
say ""
say "Connect it to OneUptime with a project API key (Project Settings > Advanced > API Keys):"
say ""
say "  export ONEUPTIME_API_KEY=\"your-api-key\""

if [ -n "$ONEUPTIME_URL" ]; then
  say "  export ONEUPTIME_URL=\"${ONEUPTIME_URL}\""
else
  say "  export ONEUPTIME_URL=\"https://oneuptime.com\""
fi

say "  oneuptime whoami --check"
