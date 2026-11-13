#!/usr/bin/env bash
#
# Cluster-free, whole-chart coverage for twilio: the server's own Twilio
# account, set in the values instead of in Admin Dashboard > Settings > Call
# and SMS (#7515), and handed to the pods as the GLOBAL_TWILIO_ variables.
#
# tests/twilio-environment_test.yaml holds the wiring template by template.
# helm-unittest asserts only on the templates a test names, so a workload added
# later that runs the server's code without the variables -- and would send
# through the account saved in the Admin Dashboard while the others send
# through this one -- fails nothing there. Here the whole chart is rendered
# with every workload switched on, in both database layouts, and:
#
#   1. Nothing changes for an install that leaves twilio.accountSid empty: an
#      empty one, one of spaces, a Secret key name alone, or values from
#      before the block existed (helm upgrade --reuse-values) render byte for
#      byte as the chart's defaults do, with no GLOBAL_TWILIO_ variable.
#   2. With the account in the values, every workload that runs the server's
#      env helper gets all six variables, each holding its value, and no other
#      workload gets any; the auth token is written nowhere else: no Secret,
#      ConfigMap or annotation of the chart holds a copy.
#   3. With twilio.existingSecret, exactly the same workloads read the auth
#      token from that Secret, and none as a plain value.
#   4. A block nothing would read, an account without its auth token, and a
#      token given both ways are refused by helm template itself, saying what
#      to change, and never printing the token.
#   5. The schema refuses a block of the wrong shape: a use the app does not
#      know, a phone number YAML read as a number, a key the block does not
#      have.
#
# Everything here is `helm template`: no cluster, no images, no API server.

# shellcheck source=../lib/harness.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/harness.sh"

harness_install_helm

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

SECRET_NAME="oneuptime-twilio"
# Values nothing else in the chart renders, so every place they land is found.
SID="AC0twilio0sid0sentinel04d2a9e"
TOKEN="twilio-auth-token-sentinel-9c41e7"

# The six variables, and the value each is set to below.
ENV_NAMES=(
    GLOBAL_TWILIO_ACCOUNT_SID
    GLOBAL_TWILIO_AUTH_TOKEN
    GLOBAL_TWILIO_USED_FOR
    GLOBAL_TWILIO_PRIMARY_PHONE_NUMBER
    GLOBAL_TWILIO_SECONDARY_PHONE_NUMBERS
    GLOBAL_TWILIO_SMS_PHONE_NUMBERS
)
ENV_VALUES=(
    "$SID"
    "$TOKEN"
    "calls-and-sms"
    "+15005550006"
    "+441234567890,+461234567890"
    "+15005550007"
)
ACCOUNT_SETTINGS=(
    --set "twilio.accountSid=${SID}"
    --set "twilio.usedFor=calls-and-sms"
    --set-string "twilio.primaryPhoneNumber=+15005550006"
    --set-string "twilio.secondaryPhoneNumbers=+441234567890\,+461234567890"
    --set-string "twilio.smsPhoneNumbers=+15005550007"
)

# The workloads that run the server's env helper (oneuptime.env.runtime) today,
# as tests/vapid-existing-secret.sh lists them. A workload in neither this list
# nor the render fails below, so a new one is looked at rather than quietly
# given -- or quietly denied -- the account.
EXPECTED_WORKLOADS=(
    Deployment@oneuptime-app
    Deployment@oneuptime-home
    Deployment@oneuptime-nginx
    Deployment@oneuptime-telemetry-writer
    Deployment@oneuptime-test-server
    Deployment@oneuptime-worker
    Job@oneuptime-migrate-1
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

render_all_on() {
    # render_all_on <output-file> [extra helm template arguments...]; fails the
    # suite and stops when the chart does not render.
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

# How each env entry named <name> of a workload is written, one line per
# entry: "value=<value>", "secret=<name>/<key>", "both" (a value AND a
# Secret), or "neither".
entries_named() {
    # entries_named <workload-file> <env name>
    awk -v want="$2" '
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
            if ($0 ~ /^[[:space:]]*- name:[[:space:]]*/) {
                name = $0
                sub(/^[[:space:]]*- name:[[:space:]]*/, "", name)
                gsub(/["\047]/, "", name)
                sub(/[[:space:]]+$/, "", name)
                if (name == want) {
                    inentry = 1; dash = match($0, /-/)
                    hasvalue = 0; hasfrom = 0; value = ""; sname = ""; skey = ""
                }
            }
        }
        END { if (inentry) { emit() } }
    ' "$1"
}

# Every workload of a split render that is given <name>, one per line, sorted.
workloads_with() {
    # workloads_with <split-dir> <env name>
    local file
    for file in "$1"/*; do
        [ -f "$file" ] || continue
        if [ -n "$(entries_named "$file" "$2")" ]; then
            basename "$file"
        fi
    done | sort
}

# The <name> entries of a split render that are not written as <expected>, as
# "<workload>:<how>".
entries_other_than() {
    # entries_other_than <split-dir> <env name> <expected>
    local file entry
    for file in "$1"/*; do
        [ -f "$file" ] || continue
        while read -r entry; do
            [ -z "$entry" ] && continue
            [ "$entry" = "$3" ] || echo "$(basename "$file"):${entry}"
        done < <(entries_named "$file" "$2")
    done
}

# ---------------------------------------------------------------------------
# 1. Nothing changes for an install that leaves twilio.accountSid empty.
# ---------------------------------------------------------------------------
render_all_on "${WORK_DIR}/default.yaml"
assert_absent "the chart's defaults render no GLOBAL_TWILIO_ variable" "$(cat "${WORK_DIR}/default.yaml")" "GLOBAL_TWILIO_"

# Parallel arrays rather than an associative one: macOS still ships bash 3.2.
UNSET_LABELS=(empty-sid spaces-sid key-name-only values-from-before secret-null)
UNSET_SETTINGS=(
    "twilio.accountSid="
    "twilio.accountSid=   "
    "twilio.existingSecret.authTokenKey=twilio-auth-token"
    "twilio=null"
    "twilio.existingSecret=null"
)
for index in "${!UNSET_LABELS[@]}"; do
    label="${UNSET_LABELS[$index]}"
    render_all_on "${WORK_DIR}/unset-${label}.yaml" --set "${UNSET_SETTINGS[$index]}"
    if diff -q <(normalise "${WORK_DIR}/default.yaml") <(normalise "${WORK_DIR}/unset-${label}.yaml") >/dev/null; then
        pass "no account SID (${label}): the chart renders exactly as with its defaults"
    else
        fail "no account SID (${label}) changed the render"
        diff <(normalise "${WORK_DIR}/default.yaml") <(normalise "${WORK_DIR}/unset-${label}.yaml") | head -40 | sed 's/^/        /'
    fi
done

# ---------------------------------------------------------------------------
# 2. and 3. The same workloads get the account, its token from the value or
#    from the Secret -- in both database layouts.
# ---------------------------------------------------------------------------
check_layout() {
    # check_layout <label> [extra helm template arguments...]
    local label="$1"
    shift
    local plain_dir="${WORK_DIR}/${label}-plain.d" secret_dir="${WORK_DIR}/${label}-secret.d"
    local expected missing workload index name with entries copies secret_entries

    render_all_on "${WORK_DIR}/${label}-plain.yaml" "$@" "${ACCOUNT_SETTINGS[@]}" --set "twilio.authToken=${TOKEN}"
    render_all_on "${WORK_DIR}/${label}-secret.yaml" "$@" "${ACCOUNT_SETTINGS[@]}" --set "twilio.existingSecret.name=${SECRET_NAME}"
    split_workloads "${WORK_DIR}/${label}-plain.yaml" "$plain_dir"
    split_workloads "${WORK_DIR}/${label}-secret.yaml" "$secret_dir"

    expected="$(printf '%s\n' "${EXPECTED_WORKLOADS[@]}" | sort)"

    for index in "${!ENV_NAMES[@]}"; do
        name="${ENV_NAMES[$index]}"
        with="$(workloads_with "$plain_dir" "$name")"

        # The splitter and the entry reader have to see the workloads we know
        # of, or every check below passes on nothing.
        missing=""
        for workload in "${EXPECTED_WORKLOADS[@]}"; do
            grep -qxF -- "$workload" <<<"$with" || missing="${missing} ${workload}"
        done
        assert_eq "[${label}] every workload known to run the server's env helper gets ${name}" "" "$missing"
        assert_eq "[${label}] no other workload gets ${name} (a new one must be added to EXPECTED_WORKLOADS on purpose)" "$expected" "$with"
        assert_eq "[${label}] every ${name} entry holds its value" "" "$(entries_other_than "$plain_dir" "$name" "value=${ENV_VALUES[$index]}")"
    done

    # The token appears once per entry, and nowhere else in the whole render.
    entries="$(grep -c -- "- name: GLOBAL_TWILIO_AUTH_TOKEN" "${WORK_DIR}/${label}-plain.yaml" || true)"
    copies="$(grep -c -F -- "$TOKEN" "${WORK_DIR}/${label}-plain.yaml" || true)"
    assert_eq "[${label}] the auth token is written only into GLOBAL_TWILIO_AUTH_TOKEN entries, never copied into a Secret, ConfigMap or annotation" "$entries" "$copies"

    assert_eq "[${label}] with twilio.existingSecret, exactly the same workloads get GLOBAL_TWILIO_AUTH_TOKEN" "$(workloads_with "$plain_dir" GLOBAL_TWILIO_AUTH_TOKEN)" "$(workloads_with "$secret_dir" GLOBAL_TWILIO_AUTH_TOKEN)"
    assert_eq "[${label}] with twilio.existingSecret, every entry reads the operator's Secret, under authToken" "" "$(entries_other_than "$secret_dir" GLOBAL_TWILIO_AUTH_TOKEN "secret=${SECRET_NAME}/authToken")"
    secret_entries="$(entries_other_than "$secret_dir" GLOBAL_TWILIO_AUTH_TOKEN "every-entry-is-listed")"
    assert_absent "[${label}] with twilio.existingSecret, no workload renders the auth token as a plain value" "$secret_entries" ":value="
    assert_absent "[${label}] with twilio.existingSecret, no workload renders a plain value beside the Secret" "$secret_entries" ":both"
    # Sanity for the two lines above: the entry reader does see plain values.
    assert_present "[${label}] (the entry reader sees the plain values it is meant to refuse)" "$(entries_other_than "$plain_dir" GLOBAL_TWILIO_AUTH_TOKEN "every-entry-is-listed")" ":value=${TOKEN}"
    # The rest of the account stays in the values beside the Secret.
    assert_eq "[${label}] with twilio.existingSecret, the account SID stays a plain value" "" "$(entries_other_than "$secret_dir" GLOBAL_TWILIO_ACCOUNT_SID "value=${SID}")"
}

check_layout "standalone-db"
check_layout "operator-db" -f "${WORK_DIR}/operators.yaml"

# A Secret under another key name reaches every workload too.
render_all_on "${WORK_DIR}/other-key.yaml" "${ACCOUNT_SETTINGS[@]}" --set "twilio.existingSecret.name=${SECRET_NAME}" --set "twilio.existingSecret.authTokenKey=twilio-auth-token"
split_workloads "${WORK_DIR}/other-key.yaml" "${WORK_DIR}/other-key.d"
assert_eq "every workload reads the key twilio.existingSecret.authTokenKey names" "" "$(entries_other_than "${WORK_DIR}/other-key.d" GLOBAL_TWILIO_AUTH_TOKEN "secret=${SECRET_NAME}/twilio-auth-token")"

# ---------------------------------------------------------------------------
# 4. Refusals, each saying what to change.
# ---------------------------------------------------------------------------
REFUSAL_LABELS=(
    "an auth token without an account SID"
    "numbers and a use without an account SID"
    "a Secret without an account SID"
    "an account SID without its auth token"
    "an auth token given both ways"
)
REFUSAL_SETTINGS=(
    "--set twilio.authToken=${TOKEN}"
    "--set-string twilio.primaryPhoneNumber=+15005550006 --set twilio.usedFor=calls-only"
    "--set twilio.existingSecret.name=${SECRET_NAME}"
    "--set twilio.accountSid=${SID}"
    "--set twilio.accountSid=${SID} --set twilio.authToken=${TOKEN} --set twilio.existingSecret.name=${SECRET_NAME}"
)
REFUSAL_MESSAGES=(
    "twilio.accountSid is empty, so OneUptime reads none of the other twilio values, and these are set: twilio.authToken. Set twilio.accountSid to send through that Twilio account, or clear them to set the account up in the Admin Dashboard."
    "twilio.accountSid is empty, so OneUptime reads none of the other twilio values, and these are set: twilio.usedFor, twilio.primaryPhoneNumber. Set twilio.accountSid"
    "these are set: twilio.existingSecret.name. Set twilio.accountSid"
    "twilio.accountSid is set, but twilio.authToken and twilio.existingSecret.name are empty: Twilio refuses the account without its auth token. Set twilio.authToken, or name the Secret that holds it in twilio.existingSecret.name."
    "twilio.authToken and twilio.existingSecret.name are both set. Set one of them: to read the Twilio auth token from the Secret ${SECRET_NAME}, clear authToken (--set twilio.authToken=\"\")."
)
for index in "${!REFUSAL_LABELS[@]}"; do
    label="${REFUSAL_LABELS[$index]}"
    # Word splitting on purpose: each entry is a few helm arguments.
    # shellcheck disable=SC2086
    refusal="$(render_refused "${WORK_DIR}/refused-${index}.yaml" ${REFUSAL_SETTINGS[$index]})"
    if [ -n "$refusal" ]; then
        pass "helm template refuses ${label}"
    else
        fail "helm template rendered ${label}"
    fi
    assert_present "the refusal of ${label} says what to change" "$refusal" "${REFUSAL_MESSAGES[$index]}"
    assert_absent "the refusal of ${label} does not print the auth token" "$refusal" "$TOKEN"
done

# ---------------------------------------------------------------------------
# 5. The schema refuses a block of the wrong shape. Helm's wording of a schema
#    error differs between versions; each names the property it refuses.
# ---------------------------------------------------------------------------
WRONG_SHAPE_LABELS=(
    "a use the app does not know"
    "a phone number YAML reads as a number"
    "a key the block does not have"
    "a Secret key under another name"
    "a string in place of the Secret block"
)
WRONG_SHAPE_SETTINGS=(
    "twilio.usedFor=sms"
    "twilio.primaryPhoneNumber=+15005550006"
    "twilio.phoneNumber=+15005550006"
    "twilio.existingSecret.key=authToken"
    "twilio.existingSecret=${SECRET_NAME}"
)
# The property each refusal has to name.
WRONG_SHAPE_PROPERTIES=(usedFor primaryPhoneNumber phoneNumber key existingSecret)
for index in "${!WRONG_SHAPE_LABELS[@]}"; do
    label="${WRONG_SHAPE_LABELS[$index]}"
    refusal="$(render_refused "${WORK_DIR}/shape-${index}.yaml" --set "twilio.accountSid=${SID}" --set "twilio.authToken=${TOKEN}" --set "${WRONG_SHAPE_SETTINGS[$index]}")"
    if [ -n "$refusal" ]; then
        pass "the schema refuses ${label}"
    else
        fail "the chart rendered with ${label}"
    fi
    assert_present "the refusal of ${label} names twilio" "$refusal" "twilio"
    assert_present "the refusal of ${label} names ${WRONG_SHAPE_PROPERTIES[$index]}" "$refusal" "${WRONG_SHAPE_PROPERTIES[$index]}"
done

harness_report
