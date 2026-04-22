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
