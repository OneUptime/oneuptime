#!/usr/bin/env bash

set -euo pipefail

usage() {
	cat <<'EOF'
Usage: check_app_image_edition.sh --image <ref> --edition <community|enterprise>

Checks that an App image (packages/App/Dockerfile.tpl) is the edition it claims
to be. The Build workflow runs it on both targets of every pull request, and the
release workflows run it on the App tags their e2e jobs pull, before those tags
are promoted. The two images come out of one Dockerfile, and nothing else would
notice a Community image that picked up ee/, or an Enterprise image whose
bundles quietly fell back to the Community UI or whose ee/ no longer loads.

Image metadata (docker image inspect):
  - labels com.oneuptime.edition and org.opencontainers.image.licenses
  - USER node, CMD npm start, TS_NODE_TRANSPILE_ONLY=1
  - IS_ENTERPRISE_EDITION=true|false (informational)
  - ONEUPTIME_EDITION=enterprise on the Enterprise image (the loader's marker
    that ee/ must load) and unset on the Community image

Image contents (docker run as root, so every directory can be searched):
  both        /usr/src/LICENSE is the Apache License 2.0, and /usr/src/NOTICE
              says that ee/ is under the OneUptime Enterprise License
  community   no /usr/src/ee and no /usr/src/packages; no Enterprise Edition
              file anywhere in the image, wherever ee/ was copied to (a LICENSE
              titled "OneUptime Enterprise License", or ee's TrustedLicenseKeys
              module); the Dashboard and Admin Dashboard bundles do not contain
              the Enterprise UI sentinels
  enterprise  /usr/src/ee/Server/Index.ts and /usr/src/ee/LICENSE are there,
              and no Enterprise Edition file is outside /usr/src/ee; ee's
              node_modules links Common and App to /usr/src/Common and
              /usr/src/app; its dev dependencies are pruned; no tests or key
              material shipped; both bundles contain their sentinel

Boot probe (docker run as the image's own user, no network, no database):
  Runs the real Enterprise loader (/usr/src/app/Utils/EnterpriseLoader.ts)
  with node and ts-node, the way `npm start` does, and reads what it did.
  community   the loader finds no ee/ (outcome "not-found")
  enterprise  the loader loads ee/ (outcome "loaded"); ee resolves the same
              EnterpriseEdition module core does, and only one is loaded; when
              the image's org.opencontainers.image.version label is a release
              version (digits and dots), the module reports that version

Required flags:
	--image <ref>                       Image reference to check
	--edition <community|enterprise>    The edition the image must be

Environment:
	CHECK_APP_IMAGE_EDITION_PROBE_TIMEOUT_SECONDS
	                                    How long the boot probe may run
	                                    (default 300)
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

PROBE_TIMEOUT_SECONDS="${CHECK_APP_IMAGE_EDITION_PROBE_TIMEOUT_SECONDS:-300}"
if ! [[ "$PROBE_TIMEOUT_SECONDS" =~ ^[1-9][0-9]{0,4}$ ]]; then
	echo "CHECK_APP_IMAGE_EDITION_PROBE_TIMEOUT_SECONDS must be a whole number of seconds from 1 to 99999 (got '${PROBE_TIMEOUT_SECONDS}')" >&2
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
# POSIX sh, because it runs inside the Alpine image (BusyBox find and grep: no
# --exclude-dir, no -printf). ROOT is empty there; the tests point it at a fake
# image tree instead.
read -r -d '' CONTENT_CHECKS <<'SH' || true
ROOT="${ROOT:-}"
EDITION="$1"
DASHBOARD_DIST="$ROOT/usr/src/app/FeatureSet/Dashboard/public/dist"
ADMIN_DIST="$ROOT/usr/src/app/FeatureSet/AdminDashboard/public/dist"
DASHBOARD_SENTINEL="ONEUPTIME_EE_DASHBOARD_PLUGIN_v1"
ADMIN_SENTINEL="ONEUPTIME_EE_ADMIN_DASHBOARD_PLUGIN_v1"
ENTERPRISE_LICENSE_TITLE="OneUptime Enterprise License"
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
list_files() {
	printf '%s\n' "$1" | while IFS= read -r file; do
		if [ -n "$file" ]; then
			echo "   found: $file"
		fi
	done
}
no_file_matching() {
	[ -z "$(find "$EE" -path "$EE/node_modules" -prune -o \( -name '*.pem' -o -name '*.key' -o -name '*.p8' -o -name '*.der' -o -name keys \) -print 2>/dev/null)" ]
}
lacks_sentinels() {
	! grep -rqF -e "$DASHBOARD_SENTINEL" -e "$ADMIN_SENTINEL" "$DASHBOARD_DIST" "$ADMIN_DIST"
}
links_to() {
	[ "$(readlink -f "$1")" = "$2" ]
}
is_apache_license() {
	grep -qF "Apache License" "$1" 2>/dev/null && grep -qF "Version 2.0, January 2004" "$1"
}
is_enterprise_license() {
	head -n 1 "$1" 2>/dev/null | grep -qF "$ENTERPRISE_LICENSE_TITLE"
}
states_the_license_split() {
	grep -qF '"ee/"' "$1" 2>/dev/null && grep -qF "$ENTERPRISE_LICENSE_TITLE" "$1"
}
# Files only ee/ has, wherever they are in the image: a LICENSE whose first line
# is the Enterprise License title, and ee's TrustedLicenseKeys module. The scan
# stays on the image's own filesystem and skips node_modules (the dependencies'
# own LICENSE files; ee's Common and App in there are links).
enterprise_files() {
	find "${ROOT:-/}" -xdev \( -path "$ROOT/proc" -o -path "$ROOT/sys" -o -name node_modules \) -prune -o -type f \( -name LICENSE -o -name 'TrustedLicenseKeys.*' \) -print 2>/dev/null |
		while IFS= read -r file; do
			if [ "${file##*/}" = LICENSE ] && ! is_enterprise_license "$file"; then
				continue
			fi
			echo "${file#"$ROOT"}"
		done
}
ENTERPRISE_FILES="$(enterprise_files)"
check "the Dashboard bundle exists" test -d "$DASHBOARD_DIST"
check "the Admin Dashboard bundle exists" test -d "$ADMIN_DIST"
check "/usr/src/LICENSE is the Apache License 2.0" is_apache_license "$ROOT/usr/src/LICENSE"
check "/usr/src/NOTICE says ee/ is under the OneUptime Enterprise License" states_the_license_split "$ROOT/usr/src/NOTICE"
if [ "$EDITION" = "enterprise" ]; then
	OUTSIDE_EE="$(printf '%s\n' "$ENTERPRISE_FILES" | grep -v -e '^/usr/src/ee/' -e '^$')"
	check "ee/ is at /usr/src/ee" test -f "$EE/Server/Index.ts"
	check "/usr/src/ee/LICENSE is the OneUptime Enterprise License" is_enterprise_license "$EE/LICENSE"
	check "no Enterprise Edition file outside /usr/src/ee" test -z "$OUTSIDE_EE"
	list_files "$OUTSIDE_EE"
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
	check "no Enterprise Edition file anywhere in the image" test -z "$ENTERPRISE_FILES"
	list_files "$ENTERPRISE_FILES"
	check "the bundles do not contain the Enterprise UI" lacks_sentinels
fi
exit "$failed"
SH

if ! docker run --rm --user root --entrypoint sh "$IMAGE" -c "$CONTENT_CHECKS" check-edition "$EDITION"; then
	FAILED=1
fi

# --- Boot probe ---------------------------------------------------------------
# Every file can be in place and ee/ still not load: a dependency that
# `npm prune --omit=dev` removed, a file the node user cannot read, ee's Common
# resolving to a second copy of EnterpriseEdition. So run the real loader in the
# image, the way `npm start` runs node, and ask it what it did. load() needs no
# database: init() and the first license read fail or time out on their own,
# and the loader only logs that. The probe asks for edition "auto", so it
# reports what is on disk; the image's marker (ONEUPTIME_EDITION=enterprise,
# which makes a missing ee/ fatal) is checked above. init() can leave database
# and Redis handles open, so the probe always exits explicitly, and its
# watchdog makes a hung loader a failure instead of a hung check.
read -r -d '' BOOT_PROBE <<'JS' || true
"use strict";
const fs = require("fs");
const path = require("path");
const appRoot = process.cwd();
const timeoutInMs = Number(process.env.EE_PROBE_TIMEOUT_MS) || 300000;
const finish = (code, line) => {
  process.stdout.write("\n" + line + "\n", () => {
    process.exit(code);
  });
};
const fail = (err) => {
  const message = err && err.message ? err.message : String(err);
  finish(1, "EE_PROBE_FAILED " + message.replace(/\s+/g, " ").trim());
};
setTimeout(() => {
  fail(new Error("the Enterprise loader did not finish within " + timeoutInMs + " ms"));
}, timeoutInMs);
const EDITION_MODULE = "Common/Server/Enterprise/EnterpriseEdition";
const resolveEditionFrom = (directory) => {
  return fs.realpathSync(require.resolve(EDITION_MODULE, { paths: [directory] }));
};
Promise.resolve()
  .then(() => {
    const loader = require(path.join(appRoot, "Utils", "EnterpriseLoader")).default;
    return loader.load({
      edition: "auto",
      initTimeoutInMs: 5000,
      licenseLoadTimeoutInMs: 5000,
      isBillingEnabled: false,
      allowBillingWithoutEnterprise: false,
      isEnterpriseEditionRequested: false,
    });
  })
  .then((result) => {
    const editionFile = resolveEditionFrom(appRoot);
    const EnterpriseEdition = require(editionFile).default;
    const enterpriseModule = EnterpriseEdition.getModule();
    const report = {
      outcome: result.outcome,
      directory: result.directory,
      isLoaded: EnterpriseEdition.isLoaded(),
      version: enterpriseModule ? enterpriseModule.version : null,
      enterpriseEditionFile: editionFile,
      eeEnterpriseEditionFile: result.directory ? resolveEditionFrom(result.directory) : null,
      loadedEnterpriseEditionFiles: Object.keys(require.cache).filter((file) => {
        return /[\\/]Server[\\/]Enterprise[\\/]EnterpriseEdition\.[jt]s$/.test(file);
      }),
      initCompleted: result.initCompleted,
      initError: result.initError,
      licenseStatus: result.licenseSnapshot ? result.licenseSnapshot.status : null,
    };
    finish(0, "EE_PROBE " + JSON.stringify(report));
  })
  .catch(fail);
JS

PROBE_COMMAND=(
	docker run --rm --network none -w /usr/src/app
	-e BILLING_ENABLED=false
	-e TS_NODE_TRANSPILE_ONLY=1
	-e "EE_PROBE_TIMEOUT_MS=$(( PROBE_TIMEOUT_SECONDS * 1000 ))"
	--entrypoint node "$IMAGE"
	--no-node-snapshot --max-old-space-size=8096 --require ts-node/register
	-e "$BOOT_PROBE"
)
# The probe's own watchdog normally ends it; this is the backstop for a node
# that never gets as far as running it (coreutils and BusyBox both have it).
if command -v timeout >/dev/null 2>&1; then
	PROBE_COMMAND=(timeout "$(( PROBE_TIMEOUT_SECONDS + 60 ))" "${PROBE_COMMAND[@]}")
fi

echo "🔍 Booting the Enterprise loader inside ${IMAGE} (no network, no database)"
PROBE_STATUS=0
PROBE_OUTPUT="$("${PROBE_COMMAND[@]}" 2>&1)" || PROBE_STATUS=$?
PROBE_LINE="$(printf '%s\n' "$PROBE_OUTPUT" | grep -E '^EE_PROBE(_FAILED)? ' | tail -n 1 || true)"

if ! python3 - "$EDITION" "$PROBE_STATUS" "$CONFIG_JSON" "$PROBE_LINE" <<'PY'
import json
import re
import sys

edition = sys.argv[1]
status = int(sys.argv[2])
labels = json.loads(sys.argv[3]).get("Labels") or {}
line = sys.argv[4]
image_version = labels.get("org.opencontainers.image.version") or ""

result = None
problem = None
if line.startswith("EE_PROBE "):
    try:
        result = json.loads(line[len("EE_PROBE "):])
    except ValueError:
        problem = "its EE_PROBE line is not JSON: " + line
    if result is not None and not isinstance(result, dict):
        result = None
        problem = "its EE_PROBE line is not a JSON object: " + line
elif line.startswith("EE_PROBE_FAILED "):
    problem = line[len("EE_PROBE_FAILED "):]
elif status == 124:
    problem = "it timed out"
else:
    problem = "it printed no EE_PROBE line"

checks = [("the Enterprise loader ran inside the image (exit status %d)" % status,
           status == 0 and result is not None)]

if problem:
    print("   the probe failed: " + problem)

if result is not None:
    version = result.get("version")
    loaded_files = result.get("loadedEnterpriseEditionFiles")
    if not isinstance(loaded_files, list):
        loaded_files = []
    init_error = result.get("initError")
    print("ℹ️  loader outcome %s, module version %s, init %s, license %s" % (
        result.get("outcome"),
        version,
        "completed" if result.get("initCompleted") else "not completed" + (" (%s)" % init_error if init_error else ""),
        result.get("licenseStatus"),
    ))
    if edition == "enterprise":
        checks += [
            ('the loader loads ee/ (outcome "loaded")',
             result.get("outcome") == "loaded"),
            ("EnterpriseEdition has the module registered",
             result.get("isLoaded") is True),
            ("the module reports its version",
             isinstance(version, str) and version.strip() != ""),
            ("ee resolves the EnterpriseEdition module core uses",
             result.get("eeEnterpriseEditionFile") is not None
             and result.get("eeEnterpriseEditionFile") == result.get("enterpriseEditionFile")),
            ("exactly one EnterpriseEdition module is loaded",
             len(loaded_files) == 1),
        ]
        if re.match(r"^[0-9]+(\.[0-9]+)*$", image_version):
            checks.append(("the module version is the image version " + image_version,
                           version == image_version))
        else:
            print("ℹ️  the image version label (%r) is not a release version, so the module version is not compared" % image_version)
    else:
        checks += [
            ('the loader finds no ee/ (outcome "not-found")',
             result.get("outcome") == "not-found"),
            ("EnterpriseEdition has no module registered",
             result.get("isLoaded") is False),
            ("exactly one EnterpriseEdition module is loaded",
             len(loaded_files) == 1),
        ]
    if len(loaded_files) > 1:
        for file in loaded_files:
            print("   loaded: " + str(file))

failed = False
for description, ok in checks:
    print(("✅ " if ok else "❌ ") + description)
    failed = failed or not ok

sys.exit(1 if failed else 0)
PY
then
	FAILED=1
	echo "   The probe's last lines of output:"
	printf '%s\n' "$PROBE_OUTPUT" | tail -n 40 | sed 's/^/   | /'
fi

if [[ "$FAILED" -ne 0 ]]; then
	echo "❌ ${IMAGE} is not a correct ${EDITION} edition image" >&2
	exit 1
fi

echo "✅ ${IMAGE} is the ${EDITION} edition"
