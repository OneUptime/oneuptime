#!/usr/bin/env bash
#
# The marketplace editions of the chart (HelmChart/Marketplace): self-hosted
# OneUptime Enterprise sold on AWS Marketplace (EKS), Microsoft Marketplace
# (AKS) and Google Cloud Marketplace (GKE), billed per user by the hour.
#
# The unit tests of build.py and of the release automation run first. Then each edition is built
# from the chart as it is now and rendered with helm, and what each
# marketplace checks at submission is checked here, so a chart change that
# would be rejected fails on the pull request instead:
#
#   every edition  lints and renders; every image comes from the
#                  marketplace's own registry, none from Docker Hub and none
#                  "latest"; the app knows which marketplace bills it, and
#                  makes no update check against GitHub (upgrades come
#                  through the marketplace); no subchart, archive or helm
#                  test hook is shipped;
#   aws            every image written out in values.yaml; the app and worker
#                  run as the IRSA service account; at most 50 images;
#   azure          the CNAB manifest, UI definition and ARM template agree;
#                  every image is a global.azure.images entry; the app gets
#                  the extension identity, plan and resource Azure fills in;
#   google-cloud   the schema maps every image and the reporting secret; the
#                  chart renders an Application and no service account; the
#                  reporting secret reaches the app; the tester renders.
#
# The Kubernetes agent's Amazon EKS add-on (aws-eks-addon) is checked the way
# AWS checks an add-on: AWS's own helm lint and helm template, for every
# Kubernetes version it names; no hook, no lookup, no CRD, no Release object
# but .Name and .Namespace; every image from the add-on's registry and named
# in its version; a Deployment or DaemonSet to follow; the ingestion key only
# ever read from the buyer's Secret; the configuration's examples rendering.
#
# Everything here is `helm template` and Python: no cluster, no images.

# shellcheck source=../lib/harness.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/harness.sh"

harness_install_helm

MARKETPLACE_DIR="$(cd "${TESTS_DIR}/../Marketplace" && pwd)"
VERSION="14.0.65"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

edition_value() {
    # edition_value <marketplace> <key>
    python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]][sys.argv[3]])' \
        "${MARKETPLACE_DIR}/editions.json" "$1" "$2"
}

rendered_images() {
    # rendered_images <rendered.yaml> -> one image reference per line, sorted, unique
    grep -oE 'image: "?[^" ]+"?' "$1" | sed -E 's/^image: "?//; s/"$//' | sort -u
}

check_common() {
    # check_common <marketplace> <chart dir> <rendered.yaml> <registry prefix>
    local marketplace="$1" chart="$2" rendered="$3" prefix="$4"
    local images

    images="$(rendered_images "$rendered")"

    if [ -z "$images" ]; then
        fail "${marketplace}: the render has images"
        return
    fi

    local outside
    outside="$(grep -vF -- "$prefix" <<<"$images" || true)"
    assert_eq "${marketplace}: every image comes from ${prefix}" "" "$outside"
    assert_absent "${marketplace}: no image from Docker Hub" "$images" "docker.io"
    assert_absent "${marketplace}: no image tagged latest" "$images" ":latest"

    local count
    count="$(wc -l <<<"$images" | tr -d ' ')"
    assert_eq "${marketplace}: the seven images, each rendered" "7" "$count"

    local marketplace_env
    marketplace_env="$(grep -A1 'name: ENTERPRISE_MARKETPLACE$' "$rendered" | grep 'value:' | sort -u | tr -d ' ')"
    assert_eq "${marketplace}: the app is told which marketplace bills it" "value:\"${marketplace}\"" "$marketplace_env"

    # Upgrades come through the marketplace: no comparing with, or calling, GitHub's releases.
    local update_check_env
    update_check_env="$(grep -A1 'name: DISABLE_UPDATE_CHECK$' "$rendered" | grep 'value:' | sort -u | tr -d ' ')"
    assert_eq "${marketplace}: the app makes no update check against GitHub" "value:'true'" "$update_check_env"

    # The marketplace knows its buyers and the release it ships them.
    local check_in_env
    check_in_env="$(grep -A1 'name: DISABLE_INSTANCE_CHECK_IN$' "$rendered" | grep 'value:' | sort -u | tr -d ' ')"
    assert_eq "${marketplace}: the app does not check in with oneuptime.com" "value:'true'" "$check_in_env"

    assert_absent "${marketplace}: no helm test hook" "$(cat "$rendered")" '"helm.sh/hook": test'

    if [ -d "${chart}/charts" ] || [ -n "$(find "$chart" -name '*.tgz' -print -quit)" ]; then
        fail "${marketplace}: no subchart or archive in the chart"
    else
        pass "${marketplace}: no subchart or archive in the chart"
    fi

    assert_absent "${marketplace}: Chart.yaml declares no dependencies" "$(cat "${chart}/Chart.yaml")" "dependencies:"
    assert_present "${marketplace}: Chart.yaml carries the release" "$(cat "${chart}/Chart.yaml")" "version: ${VERSION}"
}

render() {
    # render <chart dir> <out file> [helm args...]
    local chart="$1" out="$2"
    shift 2

    if helm template oneuptime "$chart" --namespace oneuptime "$@" >"$out" 2>"${out}.err"; then
        pass "$(basename "$out" .yaml): renders"
    else
        fail "$(basename "$out" .yaml): renders"
        sed 's/^/        /' "${out}.err" | head -20
    fi
}

# --- build.py's own unit tests -----------------------------------------------

if [ -n "${MARKETPLACE_RELEASED_CHARTS:-}" ]; then
    # The release workflow ran them on this repository's charts before it took the release's:
    # they test this repository's code, which a release's older chart may predate.
    echo "  SKIP: unit tests of build.py and the release automation: run on this repository's charts"
elif python3 -m unittest discover -s "$MARKETPLACE_DIR" -p 'test_*.py' >"${WORK_DIR}/unittest.log" 2>&1; then
    pass "unit tests of build.py and the release automation ($(grep -oE 'Ran [0-9]+ tests' "${WORK_DIR}/unittest.log"))"
else
    fail "unit tests of build.py and the release automation"
    sed 's/^/        /' "${WORK_DIR}/unittest.log" | tail -40
fi

# --- AWS Marketplace -----------------------------------------------------------

AWS_OUT="${WORK_DIR}/aws"

if python3 "${MARKETPLACE_DIR}/build.py" --marketplace aws --version "$VERSION" --out "$AWS_OUT" >/dev/null 2>"${WORK_DIR}/aws-build.err"; then
    pass "aws: builds"

    AWS_CHART="${AWS_OUT}/oneuptime"
    AWS_REGISTRY="$(edition_value aws registry)"

    if helm lint "$AWS_CHART" >"${WORK_DIR}/aws-lint.log" 2>&1; then
        pass "aws: helm lint"
    else
        fail "aws: helm lint"
        tail -20 "${WORK_DIR}/aws-lint.log" | sed 's/^/        /'
    fi

    render "$AWS_CHART" "${WORK_DIR}/aws.yaml" --set worker.enabled=true
    check_common aws "$AWS_CHART" "${WORK_DIR}/aws.yaml" "${AWS_REGISTRY}/"

    # What AWS checks when a version is added (MISSING_VALUES_IMAGE_REFERENCE): every rendered
    # image spelled out in values.yaml as a repository, with the registry and tag beside it.
    AWS_VALUES_REFERENCES="$(python3 -c 'import sys; sys.path.insert(0, sys.argv[1]); import build; print("\n".join(sorted(build.values_image_references(open(sys.argv[2]).read()))))' "$MARKETPLACE_DIR" "${AWS_CHART}/values.yaml")"

    while read -r image; do
        if grep -qxF -- "$image" <<<"$AWS_VALUES_REFERENCES"; then
            pass "aws: values.yaml spells out ${image##*/} as AWS checks it"
        else
            fail "aws: values.yaml spells out ${image##*/} as AWS checks it"
        fi
    done < <(rendered_images "${WORK_DIR}/aws.yaml")

    SERVICE_ACCOUNTS="$(grep -oE 'serviceAccountName: "?[^" ]+"?' "${WORK_DIR}/aws.yaml" | sed -E 's/serviceAccountName: "?//; s/"$//' | sort | uniq -c | tr -s ' ')"
    assert_present "aws: the app and the worker run as the IRSA service account" "$SERVICE_ACCOUNTS" "2 $(edition_value aws serviceAccountName)"

    IMAGE_COUNT="$(rendered_images "${WORK_DIR}/aws.yaml" | wc -l | tr -d ' ')"
    if [ "$IMAGE_COUNT" -le 50 ]; then
        pass "aws: within AWS's 50 images per delivery option"
    else
        fail "aws: within AWS's 50 images per delivery option (${IMAGE_COUNT})"
    fi

    # A region change is a registry change in values.yaml: AWS rewrites it when it copies the product.
    OTHER_REGION_VALUES="${WORK_DIR}/aws-eu.values.yaml"
    sed "s#709825985650.dkr.ecr.us-east-1.amazonaws.com#709825985650.dkr.ecr.eu-west-1.amazonaws.com#g" "${AWS_CHART}/values.yaml" >"$OTHER_REGION_VALUES"
    render "$AWS_CHART" "${WORK_DIR}/aws-eu.yaml" -f "$OTHER_REGION_VALUES"
    EU_OUTSIDE="$(rendered_images "${WORK_DIR}/aws-eu.yaml" | grep -vF "709825985650.dkr.ecr.eu-west-1.amazonaws.com/" || true)"
    assert_eq "aws: changing the region in values.yaml moves every image" "" "$EU_OUTSIDE"
elif [ -n "${MARKETPLACE_RELEASED_CHARTS:-}" ] && grep -qF "predates AWS Marketplace's image form" "${WORK_DIR}/aws-build.err"; then
    # A release's chart from before AWS's image form cannot go to AWS (build.py refuses it, and
    # so does the release's own AWS job): there is no AWS edition of it to check.
    echo "  SKIP: aws: $(cat "${WORK_DIR}/aws-build.err")"
else
    fail "aws: builds"
    sed 's/^/        /' "${WORK_DIR}/aws-build.err" | tail -10
fi

# --- Microsoft Marketplace -------------------------------------------------------

AZURE_OUT="${WORK_DIR}/azure"

if python3 "${MARKETPLACE_DIR}/build.py" --marketplace azure --version "$VERSION" --out "$AZURE_OUT" >/dev/null; then
    pass "azure: builds"

    AZURE_CHART="${AZURE_OUT}/oneuptime"
    AZURE_REGISTRY="$(edition_value azure registry)"

    if helm lint "$AZURE_CHART" >"${WORK_DIR}/azure-lint.log" 2>&1; then
        pass "azure: helm lint"
    else
        fail "azure: helm lint"
        tail -20 "${WORK_DIR}/azure-lint.log" | sed 's/^/        /'
    fi

    render "$AZURE_CHART" "${WORK_DIR}/azure.yaml"
    check_common azure "$AZURE_CHART" "${WORK_DIR}/azure.yaml" "${AZURE_REGISTRY}/"

    AZURE_MANIFEST="$(cat "${AZURE_OUT}/manifest.yaml")"
    assert_present "azure: the manifest version is the release" "$AZURE_MANIFEST" "version: ${VERSION}"
    assert_present "azure: the manifest points at the chart" "$AZURE_MANIFEST" 'helmChart: "./oneuptime"'
    assert_present "azure: the manifest names the ARM template as container-package-app reads it" "$AZURE_MANIFEST" 'clusterArmTemplate: "./mainTemplate.json"'
    assert_absent "azure: not as Microsoft's docs spell it, which cpa rejects" "$AZURE_MANIFEST" 'clusterARMTemplate:'
    assert_present "azure: the manifest names the create experience" "$AZURE_MANIFEST" 'uiDefinition: "./createUIDefinition.json"'
    assert_present "azure: one installation per cluster" "$AZURE_MANIFEST" 'defaultScope: "cluster"'

    # The UI definition's outputs must be exactly the ARM template's parameters,
    # and the extension must take the plan Partner Center fills in.
    if python3 - "${AZURE_OUT}" >"${WORK_DIR}/azure-arm.log" 2>&1 <<'PYTHON'
import json
import sys
from pathlib import Path

out = Path(sys.argv[1])
ui = json.loads((out / "createUIDefinition.json").read_text())
arm = json.loads((out / "mainTemplate.json").read_text())

outputs = set(ui["parameters"]["outputs"])
parameters = set(arm["parameters"])
missing = outputs - parameters
assert not missing, f"UI outputs with no ARM parameter: {missing}"

required = {
    name
    for name, parameter in arm["parameters"].items()
    if "defaultValue" not in parameter
}
unset = required - outputs
assert not unset, f"ARM parameters the UI never sets: {unset}"

assert ui["parameters"]["config"]["basics"]["resourceGroup"]["allowExisting"] is True

types = sorted({resource["type"] for resource in arm["resources"]})
assert types == [
    "Microsoft.ContainerService/managedClusters",
    "Microsoft.KubernetesConfiguration/extensions",
], types

extension = next(
    resource
    for resource in arm["resources"]
    if resource["type"] == "Microsoft.KubernetesConfiguration/extensions"
)
assert extension["plan"] == {
    "name": "[variables('plan-name')]",
    "publisher": "[variables('plan-publisher')]",
    "product": "[variables('plan-offerID')]",
}, extension["plan"]

for variable in ("plan-name", "plan-publisher", "plan-offerID", "releaseTrain", "clusterExtensionTypeName"):
    assert arm["variables"][variable] == "DONOTMODIFY", variable

settings = extension["properties"]["configurationSettings"]
assert settings == {
    "host": "[parameters('app-host')]",
    "httpProtocol": "[parameters('app-httpProtocol')]",
}, settings
PYTHON
    then
        pass "azure: the UI definition, the ARM template and the extension plan agree"
    else
        fail "azure: the UI definition, the ARM template and the extension plan agree"
        sed 's/^/        /' "${WORK_DIR}/azure-arm.log" | tail -10
    fi

    # Every rendered image is one Microsoft can rewrite: a global.azure.images entry.
    AZURE_LISTED="$(python3 - "${AZURE_OUT}/images.json" <<'PYTHON'
import json
import sys

for image in json.load(open(sys.argv[1]))["images"]:
    print(image["target"])
PYTHON
)"
    AZURE_UNLISTED="$(rendered_images "${WORK_DIR}/azure.yaml" | grep -vxF -- "$AZURE_LISTED" || true)"
    assert_eq "azure: every image is a global.azure.images entry" "" "$AZURE_UNLISTED"

    AZURE_RENDER="$(cat "${WORK_DIR}/azure.yaml")"
    assert_present "azure: the app gets the extension identity Azure fills in" "$AZURE_RENDER" "name: ENTERPRISE_MARKETPLACE_AZURE_CLIENT_ID"
    assert_present "azure: the app gets the extension resource Azure fills in" "$AZURE_RENDER" "name: ENTERPRISE_MARKETPLACE_AZURE_RESOURCE_ID"
    assert_present "azure: the app gets the plan Azure fills in" "$AZURE_RENDER" "name: ENTERPRISE_MARKETPLACE_AZURE_PLAN_ID"

    # What the extension does at install: rewrites the images to Microsoft's
    # registry by digest, and fills the identity, plan and resource in.
    render "$AZURE_CHART" "${WORK_DIR}/azure-installed.yaml" \
        --set global.azure.images.app.registry=marketplace.azurecr.io \
        --set global.azure.images.app.image=oneuptime/app \
        --set global.azure.images.app.digest=sha256:0123456789abcdef \
        --set global.azure.identity.clientId=6f1d1e8c-1111-4a2b-9c3d-123456789abc \
        --set host=oneuptime.example.com
    AZURE_INSTALLED="$(cat "${WORK_DIR}/azure-installed.yaml")"
    assert_present "azure: runs the image Microsoft rewrote, by digest" "$AZURE_INSTALLED" "marketplace.azurecr.io/oneuptime/app@sha256:0123456789abcdef"
    assert_present "azure: passes the identity Azure filled in" "$AZURE_INSTALLED" '"6f1d1e8c-1111-4a2b-9c3d-123456789abc"'
else
    fail "azure: builds"
fi

# --- Google Cloud Marketplace --------------------------------------------------------

GOOGLE_OUT="${WORK_DIR}/google-cloud"

if python3 "${MARKETPLACE_DIR}/build.py" --marketplace google-cloud --version "$VERSION" --out "$GOOGLE_OUT" >/dev/null; then
    pass "google-cloud: builds"

    GOOGLE_CHART="${GOOGLE_OUT}/chart/oneuptime"
    GOOGLE_REGISTRY="$(edition_value google-cloud registry)"

    if helm lint "$GOOGLE_CHART" >"${WORK_DIR}/google-lint.log" 2>&1; then
        pass "google-cloud: helm lint"
    else
        fail "google-cloud: helm lint"
        tail -20 "${WORK_DIR}/google-lint.log" | sed 's/^/        /'
    fi

    # As the deployer runs it: the reporting secret and the domain from the schema.
    render "$GOOGLE_CHART" "${WORK_DIR}/google-cloud.yaml" \
        --set enterpriseMarketplace.googleCloud.reportingSecret=oneuptime-reporting-secret \
        --set host=oneuptime.example.com
    check_common google-cloud "$GOOGLE_CHART" "${WORK_DIR}/google-cloud.yaml" "${GOOGLE_REGISTRY}"

    GOOGLE_RENDER="$(cat "${WORK_DIR}/google-cloud.yaml")"
    assert_present "google-cloud: renders the Application resource" "$GOOGLE_RENDER" "kind: Application"
    assert_absent "google-cloud: creates no service account" "$GOOGLE_RENDER" "kind: ServiceAccount"
    assert_absent "google-cloud: creates no RBAC" "$GOOGLE_RENDER" "kind: Role"
    assert_present "google-cloud: the app reads the reporting key from the reporting secret" "$GOOGLE_RENDER" "key: reporting-key"
    assert_present "google-cloud: the app reads the consumer from the reporting secret" "$GOOGLE_RENDER" "key: consumer-id"
    assert_present "google-cloud: the app knows the listing's service" "$GOOGLE_RENDER" "$(edition_value google-cloud serviceName)"

    GOOGLE_IMAGES="$(rendered_images "${WORK_DIR}/google-cloud.yaml")"
    GOOGLE_UNTAGGED="$(grep -v ":${VERSION}$" <<<"$GOOGLE_IMAGES" || true)"
    assert_eq "google-cloud: every image carries the published version" "" "$GOOGLE_UNTAGGED"

    GOOGLE_SCHEMA="$(cat "${GOOGLE_OUT}/schema.yaml")"
    assert_present "google-cloud: the schema is v2" "$GOOGLE_SCHEMA" "schemaVersion: v2"
    assert_present "google-cloud: the schema publishes the deployer's tag" "$GOOGLE_SCHEMA" 'publishedVersion: "$TAG"'
    assert_present "google-cloud: the schema hands over the reporting secret" "$GOOGLE_SCHEMA" "enterpriseMarketplace.googleCloud.reportingSecret:"

    # The deployer hands each image to the chart as a full reference.
    render "$GOOGLE_CHART" "${WORK_DIR}/google-cloud-deployed.yaml" \
        --set enterpriseMarketplace.googleCloud.reportingSecret=oneuptime-reporting-secret \
        --set image.overrides.app=marketplace.gcr.io/oneuptime/oneuptime-enterprise@sha256:aaaa
    assert_present "google-cloud: runs the image the deployer passes" "$(cat "${WORK_DIR}/google-cloud-deployed.yaml")" "marketplace.gcr.io/oneuptime/oneuptime-enterprise@sha256:aaaa"

    render "${GOOGLE_OUT}/apptest/deployer/oneuptime" "${WORK_DIR}/google-cloud-tester.yaml" \
        --set testerImage="${GOOGLE_REGISTRY}:${VERSION}"
    TESTER="$(cat "${WORK_DIR}/google-cloud-tester.yaml")"
    assert_present "google-cloud: the tester is marked for verification" "$TESTER" "marketplace.cloud.google.com/verification: test"
    assert_present "google-cloud: the tester checks OneUptime through nginx" "$TESTER" "http://oneuptime-nginx.oneuptime.svc"

    DOCKERFILE="$(cat "${GOOGLE_OUT}/Dockerfile")"
    assert_present "google-cloud: the deployer builds on Google's helm deployer" "$DOCKERFILE" "gcr.io/cloud-marketplace-tools/k8s/deployer_helm"
    # Google serves marketplace.gcr.io's images only to a signed-in account: the build stage,
    # which a dry run builds with no sign-in (--target build), starts from a public image.
    assert_absent "google-cloud: the build stage needs no Google sign-in" "$DOCKERFILE" "FROM marketplace.gcr.io"
    assert_present "google-cloud: the build stage is the one a dry run builds" "$DOCKERFILE" " AS build"
    assert_present "google-cloud: the deployer ships the chart" "$DOCKERFILE" "ADD chart/oneuptime /tmp/chart"
    assert_present "google-cloud: the deployer ships the tester" "$DOCKERFILE" "COPY --from=build /tmp/test/oneuptime.tar.gz /data-test/chart/"
else
    fail "google-cloud: builds"
fi

# --- The Kubernetes agent's Amazon EKS add-on ------------------------------------------------
#
# AWS renders an add-on as its Seller Guide says ("Requirements for Amazon EKS add-on
# products"), with Helm 3.19:
#   helm template <name> <chart> --set k8version=<v> --kube-version <v> --namespace <ns> --include-crds --no-hooks
# and refuses a chart that fails it, or uses what EKS does not run.

ADDON_OUT="${WORK_DIR}/aws-eks-addon"

addon_field() {
    # addon_field <key of aws-eks-addon/delivery-option.json>, lists one per line
    python3 -c 'import json,sys; v=json.load(open(sys.argv[1]))[sys.argv[2]]; print("\n".join(v) if isinstance(v, list) else v)' \
        "${MARKETPLACE_DIR}/aws-eks-addon/delivery-option.json" "$1"
}

render_addon() {
    # render_addon <out file> <kubernetes version> [helm args...]
    local out="$1" kubernetes="$2"
    shift 2

    if helm template kubernetes-agent "$ADDON_CHART" --set k8version="$kubernetes" --kube-version "$kubernetes" \
        --namespace "$ADDON_NAMESPACE" --include-crds --no-hooks "$@" >"$out" 2>"${out}.err"; then
        pass "aws-eks-addon: $(basename "$out" .yaml): renders as AWS renders it"
    else
        fail "aws-eks-addon: $(basename "$out" .yaml): renders as AWS renders it"
        sed 's/^/        /' "${out}.err" | head -20
    fi
}

if python3 "${MARKETPLACE_DIR}/build.py" --marketplace aws-eks-addon --version "$VERSION" --out "$ADDON_OUT" \
    >/dev/null 2>"${WORK_DIR}/aws-eks-addon-build.err"; then
    pass "aws-eks-addon: builds"

    ADDON_CHART="${ADDON_OUT}/kubernetes-agent"
    ADDON_REGISTRY="$(edition_value aws-eks-addon registry)"
    ADDON_NAMESPACE="$(addon_field namespace)"

    if helm lint "$ADDON_CHART" >"${WORK_DIR}/aws-eks-addon-lint.log" 2>&1; then
        pass "aws-eks-addon: helm lint"
    else
        fail "aws-eks-addon: helm lint"
        tail -20 "${WORK_DIR}/aws-eks-addon-lint.log" | sed 's/^/        /'
    fi

    # What AWS validates, and what a buyer gets with no configuration at all.
    while read -r kubernetes; do
        render_addon "${WORK_DIR}/aws-eks-addon-${kubernetes}.yaml" "$kubernetes"
    done < <(addon_field compatibleKubernetesVersions)

    KUBERNETES="$(addon_field compatibleKubernetesVersions | tail -n 1)"
    DEFAULT="${WORK_DIR}/aws-eks-addon-${KUBERNETES}.yaml"

    # As EKS installs it, with the cluster's name filled in, and every part the add-on offers on.
    render_addon "${WORK_DIR}/aws-eks-addon-everything.yaml" "$KUBERNETES" --set clusterName=prod-eks \
        --set kubeStateMetrics.enabled=true --set cost.enabled=true
    render_addon "${WORK_DIR}/aws-eks-addon-fargate.yaml" "$KUBERNETES" --set clusterName=prod-eks \
        --set preset=eks-fargate --set kubeStateMetrics.enabled=true --set cost.enabled=true

    EVERYTHING="$(cat "${WORK_DIR}/aws-eks-addon-everything.yaml" "${WORK_DIR}/aws-eks-addon-fargate.yaml")"
    ADDON_IMAGES="$(cat "${WORK_DIR}/aws-eks-addon-everything.yaml" "${WORK_DIR}/aws-eks-addon-fargate.yaml" >"${WORK_DIR}/aws-eks-addon-all.yaml" && rendered_images "${WORK_DIR}/aws-eks-addon-all.yaml")"

    ADDON_OUTSIDE="$(grep -vF -- "${ADDON_REGISTRY}/" <<<"$ADDON_IMAGES" || true)"
    assert_eq "aws-eks-addon: every image comes from ${ADDON_REGISTRY}/" "" "$ADDON_OUTSIDE"
    assert_absent "aws-eks-addon: no image from Docker Hub" "$ADDON_IMAGES" "docker.io"
    assert_absent "aws-eks-addon: no image tagged latest" "$ADDON_IMAGES" ":latest"

    ADDON_DECLARED="$(python3 -c 'import json,sys; print("\n".join(i["target"] for i in json.load(open(sys.argv[1]))["images"]))' "${ADDON_OUT}/images.json")"
    ADDON_UNDECLARED="$(grep -vxF -- "$ADDON_DECLARED" <<<"$ADDON_IMAGES" || true)"
    assert_eq "aws-eks-addon: every image it can run is one its version names" "" "$ADDON_UNDECLARED"
    assert_eq "aws-eks-addon: and it names no image it cannot run" "$(sort <<<"$ADDON_DECLARED")" "$(sort -u <<<"$ADDON_IMAGES")"

    ALL_TEMPLATES="$(cat "${ADDON_CHART}"/templates/*)"
    RELEASE_OBJECTS="$(grep -ohE '\.Release\.[A-Za-z]+' "${ADDON_CHART}"/templates/* | sort -u | grep -vxE '\.Release\.(Name|Namespace)' || true)"
    assert_eq "aws-eks-addon: no Release object but .Name and .Namespace" "" "$RELEASE_OBJECTS"
    LOOKUPS="$(grep -lwE 'lookup' "${ADDON_CHART}"/templates/* || true)"
    assert_eq "aws-eks-addon: no template so much as names lookup" "" "$LOOKUPS"
    assert_absent "aws-eks-addon: reads no API version off the cluster" "$ALL_TEMPLATES" ".Capabilities.APIVersions"
    assert_absent "aws-eks-addon: no helm hook" "$EVERYTHING" "helm.sh/hook"
    assert_absent "aws-eks-addon: installs no CRD" "$EVERYTHING" "kind: CustomResourceDefinition"

    if [ -d "${ADDON_CHART}/crds" ] || [ -d "${ADDON_CHART}/charts" ] || [ -n "$(find "$ADDON_CHART" -name '*.tgz' -print -quit)" ]; then
        fail "aws-eks-addon: no CRD directory, subchart or archive in the chart"
    else
        pass "aws-eks-addon: no CRD directory, subchart or archive in the chart"
    fi

    assert_absent "aws-eks-addon: Chart.yaml declares no dependencies" "$(cat "${ADDON_CHART}/Chart.yaml")" "dependencies:"
    assert_present "aws-eks-addon: Chart.yaml carries the release" "$(cat "${ADDON_CHART}/Chart.yaml")" "version: ${VERSION}"

    if [ -f "${ADDON_CHART}/aws_mp_configuration_schema.json" ]; then
        pass "aws-eks-addon: ships its configuration schema beside Chart.yaml"
    else
        fail "aws-eks-addon: ships its configuration schema beside Chart.yaml"
    fi

    DEFAULT_RENDER="$(cat "$DEFAULT")"
    assert_present "aws-eks-addon: a Deployment EKS can follow" "$DEFAULT_RENDER" "kind: Deployment"
    assert_present "aws-eks-addon: a DaemonSet on every node" "$DEFAULT_RENDER" "kind: DaemonSet"
    assert_present "aws-eks-addon: named as the Helm install names it" "$DEFAULT_RENDER" "name: kubernetes-agent-ai-agent"
    assert_present "aws-eks-addon: runs eBPF by default" "$DEFAULT_RENDER" "component: ebpf-instrument"

    # The key only ever in the buyer's Secret: no Secret of the add-on's own, and every
    # workload that sends to OneUptime reads it from the Secret the buyer names.
    assert_absent "aws-eks-addon: creates no Secret of its own" "$EVERYTHING" "kind: Secret"
    KEY_SECRETS="$(grep -A2 'secretKeyRef:' "${WORK_DIR}/aws-eks-addon-all.yaml" | grep -E '^[[:space:]]+name:' | sed -E 's/^[[:space:]]+name: //' | sort -u)"
    assert_eq "aws-eks-addon: every workload reads the key from the buyer's Secret" "oneuptime-ingestion-key" "$KEY_SECRETS"
    KEY_READERS="$(grep -c 'name: ONEUPTIME_API_KEY$' "${WORK_DIR}/aws-eks-addon-all.yaml" || true)"
    KEY_FROM_SECRETS="$(grep -A2 'name: ONEUPTIME_API_KEY$' "${WORK_DIR}/aws-eks-addon-all.yaml" | grep -c 'secretKeyRef:' || true)"
    assert_eq "aws-eks-addon: no workload is given the key as a value" "$KEY_READERS" "$KEY_FROM_SECRETS"

    # The cluster's name, as EKS fills it in, is what the agent reports.
    assert_present "aws-eks-addon: the cluster's name reaches the collectors" "$EVERYTHING" 'value: "prod-eks"'
    assert_absent "aws-eks-addon: nothing keeps the placeholder once EKS fills the name in" "$EVERYTHING" "set-by-amazon-eks"

    FARGATE="$(cat "${WORK_DIR}/aws-eks-addon-fargate.yaml")"
    assert_absent "aws-eks-addon: on Fargate, no DaemonSet" "$FARGATE" "kind: DaemonSet"
    assert_present "aws-eks-addon: on Fargate, the log tailer reads pod logs" "$FARGATE" "image: \"${ADDON_REGISTRY}/kubernetes-log-tailer:${VERSION}\""

    # A buyer's configuration values, as the schema's examples give them (JSON is YAML).
    python3 -c 'import json,sys; [open(f"{sys.argv[2]}-{i}.json", "w").write(json.dumps(e)) for i, e in enumerate(json.load(open(sys.argv[1]))["examples"])]' \
        "${ADDON_CHART}/aws_mp_configuration_schema.json" "${WORK_DIR}/aws-eks-addon-example"

    for example in "${WORK_DIR}"/aws-eks-addon-example-*.json; do
        render_addon "${example%.json}.yaml" "$KUBERNETES" --set clusterName=prod-eks -f "$example"
    done

    # A Region change is a registry change in values.yaml: AWS rewrites it when it copies the product.
    ADDON_EU_VALUES="${WORK_DIR}/aws-eks-addon-eu.values.yaml"
    sed "s#709825985650.dkr.ecr.us-east-1.amazonaws.com#709825985650.dkr.ecr.eu-west-1.amazonaws.com#g" "${ADDON_CHART}/values.yaml" >"$ADDON_EU_VALUES"
    render_addon "${WORK_DIR}/aws-eks-addon-eu.yaml" "$KUBERNETES" -f "$ADDON_EU_VALUES" --set clusterName=prod-eks \
        --set kubeStateMetrics.enabled=true --set cost.enabled=true
    ADDON_EU_OUTSIDE="$(rendered_images "${WORK_DIR}/aws-eks-addon-eu.yaml" | grep -vF "709825985650.dkr.ecr.eu-west-1.amazonaws.com/" || true)"
    assert_eq "aws-eks-addon: changing the Region in values.yaml moves every image" "" "$ADDON_EU_OUTSIDE"

    # The change set the workflow sends, built from this edition.
    if python3 "${MARKETPLACE_DIR}/automation/aws_catalog.py" plan --edition aws-eks-addon --images-json "${ADDON_OUT}/images.json" \
        --version "$VERSION" --product-id prod-test --out "${WORK_DIR}/aws-eks-addon-change-set.json" >/dev/null 2>"${WORK_DIR}/aws-eks-addon-change-set.log"; then
        ADDON_CHANGE_SET="$(cat "${WORK_DIR}/aws-eks-addon-change-set.json")"
        assert_present "aws-eks-addon: the change set adds an EKS add-on version" "$ADDON_CHANGE_SET" '"EksAddOnDeliveryOptionDetails"'
        assert_present "aws-eks-addon: for testing first" "$ADDON_CHANGE_SET" '"Visibility": "Limited"'
        assert_present "aws-eks-addon: the change set ships the chart" "$ADDON_CHANGE_SET" "\"HelmChartUri\": \"${ADDON_REGISTRY}/kubernetes-agent:${VERSION}\""
        assert_present "aws-eks-addon: EKS fills in the cluster's name" "$ADDON_CHANGE_SET" '"Value": "${AWS_EKS_CLUSTER_NAME}"'
        ADDON_CHANGE_SET_IMAGES="$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))[0]["DetailsDocument"]["DeliveryOptions"][0]["Details"]["EksAddOnDeliveryOptionDetails"]["ContainerImages"]))' "${WORK_DIR}/aws-eks-addon-change-set.json")"
        assert_eq "aws-eks-addon: the change set lists every image" "$(grep -c . <<<"$ADDON_DECLARED")" "$ADDON_CHANGE_SET_IMAGES"
    else
        fail "aws-eks-addon: the change set builds"
        sed 's/^/        /' "${WORK_DIR}/aws-eks-addon-change-set.log" | tail -10
    fi
elif grep -qF "predates the EKS add-on" "${WORK_DIR}/aws-eks-addon-build.err"; then
    # The release workflow runs this suite on the charts of the release it ships: one from
    # before the add-on has no add-on to check (and the add-on's own job refuses to build it).
    echo "  SKIP: aws-eks-addon: $(cat "${WORK_DIR}/aws-eks-addon-build.err")"
else
    fail "aws-eks-addon: builds"
    sed 's/^/        /' "${WORK_DIR}/aws-eks-addon-build.err" | tail -10
fi

# --- mirror-images.sh ---------------------------------------------------------------

for marketplace in aws azure google-cloud aws-eks-addon; do
    PLAN="${WORK_DIR}/${marketplace}/images.json"

    if [ ! -f "$PLAN" ]; then
        continue
    fi

    PLANNED="$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["images"]))' "$PLAN")"
    MIRROR="$(bash "${MARKETPLACE_DIR}/mirror-images.sh" "$PLAN" --dry-run 2>&1 || true)"
    COPIES="$(grep -cE '^\+ crane (copy|index filter) ' <<<"$MIRROR" || true)"
    assert_eq "${marketplace}: mirror-images.sh copies every image" "$PLANNED" "$COPIES"

    case "$marketplace" in
        aws | aws-eks-addon)
            # Only what EKS runs: no attestation manifests, no 386/s390x/... from the official images.
            FILTERS="$(grep -c '^+ crane index filter .* --platform linux/amd64 --platform linux/arm64 --tag ' <<<"$MIRROR" || true)"
            assert_eq "${marketplace}: keeps only linux/amd64 and linux/arm64 of every image" "$PLANNED" "$FILTERS"
            assert_absent "${marketplace}: never copies a whole index" "$MIRROR" "+ crane copy "
            ;;
        azure)
            assert_present "azure: mirrors linux/amd64 only" "$MIRROR" "crane copy --platform linux/amd64"
            ;;
        google-cloud)
            assert_present "google-cloud: annotates every image with the listing's service" "$MIRROR" "com.googleapis.cloudmarketplace.product.service.name=services/$(edition_value google-cloud serviceName)"
            assert_present "google-cloud: tags every image with its track" "$MIRROR" "crane tag "
            ;;
    esac
done

# A run again: an image an earlier run copied into AWS Marketplace's registry is left as it is
# (its repositories may refuse to overwrite a tag). crane is a stand-in here: it says the first
# image is there already, and logs everything else it is asked to do.
if [ -f "${WORK_DIR}/aws/images.json" ]; then
    FAKE_BIN="${WORK_DIR}/fake-bin"
    CRANE_LOG="${WORK_DIR}/crane.log"
    mkdir -p "$FAKE_BIN"
    : >"$CRANE_LOG"
    cat >"${FAKE_BIN}/crane" <<'CRANE'
#!/usr/bin/env bash
echo "$*" >>"$CRANE_LOG"
if [ "$1" = "digest" ]; then
    [ "$2" = "$CRANE_EXISTING" ] && echo "sha256:1111" && exit 0
    exit 1
fi
CRANE
    chmod +x "${FAKE_BIN}/crane"
    FIRST_TARGET="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["images"][0]["target"])' "${WORK_DIR}/aws/images.json")"

    if MIRROR="$(PATH="${FAKE_BIN}:${PATH}" CRANE_LOG="$CRANE_LOG" CRANE_EXISTING="$FIRST_TARGET" \
        bash "${MARKETPLACE_DIR}/mirror-images.sh" "${WORK_DIR}/aws/images.json" 2>&1)"; then
        FILTERED="$(grep '^index filter ' "$CRANE_LOG" || true)"
        assert_present "aws: an image an earlier run copied is left as it is" "$MIRROR" "= ${FIRST_TARGET} is there already"
        assert_absent "aws: and is not copied again" "$FILTERED" "--tag ${FIRST_TARGET}"
        assert_eq "aws: every other image is copied" "6" "$(grep -c . <<<"$FILTERED" || true)"
    else
        fail "aws: mirror-images.sh copies with crane"
        echo "$MIRROR" | sed 's/^/        /'
    fi
fi

# --- The release automation (HelmChart/Marketplace/automation) --------------------------
#
# What the Marketplace Release workflow sends, built from the editions above with no cloud:
# the AWS change set, the Partner Center request and the Google steps - and the one-time setup
# scripts parse.

AUTOMATION_DIR="${MARKETPLACE_DIR}/automation"
ZERO_DIGEST="sha256:$(printf '0%.0s' {1..64})"

if [ -f "${WORK_DIR}/aws/images.json" ]; then
    if python3 "${AUTOMATION_DIR}/aws_catalog.py" plan --images-json "${WORK_DIR}/aws/images.json" --version "$VERSION" \
        --product-id prod-test --out "${WORK_DIR}/aws-change-set.json" >/dev/null 2>"${WORK_DIR}/aws-change-set.log"; then
        CHANGE_SET="$(cat "${WORK_DIR}/aws-change-set.json")"
        assert_present "aws: the change set adds the version" "$CHANGE_SET" '"ChangeType": "AddDeliveryOptions"'
        assert_present "aws: the change set ships the chart" "$CHANGE_SET" "\"HelmChartUri\": \"$(edition_value aws registry)/oneuptime:${VERSION}\""
        assert_present "aws: the buyer's service account reaches the chart" "$CHANGE_SET" '"DefaultValue": "${AWSMP_SERVICE_ACCOUNT}"'
        CHANGE_SET_IMAGES="$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))[0]["DetailsDocument"]["DeliveryOptions"][0]["Details"]["HelmDeliveryOptionDetails"]["ContainerImages"]))' "${WORK_DIR}/aws-change-set.json")"
        assert_eq "aws: the change set lists every image" "7" "$CHANGE_SET_IMAGES"
    else
        fail "aws: the change set builds"
        sed 's/^/        /' "${WORK_DIR}/aws-change-set.log" | tail -10
    fi
fi

if python3 "${AUTOMATION_DIR}/partner_center.py" plan --tag "$VERSION" --digest "$ZERO_DIGEST" \
    --out "${WORK_DIR}/partner-center.json" >/dev/null 2>"${WORK_DIR}/partner-center.log"; then
    REQUEST="$(cat "${WORK_DIR}/partner-center.json")"
    assert_present "azure: the request points the plan at the release's bundle" "$REQUEST" "\"tag\": \"${VERSION}\""
    assert_present "azure: the bundle is the one cpa pushes" "$REQUEST" "\"repositoryName\": \"$(edition_value azure bundleRepository)\""
    assert_present "azure: the cluster extension type is the plan's" "$REQUEST" "\"clusterExtensionType\": \"$(edition_value azure clusterExtensionType)\""
else
    fail "azure: the Partner Center request builds"
    sed 's/^/        /' "${WORK_DIR}/partner-center.log" | tail -10
fi

GOOGLE_STEPS="$(GITHUB_STEP_SUMMARY='' python3 "${AUTOMATION_DIR}/google_cloud_release.py" summary --version "$VERSION" --deployer-digest "$ZERO_DIGEST" 2>&1 || true)"
assert_present "google-cloud: the Producer Portal steps name the deployer" "$GOOGLE_STEPS" "$(edition_value google-cloud registry)/deployer:${VERSION}"

for SETUP in google azure azure-registry; do
    SETUP_SCRIPT="$(python3 "${AUTOMATION_DIR}/ci_setup.py" "$SETUP" 2>/dev/null || true)"

    if [ -n "$SETUP_SCRIPT" ] && bash -n <<<"$SETUP_SCRIPT" 2>"${WORK_DIR}/setup-${SETUP}.log"; then
        pass "setup: the ${SETUP} script is valid bash"
    else
        fail "setup: the ${SETUP} script is valid bash"
        sed 's/^/        /' "${WORK_DIR}/setup-${SETUP}.log" | tail -5
    fi
done

harness_report
