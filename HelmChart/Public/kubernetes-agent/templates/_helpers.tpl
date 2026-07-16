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

{{/*
Platform capabilities, derived from the preset.

hostPath is what separates the presets: GKE Autopilot and EKS Fargate reject it,
which is why they collect pod logs through the Kubernetes API instead. But only
SOME of the node collector needs hostPath — filelog needs /var/log/pods and
hostmetrics needs /proc and /sys, while kubeletstats and the cAdvisor scrape
just talk to the kubelet over the network. Modelling the capability instead of
the log mode is what lets those clusters keep their node metrics.
Usage: {{- if eq (include "kubernetes-agent.hostPathAvailable" .) "true" }}
*/}}
{{- define "kubernetes-agent.hostPathAvailable" -}}
{{- $preset := default "" .Values.preset -}}
{{- if or (eq $preset "gke-autopilot") (eq $preset "eks-fargate") -}}
false
{{- else -}}
true
{{- end -}}
{{- end -}}

{{/*
Whether a DaemonSet can run at all. EKS Fargate schedules each pod onto its own
micro-VM and has no notion of a node you can place one pod per — DaemonSets are
silently never scheduled there. Everywhere else, including Autopilot, they run.
*/}}
{{- define "kubernetes-agent.daemonSetSchedulable" -}}
{{- if eq (default "" .Values.preset) "eks-fargate" -}}
false
{{- else -}}
true
{{- end -}}
{{- end -}}

{{/*
Does the node collector DaemonSet need to exist?

It carries two independent jobs, and either one is reason enough to run it:
  - pod logs, when logs are on AND the resolved mode is daemonset, and
  - node metrics: kubeletstats (no off switch), the cAdvisor scrape, hostmetrics.

These used to share one gate keyed on logs alone, so `logs.enabled=false` — or
any preset that resolved the log mode to `api` — silently took every node, pod
and container metric with it, along with the OOM-kill, CPU-throttling and
PVC-low-disk monitors.
*/}}
{{- define "kubernetes-agent.daemonSetLogsEnabled" -}}
{{- if and .Values.logs.enabled (eq (include "kubernetes-agent.logMode" .) "daemonset") (eq (include "kubernetes-agent.hostPathAvailable" .) "true") -}}
true
{{- else -}}
false
{{- end -}}
{{- end -}}

{{/*
Node metrics are wanted whenever a DaemonSet can run and at least one node-local
metric source is on. kubeletstats has no enable flag — it is the core node / pod
/ container metric source — so this is true unless the platform cannot schedule
a DaemonSet.
*/}}
{{- define "kubernetes-agent.daemonSetMetricsEnabled" -}}
{{- if eq (include "kubernetes-agent.daemonSetSchedulable" .) "true" -}}
true
{{- else -}}
false
{{- end -}}
{{- end -}}

{{- define "kubernetes-agent.daemonSetEnabled" -}}
{{- if and (eq (include "kubernetes-agent.daemonSetSchedulable" .) "true") (or (eq (include "kubernetes-agent.daemonSetLogsEnabled" .) "true") (eq (include "kubernetes-agent.daemonSetMetricsEnabled" .) "true")) -}}
true
{{- else -}}
false
{{- end -}}
{{- end -}}

{{/*
hostmetrics reads the host's /proc and /sys through hostPath, so it needs both
the flag and a platform that allows the mount.
*/}}
{{- define "kubernetes-agent.hostMetricsEnabled" -}}
{{- if and .Values.hostMetrics.enabled (eq (include "kubernetes-agent.hostPathAvailable" .) "true") -}}
true
{{- else -}}
false
{{- end -}}
{{- end -}}

{{/*
Telemetry filters — the OTTL conditions behind the `filter/telemetry` processor.

The filter processor DROPS a record when a condition matches, and its
conditions are OR'ed together. Every helper below is written from that
angle: an allowlist is expressed as `not (<matches>)`, a denylist as
`<matches>` directly. Because they OR, listing an include condition and
an exclude condition together yields "drop unless included, and also drop
if excluded" — i.e. exclude wins, which is the same precedence
`namespaceFilters` already documents.

Every namespace condition is guarded with `!= nil`. Node- and
cluster-level series carry no namespace at all, and in OTTL
`nil != "production"` is TRUE — so an unguarded allowlist would silently
delete every node metric. The guard also decides the tie-break for
records we cannot classify: they are KEPT, never dropped.

Metric name matching targets otel-collector-contrib 0.96.0 (see
.Values.image.tag): `IsMatch` and the `metric` / `datapoint` OTTL
contexts all exist there. Keep this file in step with that pin.
*/}}

{{/*
OTTL disjunction over metric names: `name == "a" or IsMatch(name, "b")`.
%q emits a Go-quoted string, so a regexp written as `^system\.cpu` in
values.yaml reaches RE2 as `\.` (a literal dot) rather than an invalid
OTTL escape.
Args: dict "names" (list) "matchType" ("strict" | "regexp")
*/}}
{{- define "kubernetes-agent.metricNameDisjunction" -}}
{{- $matchType := .matchType | default "strict" -}}
{{- $parts := list -}}
{{- range .names -}}
{{- if eq $matchType "regexp" -}}
{{- $parts = append $parts (printf "IsMatch(name, %q)" .) -}}
{{- else -}}
{{- $parts = append $parts (printf "name == %q" .) -}}
{{- end -}}
{{- end -}}
{{- join " or " $parts -}}
{{- end -}}

{{/*
OTTL disjunction over namespaces at a given path.
Args: dict "namespaces" (list) "path" (OTTL path expression)
*/}}
{{- define "kubernetes-agent.nsDisjunction" -}}
{{- $path := .path -}}
{{- $parts := list -}}
{{- range .namespaces -}}
{{- $parts = append $parts (printf "%s == %q" $path .) -}}
{{- end -}}
{{- join " or " $parts -}}
{{- end -}}

{{/*
Log-record conditions. Severity only — pod logs are already scoped by
namespace at the receiver (filelog path globs / the API tailer), so
re-filtering them here would cost CPU to drop nothing.
*/}}
{{- define "kubernetes-agent.filterLogConditions" -}}
{{- $sev := (((.Values.filters).logs).minSeverity) | default "" -}}
{{- $conds := list -}}
{{- if $sev -}}
{{- $conds = append $conds (printf "severity_number != SEVERITY_NUMBER_UNSPECIFIED and severity_number < SEVERITY_NUMBER_%s" (upper $sev)) -}}
{{- end -}}
{{- toJson $conds -}}
{{- end -}}

{{/*
Metric-context conditions: metric-name allow/deny, plus namespace for
receivers that put the namespace on the RESOURCE (kubeletstats,
k8s_cluster).
*/}}
{{- define "kubernetes-agent.filterMetricConditions" -}}
{{- $fm := (.Values.filters).metrics | default dict -}}
{{- $ns := .Values.namespaceFilters | default dict -}}
{{- $mt := $fm.matchType | default "strict" -}}
{{- $inc := $fm.include | default list | compact -}}
{{- $exc := $fm.exclude | default list | compact -}}
{{- $conds := list -}}
{{- if $inc -}}
{{- $conds = append $conds (printf "not (%s)" (include "kubernetes-agent.metricNameDisjunction" (dict "names" $inc "matchType" $mt))) -}}
{{- end -}}
{{- if $exc -}}
{{- $conds = append $conds (include "kubernetes-agent.metricNameDisjunction" (dict "names" $exc "matchType" $mt)) -}}
{{- end -}}
{{- if (($ns.applyTo).metrics) -}}
{{- $p := "resource.attributes[\"k8s.namespace.name\"]" -}}
{{- $nsExc := $ns.exclude | default list | compact -}}
{{- $nsInc := $ns.include | default list | compact -}}
{{- if $nsExc -}}
{{- $conds = append $conds (printf "%s != nil and (%s)" $p (include "kubernetes-agent.nsDisjunction" (dict "namespaces" $nsExc "path" $p))) -}}
{{- end -}}
{{- if $nsInc -}}
{{- $conds = append $conds (printf "%s != nil and not (%s)" $p (include "kubernetes-agent.nsDisjunction" (dict "namespaces" $nsInc "path" $p))) -}}
{{- end -}}
{{- end -}}
{{- toJson $conds -}}
{{- end -}}

{{/*
Datapoint-context conditions: namespace only, for Prometheus-scraped
metrics (cAdvisor, kube-state-metrics, CoreDNS, mesh, CSI). Those arrive
under a single scrape-target resource with the namespace as a DATAPOINT
label, so the metric-context conditions above never see them — this is
why namespace filtering needs both contexts to actually cover the cluster.
*/}}
{{- define "kubernetes-agent.filterDatapointConditions" -}}
{{- $ns := .Values.namespaceFilters | default dict -}}
{{- $conds := list -}}
{{- if (($ns.applyTo).metrics) -}}
{{- $p := "attributes[\"namespace\"]" -}}
{{- $nsExc := $ns.exclude | default list | compact -}}
{{- $nsInc := $ns.include | default list | compact -}}
{{- if $nsExc -}}
{{- $conds = append $conds (printf "%s != nil and (%s)" $p (include "kubernetes-agent.nsDisjunction" (dict "namespaces" $nsExc "path" $p))) -}}
{{- end -}}
{{- if $nsInc -}}
{{- $conds = append $conds (printf "%s != nil and not (%s)" $p (include "kubernetes-agent.nsDisjunction" (dict "namespaces" $nsInc "path" $p))) -}}
{{- end -}}
{{- end -}}
{{- toJson $conds -}}
{{- end -}}

{{/*
Span-context conditions: namespace only. eBPF spans are already scoped at
OBI discovery, so this exists for spans pushed to the agent's own OTLP
endpoint by your applications.
*/}}
{{- define "kubernetes-agent.filterSpanConditions" -}}
{{- $ns := .Values.namespaceFilters | default dict -}}
{{- $conds := list -}}
{{- if (($ns.applyTo).traces) -}}
{{- $p := "resource.attributes[\"k8s.namespace.name\"]" -}}
{{- $nsExc := $ns.exclude | default list | compact -}}
{{- $nsInc := $ns.include | default list | compact -}}
{{- if $nsExc -}}
{{- $conds = append $conds (printf "%s != nil and (%s)" $p (include "kubernetes-agent.nsDisjunction" (dict "namespaces" $nsExc "path" $p))) -}}
{{- end -}}
{{- if $nsInc -}}
{{- $conds = append $conds (printf "%s != nil and not (%s)" $p (include "kubernetes-agent.nsDisjunction" (dict "namespaces" $nsInc "path" $p))) -}}
{{- end -}}
{{- end -}}
{{- toJson $conds -}}
{{- end -}}

{{/*
Per-signal predicates. A pipeline must only reference `filter/telemetry`
when that signal actually has conditions: the filter processor rejects a
config where it is wired into a pipeline whose signal it has no rules for.
Usage: {{- if eq (include "kubernetes-agent.logFiltersEnabled" .) "true" }}
*/}}
{{- define "kubernetes-agent.logFiltersEnabled" -}}
{{- gt (len (include "kubernetes-agent.filterLogConditions" . | fromJsonArray)) 0 -}}
{{- end -}}

{{- define "kubernetes-agent.metricFiltersEnabled" -}}
{{- or (gt (len (include "kubernetes-agent.filterMetricConditions" . | fromJsonArray)) 0) (gt (len (include "kubernetes-agent.filterDatapointConditions" . | fromJsonArray)) 0) -}}
{{- end -}}

{{- define "kubernetes-agent.traceFiltersEnabled" -}}
{{- gt (len (include "kubernetes-agent.filterSpanConditions" . | fromJsonArray)) 0 -}}
{{- end -}}

{{/*
The `filter/telemetry` processor block itself. Emitted only for the
signals that have conditions AND that the calling collector actually runs
a pipeline for — the DaemonSet has no traces pipeline, so emitting span
rules there would be config that can never fire.
Single-quoted YAML keeps OTTL's own double quotes literal; internal single
quotes are doubled per the YAML spec.
Args: dict "root" $ "signals" (list "logs" "metrics" "traces")
*/}}
{{- define "kubernetes-agent.filterProcessor" -}}
{{- $root := .root -}}
{{- $signals := .signals -}}
{{- $logConds := list -}}
{{- if has "logs" $signals -}}
{{- $logConds = include "kubernetes-agent.filterLogConditions" $root | fromJsonArray -}}
{{- end -}}
{{- $metricConds := list -}}
{{- $dpConds := list -}}
{{- if has "metrics" $signals -}}
{{- $metricConds = include "kubernetes-agent.filterMetricConditions" $root | fromJsonArray -}}
{{- $dpConds = include "kubernetes-agent.filterDatapointConditions" $root | fromJsonArray -}}
{{- end -}}
{{- $spanConds := list -}}
{{- if has "traces" $signals -}}
{{- $spanConds = include "kubernetes-agent.filterSpanConditions" $root | fromJsonArray -}}
{{- end -}}
filter/telemetry:
  # Drops records matching any condition below, before `batch` — so
  # filtered telemetry costs no egress and never reaches OneUptime.
  # Generated from .Values.filters and .Values.namespaceFilters.
  error_mode: ignore
{{- if $logConds }}
  logs:
    log_record:
{{- range $logConds }}
      - '{{ . | replace "'" "''" }}'
{{- end }}
{{- end }}
{{- if or $metricConds $dpConds }}
  metrics:
{{- if $metricConds }}
    metric:
{{- range $metricConds }}
      - '{{ . | replace "'" "''" }}'
{{- end }}
{{- end }}
{{- if $dpConds }}
    datapoint:
{{- range $dpConds }}
      - '{{ . | replace "'" "''" }}'
{{- end }}
{{- end }}
{{- end }}
{{- if $spanConds }}
  traces:
    span:
{{- range $spanConds }}
      - '{{ . | replace "'" "''" }}'
{{- end }}
{{- end }}
{{- end -}}

{{/*
Trace sampling. Reads .Values.sampling.traces.

These deliberately test for nil with `kindIs "invalid"` rather than piping
through `default`: 0 is empty to Go templates, so `percentage | default 100`
would silently rewrite an explicit `percentage: 0` ("keep no traces") into
100 ("keep every trace") — the exact opposite of what was asked for, on the
one setting where being wrong is unrecoverable. Same for `hashSeed: 0`.
*/}}
{{- define "kubernetes-agent.traceSamplingPercentage" -}}
{{- $pct := (((.Values.sampling).traces).percentage) -}}
{{- if kindIs "invalid" $pct -}}
100
{{- else -}}
{{- $pct -}}
{{- end -}}
{{- end -}}

{{- define "kubernetes-agent.traceSamplingHashSeed" -}}
{{- $seed := (((.Values.sampling).traces).hashSeed) -}}
{{- if kindIs "invalid" $seed -}}
22
{{- else -}}
{{- $seed -}}
{{- end -}}
{{- end -}}

{{/*
Whether to emit `probabilistic_sampler` at all.

At 100 the sampler is a no-op, so we leave it out entirely and render the
same config as an install that has never heard of sampling. Gated on
ebpf.enabled too: the traces pipeline only exists there, and a processor
configured but referenced by no pipeline is config the collector can never
run — the same reason `filter/telemetry` is gated this way.
Usage: {{- if eq (include "kubernetes-agent.traceSamplingEnabled" .) "true" }}
*/}}
{{- define "kubernetes-agent.traceSamplingEnabled" -}}
{{- $pct := float64 (include "kubernetes-agent.traceSamplingPercentage" .) -}}
{{- and (.Values.ebpf.enabled | default false) (lt $pct 100.0) -}}
{{- end -}}
