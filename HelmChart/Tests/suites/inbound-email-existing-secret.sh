#!/usr/bin/env bash
#
# Cluster-free, whole-chart coverage for inboundEmail.existingSecret: the
# incoming email webhook secret -- the last part of the Destination URL
# SendGrid's Inbound Parse posts every email to -- read from a Secret the
# operator manages instead of from inboundEmail.webhookSecret.
#
# tests/inbound-email-existing-secret_test.yaml holds the wiring template by
# template. helm-unittest asserts only on the templates a test names, so a
# workload added later that is handed INBOUND_EMAIL_WEBHOOK_SECRET in some other
# way -- or one whose env helper is swapped in a refactor -- fails nothing
# there. Here the whole chart is rendered with every workload switched on, in
# both database layouts, and:
#
#   1. Nothing changes for an install that does not name a Secret: an empty
#      name, a name of spaces, a key name alone, or values from before the
#      option existed (helm upgrade --reuse-values) render byte for byte as the
#      plain inboundEmail.webhookSecret does.
#   2. With inboundEmail.webhookSecret, every workload that gets
#      INBOUND_EMAIL_WEBHOOK_SECRET gets it as that value, and the value is
#      written nowhere else: no Secret, ConfigMap or annotation of the chart
#      holds a copy.
#   3. With inboundEmail.existingSecret, exactly the same workloads get it,
#      each from the Secret and none as a plain value; no workload gains or
#      loses it.
#   4. Both set is refused by helm template itself, saying which to clear.
#   5. The schema refuses a block of the wrong shape.
#
# Everything here is `helm template`: no cluster, no images, no API server.

# shellcheck source=../lib/harness.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/harness.sh"

harness_install_helm

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

SECRET_NAME="oneuptime-inbound-email"
# A value nothing else in the chart renders, so every place it lands is found.
SENTINEL="inbound-email-webhook-secret-sentinel-3b7f2a"
REFUSAL="inboundEmail.webhookSecret and inboundEmail.existingSecret.name are both set. Set one of them: to read the webhook secret from the Secret ${SECRET_NAME}, clear webhookSecret (--set inboundEmail.webhookSecret=\"\")."

# The workloads that run the shared env helper (oneuptime.env.common) today.
# A workload in neither this list nor the render fails below, so a new one is
# looked at rather than quietly given -- or quietly denied -- the key.
EXPECTED_WORKLOADS=(
    Deployment@oneuptime-app
    Deployment@oneuptime-home
    Deployment@oneuptime-nginx
    Deployment@oneuptime-telemetry-writer
    Deployment@oneuptime-test-server
    Deployment@oneuptime-worker
    Job@oneuptime-migrate-1
    CronJob@e2e-cron
)

# Every workload the chart runs, switched on at once (as extra-values does).
cat >"${WORK_DIR}/all-on.yaml" <<'YAML'
worker:
  enabled: true
home:
  enabled: true
telemetryWriter:
  enabled: true
testServer:
  enabled: true
pgbouncer:
  enabled: true
vllm:
  enabled: true
cronJobs:
  cleanup:
    enabled: true
  e2e:
    enabled: true
YAML

# The operator-managed database backend renders a different set of workloads.
cat >"${WORK_DIR}/operators.yaml" <<'YAML'
postgresql:
  enabled: false
postgresOperator:
  cnpg:
    enabled: true
clickhouse:
  enabled: false
clickhouseOperator:
  altinity:
    enabled: true
YAML

render() {
    # render <output-file> [extra helm template arguments...]; fails the suite
    # and stops when the chart does not render.
    local out="$1"
    shift
    if ! helm template oneuptime "$HELM_CHART_DIR" -f "${WORK_DIR}/all-on.yaml" "$@" >"$out" 2>"${out}.err"; then
        fail "helm template failed for $(basename "$out")"
        sed 's/^/        /' "${out}.err"
        harness_report
        exit 1
    fi
}

# render_refused <output-file> [extra helm template arguments...]: renders
# expecting a refusal; prints helm's error output, or nothing when it rendered.
render_refused() {
    local out="$1"
    shift
    if helm template oneuptime "$HELM_CHART_DIR" -f "${WORK_DIR}/all-on.yaml" "$@" >"$out" 2>"${out}.err"; then
        return 0
    fi
    cat "${out}.err"
}

# Chart-generated secrets and the optional timestamp label are random per
# render; everything else has to match byte for byte.
normalise() {
    sed -E 's/^( *[a-zA-Z-]+): "[A-Za-z0-9]{32}"$/\1: "<random>"/; s/date: "[0-9]+"/date: "<ts>"/' "$1"
}

# One file per workload of the chart's own templates under <dir>, named
# "<kind>@<metadata.name>". Subchart output is dropped: only documents helm
# stamps "# Source: oneuptime/templates/..." are this chart's.
split_workloads() {
    # split_workloads <manifest> <dir>
    mkdir -p "$2"
    awk -v dir="$2" '
        /^---[[:space:]]*$/ { flush(); next }
        { doc = doc $0 "\n" }
        END { flush() }
        function flush(   kind, name, own, n, i, lines, line) {
            if (doc == "") { return }
            kind = ""; name = ""; own = 0
            n = split(doc, lines, "\n")
            for (i = 1; i <= n; i++) {
                line = lines[i]
                if (line ~ /^# Source: oneuptime\/templates\//) { own = 1 }
                else if (kind == "" && line ~ /^kind:[[:space:]]/) {
                    sub(/^kind:[[:space:]]*/, "", line); kind = line
                }
                else if (name == "" && line ~ /^  name:[[:space:]]/) {
                    sub(/^  name:[[:space:]]*/, "", line); name = line
                }
            }
            if (own && name != "" && (kind == "Deployment" || kind == "StatefulSet" || \
                    kind == "Job" || kind == "CronJob" || kind == "DaemonSet")) {
                gsub(/["\047]/, "", name)
                print doc > (dir "/" kind "@" name)
                close(dir "/" kind "@" name)
            }
            doc = ""
        }
    ' "$1"
}

# How each INBOUND_EMAIL_WEBHOOK_SECRET env entry of a workload is written, one line per
# entry: "value=<value>", "secret=<name>/<key>", "both" (a value AND a
# Secret), or "neither".
inbound_entries() {
    # inbound_entries <workload-file>
    awk '
        function emit() {
            if (hasvalue && hasfrom) { print "both" }
            else if (hasvalue) { print "value=" value }
            else if (hasfrom) { print "secret=" sname "/" skey }
            else { print "neither" }
            inentry = 0
        }
        function unquote(text) {
            sub(/^[^:]*:[[:space:]]*/, "", text)
            gsub(/["\047]/, "", text)
            sub(/[[:space:]]+$/, "", text)
            return text
        }
        {
            if (inentry) {
                if ($0 ~ /^[[:space:]]*$/) { next }
                if (match($0, /[^ ]/) <= dash) { emit() }
                else {
                    if ($0 ~ /^[[:space:]]*value:/) { hasvalue = 1; value = unquote($0) }
                    else if ($0 ~ /^[[:space:]]*valueFrom:/) { hasfrom = 1 }
                    else if ($0 ~ /^[[:space:]]*name:/) { sname = unquote($0) }
                    else if ($0 ~ /^[[:space:]]*key:/) { skey = unquote($0) }
                    next
                }
            }
            if ($0 ~ /^[[:space:]]*- name:[[:space:]]*"?INBOUND_EMAIL_WEBHOOK_SECRET"?[[:space:]]*$/) {
                inentry = 1; dash = match($0, /-/)
                hasvalue = 0; hasfrom = 0; value = ""; sname = ""; skey = ""
            }
        }
        END { if (inentry) { emit() } }
    ' "$1"
}

# Every workload of a split render that is given INBOUND_EMAIL_WEBHOOK_SECRET, one per
# line, sorted.
workloads_with_key() {
    # workloads_with_key <split-dir>
    local file
    for file in "$1"/*; do
        [ -f "$file" ] || continue
        if [ -n "$(inbound_entries "$file")" ]; then
            basename "$file"
        fi
    done | sort
}

# The entries of a split render that are not written as <expected>, as
# "<workload>:<how>".
entries_other_than() {
    # entries_other_than <split-dir> <expected>
    local file entry
    for file in "$1"/*; do
        [ -f "$file" ] || continue
        while read -r entry; do
            [ -z "$entry" ] && continue
            [ "$entry" = "$2" ] || echo "$(basename "$file"):${entry}"
        done < <(inbound_entries "$file")
    done
}

# ---------------------------------------------------------------------------
# 1. Nothing changes for an install that names no Secret.
# ---------------------------------------------------------------------------
render "${WORK_DIR}/plain.yaml" --set "inboundEmail.webhookSecret=${SENTINEL}"

# Parallel arrays rather than an associative one: macOS still ships bash 3.2.
NO_SECRET_LABELS=(empty-name spaces-name key-name-only values-from-before)
NO_SECRET_SETTINGS=(
    "inboundEmail.existingSecret.name="
    "inboundEmail.existingSecret.name=   "
    "inboundEmail.existingSecret.webhookSecretKey=inbound-email-webhook-secret"
    "inboundEmail.existingSecret=null"
)
for index in "${!NO_SECRET_LABELS[@]}"; do
    label="${NO_SECRET_LABELS[$index]}"
    render "${WORK_DIR}/no-secret-${label}.yaml" --set "inboundEmail.webhookSecret=${SENTINEL}" --set "${NO_SECRET_SETTINGS[$index]}"
    if diff -q <(normalise "${WORK_DIR}/plain.yaml") <(normalise "${WORK_DIR}/no-secret-${label}.yaml") >/dev/null; then
        pass "no Secret named (${label}): the chart renders exactly as with inboundEmail.webhookSecret alone"
    else
        fail "no Secret named (${label}) changed the render"
        diff <(normalise "${WORK_DIR}/plain.yaml") <(normalise "${WORK_DIR}/no-secret-${label}.yaml") | head -40 | sed 's/^/        /'
    fi
done

# ---------------------------------------------------------------------------
# 2. and 3. The same workloads, from the value or from the Secret -- in both
#    database layouts.
# ---------------------------------------------------------------------------
check_layout() {
    # check_layout <label> [extra helm template arguments...]
    local label="$1"
    shift
    local plain_dir="${WORK_DIR}/${label}-plain.d" secret_dir="${WORK_DIR}/${label}-secret.d"
    local plain_with secret_with secret_entries expected missing workload copies entries

    render "${WORK_DIR}/${label}-plain.yaml" "$@" --set "inboundEmail.webhookSecret=${SENTINEL}"
    render "${WORK_DIR}/${label}-secret.yaml" "$@" --set "inboundEmail.existingSecret.name=${SECRET_NAME}"
    split_workloads "${WORK_DIR}/${label}-plain.yaml" "$plain_dir"
    split_workloads "${WORK_DIR}/${label}-secret.yaml" "$secret_dir"

    plain_with="$(workloads_with_key "$plain_dir")"
    secret_with="$(workloads_with_key "$secret_dir")"

    # The splitter and the entry reader have to see the workloads we know of,
    # or every check below passes on nothing.
    missing=""
    for workload in "${EXPECTED_WORKLOADS[@]}"; do
        grep -qxF -- "$workload" <<<"$plain_with" || missing="${missing} ${workload}"
    done
    assert_eq "[${label}] every workload known to run the shared env helper gets INBOUND_EMAIL_WEBHOOK_SECRET" "" "$missing"

    expected="$(printf '%s\n' "${EXPECTED_WORKLOADS[@]}" | sort)"
    assert_eq "[${label}] no other workload gets INBOUND_EMAIL_WEBHOOK_SECRET (a new one must be added to EXPECTED_WORKLOADS on purpose)" "$expected" "$plain_with"

    assert_eq "[${label}] with inboundEmail.webhookSecret, every entry is that plain value" "" "$(entries_other_than "$plain_dir" "value=${SENTINEL}")"

    # The value appears once per entry, and nowhere else in the whole render.
    entries="$(grep -c -- "- name: INBOUND_EMAIL_WEBHOOK_SECRET" "${WORK_DIR}/${label}-plain.yaml" || true)"
    copies="$(grep -c -F -- "$SENTINEL" "${WORK_DIR}/${label}-plain.yaml" || true)"
    assert_eq "[${label}] the webhook secret is written only into INBOUND_EMAIL_WEBHOOK_SECRET entries, never copied into a Secret, ConfigMap or annotation" "$entries" "$copies"

    assert_eq "[${label}] with inboundEmail.existingSecret, exactly the same workloads get INBOUND_EMAIL_WEBHOOK_SECRET" "$plain_with" "$secret_with"
    assert_eq "[${label}] with inboundEmail.existingSecret, every entry reads the operator's Secret, under webhookSecret" "" "$(entries_other_than "$secret_dir" "secret=${SECRET_NAME}/webhookSecret")"
    secret_entries="$(entries_other_than "$secret_dir" "every-entry-is-listed")"
    assert_absent "[${label}] with inboundEmail.existingSecret, no workload renders INBOUND_EMAIL_WEBHOOK_SECRET as a plain value" "$secret_entries" ":value="
    assert_absent "[${label}] with inboundEmail.existingSecret, no workload renders a plain value beside the Secret" "$secret_entries" ":both"
    # Sanity for the two lines above: the entry reader does see plain values.
    assert_present "[${label}] (the entry reader sees the plain values it is meant to refuse)" "$(entries_other_than "$plain_dir" "every-entry-is-listed")" ":value=${SENTINEL}"
}

check_layout "standalone-db"
check_layout "operator-db" -f "${WORK_DIR}/operators.yaml"

# A Secret under another key name reaches every workload too.
render "${WORK_DIR}/other-key.yaml" --set "inboundEmail.existingSecret.name=${SECRET_NAME}" --set "inboundEmail.existingSecret.webhookSecretKey=inbound-email-webhook-secret"
split_workloads "${WORK_DIR}/other-key.yaml" "${WORK_DIR}/other-key.d"
assert_eq "every workload reads the key inboundEmail.existingSecret.webhookSecretKey names" "" "$(entries_other_than "${WORK_DIR}/other-key.d" "secret=${SECRET_NAME}/inbound-email-webhook-secret")"

# ---------------------------------------------------------------------------
# 4. Both set is refused, saying which to clear.
# ---------------------------------------------------------------------------
refusal="$(render_refused "${WORK_DIR}/both.yaml" --set "inboundEmail.webhookSecret=${SENTINEL}" --set "inboundEmail.existingSecret.name=${SECRET_NAME}")"
if [ -n "$refusal" ]; then
    pass "helm template refuses inboundEmail.webhookSecret and inboundEmail.existingSecret.name together"
else
    fail "helm template rendered with inboundEmail.webhookSecret and inboundEmail.existingSecret.name both set"
fi
assert_present "the refusal says which value to clear" "$refusal" "$REFUSAL"
assert_absent "the refusal does not print the webhook secret" "$refusal" "$SENTINEL"

# ---------------------------------------------------------------------------
# 5. The schema refuses a block of the wrong shape. Helm's wording of a schema
#    error differs between versions; each names the property it refuses.
# ---------------------------------------------------------------------------
WRONG_SHAPE_LABELS=(
    "passwordKey, the key name other blocks use"
    "a string in place of the block"
    "a Secret name that is a number"
    "a key name that is a list"
)
WRONG_SHAPE_SETTINGS=(
    "inboundEmail.existingSecret.passwordKey=webhookSecret"
    "inboundEmail.existingSecret=${SECRET_NAME}"
    "inboundEmail.existingSecret.name=1234"
    "inboundEmail.existingSecret.webhookSecretKey={webhookSecret}"
)
# The property each refusal has to name.
WRONG_SHAPE_PROPERTIES=(passwordKey existingSecret name webhookSecretKey)
for index in "${!WRONG_SHAPE_LABELS[@]}"; do
    label="${WRONG_SHAPE_LABELS[$index]}"
    refusal="$(render_refused "${WORK_DIR}/shape-${index}.yaml" --set "inboundEmail.existingSecret.name=${SECRET_NAME}" --set "${WRONG_SHAPE_SETTINGS[$index]}")"
    if [ -n "$refusal" ]; then
        pass "the schema refuses ${label}"
    else
        fail "the chart rendered with ${label}"
    fi
    assert_present "the refusal of ${label} names inboundEmail.existingSecret" "$refusal" "existingSecret"
    assert_present "the refusal of ${label} names ${WRONG_SHAPE_PROPERTIES[$index]}" "$refusal" "${WRONG_SHAPE_PROPERTIES[$index]}"
done

harness_report
