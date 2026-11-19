{{/*
THE CIS KUBERNETES BENCHMARK'S NODE AND CONTROL PLANE CONTROLS, READ ON THE
NODES BY KUBE-BENCH (compliance.nodeBenchmark, off by default).

What the Kubernetes API shows is scored without it. The rest of the benchmark
- the control plane's and the kubelet's flags and configuration files, and
their permissions - can only be read on the nodes, so kube-bench
(aquasecurity/kube-bench) runs there, on a schedule, one pod per node group
and, where the cluster runs its own control plane, one on a control plane
node (templates/node-benchmark.yaml).

Each pod hands OneUptime only each check's number and result, never the
benchmark's text, as its container's termination message: the pod's status,
which the agent's resource snapshots already carry (resourceSpecs). No pod of
it holds a Kubernetes API token, and a NetworkPolicy keeps it off the network.

The helpers here decide whether it runs, which benchmark it scores and what
it mounts. Each reads its values through `default dict`, so a release
upgraded with --reuse-values from a chart without them renders with it off.
*/}}

{{/* compliance.nodeBenchmark, or an empty dict for a release from before it. */}}
{{- define "kubernetes-agent.nodeBenchmarkValues" -}}
{{- toYaml ((.Values.compliance | default dict).nodeBenchmark | default dict) -}}
{{- end -}}

{{/*
Why kube-bench is left out of this release, as one word, or nothing when it
runs. NOTES.txt says each:
  off            - compliance.nodeBenchmark.enabled is false, the default.
  resource-specs - resourceSpecs.enabled is false: nothing would carry its
                   results to OneUptime, which reads them off the pods.
  no-host-access - gke-autopilot, eks-fargate and openshift-restricted admit no
                   pod that reads the node's files or shares its processes
                   (kubernetes-agent.hostPathAvailable).
  openshift      - OpenShift's benchmark (rh-1.x) reads the cluster through
                   `oc` with a cluster reader's rights, which this pod never
                   has: OpenShift's Compliance Operator scores it instead.
  rancher        - k3s and RKE2 keep their flags in the node's journal and in
                   Rancher's own paths, which this pod does not read. Set
                   compliance.nodeBenchmark.benchmark to cis-1.12 to run the
                   generic benchmark there anyway.
Usage: {{- $leftOut := include "kubernetes-agent.nodeBenchmarkLeftOut" . }}
*/}}
{{- define "kubernetes-agent.nodeBenchmarkLeftOut" -}}
{{- $values := include "kubernetes-agent.nodeBenchmarkValues" . | fromYaml -}}
{{- $preset := default "" .Values.preset -}}
{{- $benchmark := default "auto" $values.benchmark -}}
{{- $kubeVersion := .Capabilities.KubeVersion.Version -}}
{{- if not $values.enabled -}}
off
{{- else if not (.Values.resourceSpecs | default dict).enabled -}}
resource-specs
{{- else if ne (include "kubernetes-agent.hostPathAvailable" .) "true" -}}
no-host-access
{{- else if eq (include "kubernetes-agent.openshift" .) "true" -}}
openshift
{{- else if and (eq $benchmark "auto") (or (contains "+k3s" $kubeVersion) (contains "+rke2" $kubeVersion)) -}}
rancher
{{- end -}}
{{- end -}}

{{/* Whether kube-bench runs in this release: "true" or "false". */}}
{{- define "kubernetes-agent.nodeBenchmarkEnabled" -}}
{{- if eq (include "kubernetes-agent.nodeBenchmarkLeftOut" .) "" -}}
true
{{- else -}}
false
{{- end -}}
{{- end -}}

{{/*
The benchmark kube-bench scores. "auto" reads the platform off the cluster's
Kubernetes version, as kube-bench does: EKS's carries "-eks-" and GKE's
"-gke.", which take the CIS Amazon EKS and GKE Benchmarks' newest that
kube-bench ships; AKS's version names no provider, so AKS takes aks-1.8 only
when it is set. Anything else is scored against the generic benchmark,
cis-1.12, which numbers its controls as OneUptime's CIS Kubernetes Benchmark
v2.0 does. Always passed to kube-bench, never left to its own guess: without
the API it cannot tell the platform, and from Kubernetes 1.35 it falls back to
eks-1.5.0 on EKS.
*/}}
{{- define "kubernetes-agent.nodeBenchmarkName" -}}
{{- $values := include "kubernetes-agent.nodeBenchmarkValues" . | fromYaml -}}
{{- $benchmark := default "auto" $values.benchmark -}}
{{- $kubeVersion := .Capabilities.KubeVersion.Version -}}
{{- if ne $benchmark "auto" -}}
{{- $benchmark -}}
{{- else if contains "-eks-" $kubeVersion -}}
eks-1.8.0
{{- else if contains "-gke." $kubeVersion -}}
gke-1.9.0
{{- else -}}
cis-1.12
{{- end -}}
{{- end -}}

{{/*
The benchmark's family: cis, eks, gke or aks. EKS, GKE and AKS run the
cluster's control plane themselves; their benchmarks score the worker nodes,
and leave the rest to the provider.
*/}}
{{- define "kubernetes-agent.nodeBenchmarkFamily" -}}
{{- $benchmark := include "kubernetes-agent.nodeBenchmarkName" . -}}
{{- if hasPrefix "eks-" $benchmark -}}
eks
{{- else if hasPrefix "gke-" $benchmark -}}
gke
{{- else if hasPrefix "aks-" $benchmark -}}
aks
{{- else -}}
cis
{{- end -}}
{{- end -}}

{{/*
Whether kube-bench also runs on a control plane node, for the API server's,
the controller manager's, the scheduler's and etcd's controls: "auto" does
where the cluster runs its own control plane, that is unless the benchmark is
a managed platform's, whose control plane no pod reaches.
*/}}
{{- define "kubernetes-agent.nodeBenchmarkControlPlane" -}}
{{- $values := include "kubernetes-agent.nodeBenchmarkValues" . | fromYaml -}}
{{- /* Not `default`: it would read false as unset. */ -}}
{{- $setting := "auto" -}}
{{- if and (hasKey $values "controlPlane") (not (kindIs "invalid" $values.controlPlane)) -}}
{{- $setting = toString $values.controlPlane -}}
{{- end -}}
{{- if eq $setting "true" -}}
true
{{- else if eq $setting "false" -}}
false
{{- else if eq (include "kubernetes-agent.nodeBenchmarkFamily" .) "cis" -}}
true
{{- else -}}
false
{{- end -}}
{{- end -}}

{{/* The image, by its digest when one is set: the one somebody reviewed. */}}
{{- define "kubernetes-agent.nodeBenchmarkImage" -}}
{{- $values := include "kubernetes-agent.nodeBenchmarkValues" . | fromYaml -}}
{{- $image := $values.image | default dict -}}
{{- $repository := default "docker.io/aquasec/kube-bench" $image.repository -}}
{{- if $image.digest -}}
{{- printf "%s@%s" $repository $image.digest -}}
{{- else -}}
{{- printf "%s:%s" $repository (toString (default "v0.16.0" $image.tag)) -}}
{{- end -}}
{{- end -}}

{{/*
A node group's CronJob name, "<fullname>-kube-bench-<group>": at most 52
characters, which a CronJob's name may be so the Jobs it makes take a name
too. Only a long release name is cut, never the group's.
Usage: {{ include "kubernetes-agent.nodeBenchmarkCronJobName" (dict "root" . "group" "workers") }}
*/}}
{{- define "kubernetes-agent.nodeBenchmarkCronJobName" -}}
{{- $prefix := include "kubernetes-agent.fullname" .root | trunc (int (sub 40 (len .group))) | trimSuffix "-" -}}
{{- printf "%s-kube-bench-%s" $prefix .group -}}
{{- end -}}

{{- define "kubernetes-agent.nodeBenchmarkServiceAccountName" -}}
{{- printf "%s-node-benchmark" (include "kubernetes-agent.fullname" .) -}}
{{- end -}}

{{/*
The host directories kube-bench reads, all read-only, and only those its
benchmark's checks look in:
  /etc/kubernetes   the kubelet's kubeconfig and CA, the static pod
                    manifests and, on a control plane node, the cluster's
                    certificates, their private keys and admin.conf;
  /var/lib/kubelet  the kubelet's configuration, beside every pod's mounted
                    volumes on the node, Secrets and service account tokens
                    among them;
  /etc/systemd      the kubelet's systemd unit and drop-ins;
  /lib/systemd      the kubelet's unit where the distribution keeps it there
                    (the generic benchmark);
  /home/kubernetes  GKE's kubelet configuration (gke);
  /etc/default      AKS's kubelet flags and configuration (aks);
and on a control plane node, the generic benchmark's control plane checks:
  /var/lib/etcd     etcd's data directory, whose permissions and owner it checks;
  /etc/passwd, /etc/group
                    so the owner it reports is the node's own name for it.
Usage: {{ include "kubernetes-agent.nodeBenchmarkHostPaths" (dict "root" . "controlPlane" true) }}
*/}}
{{- define "kubernetes-agent.nodeBenchmarkHostPaths" -}}
{{- $family := include "kubernetes-agent.nodeBenchmarkFamily" .root -}}
{{- $paths := list (dict "name" "etc-kubernetes" "path" "/etc/kubernetes") (dict "name" "var-lib-kubelet" "path" "/var/lib/kubelet") (dict "name" "etc-systemd" "path" "/etc/systemd") -}}
{{- if eq $family "cis" -}}
{{- $paths = append $paths (dict "name" "lib-systemd" "path" "/lib/systemd") -}}
{{- end -}}
{{- if eq $family "gke" -}}
{{- $paths = append $paths (dict "name" "home-kubernetes" "path" "/home/kubernetes") -}}
{{- end -}}
{{- if eq $family "aks" -}}
{{- $paths = append $paths (dict "name" "etc-default" "path" "/etc/default") -}}
{{- end -}}
{{- if and .controlPlane (eq $family "cis") -}}
{{- $paths = append $paths (dict "name" "var-lib-etcd" "path" "/var/lib/etcd") -}}
{{- $paths = append $paths (dict "name" "etc-passwd" "path" "/etc/passwd" "type" "File") -}}
{{- $paths = append $paths (dict "name" "etc-group" "path" "/etc/group" "type" "File") -}}
{{- end -}}
{{- toYaml (dict "paths" $paths) -}}
{{- end -}}

{{/*
What the container runs. kube-bench picks the targets this node runs itself:
the control plane's checks only where the API server runs, and etcd's only
where etcd does, so an external etcd is never failed for its absence. Its
JSON is then cut to what OneUptime scores - each check's number by its
result, scored or not, and never the benchmark's text, which CIS licenses for
non-commercial use - and written as the container's termination message,
which the kubelet keeps in the pod's status (4 KB at most; a control plane
node's comes to well under 1 KB). The policies kube-bench would check are the
Kubernetes API's, which OneUptime scores from the agent's own snapshots.

A run kube-bench could not finish writes why, and fails the pod.
*/}}
{{- define "kubernetes-agent.nodeBenchmarkScript" -}}
set -u
result=/tmp/kube-bench.json
log=/tmp/kube-bench.log
summary='[.Controls[]? | select(.node_type == "master" or .node_type == "etcd" or .node_type == "controlplane" or .node_type == "node")] as $controls
| [$controls[] | .tests[]? | .results[]?] as $results
| def ids(f): [$results[] | select(f) | .test_number | tostring] | unique_by(split(".") | map(tonumber? // 0)) | join(" ");
{oneuptimeNodeBenchmark: 1, benchmark: ($controls[0].version // env.BENCHMARK), targets: ([$controls[].node_type] | join(" ")),
 pass: ids(.scored == true and .status == "PASS"), fail: ids(.scored == true and .status == "FAIL"),
 warn: ids(.scored == true and (.status == "WARN" or .status == "INFO")), manual: ids(.scored != true)}'
if kube-bench --benchmark "$BENCHMARK" --json --outputfile "$result" >"$log" 2>&1 \
  && [ -s "$result" ] && jq -c "$summary" "$result" >/dev/termination-log 2>>"$log"; then
  cat /dev/termination-log
  exit 0
fi
tail -c 2000 "$log"
tail -n 5 "$log" | jq -Rsc '{oneuptimeNodeBenchmark: 1, benchmark: env.BENCHMARK, error: (gsub("\\s+"; " ") | .[0:300])}' >/dev/termination-log
exit 1
{{- end -}}

{{/*
One node group's CronJob, or the control plane's.
Usage: {{ include "kubernetes-agent.nodeBenchmarkCronJob" (dict "root" . "group" $group "controlPlane" false) }}
*/}}
{{- define "kubernetes-agent.nodeBenchmarkCronJob" -}}
{{- $root := .root -}}
{{- $values := include "kubernetes-agent.nodeBenchmarkValues" $root | fromYaml -}}
{{- $group := .group -}}
{{- $groupName := ternary "control-plane" $group.name .controlPlane -}}
{{- $hostPaths := (include "kubernetes-agent.nodeBenchmarkHostPaths" (dict "root" $root "controlPlane" .controlPlane) | fromYaml).paths -}}
{{- $nodeSelector := ternary (dict) ($group.nodeSelector | default dict) .controlPlane -}}
apiVersion: batch/v1
kind: CronJob
metadata:
  name: {{ include "kubernetes-agent.nodeBenchmarkCronJobName" (dict "root" $root "group" $groupName) }}
  namespace: {{ $root.Release.Namespace }}
  labels:
    {{- include "kubernetes-agent.labels" $root | nindent 4 }}
    component: node-benchmark
    oneuptime.com/node-group: {{ $groupName }}
spec:
  schedule: {{ default "37 */6 * * *" $values.schedule | quote }}
  {{- with $values.timeZone }}
  timeZone: {{ . | quote }}
  {{- end }}
  # One run at a time, and none started late: the next one is hours away.
  concurrencyPolicy: Forbid
  startingDeadlineSeconds: 3600
  # The last run's pod holds its results, so it is kept until the next one
  # finishes, and the last failed one says why.
  successfulJobsHistoryLimit: 1
  failedJobsHistoryLimit: 1
  jobTemplate:
    metadata:
      labels:
        {{- include "kubernetes-agent.labels" $root | nindent 8 }}
        component: node-benchmark
        oneuptime.com/node-group: {{ $groupName }}
    spec:
      backoffLimit: 0
      activeDeadlineSeconds: {{ default 600 $values.activeDeadlineSeconds }}
      template:
        metadata:
          labels:
            {{- include "kubernetes-agent.labels" $root | nindent 12 }}
            component: node-benchmark
            oneuptime.com/node-group: {{ $groupName }}
        spec:
          serviceAccountName: {{ include "kubernetes-agent.nodeBenchmarkServiceAccountName" $root }}
          # It reads files and processes, never the Kubernetes API.
          automountServiceAccountToken: false
          enableServiceLinks: false
          # The kubelet's and the control plane's processes, whose flags the
          # benchmark checks: ps reads them from the node's /proc.
          hostPID: true
          restartPolicy: Never
          securityContext:
            seccompProfile:
              type: RuntimeDefault
          nodeSelector:
            {{- include "kubernetes-agent.nodeSelector" $nodeSelector | nindent 12 }}
          {{- if .controlPlane }}
          affinity:
            nodeAffinity:
              requiredDuringSchedulingIgnoredDuringExecution:
                nodeSelectorTerms:
                  - matchExpressions:
                      - key: node-role.kubernetes.io/control-plane
                        operator: Exists
                  - matchExpressions:
                      - key: node-role.kubernetes.io/master
                        operator: Exists
          tolerations:
            - key: node-role.kubernetes.io/control-plane
              operator: Exists
              effect: NoSchedule
            - key: node-role.kubernetes.io/master
              operator: Exists
              effect: NoSchedule
          {{- else }}
          {{- with $group.affinity }}
          affinity:
            {{- toYaml . | nindent 12 }}
          {{- else }}
          {{- if not $group.nodeSelector }}
          # A worker where there is one; a cluster of one node runs it on its
          # control plane node, as the control plane's own run does.
          affinity:
            nodeAffinity:
              preferredDuringSchedulingIgnoredDuringExecution:
                - weight: 100
                  preference:
                    matchExpressions:
                      - key: node-role.kubernetes.io/control-plane
                        operator: DoesNotExist
          {{- end }}
          {{- end }}
          {{- with $group.tolerations }}
          tolerations:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- end }}
          containers:
            - name: kube-bench
              image: {{ include "kubernetes-agent.nodeBenchmarkImage" $root | quote }}
              imagePullPolicy: {{ default "IfNotPresent" ($values.image | default dict).pullPolicy }}
              command: ["/bin/sh", "-c"]
              args:
                - |
                  {{- include "kubernetes-agent.nodeBenchmarkScript" $root | nindent 18 }}
              env:
                - name: BENCHMARK
                  value: {{ include "kubernetes-agent.nodeBenchmarkName" $root | quote }}
              terminationMessagePath: /dev/termination-log
              terminationMessagePolicy: File
              # Root, for the files the benchmark checks belong to root. No
              # capability but DAC_OVERRIDE, which lets root read past a
              # directory's or a file's mode (a drop-in directory without the
              # search bit, a file of etcd's): every mount of the node is
              # read-only, so it writes nothing there.
              securityContext:
                runAsUser: 0
                privileged: false
                allowPrivilegeEscalation: false
                readOnlyRootFilesystem: true
                capabilities:
                  drop:
                    - ALL
                  add:
                    - DAC_OVERRIDE
              resources:
                {{- toYaml ($values.resources | default (dict "requests" (dict "cpu" "50m" "memory" "64Mi") "limits" (dict "cpu" "500m" "memory" "256Mi"))) | nindent 16 }}
              volumeMounts:
                - name: tmp
                  mountPath: /tmp
                {{- range $hostPaths }}
                - name: {{ .name }}
                  mountPath: {{ .path }}
                  readOnly: true
                {{- end }}
          volumes:
            # kube-bench's full JSON, before it is cut to the summary.
            - name: tmp
              emptyDir:
                sizeLimit: 32Mi
            {{- range $hostPaths }}
            - name: {{ .name }}
              hostPath:
                path: {{ .path }}
                {{- with .type }}
                type: {{ . }}
                {{- end }}
            {{- end }}
{{- end -}}
