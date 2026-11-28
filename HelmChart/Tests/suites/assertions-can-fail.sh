#!/usr/bin/env bash
#
# Every refusal the charts' helm-unittest suites hold can fail (#11403).
#
# The unit suite shows each assertion passing on the real charts, which says
# nothing about whether it could fail. helm-unittest 0.5.1, which CI pinned
# until #11403, has no failedTemplate errorPattern: it read one as no
# assertion, and 72 tests passed whatever their messages said. So this suite
# plants mistakes and requires each check to catch them:
#
#   0. The harness's own assertions, which the other suites use: each fails
#      on a value it should refuse, an empty needle among them (grep finds
#      the empty string in any text, so assert_present once passed one).
#   1. The pinned helm-unittest itself, on a chart of the suite's own: a
#      template's `fail` and a values.schema.json refusal, each held to its
#      whole message by errorMessage and to a pattern by errorPattern. Each
#      right one must pass and each wrong one fail; failedTemplate must fail on
#      a render that succeeds, notFailedTemplate on one that fails; and
#      --strict must refuse a key a test does not have.
#   2. Every refusal in both charts' suites. In a copy of each chart, every
#      errorMessage is replaced by a planted one no message says, and each
#      suite file with any is run on its own: every test that holds one must
#      fail, and no other. A test that still passes holds a refusal that
#      cannot fail.
#
# Part 2 rewrites the suites line by line, so it relies on the layout
# Tests/Ops/HelmUnittestAssertions.test.js holds them to: every failedTemplate
# a block mapping whose errorMessage key starts its own line, its value on
# that line or indented below it, and none shared between tests by a YAML
# alias.

# shellcheck source=../lib/harness.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/harness.sh"

harness_install_helm
harness_install_unittest_plugin

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

assert_eq "the suites run the helm-unittest the harness pins" \
    "${HELM_UNITTEST_VERSION#v}" "$(harness_unittest_installed_version)"

# junit_outcomes <JUnit file>: one "<pass|fail><TAB><test name>" line per test,
# in the order helm-unittest ran them. A test that errored (a render error no
# assertion expected) counts as failed.
junit_outcomes() {
    awk '
        function unescape(s) {
            gsub(/&#39;/, "\047", s)
            gsub(/&#34;/, "\"", s)
            gsub(/&quot;/, "\"", s)
            gsub(/&lt;/, "<", s)
            gsub(/&gt;/, ">", s)
            gsub(/&amp;/, "\\&", s)
            return s
        }
        function flush() {
            if (have) {
                print outcome "\t" name
            }
            have = 0
        }
        /<testcase / {
            flush()
            line = $0
            sub(/.* name="/, "", line)
            sub(/".*/, "", line)
            name = unescape(line)
            outcome = "pass"
            have = 1
        }
        /<failure|<error/ {
            outcome = "fail"
        }
        END {
            flush()
        }
    ' "$1"
}

# ---------------------------------------------------------------------------
# 0. The harness's own assertions
# ---------------------------------------------------------------------------

# harness_outcome <assertion> <its arguments...>: "pass" or "fail", as the
# harness's tally scores it, kept apart from this suite's tally.
harness_outcome() {
    (
        PASSES=0
        FAILURES=0
        "$@" >/dev/null
        if [ "$FAILURES" -gt 0 ]; then
            echo fail
        elif [ "$PASSES" -gt 0 ]; then
            echo pass
        else
            echo none
        fi
    )
}

assert_eq "assert_present fails on an empty needle, which any text holds" \
    fail "$(harness_outcome assert_present "x" "the CronJob runs kubectl" "")"
assert_eq "assert_present fails on an empty needle in an empty text" \
    fail "$(harness_outcome assert_present "x" "" "")"
assert_eq "assert_present fails on a needle the text lacks" \
    fail "$(harness_outcome assert_present "x" "the CronJob runs kubectl" "helm")"
assert_eq "assert_present passes on a needle the text holds" \
    pass "$(harness_outcome assert_present "x" "the CronJob runs kubectl" "kubectl")"
assert_eq "assert_absent fails on an empty needle" \
    fail "$(harness_outcome assert_absent "x" "the CronJob runs kubectl" "")"
assert_eq "assert_absent fails on a needle the text holds" \
    fail "$(harness_outcome assert_absent "x" "the CronJob runs kubectl" "kubectl")"
assert_eq "assert_absent passes on a needle the text lacks" \
    pass "$(harness_outcome assert_absent "x" "the CronJob runs kubectl" "helm")"
assert_eq "assert_eq fails on two values that differ" \
    fail "$(harness_outcome assert_eq "x" "a" "b")"
assert_eq "assert_eq passes on two that are the same" \
    pass "$(harness_outcome assert_eq "x" "a" "a")"

# ---------------------------------------------------------------------------
# 1. The pinned helm-unittest, on a chart of this suite's own
# ---------------------------------------------------------------------------

CANARY="${WORK_DIR}/canary"
mkdir -p "${CANARY}/templates" "${CANARY}/tests"

cat >"${CANARY}/Chart.yaml" <<'YAML'
apiVersion: v2
name: canary
version: 0.1.0
YAML

cat >"${CANARY}/values.yaml" <<'YAML'
mode: ok
flag: true
YAML

cat >"${CANARY}/values.schema.json" <<'JSON'
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "mode": { "type": "string" },
    "flag": { "type": "boolean" }
  }
}
JSON

cat >"${CANARY}/templates/configmap.yaml" <<'YAML'
{{- if eq .Values.mode "refuse" }}
{{- fail "mode is refuse, which this chart refuses." }}
{{- end }}
apiVersion: v1
kind: ConfigMap
metadata:
  name: canary
data:
  mode: {{ .Values.mode | quote }}
YAML

# Each test's name says what it must do. The schema's message is Helm's, from
# the Helm helm-unittest is built on.
cat >"${CANARY}/tests/canary_test.yaml" <<'YAML'
suite: canary
templates:
  - templates/configmap.yaml
tests:
  - it: "passes: the right message for a template's fail"
    set:
      mode: refuse
    asserts:
      - failedTemplate:
          errorMessage: mode is refuse, which this chart refuses.
  - it: "fails: a wrong message for a template's fail"
    set:
      mode: refuse
    asserts:
      - failedTemplate:
          errorMessage: mode is refuse, which this chart takes.
  - it: "fails: the right message cut short, for a template's fail"
    set:
      mode: refuse
    asserts:
      - failedTemplate:
          errorMessage: mode is refuse
  - it: "passes: the right pattern for a template's fail"
    set:
      mode: refuse
    asserts:
      - failedTemplate:
          errorPattern: '^mode is refuse, which this chart refuses\.$'
  - it: "fails: a wrong pattern for a template's fail"
    set:
      mode: refuse
    asserts:
      - failedTemplate:
          errorPattern: '^no message says this$'
  - it: "passes: the right message for a schema refusal"
    set:
      flag: "yes"
    asserts:
      - failedTemplate:
          errorMessage: |
            values don't meet the specifications of the schema(s) in the following chart(s):
            canary:
            - at '/flag': got string, want boolean
  - it: "fails: a wrong message for a schema refusal"
    set:
      flag: "yes"
    asserts:
      - failedTemplate:
          errorMessage: |
            values don't meet the specifications of the schema(s) in the following chart(s):
            canary:
            - at '/flag': got number, want boolean
  - it: "fails: a wrong pattern for a schema refusal"
    set:
      flag: "yes"
    asserts:
      - failedTemplate:
          errorPattern: 'no message says this'
  - it: "fails: failedTemplate on a render that succeeds"
    asserts:
      - failedTemplate:
          errorMessage: mode is refuse, which this chart refuses.
  - it: "fails: an empty failedTemplate on a render that succeeds"
    asserts:
      - failedTemplate: {}
  - it: "fails: notFailedTemplate on a template's fail"
    set:
      mode: refuse
    asserts:
      - notFailedTemplate: {}
  - it: "fails: notFailedTemplate on a schema refusal"
    set:
      flag: "yes"
    asserts:
      - notFailedTemplate: {}
  - it: "passes: notFailedTemplate on a render that succeeds"
    asserts:
      - notFailedTemplate: {}
YAML

# Run on its own: --strict refuses the whole file.
cat >"${CANARY}/tests/misspelt-key_test.yaml" <<'YAML'
suite: canary with a misspelt key
templates:
  - templates/configmap.yaml
tests:
  - it: would pass on the chart's defaults, which it was never meant to test
    sets:
      mode: refuse
    asserts:
      - notFailedTemplate: {}
YAML

canary_xml="${WORK_DIR}/canary.xml"
if harness_helm_unittest -t JUnit -o "$canary_xml" -f tests/canary_test.yaml "$CANARY" >"${WORK_DIR}/canary.log" 2>&1; then
    fail "helm unittest passed every canary test, though half of them must fail"
else
    pass "helm unittest fails the canary suite, which holds tests that must fail"
fi

canary_outcomes="$(junit_outcomes "$canary_xml")"
expected_names="$(awk '/^  - it: / { sub(/^  - it: "/, ""); sub(/"$/, ""); print }' "${CANARY}/tests/canary_test.yaml")"
while IFS= read -r name; do
    [ -n "$name" ] || continue
    want="pass"
    case "$name" in
        fails:*) want="fail" ;;
    esac
    got="$(awk -F '\t' -v n="$name" '$2 == n { print $1; exit }' <<<"$canary_outcomes")"
    if [ -z "$got" ]; then
        fail "canary: helm-unittest ran no test named '${name}'"
    elif [ "$got" = "$want" ]; then
        pass "canary: ${name}"
    else
        fail "canary: ${name} (it ${got}ed)"
    fi
done <<<"$expected_names"
if [ "$FAILURES" -ne 0 ]; then
    sed 's/^/        /' "${WORK_DIR}/canary.log"
fi

if harness_helm_unittest -f tests/misspelt-key_test.yaml "$CANARY" >"${WORK_DIR}/misspelt.log" 2>&1; then
    fail "--strict let a test with a misspelt key (sets: for set:) run on the chart's defaults"
    sed 's/^/        /' "${WORK_DIR}/misspelt.log"
else
    assert_present "--strict refuses a test with a misspelt key (sets: for set:)" \
        "$(cat "${WORK_DIR}/misspelt.log")" "field sets not found"
fi

# ---------------------------------------------------------------------------
# 2. Every refusal in both charts' suites, with a mistake planted in each
# ---------------------------------------------------------------------------

# plant_mistakes <suite file> <out file>: writes the suite with every
# errorMessage replaced by a planted one, and prints how many tests hold one.
# An errorMessage's value is the rest of its line and every line indented
# deeper below it (a block scalar, or a quoted one that wraps). A test holds
# one when it is written in its own asserts, or when its asserts are an alias
# (`asserts: *name`) of an earlier test's that hold one (`asserts: &name`):
# host_test.yaml holds one refusal in several templates that way.
plant_mistakes() {
    awk -v out="$2" '
        function indent_of(s) {
            match(s, /^ */)
            return RLENGTH
        }
        # The name after `asserts: &` or `asserts: *` on a line, or nothing.
        function asserts_ref(s, sigil,    ref) {
            if (!match(s, "asserts:[ \t]*[" sigil "][A-Za-z0-9_.-]+")) {
                return ""
            }
            ref = substr(s, RSTART, RLENGTH)
            sub(/^asserts:[ \t]*./, "", ref)
            return ref
        }
        function count_test() {
            if (!test_planted) {
                tests++
                test_planted = 1
            }
        }
        {
            line = $0
            if (skipping) {
                if (line ~ /^[ \t]*$/ || indent_of(line) > key_indent) {
                    next
                }
                skipping = 0
            }
            if (line ~ /^[ \t]*-[ \t]+it:/) {
                test_planted = 0
                anchor = ""
            }
            ref = asserts_ref(line, "&")
            if (ref != "") {
                anchor = ref
            }
            ref = asserts_ref(line, "*")
            if (ref != "" && (ref in planted_anchor)) {
                count_test()
            }
            if (line ~ /^[ \t]*errorMessage:/) {
                key_indent = indent_of(line)
                planted++
                count_test()
                if (anchor != "") {
                    planted_anchor[anchor] = 1
                }
                print substr(line, 1, key_indent) "errorMessage: \"planted mistake " planted ": no message says this\"" > out
                skipping = 1
                next
            }
            print line > out
        }
        END {
            print tests + 0
        }
    ' "$1"
}

for chart in "$HELM_CHART_DIR" "$KUBERNETES_AGENT_CHART_DIR"; do
    chart_name="$(basename "$chart")"
    copy="${WORK_DIR}/planted/${chart_name}"
    mkdir -p "$(dirname "$copy")"
    cp -R "$chart" "$copy"

    files=0
    tests_planted=0
    failures_before="$FAILURES"
    for suite_file in "${chart}"/tests/*_test.yaml; do
        name="$(basename "$suite_file")"
        planted="$(plant_mistakes "$suite_file" "${copy}/tests/${name}")"
        if [ "$planted" -eq 0 ]; then
            continue
        fi
        files=$((files + 1))
        tests_planted=$((tests_planted + planted))

        xml="${WORK_DIR}/planted/${chart_name}-${name%.yaml}.xml"
        harness_helm_unittest -t JUnit -o "$xml" -f "tests/${name}" "$copy" >"${xml%.xml}.log" 2>&1 || true
        outcomes="$(junit_outcomes "$xml" 2>/dev/null || true)"
        failed="$(grep -c "^fail" <<<"$outcomes" || true)"
        ran="$(grep -c "^\(pass\|fail\)" <<<"$outcomes" || true)"
        if [ "$ran" -eq 0 ]; then
            fail "${chart_name}/tests/${name}: with its refusals planted, helm-unittest ran none of its tests"
            sed 's/^/        /' "${xml%.xml}.log" | tail -20
        elif [ "$failed" -ne "$planted" ]; then
            fail "${chart_name}/tests/${name}: tests that hold a planted refusal: ${planted}; tests that failed: ${failed} (of ${ran})"
            echo "        the tests that still pass (a refusal among them cannot fail):"
            awk -F '\t' '$1 == "pass" { print "          " $2 }' <<<"$outcomes"
        fi
    done

    if [ "$files" -eq 0 ]; then
        fail "${chart_name}: found no errorMessage to plant a mistake in"
    elif [ "$FAILURES" -eq "$failures_before" ]; then
        pass "${chart_name}: each of the ${tests_planted} tests in ${files} suites that holds a refusal fails when its message is wrong"
    fi
done

harness_report
