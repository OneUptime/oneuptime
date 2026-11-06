#!/usr/bin/env bash
#
# Cluster-free check of IronBank/values.yaml, the values that run OneUptime from
# Iron Bank (IronBank/README.md). It renders the chart with that file and holds
# every workload the chart's own templates render to it: each image comes from
# Registry1's ironbank/ project, under the name the file gives it, each pod gets
# the pull secret, and each datastore runs as the user its image was built for,
# which owns its volume. So a workload added later with an image the values do
# not move, or without the pull secret, fails here before it fails on a customer's
# cluster.
#
# It first renders the chart without the file, to show that each check would
# fail on a stock install. A check that cannot fail is no check.
#
# Everything here is `helm template`: no cluster, no images, no API server.
# Whether the images actually run the way the chart runs them takes a cluster
# and a Registry1 account: that is suites/iron-bank-install.sh.

# shellcheck source=../lib/harness.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/harness.sh"

harness_install_helm

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

IRON_BANK_VALUES="$(cd "${TESTS_DIR}/../.." && pwd)/IronBank/values.yaml"
REGISTRY="registry1.dso.mil/ironbank/"
PULL_SECRET="registry1"
TEST_HOOK="Pod@oneuptime-test"

# The value of a key in the values file's image.overrides.
override() {
    # override <key>
    awk -v key="$1" '$1 == key ":" { print $2; exit }' "$IRON_BANK_VALUES"
}

# The value of a pod-spec field in a rendered workload, first occurrence.
field_of() {
    # field_of <file> <field>
    awk -v want="$2:" '$1 == want { print $2; exit }' "$1"
}

# ---------------------------------------------------------------------------
# 1. A stock install, for contrast: what the values have to change.
# ---------------------------------------------------------------------------
render "${WORK_DIR}/stock.yaml"
split_workloads "${WORK_DIR}/stock.yaml" "${WORK_DIR}/stock.d"

stock_images="$(cat "${WORK_DIR}"/stock.d/* | images_of /dev/stdin | sort -u)"
stock_outside="$(grep -v "^${REGISTRY}" <<<"$stock_images" | sed '/^$/d' | wc -l | tr -d ' ')"
if [ "$stock_outside" -gt 0 ]; then
    pass "a stock install pulls ${stock_outside} images from outside ${REGISTRY}"
else
    fail "a stock install already pulls every image from ${REGISTRY} -- the image check below proves nothing"
fi
assert_present "a stock install renders the helm test pod" "$(ls "${WORK_DIR}/stock.d")" "$TEST_HOOK"
assert_eq "a stock install runs PostgreSQL as its image's default user" "" \
    "$(field_of "${WORK_DIR}/stock.d/StatefulSet@oneuptime-postgresql" runAsUser)"
assert_eq "a stock install says the App is the Community Edition" "false" \
    "$(env_value_of "${WORK_DIR}/stock.d/Deployment@oneuptime-app" IS_ENTERPRISE_EDITION)"

# ---------------------------------------------------------------------------
# 2. With the values, workload by workload.
# ---------------------------------------------------------------------------
render "${WORK_DIR}/iron-bank.yaml" -f "$IRON_BANK_VALUES"
split_workloads "${WORK_DIR}/iron-bank.yaml" "${WORK_DIR}/iron-bank.d"

count="$(find "${WORK_DIR}/iron-bank.d" -type f | wc -l | tr -d ' ')"
if [ "$count" -gt 0 ]; then
    pass "rendered ${count} of the chart's own workloads to check"
else
    fail "rendered no workloads -- the values file or the splitter is wrong"
    harness_report
    exit 1
fi

# The values move images and turn off only the helm test pod, whose image is not
# on Iron Bank.
missing_workloads=""
for file in "${WORK_DIR}"/stock.d/*; do
    name="$(basename "$file")"
    [ "$name" = "$TEST_HOOK" ] && continue
    [ -f "${WORK_DIR}/iron-bank.d/${name}" ] || missing_workloads="${missing_workloads} ${name}"
done
assert_eq "the values run every workload a stock install runs, but the helm test pod" "" "$missing_workloads"
assert_absent "the values leave out the helm test pod" "$(ls "${WORK_DIR}/iron-bank.d")" "$TEST_HOOK"

outside=""
no_image=""
no_secret=""
for file in "${WORK_DIR}"/iron-bank.d/*; do
    name="$(basename "$file")"
    images="$(images_of "$file")"
    [ -z "$images" ] && no_image="${no_image} ${name}"
    while read -r image; do
        [ -z "$image" ] && continue
        case "$image" in
        "${REGISTRY}"*) ;;
        *) outside="${outside} ${name}=${image}" ;;
        esac
    done <<<"$images"
    grep -q "^[[:space:]]*- name: ${PULL_SECRET}\$" "$file" || no_secret="${no_secret} ${name}"
done
assert_eq "every workload names an image" "" "$no_image"
assert_eq "every image comes from ${REGISTRY}" "" "$outside"
assert_eq "every pod gets the ${PULL_SECRET} pull secret" "" "$no_secret"

# Each component runs the image the file names for it. nginx is the ingress:
# the release's image is oneuptime/nginx, and Iron Bank's is oneuptime/ingress.
check_image() {
    # check_image <workload file name> <key in image.overrides>
    local file="${WORK_DIR}/iron-bank.d/$1" want
    want="$(override "$2")"
    if [ -z "$want" ]; then
        fail "the values name no image for $2"
    elif [ ! -f "$file" ]; then
        fail "the values render no $1"
    else
        assert_present "$1 runs $want" "$(images_of "$file")" "$want"
    fi
}
check_image "Deployment@oneuptime-app" app
check_image "Job@oneuptime-migrate-1" app
check_image "Deployment@oneuptime-nginx" nginx
check_image "Deployment@oneuptime-probe-one" probe
check_image "Deployment@oneuptime-global-runner" runner
check_image "StatefulSet@oneuptime-postgresql" postgres
check_image "StatefulSet@oneuptime-clickhouse-shard0" clickhouse
check_image "StatefulSet@oneuptime-valkey" valkey
assert_present "the ingress is Iron Bank's ingress project" "$(override nginx)" "${REGISTRY}oneuptime/ingress:"

assert_eq "the chart says the App is the Enterprise Edition its image is" "true" \
    "$(env_value_of "${WORK_DIR}/iron-bank.d/Deployment@oneuptime-app" IS_ENTERPRISE_EDITION)"

# ---------------------------------------------------------------------------
# 3. Each datastore runs as the user its Iron Bank image was built for
#    (USER in the image's Dockerfile on Repo1), which owns its volume.
# ---------------------------------------------------------------------------
check_user() {
    # check_user <workload file name> <uid>
    local file="${WORK_DIR}/iron-bank.d/$1"
    assert_eq "$1 runs as user $2" "$2" "$(field_of "$file" runAsUser)"
    assert_eq "$1 gives that user its volume" "$2" "$(field_of "$file" fsGroup)"
    assert_eq "$1 does not walk its whole volume on each restart" "OnRootMismatch" "$(field_of "$file" fsGroupChangePolicy)"
}
check_user "StatefulSet@oneuptime-postgresql" 1001
check_user "StatefulSet@oneuptime-clickhouse-shard0" 998
check_user "StatefulSet@oneuptime-valkey" 1001

# ---------------------------------------------------------------------------
# 4. What the chart leaves off by default, turned on: the cleanup CronJobs.
# ---------------------------------------------------------------------------
render "${WORK_DIR}/cleanup.yaml" -f "$IRON_BANK_VALUES" --set cronJobs.cleanup.enabled=true
split_workloads "${WORK_DIR}/cleanup.yaml" "${WORK_DIR}/cleanup.d"
check_cronjob() {
    # check_cronjob <CronJob name>
    local file="${WORK_DIR}/cleanup.d/CronJob@$1"
    if [ -f "$file" ]; then
        assert_present "the $1 CronJob runs Iron Bank's kubectl" "$(images_of "$file")" "$(override kubectl)"
    else
        fail "the $1 CronJob was not rendered"
    fi
}
check_cronjob cleanup-crashloopbackoff-pods
check_cronjob cleanup-completed-pods

harness_report
