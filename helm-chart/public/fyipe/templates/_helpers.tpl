{{/* vim: set filetype=mustache: */}}

{{/*
Expand the name of the chart.
*/}}
{{- define "fyipe.mongodbConnectionString" -}}
{{ printf "mongodb://%s:%s@%s-%s:%s/%s?replicaSet=%s" $.Values.mongodb.mongodbUsername $.Values.mongodb.mongodbPassword $.Release.Name "mongodb.default.svc.cluster.local" "27017" $.Values.mongodb.mongodbDatabase $.Values.mongodb.replicaSet.name }}
{{- end -}}

{{- define "fyipe.redisHost" -}}
{{ printf "%s-redis-master.%s" $.Release.Name "default.svc.cluster.local" }}
{{- end -}}

{{- define "fyipe.backendHost" -}}
{{ printf "%s-backend.%s" $.Release.Name "default.svc.cluster.local" }}
{{- end -}}

{{- define "fyipe.fyipeHost" -}}
{{ printf "%s-backend.%s" $.Values.fyipe.host }}
{{- end -}}

{{- define "fyipe.serverUrl" -}}
{{ printf "http://%s-backend.%s" $.Release.Name "default.svc.cluster.local" }}
{{- end -}}