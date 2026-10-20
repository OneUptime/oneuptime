#!/usr/bin/env bash
#
# GitOps controllers against the kubectl fixes OneUptime AI makes. Opt-in: it
# pulls Argo CD, Flux, Gitea and busybox images and waits out reconcile
# intervals, so it is not part of the helm-test job. Run it by name:
#
#   bash HelmChart/Tests/run.sh gitops-revert
#
# OneUptime AI fixes a Kubernetes workload with kubectl through the cluster's
# Runner (Common/Utils/AiRemediation/KubectlPolicy.ts lists what it may run).
# On a cluster where Argo CD, Flux or Helm owns the workload, the controller
# puts back what git (or the chart) declares - so a fix can be undone after
# it was verified, or flap. This suite measures, against the real
# controllers, which fix classes are put back, by whom and how fast, and
# reads the ownership markers each one leaves on the objects it manages
# (what packages/Common/Utils/AiRemediation/GitOpsOwnership.ts detects).
#
# Six owners, one namespace each, and one Deployment per fix class in each:
#   argocd-selfheal          Argo CD Application, automated sync + selfHeal
#   argocd-autosync          Argo CD Application, automated sync, no selfHeal
#   flux                     Flux Kustomization (interval FLUX_INTERVAL)
#   flux-helmrelease         Flux HelmRelease, drift detection off (default)
#   flux-helmrelease-drift   Flux HelmRelease, driftDetection.mode: enabled
#   helm                     plain `helm install`, no controller
#
# Git is an in-cluster Gitea. Every Deployment starts from the same manifest;
# the `undo` one is then "badly deployed" through git (busybox OLD -> NEW),
# so `kubectl rollout undo` has a revision to go back to that git does not
# declare - the rollback-first fix (Remediation/ChangeRollback.ts).
#
# Then every fix is applied at once and each field the fix changed is watched:
#   1. for OBSERVE_SECONDS (more than two FLUX_INTERVALs), nothing else
#      happening - what the controller does on its own;
#   2. after the next deploy (a commit, an Argo CD refresh as a webhook would
#      send, a `helm upgrade`), for NEXT_DEPLOY_OBSERVE_SECONDS.

# shellcheck source=../lib/harness.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/harness.sh"

ARGOCD_VERSION="${ARGOCD_VERSION:-v3.5.3}"
FLUX_VERSION="${FLUX_VERSION:-v2.9.6}"
GITEA_IMAGE="${GITEA_IMAGE:-gitea/gitea:1.27.3-rootless}"
OLD_TAG="${OLD_TAG:-1.36}"
NEW_TAG="${NEW_TAG:-1.37}"
FLUX_INTERVAL_SECONDS="${FLUX_INTERVAL_SECONDS:-60}"
OBSERVE_SECONDS="${OBSERVE_SECONDS:-150}"
NEXT_DEPLOY_OBSERVE_SECONDS="${NEXT_DEPLOY_OBSERVE_SECONDS:-120}"
POLL_SECONDS="${POLL_SECONDS:-2}"

GIT_NAMESPACE="gitops-git"
GIT_USER="oneuptime"
GIT_REPO_URL="http://gitea.${GIT_NAMESPACE}.svc.cluster.local:3000/${GIT_USER}/gitops.git"

OWNERS="argocd-selfheal argocd-autosync flux flux-helmrelease flux-helmrelease-drift helm"
CASES="restart undo scale scale-undeclared image resources env env-add patch pause delete-pod delete-workload annotate"
# A Flux HelmRelease renders only these: the fixes OneUptime AI runs most,
# plus a deleted workload. Keeps the cluster under one node's pod limit.
HELMRELEASE_CASES="restart undo scale image resources delete-workload"

WORK_DIR="$(mktemp -d)"
PORT_FORWARD_PID=""

# Set as the EXIT trap once the cluster is up: harness_start_cluster sets its
# own, which this one replaces and still runs.
cleanup() {
    if [ -n "$PORT_FORWARD_PID" ]; then
        kill "$PORT_FORWARD_PID" >/dev/null 2>&1 || true
    fi
    rm -rf "$WORK_DIR"
    if [ "$HELM_TEST_MANAGED_CLUSTER" != "true" ]; then
        harness_delete_cluster
    fi
}

log() {
    echo "[$(date +%H:%M:%S)] $*"
}

# A fresh KinD API server on a busy machine times out big applies (Argo CD's
# CRDs are a few hundred KB each): try again rather than fail the suite.
retry() {
    # retry <attempts> <command...>
    local attempts="$1" n=1
    shift
    until "$@"; do
        if [ "$n" -ge "$attempts" ]; then
            return 1
        fi
        n=$((n + 1))
        sleep 5
    done
}

# Removes what an earlier run left on a kept cluster (KEEP_CLUSTER=true), so
# every run starts from the same state: no releases, no Applications, no Flux
# objects, no test namespaces, and a Gitea with no users or repositories.
reset_cluster() {
    local owner
    helm uninstall gitops-helm -n "$(namespace_of helm)" >/dev/null 2>&1 || true
    kubectl -n argocd delete applications.argoproj.io --all --ignore-not-found --timeout=60s >/dev/null 2>&1 || true
    for kind in helmreleases.helm.toolkit.fluxcd.io kustomizations.kustomize.toolkit.fluxcd.io gitrepositories.source.toolkit.fluxcd.io; do
        kubectl -n flux-system delete "$kind" --all --ignore-not-found --timeout=120s >/dev/null 2>&1 || true
    done
    kubectl -n "$GIT_NAMESPACE" delete deployment gitea --ignore-not-found --timeout=60s >/dev/null 2>&1 || true
    for owner in $OWNERS; do
        kubectl delete namespace "$(namespace_of "$owner")" --ignore-not-found --timeout=180s >/dev/null 2>&1 || true
    done
}

namespace_of() {
    # namespace_of <owner>
    case "$1" in
        argocd-selfheal) echo "gitops-argocd-selfheal" ;;
        argocd-autosync) echo "gitops-argocd-autosync" ;;
        flux) echo "gitops-flux" ;;
        flux-helmrelease) echo "gitops-flux-helm" ;;
        flux-helmrelease-drift) echo "gitops-flux-helm-drift" ;;
        helm) echo "gitops-helm" ;;
    esac
}

cases_of() {
    # cases_of <owner>
    case "$1" in
        flux-helmrelease | flux-helmrelease-drift) echo "$HELMRELEASE_CASES" ;;
        *) echo "$CASES" ;;
    esac
}

# What git declares for the field each fix changes: the value a revert puts
# back. Matches the probe in snapshot_probes.
git_value_of() {
    # git_value_of <case>
    case "$1" in
        restart) echo "not-restarted" ;;
        undo) echo "busybox:${NEW_TAG}" ;;
        image) echo "busybox:${OLD_TAG}" ;;
        scale | scale-undeclared) echo "1" ;;
        resources) echo "32Mi" ;;
        env) echo "a" ;;
        env-add) echo "absent" ;;
        patch) echo "5" ;;
        pause) echo "false" ;;
        annotate) echo "absent" ;;
        delete-workload) echo "present" ;;
        # The ReplicaSet replaces a deleted pod; nothing for git to put back.
        delete-pod) echo "never" ;;
    esac
}

# The kubectl fix for each case, as OneUptime AI's Runner would run it.
fix_command_of() {
    # fix_command_of <case> <namespace>
    local ns="$2"
    case "$1" in
        restart) echo "kubectl rollout restart deployment/restart -n ${ns}" ;;
        undo) echo "kubectl rollout undo deployment/undo -n ${ns}" ;;
        scale) echo "kubectl scale deployment/scale --replicas=2 -n ${ns}" ;;
        scale-undeclared) echo "kubectl scale deployment/scale-undeclared --replicas=2 -n ${ns}" ;;
        image) echo "kubectl set image deployment/image app=busybox:${NEW_TAG} -n ${ns}" ;;
        resources) echo "kubectl set resources deployment/resources -c app --limits=memory=48Mi -n ${ns}" ;;
        env) echo "kubectl set env deployment/env MODE=b -n ${ns}" ;;
        env-add) echo "kubectl set env deployment/env-add FIX_FLAG=1 -n ${ns}" ;;
        patch) echo "kubectl patch deployment/patch --type=merge -p {\"spec\":{\"template\":{\"spec\":{\"terminationGracePeriodSeconds\":7}}}} -n ${ns}" ;;
        pause) echo "kubectl rollout pause deployment/pause -n ${ns}" ;;
        delete-pod) echo "kubectl delete pod/<one pod of delete-pod> -n ${ns}" ;;
        delete-workload) echo "kubectl delete deployment/delete-workload -n ${ns}" ;;
        annotate) echo "kubectl annotate deployment/annotate example.com/fix-note=ai -n ${ns}" ;;
    esac
}

apply_fix() {
    # apply_fix <case> <namespace>
    local case="$1" ns="$2"
    case "$case" in
        patch)
            kubectl patch deployment/patch --type=merge \
                -p '{"spec":{"template":{"spec":{"terminationGracePeriodSeconds":7}}}}' -n "$ns"
            ;;
        delete-pod)
            local pod
            pod="$(kubectl -n "$ns" get pod -l gitops-revert/case=delete-pod -o jsonpath='{.items[0].metadata.name}')"
            kubectl delete pod "$pod" -n "$ns" --wait=false
            ;;
        *)
            # shellcheck disable=SC2046
            $(fix_command_of "$case" "$ns")
            ;;
    esac
}

# Every Deployment the suite made, one line each: namespace, case, and the
# value of the field that case's fix changes.
snapshot_probes() {
    kubectl get deploy -A -l gitops-revert/case -o json | jq -r '
        def probe:
          .metadata.labels["gitops-revert/case"] as $c
          | .spec.template.spec.containers[0] as $ctr
          | if $c == "restart" then
              (if ((.spec.template.metadata.annotations // {})["kubectl.kubernetes.io/restartedAt"]) then "restarted" else "not-restarted" end)
            elif $c == "undo" or $c == "image" then $ctr.image
            elif $c == "scale" or $c == "scale-undeclared" then (.spec.replicas | tostring)
            elif $c == "resources" then ($ctr.resources.limits.memory // "none")
            elif $c == "env" then ((($ctr.env // []) | map(select(.name == "MODE")) | .[0].value) // "none")
            elif $c == "env-add" then (if (($ctr.env // []) | map(select(.name == "FIX_FLAG")) | length) > 0 then "present" else "absent" end)
            elif $c == "patch" then (.spec.template.spec.terminationGracePeriodSeconds | tostring)
            elif $c == "pause" then ((.spec.paused // false) | tostring)
            elif $c == "annotate" then (if ((.metadata.annotations // {})["example.com/fix-note"]) then "present" else "absent" end)
            elif $c == "delete-workload" then "present"
            else "n/a" end;
        .items[] | [.metadata.namespace, .metadata.labels["gitops-revert/case"], probe] | @tsv'
}

deployment_manifest() {
    # deployment_manifest <case> <image tag>
    local case="$1" tag="$2" replicas="  replicas: 1"
    if [ "$case" = "scale-undeclared" ]; then
        # As with an HPA: git leaves replicas to the cluster.
        replicas=""
    fi
    cat <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${case}
  labels:
    gitops-revert/case: ${case}
spec:
${replicas}
  selector:
    matchLabels:
      gitops-revert/case: ${case}
  template:
    metadata:
      labels:
        gitops-revert/case: ${case}
    spec:
      terminationGracePeriodSeconds: 5
      containers:
        - name: app
          image: busybox:${tag}
          command: ["sh", "-c", "sleep 1000000000"]
          env:
            - name: MODE
              value: "a"
          resources:
            requests:
              cpu: 5m
              memory: 16Mi
            limits:
              memory: 32Mi
EOF
}

marker_manifest() {
    # marker_manifest <release marker>
    cat <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: release-marker
data:
  marker: "$1"
EOF
}

# The repository's working tree for one commit: plain manifests for Argo CD
# and Flux, and a chart for Helm and the HelmReleases.
write_repo() {
    # write_repo <undo tag> <release marker>
    local undo_tag="$1" marker="$2" dir case tag
    for dir in argocd-selfheal argocd-autosync flux; do
        mkdir -p "${WORK_DIR}/repo/${dir}"
        for case in $CASES; do
            tag="$OLD_TAG"
            if [ "$case" = "undo" ]; then
                tag="$undo_tag"
            fi
            deployment_manifest "$case" "$tag" >"${WORK_DIR}/repo/${dir}/${case}.yaml"
        done
        marker_manifest "$marker" >"${WORK_DIR}/repo/${dir}/release-marker.yaml"
    done

    mkdir -p "${WORK_DIR}/repo/chart/templates"
    cat >"${WORK_DIR}/repo/chart/Chart.yaml" <<EOF
apiVersion: v2
name: gitops-revert
version: 0.1.0
EOF
    cat >"${WORK_DIR}/repo/chart/values.yaml" <<EOF
undoTag: "${OLD_TAG}"
releaseMarker: "1"
cases: [$(echo "$CASES" | sed 's/ /, /g')]
EOF
    for case in $CASES; do
        {
            echo "{{- if has \"${case}\" .Values.cases }}"
            if [ "$case" = "undo" ]; then
                deployment_manifest "$case" "__UNDO_TAG__" | sed 's/busybox:__UNDO_TAG__/busybox:{{ .Values.undoTag }}/'
            else
                deployment_manifest "$case" "$OLD_TAG"
            fi
            echo "{{- end }}"
        } >"${WORK_DIR}/repo/chart/templates/${case}.yaml"
    done
    cat >"${WORK_DIR}/repo/chart/templates/release-marker.yaml" <<'EOF'
apiVersion: v1
kind: ConfigMap
metadata:
  name: release-marker
data:
  marker: {{ .Values.releaseMarker | quote }}
EOF
}

git_commit_and_push() {
    # git_commit_and_push <message>
    git -C "${WORK_DIR}/repo" add -A
    git -C "${WORK_DIR}/repo" -c user.name=gitops-revert -c user.email=gitops-revert@example.com \
        commit -q -m "$1"
    git -C "${WORK_DIR}/repo" push -q "http://${GIT_USER}:${GIT_PASSWORD}@127.0.0.1:${GIT_LOCAL_PORT}/${GIT_USER}/gitops.git" HEAD:main
    git -C "${WORK_DIR}/repo" rev-parse HEAD
}

# What the cluster looks like when something it waits for never happens:
# every pod outside kube-system, and for each one that is not ready its
# description's tail, its events and its containers' last log lines.
dump_diagnostics() {
    echo "--- pods"
    kubectl get pods -A -o wide 2>&1 | grep -v "^kube-system" || true
    local ns pod
    kubectl get pods -A --no-headers 2>/dev/null |
        awk '$1 != "kube-system" { split($3, r, "/"); if ($4 != "Completed" && (r[1] != r[2] || $4 != "Running")) print $1, $2 }' |
        while read -r ns pod; do
            echo "--- ${ns}/${pod}"
            kubectl -n "$ns" describe pod "$pod" 2>&1 | tail -40 || true
            kubectl -n "$ns" logs "$pod" --all-containers --tail=30 2>&1 | tail -60 || true
        done
    echo "--- recent events"
    kubectl get events -A --sort-by=.lastTimestamp 2>&1 | grep -v "^kube-system" | tail -40 || true
}

wait_for() {
    # wait_for <description> <timeout seconds> <command...>
    local desc="$1" timeout="$2" start
    shift 2
    start="$(date +%s)"
    until "$@" >/dev/null 2>&1; do
        if [ $(($(date +%s) - start)) -ge "$timeout" ]; then
            log "timed out after ${timeout}s waiting for: ${desc}"
            dump_diagnostics
            return 1
        fi
        sleep 2
    done
    log "ready: ${desc} ($(($(date +%s) - start))s)"
}

argocd_app_synced_to() {
    # argocd_app_synced_to <app> <revision>
    [ "$(kubectl -n argocd get application "$1" -o jsonpath='{.status.sync.status}/{.status.sync.revision}')" = "Synced/$2" ]
}

flux_ready_at() {
    # flux_ready_at <kind> <name> <revision substring>
    local status
    status="$(kubectl -n flux-system get "$1" "$2" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status} {.status.lastAppliedRevision}{.status.lastAttemptedRevision}' 2>/dev/null)"
    case "$status" in
        "True "*"$3"*) return 0 ;;
    esac
    return 1
}

undo_deployments_bad() {
    # Every `undo` Deployment rolled out the bad tag, as revision 2 or later.
    local owner ns
    for owner in $OWNERS; do
        ns="$(namespace_of "$owner")"
        [ "$(kubectl -n "$ns" get deploy undo -o jsonpath='{.spec.template.spec.containers[0].image}')" = "busybox:${NEW_TAG}" ] || return 1
        [ "$(kubectl -n "$ns" get deploy undo -o jsonpath='{.metadata.annotations.deployment\.kubernetes\.io/revision}')" -ge 2 ] || return 1
        kubectl -n "$ns" rollout status deploy/undo --timeout=5s >/dev/null 2>&1 || return 1
    done
}

all_deployments_available() {
    local owner ns case expected actual
    for owner in $OWNERS; do
        ns="$(namespace_of "$owner")"
        expected="$(echo "$(cases_of "$owner")" | wc -w | tr -d ' ')"
        actual="$(kubectl -n "$ns" get deploy -l gitops-revert/case -o name 2>/dev/null | wc -l | tr -d ' ')"
        [ "$expected" = "$actual" ] || return 1
    done
    kubectl wait --for=condition=Available deploy -A -l gitops-revert/case --timeout=10s >/dev/null 2>&1
}

request_reconcile_everywhere() {
    local now
    now="$(date +%s)"
    kubectl -n argocd annotate application gitops-argocd-selfheal gitops-argocd-autosync argocd.argoproj.io/refresh=normal --overwrite >/dev/null
    kubectl -n flux-system annotate gitrepository gitops reconcile.fluxcd.io/requestedAt="$now" --overwrite >/dev/null
    kubectl -n flux-system annotate kustomization gitops-flux reconcile.fluxcd.io/requestedAt="$now" --overwrite >/dev/null
    kubectl -n flux-system annotate helmrelease gitops-flux-helm reconcile.fluxcd.io/requestedAt="$now" --overwrite >/dev/null
    kubectl -n flux-system annotate helmrelease gitops-flux-helm-drift reconcile.fluxcd.io/requestedAt="$now" --overwrite >/dev/null
}

# The markers each owner must leave on the objects it manages, as
# "label+<key>" / "annotation+<key>" / "manager+<name>" ("+" for a space).
expected_markers_of() {
    # expected_markers_of <owner>
    case "$1" in
        argocd-selfheal | argocd-autosync)
            echo "annotation+argocd.argoproj.io/tracking-id"
            ;;
        flux)
            echo "label+kustomize.toolkit.fluxcd.io/name label+kustomize.toolkit.fluxcd.io/namespace manager+kustomize-controller"
            ;;
        flux-helmrelease | flux-helmrelease-drift)
            echo "label+helm.toolkit.fluxcd.io/name label+helm.toolkit.fluxcd.io/namespace annotation+meta.helm.sh/release-name manager+helm-controller"
            ;;
        helm)
            echo "annotation+meta.helm.sh/release-name label+app.kubernetes.io/managed-by"
            ;;
    esac
}

# The fixes that change something git (or the chart) declares. The others
# add what git does not declare: Argo CD and Helm leave that alone.
PUT_BACK_CASES="undo scale image resources env patch delete-workload"

# Owners that put a change back on their own, not at the next deploy.
reconciles_on_its_own() {
    case "$1" in
        argocd-selfheal | flux | flux-helmrelease-drift) return 0 ;;
    esac
    return 1
}

# What each owner is expected to do with each fix: "on its own", "at the
# next deploy", "never" (it stays) - or "" for a deleted pod, which its
# ReplicaSet replaces whoever owns the Deployment.
#
# Flux's kustomize-controller takes over the fields kubectl wrote and applies
# git again, so it also removes what kubectl added: a restart annotation, a
# pause, an annotation, a variable. Of these fixes only `kubectl scale` of a
# replica count git does not declare stays.
expected_outcome_of() {
    # expected_outcome_of <owner> <case>
    local owner="$1" case="$2"
    if [ "$case" = "delete-pod" ]; then
        echo ""
    elif [ "$owner" = "flux" ] && [ "$case" != "scale-undeclared" ]; then
        echo "on its own"
    elif [[ " ${PUT_BACK_CASES} " == *" ${case} "* ]]; then
        if reconciles_on_its_own "$owner"; then
            echo "on its own"
        else
            echo "at the next deploy"
        fi
    else
        echo "never"
    fi
}

# Watches every pending (owner, case) for its field to read the git value
# again. PENDING lines: owner ns case git_value since_epoch. Writes the ones
# that turned back to REVERTED as: owner case seconds, and leaves the rest.
watch_for_reverts() {
    # watch_for_reverts <pending file> <reverted file> <seconds>
    local pending="$1" reverted="$2" seconds="$3" start now snapshot
    start="$(date +%s)"
    snapshot="${WORK_DIR}/snapshot"
    : >"$reverted"
    while :; do
        now="$(date +%s)"
        snapshot_probes >"$snapshot" 2>/dev/null || true
        if [ ! -s "$snapshot" ]; then
            # A failed read is not a revert: look again.
            sleep "$POLL_SECONDS"
            continue
        fi
        awk -F'\t' -v now="$now" -v out="$reverted" -v keep="${pending}.next" '
            FNR == NR { probe[$1 SUBSEP $2] = $3; next }
            {
                split($0, f, " ")
                owner = f[1]; ns = f[2]; c = f[3]; gitv = f[4]; since = f[5]
                key = ns SUBSEP c
                value = (key in probe) ? probe[key] : "absent"
                if (value == gitv) {
                    print owner, c, now - since >> out
                } else {
                    print $0 >> keep
                }
            }' "$snapshot" "$pending"
        touch "${pending}.next"
        mv "${pending}.next" "$pending"
        if [ ! -s "$pending" ] || [ $((now - start)) -ge "$seconds" ]; then
            break
        fi
        sleep "$POLL_SECONDS"
    done
}

# ---------------------------------------------------------------------------

harness_start_cluster
trap cleanup EXIT

# Every kubectl and helm call below goes to this cluster and no other: the
# suite deletes and changes things, and a shared kubeconfig's current
# context can be switched under it by anything else on the machine.
kind export kubeconfig --name "$HELM_TEST_CLUSTER" --kubeconfig "${WORK_DIR}/kubeconfig" >/dev/null 2>&1
export KUBECONFIG="${WORK_DIR}/kubeconfig"
kubectl config use-context "kind-${HELM_TEST_CLUSTER}" >/dev/null

reset_cluster

log "installing Argo CD ${ARGOCD_VERSION} (core), Flux ${FLUX_VERSION} and Gitea"
kubectl create namespace argocd >/dev/null 2>&1 || true
retry 5 kubectl apply -n argocd --server-side --force-conflicts --request-timeout=120s \
    -f "https://raw.githubusercontent.com/argoproj/argo-cd/${ARGOCD_VERSION}/manifests/core-install.yaml" >/dev/null
retry 5 kubectl apply --server-side --force-conflicts --request-timeout=120s \
    -f "https://github.com/fluxcd/flux2/releases/download/${FLUX_VERSION}/install.yaml" >/dev/null

# Argo CD's redis comes from public.ecr.aws with imagePullPolicy Always,
# and ECR Public throttles anonymous pulls from shared CI addresses: a run
# on GitHub's runners spent its whole wait on it. The same official image,
# same tag, from Docker Hub, pulled once.
redis_image="$(kubectl -n argocd get deployment argocd-redis -o jsonpath='{.spec.template.spec.containers[0].image}')"
kubectl -n argocd patch deployment argocd-redis --type=json -p "[
    {\"op\": \"replace\", \"path\": \"/spec/template/spec/containers/0/image\", \"value\": \"${redis_image#public.ecr.aws/docker/library/}\"},
    {\"op\": \"replace\", \"path\": \"/spec/template/spec/containers/0/imagePullPolicy\", \"value\": \"IfNotPresent\"}
]" >/dev/null

# Only Flux's source, kustomize and helm controllers and Argo CD's
# application controller, repo server and redis take part; the rest would
# only take CPU from a busy runner.
for deployment in notification-controller image-reflector-controller image-automation-controller source-watcher; do
    kubectl -n flux-system scale deployment "$deployment" --replicas=0 >/dev/null 2>&1 || true
done
kubectl -n argocd scale deployment argocd-applicationset-controller --replicas=0 >/dev/null 2>&1 || true

kubectl create namespace "$GIT_NAMESPACE" >/dev/null 2>&1 || true
cat >"${WORK_DIR}/gitea.yaml" <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gitea
spec:
  replicas: 1
  selector:
    matchLabels: {app: gitea}
  template:
    metadata:
      labels: {app: gitea}
    spec:
      containers:
        - name: gitea
          image: ${GITEA_IMAGE}
          env:
            - {name: GITEA__security__INSTALL_LOCK, value: "true"}
            - {name: GITEA__database__DB_TYPE, value: sqlite3}
            - {name: GITEA__server__ROOT_URL, value: "http://gitea.${GIT_NAMESPACE}.svc.cluster.local:3000/"}
            - {name: GITEA__server__DISABLE_SSH, value: "true"}
            - {name: GITEA__repository__ENABLE_PUSH_CREATE_USER, value: "true"}
            - {name: GITEA__repository__DEFAULT_PUSH_CREATE_PRIVATE, value: "false"}
            - {name: GITEA__service__DISABLE_REGISTRATION, value: "true"}
          ports:
            - containerPort: 3000
          readinessProbe:
            httpGet: {path: /api/healthz, port: 3000}
            periodSeconds: 2
          volumeMounts:
            - {name: data, mountPath: /var/lib/gitea}
            - {name: config, mountPath: /etc/gitea}
      volumes:
        - {name: data, emptyDir: {}}
        - {name: config, emptyDir: {}}
---
apiVersion: v1
kind: Service
metadata:
  name: gitea
spec:
  selector: {app: gitea}
  ports:
    - {port: 3000, targetPort: 3000}
EOF
retry 5 kubectl apply -n "$GIT_NAMESPACE" -f "${WORK_DIR}/gitea.yaml" >/dev/null

wait_for "Gitea" 900 kubectl -n "$GIT_NAMESPACE" rollout status deploy/gitea --timeout=5s
wait_for "Argo CD application controller" 900 kubectl -n argocd rollout status statefulset/argocd-application-controller --timeout=5s
wait_for "Argo CD repo server" 900 kubectl -n argocd rollout status deploy/argocd-repo-server --timeout=5s
wait_for "Argo CD redis" 900 kubectl -n argocd rollout status deploy/argocd-redis --timeout=5s
for controller in source-controller kustomize-controller helm-controller; do
    wait_for "Flux ${controller}" 900 kubectl -n flux-system rollout status "deploy/${controller}" --timeout=5s
done

GIT_PASSWORD="gitops-$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 24)"
kubectl -n "$GIT_NAMESPACE" exec deploy/gitea -- gitea admin user create \
    --username "$GIT_USER" --password "$GIT_PASSWORD" --email gitops-revert@example.com \
    --admin --must-change-password=false >/dev/null

GIT_LOCAL_PORT="$((20000 + RANDOM % 20000))"
kubectl -n "$GIT_NAMESPACE" port-forward svc/gitea "${GIT_LOCAL_PORT}:3000" >"${WORK_DIR}/port-forward.log" 2>&1 &
PORT_FORWARD_PID=$!
wait_for "Gitea port-forward" 60 curl -fsS "http://127.0.0.1:${GIT_LOCAL_PORT}/api/healthz"

mkdir -p "${WORK_DIR}/repo"
git -C "${WORK_DIR}/repo" init -q -b main
write_repo "$OLD_TAG" "1"
REVISION_1="$(git_commit_and_push "commit 1: every case at busybox:${OLD_TAG}")"
log "git commit 1: ${REVISION_1}"

for owner in $OWNERS; do
    kubectl create namespace "$(namespace_of "$owner")" >/dev/null 2>&1 || true
done

cat >"${WORK_DIR}/owners.yaml" <<EOF
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: default
  namespace: argocd
spec:
  sourceRepos: ["*"]
  destinations:
    - {namespace: "*", server: "*"}
  clusterResourceWhitelist:
    - {group: "*", kind: "*"}
---
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: gitops-argocd-selfheal
  namespace: argocd
spec:
  project: default
  source:
    repoURL: ${GIT_REPO_URL}
    targetRevision: main
    path: argocd-selfheal
  destination:
    server: https://kubernetes.default.svc
    namespace: $(namespace_of argocd-selfheal)
  syncPolicy:
    automated: {prune: true, selfHeal: true}
---
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: gitops-argocd-autosync
  namespace: argocd
spec:
  project: default
  source:
    repoURL: ${GIT_REPO_URL}
    targetRevision: main
    path: argocd-autosync
  destination:
    server: https://kubernetes.default.svc
    namespace: $(namespace_of argocd-autosync)
  syncPolicy:
    automated: {prune: true, selfHeal: false}
---
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: gitops
  namespace: flux-system
spec:
  interval: 30s
  url: ${GIT_REPO_URL}
  ref: {branch: main}
---
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: gitops-flux
  namespace: flux-system
spec:
  interval: ${FLUX_INTERVAL_SECONDS}s
  path: ./flux
  prune: true
  targetNamespace: $(namespace_of flux)
  sourceRef: {kind: GitRepository, name: gitops}
---
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: gitops-flux-helm
  namespace: flux-system
spec:
  interval: ${FLUX_INTERVAL_SECONDS}s
  targetNamespace: $(namespace_of flux-helmrelease)
  chart:
    spec:
      chart: ./chart
      reconcileStrategy: Revision
      sourceRef: {kind: GitRepository, name: gitops}
  values:
    undoTag: "${OLD_TAG}"
    cases: [$(echo "$HELMRELEASE_CASES" | sed 's/ /, /g')]
---
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: gitops-flux-helm-drift
  namespace: flux-system
spec:
  interval: ${FLUX_INTERVAL_SECONDS}s
  targetNamespace: $(namespace_of flux-helmrelease-drift)
  driftDetection: {mode: enabled}
  chart:
    spec:
      chart: ./chart
      reconcileStrategy: Revision
      sourceRef: {kind: GitRepository, name: gitops}
  values:
    undoTag: "${OLD_TAG}"
    cases: [$(echo "$HELMRELEASE_CASES" | sed 's/ /, /g')]
EOF
retry 5 kubectl apply -f "${WORK_DIR}/owners.yaml" >/dev/null

helm install gitops-helm "${WORK_DIR}/repo/chart" -n "$(namespace_of helm)" --set "undoTag=${OLD_TAG}" >/dev/null

wait_for "Argo CD selfHeal app synced to commit 1" 300 argocd_app_synced_to gitops-argocd-selfheal "$REVISION_1"
wait_for "Argo CD autosync app synced to commit 1" 300 argocd_app_synced_to gitops-argocd-autosync "$REVISION_1"
wait_for "Flux Kustomization applied commit 1" 300 flux_ready_at kustomization gitops-flux "$REVISION_1"
wait_for "every Deployment available" 600 all_deployments_available

echo
echo "=== ownership markers each owner leaves (Deployment / ReplicaSet / Pod of the image case) ==="
for owner in $OWNERS; do
    ns="$(namespace_of "$owner")"
    for kind in deployment replicaset pod; do
        name="$(kubectl -n "$ns" get "$kind" -l gitops-revert/case=image -o jsonpath='{.items[0].metadata.name}')"
        echo "--- ${owner} ${kind}/${name}"
        kubectl -n "$ns" get "$kind" "$name" -o json --show-managed-fields | jq -r '
            (.metadata.labels // {} | to_entries[] | "  label      \(.key)=\(.value)"),
            (.metadata.annotations // {} | to_entries[]
                | select(.key != "kubectl.kubernetes.io/last-applied-configuration")
                | "  annotation \(.key)=\(.value | tostring | .[0:120])"),
            (if (.metadata.annotations // {})["kubectl.kubernetes.io/last-applied-configuration"]
                then "  annotation kubectl.kubernetes.io/last-applied-configuration=(present)" else empty end),
            (.metadata.managedFields // [] | .[]
                | "  manager    \(.manager) (\(.operation)\(if .subresource then ", " + .subresource else "" end))\(if (.fieldsV1["f:spec"] // {})["f:replicas"] then " owns spec.replicas" else "" end)"),
            (.metadata.ownerReferences // [] | .[] | "  owner      \(.kind)/\(.name)")'
    done
done

echo
echo "=== the markers OneUptime reads (packages/Common/Utils/AiRemediation/GitOpsOwnership.ts) ==="
for owner in $OWNERS; do
    ns="$(namespace_of "$owner")"
    markers="$(kubectl -n "$ns" get deployment image -o json --show-managed-fields | jq -r '
        (.metadata.labels // {} | keys[] | "label " + .),
        (.metadata.annotations // {} | keys[] | "annotation " + .),
        (.metadata.managedFields // [] | .[] | "manager " + .manager)')"
    for marker in $(expected_markers_of "$owner"); do
        assert_present "${owner}: the Deployment carries ${marker//+/ }" "$markers" "${marker//+/ }"
    done
done

echo
log "the bad deploy: undo goes busybox:${OLD_TAG} -> busybox:${NEW_TAG} through git, the chart and the HelmReleases"
write_repo "$NEW_TAG" "2"
REVISION_2="$(git_commit_and_push "commit 2: the bad deploy of undo, busybox:${NEW_TAG}")"
log "git commit 2: ${REVISION_2}"
for release in gitops-flux-helm gitops-flux-helm-drift; do
    kubectl -n flux-system patch helmrelease "$release" --type=merge \
        -p "{\"spec\":{\"values\":{\"undoTag\":\"${NEW_TAG}\"}}}" >/dev/null
done
helm upgrade gitops-helm "${WORK_DIR}/repo/chart" -n "$(namespace_of helm)" --reuse-values --set "undoTag=${NEW_TAG}" >/dev/null
request_reconcile_everywhere
wait_for "Argo CD selfHeal app synced to commit 2" 300 argocd_app_synced_to gitops-argocd-selfheal "$REVISION_2"
wait_for "Argo CD autosync app synced to commit 2" 300 argocd_app_synced_to gitops-argocd-autosync "$REVISION_2"
wait_for "Flux Kustomization applied commit 2" 300 flux_ready_at kustomization gitops-flux "$REVISION_2"
wait_for "every undo Deployment rolled out the bad tag" 300 undo_deployments_bad
wait_for "every Deployment available" 300 all_deployments_available

# Let every controller settle after the deploy before anything is changed.
sleep 15

echo
log "applying every fix"
PENDING="${WORK_DIR}/pending"
RESULTS="${WORK_DIR}/results"
: >"$PENDING"
: >"$RESULTS"
for owner in $OWNERS; do
    ns="$(namespace_of "$owner")"
    for case in $(cases_of "$owner"); do
        if apply_fix "$case" "$ns" >/dev/null 2>"${WORK_DIR}/fix-error"; then
            fixed_at="$(date +%s)"
            if [ "$case" != "delete-pod" ]; then
                echo "$owner $ns $case $(git_value_of "$case") $fixed_at" >>"$PENDING"
            fi
        else
            fail "${owner}: the ${case} fix could not be applied: $(cat "${WORK_DIR}/fix-error")"
        fi
    done
done

# A fix the controller had already put back before the first look would read
# as never applied; the first snapshot shows each fix took.
snapshot_probes >"${WORK_DIR}/after-fix" 2>/dev/null || true

log "watching for reverts for ${OBSERVE_SECONDS}s, nothing else happening"
REVERTED_1="${WORK_DIR}/reverted-1"
watch_for_reverts "$PENDING" "$REVERTED_1" "$OBSERVE_SECONDS"
cp "$PENDING" "${WORK_DIR}/kept-after-window"

echo
log "the next deploy: commit 3 (a release-marker change), an Argo CD refresh, helm upgrade"
write_repo "$NEW_TAG" "3"
REVISION_3="$(git_commit_and_push "commit 3: the next deploy")"
log "git commit 3: ${REVISION_3}"
helm upgrade gitops-helm "${WORK_DIR}/repo/chart" -n "$(namespace_of helm)" --reuse-values --set releaseMarker=3 >/dev/null
NEXT_DEPLOY_AT="$(date +%s)"
kubectl -n argocd annotate application gitops-argocd-selfheal gitops-argocd-autosync argocd.argoproj.io/refresh=normal --overwrite >/dev/null
# Measured from the next deploy, not from the fix.
awk -v t="$NEXT_DEPLOY_AT" '{ $5 = t; print }' "$PENDING" >"${PENDING}.rebased"
mv "${PENDING}.rebased" "$PENDING"
REVERTED_2="${WORK_DIR}/reverted-2"
watch_for_reverts "$PENDING" "$REVERTED_2" "$NEXT_DEPLOY_OBSERVE_SECONDS"

echo
echo "=== what happened to each fix ==="
printf '%-23s %-17s %-28s %s\n' "owner" "case" "on its own (${OBSERVE_SECONDS}s)" "after the next deploy"
for owner in $OWNERS; do
    for case in $(cases_of "$owner"); do
        took="$(awk -F'\t' -v ns="$(namespace_of "$owner")" -v c="$case" '$1 == ns && $2 == c { print $3 }' "${WORK_DIR}/after-fix")"
        first="$(awk -v o="$owner" -v c="$case" '$1 == o && $2 == c { print "reverted after " $3 "s" }' "$REVERTED_1")"
        second="$(awk -v o="$owner" -v c="$case" '$1 == o && $2 == c { print "reverted after " $3 "s" }' "$REVERTED_2")"
        if [ "$case" = "delete-pod" ]; then
            first="replaced by its ReplicaSet"
            second="-"
        elif [ -z "$first" ]; then
            first="kept (${took:-absent})"
            if [ -z "$second" ]; then
                second="kept"
            fi
        else
            second="-"
        fi
        printf '%-23s %-17s %-28s %s\n' "$owner" "$case" "$first" "$second"
        echo "${owner}|${case}|${first}|${second}" >>"$RESULTS"
    done
done

echo
echo "=== what each owner was expected to do ==="
while IFS='|' read -r owner case first second; do
    expected="$(expected_outcome_of "$owner" "$case")"
    if [ -z "$expected" ]; then
        continue
    fi
    if [[ "$first" == reverted* ]]; then
        observed="on its own"
    elif [[ "$second" == reverted* ]]; then
        observed="at the next deploy"
    else
        observed="never"
    fi
    assert_eq "${owner} puts the ${case} fix back: ${expected}" "$expected" "$observed"
done <"$RESULTS"

# The same table as the CI job's summary.
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
        echo "### GitOps controllers against OneUptime AI's kubectl fixes"
        echo
        echo "Argo CD ${ARGOCD_VERSION}, Flux ${FLUX_VERSION}, Helm $(helm version --short 2>/dev/null). Flux intervals ${FLUX_INTERVAL_SECONDS}s; watched ${OBSERVE_SECONDS}s on their own, then ${NEXT_DEPLOY_OBSERVE_SECONDS}s after the next deploy."
        echo
        echo "| owner | fix | on its own | after the next deploy |"
        echo "| --- | --- | --- | --- |"
        while IFS='|' read -r owner case first second; do
            echo "| ${owner} | ${case} | ${first} | ${second} |"
        done <"$RESULTS"
    } >>"$GITHUB_STEP_SUMMARY"
fi

harness_report
