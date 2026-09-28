#!/usr/bin/env bash

# Unit tests for Scripts/GHA/warm_base_images.sh.
#
# That script exists because Build went red twice on master (runs 36338348855
# and 36315910324) on nothing but public.ecr.aws refusing to serve Docker's
# official Node image to anonymous pullers: "429 Too Many Requests - Server
# message: toomanyrequests: Data limit exceeded". The fix pulls the same image
# from Docker Hub and tags it under the ECR name, which works only because
# BuildKit resolves `FROM` from the local image store.
#
# So the behaviour worth pinning is the fallback: that a quota-exhausted ECR
# leads to a Docker Hub pull *and* a tag under the exact reference the Dockerfile
# names — get the tag wrong and the build quietly goes back to ECR and fails the
# way it did before. The rest guards the edges that would make the step lie
# about having done its job.
#
# No daemon and no network: docker is a stub whose behaviour each case sets.
#
# Run with: npm run test-gha-scripts   (or bash Scripts/GHA/Tests/warm_base_images_test.sh)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${SCRIPT_DIR}/../warm_base_images.sh"

# Zero delays everywhere: these tests exercise the fallback decision, not the
# wall clock. Attempt counts stay the same as production (delays + 1).
export RETRY_REGISTRY_READ_DELAYS="0 0 0"
export WARM_BASE_IMAGES_ECR_DELAYS="0 0"

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
		fail "$what — '${needle}' not found in:"$'\n'"${haystack}" >&2
	fi
}

assert_not_contains() {
	local haystack="$1" needle="$2" what="$3"
	if [[ "$haystack" != *"$needle"* ]]; then
		pass "$what"
	else
		fail "$what — '${needle}' unexpectedly present in:"$'\n'"${haystack}" >&2
	fi
}

WORK_DIR=""
DOCKER_LOG=""

# The verbatim message public.ecr.aws returned in run 36338348855. Reproduced
# exactly so a stub that stops resembling the real failure fails here.
ECR_DATA_LIMIT_STDERR='ERROR: failed to build: failed to solve: public.ecr.aws/docker/library/node:26-bookworm-slim: failed to copy: httpReadSeeker: failed open: unexpected status code https://public.ecr.aws/v2/docker/library/node/manifests/sha256:662933cf47f013bc8e4beb31a6116448427a82057ba7c42c97e4c5ba766504c2: 429 Too Many Requests - Server message: toomanyrequests: Data limit exceeded'

# Builds a docker stub on PATH.
#
#   $1  which pulls fail: "ecr" (public.ecr.aws only), "all", or "none"
#   $2  images `docker image inspect` should report as already present, space separated
#   $3  optional: make `docker tag` fail
new_docker_stub() {
	local fail_pulls="$1" present="${2:-}" tag_fails="${3:-}"

	WORK_DIR="$(mktemp -d)"
	DOCKER_LOG="${WORK_DIR}/docker.log"
	: > "$DOCKER_LOG"

	cat > "${WORK_DIR}/docker" <<STUB
#!/usr/bin/env bash
echo "\$*" >> "${DOCKER_LOG}"
case "\$1" in
image)
	# image inspect <ref>
	for candidate in ${present}; do
		[[ "\$3" == "\$candidate" ]] && exit 0
	done
	exit 1
	;;
pull)
	case "${fail_pulls}" in
	all)
		echo '${ECR_DATA_LIMIT_STDERR}' >&2
		exit 1
		;;
	ecr)
		if [[ "\$2" == public.ecr.aws/* ]]; then
			echo '${ECR_DATA_LIMIT_STDERR}' >&2
			exit 1
		fi
		;;
	esac
	echo "pulled \$2"
	exit 0
	;;
tag)
	if [[ -n "${tag_fails}" ]]; then
		echo "tag refused" >&2
		exit 1
	fi
	exit 0
	;;
esac
exit 0
STUB
	chmod +x "${WORK_DIR}/docker"
	export WARM_BASE_IMAGES_DOCKER="${WORK_DIR}/docker"
}

docker_calls() {
	cat "$DOCKER_LOG"
}

# Writes a Dockerfile in the stub's work dir and echoes its path.
write_dockerfile() {
	local name="$1"
	shift
	local path="${WORK_DIR}/${name}"
	printf '%s\n' "$@" > "$path"
	echo "$path"
}

echo "warm_base_images.sh"

# --- The happy path: ECR serves it, so nothing is mirrored or retagged. ---
new_docker_stub none
dockerfile="$(write_dockerfile Dockerfile \
	'FROM public.ecr.aws/docker/library/node:26-alpine3.24 AS base' \
	'RUN echo hi')"
status=0
output="$(bash "$SCRIPT" "$dockerfile" 2>&1)" || status=$?
assert_eq 0 "$status" "succeeds when public.ecr.aws serves the base image"
assert_contains "$(docker_calls)" "pull public.ecr.aws/docker/library/node:26-alpine3.24" "pulls the image from ECR"
assert_not_contains "$(docker_calls)" "pull docker.io/" "does not touch Docker Hub when ECR works"
assert_not_contains "$(docker_calls)" "tag " "does not retag when ECR works"

# --- The failure this script was written for. ---
new_docker_stub ecr
dockerfile="$(write_dockerfile Dockerfile \
	'FROM public.ecr.aws/docker/library/node:26-bookworm-slim' \
	'RUN echo hi')"
status=0
output="$(bash "$SCRIPT" "$dockerfile" 2>&1)" || status=$?
assert_eq 0 "$status" "recovers from the ECR data-limit 429 that reddened Build on master"
assert_contains "$(docker_calls)" "pull docker.io/library/node:26-bookworm-slim" "falls back to the Docker Hub original"
assert_contains "$(docker_calls)" "tag docker.io/library/node:26-bookworm-slim public.ecr.aws/docker/library/node:26-bookworm-slim" "tags the mirror under the reference the Dockerfile names"
assert_contains "$output" "Data limit exceeded" "replays the registry's own error to the log"

# The retry ladder is the reason the real job wasted its three attempts in
# thirty seconds; pin that we try ECR more than once but do not sit on it.
assert_eq 3 "$(docker_calls | grep -c 'pull public.ecr.aws/docker/library/node:26-bookworm-slim')" "retries the ECR pull WARM_BASE_IMAGES_ECR_DELAYS+1 times before giving up on it"

# --- Already local: don't spend a registry round trip at all. ---
new_docker_stub ecr "public.ecr.aws/docker/library/node:26-alpine3.24"
dockerfile="$(write_dockerfile Dockerfile \
	'FROM public.ecr.aws/docker/library/node:26-alpine3.24')"
status=0
output="$(bash "$SCRIPT" "$dockerfile" 2>&1)" || status=$?
assert_eq 0 "$status" "succeeds when the image is already in the local store"
assert_not_contains "$(docker_calls)" "pull " "pulls nothing when the image is already local"

# --- The two ladders are independent. ---
#
# ECR gets a short one because a data quota will not clear while we wait and a
# mirror is standing by; the mirror keeps retry.sh's default, because a 429 from
# Docker Hub is a per-window limit that does clear and by then it is the last
# thing left to try. The two are set through the same global, so a regression
# that let the ECR ladder carry over would quietly cut the mirror's attempts
# from four to three -- no error, just a build that gives up sooner than
# intended on the one registry it has left.
new_docker_stub all
dockerfile="$(write_dockerfile Dockerfile \
	'FROM public.ecr.aws/docker/library/node:26-alpine3.24')"
status=0
output="$(bash "$SCRIPT" "$dockerfile" 2>&1)" || status=$?
assert_eq 1 "$status" "gives up once both ladders are exhausted"
assert_eq 3 "$(docker_calls | grep -c 'pull public.ecr.aws')" "tries ECR on its own short ladder (WARM_BASE_IMAGES_ECR_DELAYS+1)"
assert_eq 4 "$(docker_calls | grep -c 'pull docker.io')" "tries the mirror on retry.sh's default ladder (RETRY_REGISTRY_READ_DELAYS+1), not ECR's"

# --- Both registries down: fail, rather than let the build fail later. ---
new_docker_stub all
dockerfile="$(write_dockerfile Dockerfile \
	'FROM public.ecr.aws/docker/library/node:26-alpine3.24')"
status=0
output="$(bash "$SCRIPT" "$dockerfile" 2>&1)" || status=$?
assert_eq 1 "$status" "fails when neither registry will serve the image"
assert_contains "$output" "Neither public.ecr.aws nor Docker Hub" "says both registries were tried"

# --- A tag that will not apply is a silent fallback to ECR, so it must fail. ---
new_docker_stub ecr "" fail
dockerfile="$(write_dockerfile Dockerfile \
	'FROM public.ecr.aws/docker/library/node:26-alpine3.24')"
status=0
output="$(bash "$SCRIPT" "$dockerfile" 2>&1)" || status=$?
assert_eq 1 "$status" "fails when the mirror cannot be tagged under the ECR name"

# --- An ECR image outside docker/library has no mirror we can name. ---
new_docker_stub all
dockerfile="$(write_dockerfile Dockerfile \
	'FROM public.ecr.aws/bitnami/mysql:8.4')"
status=0
output="$(bash "$SCRIPT" "$dockerfile" 2>&1)" || status=$?
assert_eq 1 "$status" "fails on a non-library ECR image it has no mirror mapping for"
assert_contains "$output" "no Docker Hub mirror" "explains that there is no mirror to fall back to"

# --- Parsing: stages, other registries and flags must not become pulls. ---
new_docker_stub none
dockerfile="$(write_dockerfile Dockerfile \
	'FROM --platform=$BUILDPLATFORM public.ecr.aws/docker/library/node:26-trixie-slim AS base' \
	'FROM base AS build' \
	'FROM nginx:1.30.5-alpine3.24' \
	'FROM public.ecr.aws/docker/library/node:26-trixie-slim AS runtime' \
	'RUN echo FROM public.ecr.aws/docker/library/node:should-not-be-pulled')"
status=0
output="$(bash "$SCRIPT" "$dockerfile" 2>&1)" || status=$?
assert_eq 0 "$status" "handles a multi-stage Dockerfile"
assert_contains "$(docker_calls)" "pull public.ecr.aws/docker/library/node:26-trixie-slim" "reads the image past a --platform flag"
assert_eq 1 "$(docker_calls | grep -c 'pull public.ecr.aws')" "pulls a repeated base image only once, and pulls nothing else"
assert_not_contains "$(docker_calls)" "pull base" "never treats an earlier build stage as an image"
assert_not_contains "$(docker_calls)" "nginx" "leaves non-ECR base images to the build"
assert_not_contains "$(docker_calls)" "should-not-be-pulled" "ignores a FROM that is not an instruction"

# --- Several Dockerfiles at once, as the Build workflow's App job needs. ---
new_docker_stub none
first="$(write_dockerfile Dockerfile.one 'FROM public.ecr.aws/docker/library/node:26-alpine3.24')"
second="$(write_dockerfile Dockerfile.two 'FROM public.ecr.aws/docker/library/node:26-bookworm-slim')"
status=0
output="$(bash "$SCRIPT" "$first" "$second" 2>&1)" || status=$?
assert_eq 0 "$status" "accepts more than one Dockerfile"
assert_eq 2 "$(docker_calls | grep -c 'pull public.ecr.aws')" "warms the base images of every Dockerfile given"

# --- A path that does not exist must be loud: warming nothing looks like
# --- success, and the build then hits the very quota this step avoids.
new_docker_stub none
status=0
output="$(bash "$SCRIPT" "${WORK_DIR}/Dockerfile.missing" 2>&1)" || status=$?
assert_eq 1 "$status" "fails on a Dockerfile path that does not exist"
assert_contains "$output" "No such Dockerfile" "names the missing Dockerfile"

# --- --image, for a build whose Dockerfile is written at run time. ---
#
# Tests/Ops builds real images from Dockerfiles it writes inside the test, so
# there is no file to read the FROM out of -- and those builds went red on the
# same quota (run 36370235468: EnterpriseEditionBuild and UpdateNpmCli, both
# plain `docker build` from public.ecr.aws/docker/library/node:26-alpine3.24).
new_docker_stub ecr
status=0
output="$(bash "$SCRIPT" --image public.ecr.aws/docker/library/node:26-alpine3.24 2>&1)" || status=$?
assert_eq 0 "$status" "--image: warms an image named outright, with no Dockerfile at all"
assert_contains "$(docker_calls)" "tag docker.io/library/node:26-alpine3.24 public.ecr.aws/docker/library/node:26-alpine3.24" "--image: falls back to Docker Hub for it too"

new_docker_stub none
status=0
output="$(bash "$SCRIPT" --image public.ecr.aws/docker/library/node:26-alpine3.24 --image public.ecr.aws/docker/library/node:26-bookworm-slim 2>&1)" || status=$?
assert_eq 0 "$status" "--image: accepts more than one"
assert_eq 2 "$(docker_calls | grep -c 'pull public.ecr.aws')" "--image: warms each one"

# A Dockerfile and an --image together, naming one image twice between them.
new_docker_stub none
dockerfile="$(write_dockerfile Dockerfile \
	'FROM public.ecr.aws/docker/library/node:26-alpine3.24')"
status=0
output="$(bash "$SCRIPT" "$dockerfile" --image public.ecr.aws/docker/library/node:26-alpine3.24 2>&1)" || status=$?
assert_eq 0 "$status" "--image: combines with a Dockerfile"
assert_eq 1 "$(docker_calls | grep -c 'pull public.ecr.aws')" "--image: does not pull an image twice because both named it"

new_docker_stub none
status=0
output="$(bash "$SCRIPT" --image 2>&1)" || status=$?
assert_eq 1 "$status" "--image: fails when given no reference"
assert_contains "$output" "needs an image reference" "--image: says what was missing"

new_docker_stub none
status=0
output="$(bash "$SCRIPT" --not-a-flag 2>&1)" || status=$?
assert_eq 1 "$status" "fails on an unknown option"
assert_contains "$output" "Unknown option" "names the unknown option"

# --- No arguments is a usage error, not a no-op success. ---
new_docker_stub none
status=0
output="$(bash "$SCRIPT" 2>&1)" || status=$?
assert_eq 1 "$status" "fails when given no Dockerfile"
assert_contains "$output" "Usage:" "prints usage"

# --- A Dockerfile with no ECR base image is fine and does nothing. ---
new_docker_stub none
dockerfile="$(write_dockerfile Dockerfile 'FROM alpine:3.22' 'RUN echo hi')"
status=0
output="$(bash "$SCRIPT" "$dockerfile" 2>&1)" || status=$?
assert_eq 0 "$status" "succeeds on a Dockerfile with no ECR base image"
assert_not_contains "$(docker_calls)" "pull " "pulls nothing when there is no ECR base image"

echo ""
if (( FAIL > 0 )); then
	echo "❌ ${FAIL} failed, ${PASS} passed" >&2
	exit 1
fi

echo "✅ ${PASS} passed"
