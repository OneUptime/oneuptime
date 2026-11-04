#!/usr/bin/env bash
#
# Installs the chart on a KinD cluster with IronBank/values.yaml, as a customer
# running OneUptime from Iron Bank would (IronBank/README.md), and checks that it
# works. Opt-in: it needs a Registry1 robot account and OneUptime's Iron Bank
# images, so it is not part of the helm-test job. The Iron Bank Preflight workflow
# builds the images and runs it (.github/workflows/iron-bank.yml):
#
#   REGISTRY1_USERNAME=... REGISTRY1_PASSWORD=... \
#     bash HelmChart/Tests/run.sh iron-bank-install
#
# suites/iron-bank.sh checks what the chart renders. This checks what only a
# cluster can tell, because Iron Bank's datastores are not the images the chart
# was written for: they run as users of their own instead of starting as root,
# their entrypoints are their own, and Iron Bank's ClickHouse is older than the
# one a stock install runs. So it asks:
#
#   - does every workload become ready, with the migrations finished, on these
#     images, pulled with the pull secret?
#   - did OneUptime's schema reach PostgreSQL and ClickHouse, and did ClickHouse
#     refuse anything OneUptime sent it as beyond its version?
#   - does the ingress serve the product, and do the cleanup CronJobs run on Iron
#     Bank's kubectl, which has no shell of its own to promise?
#   - does PostgreSQL start again on its own data?
#
# What it cannot tell: KinD's volumes are host directories every user may write,
# and Kubernetes applies no fsGroup to them, so that fsGroup gives a datastore its
# volume is checked by suites/iron-bank.sh and not here. Nor does it send
# telemetry through ClickHouse: it sees what booting and the background jobs send.

# shellcheck source=../lib/harness.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/harness.sh"

: "${REGISTRY1_USERNAME:?iron-bank-install needs REGISTRY1_USERNAME, a Registry1 robot account (IronBank/README.md)}"
: "${REGISTRY1_PASSWORD:?iron-bank-install needs REGISTRY1_PASSWORD, a Registry1 robot account (IronBank/README.md)}"

IRON_BANK_VALUES="$(cd "${TESTS_DIR}/../.." && pwd)/IronBank/values.yaml"
NAMESPACE="oneuptime-iron-bank"
RELEASE="oneuptime"
LOCAL_PORT=18080
READY_SECONDS="${READY_SECONDS:-1200}"
SCHEMA_SECONDS="${SCHEMA_SECONDS:-300}"

in_namespace() {
    kubectl --namespace "$NAMESPACE" "$@"
}

# What the cluster says, when something failed.
report() {
    if [ "$FAILURES" -gt 0 ]; then
        echo
        echo "======================= What the cluster says ======================="
        in_namespace get pods -o wide || true
        in_namespace get events --sort-by=.lastTimestamp | tail -n 60 || true
        local pod
        for pod in $(in_namespace get pods -o name 2>/dev/null || true); do
            echo
            echo "----- ${pod}"
            in_namespace describe "$pod" | sed -n '/^Containers:/,/^Volumes:/p' || true
            in_namespace logs "$pod" --all-containers --prefix --tail=80 || true
        done
    fi
    harness_report
}

harness_start_cluster
harness_namespace "$NAMESPACE"
kubectl wait --for=condition=Available --timeout=120s --namespace local-path-storage deployment/local-path-provisioner >/dev/null

in_namespace create secret docker-registry registry1 \
    --docker-server=registry1.dso.mil \
    --docker-username="$REGISTRY1_USERNAME" \
    --docker-password="$REGISTRY1_PASSWORD" >/dev/null

# OneUptime's own images reach Registry1 once Iron Bank has approved them. Until
# then the workflow builds them, under the names they will have there, and they
# are handed to the cluster here. What is not built here comes from Registry1.
while read -r image; do
    if docker image inspect "$image" >/dev/null 2>&1; then
        echo "Loading ${image} into the cluster..."
        kind load docker-image "$image" --name "$HELM_TEST_CLUSTER"
    fi
done <<<"$(grep -oE 'registry1\.dso\.mil/ironbank/oneuptime/[a-z]+:[^[:space:]]+' "$IRON_BANK_VALUES")"

# image.pullPolicy is Always by default, which would ask Registry1 for the images
# just loaded. The datastores have IfNotPresent of their own, and pull with the
# secret either way.
if helm install "$RELEASE" "$HELM_CHART_DIR" --namespace "$NAMESPACE" \
    -f "$IRON_BANK_VALUES" \
    --set host=localhost \
    --set httpProtocol=http \
    --set image.pullPolicy=IfNotPresent \
    --set cronJobs.cleanup.enabled=true; then
    pass "helm installs the chart with IronBank/values.yaml"
else
    fail "helm did not install the chart with IronBank/values.yaml"
    report
    exit 1
fi

# ---------------------------------------------------------------------------
# 1. Everything becomes ready, on one deadline: the runtime pods wait, unready,
#    for the migrations, and the migrations for the databases.
# ---------------------------------------------------------------------------
deadline=$((SECONDS + READY_SECONDS))
remaining() {
    local left=$((deadline - SECONDS))
    echo "$((left > 10 ? left : 10))s"
}

while read -r workload; do
    [ -z "$workload" ] && continue
    if in_namespace rollout status "$workload" --timeout="$(remaining)" >/dev/null; then
        pass "${workload} is ready"
    else
        fail "${workload} did not become ready"
    fi
done <<<"$(in_namespace get statefulset,deployment -o name)"

if in_namespace wait --for=condition=complete job --selector "app=${RELEASE}-migrate" --timeout="$(remaining)" >/dev/null; then
    pass "the migrations finished"
else
    fail "the migrations did not finish"
fi

in_namespace get pods -o wide

# Pods are gone once they are cleaned up, so this reads what is running now.
images="$(in_namespace get pods -o jsonpath='{range .items[*]}{range .spec.initContainers[*]}{.image}{"\n"}{end}{range .spec.containers[*]}{.image}{"\n"}{end}{end}' | sed '/^$/d' | sort -u)"
echo "$images"
assert_eq "every pod runs an image from Iron Bank" "" "$(grep -v '^registry1\.dso\.mil/ironbank/' <<<"$images" || true)"

# ---------------------------------------------------------------------------
# 2. The datastores: Iron Bank's images, as their own users, with the schema.
# ---------------------------------------------------------------------------
POSTGRES="statefulset/${RELEASE}-postgresql"
CLICKHOUSE="statefulset/${RELEASE}-clickhouse-shard0"
VALKEY="statefulset/${RELEASE}-valkey"

# The chart's pg_hba.conf trusts local connections.
psql_query() {
    in_namespace exec "$POSTGRES" -- psql -U postgres -d oneuptimedb -tAc "$1" 2>&1 || true
}

clickhouse_query() {
    # The query goes in as an argument, so the shell in the pod does not read it.
    # shellcheck disable=SC2016
    in_namespace exec "$CLICKHOUSE" -c clickhouse -- sh -c \
        'clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" --query "$1"' sh "$1" 2>&1 || true
}

assert_present "PostgreSQL is version 17" "$(psql_query 'SHOW server_version')" "17."
assert_eq "PostgreSQL runs as the user its image made" "1001" "$(in_namespace exec "$POSTGRES" -- id -u 2>&1 || true)"
assert_present "the migrations reached PostgreSQL" "$(psql_query "SELECT to_regclass('public.\"Project\"')")" "Project"

assert_present "ClickHouse is version 26.3" "$(clickhouse_query 'SELECT version()')" "26.3."
assert_eq "ClickHouse runs as the user its image made" "998" "$(in_namespace exec "$CLICKHOUSE" -c clickhouse -- id -u 2>&1 || true)"

# shellcheck disable=SC2016
assert_eq "Valkey answers, with the chart's password" "PONG" \
    "$(in_namespace exec "$VALKEY" -- sh -c 'valkey-cli -a "$VALKEY_PASSWORD" --no-auth-warning ping' 2>&1 || true)"
assert_eq "Valkey runs as the user its image made" "1001" "$(in_namespace exec "$VALKEY" -- id -u 2>&1 || true)"

# The tables a stock install's ClickHouse once refused unless a setting that 26.3
# does not know was set (MigrateMetricAggregatesToStrictSchema.ts). OneUptime
# creates its ClickHouse tables at boot, so they can land just after readiness.
aggregates=0
schema_deadline=$((SECONDS + SCHEMA_SECONDS))
while [ "$SECONDS" -lt "$schema_deadline" ]; do
    aggregates="$(clickhouse_query "SELECT count() FROM system.tables WHERE database = 'oneuptime' AND engine LIKE '%AggregatingMergeTree'")"
    if [[ "$aggregates" =~ ^[0-9]+$ ]] && [ "$aggregates" -gt 0 ]; then
        break
    fi
    sleep 10
done
if [[ "$aggregates" =~ ^[0-9]+$ ]] && [ "$aggregates" -gt 0 ]; then
    pass "ClickHouse 26.3 holds OneUptime's ${aggregates} aggregating tables"
else
    fail "ClickHouse holds none of OneUptime's aggregating tables (last answer: ${aggregates})"
fi
echo "OneUptime's ClickHouse tables, by engine:"
clickhouse_query "SELECT engine, count() FROM system.tables WHERE database = 'oneuptime' GROUP BY engine ORDER BY engine FORMAT TSV"

# Every query ClickHouse refused, for the log; those a newer server would have
# taken are what a version older than the chart's would cost.
clickhouse_query "SYSTEM FLUSH LOGS" >/dev/null
echo "Queries ClickHouse refused, by error:"
clickhouse_query "SELECT errorCodeToName(exception_code) AS error, count() AS times, substring(any(exception), 1, 300) FROM system.query_log WHERE exception_code != 0 GROUP BY error ORDER BY times DESC FORMAT TSV"
TOO_NEW="'UNKNOWN_SETTING', 'SYNTAX_ERROR', 'UNKNOWN_FUNCTION', 'UNKNOWN_AGGREGATE_FUNCTION', 'UNKNOWN_TYPE', 'UNKNOWN_ELEMENT_IN_CONFIG', 'UNKNOWN_STORAGE', 'NOT_IMPLEMENTED'"
assert_eq "ClickHouse refused nothing OneUptime sent as beyond its version" "" \
    "$(clickhouse_query "SELECT errorCodeToName(exception_code), substring(any(exception), 1, 500) FROM system.query_log WHERE errorCodeToName(exception_code) IN (${TOO_NEW}) GROUP BY exception_code FORMAT TSV")"

# ---------------------------------------------------------------------------
# 3. The product, through Iron Bank's ingress and the App behind it.
# ---------------------------------------------------------------------------
in_namespace port-forward "service/${RELEASE}-nginx" "${LOCAL_PORT}:80" >/dev/null 2>&1 &
forward=$!
page="$(curl --silent --location --max-time 30 --retry 12 --retry-delay 5 --retry-connrefused --write-out '\n%{http_code}' "http://localhost:${LOCAL_PORT}/accounts/" || true)"
kill "$forward" 2>/dev/null || true
assert_eq "the ingress answers for the sign-in page" "200" "$(tail -n 1 <<<"$page")"
assert_present "and the App serves it" "$page" "<html"

# ---------------------------------------------------------------------------
# 4. The cleanup CronJobs' command: /bin/bash, kubectl and grep, on an image whose
#    entrypoint is kubectl and whose base is a minimal one.
# ---------------------------------------------------------------------------
in_namespace create job cleanup-check --from=cronjob/cleanup-crashloopbackoff-pods >/dev/null
if in_namespace wait --for=condition=complete job/cleanup-check --timeout=300s >/dev/null; then
    pass "the cleanup CronJob's command runs on Iron Bank's kubectl"
else
    fail "the cleanup CronJob's command does not run on Iron Bank's kubectl"
fi

# ---------------------------------------------------------------------------
# 5. PostgreSQL starts again on the data it wrote. It refuses a data directory
#    whose permissions have moved, which is what a volume's owner can do to it.
# ---------------------------------------------------------------------------
in_namespace delete pod "${RELEASE}-postgresql-0" >/dev/null
if in_namespace rollout status "$POSTGRES" --timeout=300s >/dev/null; then
    pass "PostgreSQL starts again"
else
    fail "PostgreSQL did not start again"
fi
assert_present "with its data" "$(psql_query "SELECT to_regclass('public.\"Project\"')")" "Project"

report
