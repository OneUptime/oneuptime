#!/usr/bin/env bash
#
# Lints an Iron Bank project as Iron Bank's pipeline does before it builds
# (ironbank-tools/ironbank-pipeline on Repo1, pipeline1/0-setup), with the
# pipeline's own schema and rules as Repo1 has them today:
#
#   1. hardening_manifest.yaml against the pipeline's
#      schema/hardening_manifest.schema.json (draft 2019-09), with
#      check-jsonschema in place of the pipeline's Python jsonschema.
#   2. No label or maintainer value containing FIXME: the pipeline refuses the
#      manifest (ironbank/pipeline/hardening_manifest.py), and so does this.
#   3. The Dockerfile through semgrep with the pipeline's Dockerfile rules
#      (semgrep-dockerfile-lint). Every finding is printed; ERROR ones (root as
#      the last user, no USER, a relative WORKDIR, a mounted docker socket)
#      fail here, as they fail Iron Bank's review. Iron Bank accepts root with
#      a justification: with ALLOW_ROOT=1 the two root rules are reported and
#      do not fail. The workflow sets it for the ingress and the probe, which
#      run as root as their releases do (IronBank/README.md says why).
#
# Usage:
#   bash Scripts/IronBank/lint.sh IronBank/App
#   ALLOW_ROOT=1 bash Scripts/IronBank/lint.sh IronBank/Probe
#
# Needs curl, jq, yq and pipx (GitHub's Ubuntu runners have all four).

set -euo pipefail

DIR="${1:?Usage: lint.sh <directory with hardening_manifest.yaml and Dockerfile>}"
MANIFEST="${DIR}/hardening_manifest.yaml"
DOCKERFILE="${DIR}/Dockerfile"

PIPELINE="https://repo1.dso.mil/ironbank-tools/ironbank-pipeline/-/raw/master"
CHECK_JSONSCHEMA="check-jsonschema==0.38.2"
SEMGREP="semgrep==1.180.0"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

curl -fsSL --retry 5 --retry-all-errors -o "${WORK}/hardening_manifest.schema.json" \
	"${PIPELINE}/schema/hardening_manifest.schema.json"
curl -fsSL --retry 5 --retry-all-errors -o "${WORK}/semgrep-dockerfile-rules.yaml" \
	"${PIPELINE}/pipeline1/0-setup/semgrep-dockerfile-lint/semgrep-dockerfile-rules.yaml"

echo "1. ${MANIFEST} against Iron Bank's schema"
# The schema's patterns are Python's (`(?i)` flags, which ECMAScript does not
# have), as the pipeline's jsonschema reads them.
pipx run --spec "$CHECK_JSONSCHEMA" check-jsonschema --regex-variant python \
	--schemafile "${WORK}/hardening_manifest.schema.json" "$MANIFEST"

echo "2. No FIXME in its labels or maintainers"
FIXMES="$(yq -r '
	(.labels // {} | to_entries | .[] | select(.value | test("(?i)fixme")) | "labels." + .key),
	(.maintainers // [] | to_entries | .[] | .key as $i | .value | to_entries | .[]
		| select(.value | tostring | test("(?i)fixme")) | "maintainers[" + ($i | tostring) + "]." + .key)
' "$MANIFEST")"
if [[ -n "$FIXMES" ]]; then
	echo "::error file=${MANIFEST}::Iron Bank's pipeline refuses a hardening manifest with FIXME in it. Fill in: $(echo "$FIXMES" | paste -sd ',' - | sed 's/,/, /g')"
	exit 1
fi

echo "3. ${DOCKERFILE} through Iron Bank's semgrep rules"
pipx run --spec "$SEMGREP" semgrep scan --metrics=off --disable-version-check \
	--config "${WORK}/semgrep-dockerfile-rules.yaml" "$DOCKERFILE"
pipx run --spec "$SEMGREP" semgrep scan --metrics=off --disable-version-check --quiet \
	--config "${WORK}/semgrep-dockerfile-rules.yaml" --severity ERROR --json "$DOCKERFILE" \
	> "${WORK}/errors.json"

# semgrep names a rule by the path of the file it came from, then its id.
ALLOWED='^$'
if [[ "${ALLOW_ROOT:-0}" == "1" ]]; then
	ALLOWED='[.](last-user-is-root|missing-user)$'
fi
ACCEPTED="$(jq -r --arg allowed "$ALLOWED" \
	'.results[] | select(.check_id | test($allowed)) | (.check_id | split(".") | last)' \
	"${WORK}/errors.json")"
BLOCKING="$(jq -r --arg allowed "$ALLOWED" \
	'.results[] | select(.check_id | test($allowed) | not) | "\(.check_id | split(".") | last) (line \(.start.line)): \(.extra.message | gsub("\\s+"; " "))"' \
	"${WORK}/errors.json")"
if [[ -n "$ACCEPTED" ]]; then
	echo "::notice file=${DOCKERFILE}::Runs as root, which Iron Bank accepts with a justification (IronBank/README.md): $(echo "$ACCEPTED" | sort -u | paste -sd ',' - | sed 's/,/, /g')"
fi
if [[ -n "$BLOCKING" ]]; then
	while IFS= read -r finding; do
		echo "::error file=${DOCKERFILE}::Iron Bank's semgrep rules: ${finding}"
	done <<<"$BLOCKING"
	exit 1
fi

echo "✅ ${DIR} passes Iron Bank's lint"
