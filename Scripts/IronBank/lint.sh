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
#      manifest (ironbank/pipeline/hardening_manifest.py). Reported as a
#      warning here, because a project waits on those until Iron Bank's
#      onboarding team has named its engineers; set FAIL_ON_FIXME=1 to fail.
#   3. The Dockerfile through semgrep with the pipeline's Dockerfile rules
#      (semgrep-dockerfile-lint). Every finding is printed; ERROR ones (root as
#      the last user, no USER, a relative WORKDIR, a mounted docker socket)
#      fail here, as they fail Iron Bank's review.
#
# Usage:
#   bash Scripts/IronBank/lint.sh IronBank/App
#
# Needs curl, yq and pipx (GitHub's Ubuntu runners have all three).

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
	MESSAGE="Iron Bank's pipeline refuses a hardening manifest with FIXME in it. Fill in: $(echo "$FIXMES" | paste -sd ',' - | sed 's/,/, /g')"
	if [[ "${FAIL_ON_FIXME:-0}" == "1" ]]; then
		echo "::error file=${MANIFEST}::${MESSAGE}"
		exit 1
	fi
	echo "::warning file=${MANIFEST}::${MESSAGE}"
fi

echo "3. ${DOCKERFILE} through Iron Bank's semgrep rules"
pipx run --spec "$SEMGREP" semgrep scan --metrics=off --disable-version-check \
	--config "${WORK}/semgrep-dockerfile-rules.yaml" "$DOCKERFILE"
pipx run --spec "$SEMGREP" semgrep scan --metrics=off --disable-version-check --quiet \
	--config "${WORK}/semgrep-dockerfile-rules.yaml" --severity ERROR --error "$DOCKERFILE"

echo "✅ ${DIR} passes Iron Bank's lint"
