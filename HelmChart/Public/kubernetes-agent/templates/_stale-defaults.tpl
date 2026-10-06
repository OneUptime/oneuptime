{{/*
Whether this release renders with an older chart's defaults, for the warning
at the end of NOTES.txt.

`helm upgrade --reuse-values` renders the new chart with the previous
release's values, and those include the defaults of the chart the release
came from: Helm replaces the new chart's values.yaml with the previous
release's computed values (pkg/action/upgrade.go, reuseValues:
`chart.Values = oldVals`). So a default this chart changed (the OBI image
tag) or added (a new key) never applies. --reset-then-reuse-values (Helm
3.14+) starts from this chart's values.yaml and merges only the values
somebody set (the release's stored config, what `helm get values` prints),
and so does `-f` with that output.

A template only sees the merged values: never which of them somebody set,
and never this chart's own values.yaml once --reuse-values has replaced it
(Helm keeps values.yaml out of .Files). chartDefaultsVersion is how the two
are told apart. values.yaml carries this chart's version in it (the release
pipeline stamps it), so it is .Chart.Version whenever the values come from
this chart's values.yaml, and an older chart's version (or nothing, for a
chart from before the key) when they come from that chart's.

What it cannot tell:
  - A value somebody set on purpose. A release that took this chart's
    defaults (a fresh install, --reset-then-reuse-values, -f) never warns,
    whatever its values pin, so a deliberate pin is never reported. A release
    that kept an older chart's defaults reports a pinned OBI tag the same as
    a carried-over one; the fix keeps a pinned value pinned, so the notes say
    so rather than guessing.
  - A values file that copies an older chart's values.yaml (or `helm get
    values --all`) pins that chart's chartDefaultsVersion with the rest of its
    defaults, and warns on every upgrade until the file keeps only what was
    changed. A copy from a chart before the key does not pin it, and is not
    caught.
  - A chart rendered from a source checkout carries Chart.yaml's version
    (not a release's) on both sides, so an upgrade between two checkouts is
    never stale.

Returns JSON:
  stale              bool    the values come from another chart's values.yaml
  from               string  their chartDefaultsVersion, "" when there is none
  ebpfImageTagStale  bool    stale, eBPF is on, and the OBI tag is not this
                             chart's default
  ebpfImageTag       string  the OBI tag the DaemonSet runs
Usage: {{- $defaults := include "kubernetes-agent.staleDefaults" . | fromJson }}
*/}}
{{- define "kubernetes-agent.staleDefaults" -}}
{{- $from := toString (.Values.chartDefaultsVersion | default "") -}}
{{- $stale := ne $from (toString .Chart.Version) -}}
{{- $ebpf := .Values.ebpf | default dict -}}
{{- /* The test templates/daemonset-ebpf.yaml renders the DaemonSet on. */ -}}
{{- $ebpfOn := false -}}
{{- if $ebpf.enabled -}}
{{- $ebpfOn = true -}}
{{- end -}}
{{- $tag := toString (($ebpf.image | default dict).tag | default "") -}}
{{- $ebpfImageTagStale := and $stale $ebpfOn (ne $tag (include "kubernetes-agent.defaultEbpfImageTag" .)) -}}
{{- dict "stale" $stale "from" $from "ebpfImageTagStale" $ebpfImageTagStale "ebpfImageTag" $tag | toJson -}}
{{- end -}}

{{/*
The OBI image tag this chart's values.yaml pins (ebpf.image.tag). It is here
as well because a template cannot read values.yaml itself (see above). Move it
with values.yaml: tests/stale-defaults-source_test.yaml fails when the two
differ.
*/}}
{{- define "kubernetes-agent.defaultEbpfImageTag" -}}
v0.14.0
{{- end -}}
