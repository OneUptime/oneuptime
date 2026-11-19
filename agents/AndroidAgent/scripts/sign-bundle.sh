#!/usr/bin/env bash
#
# Signs the agent's release bundle (.aab) with the upload key, the key Google
# Play takes the bundle with, and refuses to finish unless every entry of it
# verifies.
#
# The upload key only proves to Play that the bundle is OneUptime's: Play
# signs the APKs it delivers to devices with the app signing key (Play App
# Signing, RELEASING.md). A bundle is signed the way a JAR is, with
# jarsigner: apksigner signs APKs only.
#
# Usage: scripts/sign-bundle.sh <unsigned.aab> <signed.aab>
#
# Environment (RELEASING.md says where each comes from):
#   ANDROID_AGENT_UPLOAD_KEYSTORE_FILE      the upload keystore (.jks)
#   ANDROID_AGENT_UPLOAD_KEYSTORE_PASSWORD  its password
#   ANDROID_AGENT_UPLOAD_KEY_ALIAS          the upload key's alias in it
#   ANDROID_AGENT_UPLOAD_KEY_PASSWORD       the key's password
#
# jarsigner and keytool are the JDK's, from PATH. The passwords are handed to
# jarsigner by variable name (:env), so they are never on a command line,
# where `ps` would show them.

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <unsigned.aab> <signed.aab>" >&2
  exit 2
fi

unsigned=$1
signed=$2

for variable in ANDROID_AGENT_UPLOAD_KEYSTORE_FILE ANDROID_AGENT_UPLOAD_KEYSTORE_PASSWORD ANDROID_AGENT_UPLOAD_KEY_ALIAS ANDROID_AGENT_UPLOAD_KEY_PASSWORD; do
  if [ -z "${!variable:-}" ]; then
    echo "$variable is not set." >&2
    exit 1
  fi
done

if [ ! -f "$unsigned" ]; then
  echo "No bundle at $unsigned." >&2
  exit 1
fi
if [ ! -f "$ANDROID_AGENT_UPLOAD_KEYSTORE_FILE" ]; then
  echo "No keystore at ANDROID_AGENT_UPLOAD_KEYSTORE_FILE." >&2
  exit 1
fi
for tool in jarsigner keytool; do
  if ! command -v "$tool" > /dev/null; then
    echo "No $tool on PATH: it comes with a JDK." >&2
    exit 1
  fi
done

# A wrong password or alias is a "jarsigner error" in this output.
output=$(jarsigner \
  -keystore "$ANDROID_AGENT_UPLOAD_KEYSTORE_FILE" \
  -storepass:env ANDROID_AGENT_UPLOAD_KEYSTORE_PASSWORD \
  -keypass:env ANDROID_AGENT_UPLOAD_KEY_PASSWORD \
  -sigalg SHA256withRSA \
  -digestalg SHA-256 \
  -signedjar "$signed" \
  "$unsigned" \
  "$ANDROID_AGENT_UPLOAD_KEY_ALIAS" 2>&1) || {
  echo "jarsigner could not sign $unsigned:" >&2
  echo "$output" >&2
  exit 1
}

# jarsigner verifies a bundle with some entries unsigned, and only warns
# about them: the bundle must have none.
report=$(jarsigner -verify "$signed" 2>&1) || {
  echo "$signed does not verify:" >&2
  echo "$report" >&2
  exit 1
}
if ! grep -q "^jar verified\.$" <<<"$report" || grep -qi "unsigned entries" <<<"$report"; then
  echo "$signed is not signed in full:" >&2
  echo "$report" >&2
  exit 1
fi

echo "Signed $signed with the upload key."
# The upload certificate's digest: the Play Console shows it, under Play app
# signing, and refuses a bundle signed with any other.
certificate=$(keytool -printcert -jarfile "$signed")
grep -m 1 -E "^[[:space:]]*SHA256:" <<<"$certificate" | sed -E 's/^[[:space:]]*/Upload certificate /'
