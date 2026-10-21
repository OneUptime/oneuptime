#!/usr/bin/env bash

# Unit tests for Scripts/GHA/buildx_check.sh.
#
# That script exists because Ops Config Test went red twice on master on
# 2026-10-14 (runs 38508021632 and 38526538639) on nothing but public.ecr.aws
# refusing to serve .oss-scanner/Dockerfile's base images to anonymous
# pullers: "429 Too Many Requests - Server message: toomanyrequests: Data
# limit exceeded". The fix checks the Dockerfile a second time with each
# public.ecr.aws/docker/library base taken from Docker Hub.
#
# So the behaviour worth pinning is the fallback: that the quota refusal, and
# nothing else, leads to a second check, and that it substitutes every such
# base under the exact reference the Dockerfile names -- tag and digest
# included, or BuildKit goes back to ECR and fails the way it did before. A
# Dockerfile BuildKit rejects must fail at once, never be checked twice.
#
# No daemon and no network: docker is a stub whose behaviour each case sets.
#
# Run with: npm run test-gha-scripts   (or bash Scripts/GHA/Tests/buildx_check_test.sh)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${SCRIPT_DIR}/../buildx_check.sh"

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
		fail "$what — '${needle}' not found in:"$'\n'"${haystack}"
	fi
}

assert_not_contains() {
	local haystack="$1" needle="$2" what="$3"
	if [[ "$haystack" != *"$needle"* ]]; then
		pass "$what"
	else
		fail "$what — '${needle}' unexpectedly present in:"$'\n'"${haystack}"
	fi
}

WORK_DIR=""
DOCKER_LOG=""

# What BuildKit printed in run 38508021632, verbatim, so a stub that stops
# resembling the real failure fails here.
ECR_DATA_LIMIT='#3 ERROR: failed to copy: httpReadSeeker: failed open: unexpected status code https://public.ecr.aws/v2/docker/library/node/manifests/sha256:86f07bc9c5dce4578cf37e5a418b7bfc7f817cda25cde66e2b66e95ed86c4567: 429 Too Many Requests - Server message: toomanyrequests: Data limit exceeded'

# A Dockerfile BuildKit itself rejects: a failure no other registry can fix.
DOCKERFILE_REJECTED='ERROR: failed to build: failed to solve: dockerfile parse error on line 2: unknown instruction: FORM'

# Docker Hub's own rate limit, which a second check from Docker Hub cannot help.
HUB_RATE_LIMIT='ERROR: failed to solve: docker.io/library/alpine:3.22: failed to resolve source metadata: 429 Too Many Requests - Server message: toomanyrequests: You have reached your unauthenticated pull rate limit'

# Builds a docker stub on PATH. Every call is logged, one per line.
#
#   $1  "pass"           every check passes
#       "ecr-quota"      a check without --build-context gets ECR's 429; one
#                        with it passes
#       "ecr-quota-only" every check gets ECR's 429
#       "rejected"       every check gets a Dockerfile error
#       "hub-limit"      every check gets Docker Hub's rate limit
new_docker_stub() {
	local mode="$1"

	WORK_DIR="$(mktemp -d)"
	DOCKER_LOG="${WORK_DIR}/docker.log"
	: > "$DOCKER_LOG"

	cat > "${WORK_DIR}/docker" <<STUB
#!/usr/bin/env bash
echo "\$*" >> "${DOCKER_LOG}"
case "${mode}" in
pass)
	echo "Check complete, no warnings found."
	exit 0
	;;
ecr-quota)
	if [[ " \$* " == *" --build-context "* ]]; then
		echo "Check complete, no warnings found."
		exit 0
	fi
	echo '${ECR_DATA_LIMIT}' >&2
	exit 1
	;;
ecr-quota-only)
	echo '${ECR_DATA_LIMIT}' >&2
	exit 1
	;;
rejected)
	echo '${DOCKERFILE_REJECTED}' >&2
	exit 1
	;;
hub-limit)
	echo '${HUB_RATE_LIMIT}' >&2
	exit 1
	;;
esac
exit 0
STUB
	chmod +x "${WORK_DIR}/docker"
	export BUILDX_CHECK_DOCKER="${WORK_DIR}/docker"
}

docker_calls() {
	cat "$DOCKER_LOG"
}

check_count() {
	grep -c 'buildx build --check' "$DOCKER_LOG"
}

# Writes a Dockerfile in the stub's work dir and echoes its path.
write_dockerfile() {
	local name="$1"
	shift
	local path="${WORK_DIR}/${name}"
	printf '%s\n' "$@" > "$path"
	echo "$path"
}

NODE='public.ecr.aws/docker/library/node:26-bookworm-slim@sha256:86f07bc9c5dce4578cf37e5a418b7bfc7f817cda25cde66e2b66e95ed86c4567'
GO='public.ecr.aws/docker/library/golang:1.25.0-bookworm@sha256:81dc45d05a7444ead8c92a389621fafabc8e40f8fd1a19d7e5df14e61e98bc1a'

# The OSS Scanner Dockerfile's shape: a Docker Hub image, two digest-pinned
# ECR library images, and a stage that copies from the others.
scanner_dockerfile() {
	write_dockerfile Dockerfile \
		'FROM clickhouse/clickhouse-server:26.7@sha256:8397e27eebf1adf972fcd3728b37682c66fbf969ba675782a1d0ab22119a6986 AS clickhouse' \
		"FROM ${GO} AS go" \
		"FROM ${NODE}" \
		'COPY --from=go /usr/local/go /usr/local/go'
}

echo "buildx_check.sh"

# --- The happy path: one check, nothing substituted. ---
new_docker_stub pass
dockerfile="$(scanner_dockerfile)"
status=0
output="$(bash "$SCRIPT" "$dockerfile" 2>&1)" || status=$?
assert_eq 0 "$status" "passes when BuildKit accepts the Dockerfile"
assert_eq 1 "$(check_count)" "checks it once"
assert_contains "$(docker_calls)" "buildx build --check -f ${dockerfile}" "checks the Dockerfile it was given"
assert_not_contains "$(docker_calls)" "--build-context" "substitutes nothing when ECR serves the bases"

# --- The failure this script was written for. ---
new_docker_stub ecr-quota
dockerfile="$(scanner_dockerfile)"
status=0
output="$(bash "$SCRIPT" "$dockerfile" 2>&1)" || status=$?
assert_eq 0 "$status" "recovers from the ECR data-limit 429 that reddened Ops Config Test on master"
assert_eq 2 "$(check_count)" "checks a second time, once"
second="$(sed -n 2p "$DOCKER_LOG")"
assert_contains "$second" "--build-context ${NODE}=docker-image://docker.io/library/node:26-bookworm-slim@sha256:86f07bc9c5dce4578cf37e5a418b7bfc7f817cda25cde66e2b66e95ed86c4567" "takes the node base from Docker Hub, under its exact reference, digest included"
assert_contains "$second" "--build-context ${GO}=docker-image://docker.io/library/golang:1.25.0-bookworm@sha256:81dc45d05a7444ead8c92a389621fafabc8e40f8fd1a19d7e5df14e61e98bc1a" "takes the golang base from Docker Hub the same way"
assert_not_contains "$second" "clickhouse" "leaves the image that is not an ECR library image alone"
assert_contains "$output" "Data limit exceeded" "replays the registry's own error to the log"
assert_contains "$output" "::warning title=public.ecr.aws over its anonymous quota::" "says in the job's annotations that the bases came from Docker Hub"

# --- The caller's options reach both checks. ---
new_docker_stub ecr-quota
dockerfile="$(write_dockerfile Dockerfile \
	'FROM public.ecr.aws/docker/library/node:26-alpine3.24 AS base' \
	'FROM base AS enterprise' \
	'RUN echo hi')"
status=0
output="$(bash "$SCRIPT" "$dockerfile" --target enterprise 2>&1)" || status=$?
assert_eq 0 "$status" "recovers for a --target check too"
assert_eq 2 "$(grep -c -- '--target enterprise' "$DOCKER_LOG")" "passes --target to both checks"
assert_contains "$(sed -n 2p "$DOCKER_LOG")" "--build-context public.ecr.aws/docker/library/node:26-alpine3.24=docker-image://docker.io/library/node:26-alpine3.24" "substitutes a tag-only reference under its exact name"
assert_not_contains "$(sed -n 2p "$DOCKER_LOG")" "base=docker-image" "never treats an earlier stage's name as an image"

# --- A Dockerfile BuildKit rejects fails at once. ---
new_docker_stub rejected
dockerfile="$(scanner_dockerfile)"
status=0
output="$(bash "$SCRIPT" "$dockerfile" 2>&1)" || status=$?
assert_eq 1 "$status" "fails when BuildKit rejects the Dockerfile"
assert_eq 1 "$(check_count)" "never checks a rejected Dockerfile a second time"
assert_contains "$output" "unknown instruction: FORM" "shows BuildKit's reason"

# --- ECR still refusing after the fallback is a failure, not a pass. ---
new_docker_stub ecr-quota-only
dockerfile="$(scanner_dockerfile)"
status=0
output="$(bash "$SCRIPT" "$dockerfile" 2>&1)" || status=$?
assert_eq 1 "$status" "fails when the second check fails too"
assert_eq 2 "$(check_count)" "checks twice, no more"

# --- Docker Hub's own limit is not ECR's quota: no second check. ---
new_docker_stub hub-limit
dockerfile="$(write_dockerfile Dockerfile 'FROM alpine:3.22' 'RUN echo hi')"
status=0
output="$(bash "$SCRIPT" "$dockerfile" 2>&1)" || status=$?
assert_eq 1 "$status" "fails on Docker Hub's rate limit"
assert_eq 1 "$(check_count)" "does not retry what a Docker Hub substitute cannot fix"

# --- ECR's quota, but no ECR library image to take from elsewhere. ---
new_docker_stub ecr-quota-only
dockerfile="$(write_dockerfile Dockerfile 'FROM public.ecr.aws/someone/tool:1.0' 'RUN echo hi')"
status=0
output="$(bash "$SCRIPT" "$dockerfile" 2>&1)" || status=$?
assert_eq 1 "$status" "fails when no base can come from Docker Hub instead"
assert_eq 1 "$(check_count)" "does not check again with nothing to substitute"
assert_contains "$output" "names no public.ecr.aws/docker/library image" "says why it did not try Docker Hub"

# --- Usage errors are errors, not a quiet pass. ---
new_docker_stub pass
status=0
output="$(bash "$SCRIPT" 2>&1)" || status=$?
assert_eq 1 "$status" "fails when given no Dockerfile"
assert_contains "$output" "Usage:" "prints usage"
status=0
output="$(bash "$SCRIPT" "${WORK_DIR}/missing/Dockerfile" 2>&1)" || status=$?
assert_eq 1 "$status" "fails on a Dockerfile that does not exist"
assert_eq 0 "$(check_count)" "runs no check for a missing Dockerfile"

echo ""
if (( FAIL > 0 )); then
	echo "❌ ${FAIL} failed, ${PASS} passed" >&2
	exit 1
fi

echo "✅ ${PASS} passed"
