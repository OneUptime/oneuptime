{{/* vim: set filetype=mustache: */}}

{{/*
Expand the name of the chart.
*/}}
{{- define "fyipe.mongodbConnectionString" -}}
{{ printf "mongodb://%s:%s@%s-%s.%s.%s:%s/%s?replicaSet=%s" $.Values.mongodb.auth.username $.Values.mongodb.auth.password $.Release.Name "mongodb-headless" $.Release.Namespace "svc.cluster.local" "27017" $.Values.mongodb.auth.database $.Values.mongodb.replicaSetName }}
{{- end -}}

{{- define "fyipe.internalSmtpServer" -}}
{{ printf "%s-haraka.%s.%s" $.Release.Name $.Release.Namespace "svc.cluster.local" }}
{{- end -}}

{{- define "fyipe.redisHost" -}}
{{ printf "%s-redis-master.%s.%s" $.Release.Name $.Release.Namespace "svc.cluster.local" }}
{{- end -}}

{{- define "fyipe.backendHost" -}}
{{ printf "%s-backend.%s.%s" $.Release.Name $.Release.Namespace "svc.cluster.local" }}
{{- end -}}

{{- define "fyipe.fyipeHost" -}}
{{ printf "%s-backend.%s" $.Values.fyipe.host }}
{{- end -}}

{{- define "fyipe.serverUrl" -}}
{{ printf "http://%s-backend.%s.%s" $.Release.Name $.Release.Namespace "svc.cluster.local" }}
{{- end -}}

{{- define "fyipe.scriptRunnerUrl" -}}
{{ printf "http://%s-script.%s.%s" $.Release.Name $.Release.Namespace "svc.cluster.local" }}
{{- end -}}

{{- define "fyipe.dataIngestorUrl" -}}
{{ printf "http://%s-ingestor.%s.%s" $.Release.Name $.Release.Namespace "svc.cluster.local" }}
{{- end -}}

{{- define "fyipe.realtimeUrl" -}}
{{ printf "http://%s-realtime.%s.%s" $.Release.Name $.Release.Namespace "svc.cluster.local" }}
{{- end -}}