{{/*
The Kubernetes AI agent's effective settings, as JSON (read them with
`include "kubernetes-agent.aiAgent.settings" . | fromJson`). One definition
for templates/ai-agent.yaml, which renders the RBAC and the pod, and
templates/NOTES.txt, which describes them, so the two can never disagree.

Every aiAgent.* / aiAccess.* lookup is nil-safe. `helm upgrade --reuse-values`
feeds the templates the PREVIOUS release's coalesced values, not this chart's
values.yaml:
  * a release from a chart before 14.0.2 stores neither aiAgent nor
    aiAccess, so `.Values.aiAgent` is nil, or holds only what --set passed;
  * a release from 14.0.2 to 14.0.8 stores a fully populated aiAccess block
    with that chart's defaults (enabled: false, image oneuptime/runner, ...)
    whether or not anyone set it, and no aiAgent.
A bare `.Values.aiAgent.remediation.enabled` would abort such an upgrade with
"nil pointer evaluating interface {}".

aiAccess (the in-cluster Runner) is carried over by one rule: an explicitly
set aiAgent key wins; otherwise the legacy aiAccess value; otherwise the
default. That is why values.yaml leaves aiAgent.remediation.* and
aiAgent.extraEnv unset (commented keys only): a default there would always
count as "explicitly set" under --reset-then-reuse-values, and a stored
aiAccess setting could then never be carried over, while a set one could
never revoke it.
  enabled             aiAgent.enabled when it is a bool, else true.
                      aiAccess.enabled is NOT read: every 14.0.x release
                      stored `false` whether or not anyone chose it, so it is
                      not an opt-out. A cluster whose AI access was revoked
                      stays off on the server, not here.
  allowWrites         aiAgent.remediation.enabled when it is a bool, else
                      aiAccess.enabled AND aiAccess.remediation.enabled when
                      both are bools, else false. Always false when enabled
                      is off.
  allowNodeOperations allowWrites AND (aiAgent.remediation.nodeOperations when
                      it is a bool, else aiAccess.remediation.nodeOperations
                      when it is a bool, else true). Sprig's `default` treats
                      an explicit false as empty, so kinds are tested instead.
  writeNamespaces     aiAgent.remediation.namespaces when the key is present
                      (an empty list means cluster-wide), else
                      aiAccess.remediation.namespaces when the legacy writes
                      were on, else none (cluster-wide). Empty whenever
                      allowWrites is off, so ONEUPTIME_KUBECTL_WRITE_NAMESPACES
                      always names exactly the RoleBindings rendered.
  extraEnv            aiAgent.extraEnv when the key is present, else
                      aiAccess.extraEnv (an egress proxy, say).
namespacesKey, writesKey and extraEnvKey name the value each setting came
from, so a refusal or a note points at the value to change.
aiAccess.image and aiAccess.resources are never read: on 14.0.x releases they
only ever hold the Runner's image and defaults. tests/ai-agent_test.yaml and
tests/ai-agent-notes_test.yaml render every rule against 14.0.x-shaped values.
*/}}
{{- define "kubernetes-agent.aiAgent.settings" -}}
{{- $aiAgent := .Values.aiAgent | default dict -}}
{{- $aiAccess := .Values.aiAccess | default dict -}}
{{- $remediation := $aiAgent.remediation | default dict -}}
{{- $legacyRemediation := $aiAccess.remediation | default dict -}}
{{- $enabled := true -}}
{{- if kindIs "bool" $aiAgent.enabled }}
{{- $enabled = $aiAgent.enabled -}}
{{- end }}
{{- $legacyWrites := false -}}
{{- if and (kindIs "bool" $aiAccess.enabled) (kindIs "bool" $legacyRemediation.enabled) }}
{{- $legacyWrites = and $aiAccess.enabled $legacyRemediation.enabled -}}
{{- end }}
{{- $allowWrites := $legacyWrites -}}
{{- $writesKey := "aiAccess.remediation.enabled" -}}
{{- if kindIs "bool" $remediation.enabled }}
{{- $allowWrites = $remediation.enabled -}}
{{- $writesKey = "aiAgent.remediation.enabled" -}}
{{- end }}
{{- /*
An agent that is off is granted nothing, so nothing about its writes is
checked either: aiAgent.enabled=false must render nothing, not fail the whole
chart (collector included) over a namespace list no RoleBinding will use.
*/}}
{{- if not $enabled }}
{{- $allowWrites = false -}}
{{- end }}
{{- $nodeOperations := true -}}
{{- if kindIs "bool" $legacyRemediation.nodeOperations }}
{{- $nodeOperations = $legacyRemediation.nodeOperations -}}
{{- end }}
{{- if kindIs "bool" $remediation.nodeOperations }}
{{- $nodeOperations = $remediation.nodeOperations -}}
{{- end }}
{{- $requestedNamespaces := list -}}
{{- $namespacesKey := "aiAgent.remediation.namespaces" -}}
{{- if hasKey $remediation "namespaces" }}
{{- $requestedNamespaces = $remediation.namespaces | default list -}}
{{- else if $legacyWrites }}
{{- $requestedNamespaces = $legacyRemediation.namespaces | default list -}}
{{- $namespacesKey = "aiAccess.remediation.namespaces" -}}
{{- end }}
{{- $writeNamespaces := list -}}
{{- if $allowWrites }}
{{- range $namespace := ($requestedNamespaces | uniq) }}
{{- if eq $namespace $.Release.Namespace }}
{{- fail (printf "%s lists %s, the namespace this chart is installed in. The Kubernetes AI agent never changes its own namespace (a fix there could scale the agent, or the AI agent itself, away), so write access there would only widen what a compromised agent could do. Remove it from the list, or install the chart into a namespace of its own." $namespacesKey $namespace) }}
{{- end }}
{{- $writeNamespaces = append $writeNamespaces $namespace -}}
{{- end }}
{{- end }}
{{- $extraEnv := list -}}
{{- $extraEnvKey := "aiAgent.extraEnv" -}}
{{- if hasKey $aiAgent "extraEnv" }}
{{- $extraEnv = $aiAgent.extraEnv | default list -}}
{{- else }}
{{- $extraEnv = $aiAccess.extraEnv | default list -}}
{{- $extraEnvKey = "aiAccess.extraEnv" -}}
{{- end }}
{{- /* One line: actions that span lines need a Helm built with Go 1.16+. */ -}}
{{- toJson (dict "enabled" $enabled "allowWrites" $allowWrites "writesKey" $writesKey "allowNodeOperations" (and $allowWrites $nodeOperations) "writeNamespaces" $writeNamespaces "namespacesKey" $namespacesKey "extraEnv" $extraEnv "extraEnvKey" $extraEnvKey) -}}
{{- end }}
