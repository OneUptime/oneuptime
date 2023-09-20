{{/* vim: set filetype=mustache: */}}

{{/*
Expand the name of the chart.
*/}}
{{- define "oneuptime.mongodbConnectionString" -}}
{{ printf "mongodb://%s:%s@%s-%s.%s-%s.%s.%s:%s/%s" $.Values.mongo.oneuptimeDbUsername $.Values.mongo.oneuptimeDbPassword  $.Release.Name "mongo-standalone-0" $.Release.Name "mongo-standalone" $.Release.Namespace "svc.cluster.local" "27017" $.Values.mongo.databaseName }}
{{- end -}}

{{- define "oneuptime.internalSmtpServer" -}}
{{ printf "%s-haraka.%s.%s" $.Release.Name $.Release.Namespace "svc.cluster.local" }}
{{- end -}}

{{- define "oneuptime.redisHost" -}}
{{ printf "%s-redis-master.%s.%s" $.Release.Name $.Release.Namespace "svc.cluster.local" }}
{{- end -}}

{{- define "oneuptime.backendHost" -}}
{{ printf "%s-backend.%s.%s" $.Release.Name $.Release.Namespace "svc.cluster.local" }}
{{- end -}}

{{- define "oneuptime.oneuptimeHost" -}}
{{ printf "%s-backend.%s" $.Values.oneuptime.host }}
{{- end -}}

{{- define "oneuptime.serverUrl" -}}
{{ printf "http://%s-backend.%s.%s" $.Release.Name $.Release.Namespace "svc.cluster.local" }}
{{- end -}}

{{- define "oneuptime.probeApiUrl" -}}
{{ printf "http://%s-ProbeAPI.%s.%s" $.Release.Name $.Release.Namespace "svc.cluster.local" }}
{{- end -}}

{{- define "oneuptime.scriptRunnerUrl" -}}
{{ printf "http://%s-script.%s.%s" $.Release.Name $.Release.Namespace "svc.cluster.local" }}
{{- end -}}

{{- define "oneuptime.dataIngestorUrl" -}}
{{ printf "http://%s-ingestor.%s.%s" $.Release.Name $.Release.Namespace "svc.cluster.local" }}
{{- end -}}

{{- define "oneuptime.realtimeUrl" -}}
{{ printf "http://%s-realtime.%s.%s" $.Release.Name $.Release.Namespace "svc.cluster.local" }}
{{- end -}}