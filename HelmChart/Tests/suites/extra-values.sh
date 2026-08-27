#!/usr/bin/env bash
#
# Cluster-free coverage for extraEnv / extraVolumes / extraVolumeMounts -- the
# escape hatch that lets an operator hand every OneUptime workload an internal
# CA bundle (or anything else the chart cannot enumerate) without forking it.
# https://github.com/OneUptime/oneuptime/issues/3423
#
# The helm-unittest suites already assert the wiring template by template. This
# suite exists for the thing they structurally cannot check: that no workload
# was MISSED. helm-unittest asserts only on the templates a test names, so a
# service added later -- or an existing one whose include is dropped in a
# refactor -- fails nothing there. Here the whole chart is rendered with every
# workload switched on, and every Deployment/StatefulSet/Job/CronJob/DaemonSet
# that comes out of the chart's OWN templates has to either carry the extras or
# be named in SKIP_WORKLOADS below with a reason. A new workload is in neither
# list, so it fails until someone decides which it is.
#
# It renders twice, because which workloads exist depends on the database
# backend: the standalone StatefulSets and the operator-managed pair (CNPG +
# Altinity, which is what brings the ClickHouse Keeper into the render).
#
# Everything here is `helm template`: no cluster, no images, no API server.

# shellcheck source=../lib/harness.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/harness.sh"

harness_install_helm

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# Workloads that deliberately do NOT take the extras, matched on metadata.name.
#
#   the standalone database StatefulSets -- postgresql, redis, clickhouse and
#   the ClickHouse Keeper are servers, not clients: NODE_EXTRA_CA_CERTS means
#   nothing to them, and their TLS and tuning surfaces are already first-class
#   values. They also have operator-managed twins (CloudNativePG, Altinity)
#   whose pods are shaped by a CR rather than by these templates, so an extraEnv
#   here would reach only whichever half of an install happened to be
#   standalone -- a knob that works half the time is worse than no knob.
#
#   the cleanup CronJobs run bitnami/kubectl against the in-cluster API server,
#   which is trusted through the ServiceAccount CA the kubelet projects. There
#   is no external endpoint for an operator's CA to apply to.
SKIP_WORKLOADS=(
    oneuptime-postgresql
    oneuptime-redis
    oneuptime-clickhouse-shard0
    oneuptime-clickhouse-keeper
    cleanup-crashloopbackoff-pods
    cleanup-completed-pods
)

# Every workload the chart runs, switched on at once.
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

# The operator-managed database backend, which renders a different set of
# workloads (no standalone Postgres/ClickHouse StatefulSet; a Keeper instead).
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

cat >"${WORK_DIR}/extras.yaml" <<'YAML'
extraEnv:
  - name: NODE_EXTRA_CA_CERTS
    value: /etc/ssl/internal/ca.crt
extraVolumes:
  - name: internal-ca
    configMap:
      name: internal-ca-bundle
extraVolumeMounts:
  - name: internal-ca
    mountPath: /etc/ssl/internal
    readOnly: true
YAML

render() {
    # render <output-file> [extra -f arguments...]
    local out="$1"
    shift
    if ! helm template oneuptime "$HELM_CHART_DIR" -f "${WORK_DIR}/all-on.yaml" "$@" >"$out" 2>"${out}.err"; then
        fail "helm template failed for $(basename "$out")"
        sed 's/^/        /' "${out}.err"
        harness_report
        exit 1
    fi
}

# Splits a rendered manifest into one file per workload under <dir>, named
# "<kind>@<metadata.name>". Subchart output is dropped: helm stamps every
# document with a "# Source:" line, and only "oneuptime/templates/..." is this
# chart's own -- cloudnative-pg and the Altinity operator ship their own values
# for this and are not ours to wire.
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
                # metadata.name is the first two-space-indented "name:";
                # containers, ports and volumes all sit deeper than that.
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

# The pod-level volume names in a rendered workload, one per line.
pod_volume_names() {
    # pod_volume_names <workload-file>
    awk '
        /^[[:space:]]*volumes:[[:space:]]*$/ { inblock = 1; indent = match($0, /[^ ]/); next }
        inblock && /^[[:space:]]*-[[:space:]]*name:/ { sub(/^[^:]*:[[:space:]]*/, ""); print; next }
        inblock && /^[[:space:]]*[a-zA-Z]/ { if (match($0, /[^ ]/) <= indent) { inblock = 0 } }
    ' "$1"
}

# The volume names every container mounts, deduplicated.
mounted_volume_names() {
    # mounted_volume_names <workload-file>
    awk '
        /^[[:space:]]*volumeMounts:[[:space:]]*$/ { inblock = 1; indent = match($0, /[^ ]/); next }
        inblock && /^[[:space:]]*-[[:space:]]*name:/ { sub(/^[^:]*:[[:space:]]*/, ""); print; next }
        inblock && /^[[:space:]]*[a-zA-Z]/ { if (match($0, /[^ ]/) <= indent) { inblock = 0 } }
    ' "$1" | sort -u
}

# A StatefulSet may mount a volumeClaimTemplate, which is not a pod volume.
claim_template_names() {
    # claim_template_names <workload-file>
    awk '
        /^[[:space:]]*volumeClaimTemplates:[[:space:]]*$/ { inblock = 1; next }
        inblock && /^[[:space:]]*name:/ { sub(/^[^:]*:[[:space:]]*/, ""); print }
    ' "$1" | sort -u
}

is_skipped() {
    local name="$1" skip
    for skip in "${SKIP_WORKLOADS[@]}"; do
        [ "$skip" = "$name" ] && return 0
    done
    return 1
}

# Chart-generated secrets and the optional timestamp label are random per
# render; everything else has to match byte for byte.
normalise() {
    sed -E 's/^( *[a-zA-Z-]+): "[A-Za-z0-9]{32}"$/\1: "<random>"/; s/date: "[0-9]+"/date: "<ts>"/' "$1"
}

# ---------------------------------------------------------------------------
# 1. Unset is a no-op. This is what makes the upgrade that ships this feature a
#    no-diff upgrade for every install that does not want it.
# ---------------------------------------------------------------------------
render "${WORK_DIR}/plain.yaml"
cat >"${WORK_DIR}/empty-extras.yaml" <<'YAML'
extraEnv: []
extraVolumes: []
extraVolumeMounts: []
app:
  extraEnv: []
  extraVolumes: []
  extraVolumeMounts: []
YAML
render "${WORK_DIR}/empty.yaml" -f "${WORK_DIR}/empty-extras.yaml"

if diff -q <(normalise "${WORK_DIR}/plain.yaml") <(normalise "${WORK_DIR}/empty.yaml") >/dev/null; then
    pass "empty extraEnv/extraVolumes/extraVolumeMounts render exactly as if unset"
else
    fail "declaring the extras empty changed the render"
    diff <(normalise "${WORK_DIR}/plain.yaml") <(normalise "${WORK_DIR}/empty.yaml") | head -40 | sed 's/^/        /'
fi

split_workloads "${WORK_DIR}/plain.yaml" "${WORK_DIR}/plain.d"
plain_count="$(find "${WORK_DIR}/plain.d" -type f | wc -l | tr -d ' ')"
if [ "$plain_count" -gt 0 ]; then
    pass "rendered ${plain_count} of the chart's own workloads to check"
else
    fail "rendered no workloads -- the values file or the splitter is wrong"
    harness_report
    exit 1
fi

# An empty `volumes:` key is not the same as no key, and would show up as a
# change in `helm diff` for every existing install.
stray=""
for file in "${WORK_DIR}"/plain.d/*; do
    grep -qE '^[[:space:]]*volumes:' "$file" || continue
    if [ -z "$(pod_volume_names "$file")" ]; then
        stray="${stray} $(basename "$file")"
    fi
done
assert_eq "no workload is left with a volumes: key holding nothing" "" "$stray"

# ---------------------------------------------------------------------------
# 2. One chart-wide setting reaches every workload -- in both database layouts.
# ---------------------------------------------------------------------------
check_render() {
    # check_render <label> <split-dir>
    local label="$1" dir="$2"
    local missing_env="" missing_volume="" missing_mount="" skipped_but_wired="" seen=0
    local file entry name

    for file in "${dir}"/*; do
        entry="$(basename "$file")"
        name="${entry#*@}"
        seen=$((seen + 1))

        if is_skipped "$name"; then
            if grep -qF 'NODE_EXTRA_CA_CERTS' "$file"; then
                skipped_but_wired="${skipped_but_wired} ${name}"
            fi
            continue
        fi

        grep -qF 'NODE_EXTRA_CA_CERTS' "$file" || missing_env="${missing_env} ${name}"
        grep -qF 'name: internal-ca-bundle' "$file" || missing_volume="${missing_volume} ${name}"
        grep -qF 'mountPath: /etc/ssl/internal' "$file" || missing_mount="${missing_mount} ${name}"
    done

    assert_eq "[${label}] every workload got the chart-wide extraEnv" "" "$missing_env"
    assert_eq "[${label}] every workload got the chart-wide extraVolumes" "" "$missing_volume"
    assert_eq "[${label}] every workload got the chart-wide extraVolumeMounts" "" "$missing_mount"
    # A skipped workload that starts carrying the extras means SKIP_WORKLOADS is
    # stale, and is quietly under-reporting coverage.
    assert_eq "[${label}] SKIP_WORKLOADS holds no workload that is in fact wired up" "" "$skipped_but_wired"
    echo "  (${label}: checked ${seen} workloads)"
}

# The API server rejects a pod that mounts a volume it never declares, or that
# declares two volumes under one name -- the failure mode a merging (rather than
# overriding) precedence would have introduced.
check_manifest_validity() {
    # check_manifest_validity <label> <split-dir>
    local label="$1" dir="$2"
    local bad_ref="" dup_name="" file name volumes mounts claims declared mount dups

    for file in "${dir}"/*; do
        name="$(basename "$file")"
        name="${name#*@}"

        volumes="$(pod_volume_names "$file" | sort)"
        mounts="$(mounted_volume_names "$file")"
        claims="$(claim_template_names "$file")"

        declared="$(printf '%s\n%s\n' "$volumes" "$claims" | sed '/^$/d' | sort -u)"
        while read -r mount; do
            [ -z "$mount" ] && continue
            grep -qxF -- "$mount" <<<"$declared" || bad_ref="${bad_ref} ${name}:${mount}"
        done <<<"$mounts"

        dups="$(sed '/^$/d' <<<"$volumes" | uniq -d)"
        if [ -n "$dups" ]; then
            dup_name="${dup_name} ${name}:$(tr '\n' ',' <<<"$dups")"
        fi
    done

    assert_eq "[${label}] no container mounts a volume its pod never declares" "" "$bad_ref"
    assert_eq "[${label}] no pod declares two volumes with the same name" "" "$dup_name"
}

render "${WORK_DIR}/standalone.yaml" -f "${WORK_DIR}/extras.yaml"
split_workloads "${WORK_DIR}/standalone.yaml" "${WORK_DIR}/standalone.d"
check_render "standalone db" "${WORK_DIR}/standalone.d"
check_manifest_validity "standalone db" "${WORK_DIR}/standalone.d"

render "${WORK_DIR}/operator.yaml" -f "${WORK_DIR}/operators.yaml" -f "${WORK_DIR}/extras.yaml"
split_workloads "${WORK_DIR}/operator.yaml" "${WORK_DIR}/operator.d"
check_render "operator db" "${WORK_DIR}/operator.d"
check_manifest_validity "operator db" "${WORK_DIR}/operator.d"

# An entry in SKIP_WORKLOADS that neither layout renders is dead weight, and
# hides a workload that was renamed out from under it.
gone=""
for skip in "${SKIP_WORKLOADS[@]}"; do
    if ! find "${WORK_DIR}/standalone.d" "${WORK_DIR}/operator.d" -name "*@${skip}" 2>/dev/null | grep -q .; then
        gone="${gone} ${skip}"
    fi
done
assert_eq "SKIP_WORKLOADS holds no workload the chart no longer renders" "" "$gone"

# ---------------------------------------------------------------------------
# 3. A per-service list overrides the chart-wide one rather than merging with
#    it -- across a whole render, not just the one template a unit test names.
# ---------------------------------------------------------------------------
cat >"${WORK_DIR}/override.yaml" <<'YAML'
app:
  extraEnv:
    - name: NODE_EXTRA_CA_CERTS
      value: /etc/ssl/app-only/ca.crt
  extraVolumes:
    - name: app-ca
      configMap:
        name: app-ca-bundle
  extraVolumeMounts:
    - name: app-ca
      mountPath: /etc/ssl/app-only
      readOnly: true
YAML
render "${WORK_DIR}/override-render.yaml" -f "${WORK_DIR}/extras.yaml" -f "${WORK_DIR}/override.yaml"
split_workloads "${WORK_DIR}/override-render.yaml" "${WORK_DIR}/override.d"

app_doc="${WORK_DIR}/override.d/Deployment@oneuptime-app"
if [ -f "$app_doc" ]; then
    assert_present "app took its own CA path" "$(cat "$app_doc")" "/etc/ssl/app-only/ca.crt"
    assert_absent "app did not also keep the chart-wide one" "$(cat "$app_doc")" "/etc/ssl/internal/ca.crt"
    assert_absent "app did not also keep the chart-wide volume" "$(cat "$app_doc")" "name: internal-ca-bundle"
else
    fail "app Deployment did not render"
fi

worker_doc="${WORK_DIR}/override.d/Deployment@oneuptime-worker"
if [ -f "$worker_doc" ]; then
    assert_present "worker still has the chart-wide CA path" "$(cat "$worker_doc")" "/etc/ssl/internal/ca.crt"
    assert_absent "worker did not pick up app's override" "$(cat "$worker_doc")" "/etc/ssl/app-only/ca.crt"
else
    fail "worker Deployment did not render"
fi

check_manifest_validity "per-service override" "${WORK_DIR}/override.d"

# ---------------------------------------------------------------------------
# 4. pgbouncer hashes its whole values block into a pod annotation to roll the
#    pooler when pgbouncer.ini changes. The three new keys are pod-spec inputs,
#    not ini inputs, so they are omitted from that hash -- otherwise every
#    install would have rolled its pooler on the upgrade that merely introduced
#    the keys. Setting one still rolls the pod, through the pod template itself.
# ---------------------------------------------------------------------------
PGBOUNCER_DOC="Deployment@oneuptime-pgbouncer"

pgbouncer_checksum() {
    # pgbouncer_checksum <split-dir>
    local doc="$1/${PGBOUNCER_DOC}"
    [ -f "$doc" ] || return 0
    awk '/checksum\/config:/ { print $2; exit }' "$doc"
}

cat >"${WORK_DIR}/pgb-extras.yaml" <<'YAML'
pgbouncer:
  extraEnv:
    - name: PGB_EXTRA
      value: "1"
  extraVolumes:
    - name: pgb-scratch
      emptyDir: {}
  extraVolumeMounts:
    - name: pgb-scratch
      mountPath: /scratch
YAML
render "${WORK_DIR}/pgb-extras-render.yaml" -f "${WORK_DIR}/pgb-extras.yaml"
split_workloads "${WORK_DIR}/pgb-extras-render.yaml" "${WORK_DIR}/pgb-extras.d"

cat >"${WORK_DIR}/pgb-ini.yaml" <<'YAML'
pgbouncer:
  poolMode: session
YAML
render "${WORK_DIR}/pgb-ini-render.yaml" -f "${WORK_DIR}/pgb-ini.yaml"
split_workloads "${WORK_DIR}/pgb-ini-render.yaml" "${WORK_DIR}/pgb-ini.d"

base_sum="$(pgbouncer_checksum "${WORK_DIR}/plain.d")"
extras_sum="$(pgbouncer_checksum "${WORK_DIR}/pgb-extras.d")"
ini_sum="$(pgbouncer_checksum "${WORK_DIR}/pgb-ini.d")"

if [ -z "$base_sum" ]; then
    fail "could not read pgbouncer's checksum/config -- the annotation moved or the pooler did not render"
else
    assert_eq "pgbouncer's config checksum ignores the extra* keys" "$base_sum" "$extras_sum"
    if [ "$base_sum" != "$ini_sum" ]; then
        pass "pgbouncer's config checksum still tracks a real pgbouncer.ini input"
    else
        fail "pgbouncer's config checksum no longer changes when pgbouncer.ini does (poolMode)"
    fi
fi

# The pod still rolls when the extras change -- through the pod template, which
# is what actually carries them.
if diff -q "${WORK_DIR}/plain.d/${PGBOUNCER_DOC}" "${WORK_DIR}/pgb-extras.d/${PGBOUNCER_DOC}" >/dev/null; then
    fail "setting pgbouncer's extras changed nothing in its Deployment"
else
    pass "setting pgbouncer's extras still changes its pod template (so the pods roll)"
fi

harness_report
