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
