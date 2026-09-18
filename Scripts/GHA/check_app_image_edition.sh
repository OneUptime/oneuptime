#!/usr/bin/env bash

set -euo pipefail

usage() {
	cat <<'EOF'
Usage: check_app_image_edition.sh --image <ref> --edition <community|enterprise>

Checks that a locally built App image (packages/App/Dockerfile.tpl) is the
edition it claims to be. The Build workflow runs it on both targets of every
pull request, because the two images come out of one Dockerfile and nothing
else would notice a Community image that picked up ee/, or an Enterprise image
whose bundles quietly fell back to the Community UI.

Image metadata (docker image inspect):
  - labels com.oneuptime.edition and org.opencontainers.image.licenses
  - USER node, CMD npm start, TS_NODE_TRANSPILE_ONLY=1
  - IS_ENTERPRISE_EDITION=true|false (informational)
  - ONEUPTIME_EDITION=enterprise on the Enterprise image (the loader's marker
    that ee/ must load) and unset on the Community image

Image contents (docker run):
  community   no /usr/src/ee and no /usr/src/packages; the Dashboard and Admin
              Dashboard bundles do not contain the Enterprise UI sentinels
  enterprise  /usr/src/ee/Server/Index.ts is there, ee's node_modules links
              Common and App to /usr/src/Common and /usr/src/app, its dev
              dependencies are pruned, no tests or key material shipped, and
              both bundles contain their sentinel

Required flags:
	--image <ref>                       Image reference to check
	--edition <community|enterprise>    The edition the image must be
EOF
}

IMAGE=""
EDITION=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--image)
			IMAGE="$2"
			shift 2
			;;
		--edition)
			EDITION="$2"
			shift 2
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			echo "Unknown option: $1" >&2
			usage
			exit 1
			;;
	esac
done

if [[ -z "$IMAGE" || -z "$EDITION" ]]; then
	echo "Missing required arguments" >&2
	usage
	exit 1
fi

if [[ "$EDITION" != "community" && "$EDITION" != "enterprise" ]]; then
	echo "--edition must be community or enterprise (got '${EDITION}')" >&2
	exit 1
fi

echo "🔍 Checking ${IMAGE} is the ${EDITION} edition"

FAILED=0

# --- Metadata ---------------------------------------------------------------
if ! CONFIG_JSON="$(docker image inspect --format '{{json .Config}}' "$IMAGE")"; then
	echo "❌ Could not inspect ${IMAGE}" >&2
	exit 1
fi

if ! python3 - "$EDITION" "$CONFIG_JSON" <<'PY'
import json
import sys

edition = sys.argv[1]
config = json.loads(sys.argv[2])
labels = config.get("Labels") or {}
env = {}
for entry in config.get("Env") or []:
    key, _, value = entry.partition("=")
    env[key] = value

expected_licenses = {
    "community": "Apache-2.0",
    "enterprise": "Apache-2.0 AND LicenseRef-OneUptime-Enterprise",
}[edition]

checks = [
    ("label com.oneuptime.edition is " + edition,
     labels.get("com.oneuptime.edition") == edition),
    ("label org.opencontainers.image.licenses is " + expected_licenses,
     labels.get("org.opencontainers.image.licenses") == expected_licenses),
    ("runs as the node user", config.get("User") == "node"),
    ("CMD is npm start", config.get("Cmd") == ["npm", "start"]),
    ("boots transpile-only (TS_NODE_TRANSPILE_ONLY=1)",
     env.get("TS_NODE_TRANSPILE_ONLY") == "1"),
    ("IS_ENTERPRISE_EDITION is " + ("true" if edition == "enterprise" else "false"),
     env.get("IS_ENTERPRISE_EDITION") == ("true" if edition == "enterprise" else "false")),
]

if edition == "enterprise":
    checks.append(("ONEUPTIME_EDITION=enterprise (ee/ must load)",
                   env.get("ONEUPTIME_EDITION") == "enterprise"))
else:
    checks.append(("ONEUPTIME_EDITION is not set (auto)",
                   "ONEUPTIME_EDITION" not in env))

failed = False
for description, ok in checks:
    print(("✅ " if ok else "❌ ") + description)
    failed = failed or not ok

sys.exit(1 if failed else 0)
PY
then
	FAILED=1
fi

# --- Contents -----------------------------------------------------------------
# POSIX sh, because it runs inside the Alpine image. ROOT is empty there; the
# tests point it at a fake image tree instead.
read -r -d '' CONTENT_CHECKS <<'SH' || true
ROOT="${ROOT:-}"
EDITION="$1"
DASHBOARD_DIST="$ROOT/usr/src/app/FeatureSet/Dashboard/public/dist"
ADMIN_DIST="$ROOT/usr/src/app/FeatureSet/AdminDashboard/public/dist"
DASHBOARD_SENTINEL="ONEUPTIME_EE_DASHBOARD_PLUGIN_v1"
ADMIN_SENTINEL="ONEUPTIME_EE_ADMIN_DASHBOARD_PLUGIN_v1"
EE="$ROOT/usr/src/ee"
failed=0
check() {
	description="$1"
	shift
	if "$@"; then
		echo "✅ $description"
	else
		echo "❌ $description"
		failed=1
	fi
}
no_file_matching() {
	[ -z "$(find "$EE" -path "$EE/node_modules" -prune -o \( -name '*.pem' -o -name keys \) -print 2>/dev/null)" ]
}
lacks_sentinels() {
	! grep -rqF -e "$DASHBOARD_SENTINEL" -e "$ADMIN_SENTINEL" "$DASHBOARD_DIST" "$ADMIN_DIST"
}
links_to() {
	[ "$(readlink -f "$1")" = "$2" ]
}
check "the Dashboard bundle exists" test -d "$DASHBOARD_DIST"
check "the Admin Dashboard bundle exists" test -d "$ADMIN_DIST"
if [ "$EDITION" = "enterprise" ]; then
	check "ee/ is at /usr/src/ee" test -f "$EE/Server/Index.ts"
	check "ee's Common dependency is /usr/src/Common" links_to "$EE/node_modules/Common" "$ROOT/usr/src/Common"
	check "ee's App dependency is /usr/src/app" links_to "$EE/node_modules/App" "$ROOT/usr/src/app"
	check "ee's dev dependencies are pruned" test ! -e "$EE/node_modules/typescript"
	check "ee's tests are not shipped" test ! -e "$EE/Tests"
	check "no key material under ee/" no_file_matching
	check "the Dashboard bundle contains the Enterprise UI" grep -rqF "$DASHBOARD_SENTINEL" "$DASHBOARD_DIST"
	check "the Admin Dashboard bundle contains the Enterprise UI" grep -rqF "$ADMIN_SENTINEL" "$ADMIN_DIST"
else
	check "there is no /usr/src/ee" test ! -e "$EE"
	check "there is no /usr/src/packages" test ! -e "$ROOT/usr/src/packages"
	check "the bundles do not contain the Enterprise UI" lacks_sentinels
fi
exit "$failed"
SH

if ! docker run --rm --entrypoint sh "$IMAGE" -c "$CONTENT_CHECKS" check-edition "$EDITION"; then
	FAILED=1
fi

if [[ "$FAILED" -ne 0 ]]; then
	echo "❌ ${IMAGE} is not a correct ${EDITION} edition image" >&2
	exit 1
fi

echo "✅ ${IMAGE} is the ${EDITION} edition"
