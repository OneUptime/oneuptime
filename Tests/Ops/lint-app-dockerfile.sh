#!/usr/bin/env bash
#
# Lints the App's Dockerfile, as it renders for production and for
# development, with BuildKit itself: `docker buildx build --check` parses the
# Dockerfile, resolves the stage graph for the given --target and runs
# BuildKit's build checks, without building anything.
#
# The production render is checked for the default target and for both edition
# targets (community, enterprise), because each target resolves a different
# stage graph: a typo in a stage name or a FROM that points at a stage defined
# later only shows up for the target that reaches it. The jest suite
# (EnterpriseEditionBuild.test.js) pins what the stages contain; this pins that
# BuildKit accepts them.
#
# Needs docker with buildx. Rendering uses Utils/DockerfileTemplate.js, so no
# gomplate is needed. Run from anywhere:
#
#   bash Tests/Ops/lint-app-dockerfile.sh
#
# Each check goes through Scripts/GHA/buildx_check.sh, which gives it an empty
# context (--check reads only the Dockerfile) and, when public.ecr.aws refuses
# the base images with its anonymous-quota 429, checks again with them taken
# from Docker Hub.

set -euo pipefail

OPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${OPS_DIR}/../.." && pwd)"
TEMPLATE="${REPO_ROOT}/packages/App/Dockerfile.tpl"
BUILDX_CHECK="${REPO_ROOT}/Scripts/GHA/buildx_check.sh"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

node "${OPS_DIR}/Utils/DockerfileTemplate.js" "$TEMPLATE" production > "${WORK_DIR}/Dockerfile.production"
node "${OPS_DIR}/Utils/DockerfileTemplate.js" "$TEMPLATE" development > "${WORK_DIR}/Dockerfile.development"

FAILED=0

# check <label> <dockerfile> [<docker buildx build option>...]
check() {
	local label="$1"
	shift
	echo "── ${label}"
	if bash "$BUILDX_CHECK" "$@"; then
		echo "✅ ${label}"
	else
		echo "❌ ${label}" >&2
		FAILED=1
	fi
}

check "production, default target" "${WORK_DIR}/Dockerfile.production"
check "production, --target community" "${WORK_DIR}/Dockerfile.production" --target community
check "production, --target enterprise" "${WORK_DIR}/Dockerfile.production" --target enterprise
check "development" "${WORK_DIR}/Dockerfile.development"

if [[ "$FAILED" -ne 0 ]]; then
	echo "❌ BuildKit rejected the App Dockerfile" >&2
	exit 1
fi

echo "✅ BuildKit accepts every render and target of the App Dockerfile"
