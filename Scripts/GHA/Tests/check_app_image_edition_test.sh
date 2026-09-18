#!/usr/bin/env bash

# Tests for Scripts/GHA/check_app_image_edition.sh, the check the Build workflow
# runs on the Community and Enterprise App images of every pull request.
#
# A fake docker on PATH answers `docker image inspect` from a JSON fixture and
# runs the script's in-container checks (`docker run ... sh -c <checks>`) for
# real, against a fake image tree on disk, so every check is exercised both
# ways: a correct image passes, and each way an image can be wrong fails.
#
# Run with: npm run test-gha-scripts   (or bash Scripts/GHA/Tests/check_app_image_edition_test.sh)

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

WORK_DIR="$(mktemp -d)"
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
	while [[ $# -gt 0 ]]; do
		case "$1" in
			--rm) shift ;;
			--entrypoint) shift 2 ;;
			*) image="$1"; shift; break ;;
		esac
	done
	echo "$image $*" >> "${FAKE_IMAGES_DIR}/runs"
	# What follows the image is `-c <script> <$0> <args...>` for sh.
	ROOT="${FAKE_IMAGES_DIR}/${image}/root" exec sh "$@"
fi
echo "unexpected docker call: $*" >&2
exit 2
FAKE_EOF
chmod +x "${BIN_DIR}/docker"
export PATH="${BIN_DIR}:${PATH}"
export FAKE_IMAGES_DIR="$IMAGES_DIR"

# Writes an image's docker-inspect .Config.
write_config() {
	local image="$1" edition="$2" licenses="$3" user="$4" transpile="$5" is_ee="$6" oneuptime_edition="$7"
	local env_entries="\"PATH=/usr/local/bin\",\"TS_NODE_TRANSPILE_ONLY=${transpile}\",\"IS_ENTERPRISE_EDITION=${is_ee}\""
	if [[ -n "$oneuptime_edition" ]]; then
		env_entries="${env_entries},\"ONEUPTIME_EDITION=${oneuptime_edition}\""
	fi
	mkdir -p "${IMAGES_DIR}/${image}"
	cat > "${IMAGES_DIR}/${image}/config.json" <<EOF
{"User":"${user}","Cmd":["npm","start"],"Env":[${env_entries}],"Labels":{"com.oneuptime.edition":"${edition}","org.opencontainers.image.licenses":"${licenses}"}}
EOF
}

# A correct Community image tree.
make_community_tree() {
	local root="${IMAGES_DIR}/$1/root"
	mkdir -p "${root}/usr/src/app/FeatureSet/Dashboard/public/dist" "${root}/usr/src/app/FeatureSet/AdminDashboard/public/dist" "${root}/usr/src/Common"
	echo 'var p={}' > "${root}/usr/src/app/FeatureSet/Dashboard/public/dist/Index.js"
	echo 'var p={}' > "${root}/usr/src/app/FeatureSet/AdminDashboard/public/dist/Index.js"
}

# A correct Enterprise image tree: the Community tree plus ee/.
make_enterprise_tree() {
	local root="${IMAGES_DIR}/$1/root"
	make_community_tree "$1"
	echo 'var p={buildMarker:"ONEUPTIME_EE_DASHBOARD_PLUGIN_v1"}' > "${root}/usr/src/app/FeatureSet/Dashboard/public/dist/Index.js"
	echo 'var p={buildMarker:"ONEUPTIME_EE_ADMIN_DASHBOARD_PLUGIN_v1"}' > "${root}/usr/src/app/FeatureSet/AdminDashboard/public/dist/Index.js"
	mkdir -p "${root}/usr/src/ee/Server" "${root}/usr/src/ee/node_modules/openid-client" "${root}/usr/src/packages"
	echo 'export default {};' > "${root}/usr/src/ee/Server/Index.ts"
	ln -s ../Common "${root}/usr/src/packages/Common"
	ln -s ../app "${root}/usr/src/packages/App"
	ln -s ../../packages/Common "${root}/usr/src/ee/node_modules/Common"
	ln -s ../../packages/App "${root}/usr/src/ee/node_modules/App"
}

good_community() {
	make_community_tree "$1"
	write_config "$1" community "Apache-2.0" node 1 false ""
}

good_enterprise() {
	make_enterprise_tree "$1"
	write_config "$1" enterprise "Apache-2.0 AND LicenseRef-OneUptime-Enterprise" node 1 true enterprise
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
assert_contains "$output" "✅ ONEUPTIME_EDITION is not set (auto)" "checks the Community image leaves ONEUPTIME_EDITION unset"
assert_contains "$(cat "${IMAGES_DIR}/runs")" "ce -c" "runs the content checks inside the image"

good_enterprise ee
status=0
output="$(run_check --image ee --edition enterprise)" || status=$?
assert_eq 0 "$status" "a correct Enterprise image passes"
assert_contains "$output" "✅ ee's App dependency is /usr/src/app" "checks ee resolves App to the App the image runs"
assert_contains "$output" "✅ ONEUPTIME_EDITION=enterprise (ee/ must load)" "checks the loader marker"

# --- The editions are not interchangeable. ---
status=0
output="$(run_check --image ce --edition enterprise)" || status=$?
assert_eq 1 "$status" "a Community image is not an Enterprise image"
assert_contains "$output" "❌ ee/ is at /usr/src/ee" "names the missing ee/"
status=0
output="$(run_check --image ee --edition community)" || status=$?
assert_eq 1 "$status" "an Enterprise image is not a Community image"
assert_contains "$output" "❌ the bundles do not contain the Enterprise UI" "names the Enterprise UI in the bundles"

# --- Each way a Community image can be wrong. ---
good_community ce-with-ee
mkdir -p "${IMAGES_DIR}/ce-with-ee/root/usr/src/ee/Server"
status=0
output="$(run_check --image ce-with-ee --edition community)" || status=$?
assert_eq 1 "$status" "fails a Community image that contains ee/"
assert_contains "$output" "❌ there is no /usr/src/ee" "names the ee/ it found"

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

# --- Each way an Enterprise image can be wrong. ---
good_enterprise ee-no-marker
write_config ee-no-marker enterprise "Apache-2.0 AND LicenseRef-OneUptime-Enterprise" node 1 true ""
status=0
output="$(run_check --image ee-no-marker --edition enterprise)" || status=$?
assert_eq 1 "$status" "fails an Enterprise image without ONEUPTIME_EDITION=enterprise"
assert_contains "$output" "❌ ONEUPTIME_EDITION=enterprise (ee/ must load)" "names the missing marker"

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
output="$(run_check --help)" || status=$?
assert_eq 0 "$status" "--help exits 0"

echo ""
if (( FAIL > 0 )); then
	echo "❌ ${FAIL} failed, ${PASS} passed" >&2
	exit 1
fi

echo "✅ ${PASS} passed"
