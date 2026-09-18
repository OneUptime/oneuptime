#!/usr/bin/env bash

# Tests for Scripts/GHA/build_docker_images.sh, driven by a fake docker on PATH
# that records every `docker buildx build` invocation, so nothing here builds or
# pushes anything.
#
# The script decides how the community and enterprise images of every release
# differ. For the App (packages/App/Dockerfile.tpl has an `AS enterprise`
# stage) they are two build targets: the enterprise image is the community build
# plus ee/. For every other image the two passes differ only in the
# IS_ENTERPRISE_EDITION build arg. Both halves are pinned below, against the
# real Dockerfile templates as well as synthetic ones, together with the tag
# set the Helm chart and docker-compose depend on (every image, both editions,
# the arch suffix of the per-arch builds and the "+" sanitisation).
#
# Run with: npm run test-gha-scripts   (or bash Scripts/GHA/Tests/build_docker_images_test.sh)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_SCRIPT="${SCRIPT_DIR}/../build_docker_images.sh"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

# The push retry waits minutes between attempts in production.
export RETRY_WITH_BACKOFF_DELAYS="0 0 0"

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

# A fake docker that records each call as one file, one argument per line, so
# the assertions can look at exact arguments (and argument pairs) rather than
# at a flattened string. FAKE_DOCKER_FAIL_TIMES makes the first N calls fail,
# the way GHCR's secondary rate limit fails a push.
BIN_DIR="${WORK_DIR}/bin"
mkdir -p "$BIN_DIR"
cat > "${BIN_DIR}/docker" <<'FAKE_EOF'
#!/usr/bin/env bash
set -uo pipefail
count_file="${FAKE_DOCKER_STATE_DIR}/count"
count=0
[[ -f "$count_file" ]] && count="$(cat "$count_file")"
count=$(( count + 1 ))
echo "$count" > "$count_file"
printf '%s\n' "$@" > "${FAKE_DOCKER_STATE_DIR}/call-${count}"
if (( count <= ${FAKE_DOCKER_FAIL_TIMES:-0} )); then
	echo "denied: permission_denied: You have exceeded a secondary rate limit" >&2
	exit 1
fi
exit 0
FAKE_EOF
chmod +x "${BIN_DIR}/docker"
export PATH="${BIN_DIR}:${PATH}"

reset_state() {
	export FAKE_DOCKER_STATE_DIR="${WORK_DIR}/state-${RANDOM}-${RANDOM}"
	mkdir -p "$FAKE_DOCKER_STATE_DIR"
	export FAKE_DOCKER_FAIL_TIMES=0
}

call_count() {
	if [[ -f "${FAKE_DOCKER_STATE_DIR}/count" ]]; then
		cat "${FAKE_DOCKER_STATE_DIR}/count"
	else
		echo 0
	fi
}

# The arguments of call N, one per line.
call_args() {
	cat "${FAKE_DOCKER_STATE_DIR}/call-$1" 2>/dev/null || true
}

# Every value passed after a given flag in call N (e.g. every --tag), one per line.
flag_values() {
	local call="$1" flag="$2"
	call_args "$call" | awk -v flag="$flag" 'take { print; take = 0; next } $0 == flag { take = 1 }'
}

# 1 when call N contains the exact argument, 0 otherwise.
has_arg() {
	local call="$1" arg="$2"
	if call_args "$call" | grep -qxF -- "$arg"; then
		echo 1
	else
		echo 0
	fi
}

sorted_lines() {
	printf '%s\n' "$@" | sort
}

# Renders the production branch of a Dockerfile.tpl the way gomplate does for
# ENVIRONMENT=production: drop the development branch and the markers. The App
# and every other image template use only this one if/else/end construct.
render_production() {
	local template="$1" output="$2"
	sed -e '/^{{ if eq .Env.ENVIRONMENT "development" }}$/,/^{{ else }}$/d' \
		-e '/^{{ end }}$/d' "$template" > "$output"
	if grep -q '{{' "$output"; then
		echo "render_production: unexpected template syntax left in ${output}" >&2
		return 1
	fi
}

TARGETS_DOCKERFILE="${WORK_DIR}/Dockerfile.targets"
cat > "$TARGETS_DOCKERFILE" <<'EOF'
FROM node:26-alpine AS base
FROM base AS community-build
FROM community-build AS enterprise-build
FROM enterprise-build AS enterprise
FROM community-build AS community
EOF

LEGACY_DOCKERFILE="${WORK_DIR}/Dockerfile.legacy"
cat > "$LEGACY_DOCKERFILE" <<'EOF'
FROM node:26-alpine
ARG IS_ENTERPRISE_EDITION=false
ENV IS_ENTERPRISE_EDITION=${IS_ENTERPRISE_EDITION}
EOF

run_build() {
	bash "$BUILD_SCRIPT" "$@" 2>&1
}

echo "build_docker_images.sh"

# --- Target mode: a Dockerfile with an `AS enterprise` stage. ---
reset_state
status=0
output="$(run_build --image app --version 13.1.0 --dockerfile "$TARGETS_DOCKERFILE" --git-sha 0123456789abcdef)" || status=$?
assert_eq 0 "$status" "target mode: succeeds"
assert_eq 2 "$(call_count)" "target mode: builds exactly two images"
assert_eq "buildx build" "$(call_args 1 | head -2 | tr '\n' ' ' | sed 's/ $//')" "target mode: runs docker buildx build"
assert_eq "community" "$(flag_values 1 --target)" "target mode: the first pass builds --target community"
assert_eq "enterprise" "$(flag_values 2 --target)" "target mode: the second pass builds --target enterprise"
assert_eq "" "$(flag_values 1 --build-arg | grep IS_ENTERPRISE_EDITION)" "target mode: community pass passes no IS_ENTERPRISE_EDITION build arg"
assert_eq "" "$(flag_values 2 --build-arg | grep IS_ENTERPRISE_EDITION)" "target mode: enterprise pass passes no IS_ENTERPRISE_EDITION build arg"
assert_eq "$(sorted_lines oneuptime/app:13.1.0 ghcr.io/oneuptime/app:13.1.0)" "$(flag_values 1 --tag | sort)" "target mode: community tags are <image>:<version> on Docker Hub and GHCR"
assert_eq "$(sorted_lines oneuptime/app:enterprise-13.1.0 ghcr.io/oneuptime/app:enterprise-13.1.0)" "$(flag_values 2 --tag | sort)" "target mode: enterprise tags carry the enterprise- prefix"
assert_eq "com.oneuptime.edition=community" "$(flag_values 1 --label)" "target mode: community image is labelled community"
assert_eq "com.oneuptime.edition=enterprise" "$(flag_values 2 --label)" "target mode: enterprise image is labelled enterprise"
assert_eq "$(sorted_lines APP_VERSION=13.1.0 GIT_SHA=0123456789abcdef)" "$(flag_values 1 --build-arg | sort)" "target mode: community build args are GIT_SHA and APP_VERSION only"
assert_eq "$(sorted_lines APP_VERSION=13.1.0 GIT_SHA=0123456789abcdef)" "$(flag_values 2 --build-arg | sort)" "target mode: enterprise build args are GIT_SHA and APP_VERSION only"
assert_eq "$TARGETS_DOCKERFILE" "$(flag_values 1 --file)" "target mode: passes the Dockerfile"
assert_eq "linux/amd64,linux/arm64" "$(flag_values 1 --platform)" "target mode: defaults to both platforms"
assert_eq 1 "$(has_arg 1 --push)" "target mode: pushes the community image"
assert_eq 1 "$(has_arg 2 --push)" "target mode: pushes the enterprise image"
assert_eq 1 "$(has_arg 2 --sbom=true)" "target mode: keeps the SBOM attestation"
assert_eq 1 "$(has_arg 2 --provenance=mode=max)" "target mode: keeps the provenance attestation"
assert_eq "." "$(call_args 2 | tail -1)" "target mode: the build context is last and defaults to ."
assert_contains "$output" "from the community and enterprise targets of" "target mode: says it is building targets"
assert_contains "$output" "Pushed enterprise image for app:enterprise-13.1.0" "target mode: reports the enterprise push"

# --- Build-arg mode: every other image. ---
reset_state
status=0
output="$(run_build --image probe --version 13.1.0 --dockerfile "$LEGACY_DOCKERFILE" --git-sha abc)" || status=$?
assert_eq 0 "$status" "build-arg mode: succeeds"
assert_eq 2 "$(call_count)" "build-arg mode: builds exactly two images"
assert_eq "" "$(flag_values 1 --target)" "build-arg mode: community pass has no --target"
assert_eq "" "$(flag_values 2 --target)" "build-arg mode: enterprise pass has no --target"
assert_eq "$(sorted_lines APP_VERSION=13.1.0 GIT_SHA=abc IS_ENTERPRISE_EDITION=false)" "$(flag_values 1 --build-arg | sort)" "build-arg mode: community pass sets IS_ENTERPRISE_EDITION=false"
assert_eq "$(sorted_lines APP_VERSION=13.1.0 GIT_SHA=abc IS_ENTERPRISE_EDITION=true)" "$(flag_values 2 --build-arg | sort)" "build-arg mode: enterprise pass sets IS_ENTERPRISE_EDITION=true"
assert_eq "$(sorted_lines oneuptime/probe:13.1.0 ghcr.io/oneuptime/probe:13.1.0)" "$(flag_values 1 --tag | sort)" "build-arg mode: community tags unchanged"
assert_eq "$(sorted_lines oneuptime/probe:enterprise-13.1.0 ghcr.io/oneuptime/probe:enterprise-13.1.0)" "$(flag_values 2 --tag | sort)" "build-arg mode: enterprise tags unchanged"
assert_eq "com.oneuptime.edition=enterprise" "$(flag_values 2 --label)" "build-arg mode: enterprise image is labelled enterprise too"

# --- The real templates: the App uses targets, the other images do not. ---
reset_state
RENDERED_APP="${WORK_DIR}/Dockerfile.app"
if render_production "${REPO_ROOT}/packages/App/Dockerfile.tpl" "$RENDERED_APP"; then
	pass "renders the App's production Dockerfile"
else
	fail "renders the App's production Dockerfile"
fi
status=0
run_build --image app --version 13.1.0 --dockerfile "$RENDERED_APP" --git-sha abc > /dev/null || status=$?
assert_eq 0 "$status" "real App Dockerfile: succeeds"
assert_eq "community" "$(flag_values 1 --target)" "real App Dockerfile: builds --target community first"
assert_eq "enterprise" "$(flag_values 2 --target)" "real App Dockerfile: builds --target enterprise second"

# Every other image template, as-is: the detection only reads FROM lines, and
# the templates' own gomplate markers never produce one. Some of them use
# gomplate functions (file.Exists) that the sed rendering above cannot handle,
# so they are not rendered.
OTHER_TEMPLATES=()
for template in "${REPO_ROOT}"/packages/*/Dockerfile.tpl "${REPO_ROOT}"/agents/*/Dockerfile.tpl "${REPO_ROOT}"/Tests/Dockerfile.tpl; do
	[[ -f "$template" ]] || continue
	[[ "$template" == "${REPO_ROOT}/packages/App/Dockerfile.tpl" ]] && continue
	OTHER_TEMPLATES+=("$template")
done
if (( ${#OTHER_TEMPLATES[@]} >= 5 )); then
	pass "found the other image templates (${#OTHER_TEMPLATES[@]})"
else
	fail "found the other image templates — only ${#OTHER_TEMPLATES[@]}"
fi
for template in "${OTHER_TEMPLATES[@]}"; do
	reset_state
	status=0
	run_build --image x --version 1.0.0 --dockerfile "$template" --git-sha abc > /dev/null || status=$?
	assert_eq "0 |IS_ENTERPRISE_EDITION=true" "${status} |$(flag_values 2 --target)$(flag_values 2 --build-arg | grep IS_ENTERPRISE_EDITION)" "real ${template#"${REPO_ROOT}/"}: stays in build-arg mode"
done

# --- Only a real `AS enterprise` stage switches to target mode. ---
DECOY_DOCKERFILE="${WORK_DIR}/Dockerfile.decoy"
cat > "$DECOY_DOCKERFILE" <<'EOF'
# FROM base AS enterprise   (a comment, not a stage)
FROM node:26-alpine AS base
FROM base AS enterprise-build
RUN echo "FROM x AS enterprise"
EOF
reset_state
run_build --image x --version 1.0.0 --dockerfile "$DECOY_DOCKERFILE" --git-sha abc > /dev/null
assert_eq "" "$(flag_values 1 --target)$(flag_values 2 --target)" "decoys (a comment, an enterprise-build stage, a RUN string) do not enable target mode"

LOWERCASE_DOCKERFILE="${WORK_DIR}/Dockerfile.lowercase"
printf 'from node:26-alpine as base\nfrom base as enterprise\nfrom base as community\n' > "$LOWERCASE_DOCKERFILE"
reset_state
run_build --image x --version 1.0.0 --dockerfile "$LOWERCASE_DOCKERFILE" --git-sha abc > /dev/null
assert_eq "community enterprise" "$(flag_values 1 --target) $(flag_values 2 --target)" "a lowercase 'from ... as enterprise' stage counts, as it does for Docker"

# --- Single-platform (per-arch) builds suffix every tag with the arch. ---
reset_state
run_build --image app --version 13.1.0 --dockerfile "$TARGETS_DOCKERFILE" --git-sha abc --platforms linux/arm64 > /dev/null
assert_eq "$(sorted_lines oneuptime/app:13.1.0-arm64 ghcr.io/oneuptime/app:13.1.0-arm64)" "$(flag_values 1 --tag | sort)" "per-arch: community tags end in -arm64"
assert_eq "$(sorted_lines oneuptime/app:enterprise-13.1.0-arm64 ghcr.io/oneuptime/app:enterprise-13.1.0-arm64)" "$(flag_values 2 --tag | sort)" "per-arch: enterprise tags end in -arm64"
assert_eq "linux/arm64" "$(flag_values 2 --platform)" "per-arch: passes the single platform"

# --- "+" is not valid in a tag; the build arg keeps the real version. ---
reset_state
run_build --image app --version 13.1.0+build.7 --dockerfile "$TARGETS_DOCKERFILE" --git-sha abc --platforms linux/amd64 > /dev/null
assert_eq "$(sorted_lines oneuptime/app:enterprise-13.1.0-build.7-amd64 ghcr.io/oneuptime/app:enterprise-13.1.0-build.7-amd64)" "$(flag_values 2 --tag | sort)" "sanitises + to - in tags"
assert_eq "APP_VERSION=13.1.0+build.7" "$(flag_values 2 --build-arg | grep APP_VERSION)" "APP_VERSION keeps the unsanitised version"

# --- Extra tags go to their own edition only (test-release's test/enterprise-test). ---
reset_state
run_build --image app --version 13.1.0-test --dockerfile "$TARGETS_DOCKERFILE" --git-sha abc --platforms linux/amd64 \
	--extra-tags test --extra-tags latest --extra-enterprise-tags enterprise-test > /dev/null
assert_eq "$(sorted_lines oneuptime/app:13.1.0-test-amd64 ghcr.io/oneuptime/app:13.1.0-test-amd64 oneuptime/app:test-amd64 ghcr.io/oneuptime/app:test-amd64 oneuptime/app:latest-amd64 ghcr.io/oneuptime/app:latest-amd64)" "$(flag_values 1 --tag | sort)" "extra community tags are added to the community image only"
assert_eq "$(sorted_lines oneuptime/app:enterprise-13.1.0-test-amd64 ghcr.io/oneuptime/app:enterprise-13.1.0-test-amd64 oneuptime/app:enterprise-test-amd64 ghcr.io/oneuptime/app:enterprise-test-amd64)" "$(flag_values 2 --tag | sort)" "extra enterprise tags are added to the enterprise image only"

# --- --context is passed through as the last argument. ---
reset_state
run_build --image app --version 1.0.0 --dockerfile "$TARGETS_DOCKERFILE" --git-sha abc --context ./some/dir > /dev/null
assert_eq "./some/dir" "$(call_args 1 | tail -1)" "passes --context as the build context"

# --- A rate-limited push is retried, and the enterprise pass still runs. ---
reset_state
export FAKE_DOCKER_FAIL_TIMES=1
status=0
output="$(run_build --image app --version 1.0.0 --dockerfile "$TARGETS_DOCKERFILE" --git-sha abc)" || status=$?
assert_eq 0 "$status" "recovers from a rate-limited push"
assert_eq 3 "$(call_count)" "retries the failed community push once, then builds enterprise"
assert_eq "community community enterprise" "$(flag_values 1 --target) $(flag_values 2 --target) $(flag_values 3 --target)" "retries the same target"
assert_contains "$output" "succeeded on attempt 2/4" "reports the retry"

# --- A community push that never succeeds stops before the enterprise pass. ---
reset_state
export FAKE_DOCKER_FAIL_TIMES=99
status=0
run_build --image app --version 1.0.0 --dockerfile "$TARGETS_DOCKERFILE" --git-sha abc > /dev/null || status=$?
assert_eq 1 "$status" "fails when the community push never succeeds"
assert_eq "" "$(for n in $(seq 1 "$(call_count)"); do flag_values "$n" --target; done | grep -x enterprise)" "never builds the enterprise image after the community image failed"
export FAKE_DOCKER_FAIL_TIMES=0

# --- Argument errors. ---
reset_state
status=0
output="$(run_build --image app --version 1.0.0)" || status=$?
assert_eq 1 "$status" "fails without --dockerfile"
assert_contains "$output" "Missing required arguments" "says which arguments are missing"
assert_eq 0 "$(call_count)" "never calls docker on an argument error"

status=0
output="$(run_build --image app --version 1.0.0 --dockerfile "$TARGETS_DOCKERFILE" --bogus x)" || status=$?
assert_eq 1 "$status" "fails on an unknown option"
assert_contains "$output" "Unknown option: --bogus" "names the unknown option"

status=0
output="$(run_build --image app --version 1.0.0 --dockerfile "${WORK_DIR}/does-not-exist" --git-sha abc)" || status=$?
assert_eq 1 "$status" "fails when the Dockerfile has not been rendered"
assert_contains "$output" "npm run prerun" "says how to render the Dockerfile"
assert_eq 0 "$(call_count)" "never calls docker without a Dockerfile"

NOT_A_REPO="${WORK_DIR}/not-a-repo"
mkdir -p "$NOT_A_REPO"
status=0
output="$(cd "$NOT_A_REPO" && GIT_CEILING_DIRECTORIES="$WORK_DIR" bash "$BUILD_SCRIPT" --image app --version 1.0.0 --dockerfile "$TARGETS_DOCKERFILE" 2>&1)" || status=$?
assert_eq 1 "$status" "fails when the git SHA cannot be detected"
assert_contains "$output" "Provide --git-sha" "says how to pass the SHA"

status=0
output="$(run_build --help)" || status=$?
assert_eq 0 "$status" "--help exits 0"
assert_contains "$output" "--target community" "--help explains the target mode"

echo ""
if (( FAIL > 0 )); then
	echo "❌ ${FAIL} failed, ${PASS} passed" >&2
	exit 1
fi

echo "✅ ${PASS} passed"
