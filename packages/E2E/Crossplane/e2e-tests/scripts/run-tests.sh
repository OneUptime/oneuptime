#!/usr/bin/env bash
#
# End-to-end test of the Crossplane provider: the package
# Scripts/CrossplaneProvider/build-package.sh builds, installed by Crossplane in
# a kind cluster, managing a project of a running OneUptime.
#
#   ONEUPTIME_URL=http://localhost ONEUPTIME_API_KEY=<project API key> \
#     bash packages/E2E/Crossplane/e2e-tests/scripts/run-tests.sh
#
# It
#   1. creates a kind cluster and a registry the cluster pulls from, pushes the
#      package there, and installs Crossplane and the package, and has the API
#      server check every manifest of the docs' Crossplane pages against it;
#   2. gives the provider the API key through a namespace's ProviderConfig, and
#      through a ClusterProviderConfig whose Secret is JSON that names the URL;
#   3. observes statuses and a severity of the project by their IDs, and
#      creates a Label, a Team, a StatusPage, a TelemetryIngestionKey and a
#      Monitor that refers to the others by their Kubernetes names;
#   4. checks each in OneUptime through its API, then updates one, has the
#      provider undo a change made outside Kubernetes, imports a label made
#      outside, and deletes them all.
#
# Needs docker, kind, kubectl, helm, the crossplane CLI, curl and jq. See
# ../README.md for the settings.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$(dirname "${SCRIPT_DIR}")"
ROOT="$(cd "${TEST_DIR}/../../../.." && pwd)"
MANIFESTS="${TEST_DIR}/manifests"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

GROUP=crossplane.oneuptime.com
NAMESPACE=oneuptime-e2e
CLUSTER="${CROSSPLANE_E2E_CLUSTER:-oneuptime-crossplane-e2e}"
REGISTRY="${CLUSTER}-registry"
REGISTRY_IMAGE="${CROSSPLANE_E2E_REGISTRY_IMAGE:-registry:2.8.3}"
CROSSPLANE_VERSION="${CROSSPLANE_E2E_CROSSPLANE_VERSION:-2.4.3}"
KIND_NETWORK="${KIND_EXPERIMENTAL_DOCKER_NETWORK:-kind}"
# Names in OneUptime carry the run's own suffix, so a run never trips over
# what an earlier one left in the project.
RUN_ID="${CROSSPLANE_E2E_RUN_ID:-$(date +%s)}"

: "${ONEUPTIME_URL:?Set ONEUPTIME_URL: the OneUptime this machine reaches, such as http://localhost.}"
: "${ONEUPTIME_API_KEY:?Set ONEUPTIME_API_KEY: an API key of the test project, with the ProjectOwner permission.}"

case "$(uname -m)" in
  x86_64 | amd64) ARCH=amd64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  *) fail "no package is built for $(uname -m)" ;;
esac
PACKAGE="${CROSSPLANE_E2E_PACKAGE:-${ROOT}/Crossplane/packages/provider-oneuptime-${ARCH}.xpkg}"
if [[ -z "${CROSSPLANE_E2E_VERSION:-}" ]]; then
  CROSSPLANE_E2E_VERSION="$(head -n 1 "${ROOT}/Crossplane/provider-oneuptime/VERSION" 2>/dev/null ||
    head -n 1 "${ROOT}/VERSION")"
fi
VERSION="${CROSSPLANE_E2E_VERSION#v}"

for tool in docker kind kubectl helm crossplane curl jq; do
  command -v "${tool}" >/dev/null || fail "${tool} is not on PATH"
done
[[ -f "${PACKAGE}" ]] ||
  fail "no package at ${PACKAGE}: build it with Scripts/CrossplaneProvider/build-package.sh --version ${VERSION} --platforms linux/${ARCH}"

if [[ -n "${CROSSPLANE_E2E_WORK_DIR:-}" ]]; then
  WORK="${CROSSPLANE_E2E_WORK_DIR}"
  mkdir -p "${WORK}"
  OWN_WORK=false
else
  WORK="$(mktemp -d -t oneuptime-crossplane-e2e.XXXXXX)"
  OWN_WORK=true
fi
KUBECONFIG_FILE="${WORK}/kubeconfig"
# Helm's repositories and cache stay in the work directory too.
export HELM_CACHE_HOME="${WORK}/helm/cache"
export HELM_CONFIG_HOME="${WORK}/helm/config"
export HELM_DATA_HOME="${WORK}/helm/data"

CREATED_CLUSTER=false
CREATED_REGISTRY=false

# Removes what this run made, and only that: a cluster or registry of the
# same name that was there before fails the run instead (below).
cleanup() {
  local status=$?
  set +e
  if ((status != 0)) && [[ "${CREATED_CLUSTER}" == true ]]; then
    diagnose
  fi
  if [[ "${KEEP_CLUSTER:-false}" == true ]]; then
    log "Kept the kind cluster ${CLUSTER} (kubeconfig ${KUBECONFIG_FILE}) and the registry ${REGISTRY}"
  else
    [[ "${CREATED_CLUSTER}" == true ]] && kind delete cluster --name "${CLUSTER}" >/dev/null 2>&1
    [[ "${CREATED_REGISTRY}" == true ]] && docker rm -f "${REGISTRY}" >/dev/null 2>&1
    [[ "${OWN_WORK}" == true ]] && rm -rf "${WORK}"
  fi
  if ((status == 0)); then
    log "Crossplane E2E: all ${PASSED} checks passed"
  else
    log "Crossplane E2E: FAILED after ${PASSED} checks passed"
  fi
  exit "${status}"
}
trap cleanup EXIT

log "OneUptime at ${ONEUPTIME_URL}"
OFFLINE_STATUS_ID="$(id_named monitor-status Offline)" ||
  fail "the API key cannot read the project's monitor statuses at ${ONEUPTIME_URL}"
OPERATIONAL_STATUS_ID="$(id_named monitor-status Operational)" || fail "the project has no Operational status"
CRITICAL_SEVERITY_ID="$(id_named incident-severity "Critical Incident")" ||
  fail "the project has no Critical Incident severity"
pass "the API key reads the project: Offline ${OFFLINE_STATUS_ID}, Critical Incident ${CRITICAL_SEVERITY_ID}"

log "kind cluster ${CLUSTER}"
clusters="$(kind get clusters 2>/dev/null)" || clusters=""
if [[ $'\n'"${clusters}"$'\n' == *$'\n'"${CLUSTER}"$'\n'* ]]; then
  fail "there is a kind cluster ${CLUSTER} already: delete it, or set CROSSPLANE_E2E_CLUSTER"
fi
if [[ -n "$(docker ps -aq --filter "name=^${REGISTRY}\$")" ]]; then
  fail "there is a container ${REGISTRY} already: remove it, or set CROSSPLANE_E2E_CLUSTER"
fi
# Each node reads a registry's settings from /etc/containerd/certs.d, where
# the test registry is said to speak plain HTTP.
cat >"${WORK}/kind.yaml" <<'EOF'
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
containerdConfigPatches:
  - |-
    [plugins."io.containerd.grpc.v1.cri".registry]
      config_path = "/etc/containerd/certs.d"
EOF
CREATED_CLUSTER=true
kind create cluster --name "${CLUSTER}" --config "${WORK}/kind.yaml" \
  --kubeconfig "${KUBECONFIG_FILE}" --wait 300s
pass "the cluster is up"

# OneUptime as the cluster reaches it: on this machine, through the gateway
# of kind's network; anywhere else, at the same address.
if [[ -z "${CROSSPLANE_E2E_ONEUPTIME_URL:-}" ]]; then
  scheme="${ONEUPTIME_URL%%://*}"
  hostport="${ONEUPTIME_URL#*://}"
  hostport="${hostport%%/*}"
  host="${hostport%%:*}"
  if [[ "${hostport}" == *:* ]]; then
    port="${hostport##*:}"
  elif [[ "${scheme}" == https ]]; then
    port=443
  else
    port=80
  fi
  case "${host}" in
    localhost | 127.0.0.1)
      gateway=""
      read -r -a gateways <<<"$(docker network inspect "${KIND_NETWORK}" \
        -f '{{range .IPAM.Config}}{{.Gateway}} {{end}}')"
      for g in "${gateways[@]}"; do
        if [[ "${g}" == *.* && "${g}" != *:* ]]; then
          gateway="${g}"
          break
        fi
      done
      [[ -n "${gateway}" ]] || fail "the ${KIND_NETWORK} network has no IPv4 gateway"
      CROSSPLANE_E2E_ONEUPTIME_URL="${scheme}://${gateway}:${port}"
      ;;
    *) CROSSPLANE_E2E_ONEUPTIME_URL="${ONEUPTIME_URL%/}" ;;
  esac
fi
CLUSTER_ONEUPTIME_URL="${CROSSPLANE_E2E_ONEUPTIME_URL%/}"
mapfile -t nodes < <(kind get nodes --name "${CLUSTER}")
check "a node reaches OneUptime at ${CLUSTER_ONEUPTIME_URL}" \
  docker exec "${nodes[0]}" curl -sf -o /dev/null --max-time 20 "${CLUSTER_ONEUPTIME_URL}/api/status"

log "Registry ${REGISTRY}"
CREATED_REGISTRY=true
docker run -d --name "${REGISTRY}" --network "${KIND_NETWORK}" -p 127.0.0.1::5000 \
  "${REGISTRY_IMAGE}" >/dev/null
REGISTRY_PORT="$(docker port "${REGISTRY}" 5000/tcp | awk -F: 'NR == 1 { print $NF }')"
REGISTRY_IP="$(docker inspect -f "{{(index .NetworkSettings.Networks \"${KIND_NETWORK}\").IPAddress}}" "${REGISTRY}")"
for node in "${nodes[@]}"; do
  docker exec "${node}" mkdir -p "/etc/containerd/certs.d/${REGISTRY_IP}:5000"
  printf '[host."http://%s:5000"]\n  capabilities = ["pull", "resolve"]\n' "${REGISTRY_IP}" |
    docker exec -i "${node}" cp /dev/stdin "/etc/containerd/certs.d/${REGISTRY_IP}:5000/hosts.toml"
done
eventually 30 "the registry answers at localhost:${REGISTRY_PORT}" \
  curl -sf -o /dev/null "http://127.0.0.1:${REGISTRY_PORT}/v2/"

log "Package v${VERSION}"
crossplane xpkg push --package-files="${PACKAGE}" \
  "localhost:${REGISTRY_PORT}/provider-oneuptime:v${VERSION}"
# The address the cluster pulls it from: a private one, which Crossplane's
# package manager reaches over plain HTTP, as each node does (above).
PACKAGE_REF="${REGISTRY_IP}:5000/provider-oneuptime:v${VERSION}"
pass "pushed $(basename "${PACKAGE}") as ${PACKAGE_REF}"

log "Crossplane ${CROSSPLANE_VERSION}"
helm install crossplane crossplane --repo https://charts.crossplane.io/stable \
  --version "${CROSSPLANE_VERSION}" --namespace crossplane-system --create-namespace \
  --kubeconfig "${KUBECONFIG_FILE}" --wait --timeout 10m
pass "Crossplane is running"

RENDER_VARS=(PACKAGE_REF NAMESPACE ONEUPTIME_API_KEY CLUSTER_ONEUPTIME_URL RUN_ID
  OFFLINE_STATUS_ID OPERATIONAL_STATUS_ID CRITICAL_SEVERITY_ID)

log "Provider"
render "${MANIFESTS}/provider.yaml" | k apply -f -
k wait provider.pkg.crossplane.io/provider-oneuptime --for=condition=Installed --timeout=10m ||
  fail "Crossplane did not install the package"
k wait provider.pkg.crossplane.io/provider-oneuptime --for=condition=Healthy --timeout=10m ||
  fail "the provider is not healthy"
pass "Crossplane installed the package, and the provider is healthy"
# Every kind the package defines is activated, by Crossplane's default
# activation policy, as it is for anyone who installs it.
for kind in labels teams statuspages telemetryingestionkeys monitors monitorstatusdefinitions incidentseverities; do
  k wait "crd/${kind}.${GROUP}" --for=condition=Established --timeout=5m >/dev/null ||
    fail "the ${kind} kind was never established"
done
crds="$(k get crd -o name)"
count="$(grep -c "\.${GROUP}\$" <<<"${crds}" || true)"
expected="$(find "${ROOT}/Crossplane/provider-oneuptime/package/crds" -name '*.yaml' 2>/dev/null | wc -l)"
if ((expected == 0)); then
  expected=400
fi
check "the package installed its kinds (${count}, expected ${expected} and more)" test "${count}" -ge "${expected}"

log "The docs' manifests"
# What the docs' Crossplane pages tell a reader to apply is what the
# installed provider takes: the API server checks each object against the
# provider's kinds and refuses a field they do not have. Nothing is made;
# team-a, the pages' namespace, is there for the check only.
DOCS_PAGES="${ROOT}/packages/App/FeatureSet/Docs/Content/en/crossplane"
docs_manifests "${DOCS_PAGES}/index.md" "${DOCS_PAGES}/managing-resources.md" "v${VERSION}" \
  >"${WORK}/docs-manifests.yaml"
docs_objects="$(grep -c '^apiVersion:' "${WORK}/docs-manifests.yaml" || true)"
check "the docs' pages write manifests (${docs_objects})" test "${docs_objects}" -ge 10
dry_run_docs() {
  k apply --dry-run=server --validate=strict -f "${WORK}/docs-manifests.yaml" >"${WORK}/docs-dry-run.log"
}
k create namespace team-a >/dev/null
check "the provider takes every one of them as written, field for field" dry_run_docs
k delete namespace team-a --wait=false >/dev/null

log "Credentials"
render "${MANIFESTS}/credentials.yaml" | k apply -f -
pass "a ProviderConfig in ${NAMESPACE} and a ClusterProviderConfig with JSON credentials"

log "Observing what the project has"
render "${MANIFESTS}/observed.yaml" | k apply -f -
wait_ready monitorstatusdefinition/offline monitorstatusdefinition/operational incidentseverity/critical
check "the Offline status is observed by its ID" \
  test "$(field monitorstatusdefinition offline '{.status.atProvider.name}')" = Offline
check "the Critical Incident severity is observed by its ID" \
  test "$(field incidentseverity critical '{.status.atProvider.name}')" = "Critical Incident"

log "Creating"
render "${MANIFESTS}/resources.yaml" | k apply -f -
wait_ready label/production team/sre statuspage/public telemetryingestionkey/collector monitor/homepage

LABEL_ID="$(field label production '{.status.atProvider.id}')"
TEAM_ID="$(field team sre '{.status.atProvider.id}')"
STATUS_PAGE_ID="$(field statuspage public '{.status.atProvider.id}')"
KEY_ID="$(field telemetryingestionkey collector '{.status.atProvider.id}')"
MONITOR_ID="$(field monitor homepage '{.status.atProvider.id}')"
check "each resource's external name is the ID OneUptime gave it" test \
  "$(field label production '{.metadata.annotations.crossplane\.io/external-name}')" = "${LABEL_ID}"

check "the label is in OneUptime as written" item_matches label "${LABEL_ID}" \
  '{"name": true, "color": true, "description": true}' \
  ".name == \"Production ${RUN_ID}\" and .color.value == \"#16a34a\" and .description == \"Made by the Crossplane end-to-end test\""
check "the team is in OneUptime, made through the ClusterProviderConfig's JSON credentials" \
  item_matches team "${TEAM_ID}" '{"name": true}' ".name == \"SRE ${RUN_ID}\""
check "the status page is in OneUptime" item_matches status-page "${STATUS_PAGE_ID}" \
  '{"name": true}' ".name == \"Public status ${RUN_ID}\""

SECRET_KEY="$(k -n "${NAMESPACE}" get secret collector-telemetry-key \
  -o jsonpath='{.data.attribute\.secret_key}' | base64 -d)"
check "the telemetry key's secret is in its connection Secret" test -n "${SECRET_KEY}"
check "and not in the resource, which anyone who may read it would see" test -z \
  "$(field telemetryingestionkey collector '{.status.atProvider.secretKey}')"
check "the connection Secret holds the key OneUptime made" item_matches telemetry-ingestion-key "${KEY_ID}" \
  '{"secretKey": true}' "(.secretKey | if type == \"object\" then .value else . end) == \"${SECRET_KEY}\""

check "the monitor's label reference resolved to the label's ID" \
  test "$(field monitor homepage '{.spec.forProvider.labels[0]}')" = "${LABEL_ID}"
check "the monitor carries the label in OneUptime" item_matches monitor "${MONITOR_ID}" \
  '{"name": true, "labels": {"_id": true}}' \
  ".name == \"Homepage ${RUN_ID}\" and ([.labels[]._id] | index(\"${LABEL_ID}\") != null)"
# References inside the steps: a status, a severity and a team, two and three
# levels down.
steps="$(item monitor "${MONITOR_ID}" '{"monitorSteps": true}')"
for id in "${OFFLINE_STATUS_ID}" "${OPERATIONAL_STATUS_ID}" "${CRITICAL_SEVERITY_ID}" "${TEAM_ID}"; do
  check "the monitor's steps in OneUptime name ${id}" grep -q "${id}" <<<"${steps}"
done

log "Steady state"
# Nothing has changed since the provider made them, so in two or more polls
# (every 20 seconds here) it must update none of them. A field OneUptime
# gives back other than the manifest wrote it would have the provider update
# that resource again on every poll, forever.
sleep 50
updated="$(k -n "${NAMESPACE}" get events -o json |
  jq -r '[.items[] | select(.reason == "UpdatedExternalResource")
    | "\(.involvedObject.kind)/\(.involvedObject.name)"] | unique | join(" ")')"
check "the provider updates nothing while nothing changes${updated:+ (it updated ${updated})}" \
  test -z "${updated}"

log "Updating"
k -n "${NAMESPACE}" patch "label.${GROUP}" production --type merge \
  -p '{"spec": {"forProvider": {"color": "#2563eb", "description": "Changed in Kubernetes"}}}'
eventually 120 "a change to the Label reaches OneUptime" item_matches label "${LABEL_ID}" \
  '{"color": true, "description": true}' \
  '.color.value == "#2563eb" and .description == "Changed in Kubernetes"'

log "Drift"
status="$(api PUT "/team/${TEAM_ID}" '{"data": {"name": "Renamed outside Kubernetes"}}')"
[[ "${status}" == 200 ]] || fail "renaming the team through the API answered ${status}: $(cat "${WORK}/api.json")"
check "the team was renamed outside Kubernetes" item_matches team "${TEAM_ID}" '{"name": true}' \
  '.name == "Renamed outside Kubernetes"'
eventually 180 "the provider puts the team's name back" item_matches team "${TEAM_ID}" \
  '{"name": true}' ".name == \"SRE ${RUN_ID}\""

log "Importing"
status="$(api POST /label "{\"data\": {\"name\": \"Made outside ${RUN_ID}\", \"color\": \"#f59e0b\", \"description\": \"Made through the API\"}}")"
[[ "${status}" == 200 ]] || fail "making a label through the API answered ${status}: $(cat "${WORK}/api.json")"
IMPORTED_LABEL_ID="$(jq -er '._id // .data._id' "${WORK}/api.json")"
RENDER_VARS+=(IMPORTED_LABEL_ID)
render "${MANIFESTS}/imported.yaml" | k apply -f -
wait_ready label/made-outside
check "the imported label reads as OneUptime has it" \
  test "$(field label made-outside '{.status.atProvider.name}')" = "Made outside ${RUN_ID}"
k -n "${NAMESPACE}" delete "label.${GROUP}" made-outside --wait --timeout=120s
check "deleting an observed label leaves it in OneUptime" item_matches label "${IMPORTED_LABEL_ID}" \
  '{"name": true}' ".name == \"Made outside ${RUN_ID}\""
api DELETE "/label/${IMPORTED_LABEL_ID}" >/dev/null || true

log "Deleting"
# The monitor first: it refers to the others.
k -n "${NAMESPACE}" delete "monitor.${GROUP}" homepage --wait --timeout=180s
k -n "${NAMESPACE}" delete "label.${GROUP}/production" "team.${GROUP}/sre" \
  "statuspage.${GROUP}/public" "telemetryingestionkey.${GROUP}/collector" --wait --timeout=180s
for gone_ in "monitor ${MONITOR_ID}" "label ${LABEL_ID}" "team ${TEAM_ID}" \
  "status-page ${STATUS_PAGE_ID}" "telemetry-ingestion-key ${KEY_ID}"; do
  read -r path id <<<"${gone_}"
  eventually 60 "the ${path} is gone from OneUptime" item_missing "${path}" "${id}"
done
eventually 60 "the telemetry key's connection Secret went with it" test -z \
  "$(k -n "${NAMESPACE}" get secret collector-telemetry-key --ignore-not-found -o name)"

k -n "${NAMESPACE}" delete "monitorstatusdefinition.${GROUP}/offline" \
  "monitorstatusdefinition.${GROUP}/operational" "incidentseverity.${GROUP}/critical" --wait --timeout=120s
check "deleting what was only observed leaves the Offline status" item_matches monitor-status \
  "${OFFLINE_STATUS_ID}" '{"name": true}' '.name == "Offline"'
check "and the Critical Incident severity" item_matches incident-severity "${CRITICAL_SEVERITY_ID}" \
  '{"name": true}' '.name == "Critical Incident"'
