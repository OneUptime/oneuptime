{{/*
Expand the name of the chart.
*/}}
{{- define "kubernetes-agent.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "kubernetes-agent.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "kubernetes-agent.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "kubernetes-agent.labels" -}}
helm.sh/chart: {{ include "kubernetes-agent.chart" . }}
{{ include "kubernetes-agent.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: oneuptime
{{- end }}

{{/*
Selector labels
*/}}
{{- define "kubernetes-agent.selectorLabels" -}}
app.kubernetes.io/name: {{ include "kubernetes-agent.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Service account name
*/}}
{{- define "kubernetes-agent.serviceAccountName" -}}
{{- if .Values.serviceAccount.name }}
{{- .Values.serviceAccount.name }}
{{- else }}
{{- include "kubernetes-agent.fullname" . }}
{{- end }}
{{- end }}

{{/*
Build the OTEL_EBPF_METRICS_FEATURES env var value from .Values.ebpf.features
toggles. Returns a comma-separated string of the OBI feature names that are
currently enabled. Empty list -> empty string (OBI then exports no metrics).
*/}}
{{- define "kubernetes-agent.ebpfMetricsFeatures" -}}
{{- $features := list -}}
{{- if .Values.ebpf.features.httpMetrics -}}{{- $features = append $features "application" -}}{{- end -}}
{{- if .Values.ebpf.features.spanMetrics -}}{{- $features = append $features "application_span" -}}{{- end -}}
{{- if .Values.ebpf.features.serviceGraph -}}{{- $features = append $features "application_service_graph" -}}{{- end -}}
{{- if .Values.ebpf.features.hostMetrics -}}{{- $features = append $features "application_host" -}}{{- end -}}
{{- if .Values.ebpf.features.networkMetrics -}}{{- $features = append $features "network" -}}{{- end -}}
{{- if .Values.ebpf.features.networkInterZoneMetrics -}}{{- $features = append $features "network_inter_zone" -}}{{- end -}}
{{- if .Values.ebpf.features.tcpStats -}}{{- $features = append $features "stats" -}}{{- end -}}
{{- join "," $features -}}
{{- end }}

{{/*
Render .Values.oneuptime.labels as OTel resource-processor attribute entries.

The OneUptime ingest pipeline promotes any resource attribute prefixed with
`oneuptime.label.` into a project Label of the form `<key>:<value>` and
attaches it to the cluster/service/host that emitted the record — see
Common/Server/Utils/Telemetry/OneuptimeLabel.ts.

Pass the action ("insert" or "upsert") so the caller can match the surrounding
processor's existing semantics:
  - "insert" — only set if the attribute is absent (use in pipelines that
    forward telemetry the in-cluster collector didn't originate, e.g. OBI
    traces passing through the metrics Deployment).
  - "upsert" — always set, overwriting any upstream value.

Usage:
  {{- include "kubernetes-agent.oneuptimeLabels" (dict "labels" .Values.oneuptime.labels "action" "insert") | nindent 10 }}
*/}}
{{- define "kubernetes-agent.oneuptimeLabels" -}}
{{- $action := .action | default "insert" -}}
{{- range $key, $value := .labels }}
- key: oneuptime.label.{{ $key }}
  value: {{ $value | quote }}
  action: {{ $action }}
{{- end }}
{{- end }}

{{/*
Parse a Kubernetes memory quantity into an integer number of mebibytes (MiB),
rounded down. Supports the binary (Ki/Mi/Gi/Ti) and decimal (k/K/M/G/T)
suffixes Kubernetes accepts, plus a plain byte count with no suffix. Arithmetic
goes through sprig's float helpers (mulf/divf coerce their string args to
float64), so fractional quantities like "1.5Gi" parse correctly.

  {{ include "kubernetes-agent.memToMib" "512Mi" }}  -> 512
  {{ include "kubernetes-agent.memToMib" "4Gi" }}    -> 4096
*/}}
{{- define "kubernetes-agent.memToMib" -}}
{{- $q := . | toString | trim -}}
{{- $mib := 0.0 -}}
{{- if hasSuffix "Gi" $q -}}
{{- $mib = mulf (trimSuffix "Gi" $q) 1024 -}}
{{- else if hasSuffix "Mi" $q -}}
{{- $mib = mulf (trimSuffix "Mi" $q) 1 -}}
{{- else if hasSuffix "Ki" $q -}}
{{- $mib = divf (trimSuffix "Ki" $q) 1024 -}}
{{- else if hasSuffix "Ti" $q -}}
{{- $mib = mulf (trimSuffix "Ti" $q) 1048576 -}}
{{- else if hasSuffix "G" $q -}}
{{- $mib = divf (mulf (trimSuffix "G" $q) 1000000000) 1048576 -}}
{{- else if hasSuffix "M" $q -}}
{{- $mib = divf (mulf (trimSuffix "M" $q) 1000000) 1048576 -}}
{{- else if hasSuffix "K" $q -}}
{{- $mib = divf (mulf (trimSuffix "K" $q) 1000) 1048576 -}}
{{- else if hasSuffix "k" $q -}}
{{- $mib = divf (mulf (trimSuffix "k" $q) 1000) 1048576 -}}
{{- else -}}
{{- $mib = divf $q 1048576 -}}
{{- end -}}
{{- $mib | floor | int -}}
{{- end }}

{{/*
limit_mib for the OTel memory_limiter: 80% of a container memory limit, in MiB.
Shared by the memory_limiter processor config and the GOMEMLIMIT env var so the
two are derived from the same number and can never drift from the cgroup limit.
Argument: the container memory limit quantity (e.g. "512Mi", "4Gi").
*/}}
{{- define "kubernetes-agent.memLimitMib" -}}
{{- mulf (include "kubernetes-agent.memToMib" .) 0.8 | floor | int -}}
{{- end }}

{{/*
Render the OTel `memory_limiter` processor body (check_interval / limit_mib /
spike_limit_mib) derived from a container memory limit, so limit_mib always
sits *below* the cgroup limit. If the limiter were set above the container
limit the kernel would OOMKill the pod before the limiter could shed load —
which is exactly the failure this avoids. Follows OTel guidance: limit_mib ≈
80% of the container limit, spike_limit_mib ≈ 20% of limit_mib.

Usage (the include is nindent-ed under the `memory_limiter:` key):
  memory_limiter:
    {{`{{- include "kubernetes-agent.memoryLimiter" "512Mi" | nindent 8 }}`}}
*/}}
{{- define "kubernetes-agent.memoryLimiter" -}}
{{- $hard := include "kubernetes-agent.memLimitMib" . | int -}}
check_interval: 5s
limit_mib: {{ $hard }}
spike_limit_mib: {{ mulf $hard 0.2 | floor | int }}
{{- end }}

{{/*
GOMEMLIMIT value (the Go runtime soft memory limit) for a collector container:
80% of the container memory limit, with the MiB suffix the Go runtime expects.
Matches the memory_limiter's limit_mib so the Go GC starts reclaiming at the
same threshold the limiter begins shedding load, keeping total RSS under the
cgroup limit. Argument: the container memory limit quantity.
*/}}
{{- define "kubernetes-agent.gomemlimit" -}}
{{- printf "%dMiB" (include "kubernetes-agent.memLimitMib" . | int) -}}
{{- end }}

{{/*
Debug sidecar container. Rendered into the metrics Deployment and logs
DaemonSet when .Values.debug.enabled is true.

The agent's collector images are distroless (built FROM scratch) — they ship
only the collector binary, so they have no /bin/sh, bash, or curl and cannot be
`kubectl exec`-ed into. This parks a shell + network-tooling container (default:
nicolaka/netshoot) next to the collector. Combined with the pod's shared
network namespace (every container in a pod shares one), a curl from here
follows the exact egress path — NetworkPolicy, DNS, proxy, TLS — the collector
uses. See values.yaml (debug.*) for the rationale and security trade-offs.

  kubectl exec -it <agent-pod> -c debug -- bash
  curl -v "$ONEUPTIME_URL/otlp/v1/metrics"

Usage (nindent to the `containers:` list-item column):
  {{- include "kubernetes-agent.debugContainer" . | nindent 8 }}
*/}}
{{- define "kubernetes-agent.debugContainer" -}}
- name: debug
  image: "{{ .Values.debug.image.repository }}:{{ .Values.debug.image.tag }}"
  imagePullPolicy: {{ .Values.debug.image.pullPolicy }}
  {{- with .Values.debug.command }}
  # netshoot's default entrypoint is an interactive shell, which exits
  # immediately (CrashLoop) in a pod with no TTY — so park it on a no-op.
  command:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  {{- with .Values.debug.securityContext }}
  securityContext:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  resources:
    {{- toYaml .Values.debug.resources | nindent 4 }}
  {{- with .Values.oneuptime.url }}
  env:
    # Convenience for `curl "$ONEUPTIME_URL/otlp/v1/metrics"`.
    - name: ONEUPTIME_URL
      value: {{ . | quote }}
  {{- end }}
{{- end }}

{{/*
Effective log collection mode.

Resolution order:
  1. Explicit .Values.logs.mode ("daemonset" | "api" | "disabled") always wins.
  2. Otherwise .Values.preset decides:
       "gke-autopilot" / "eks-fargate" -> api
       "standard" / "" / unset         -> daemonset
  3. Anything else falls back to "daemonset".
*/}}
{{- define "kubernetes-agent.logMode" -}}
{{- $explicit := default "" .Values.logs.mode -}}
{{- if $explicit -}}
{{- $explicit -}}
{{- else -}}
{{- $preset := default "" .Values.preset -}}
{{- if or (eq $preset "gke-autopilot") (eq $preset "eks-fargate") -}}
api
{{- else -}}
daemonset
{{- end -}}
{{- end -}}
{{- end }}
