#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/../.." && pwd)
cd "${REPO_ROOT}"

# Ensure GITHUB_WORKSPACE points to repo root for local runs
export GITHUB_WORKSPACE="${GITHUB_WORKSPACE:-$REPO_ROOT}"

required_env_vars=(
  MANIFEST_SOURCE_PATH
  PWA_ORIGIN
  PACKAGE_ID
  HOST_NAME
  MANIFEST_URL
  VERSION_NAME
  VERSION_CODE
)

for var in "${required_env_vars[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    echo "Missing required environment variable: ${var}" >&2
    exit 1
  fi
done

ANDROID_HOME="${ANDROID_HOME:-/usr/local/lib/android/sdk}"
ANDROID_SDK_ROOT="${ANDROID_HOME}"
export ANDROID_HOME ANDROID_SDK_ROOT

SDK_MANAGER="${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager"
if [[ ! -x "${SDK_MANAGER}" ]]; then
  echo "Android sdkmanager not found at ${SDK_MANAGER}" >&2
  exit 1
fi

yes | "${SDK_MANAGER}" --sdk_root="${ANDROID_HOME}" --licenses >/dev/null
yes | "${SDK_MANAGER}" --sdk_root="${ANDROID_HOME}" \
  "platform-tools" \
  "platforms;android-34" \
  "build-tools;34.0.0"

if ! command -v bubblewrap >/dev/null 2>&1; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm is required to install @bubblewrap/cli" >&2
    exit 1
  fi
  npm install -g @bubblewrap/cli >/dev/null
  echo "Installed @bubblewrap/cli" >&2
fi

WORK_DIR="${REPO_ROOT}/android"
rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}"

KEYSTORE_PATH="${REPO_ROOT}/android.keystore"
SIGNING_KEYSTORE_BASE64="${SIGNING_KEYSTORE_BASE64:-}"
SIGNING_KEY_ALIAS="${SIGNING_KEY_ALIAS:-}"
SIGNING_KEY_PASSWORD="${SIGNING_KEY_PASSWORD:-}"
SIGNING_STORE_PASSWORD="${SIGNING_STORE_PASSWORD:-}"

if [[ -n "${SIGNING_KEYSTORE_BASE64}" ]]; then
  printf '%s' "${SIGNING_KEYSTORE_BASE64}" | base64 --decode > "${KEYSTORE_PATH}"
  STORE_PASS="${SIGNING_STORE_PASSWORD:-android}"
  KEY_PASS="${SIGNING_KEY_PASSWORD:-${STORE_PASS}}"
  KEY_ALIAS="${SIGNING_KEY_ALIAS:-release}"
  echo "Restored signing key from workflow input" >&2
else
  STORE_PASS="${SIGNING_STORE_PASSWORD:-android}"
  KEY_PASS="${SIGNING_KEY_PASSWORD:-${STORE_PASS}}"
  KEY_ALIAS="${SIGNING_KEY_ALIAS:-oneuptimeDebug}"
  keytool -genkeypair \
    -keystore "${KEYSTORE_PATH}" \
    -storepass "${STORE_PASS}" \
    -alias "${KEY_ALIAS}" \
    -keypass "${KEY_PASS}" \
    -validity 3650 \
    -keyalg RSA \
    -dname "CN=OneUptime, OU=Engineering, O=OneUptime, L=San Francisco, S=CA, C=US"
  echo "Generated temporary debug keystore" >&2
fi

export SIGNING_ALIAS="${KEY_ALIAS}"
export SIGNING_KEY_PASS="${KEY_PASS}"
export SIGNING_STORE_PASS="${STORE_PASS}"

node <<'NODE'
const fs = require('fs');
const path = require('path');

const manifestPath = path.join(process.env.GITHUB_WORKSPACE, process.env.MANIFEST_SOURCE_PATH);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const icons = manifest.icons || [];
const pickIcon = (predicate) => icons.find(predicate) || icons[0];
const bestIcon = pickIcon((icon) => /512x512/.test(icon?.sizes || ''));
const maskableIcon = pickIcon((icon) => (icon?.purpose || '').includes('maskable'));
const toAbsolute = (src) => (src ? new URL(src, process.env.PWA_ORIGIN).href : undefined);

const twaManifest = {
  packageId: process.env.PACKAGE_ID,
  host: process.env.HOST_NAME,
  name: manifest.name || manifest.short_name || 'OneUptime',
  launcherName: manifest.short_name || manifest.name || 'OneUptime',
  display: manifest.display || 'standalone',
  themeColor: manifest.theme_color || '#000000',
  navigationColor: manifest.theme_color || '#000000',
  backgroundColor: manifest.background_color || '#ffffff',
  enableNotifications: true,
  startUrl: manifest.start_url || '/dashboard/',
  webManifestUrl: process.env.MANIFEST_URL,
  iconUrl: toAbsolute(bestIcon?.src),
  maskableIconUrl: toAbsolute(maskableIcon?.src || bestIcon?.src),
  shortcuts: manifest.shortcuts || [],
  appVersion: process.env.VERSION_NAME,
  appVersionCode: Number(process.env.VERSION_CODE),
  signingKey: {
    path: path.join(process.env.GITHUB_WORKSPACE, 'android.keystore'),
    alias: process.env.SIGNING_ALIAS,
    password: process.env.SIGNING_KEY_PASS,
    keystorePassword: process.env.SIGNING_STORE_PASS
  },
  features: {
    notifications: {
      enabled: true
    }
  },
  splashScreenFadeOutDuration: 300
};

const outputPath = path.join(process.env.GITHUB_WORKSPACE, 'android', 'twa-manifest.json');
fs.writeFileSync(outputPath, JSON.stringify(twaManifest, null, 2));
NODE

echo "Wrote TWA manifest to ${WORK_DIR}/twa-manifest.json" >&2

(
  cd "${WORK_DIR}"
  bubblewrap init --suppressPrompts
  bubblewrap build
)

echo "Built APK with Bubblewrap" >&2

APK_PATH=$(find "${WORK_DIR}" -type f -name "*release*.apk" | head -n 1)
if [[ -z "${APK_PATH}" ]]; then
  echo "Failed to locate release APK" >&2
  exit 1
fi

echo "Located APK at ${APK_PATH}" >&2

printf '%s\n' "${APK_PATH}"
