#!/usr/bin/env bash
#
# Signs the agent's release APK with apksigner, with the v1 (JAR), v2 and v3
# schemes, and refuses to finish unless all three verify.
#
# Why not Gradle's signingConfig: with a minSdk of 24 the Android Gradle
# plugin leaves the v1 signature out even when told to sign with it, and Esper
# refuses an APK that has none. apksigner signs with v1 when told to.
#
# Usage: scripts/sign-release.sh <unsigned.apk> <signed.apk>
#
# Environment (RELEASING.md says where each comes from):
#   ANDROID_AGENT_KEYSTORE_FILE      the release keystore (.jks)
#   ANDROID_AGENT_KEYSTORE_PASSWORD  its password
#   ANDROID_AGENT_KEY_ALIAS          the signing key's alias in it
#   ANDROID_AGENT_KEY_PASSWORD       the key's password
#   ANDROID_HOME                     the Android SDK, with build-tools
#   BUILD_TOOLS_VERSION              optional, 36.0.0 by default
#
# The passwords are handed to apksigner by variable name (env:), so they are
# never on a command line, where `ps` would show them.

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <unsigned.apk> <signed.apk>" >&2
  exit 2
fi

unsigned=$1
signed=$2

for variable in ANDROID_AGENT_KEYSTORE_FILE ANDROID_AGENT_KEYSTORE_PASSWORD ANDROID_AGENT_KEY_ALIAS ANDROID_AGENT_KEY_PASSWORD ANDROID_HOME; do
  if [ -z "${!variable:-}" ]; then
    echo "$variable is not set." >&2
    exit 1
  fi
done

if [ ! -f "$unsigned" ]; then
  echo "No APK at $unsigned." >&2
  exit 1
fi
if [ ! -f "$ANDROID_AGENT_KEYSTORE_FILE" ]; then
  echo "No keystore at ANDROID_AGENT_KEYSTORE_FILE." >&2
  exit 1
fi

build_tools="$ANDROID_HOME/build-tools/${BUILD_TOOLS_VERSION:-36.0.0}"
if [ ! -x "$build_tools/apksigner" ] || [ ! -x "$build_tools/zipalign" ]; then
  echo "No apksigner or zipalign in $build_tools." >&2
  exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Align before signing: a v2 or v3 signature covers the file as it is, so
# aligning after would break it.
"$build_tools/zipalign" -p -f 4 "$unsigned" "$work/aligned.apk"

"$build_tools/apksigner" sign \
  --ks "$ANDROID_AGENT_KEYSTORE_FILE" \
  --ks-key-alias "$ANDROID_AGENT_KEY_ALIAS" \
  --ks-pass env:ANDROID_AGENT_KEYSTORE_PASSWORD \
  --key-pass env:ANDROID_AGENT_KEY_PASSWORD \
  --v1-signing-enabled true \
  --v2-signing-enabled true \
  --v3-signing-enabled true \
  --min-sdk-version 24 \
  --out "$signed" \
  "$work/aligned.apk"

# Verified as Android 6 would: for 7 and later apksigner skips the v1
# signature (nothing that new reads it), and would report it missing.
report=$("$build_tools/apksigner" verify --verbose --print-certs --min-sdk-version 23 "$signed")

for scheme in v1 v2 v3; do
  if ! grep -Eq "^Verified using $scheme scheme .*: true$" <<<"$report"; then
    echo "$signed is not signed with the $scheme scheme:" >&2
    echo "$report" >&2
    exit 1
  fi
done

echo "Signed $signed with the v1, v2 and v3 schemes."
# The certificate's digest: what RELEASING.md records, and what a device manager shows.
grep -E "certificate SHA-256 digest" <<<"$report" | head -n 1
