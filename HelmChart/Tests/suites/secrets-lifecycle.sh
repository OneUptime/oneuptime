#!/usr/bin/env bash
#
# Cluster-backed lifecycle tests for the chart's Secret handling.
#
# The helm-unittest suites (the `unit` suite) render without a cluster, which
# means `lookup` always comes back empty and only the "regenerate" leg of
# templates/secrets.yaml is ever exercised. The behaviour that file exists to
# provide is the opposite one: an upgrade must NOT change a secret it already
# generated. That needs a real API server, so it lives here.
#
# Covered:
#   1. helm upgrade preserves every chart-generated secret byte for byte
#      (the `lookup` -> `index $existingSecretData` recovery path).
#   2. Values that YAML would mangle survive the recovery path (the `| quote`s).
#   3. With externalSecrets configured, the chart-managed Secret carries no copy
#      of those keys, and pods read them from the user's own Secret instead.
#      https://github.com/OneUptime/oneuptime/issues/3121
#   4. Switching back to chart-managed secrets does not rotate anything.
#   5. The datastore secrets (redis / postgres / clickhouse) survive upgrades.
#
# No container images are pulled: the release is installed without --wait and
# without hooks, so only the manifests have to apply.

# shellcheck source=../lib/harness.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/harness.sh"

NAMESPACE="${NAMESPACE:-oneuptime-secrets-test}"
RELEASE="${RELEASE:-ou}"
CHART_DIR="$HELM_CHART_DIR"
CHART_SECRET="${RELEASE}-secrets"

# Reads one key out of a Secret and prints its decoded value. Prints nothing
# when the key is absent.
secret_value() {
    # secret_value <secret-name> <key>
    kubectl -n "$NAMESPACE" get secret "$1" -o "jsonpath={.data.$2}" 2>/dev/null | base64 --decode 2>/dev/null || true
}

secret_keys() {
    # secret_keys <secret-name>
    kubectl -n "$NAMESPACE" get secret "$1" -o jsonpath='{range $.data.*}{""}{end}{.data}' 2>/dev/null |
        tr ',' '\n' | sed 's/[{}"]//g' | cut -d: -f1 | sed 's/^ *//' | sort
}

# Flags every helm command in this script shares. Keda is off so the subchart
# CRDs are not needed; hooks are off so nothing waits on a Job.
HELM_ARGS=(--namespace "$NAMESPACE" --no-hooks --set keda.enabled=false)

EXTERNAL_ARGS=(
    --set externalSecrets.oneuptimeSecret.existingSecret.name=one-uptime
    --set externalSecrets.oneuptimeSecret.existingSecret.passwordKey=one-uptime-secret
    --set externalSecrets.encryptionSecret.existingSecret.name=one-uptime
    --set externalSecrets.encryptionSecret.existingSecret.passwordKey=encryption-secret
    --set externalSecrets.registerProbeKey.existingSecret.name=one-uptime
    --set externalSecrets.registerProbeKey.existingSecret.passwordKey=register-probe-key
)

# Prints the chart-managed Secret document out of a rendered manifest. Written
# without awk's `exit` on purpose: exiting mid-stream closes the pipe and, under
# `set -o pipefail`, kills the whole script with a broken-pipe error.
extract_chart_secret() {
    awk -v n="  name: ${CHART_SECRET}" '
        $0 == "---" { inblock = 0 }
        $0 == n     { inblock = 1 }
        inblock     { print }
    '
}

echo "Chart: $CHART_DIR"

harness_start_cluster
harness_namespace "$NAMESPACE"

# A cluster kept from an earlier run (KEEP_CLUSTER=true) still has the release
# and its secrets; start from nothing either way.
helm uninstall "$RELEASE" -n "$NAMESPACE" >/dev/null 2>&1 || true
kubectl -n "$NAMESPACE" delete secret \
    "$CHART_SECRET" "${RELEASE}-redis" "${RELEASE}-postgresql" "${RELEASE}-clickhouse" \
    --ignore-not-found >/dev/null 2>&1 || true

echo
echo "=== install ==="
helm install "$RELEASE" "$CHART_DIR" "${HELM_ARGS[@]}" >/dev/null
echo "installed"

ONEUPTIME_SECRET_0=$(secret_value "$CHART_SECRET" 'oneuptime-secret')
ENCRYPTION_SECRET_0=$(secret_value "$CHART_SECRET" 'encryption-secret')
REGISTER_PROBE_KEY_0=$(secret_value "$CHART_SECRET" 'register-probe-key')
PROBE_KEY_0=$(secret_value "$CHART_SECRET" 'probe-one')
RUNNER_KEY_0=$(secret_value "$CHART_SECRET" 'runner-key')
REDIS_0=$(secret_value "${RELEASE}-redis" 'redis-password')
POSTGRES_0=$(secret_value "${RELEASE}-postgresql" 'postgres-password')
CLICKHOUSE_0=$(secret_value "${RELEASE}-clickhouse" 'admin-password')

echo
echo "=== 1. a fresh install generates every chart-managed secret ==="
for pair in "oneuptime-secret:$ONEUPTIME_SECRET_0" "encryption-secret:$ENCRYPTION_SECRET_0" \
    "register-probe-key:$REGISTER_PROBE_KEY_0" "probe-one:$PROBE_KEY_0" "runner-key:$RUNNER_KEY_0" \
    "redis-password:$REDIS_0" "postgres-password:$POSTGRES_0" "admin-password:$CLICKHOUSE_0"; do
    name="${pair%%:*}"
    value="${pair#*:}"
    if [ ${#value} -eq 32 ]; then
        pass "$name generated (32 chars)"
    else
        fail "$name should be a 32 char generated value, got ${#value} chars"
    fi
done

echo
echo "=== 2. an upgrade preserves every chart-managed secret ==="
helm upgrade "$RELEASE" "$CHART_DIR" "${HELM_ARGS[@]}" >/dev/null
assert_eq "oneuptime-secret unchanged" "$ONEUPTIME_SECRET_0" "$(secret_value "$CHART_SECRET" 'oneuptime-secret')"
assert_eq "encryption-secret unchanged" "$ENCRYPTION_SECRET_0" "$(secret_value "$CHART_SECRET" 'encryption-secret')"
assert_eq "register-probe-key unchanged" "$REGISTER_PROBE_KEY_0" "$(secret_value "$CHART_SECRET" 'register-probe-key')"
assert_eq "probe-one unchanged" "$PROBE_KEY_0" "$(secret_value "$CHART_SECRET" 'probe-one')"
assert_eq "runner-key unchanged" "$RUNNER_KEY_0" "$(secret_value "$CHART_SECRET" 'runner-key')"
assert_eq "redis-password unchanged" "$REDIS_0" "$(secret_value "${RELEASE}-redis" 'redis-password')"
assert_eq "postgres-password unchanged" "$POSTGRES_0" "$(secret_value "${RELEASE}-postgresql" 'postgres-password')"
assert_eq "clickhouse admin-password unchanged" "$CLICKHOUSE_0" "$(secret_value "${RELEASE}-clickhouse" 'admin-password')"

echo
echo "=== 3. values YAML would mangle survive the recovery path ==="
# Every one of these breaks or silently changes when a recovered value is
# emitted into stringData unquoted.
HOSTILE_ONEUPTIME='abc # not-a-comment'
HOSTILE_ENCRYPTION='*alias-looking'
HOSTILE_REGISTER='key: value'
HOSTILE_PROBE='  padded  '
HOSTILE_RUNNER='true'
HOSTILE_REDIS='0123456789'
patch_secret_value() {
    # patch_secret_value <secret> <key> <raw value>
    local encoded
    encoded=$(printf '%s' "$3" | base64 | tr -d '\n')
    kubectl -n "$NAMESPACE" patch secret "$1" --type=json \
        -p "[{\"op\":\"replace\",\"path\":\"/data/$2\",\"value\":\"$encoded\"}]" >/dev/null
}
patch_secret_value "$CHART_SECRET" 'oneuptime-secret' "$HOSTILE_ONEUPTIME"
patch_secret_value "$CHART_SECRET" 'encryption-secret' "$HOSTILE_ENCRYPTION"
patch_secret_value "$CHART_SECRET" 'register-probe-key' "$HOSTILE_REGISTER"
patch_secret_value "$CHART_SECRET" 'probe-one' "$HOSTILE_PROBE"
patch_secret_value "$CHART_SECRET" 'runner-key' "$HOSTILE_RUNNER"
patch_secret_value "${RELEASE}-redis" 'redis-password' "$HOSTILE_REDIS"

if helm upgrade "$RELEASE" "$CHART_DIR" "${HELM_ARGS[@]}" >/dev/null 2>/tmp/hostile-upgrade.log; then
    pass "upgrade renders with YAML-hostile stored values"
else
    fail "upgrade failed on YAML-hostile stored values"
    cat /tmp/hostile-upgrade.log
fi
assert_eq "'$HOSTILE_ONEUPTIME' round-trips" "$HOSTILE_ONEUPTIME" "$(secret_value "$CHART_SECRET" 'oneuptime-secret')"
assert_eq "'$HOSTILE_ENCRYPTION' round-trips" "$HOSTILE_ENCRYPTION" "$(secret_value "$CHART_SECRET" 'encryption-secret')"
assert_eq "'$HOSTILE_REGISTER' round-trips" "$HOSTILE_REGISTER" "$(secret_value "$CHART_SECRET" 'register-probe-key')"
assert_eq "'$HOSTILE_PROBE' round-trips" "$HOSTILE_PROBE" "$(secret_value "$CHART_SECRET" 'probe-one')"
assert_eq "'$HOSTILE_RUNNER' round-trips" "$HOSTILE_RUNNER" "$(secret_value "$CHART_SECRET" 'runner-key')"
assert_eq "'$HOSTILE_REDIS' round-trips" "$HOSTILE_REDIS" "$(secret_value "${RELEASE}-redis" 'redis-password')"

# Put the generated values back so the rest of the script reads normally.
patch_secret_value "$CHART_SECRET" 'oneuptime-secret' "$ONEUPTIME_SECRET_0"
patch_secret_value "$CHART_SECRET" 'encryption-secret' "$ENCRYPTION_SECRET_0"
patch_secret_value "$CHART_SECRET" 'register-probe-key' "$REGISTER_PROBE_KEY_0"
patch_secret_value "$CHART_SECRET" 'probe-one' "$PROBE_KEY_0"
patch_secret_value "$CHART_SECRET" 'runner-key' "$RUNNER_KEY_0"
patch_secret_value "${RELEASE}-redis" 'redis-password' "$REDIS_0"

echo
echo "=== 4. externalSecrets: the chart stops managing those keys (issue 3121) ==="
helm upgrade "$RELEASE" "$CHART_DIR" "${HELM_ARGS[@]}" "${EXTERNAL_ARGS[@]}" >/dev/null
MANIFEST=$(helm get manifest "$RELEASE" -n "$NAMESPACE")
CHART_SECRET_MANIFEST=$(echo "$MANIFEST" | extract_chart_secret)
assert_absent "release manifest has no oneuptime-secret" "$CHART_SECRET_MANIFEST" "oneuptime-secret:"
assert_absent "release manifest has no encryption-secret" "$CHART_SECRET_MANIFEST" "encryption-secret:"
assert_absent "release manifest has no register-probe-key" "$CHART_SECRET_MANIFEST" "register-probe-key:"
assert_present "release manifest still has probe-one" "$CHART_SECRET_MANIFEST" "probe-one:"
assert_present "release manifest still has runner-key" "$CHART_SECRET_MANIFEST" "runner-key:"

# Rendering the same release twice must produce an identical Secret: that is the
# churn the issue reported.
render_chart_secret() {
    helm upgrade "$RELEASE" "$CHART_DIR" "${HELM_ARGS[@]}" "${EXTERNAL_ARGS[@]}" --dry-run 2>/dev/null |
        extract_chart_secret |
        grep -E 'oneuptime-secret:|encryption-secret:|register-probe-key:' || true
}
assert_eq "repeated renders emit no externally served key" "" "$(render_chart_secret)$(render_chart_secret)"

# The pods have to be reading them from the user's Secret instead.
APP_ENV=$(kubectl -n "$NAMESPACE" get deploy "${RELEASE}-app" -o json |
    tr -d ' \n' | tr '}' '\n')
assert_present "app ONEUPTIME_SECRET points at the external secret" "$APP_ENV" '"key":"one-uptime-secret","name":"one-uptime"'
assert_present "app ENCRYPTION_SECRET points at the external secret" "$APP_ENV" '"key":"encryption-secret","name":"one-uptime"'
assert_present "app REGISTER_PROBE_KEY points at the external secret" "$APP_ENV" '"key":"register-probe-key","name":"one-uptime"'
PROBE_ENV=$(kubectl -n "$NAMESPACE" get deploy "${RELEASE}-probe-one" -o json | tr -d ' \n' | tr '}' '\n')
assert_present "probe PROBE_KEY still points at the chart secret" "$PROBE_ENV" "\"key\":\"probe-one\",\"name\":\"${CHART_SECRET}\""

# The chart still owns probe/runner keys, so they must not have been rotated.
assert_eq "probe-one preserved while externalSecrets is on" "$PROBE_KEY_0" "$(secret_value "$CHART_SECRET" 'probe-one')"
assert_eq "runner-key preserved while externalSecrets is on" "$RUNNER_KEY_0" "$(secret_value "$CHART_SECRET" 'runner-key')"

echo
echo "=== 5. switching back to chart-managed secrets rotates nothing ==="
helm upgrade "$RELEASE" "$CHART_DIR" "${HELM_ARGS[@]}" >/dev/null
assert_eq "oneuptime-secret recovered" "$ONEUPTIME_SECRET_0" "$(secret_value "$CHART_SECRET" 'oneuptime-secret')"
assert_eq "encryption-secret recovered" "$ENCRYPTION_SECRET_0" "$(secret_value "$CHART_SECRET" 'encryption-secret')"
assert_eq "register-probe-key recovered" "$REGISTER_PROBE_KEY_0" "$(secret_value "$CHART_SECRET" 'register-probe-key')"
APP_ENV=$(kubectl -n "$NAMESPACE" get deploy "${RELEASE}-app" -o json | tr -d ' \n' | tr '}' '\n')
assert_present "app ONEUPTIME_SECRET points back at the chart secret" "$APP_ENV" "\"key\":\"oneuptime-secret\",\"name\":\"${CHART_SECRET}\""

echo
echo "=== 6. a fresh install with externalSecrets never generates the keys ==="
helm uninstall "$RELEASE" -n "$NAMESPACE" >/dev/null 2>&1 || true
kubectl -n "$NAMESPACE" delete secret "$CHART_SECRET" "${RELEASE}-redis" "${RELEASE}-postgresql" "${RELEASE}-clickhouse" >/dev/null 2>&1 || true
helm install "$RELEASE" "$CHART_DIR" "${HELM_ARGS[@]}" "${EXTERNAL_ARGS[@]}" >/dev/null
KEYS=$(secret_keys "$CHART_SECRET")
assert_absent "install does not create oneuptime-secret" "$KEYS" "oneuptime-secret"
assert_absent "install does not create encryption-secret" "$KEYS" "encryption-secret"
assert_absent "install does not create register-probe-key" "$KEYS" "register-probe-key"
assert_present "install still creates probe-one" "$KEYS" "probe-one"
assert_present "install still creates runner-key" "$KEYS" "runner-key"

harness_report
