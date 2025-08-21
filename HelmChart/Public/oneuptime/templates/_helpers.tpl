{{/*
Renders a value that contains a template.
Usage:
{{ include "oneuptime.renderTemplate" ( dict "value" .Values.path.to.the.Value "context" $) }}
*/}}
{{- define "oneuptime.renderTemplate" -}}
    {{- if typeIs "string" .value }}
        {{- tpl .value .context }}
    {{- else }}
        {{- tpl (.value | toYaml) .context }}
    {{- end }}
{{- end -}}

{{- define "oneuptime.env.common" }}
{{- if $.Values.openTelemetryExporter.endpoint }}
- name: OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT
  value: {{ $.Values.openTelemetryExporter.endpoint }}
{{- end }}
{{- if $.Values.openTelemetryExporter.headers }}
- name: OPENTELEMETRY_EXPORTER_OTLP_HEADERS
  value: {{ $.Values.openTelemetryExporter.headers }}
{{- end }}
- name: SLACK_APP_CLIENT_ID
  value: {{ $.Values.slackApp.clientId | quote }}
- name: MICROSOFT_TEAMS_APP_CLIENT_ID
  value: {{ $.Values.microsoftTeamsApp.clientId | quote }}
- name: HOST
  value: {{ $.Values.host }}
- name: STATUS_PAGE_CNAME_RECORD
  value: {{ $.Values.statusPage.cnameRecord }}
- name: ALLOWED_ACTIVE_MONITOR_COUNT_IN_FREE_PLAN
  value: {{ $.Values.billing.allowedActiveMonitorCountInFreePlan | quote }}
- name: OTEL_COLLECTOR_HOST
  value: {{ $.Values.openTelemetryCollectorHost }}
- name: LOG_LEVEL
  value: {{ $.Values.logLevel }}
- name: FLUENTD_HOST
  value: {{ $.Values.fluentdHost }}
- name: HTTP_PROTOCOL
  value: {{ $.Values.httpProtocol }}
- name: NODE_ENV
  value: {{ $.Values.nodeEnvironment }}
- name: BILLING_ENABLED
  value: {{ $.Values.billing.enabled | squote }}
- name: BILLING_PUBLIC_KEY
  value: {{ $.Values.billing.publicKey }}
- name: SUBSCRIPTION_PLAN_BASIC
  value: {{ $.Values.subscriptionPlan.basic }}
- name: SUBSCRIPTION_PLAN_GROWTH
  value: {{ $.Values.subscriptionPlan.growth }}
- name: SUBSCRIPTION_PLAN_SCALE
  value: {{ $.Values.subscriptionPlan.scale }}
- name: SUBSCRIPTION_PLAN_ENTERPRISE
  value: {{ $.Values.subscriptionPlan.enterprise }}
- name: ANALYTICS_KEY
  value: {{ $.Values.analytics.key }}
- name: ANALYTICS_HOST
  value: {{ $.Values.analytics.host }}
- name: VAPID_PUBLIC_KEY
  value: {{ $.Values.vapid.publicKey }}
- name: VAPID_SUBJECT
  value: {{ $.Values.vapid.subject }}
- name: SERVER_ACCOUNTS_HOSTNAME
  value: {{ $.Release.Name }}-accounts.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_SERVER_MONITOR_INGEST_HOSTNAME
  value: {{ $.Release.Name }}-server-monitor-ingest.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_ISOLATED_VM_HOSTNAME
  value: {{ $.Release.Name }}-isolated-vm.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_WORKFLOW_HOSTNAME
  value: {{ $.Release.Name }}-workflow.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_WORKER_HOSTNAME
  value: {{ $.Release.Name }}-worker.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_API_REFERENCE_HOSTNAME
  value: {{ $.Release.Name }}-api-reference.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_HOME_HOSTNAME
  value: {{ $.Release.Name }}-home.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_APP_HOSTNAME
  value: {{ $.Release.Name }}-app.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_PROBE_INGEST_HOSTNAME
  value: {{ $.Release.Name }}-probe-ingest.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: OPEN_TELEMETRY_INGEST_HOSTNAME
  value: {{ $.Release.Name }}-open-telemetry-ingest.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_INCOMING_REQUEST_INGEST_HOSTNAME
  value: {{ $.Release.Name }}-incoming-request-ingest.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_FLUENT_INGEST_HOSTNAME
  value: {{ $.Release.Name }}-fluent-ingest.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_OPEN_TELEMETRY_INGEST_HOSTNAME
  value: {{ $.Release.Name }}-open-telemetry-ingest.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_TEST_SERVER_HOSTNAME
  value: {{ $.Release.Name }}-test-server.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_OTEL_COLLECTOR_HOSTNAME
  value: {{ $.Release.Name }}-otel-collector.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_STATUS_PAGE_HOSTNAME
  value: {{ $.Release.Name }}-status-page.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_DASHBOARD_HOSTNAME
  value: {{ $.Release.Name }}-dashboard.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_ADMIN_DASHBOARD_HOSTNAME
  value: {{ $.Release.Name }}-admin-dashboard.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_DOCS_HOSTNAME
  value: {{ $.Release.Name }}-docs.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}

- name: APP_PORT
  value: {{ $.Values.app.ports.http | squote }}
- name: PROBE_INGEST_PORT
  value: {{ $.Values.probeIngest.ports.http | squote }}
- name: SERVER_MONITOR_INGEST_PORT
  value: {{ $.Values.serverMonitorIngest.ports.http | squote }}
- name: OPEN_TELEMETRY_INGEST_PORT
  value: {{ $.Values.openTelemetryIngest.ports.http | squote }}
- name: INCOMING_REQUEST_INGEST_PORT
  value: {{ $.Values.incomingRequestIngest.ports.http | squote }}
- name: FLUENT_INGEST_PORT
  value: {{ $.Values.fluentIngest.ports.http | squote }}
- name: TEST_SERVER_PORT
  value: {{ $.Values.testServer.ports.http | squote }}
- name: ACCOUNTS_PORT
  value: {{ $.Values.accounts.ports.http | squote }}
- name: ISOLATED_VM_PORT
  value: {{ $.Values.isolatedVM.ports.http | squote }}
- name: HOME_PORT
  value: {{ $.Values.home.ports.http | squote }}
- name: WORKER_PORT
  value: {{ $.Values.worker.ports.http | squote }}
- name: WORKFLOW_PORT
  value: {{ $.Values.workflow.ports.http | squote }}
- name: STATUS_PAGE_PORT
  value: {{ $.Values.statusPage.ports.http | squote }}
- name: DASHBOARD_PORT
  value: {{ $.Values.dashboard.ports.http | squote }}
- name: ADMIN_DASHBOARD_PORT
  value: {{ $.Values.adminDashboard.ports.http | squote }}
- name: API_REFERENCE_PORT
  value: {{ $.Values.apiReference.ports.http | squote }}
- name: DOCS_PORT
  value: {{ $.Values.docs.ports.http | squote }}
{{- end }}


{{- define "oneuptime.env.commonUi" }}
- name: IS_SERVER
  value: {{ printf "false" | squote }}
{{- end }}

{{- define "oneuptime.env.oneuptimeSecret" }}
- name: ONEUPTIME_SECRET
  {{- if $.Values.oneuptimeSecret }}
  value: {{ $.Values.oneuptimeSecret }}
  {{- else }}
  {{- if $.Values.externalSecrets.oneuptimeSecret.existingSecret.name }}
  valueFrom:
    secretKeyRef:
        name: {{ $.Values.externalSecrets.oneuptimeSecret.existingSecret.name }}
        key: {{ $.Values.externalSecrets.oneuptimeSecret.existingSecret.passwordKey }}
  {{- else }}
  valueFrom:
    secretKeyRef:
      name: {{ printf "%s-%s" $.Release.Name "secrets"  }}
      key: oneuptime-secret
  {{- end }}
  {{- end }}
{{- end }}

{{- define "oneuptime.env.commonServer" }}
- name: IS_SERVER
  value: {{ printf "true" | squote }}

- name: VAPID_PRIVATE_KEY
  value: {{ $.Values.vapid.privateKey }}

- name: SLACK_APP_CLIENT_SECRET
  value: {{ $.Values.slackApp.clientSecret }}

- name: SLACK_APP_SIGNING_SECRET
  value: {{ $.Values.slackApp.signingSecret }}

- name: MICROSOFT_TEAMS_APP_CLIENT_SECRET
  value: {{ $.Values.microsoftTeamsApp.clientSecret }}

- name: MICROSOFT_TENANT_ID
  value: {{ $.Values.microsoftTeamsApp.tenantId }}

- name: NOTIFICATION_SLACK_WEBHOOK_ON_CREATED_USER
  value: {{ $.Values.notifications.webhooks.slack.onCreateUser }}

- name: NOTIFICATION_SLACK_WEBHOOK_ON_CREATED_PROJECT
  value: {{ $.Values.notifications.webhooks.slack.onCreateProject }}

- name: NOTIFICATION_SLACK_WEBHOOK_ON_DELETED_PROJECT
  value: {{ $.Values.notifications.webhooks.slack.onDeleteProject }}

- name: NOTIFICATION_SLACK_WEBHOOK_ON_SUBSCRIPTION_UPDATE
  value: {{ $.Values.notifications.webhooks.slack.onSubscriptionUpdate }}

- name: LETS_ENCRYPT_NOTIFICATION_EMAIL
  value: {{ $.Values.letsEncrypt.email }}

- name: LETS_ENCRYPT_ACCOUNT_KEY
  value: {{ $.Values.letsEncrypt.accountKey }}

- name: ENCRYPTION_SECRET
  {{- if $.Values.encryptionSecret }}
  value: {{ $.Values.encryptionSecret }}
  {{- else }}
  {{- if $.Values.externalSecrets.encryptionSecret.existingSecret.name }}
  valueFrom:
    secretKeyRef:
        name: {{ $.Values.externalSecrets.encryptionSecret.existingSecret.name }}
        key: {{ $.Values.externalSecrets.encryptionSecret.existingSecret.passwordKey }}
  {{- else }}
  valueFrom:
    secretKeyRef:
      name: {{ printf "%s-%s" $.Release.Name "secrets"  }}
      key: encryption-secret
  {{- end }}
  {{- end }}

- name: CLICKHOUSE_USER
  {{- if $.Values.clickhouse.enabled }}
  value: {{ $.Values.clickhouse.auth.username }}
  {{- else }}
  value: {{ $.Values.externalClickhouse.username }}
  {{- end }}

- name: CLICKHOUSE_IS_HOST_HTTPS
  {{- if $.Values.clickhouse.enabled }}
  value: {{ false | squote }}
  {{- else }}
  value: {{ $.Values.externalClickhouse.isHostHttps | squote }}
  {{- end }}
- name: CLICKHOUSE_PASSWORD
  {{- if $.Values.clickhouse.enabled }}
  valueFrom:
    secretKeyRef:
        name: {{ printf "%s-%s" $.Release.Name "clickhouse"  }}
        key: admin-password
  {{- else }}
  {{- if $.Values.externalClickhouse.password }}
  valueFrom:
    secretKeyRef:
        name: {{ printf "%s-%s" $.Release.Name "external-clickhouse"  }}
        key: password
  {{- end }}
  {{- if $.Values.externalClickhouse.existingSecret.name }}
  valueFrom:
    secretKeyRef:
        name: {{ printf "%s" $.Values.externalClickhouse.existingSecret.name }}
        key: {{ $.Values.externalClickhouse.existingSecret.passwordKey }}
  {{- end }}
  {{- end }}
- name: CLICKHOUSE_HOST
  {{- if $.Values.clickhouse.enabled }}
  value: {{ $.Release.Name }}-clickhouse.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
  {{- else }}
  value: {{ $.Values.externalClickhouse.host }}
  {{- end }}
- name: CLICKHOUSE_PORT
  {{- if $.Values.clickhouse.enabled }}
  value: {{ printf "%s" $.Values.clickhouse.service.ports.http | squote }}
  {{- else }}
  value: {{ $.Values.externalClickhouse.port | quote }}
  {{- end }}
- name: CLICKHOUSE_DATABASE
  {{- if $.Values.clickhouse.enabled }}
  value: {{ printf "oneuptime" | squote}}
  {{- else }}
  value: {{ $.Values.externalClickhouse.database }}
  {{- end }}


## REDIS SSL BLOCK
{{- if $.Values.clickhouse.enabled }}
# do nothing here.
{{- else }}
{{- if $.Values.externalClickhouse.tls.enabled }}

{{- if $.Values.externalClickhouse.tls.ca }}
- name: CLICKHOUSE_TLS_CA
  valueFrom:
    secretKeyRef:
        name: {{ printf "%s-%s" $.Release.Name "external-clickhouse"  }}
        key: tls-ca
{{- end }}

{{- if $.Values.externalClickhouse.tls.cert }}
- name: CLICKHOUSE_TLS_CERT
  valueFrom:
    secretKeyRef:
        name: {{ printf "%s-%s" $.Release.Name "external-clickhouse"  }}
        key: tls-cert
{{- end }}

{{- if $.Values.externalClickhouse.tls.key }}
- name: CLICKHOUSE_TLS_KEY
  valueFrom:
    secretKeyRef:
        name: {{ printf "%s-%s" $.Release.Name "external-clickhouse"  }}
        key: tls-key
{{- end }}
{{- end }}
{{- end }}





- name: REDIS_HOST
  {{- if $.Values.redis.enabled }}
  value: {{ $.Release.Name }}-redis-master.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
  {{- else }}
  value: {{ $.Values.externalRedis.host }}
  {{- end }}
- name: REDIS_PORT
  {{- if $.Values.redis.enabled }}
  value: {{ printf "%s" $.Values.redis.master.service.ports.redis | quote }}
  {{- else }}
  value: {{ $.Values.externalRedis.port | quote }}
  {{- end }}
- name: REDIS_PASSWORD
  {{- if $.Values.redis.enabled }}
  valueFrom:
    secretKeyRef:
        name: {{ printf "%s-%s" $.Release.Name "redis"  }}
        key: redis-password
  {{- else }}
  {{- if $.Values.externalRedis.password }}
  valueFrom:
    secretKeyRef:
        name: {{ printf "%s-%s" $.Release.Name "external-redis"  }}
        key: password
  {{- end }}
  {{- if $.Values.externalRedis.existingSecret.name }}
  valueFrom:
    secretKeyRef:
        name: {{ printf "%s" $.Values.externalRedis.existingSecret.name }}
        key: {{ $.Values.externalRedis.existingSecret.passwordKey }}
  {{- end }}
  {{- end }}
- name: REDIS_IP_FAMILY
  {{- if $.Values.redis.enabled }}
  value: {{ $.Values.redis.ipFamily | quote }}
  {{- else }}
  value: {{ $.Values.externalRedis.ipFamily | quote }}
  {{- end }}
- name: REDIS_DB
  {{- if $.Values.redis.enabled }}
  value: {{ printf "0" | squote}}
  {{- else }}
  value: {{ $.Values.externalRedis.database | quote }}
  {{- end }}
- name: REDIS_USERNAME
  {{- if $.Values.redis.enabled }}
  value: default
  {{- else }}
  value: {{ $.Values.externalRedis.username }}
  {{- end }}


## REDIS SSL BLOCK
{{- if $.Values.redis.enabled }}
# do nothing here.
{{- else }}
{{- if $.Values.externalRedis.tls.enabled }}

{{- if $.Values.externalRedis.tls.ca }}
- name: REDIS_TLS_CA
  valueFrom:
    secretKeyRef:
        name: {{ printf "%s-%s" $.Release.Name "external-redis"  }}
        key: tls-ca
{{- end }}

{{- if $.Values.externalRedis.tls.cert }}
- name: REDIS_TLS_CERT
  valueFrom:
    secretKeyRef:
        name: {{ printf "%s-%s" $.Release.Name "external-redis"  }}
        key: tls-cert
{{- end }}

{{- if $.Values.externalRedis.tls.key }}
- name: REDIS_TLS_KEY
  valueFrom:
    secretKeyRef:
        name: {{ printf "%s-%s" $.Release.Name "external-redis"  }}
        key: tls-key
{{- end }}
{{- end }}
{{- end }}

# Postgres configuration

- name: DATABASE_HOST
  {{- if $.Values.postgresql.enabled }}
  value: {{ $.Release.Name }}-postgresql.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
  {{- else }}
  value: {{ $.Values.externalPostgres.host }}
  {{- end }}
- name: DATABASE_PORT
  {{- if $.Values.postgresql.enabled }}
  value: {{ printf "%s" $.Values.postgresql.primary.service.ports.postgresql | squote }}
  {{- else }}
  value: {{ $.Values.externalPostgres.port | quote }}
  {{- end }}
- name: DATABASE_USERNAME
  {{- if $.Values.postgresql.enabled }}
  value: postgres
  {{- else }}
  value: {{ $.Values.externalPostgres.username }}
  {{- end }}
- name: DATABASE_PASSWORD
  {{- if $.Values.postgresql.enabled }}
  valueFrom:
    secretKeyRef:
        name: {{ printf "%s-%s" $.Release.Name "postgresql"  }}
        key: postgres-password
  {{- else }}
  {{- if $.Values.externalPostgres.password }}
  valueFrom:
    secretKeyRef:
        name: {{ printf "%s-%s" $.Release.Name "external-postgres"  }}
        key: password
  {{- end }}
  {{- if $.Values.externalPostgres.existingSecret.name }}
  valueFrom:
    secretKeyRef:
        name: {{ printf "%s" $.Values.externalPostgres.existingSecret.name }}
        key: {{ $.Values.externalPostgres.existingSecret.passwordKey }}
  {{- end }}
  {{- end }}
- name: DATABASE_NAME
  {{- if $.Values.postgresql.enabled }}
  value: {{ $.Values.postgresql.auth.database }}
  {{- else }}
  value: {{ $.Values.externalPostgres.database }}
  {{- end }}


## DATABASE SSL BLOCK
{{- if $.Values.postgresql.enabled }}
# do nothing here.
{{- else }}
{{- if $.Values.externalPostgres.ssl.enabled }}

{{- if $.Values.externalPostgres.ssl.ca }}
- name: DATABASE_SSL_CA
  valueFrom:
    secretKeyRef:
        name: {{ printf "%s-%s" $.Release.Name "external-postgres"  }}
        key: ssl-ca
{{- end }}

{{- if $.Values.externalPostgres.ssl.cert }}
- name: DATABASE_SSL_CERT
  valueFrom:
    secretKeyRef:
        name: {{ printf "%s-%s" $.Release.Name "external-postgres"  }}
        key: ssl-cert
{{- end }}

{{- if $.Values.externalPostgres.ssl.key }}
- name: DATABASE_SSL_KEY
  valueFrom:
    secretKeyRef:
        name: {{ printf "%s-%s" $.Release.Name "external-postgres"  }}
        key: ssl-key
{{- end }}

{{- end }}
{{- end }}

## DATABASE SSL ENDS HERE

- name: BILLING_PRIVATE_KEY
  value: {{ $.Values.billing.privateKey }}

- name: DISABLE_AUTOMATIC_INCIDENT_CREATION
  value: {{ $.Values.incidents.disableAutomaticCreation | squote }}

- name: DISABLE_AUTOMATIC_ALERT_CREATION
  value: {{ $.Values.alerts.disableAutomaticCreation | squote }}

- name: WORKFLOW_SCRIPT_TIMEOUT_IN_MS
  value: {{ $.Values.script.workflowScriptTimeoutInMs | squote }}

- name: WORKFLOW_TIMEOUT_IN_MS
  value: {{ $.Values.workflow.workflowTimeoutInMs | squote }}

{{- end }}

{{- define "oneuptime.env.pod" }}
- name: NODE_NAME
  valueFrom:
    fieldRef:
      fieldPath: spec.nodeName
- name: POD_NAME
  valueFrom:
    fieldRef:
      fieldPath: metadata.name
- name: POD_NAMESPACE
  valueFrom:
    fieldRef:
      fieldPath: metadata.namespace
- name: POD_IP
  valueFrom:
    fieldRef:
      fieldPath: status.podIP
{{- end }}



{{- define "oneuptime.service" }}
apiVersion: v1
kind: Service
metadata:
  labels:
    app: {{ printf "%s-%s" $.Release.Name $.ServiceName  }}
    app.kubernetes.io/part-of: oneuptime
    app.kubernetes.io/managed-by: Helm
    appname: oneuptime
  name: {{ printf "%s-%s" $.Release.Name $.ServiceName  }}
  namespace: {{ $.Release.Namespace }}
  annotations:
  {{- if $.IsMetalLbEnabled }}
    metallb.universe.tf/address-pool: {{ printf "%s-%s" $.Release.Name "metallb-address-pool"  }}
  {{- end }}
spec:
  {{- if $.LoadBalancerIP }}
  loadBalancerIP: {{ $.LoadBalancerIP }}
  {{- end }}
  {{- if $.ExternalIPs }}
  externalIPs:
    {{- range $key, $val := $.ExternalIPs }}
    - {{ $val }}
    {{- end }}
  {{- end }}
  {{- if $.Ports }}
  ports:
    {{- range $key, $val := $.Ports }}
    - port: {{ $val }}
      targetPort: {{ $val }}
      name: {{ $key }}
    {{- end }}
  {{- end }}
  selector:
      app: {{ printf "%s-%s" $.Release.Name $.ServiceName  }}
  {{- if $.ServiceType }}
  type: {{ $.ServiceType }}
  {{- else }}
  type: ClusterIP
  {{- end}}
{{- end }}


{{- define "oneuptime.deployment" }}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ printf "%s-%s" $.Release.Name $.ServiceName  }}
  namespace: {{ $.Release.Namespace }}
  labels:
    app: {{ printf "%s-%s" $.Release.Name $.ServiceName  }}
    app.kubernetes.io/part-of: oneuptime
    app.kubernetes.io/managed-by: Helm
    appname: oneuptime
    date: "{{ now | unixEpoch }}"
spec:
  selector:
    matchLabels:
      app: {{ printf "%s-%s" $.Release.Name $.ServiceName  }}
  {{- if $.ReplicaCount }}
  replicas: {{ $.ReplicaCount }}
  {{- else }}
  {{- if or (not $.Values.autoscaling.enabled) ($.DisableAutoscaler) }}
  replicas: {{ $.Values.deployment.replicaCount }}
  {{- end }}
  {{- end }}
  template:
    metadata:
      labels:
        app: {{ printf "%s-%s" $.Release.Name $.ServiceName  }}
        date: "{{ now | unixEpoch }}"
        appname: oneuptime
    spec:
      {{- if $.Values.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml $.Values.imagePullSecrets | nindent 8 }}
      {{- end }}
      {{- if $.Values.podSecurityContext }}
      securityContext: {{- $.Values.podSecurityContext | toYaml | nindent 8 }}
      {{- end }}
      {{- if $.Values.affinity }}
      affinity: {{- $.Values.affinity | toYaml | nindent 8 }}
      {{- end }}
      {{- if $.Values.tolerations }}
      tolerations: {{- $.Values.tolerations | toYaml | nindent 8 }}
      {{- end }}
      {{- if $.Values.nodeSelector }}
      nodeSelector: {{- $.Values.nodeSelector | toYaml | nindent 8 }}
      {{- end }}
      {{- if $.Volumes }}
      volumes:
      {{- range $key, $val := $.Volumes }}
        - name: {{ $key }}
          emptyDir:
            sizeLimit: {{ $val.SizeLimit }}
      {{- end }}
      {{- end }}
      containers:
        {{- if $.ImageName }}
        - image: {{ printf "%s/%s/%s:%s" .Values.image.registry .Values.image.repository $.ImageName .Values.image.tag }}
        {{- else }}
        - image: {{ printf "%s/%s/%s:%s" .Values.image.registry .Values.image.repository $.ServiceName .Values.image.tag }}
        {{- end}}
          name: {{ printf "%s-%s" $.Release.Name $.ServiceName  }}
          {{- if $.Values.containerSecurityContext }}
          securityContext: {{- $.Values.containerSecurityContext | toYaml | nindent 12 }}
          {{- end }}
          imagePullPolicy: {{ $.Values.image.pullPolicy }}
          env:
            {{- include "oneuptime.env.common" . | nindent 12 }}
            {{- if $.IsUI }}
            {{- include "oneuptime.env.commonUi" . | nindent 12 }}
            {{- end }}
            {{- if $.IsServer  }}
            {{- include "oneuptime.env.commonServer" . | nindent 12 }}
            {{- include "oneuptime.env.oneuptimeSecret" . | nindent 12 }}
            {{- end }}
            {{- if $.Env }}
            {{- range $key, $val := $.Env }}
            - name: {{ $key }}
              value: {{ $val | squote }}
            {{- end }}
            {{- end }}
          {{- if $.Volumes }}
          volumeMounts:
            {{- range $key, $val := $.Volumes }}
            - name: {{ $key }}
              mountPath: {{ $val.MountPath }}
            {{- end }}
          {{- end }}
          {{- if $.Ports }}
          ports:
            {{- range $key, $val := $.Ports }}
            - containerPort: {{ $val }}
              protocol: TCP
              name: {{ $key }}
            {{- end }}
          {{- end }}
          {{- if $.Resources }}
          resources:
            {{- toYaml $.Resources | nindent 12 }}
          {{- end }}
      restartPolicy: {{ $.Values.image.restartPolicy }}
{{- end }}



{{- define "oneuptime.autoscaler" }}
{{- if and (.Values.autoscaling.enabled) (not .DisableAutoscaler) }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ printf "%s-%s" $.Release.Name $.ServiceName  }}
  namespace: {{ $.Release.Namespace }}
  labels:
    appname: oneuptime
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ printf "%s-%s" $.Release.Name $.ServiceName }}
  minReplicas: {{ .Values.autoscaling.minReplicas }}
  maxReplicas: {{ .Values.autoscaling.maxReplicas }}
  metrics:
    {{- if .Values.autoscaling.targetCPUUtilizationPercentage }}
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ .Values.autoscaling.targetCPUUtilizationPercentage }}
    {{- end }}
    {{- if .Values.autoscaling.targetMemoryUtilizationPercentage }}
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: {{ .Values.autoscaling.targetMemoryUtilizationPercentage }}
    {{- end }}
{{- end }}
{{- end }}


{{- define "oneuptime.pvc" }}
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {{ printf "%s-%s" $.Release.Name $.Name  }}
  labels:
    appname: oneuptime
spec:
  accessModes:
    - ReadWriteMany # Use this for shared access
  storageClassName: {{ $.Values.global.storageClass }}
  resources:
    requests:
      storage: {{ $.Storage }}
{{- end }}


{{/*
KEDA ScaledObject template for metric-based autoscaling
Usage: include "oneuptime.kedaScaledObject" (dict "ServiceName" "service-name" "Release" .Release "Values" .Values "MetricsConfig" {...})
*/}}
{{- define "oneuptime.kedaScaledObject" }}
{{- if and .Values.keda.enabled .MetricsConfig.enabled (not .DisableAutoscaler) }}
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: {{ printf "%s-%s-scaledobject" .Release.Name .ServiceName }}
  namespace: {{ .Release.Namespace }}
  labels:
    app: {{ printf "%s-%s" .Release.Name .ServiceName }}
    app.kubernetes.io/part-of: oneuptime
    app.kubernetes.io/managed-by: Helm
    appname: oneuptime
spec:
  scaleTargetRef:
    name: {{ printf "%s-%s" .Release.Name .ServiceName }}
  minReplicaCount: {{ .MetricsConfig.minReplicas }}
  maxReplicaCount: {{ .MetricsConfig.maxReplicas }}
  pollingInterval: {{ .MetricsConfig.pollingInterval }}
  cooldownPeriod: {{ .MetricsConfig.cooldownPeriod }}
  advanced:
    horizontalPodAutoscalerConfig:
      behavior:
        scaleUp:
          stabilizationWindowSeconds: 300
          policies:
          - type: Percent
            value: 50
            periodSeconds: 120
          - type: Pods
            value: 2
            periodSeconds: 120
          selectPolicy: Min
        scaleDown:
          stabilizationWindowSeconds: 600
          policies:
          - type: Percent
            value: 10
            periodSeconds: 180
          - type: Pods
            value: 1
            periodSeconds: 180
          selectPolicy: Min
  triggers:
    {{- range .MetricsConfig.triggers }}
    - type: metrics-api
      metadata:
        targetValue: {{ .threshold | quote }}
        url: http://{{ printf "%s-%s" $.Release.Name $.ServiceName }}:{{ .port }}/metrics/queue-size
        valueLocation: 'queueSize'
        method: 'GET'
      # authenticationRef:
      #   name: {{ printf "%s-%s-trigger-auth" $.Release.Name $.ServiceName }}
    {{- end }}
---
apiVersion: keda.sh/v1alpha1
kind: TriggerAuthentication
metadata:
  name: {{ printf "%s-%s-trigger-auth" .Release.Name .ServiceName }}
  namespace: {{ .Release.Namespace }}
  labels:
    app: {{ printf "%s-%s" .Release.Name .ServiceName }}
    app.kubernetes.io/part-of: oneuptime
    app.kubernetes.io/managed-by: Helm
    appname: oneuptime
spec:
  secretTargetRef:
    {{- if .Values.externalSecrets.oneuptimeSecret.existingSecret.name }}
    - parameter: clusterkey
      name: {{ .Values.externalSecrets.oneuptimeSecret.existingSecret.name }}
      key: {{ .Values.externalSecrets.oneuptimeSecret.existingSecret.passwordKey }}
    {{- else }}
    - parameter: clusterkey
      name: {{ printf "%s-%s" .Release.Name "secrets" }}
      key: oneuptime-secret
    {{- end }}
{{- end }}
{{- end }}
