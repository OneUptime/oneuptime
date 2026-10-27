#!/usr/bin/env bash
#
# Cluster-free check of the air-gapped install the website describes
# (oneuptime.com/enterprise/air-gapped, packages/Home/Utils/AirGapped.ts).
#
# The page tells a customer whose network never reaches the internet to set
# the values in ../air-gapped-values.yaml, and says what that does: every
# image comes from their own registry, every pod gets the pull secret, the
# update check is off, no probe is given a public nameserver, and probes and
# webhooks may reach private addresses (on such a network every address a
# monitor checks or a webhook posts to is one). This suite renders the chart
# with that file and holds the chart to each of those - for every workload
# the chart's own templates render, so a workload added later with an image
# the values do not move, or without the pull secret, fails here before it
# fails on an air-gapped cluster.
#
# It first renders the chart without the file, to show that each check would
# fail on a stock install: the images come from Docker Hub, the update check
# is on, the probes list public nameservers and refuse private addresses, and
# webhooks to a private address are refused. A check that cannot fail is no
# check.
#
# Everything here is `helm template`: no cluster, no images, no API server.

# shellcheck source=../lib/harness.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/harness.sh"

harness_install_helm

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

AIR_GAPPED_VALUES="${TESTS_DIR}/air-gapped-values.yaml"
REGISTRY="registry.example.com"
PULL_SECRET="internal-registry"

render() {
    # render <output-file> [extra helm template arguments...]
    local out="$1"
    shift
    if ! helm template oneuptime "$HELM_CHART_DIR" "$@" >"$out" 2>"${out}.err"; then
        fail "helm template failed for $(basename "$out")"
        sed 's/^/        /' "${out}.err"
        harness_report
        exit 1
    fi
}

# Splits a rendered manifest into one file per pod-bearing object under
# <dir>, named "<kind>@<metadata.name>": the chart's own Deployments,
# StatefulSets, Jobs, CronJobs, DaemonSets and Pods (the `helm test` hook is
# a bare Pod). Subchart output is left out: helm stamps every document with a
# "# Source:" line, and only "oneuptime/templates/..." is this chart's own.
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
                    kind == "Job" || kind == "CronJob" || kind == "DaemonSet" || kind == "Pod")) {
                gsub(/["\047]/, "", name)
                print doc > (dir "/" kind "@" name)
                close(dir "/" kind "@" name)
            }
            doc = ""
        }
    ' "$1"
}

# Every image a rendered document runs, one per line, unquoted.
images_of() {
    # images_of <file>
    awk '
        /^[[:space:]]*(-[[:space:]]+)?image:[[:space:]]/ {
            sub(/^[[:space:]]*(-[[:space:]]+)?image:[[:space:]]*/, "")
            gsub(/["\047]/, "")
            print
        }
    ' "$1"
}

# The nameservers a rendered pod spec lists under dnsConfig, one per line.
nameservers_of() {
    # nameservers_of <file>
    awk '
        /^[[:space:]]*nameservers:[[:space:]]*\[\][[:space:]]*$/ { next }
        /^[[:space:]]*nameservers:[[:space:]]*$/ { inblock = 1; indent = match($0, /[^ ]/); next }
        inblock && /^[[:space:]]*-[[:space:]]/ { sub(/^[[:space:]]*-[[:space:]]*/, ""); gsub(/["\047]/, ""); print; next }
        inblock && /^[[:space:]]*[a-zA-Z]/ { if (match($0, /[^ ]/) <= indent) { inblock = 0 } }
    ' "$1"
}

# The value the first env entry named <name> carries in a rendered document.
env_value_of() {
    # env_value_of <file> <name>
    awk -v want="$2" '
        found && /^[[:space:]]*value:[[:space:]]/ {
            sub(/^[[:space:]]*value:[[:space:]]*/, ""); gsub(/["\047]/, ""); print; exit
        }
        /^[[:space:]]*-[[:space:]]+name:[[:space:]]/ {
            line = $0
            sub(/^[[:space:]]*-[[:space:]]+name:[[:space:]]*/, "", line)
            gsub(/["\047]/, "", line)
            found = (line == want)
        }
    ' "$1"
}

# ---------------------------------------------------------------------------
# 1. A stock install, for contrast: what the air-gapped values have to change.
# ---------------------------------------------------------------------------
render "${WORK_DIR}/stock.yaml"
split_workloads "${WORK_DIR}/stock.yaml" "${WORK_DIR}/stock.d"

stock_images="$(cat "${WORK_DIR}"/stock.d/* | images_of /dev/stdin | sort -u)"
assert_present "a stock install pulls OneUptime's images from Docker Hub" "$stock_images" "docker.io/oneuptime/app:"
stock_outside="$(grep -v "^${REGISTRY}/" <<<"$stock_images" | sed '/^$/d' | wc -l | tr -d ' ')"
if [ "$stock_outside" -gt 0 ]; then
    pass "a stock install pulls ${stock_outside} images from outside ${REGISTRY}"
else
    fail "a stock install already pulls every image from ${REGISTRY} -- the image check below proves nothing"
fi

stock_probe="$(find "${WORK_DIR}/stock.d" -name 'Deployment@*probe*' | head -n 1)"
if [ -n "$stock_probe" ]; then
    assert_present "a stock probe lists a public fallback nameserver" "$(nameservers_of "$stock_probe")" "8.8.8.8"
    assert_eq "a stock probe refuses private addresses" "false" \
        "$(env_value_of "$stock_probe" PROBE_ALLOW_PRIVATE_NETWORK_MONITORS)"
else
    fail "a stock install rendered no probe Deployment"
fi

assert_eq "a stock install leaves the update check on" "false" \
    "$(env_value_of "${WORK_DIR}/stock.d/Deployment@oneuptime-app" DISABLE_UPDATE_CHECK)"
assert_eq "a stock install leaves the daily check-in on" "false" \
    "$(env_value_of "${WORK_DIR}/stock.d/Deployment@oneuptime-app" DISABLE_INSTANCE_CHECK_IN)"
assert_eq "a stock install refuses webhooks to private addresses" "false" \
    "$(env_value_of "${WORK_DIR}/stock.d/Deployment@oneuptime-app" ALLOW_PRIVATE_NETWORK_WEBHOOKS)"

# ---------------------------------------------------------------------------
# 2. The air-gapped install, workload by workload.
# ---------------------------------------------------------------------------
render "${WORK_DIR}/air-gapped.yaml" -f "$AIR_GAPPED_VALUES"
split_workloads "${WORK_DIR}/air-gapped.yaml" "${WORK_DIR}/air-gapped.d"

count="$(find "${WORK_DIR}/air-gapped.d" -type f | wc -l | tr -d ' ')"
if [ "$count" -gt 0 ]; then
    pass "rendered ${count} of the chart's own workloads to check"
else
    fail "rendered no workloads -- the values file or the splitter is wrong"
    harness_report
    exit 1
fi

# The workloads a stock install runs must all be here: the values move
# images, they never switch a workload off.
missing_workloads=""
for file in "${WORK_DIR}"/stock.d/*; do
    [ -f "${WORK_DIR}/air-gapped.d/$(basename "$file")" ] || missing_workloads="${missing_workloads} $(basename "$file")"
done
assert_eq "the air-gapped values run every workload a stock install runs" "" "$missing_workloads"

outside=""
no_image=""
no_secret=""
probes=0
public_dns=""
private_refused=""
for file in "${WORK_DIR}"/air-gapped.d/*; do
    name="$(basename "$file")"
    images="$(images_of "$file")"

    if [ -z "$images" ]; then
        no_image="${no_image} ${name}"
    fi

    while read -r image; do
        [ -z "$image" ] && continue
        case "$image" in
            "${REGISTRY}/"*) ;;
            *) outside="${outside} ${name}=${image}" ;;
        esac
    done <<<"$images"

    if ! grep -A1 -E '^[[:space:]]*imagePullSecrets:' "$file" | grep -qE "name:[[:space:]]*${PULL_SECRET}[[:space:]]*$"; then
        no_secret="${no_secret} ${name}"
    fi

    case "$name" in
        Deployment@*probe*)
            probes=$((probes + 1))
            servers="$(nameservers_of "$file" | tr '\n' ',')"
            [ -n "$servers" ] && public_dns="${public_dns} ${name}=${servers}"
            allowed="$(env_value_of "$file" PROBE_ALLOW_PRIVATE_NETWORK_MONITORS)"
            [ "$allowed" = "true" ] || private_refused="${private_refused} ${name}=${allowed:-unset}"
            ;;
    esac
done

assert_eq "every workload names the images it runs" "" "$no_image"
assert_eq "every image of every workload comes from ${REGISTRY}" "" "$outside"
assert_eq "every workload gets the ${PULL_SECRET} pull secret" "" "$no_secret"

if [ "$probes" -gt 0 ]; then
    pass "checked the DNS of ${probes} probe Deployment(s)"
else
    fail "the air-gapped render has no probe Deployment to check"
fi
assert_eq "no probe is given a nameserver of its own (the cluster's DNS alone)" "" "$public_dns"
assert_eq "every probe may check private addresses" "" "$private_refused"

# Nothing else in the render names a public resolver either.
assert_absent "nothing in the air-gapped render names 8.8.8.8" "$(cat "${WORK_DIR}/air-gapped.yaml")" "8.8.8.8"
assert_absent "nothing in the air-gapped render names 1.1.1.1" "$(cat "${WORK_DIR}/air-gapped.yaml")" "1.1.1.1"

# The worker job that would ask GitHub for the latest release is told not to.
assert_eq "the app is told the update check is off" "true" \
    "$(env_value_of "${WORK_DIR}/air-gapped.d/Deployment@oneuptime-app" DISABLE_UPDATE_CHECK)"

# And the one that would check in with oneuptime.com.
assert_eq "the app is told the daily check-in is off" "true" \
    "$(env_value_of "${WORK_DIR}/air-gapped.d/Deployment@oneuptime-app" DISABLE_INSTANCE_CHECK_IN)"

# Workflows, project webhooks and on-call user webhooks may post to the
# customer's own tools, which all sit on private addresses.
assert_eq "the app lets webhooks reach private addresses" "true" \
    "$(env_value_of "${WORK_DIR}/air-gapped.d/Deployment@oneuptime-app" ALLOW_PRIVATE_NETWORK_WEBHOOKS)"

# ---------------------------------------------------------------------------
# 3. Every pod the chart can run takes the pull secret, whatever is switched
#    on and in both database layouts: a private registry that asks for
#    credentials serves all of them. The operators themselves (CloudNativePG,
#    Altinity, KEDA) are subcharts with values of their own, so only what this
#    chart's templates write is checked - including the PostgreSQL cluster and
#    the ClickHouse installation those operators run.
# ---------------------------------------------------------------------------
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

# The chart's own documents of one kind ("*" for every kind), concatenated.
documents_of_kind() {
    # documents_of_kind <manifest> <kind>
    awk -v want="$2" '
        /^---[[:space:]]*$/ { flush(); next }
        { doc = doc $0 "\n" }
        END { flush() }
        function flush(   own, kind, n, i, lines, line) {
            if (doc == "") { return }
            own = 0; kind = ""
            n = split(doc, lines, "\n")
            for (i = 1; i <= n; i++) {
                line = lines[i]
                if (line ~ /^# Source: oneuptime\/templates\//) { own = 1 }
                else if (kind == "" && line ~ /^kind:[[:space:]]/) {
                    sub(/^kind:[[:space:]]*/, "", line); kind = line
                }
            }
            if (own && (want == "*" || kind == want)) { printf "%s", doc }
            doc = ""
        }
    ' "$1"
}

check_pull_secrets() {
    # check_pull_secrets <label> <split-dir>
    local label="$1" dir="$2" file missing="" seen=0
    for file in "${dir}"/*; do
        seen=$((seen + 1))
        if ! grep -A1 -E '^[[:space:]]*imagePullSecrets:' "$file" | grep -qE "name:[[:space:]]*${PULL_SECRET}[[:space:]]*$"; then
            missing="${missing} $(basename "$file")"
        fi
    done
    assert_eq "[${label}] every one of the chart's ${seen} workloads gets the pull secret" "" "$missing"
}

render "${WORK_DIR}/all-standalone.yaml" -f "${WORK_DIR}/all-on.yaml" -f "$AIR_GAPPED_VALUES"
split_workloads "${WORK_DIR}/all-standalone.yaml" "${WORK_DIR}/all-standalone.d"
check_pull_secrets "everything on, standalone databases" "${WORK_DIR}/all-standalone.d"

render "${WORK_DIR}/all-operators.yaml" -f "${WORK_DIR}/all-on.yaml" -f "${WORK_DIR}/operators.yaml" -f "$AIR_GAPPED_VALUES"
split_workloads "${WORK_DIR}/all-operators.yaml" "${WORK_DIR}/all-operators.d"
check_pull_secrets "everything on, database operators" "${WORK_DIR}/all-operators.d"

cnpg_cluster="$(documents_of_kind "${WORK_DIR}/all-operators.yaml" Cluster)"
if [ -n "$cnpg_cluster" ]; then
    assert_present "the CloudNativePG cluster gets the pull secret" \
        "$(grep -A1 -E '^[[:space:]]*imagePullSecrets:' <<<"$cnpg_cluster")" "name: ${PULL_SECRET}"
else
    fail "the operator layout rendered no CloudNativePG Cluster"
fi

altinity_chi="$(documents_of_kind "${WORK_DIR}/all-operators.yaml" ClickHouseInstallation)"
if [ -n "$altinity_chi" ]; then
    assert_present "the ClickHouse installation's pods get the pull secret" \
        "$(grep -A1 -E '^[[:space:]]*imagePullSecrets:' <<<"$altinity_chi")" "name: ${PULL_SECRET}"
else
    fail "the operator layout rendered no ClickHouseInstallation"
fi

# ---------------------------------------------------------------------------
# 4. Without imagePullSecrets nothing is written: no empty key in any pod,
#    so an install that never set it upgrades with no change.
# ---------------------------------------------------------------------------
render "${WORK_DIR}/all-plain.yaml" -f "${WORK_DIR}/all-on.yaml"
render "${WORK_DIR}/all-plain-operators.yaml" -f "${WORK_DIR}/all-on.yaml" -f "${WORK_DIR}/operators.yaml"
assert_absent "with no imagePullSecrets set, the chart writes none (stock install)" \
    "$(documents_of_kind "${WORK_DIR}/stock.yaml" "*")" "imagePullSecrets"
assert_absent "with no imagePullSecrets set, the chart writes none (everything on, standalone databases)" \
    "$(documents_of_kind "${WORK_DIR}/all-plain.yaml" "*")" "imagePullSecrets"
assert_absent "with no imagePullSecrets set, the chart writes none (everything on, database operators)" \
    "$(documents_of_kind "${WORK_DIR}/all-plain-operators.yaml" "*")" "imagePullSecrets"

harness_report
