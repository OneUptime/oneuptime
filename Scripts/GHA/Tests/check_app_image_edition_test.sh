#!/usr/bin/env bash

# Tests for Scripts/GHA/check_app_image_edition.sh, the check the Build workflow
# runs on the Community and Enterprise App images of every pull request, and
# the release workflows run on the App tags they pull.
#
# A fake docker on PATH answers `docker image inspect` from a JSON fixture and
# runs the script's in-container checks (`docker run ... sh -c <checks>`) for
# real, against a fake image tree on disk. The boot probe
# (`docker run ... --entrypoint node ... -e <probe>`) runs for real too, with
# the node on PATH, against small stand-ins for the loader, EnterpriseEdition
# and the ee module in that tree; or, when the image has a probe.out fixture,
# the fake replays it. So every check is exercised both ways: a correct image
# passes, and each way an image can be wrong fails.
#
# Needs bash, python3 and node. Run with: npm run test-gha-scripts
# (or bash Scripts/GHA/Tests/check_app_image_edition_test.sh)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_SCRIPT="${SCRIPT_DIR}/../check_app_image_edition.sh"

PASS=0
FAIL=0

pass() {
	PASS=$(( PASS + 1 ))
	echo "  ✅ $1"
}

fail() {
	FAIL=$(( FAIL + 1 ))
	echo "  ❌ $1" >&2
}

assert_eq() {
	local expected="$1" actual="$2" what="$3"
	if [[ "$expected" == "$actual" ]]; then
		pass "$what"
	else
		fail "$what — expected '${expected}', got '${actual}'"
	fi
}

assert_contains() {
	local haystack="$1" needle="$2" what="$3"
	if [[ "$haystack" == *"$needle"* ]]; then
		pass "$what"
	else
		fail "$what — '${needle}' not found in output"
	fi
}

assert_not_contains() {
	local haystack="$1" needle="$2" what="$3"
	if [[ "$haystack" != *"$needle"* ]]; then
		pass "$what"
	else
		fail "$what — '${needle}' unexpectedly found in output"
	fi
}

for tool in python3 node; do
	if ! command -v "$tool" >/dev/null 2>&1; then
		echo "❌ ${tool} is not on PATH; this suite needs it" >&2
		exit 1
	fi
done

# Canonical, so the script's `readlink -f` answers compare equal to the paths
# built here: on macOS mktemp gives /var/..., which resolves to /private/var/...
WORK_DIR="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$WORK_DIR"' EXIT

IMAGES_DIR="${WORK_DIR}/images"
mkdir -p "$IMAGES_DIR"

BIN_DIR="${WORK_DIR}/bin"
mkdir -p "$BIN_DIR"
cat > "${BIN_DIR}/docker" <<'FAKE_EOF'
#!/usr/bin/env bash
set -uo pipefail
if [[ "${1:-} ${2:-}" == "image inspect" ]]; then
	image="${@: -1}"
	config="${FAKE_IMAGES_DIR}/${image}/config.json"
	if [[ ! -f "$config" ]]; then
		echo "Error: No such image: ${image}" >&2
		exit 1
	fi
	cat "$config"
	exit 0
fi
if [[ "${1:-}" == "run" ]]; then
	shift
	image=""
	entrypoint=""
	workdir=""
	network=""
	user=""
	envs=()
	while [[ $# -gt 0 ]]; do
		case "$1" in
			--rm) shift ;;
			--entrypoint) entrypoint="$2"; shift 2 ;;
			--network) network="$2"; shift 2 ;;
			--user) user="$2"; shift 2 ;;
			-w) workdir="$2"; shift 2 ;;
			-e) envs+=("$2"); shift 2 ;;
			-*) echo "fake docker: unexpected docker run flag $1" >&2; exit 2 ;;
			*) image="$1"; shift; break ;;
		esac
	done
	root="${FAKE_IMAGES_DIR}/${image}/root"
	echo "run image=${image} entrypoint=${entrypoint} user=${user} network=${network} workdir=${workdir} env=${envs[*]+${envs[*]}}" >> "${FAKE_IMAGES_DIR}/runs"
	if [[ "$entrypoint" == "sh" ]]; then
		echo "$image $*" >> "${FAKE_IMAGES_DIR}/runs"
		# What follows the image is `-c <script> <$0> <args...>` for sh.
		ROOT="$root" exec sh "$@"
	fi
	if [[ "$entrypoint" == "node" ]]; then
		# Record node's flags, up to the probe's code.
		flags=()
		for arg in "$@"; do
			[[ "$arg" == "-e" ]] && break
			flags+=("$arg")
		done
		echo "node image=${image} flags=${flags[*]+${flags[*]}}" >> "${FAKE_IMAGES_DIR}/runs"
		fixture="${FAKE_IMAGES_DIR}/${image}/probe.out"
		if [[ -f "$fixture" ]]; then
			cat "$fixture"
			exit "$(cat "${FAKE_IMAGES_DIR}/${image}/probe.status" 2>/dev/null || echo 0)"
		fi
		# Run the probe for real. The fake tree's modules are plain .js, so
		# ts-node is not needed (and not there).
		args=()
		while [[ $# -gt 0 ]]; do
			if [[ "$1" == "--require" && "${2:-}" == "ts-node/register" ]]; then
				shift 2
				continue
			fi
			args+=("$1")
			shift
		done
		for entry in ${envs[@]+"${envs[@]}"}; do
			export "$entry"
		done
		cd "${root}${workdir}" || exit 125
		exec node "${args[@]}"
	fi
	echo "fake docker: unexpected entrypoint '${entrypoint}'" >&2
	exit 2
fi
echo "unexpected docker call: $*" >&2
exit 2
FAKE_EOF
chmod +x "${BIN_DIR}/docker"
export PATH="${BIN_DIR}:${PATH}"
export FAKE_IMAGES_DIR="$IMAGES_DIR"

RUNS_FILE="${IMAGES_DIR}/runs"

# Writes an image's docker-inspect .Config. The version label is optional.
write_config() {
	local image="$1" edition="$2" licenses="$3" user="$4" transpile="$5" is_ee="$6" oneuptime_edition="$7" version="${8:-}"
	local env_entries="\"PATH=/usr/local/bin\",\"TS_NODE_TRANSPILE_ONLY=${transpile}\",\"IS_ENTERPRISE_EDITION=${is_ee}\""
	if [[ -n "$oneuptime_edition" ]]; then
		env_entries="${env_entries},\"ONEUPTIME_EDITION=${oneuptime_edition}\""
	fi
	mkdir -p "${IMAGES_DIR}/${image}"
	cat > "${IMAGES_DIR}/${image}/config.json" <<EOF
{"User":"${user}","Cmd":["npm","start"],"Env":[${env_entries}],"Labels":{"com.oneuptime.edition":"${edition}","org.opencontainers.image.licenses":"${licenses}","org.opencontainers.image.version":"${version}"}}
EOF
}

# Stand-ins for the modules the boot probe loads. The loader mirrors the real
# one's contract: it looks for ee/ next to the App, registers what it finds
# with EnterpriseEdition, and says what it did. It also refuses options the
# probe must never pass (billing on, or a fixed edition).
write_fake_core_modules() {
	local root="$1"
	mkdir -p "${root}/usr/src/Common/Server/Enterprise" "${root}/usr/src/app/Utils" "${root}/usr/src/app/node_modules"
	ln -s ../../Common "${root}/usr/src/app/node_modules/Common"
	cat > "${root}/usr/src/Common/Server/Enterprise/EnterpriseEdition.js" <<'JS'
"use strict";
let registered = null;
exports.default = {
  register: (enterpriseModule) => {
    registered = enterpriseModule;
  },
  isLoaded: () => {
    return registered !== null;
  },
  getModule: () => {
    return registered;
  },
};
JS
	cat > "${root}/usr/src/app/Utils/EnterpriseLoader.js" <<'JS'
"use strict";
const fs = require("fs");
const path = require("path");
const EnterpriseEdition = require("Common/Server/Enterprise/EnterpriseEdition").default;
exports.default = {
  load: async (options) => {
    if (options.edition !== "auto") {
      throw new Error("the probe asked for edition " + options.edition + ", not auto");
    }
    if (options.isBillingEnabled !== false || process.env.BILLING_ENABLED !== "false") {
      throw new Error("the probe must run with billing off");
    }
    if (!(options.initTimeoutInMs > 0) || !(options.licenseLoadTimeoutInMs > 0)) {
      throw new Error("the probe must bound init() and the license load");
    }
    if (process.env.TS_NODE_TRANSPILE_ONLY !== "1") {
      throw new Error("the probe must run transpile-only");
    }
    const directory = path.resolve(__dirname, "..", "..", "ee");
    const entryFile = path.join(directory, "Server", "Index.js");
    if (!fs.existsSync(entryFile)) {
      return { outcome: "not-found", edition: "auto", directory: null, entryFile: null, initCompleted: false, initError: null, licenseSnapshot: null };
    }
    EnterpriseEdition.register(require(entryFile).default);
    return { outcome: "loaded", edition: "auto", directory, entryFile, initCompleted: false, initError: "Database not connected", licenseSnapshot: { status: "missing" } };
  },
};
JS
}

# A correct Community image tree.
make_community_tree() {
	local root="${IMAGES_DIR}/$1/root"
	mkdir -p "${root}/usr/src/app/FeatureSet/Dashboard/public/dist" "${root}/usr/src/app/FeatureSet/AdminDashboard/public/dist" "${root}/usr/src/Common"
	echo 'var p={}' > "${root}/usr/src/app/FeatureSet/Dashboard/public/dist/Index.js"
	echo 'var p={}' > "${root}/usr/src/app/FeatureSet/AdminDashboard/public/dist/Index.js"
	# Shaped like the repository's LICENSE: a preamble that names ee/ and the
	# Enterprise License, but not on its first line, then the Apache License.
	printf '%s\n' \
		'Copyright (c) HackerBay, Inc. (doing business as OneUptime, "OneUptime")' \
		'' \
		'Portions of this software are licensed as follows:' \
		'' \
		'* All content that resides under the "ee/" directory of this repository, if' \
		'  that directory exists, is licensed under the license defined in "ee/LICENSE"' \
		'  (the OneUptime Enterprise License).' \
		'* Content outside of the above mentioned directories or restrictions above is' \
		'  available under the "Apache License, Version 2.0" as defined below.' \
		'' \
		'                                 Apache License' \
		'                           Version 2.0, January 2004' > "${root}/usr/src/LICENSE"
	printf '%s\n' \
		'OneUptime' \
		'Copyright (c) HackerBay, Inc. (doing business as OneUptime, "OneUptime")' \
		'' \
		'* All content that resides under the "ee/" directory of this repository, if' \
		'  that directory exists, is licensed under the license defined in "ee/LICENSE"' \
		'  (the OneUptime Enterprise License).' > "${root}/usr/src/NOTICE"
	# A dependency's own LICENSE, which the ee scan must leave alone.
	mkdir -p "${root}/usr/src/app/node_modules/left-pad"
	printf '%s\n' 'MIT License' > "${root}/usr/src/app/node_modules/left-pad/LICENSE"
	write_fake_core_modules "$root"
}

# A correct Enterprise image tree: the Community tree plus ee/.
make_enterprise_tree() {
	local root="${IMAGES_DIR}/$1/root"
	make_community_tree "$1"
	echo 'var p={buildMarker:"ONEUPTIME_EE_DASHBOARD_PLUGIN_v1"}' > "${root}/usr/src/app/FeatureSet/Dashboard/public/dist/Index.js"
	echo 'var p={buildMarker:"ONEUPTIME_EE_ADMIN_DASHBOARD_PLUGIN_v1"}' > "${root}/usr/src/app/FeatureSet/AdminDashboard/public/dist/Index.js"
	mkdir -p "${root}/usr/src/ee/Server/License" "${root}/usr/src/ee/node_modules/openid-client" "${root}/usr/src/packages"
	echo 'export default {};' > "${root}/usr/src/ee/Server/Index.ts"
	echo 'export const TRUSTED_LICENSE_KEYS = [];' > "${root}/usr/src/ee/Server/License/TrustedLicenseKeys.ts"
	printf '%s\n' 'The OneUptime Enterprise License (the "Enterprise License")' 'Copyright (c) 2026-present HackerBay, Inc. (doing business as OneUptime,' '"OneUptime")' > "${root}/usr/src/ee/LICENSE"
	echo '{"name":"@oneuptime/ee","version":"13.0.7"}' > "${root}/usr/src/ee/package.json"
	# What the stand-in loader requires: like the real module, ee reaches core
	# through its own node_modules.
	cat > "${root}/usr/src/ee/Server/Index.js" <<'JS'
"use strict";
require("Common/Server/Enterprise/EnterpriseEdition");
exports.default = { version: require("../package.json").version };
JS
	ln -s ../Common "${root}/usr/src/packages/Common"
	ln -s ../app "${root}/usr/src/packages/App"
	ln -s ../../packages/Common "${root}/usr/src/ee/node_modules/Common"
	ln -s ../../packages/App "${root}/usr/src/ee/node_modules/App"
}

good_community() {
	make_community_tree "$1"
	write_config "$1" community "Apache-2.0" node 1 false "" "${2:-}"
}

good_enterprise() {
	make_enterprise_tree "$1"
	write_config "$1" enterprise "Apache-2.0 AND LicenseRef-OneUptime-Enterprise" node 1 true enterprise "${2:-}"
}

# Makes the image's boot probe print $2 and exit with $3, instead of running.
replay_probe() {
	printf '%s\n' "$2" > "${IMAGES_DIR}/$1/probe.out"
	echo "${3:-0}" > "${IMAGES_DIR}/$1/probe.status"
}

replace_loader() {
	cat > "${IMAGES_DIR}/$1/root/usr/src/app/Utils/EnterpriseLoader.js"
}

run_check() {
	bash "$CHECK_SCRIPT" "$@" 2>&1
}

echo "check_app_image_edition.sh"

# --- Correct images pass. ---
good_community ce
status=0
output="$(run_check --image ce --edition community)" || status=$?
assert_eq 0 "$status" "a correct Community image passes"
assert_contains "$output" "✅ ce is the community edition" "says so"
assert_contains "$output" "✅ there is no /usr/src/ee" "checks the Community image has no ee/"
assert_contains "$output" "✅ no Enterprise Edition file anywhere in the image" "scans the whole Community image for ee/"
assert_not_contains "$output" "found: /usr/src/LICENSE" "does not take the root LICENSE, whose preamble names the Enterprise License, for ee's"
assert_contains "$output" "✅ /usr/src/LICENSE is the Apache License 2.0" "checks the Community image ships the Apache LICENSE"
assert_contains "$output" "✅ /usr/src/NOTICE says ee/ is under the OneUptime Enterprise License" "checks the Community image ships the NOTICE"
assert_contains "$output" "✅ ONEUPTIME_EDITION is not set (auto)" "checks the Community image leaves ONEUPTIME_EDITION unset"
assert_contains "$output" '✅ the loader finds no ee/ (outcome "not-found")' "boots the loader in the Community image"
assert_contains "$output" "✅ exactly one EnterpriseEdition module is loaded" "counts the EnterpriseEdition modules"
assert_contains "$(cat "$RUNS_FILE")" "ce -c" "runs the content checks inside the image"
assert_contains "$(cat "$RUNS_FILE")" "run image=ce entrypoint=sh user=root" "runs the content checks as root, so the scan can read every directory"
runs="$(cat "$RUNS_FILE")"
assert_contains "$runs" "run image=ce entrypoint=node user= network=none workdir=/usr/src/app" "runs the probe as the image's user, from /usr/src/app, without a network"
assert_contains "$runs" "env=BILLING_ENABLED=false TS_NODE_TRANSPILE_ONLY=1 EE_PROBE_TIMEOUT_MS=300000" "runs the probe with billing off, transpile-only and a 300s watchdog"
assert_contains "$runs" "node image=ce flags=--no-node-snapshot --max-old-space-size=8096 --require ts-node/register" "runs the probe with node's flags from npm start"

good_enterprise ee
status=0
output="$(run_check --image ee --edition enterprise)" || status=$?
assert_eq 0 "$status" "a correct Enterprise image passes"
assert_contains "$output" "✅ ee is the enterprise edition" "says so"
assert_contains "$output" "✅ ee's Common dependency is /usr/src/Common" "checks ee resolves Common to the Common the image runs"
assert_contains "$output" "✅ ee's App dependency is /usr/src/app" "checks ee resolves App to the App the image runs"
assert_contains "$output" "✅ ONEUPTIME_EDITION=enterprise (ee/ must load)" "checks the loader marker"
assert_contains "$output" "✅ /usr/src/ee/LICENSE is the OneUptime Enterprise License" "checks ee/LICENSE shipped"
assert_contains "$output" "✅ no Enterprise Edition file outside /usr/src/ee" "checks ee/ is only at /usr/src/ee"
assert_contains "$output" '✅ the loader loads ee/ (outcome "loaded")' "boots the loader in the Enterprise image"
assert_contains "$output" "✅ ee resolves the EnterpriseEdition module core uses" "checks there is one EnterpriseEdition module"
assert_contains "$output" "loader outcome loaded, module version 13.0.7, init not completed (Database not connected), license missing" "reports what the loader did"
assert_contains "$output" "is not a release version, so the module version is not compared" "says when it cannot compare the module version"

good_enterprise ee-release 13.0.7
status=0
output="$(run_check --image ee-release --edition enterprise)" || status=$?
assert_eq 0 "$status" "a release Enterprise image whose ee/ has the image's version passes"
assert_contains "$output" "✅ the module version is the image version 13.0.7" "compares the module version with the version label"

good_enterprise ee-test-release 13.0.8-test
status=0
output="$(run_check --image ee-test-release --edition enterprise)" || status=$?
assert_eq 0 "$status" "a test-release Enterprise image (version 13.0.8-test) is not held to its label"

# --- The editions are not interchangeable. ---
status=0
output="$(run_check --image ce --edition enterprise)" || status=$?
assert_eq 1 "$status" "a Community image is not an Enterprise image"
assert_contains "$output" "❌ ee/ is at /usr/src/ee" "names the missing ee/"
assert_contains "$output" '❌ the loader loads ee/ (outcome "loaded")' "names the loader outcome"
status=0
output="$(run_check --image ee --edition community)" || status=$?
assert_eq 1 "$status" "an Enterprise image is not a Community image"
assert_contains "$output" "❌ the bundles do not contain the Enterprise UI" "names the Enterprise UI in the bundles"
assert_contains "$output" "❌ no Enterprise Edition file anywhere in the image" "names the Enterprise files"
assert_contains "$output" "found: /usr/src/ee/LICENSE" "lists the Enterprise License it found"
assert_contains "$output" "found: /usr/src/ee/Server/License/TrustedLicenseKeys.ts" "lists the ee module it found"
assert_contains "$output" '❌ the loader finds no ee/ (outcome "not-found")' "names the loader outcome"

# --- Each way a Community image can be wrong. ---
good_community ce-with-ee
mkdir -p "${IMAGES_DIR}/ce-with-ee/root/usr/src/ee/Server"
status=0
output="$(run_check --image ce-with-ee --edition community)" || status=$?
assert_eq 1 "$status" "fails a Community image that contains ee/"
assert_contains "$output" "❌ there is no /usr/src/ee" "names the ee/ it found"

good_community ce-ee-in-app
mkdir -p "${IMAGES_DIR}/ce-ee-in-app/root/usr/src/app/ee/Server"
cp "${IMAGES_DIR}/ee/root/usr/src/ee/LICENSE" "${IMAGES_DIR}/ce-ee-in-app/root/usr/src/app/ee/LICENSE"
status=0
output="$(run_check --image ce-ee-in-app --edition community)" || status=$?
assert_eq 1 "$status" "fails a Community image with ee/ copied to /usr/src/app/ee (COPY . /usr/src/app)"
assert_contains "$output" "❌ no Enterprise Edition file anywhere in the image" "names the Enterprise files"
assert_contains "$output" "found: /usr/src/app/ee/LICENSE" "says where ee/ is"
assert_contains "$output" "✅ there is no /usr/src/ee" "(which the /usr/src/ee check alone would have missed)"

good_community ce-trusted-keys
mkdir -p "${IMAGES_DIR}/ce-trusted-keys/root/opt/oneuptime/Server/License"
echo 'module.exports = [];' > "${IMAGES_DIR}/ce-trusted-keys/root/opt/oneuptime/Server/License/TrustedLicenseKeys.js"
status=0
output="$(run_check --image ce-trusted-keys --edition community)" || status=$?
assert_eq 1 "$status" "fails a Community image with ee's server code anywhere, even without its LICENSE"
assert_contains "$output" "found: /opt/oneuptime/Server/License/TrustedLicenseKeys.js" "says where it is"

good_community ce-other-licenses
printf '%s\n' 'Apache License' > "${IMAGES_DIR}/ce-other-licenses/root/usr/src/app/LICENSE"
mkdir -p "${IMAGES_DIR}/ce-other-licenses/root/usr/src/app/node_modules/vendored"
printf '%s\n' 'The OneUptime Enterprise License (the "Enterprise License")' > "${IMAGES_DIR}/ce-other-licenses/root/usr/src/app/node_modules/vendored/LICENSE"
status=0
output="$(run_check --image ce-other-licenses --edition community)" || status=$?
assert_eq 0 "$status" "other LICENSE files, and anything inside node_modules, are not taken for ee/"

good_community ce-with-sentinel
echo 'x="ONEUPTIME_EE_ADMIN_DASHBOARD_PLUGIN_v1"' > "${IMAGES_DIR}/ce-with-sentinel/root/usr/src/app/FeatureSet/AdminDashboard/public/dist/chunk.js"
status=0
output="$(run_check --image ce-with-sentinel --edition community)" || status=$?
assert_eq 1 "$status" "fails a Community image whose bundle has the Enterprise UI"

good_community ce-with-packages
mkdir -p "${IMAGES_DIR}/ce-with-packages/root/usr/src/packages"
status=0
output="$(run_check --image ce-with-packages --edition community)" || status=$?
assert_eq 1 "$status" "fails a Community image with the ee /usr/src/packages links"

good_community ce-marked-enterprise
write_config ce-marked-enterprise community "Apache-2.0" node 1 false enterprise
status=0
output="$(run_check --image ce-marked-enterprise --edition community)" || status=$?
assert_eq 1 "$status" "fails a Community image that sets ONEUPTIME_EDITION"

good_community ce-ee-licence
write_config ce-ee-licence community "Apache-2.0 AND LicenseRef-OneUptime-Enterprise" node 1 false ""
status=0
output="$(run_check --image ce-ee-licence --edition community)" || status=$?
assert_eq 1 "$status" "fails a Community image labelled with the Enterprise licence"
assert_contains "$output" "❌ label org.opencontainers.image.licenses is Apache-2.0" "names the licence label"

good_community ce-no-dist
rm -rf "${IMAGES_DIR}/ce-no-dist/root/usr/src/app/FeatureSet/AdminDashboard/public/dist"
status=0
output="$(run_check --image ce-no-dist --edition community)" || status=$?
assert_eq 1 "$status" "fails an image without its Admin Dashboard bundle (a vacuous sentinel check)"

good_community ce-no-license
rm "${IMAGES_DIR}/ce-no-license/root/usr/src/LICENSE"
status=0
output="$(run_check --image ce-no-license --edition community)" || status=$?
assert_eq 1 "$status" "fails a Community image without /usr/src/LICENSE"
assert_contains "$output" "❌ /usr/src/LICENSE is the Apache License 2.0" "names the LICENSE"

good_community ce-wrong-license
printf '%s\n' 'MIT License' > "${IMAGES_DIR}/ce-wrong-license/root/usr/src/LICENSE"
status=0
output="$(run_check --image ce-wrong-license --edition community)" || status=$?
assert_eq 1 "$status" "fails a Community image whose /usr/src/LICENSE is not the Apache License"

good_community ce-no-notice
rm "${IMAGES_DIR}/ce-no-notice/root/usr/src/NOTICE"
status=0
output="$(run_check --image ce-no-notice --edition community)" || status=$?
assert_eq 1 "$status" "fails a Community image without /usr/src/NOTICE"
assert_contains "$output" "❌ /usr/src/NOTICE says ee/ is under the OneUptime Enterprise License" "names the NOTICE"

good_community ce-notice-without-carve-out
printf '%s\n' 'OneUptime' 'Licensed under the Apache License 2.0.' > "${IMAGES_DIR}/ce-notice-without-carve-out/root/usr/src/NOTICE"
status=0
output="$(run_check --image ce-notice-without-carve-out --edition community)" || status=$?
assert_eq 1 "$status" "fails a NOTICE that does not state the ee/ carve-out"

good_community ce-probe-loaded
replay_probe ce-probe-loaded 'EE_PROBE {"outcome":"loaded","isLoaded":true,"version":"13.0.7","loadedEnterpriseEditionFiles":["/usr/src/Common/Server/Enterprise/EnterpriseEdition.ts"]}'
status=0
output="$(run_check --image ce-probe-loaded --edition community)" || status=$?
assert_eq 1 "$status" "fails a Community image whose loader loads an Enterprise module"
assert_contains "$output" '❌ the loader finds no ee/ (outcome "not-found")' "names the loader outcome"
assert_contains "$output" "❌ EnterpriseEdition has no module registered" "names the registered module"

# --- Each way an Enterprise image can be wrong. ---
good_enterprise ee-no-marker
write_config ee-no-marker enterprise "Apache-2.0 AND LicenseRef-OneUptime-Enterprise" node 1 true ""
status=0
output="$(run_check --image ee-no-marker --edition enterprise)" || status=$?
assert_eq 1 "$status" "fails an Enterprise image without ONEUPTIME_EDITION=enterprise"
assert_contains "$output" "❌ ONEUPTIME_EDITION=enterprise (ee/ must load)" "names the missing marker"
assert_contains "$output" '✅ the loader loads ee/ (outcome "loaded")' "(the probe asks for auto, so the marker is its own check)"

good_enterprise ee-community-ui
echo 'var p={}' > "${IMAGES_DIR}/ee-community-ui/root/usr/src/app/FeatureSet/Dashboard/public/dist/Index.js"
status=0
output="$(run_check --image ee-community-ui --edition enterprise)" || status=$?
assert_eq 1 "$status" "fails an Enterprise image whose Dashboard fell back to the Community UI"
assert_contains "$output" "❌ the Dashboard bundle contains the Enterprise UI" "names the Dashboard bundle"

good_enterprise ee-admin-community-ui
echo 'var p={}' > "${IMAGES_DIR}/ee-admin-community-ui/root/usr/src/app/FeatureSet/AdminDashboard/public/dist/Index.js"
status=0
output="$(run_check --image ee-admin-community-ui --edition enterprise)" || status=$?
assert_eq 1 "$status" "fails an Enterprise image whose Admin Dashboard fell back to the Community UI"

good_enterprise ee-tests
mkdir -p "${IMAGES_DIR}/ee-tests/root/usr/src/ee/Tests/Server"
status=0
output="$(run_check --image ee-tests --edition enterprise)" || status=$?
assert_eq 1 "$status" "fails an Enterprise image that ships ee/Tests"

good_enterprise ee-pem
echo key > "${IMAGES_DIR}/ee-pem/root/usr/src/ee/Server/signing.pem"
status=0
output="$(run_check --image ee-pem --edition enterprise)" || status=$?
assert_eq 1 "$status" "fails an Enterprise image that ships a .pem under ee/"

for extension in key p8 der; do
	good_enterprise "ee-${extension}"
	echo key > "${IMAGES_DIR}/ee-${extension}/root/usr/src/ee/Server/License/signing.${extension}"
	status=0
	output="$(run_check --image "ee-${extension}" --edition enterprise)" || status=$?
	assert_eq 1 "$status" "fails an Enterprise image that ships a .${extension} under ee/"
	assert_contains "$output" "❌ no key material under ee/" "names the key material (.${extension})"
done

good_enterprise ee-keys
mkdir -p "${IMAGES_DIR}/ee-keys/root/usr/src/ee/Server/License/keys"
status=0
output="$(run_check --image ee-keys --edition enterprise)" || status=$?
assert_eq 1 "$status" "fails an Enterprise image that ships a keys/ directory under ee/"

good_enterprise ee-unpruned
mkdir -p "${IMAGES_DIR}/ee-unpruned/root/usr/src/ee/node_modules/typescript"
status=0
output="$(run_check --image ee-unpruned --edition enterprise)" || status=$?
assert_eq 1 "$status" "fails an Enterprise image that kept ee's dev dependencies"

good_enterprise ee-second-app
rm "${IMAGES_DIR}/ee-second-app/root/usr/src/ee/node_modules/App"
mkdir -p "${IMAGES_DIR}/ee-second-app/root/usr/src/ee/node_modules/App"
status=0
output="$(run_check --image ee-second-app --edition enterprise)" || status=$?
assert_eq 1 "$status" "fails an Enterprise image whose ee has its own copy of App (two module instances)"
assert_contains "$output" "❌ ee's App dependency is /usr/src/app" "names the App link"

# npm with install-links=true copies file: dependencies instead of linking them.
good_enterprise ee-second-common
rm "${IMAGES_DIR}/ee-second-common/root/usr/src/ee/node_modules/Common"
cp -R "${IMAGES_DIR}/ee-second-common/root/usr/src/Common" "${IMAGES_DIR}/ee-second-common/root/usr/src/ee/node_modules/Common"
status=0
output="$(run_check --image ee-second-common --edition enterprise)" || status=$?
assert_eq 1 "$status" "fails an Enterprise image whose ee has its own copy of Common"
assert_contains "$output" "❌ ee's Common dependency is /usr/src/Common" "names the Common link"
assert_contains "$output" "❌ ee resolves the EnterpriseEdition module core uses" "the probe sees ee resolve a second EnterpriseEdition"
assert_contains "$output" "❌ exactly one EnterpriseEdition module is loaded" "the probe sees two EnterpriseEdition modules loaded"
assert_contains "$output" "loaded: ${IMAGES_DIR}/ee-second-common/root/usr/src/ee/node_modules/Common/Server/Enterprise/EnterpriseEdition.js" "lists the second copy"

good_enterprise ee-second-copy
mkdir -p "${IMAGES_DIR}/ee-second-copy/root/usr/src/app/ee"
cp "${IMAGES_DIR}/ee-second-copy/root/usr/src/ee/LICENSE" "${IMAGES_DIR}/ee-second-copy/root/usr/src/app/ee/LICENSE"
status=0
output="$(run_check --image ee-second-copy --edition enterprise)" || status=$?
assert_eq 1 "$status" "fails an Enterprise image with a second copy of ee/ outside /usr/src/ee"
assert_contains "$output" "❌ no Enterprise Edition file outside /usr/src/ee" "names the stray copy"
assert_contains "$output" "found: /usr/src/app/ee/LICENSE" "says where it is"
assert_not_contains "$output" "found: /usr/src/ee/LICENSE" "does not list the ee/ that belongs there"

good_enterprise ee-no-license
rm "${IMAGES_DIR}/ee-no-license/root/usr/src/ee/LICENSE"
status=0
output="$(run_check --image ee-no-license --edition enterprise)" || status=$?
assert_eq 1 "$status" "fails an Enterprise image without ee/LICENSE"
assert_contains "$output" "❌ /usr/src/ee/LICENSE is the OneUptime Enterprise License" "names ee/LICENSE"

good_enterprise ee-apache-license
cp "${IMAGES_DIR}/ee-apache-license/root/usr/src/LICENSE" "${IMAGES_DIR}/ee-apache-license/root/usr/src/ee/LICENSE"
status=0
output="$(run_check --image ee-apache-license --edition enterprise)" || status=$?
assert_eq 1 "$status" "fails an Enterprise image whose ee/LICENSE is not the Enterprise License"
assert_contains "$output" "❌ /usr/src/ee/LICENSE is the OneUptime Enterprise License" "a LICENSE that names the Enterprise License after its first line is not it"

good_enterprise ee-no-notice
rm "${IMAGES_DIR}/ee-no-notice/root/usr/src/NOTICE" "${IMAGES_DIR}/ee-no-notice/root/usr/src/LICENSE"
status=0
output="$(run_check --image ee-no-notice --edition enterprise)" || status=$?
assert_eq 1 "$status" "fails an Enterprise image without /usr/src/LICENSE and /usr/src/NOTICE"
assert_contains "$output" "❌ /usr/src/LICENSE is the Apache License 2.0" "names the LICENSE"
assert_contains "$output" "❌ /usr/src/NOTICE says ee/ is under the OneUptime Enterprise License" "names the NOTICE"

good_enterprise ee-root
write_config ee-root enterprise "Apache-2.0 AND LicenseRef-OneUptime-Enterprise" root 1 true enterprise
status=0
output="$(run_check --image ee-root --edition enterprise)" || status=$?
assert_eq 1 "$status" "fails an image that runs as root"
assert_contains "$output" "❌ runs as the node user" "names the user"

good_enterprise ee-typecheck-at-boot
write_config ee-typecheck-at-boot enterprise "Apache-2.0 AND LicenseRef-OneUptime-Enterprise" node 0 true enterprise
status=0
output="$(run_check --image ee-typecheck-at-boot --edition enterprise)" || status=$?
assert_eq 1 "$status" "fails an image that type-checks at boot"

good_enterprise ee-flag-false
write_config ee-flag-false enterprise "Apache-2.0 AND LicenseRef-OneUptime-Enterprise" node 1 false enterprise
status=0
output="$(run_check --image ee-flag-false --edition enterprise)" || status=$?
assert_eq 1 "$status" "fails an Enterprise image with IS_ENTERPRISE_EDITION=false"

# --- Each way the boot probe can fail on an Enterprise image. ---
good_enterprise ee-version-mismatch 13.0.8
status=0
output="$(run_check --image ee-version-mismatch --edition enterprise)" || status=$?
assert_eq 1 "$status" "fails a release image whose ee/ reports another version"
assert_contains "$output" "❌ the module version is the image version 13.0.8" "names the version"

good_enterprise ee-loader-throws
replace_loader ee-loader-throws <<'JS'
"use strict";
exports.default = {
  load: async () => {
    throw new Error("The OneUptime Enterprise module at /usr/src/ee/Server/Index.ts could not be loaded: Cannot find module 'openid-client'");
  },
};
JS
status=0
output="$(run_check --image ee-loader-throws --edition enterprise)" || status=$?
assert_eq 1 "$status" "fails an Enterprise image whose ee/ does not load (a pruned dependency)"
assert_contains "$output" "❌ the Enterprise loader ran inside the image (exit status 1)" "names the probe"
assert_contains "$output" "the probe failed: The OneUptime Enterprise module at /usr/src/ee/Server/Index.ts could not be loaded: Cannot find module 'openid-client'" "shows the loader's error"
assert_contains "$output" "The probe's last lines of output:" "shows the probe's output"

good_enterprise ee-loader-hangs
replace_loader ee-loader-hangs <<'JS'
"use strict";
exports.default = {
  load: () => {
    return new Promise(() => {
      setInterval(() => {}, 1000);
    });
  },
};
JS
status=0
output="$(CHECK_APP_IMAGE_EDITION_PROBE_TIMEOUT_SECONDS=1 run_check --image ee-loader-hangs --edition enterprise)" || status=$?
assert_eq 1 "$status" "fails, instead of hanging, when the loader never finishes"
assert_contains "$output" "the probe failed: the Enterprise loader did not finish within 1000 ms" "names the timeout"

good_enterprise ee-probe-exit
replay_probe ee-probe-exit 'EE_PROBE {"outcome":"loaded","isLoaded":true,"version":"13.0.7","enterpriseEditionFile":"/a","eeEnterpriseEditionFile":"/a","loadedEnterpriseEditionFiles":["/a"]}' 1
status=0
output="$(run_check --image ee-probe-exit --edition enterprise)" || status=$?
assert_eq 1 "$status" "fails when the probe exits non-zero, whatever it printed"
assert_contains "$output" "❌ the Enterprise loader ran inside the image (exit status 1)" "names the exit status"

good_enterprise ee-probe-replayed
replay_probe ee-probe-replayed "$(printf '%s\n' 'log line' 'EE_PROBE {"outcome":"loaded","isLoaded":true,"version":"13.0.7","enterpriseEditionFile":"/a","eeEnterpriseEditionFile":"/a","loadedEnterpriseEditionFiles":["/a"]}' 'another log line')"
status=0
output="$(run_check --image ee-probe-replayed --edition enterprise)" || status=$?
assert_eq 0 "$status" "(control) a replayed good probe passes, with log lines around it"

good_enterprise ee-probe-not-found
replay_probe ee-probe-not-found 'EE_PROBE {"outcome":"not-found","isLoaded":false,"version":null,"enterpriseEditionFile":"/a","eeEnterpriseEditionFile":null,"loadedEnterpriseEditionFiles":["/a"]}'
status=0
output="$(run_check --image ee-probe-not-found --edition enterprise)" || status=$?
assert_eq 1 "$status" "fails an Enterprise image whose loader finds no ee/"
assert_contains "$output" '❌ the loader loads ee/ (outcome "loaded")' "names the loader outcome"
assert_contains "$output" "❌ the module reports its version" "names the missing version"

good_enterprise ee-probe-silent
replay_probe ee-probe-silent 'Error: Cannot find module ts-node/register'
status=0
output="$(run_check --image ee-probe-silent --edition enterprise)" || status=$?
assert_eq 1 "$status" "fails when the probe prints no EE_PROBE line"
assert_contains "$output" "the probe failed: it printed no EE_PROBE line" "says so"
assert_contains "$output" "| Error: Cannot find module ts-node/register" "shows what node printed"

good_enterprise ee-probe-garbled
replay_probe ee-probe-garbled 'EE_PROBE {"outcome":'
status=0
output="$(run_check --image ee-probe-garbled --edition enterprise)" || status=$?
assert_eq 1 "$status" "fails when the probe's line is not JSON"
assert_contains "$output" "its EE_PROBE line is not JSON" "says so"

good_enterprise ee-probe-array
replay_probe ee-probe-array 'EE_PROBE ["loaded"]'
status=0
output="$(run_check --image ee-probe-array --edition enterprise)" || status=$?
assert_eq 1 "$status" "fails when the probe's line is not a JSON object"

good_enterprise ee-probe-timeout
replay_probe ee-probe-timeout 'still loading' 124
status=0
output="$(run_check --image ee-probe-timeout --edition enterprise)" || status=$?
assert_eq 1 "$status" "fails when the backstop timeout kills the probe"
assert_contains "$output" "the probe failed: it timed out" "says so"

# --- Argument errors. ---
status=0
output="$(run_check --image ee)" || status=$?
assert_eq 1 "$status" "fails without --edition"
status=0
output="$(run_check --image ee --edition premium)" || status=$?
assert_eq 1 "$status" "fails on an unknown edition"
assert_contains "$output" "must be community or enterprise" "names the valid editions"
status=0
output="$(run_check --image missing --edition community)" || status=$?
assert_eq 1 "$status" "fails when the image does not exist"
status=0
output="$(CHECK_APP_IMAGE_EDITION_PROBE_TIMEOUT_SECONDS=soon run_check --image ee --edition enterprise)" || status=$?
assert_eq 1 "$status" "fails on a probe timeout that is not a number of seconds"
assert_contains "$output" "CHECK_APP_IMAGE_EDITION_PROBE_TIMEOUT_SECONDS must be" "names the variable"
status=0
output="$(run_check --help)" || status=$?
assert_eq 0 "$status" "--help exits 0"

echo ""
if (( FAIL > 0 )); then
	echo "❌ ${FAIL} failed, ${PASS} passed" >&2
	exit 1
fi

echo "✅ ${PASS} passed"
