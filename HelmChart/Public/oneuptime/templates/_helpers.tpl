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

{{- define "oneuptime.image.tag" -}}
  {{- $values := .Values -}}
  {{- $tag := default "release" $values.image.tag -}}
  {{- $imageType := default "community-edition" $values.image.type -}}
  {{- if and (eq $imageType "enterprise-edition") (not (contains "enterprise" $tag)) }}
    {{- printf "enterprise-%s" $tag -}}
  {{- else -}}
    {{- $tag -}}
  {{- end -}}
{{- end -}}

{{- define "oneuptime.image" -}}
  {{- $values := .Values -}}
  {{- $service := .ServiceName -}}
  {{- $imageName := default $service .ImageName -}}
  {{- printf "%s/%s/%s:%s" $values.image.registry $values.image.repository $imageName (include "oneuptime.image.tag" (dict "Values" $values)) -}}
{{- end -}}

{{/*
Resolve the REAL Postgres backend (built-in StatefulSet, CloudNativePG, or
externalPostgres) — never the pgbouncer pooler. These are what pgbouncer points
its upstream at, and what the app points at directly when pgbouncer is disabled.
*/}}
{{- define "oneuptime.postgres.backendHost" -}}
{{- if .Values.postgresOperator.cnpg.enabled -}}
{{ .Release.Name }}-postgresql-cnpg-rw.{{ .Release.Namespace }}.svc.{{ .Values.global.clusterDomain }}
{{- else if .Values.postgresql.enabled -}}
{{ .Release.Name }}-postgresql.{{ .Release.Namespace }}.svc.{{ .Values.global.clusterDomain }}
{{- else -}}
{{ .Values.externalPostgres.host }}
{{- end -}}
{{- end -}}

{{- define "oneuptime.postgres.backendPort" -}}
{{- if .Values.postgresOperator.cnpg.enabled -}}
5432
{{- else if .Values.postgresql.enabled -}}
{{ .Values.postgresql.primary.service.ports.postgresql }}
{{- else -}}
{{ .Values.externalPostgres.port }}
{{- end -}}
{{- end -}}

{{- define "oneuptime.postgres.backendUser" -}}
{{- if or .Values.postgresOperator.cnpg.enabled .Values.postgresql.enabled -}}
postgres
{{- else -}}
{{ .Values.externalPostgres.username }}
{{- end -}}
{{- end -}}

{{/*
Emit the backend Postgres password as a PGB_DB_PASSWORD env entry, sourced from
the same secret the app uses (auto-generated for the StatefulSet/CNPG, or the
externalPostgres password / existingSecret). Used by the pgbouncer pod to build
its userlist at startup.
*/}}
{{- define "oneuptime.postgres.backendPasswordEnv" -}}
- name: PGB_DB_PASSWORD
  {{- if .Values.postgresOperator.cnpg.enabled }}
  valueFrom:
    secretKeyRef:
      name: {{ printf "%s-postgresql-cnpg-superuser" .Release.Name }}
      key: password
  {{- else if .Values.postgresql.enabled }}
  valueFrom:
    secretKeyRef:
      name: {{ printf "%s-postgresql" .Release.Name }}
      key: postgres-password
  {{- else if .Values.externalPostgres.existingSecret.name }}
  valueFrom:
    secretKeyRef:
      name: {{ .Values.externalPostgres.existingSecret.name }}
      key: {{ .Values.externalPostgres.existingSecret.passwordKey }}
  {{- else }}
  valueFrom:
    secretKeyRef:
      name: {{ printf "%s-external-postgres" .Release.Name }}
      key: password
  {{- end }}
{{- end -}}

{{- define "oneuptime.env.common" }}
{{- $isEnterpriseEdition := eq (default "community-edition" $.Values.image.type) "enterprise-edition" }}
{{- $provisionSSL := false -}}
{{- if kindIs "map" $.Values.ssl }}
  {{- $provisionSSL = default false $.Values.ssl.provision -}}
{{- end }}

- name: IS_ENTERPRISE_EDITION
  value: {{ (ternary "true" "false" $isEnterpriseEdition) | squote }}
- name: MICROSOFT_TEAMS_APP_CLIENT_ID
  value: {{ $.Values.microsoftTeamsApp.clientId }}
- name: MICROSOFT_TEAMS_APP_TENANT_ID
  value: {{ $.Values.microsoftTeamsApp.tenantId }}

{{- if $.Values.openTelemetryExporter.endpoint }}
- name: OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT
  value: {{ $.Values.openTelemetryExporter.endpoint }}
{{- end }}
{{- if $.Values.openTelemetryExporter.headers }}
- name: OPENTELEMETRY_EXPORTER_OTLP_HEADERS
  value: {{ $.Values.openTelemetryExporter.headers }}
{{- end }}
- name: SLACK_APP_CLIENT_ID
  {{- if $.Values.slackApp.existingSecret }}
  valueFrom:
    secretKeyRef:
      name: {{ $.Values.slackApp.existingSecret.name }}
      key: {{ $.Values.slackApp.existingSecret.clientIdKey }}
  {{- else }}
  value: {{ $.Values.slackApp.clientId | quote }}
  {{- end }}
- name: GITHUB_APP_ID
  value: {{ $.Values.gitHubApp.id | quote }}
- name: GITHUB_APP_NAME
  value: {{ $.Values.gitHubApp.name | quote }}
- name: GITHUB_APP_CLIENT_ID
  value: {{ $.Values.gitHubApp.clientId | quote }}
- name: HOST
  value: {{ $.Values.host }}
- name: PROVISION_SSL
  value: {{ ternary "true" "false" $provisionSSL | quote }}
- name: STATUS_PAGE_CNAME_RECORD
  value: {{ $.Values.statusPage.cnameRecord }}
- name: DASHBOARD_CNAME_RECORD
  value: {{ $.Values.dashboard.cnameRecord | default "" }}
- name: ALLOWED_ACTIVE_MONITOR_COUNT_IN_FREE_PLAN
  value: {{ $.Values.billing.allowedActiveMonitorCountInFreePlan | quote }}
- name: LOG_LEVEL
  value: {{ $.Values.logLevel }}
- name: HTTP_PROTOCOL
  value: {{ $.Values.httpProtocol }}
- name: NODE_ENV
  value: {{ $.Values.nodeEnvironment }}
{{- if $.Values.ssl.skipVerification }}
- name: NODE_TLS_REJECT_UNAUTHORIZED
  value: "0"
{{- end }}
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
- name: CAPTCHA_ENABLED
  value: {{ ternary "true" "false" (default false $.Values.captcha.enabled) | quote }}
- name: CAPTCHA_SITE_KEY
  value: {{ default "" $.Values.captcha.siteKey | quote }}
- name: VAPID_PUBLIC_KEY
  value: {{ $.Values.vapid.publicKey }}
- name: VAPID_SUBJECT
  value: {{ $.Values.vapid.subject }}
- name: INBOUND_EMAIL_PROVIDER
  value: {{ default "SendGrid" $.Values.inboundEmail.provider | quote }}
- name: INBOUND_EMAIL_DOMAIN
  value: {{ default "" $.Values.inboundEmail.domain | quote }}
- name: INBOUND_EMAIL_WEBHOOK_SECRET
  value: {{ default "" $.Values.inboundEmail.webhookSecret | quote }}
- name: SERVER_HOME_HOSTNAME
  value: {{ $.Release.Name }}-home.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_APP_HOSTNAME
  value: {{ $.Release.Name }}-app.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: APP_PORT
  value: {{ $.Values.app.ports.http | squote }}
- name: HOME_PORT
  value: {{ $.Values.home.ports.http | squote }}
- name: WORKER_CONCURRENCY
  value: {{ $.Values.app.workerConcurrency | default 100 | squote }}
- name: IP_WHITELIST
  value: {{ default "" $.Values.ipWhitelist | quote }}
{{- include "oneuptime.env.globalLlmProvider" $ }}
{{- end }}

{{/*
Env vars that declaratively seed a Global LLM Provider at startup (see
App/FeatureSet/Workers/StartupMigrations). Emitted when the bundled vLLM is
enabled and vllm.globalProvider.enabled is true; when the vars are absent,
the next boot removes the seeded provider row. The API key always renders:
LLMService requires an apiKey for OpenAI-type providers, and vLLM without
VLLM_API_KEY accepts any bearer token, so a placeholder works when no key is
configured.
*/}}
{{- define "oneuptime.env.globalLlmProvider" }}
{{- if and $.Values.vllm.enabled $.Values.vllm.globalProvider.enabled }}
- name: GLOBAL_LLM_PROVIDER_NAME
  value: {{ $.Values.vllm.globalProvider.name | quote }}
- name: GLOBAL_LLM_PROVIDER_DESCRIPTION
  value: "Automatically registered by the OneUptime Helm chart (vllm.globalProvider)."
- name: GLOBAL_LLM_PROVIDER_TYPE
  value: "OpenAI"
- name: GLOBAL_LLM_PROVIDER_BASE_URL
  value: http://{{ $.Release.Name }}-vllm.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}:{{ $.Values.vllm.ports.http }}/v1
- name: GLOBAL_LLM_PROVIDER_MODEL_NAME
  value: {{ if $.Values.vllm.servedModelName }}{{ $.Values.vllm.servedModelName | quote }}{{ else }}{{ $.Values.vllm.model | quote }}{{ end }}
- name: GLOBAL_LLM_PROVIDER_API_KEY
  {{- if $.Values.vllm.existingApiKeySecret.name }}
  valueFrom:
    secretKeyRef:
      name: {{ $.Values.vllm.existingApiKeySecret.name }}
      key: {{ required "vllm.existingApiKeySecret.key is required when vllm.existingApiKeySecret.name is set" $.Values.vllm.existingApiKeySecret.key }}
  {{- else if $.Values.vllm.apiKey }}
  valueFrom:
    secretKeyRef:
      name: {{ printf "%s-%s" $.Release.Name "vllm" }}
      key: api-key
      # optional: the chart-managed vllm Secret is a regular release resource,
      # applied AFTER pre-upgrade hooks. Without this, the first upgrade that
      # introduces vllm.apiKey with migrate.hook=true would deadlock (the hook
      # Job pod stuck in CreateContainerConfigError referencing a Secret the
      # failed upgrade never applies). If the Secret is missing, the hook Job
      # seeds the provider without a key and the every-boot sync on the
      # runtime pods re-seeds the real key once the Secret exists.
      optional: true
  {{- else }}
  value: "vllm-no-auth"
  {{- end }}
{{- end }}
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

{{- define "oneuptime.env.registerProbeKey" }}
- name: REGISTER_PROBE_KEY
  {{- if $.Values.registerProbeKey }}
  value: {{ $.Values.registerProbeKey }}
  {{- else }}
  {{- if $.Values.externalSecrets.registerProbeKey.existingSecret.name }}
  valueFrom:
    secretKeyRef:
        name: {{ $.Values.externalSecrets.registerProbeKey.existingSecret.name }}
        key: {{ $.Values.externalSecrets.registerProbeKey.existingSecret.passwordKey }}
  {{- else }}
  valueFrom:
    secretKeyRef:
      name: {{ printf "%s-%s" $.Release.Name "secrets"  }}
      key: register-probe-key
  {{- end }}
  {{- end }}
{{- end }}

{{- define "oneuptime.env.runtime" }}

- name: VAPID_PRIVATE_KEY
  value: {{ $.Values.vapid.privateKey }}

- name: EXPO_ACCESS_TOKEN
  value: {{ default "" $.Values.expo.accessToken | quote }}

- name: PUSH_NOTIFICATION_RELAY_URL
  value: {{ default "https://oneuptime.com/api/notification/push-relay/send" $.Values.pushNotification.relayUrl | quote }}

- name: SLACK_APP_CLIENT_SECRET
  {{- if $.Values.slackApp.existingSecret }}
  valueFrom:
    secretKeyRef:
      name: {{ $.Values.slackApp.existingSecret.name }}
      key: {{ $.Values.slackApp.existingSecret.clientSecretKey }}
  {{- else }}
  value: {{ $.Values.slackApp.clientSecret }}
  {{- end }}

- name: SLACK_APP_SIGNING_SECRET
  {{- if $.Values.slackApp.existingSecret }}
  valueFrom:
    secretKeyRef:
      name: {{ $.Values.slackApp.existingSecret.name }}
      key: {{ $.Values.slackApp.existingSecret.signingSecretKey }}
  {{- else }}
  value: {{ $.Values.slackApp.signingSecret | quote }}
  {{- end }}

- name: MICROSOFT_TEAMS_APP_CLIENT_SECRET
  value: {{ $.Values.microsoftTeamsApp.clientSecret }}

- name: GITHUB_APP_CLIENT_SECRET
  value: {{ $.Values.gitHubApp.clientSecret }}

- name: GITHUB_APP_PRIVATE_KEY
  value: {{ $.Values.gitHubApp.privateKey | quote }}

- name: GITHUB_APP_WEBHOOK_SECRET
  value: {{ $.Values.gitHubApp.webhookSecret }}

- name: CAPTCHA_SECRET_KEY
  value: {{ default "" $.Values.captcha.secretKey | quote }}

- name: OPEN_SOURCE_DEPLOYMENT_WEBHOOK_URL
  value: {{ default "" $.Values.openSourceDeployment.webhookUrl | quote }}

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

{{- $chAltinity := $.Values.clickhouseOperator.altinity }}
- name: CLICKHOUSE_USER
  {{- if $chAltinity.enabled }}
  value: {{ $chAltinity.auth.username | default "oneuptime" }}
  {{- else if $.Values.clickhouse.enabled }}
  value: {{ $.Values.clickhouse.auth.username }}
  {{- else }}
  value: {{ $.Values.externalClickhouse.username }}
  {{- end }}

- name: CLICKHOUSE_IS_HOST_HTTPS
  {{- if or $chAltinity.enabled $.Values.clickhouse.enabled }}
  value: {{ false | squote }}
  {{- else }}
  value: {{ $.Values.externalClickhouse.isHostHttps | squote }}
  {{- end }}
- name: CLICKHOUSE_PASSWORD
  {{- if $chAltinity.enabled }}
  valueFrom:
    secretKeyRef:
        name: {{ printf "%s-clickhouse-altinity" $.Release.Name }}
        key: admin-password
  {{- else if $.Values.clickhouse.enabled }}
  valueFrom:
    secretKeyRef:
        {{- if .Values.clickhouse.auth.existingSecret.name }}
        name: {{ .Values.clickhouse.auth.existingSecret.name }}
        key: {{ .Values.clickhouse.auth.existingSecret.passwordKey }}
        {{- else }}
        name: {{ printf "%s-%s" $.Release.Name "clickhouse"  }}
        key: admin-password
        {{- end }}
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
  {{- if $chAltinity.enabled }}
  value: {{ $.Release.Name }}-clickhouse-altinity.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
  {{- else if $.Values.clickhouse.enabled }}
  value: {{ $.Release.Name }}-clickhouse.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
  {{- else }}
  value: {{ $.Values.externalClickhouse.host }}
  {{- end }}
- name: CLICKHOUSE_PORT
  {{- if $chAltinity.enabled }}
  value: {{ printf "%s" "8123" | squote }}
  {{- else if $.Values.clickhouse.enabled }}
  value: {{ printf "%s" $.Values.clickhouse.service.ports.http | squote }}
  {{- else }}
  value: {{ $.Values.externalClickhouse.port | quote }}
  {{- end }}
- name: CLICKHOUSE_DATABASE
  {{- if $chAltinity.enabled }}
  value: {{ $chAltinity.database | default "oneuptime" | squote }}
  {{- else if $.Values.clickhouse.enabled }}
  value: {{ printf "oneuptime" | squote}}
  {{- else }}
  value: {{ $.Values.externalClickhouse.database }}
  {{- end }}
# Cluster name. OneUptime's analytics schema ALWAYS runs as a sharded +
# replicated cluster (Distributed over local ReplicatedMergeTree, ON CLUSTER).
# The name must match the cluster defined in the ClickHouse config:
#   - operator path: the CHI cluster (clickhouseOperator.altinity.cluster.name);
#   - built-in StatefulSet: the "oneuptime" 1-node cluster + embedded Keeper in
#     clickhouse.configuration;
#   - external ClickHouse: the cluster you defined there (externalClickhouse.clusterName).
# The ConvertAnalyticsTablesToCluster data-migration converts any existing
# single-node data in place on boot.
- name: CLICKHOUSE_CLUSTER_NAME
  {{- if $chAltinity.enabled }}
  value: {{ $chAltinity.cluster.name | default "oneuptime" | squote }}
  {{- else if $.Values.clickhouse.enabled }}
  value: "oneuptime"
  {{- else }}
  value: {{ $.Values.externalClickhouse.clusterName | default "oneuptime" | squote }}
  {{- end }}
{{- if $chAltinity.enabled }}
{{- with $chAltinity.cluster.shardingKey }}
# Optional GLOBAL override of the Distributed sharding-key expression (default:
# each model's own key — cityHash64(traceId) for spans, the series for metrics).
- name: CLICKHOUSE_SHARDING_KEY
  value: {{ . | squote }}
{{- end }}
{{- end }}


## CLICKHOUSE SSL BLOCK
{{- if or $chAltinity.enabled $.Values.clickhouse.enabled }}
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
      {{- if .Values.redis.auth.existingSecret.name }}
      name: {{ .Values.redis.auth.existingSecret.name }}
      key: {{ .Values.redis.auth.existingSecret.passwordKey }}
      {{- else }}
      name: {{ .Release.Name }}-redis
      key: redis-password
      {{- end }}
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
{{- $cnpg := $.Values.postgresOperator.cnpg }}

- name: DATABASE_HOST
  {{- if and $.Values.pgbouncer.enabled (not $.DirectPostgres) }}
  value: {{ $.Release.Name }}-pgbouncer.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
  {{- else if $cnpg.enabled }}
  value: {{ $.Release.Name }}-postgresql-cnpg-rw.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
  {{- else if $.Values.postgresql.enabled }}
  value: {{ $.Release.Name }}-postgresql.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
  {{- else }}
  value: {{ $.Values.externalPostgres.host }}
  {{- end }}
- name: DATABASE_PORT
  {{- if and $.Values.pgbouncer.enabled (not $.DirectPostgres) }}
  value: {{ $.Values.pgbouncer.service.port | quote }}
  {{- else if $cnpg.enabled }}
  value: '5432'
  {{- else if $.Values.postgresql.enabled }}
  value: {{ printf "%s" $.Values.postgresql.primary.service.ports.postgresql | squote }}
  {{- else }}
  value: {{ $.Values.externalPostgres.port | quote }}
  {{- end }}
- name: DATABASE_USERNAME
  {{- if or $cnpg.enabled $.Values.postgresql.enabled }}
  value: postgres
  {{- else }}
  value: {{ $.Values.externalPostgres.username }}
  {{- end }}
- name: DATABASE_PASSWORD
  {{- if $cnpg.enabled }}
  valueFrom:
    secretKeyRef:
        name: {{ printf "%s-postgresql-cnpg-superuser" $.Release.Name }}
        key: password
  {{- else if $.Values.postgresql.enabled }}
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
  {{- if $cnpg.enabled }}
  value: {{ $cnpg.database | default "oneuptimedb" }}
  {{- else if $.Values.postgresql.enabled }}
  value: {{ $.Values.postgresql.auth.database }}
  {{- else }}
  value: {{ $.Values.externalPostgres.database }}
  {{- end }}
{{- if .DatabaseMaxOpenConnections }}
# Per-pod node-postgres pool ceiling. Resolved per service at the call site
# (service override | deployment.databaseMaxOpenConnections | unset). Unset
# falls back to the app's built-in default (50). Lower this to make a
# connection-pooled / capped backend (e.g. pgbouncer in session mode, or a
# managed DB) effective — see HelmChart/Docs/Postgres.md.
- name: DATABASE_MAX_OPEN_CONNECTIONS
  value: {{ .DatabaseMaxOpenConnections | quote }}
{{- end }}
{{- if and $.Values.migrate.enabled (not $.DirectPostgres) }}
# A dedicated migrate Job owns schema + data migrations, so runtime pods must
# NOT run them on boot — this keeps the data-migration session advisory lock
# off the pooled runtime connection, which is what makes pgbouncer
# transaction-mode pooling safe. (The migrate Job sets DirectPostgres, so it is
# excluded here and runs migrations itself.)
- name: RUN_DATABASE_MIGRATIONS_ON_BOOT
  value: "false"
{{- end }}


## DATABASE SSL BLOCK
{{- if or $cnpg.enabled $.Values.postgresql.enabled (and $.Values.pgbouncer.enabled (not $.DirectPostgres)) }}
# do nothing here. (With pgbouncer in front, the app -> pgbouncer hop is
# in-cluster plaintext; pgbouncer originates TLS to the backend instead. A
# DirectPostgres consumer — the migrate Job — falls through to the external
# SSL env below so it can talk TLS straight to a managed backend.)
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

- name: BILLING_WEBHOOK_SECRET
  value: {{ $.Values.billing.webhookSecret }}

- name: DISABLE_AUTOMATIC_INCIDENT_CREATION
  value: {{ $.Values.incidents.disableAutomaticCreation | squote }}

- name: DISABLE_AUTOMATIC_ALERT_CREATION
  value: {{ $.Values.alerts.disableAutomaticCreation | squote }}

- name: DISABLE_TELEMETRY_INGESTION
  value: {{ default false $.Values.telemetry.disableIngestion | squote }}

- name: WORKFLOW_SCRIPT_TIMEOUT_IN_MS
  value: {{ $.Values.script.workflowScriptTimeoutInMs | squote }}

- name: WORKFLOW_TIMEOUT_IN_MS
  value: {{ $.Values.script.workflowScriptTimeoutInMs | squote }}

- name: AVERAGE_SPAN_ROW_SIZE_IN_BYTES
  value: {{ $.Values.billing.telemetry.averageSpanRowSizeInBytes | quote }}

- name: AVERAGE_LOG_ROW_SIZE_IN_BYTES
  value: {{ $.Values.billing.telemetry.averageLogRowSizeInBytes | quote }}

- name: AVERAGE_METRIC_ROW_SIZE_IN_BYTES
  value: {{ $.Values.billing.telemetry.averageMetricRowSizeInBytes | quote }}
- name: AVERAGE_EXCEPTION_ROW_SIZE_IN_BYTES
  value: {{ $.Values.billing.telemetry.averageExceptionRowSizeInBytes | quote }}

- name: AVERAGE_PROFILE_ROW_SIZE_IN_BYTES
  value: {{ $.Values.billing.telemetry.averageProfileRowSizeInBytes | quote }}

- name: AVERAGE_PROFILE_SAMPLE_ROW_SIZE_IN_BYTES
  value: {{ $.Values.billing.telemetry.averageProfileSampleRowSizeInBytes | quote }}

- name: ENABLE_QUEUE_DASHBOARD
  value: {{ ternary "true" "false" (default false $.Values.queueDashboard.enabled) | squote }}

- name: QUEUE_DASHBOARD_SECRET
  value: {{ default "" $.Values.queueDashboard.secret | quote }}

{{- include "oneuptime.env.oneuptimeSecret" . }}
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
    {{- if $.Values.deployment.includeTimestampLabel }}
    date: "{{ now | unixEpoch }}"
    {{- end }}
spec:
  selector:
    matchLabels:
      app: {{ printf "%s-%s" $.Release.Name $.ServiceName  }}
  {{- if $.ReplicaCount }}
  replicas: {{ $.ReplicaCount }}
  {{- else }}
  {{- if or (not (eq (include "oneuptime.autoscalingEnabled" (dict "Values" $.Values "Override" $.AutoscalingOverride)) "true")) ($.DisableAutoscaler) }}
  replicas: {{ $.Values.deployment.replicaCount }}
  {{- end }}
  strategy: {{- toYaml $.Values.deployment.updateStrategy | nindent 4 }}
  {{- end }}
  template:
    metadata:
      labels:
        app: {{ printf "%s-%s" $.Release.Name $.ServiceName  }}
        {{- if $.Values.deployment.includeTimestampLabel }}
        date: "{{ now | unixEpoch }}"
        {{- end }}
        appname: oneuptime
    spec:
      {{- if $.Values.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml $.Values.imagePullSecrets | nindent 8 }}
      {{- end }}
      {{- if $.PodSecurityContext }}
      securityContext:
        {{- toYaml $.PodSecurityContext | nindent 8 }}
      {{- else if $.Values.podSecurityContext }}
      securityContext:
        {{- toYaml $.Values.podSecurityContext | nindent 8 }}
      {{- end }}
      {{- if $.hostAliases }}
      hostAliases:
        {{- toYaml $.hostAliases | nindent 8 }}
      {{- end }}
      {{- if $.Values.affinity }}
      affinity: {{- $.Values.affinity | toYaml | nindent 8 }}
      {{- end }}
      {{- if $.Values.tolerations }}
      tolerations: {{- $.Values.tolerations | toYaml | nindent 8 }}
      {{- end }}
      {{- if $.NodeSelector }}
      nodeSelector:
        {{- toYaml $.NodeSelector | nindent 8 }}
      {{- else if $.Values.nodeSelector }}
      nodeSelector:
        {{- toYaml $.Values.nodeSelector | nindent 8 }}
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
        - image: {{ include "oneuptime.image" (dict "Values" .Values "ServiceName" $.ServiceName "ImageName" $.ImageName) }}
        {{- else }}
        - image: {{ include "oneuptime.image" (dict "Values" .Values "ServiceName" $.ServiceName) }}
        {{- end}}
          name: {{ printf "%s-%s" $.Release.Name $.ServiceName  }}
          {{- if $.ContainerSecurityContext }}
          securityContext:
            {{- toYaml $.ContainerSecurityContext | nindent 12 }}
          {{- else if $.Values.containerSecurityContext }}
          securityContext:
            {{- toYaml $.Values.containerSecurityContext | nindent 12 }}
          {{- end }}
          imagePullPolicy: {{ $.Values.image.pullPolicy }}
          env:
            {{- include "oneuptime.env.common" . | nindent 12 }}
            {{- include "oneuptime.env.runtime" . | nindent 12 }}
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



{{/*
oneuptime.autoscalingEnabled returns "true" when autoscaling is effectively
enabled for a service, otherwise an empty string. Pass the global Values plus an
optional per-service Override block (e.g. .Values.nginx.autoscaling). A key
present in Override wins over the global .Values.autoscaling default.
Usage: {{- if eq (include "oneuptime.autoscalingEnabled" (dict "Values" $.Values "Override" $.Values.nginx.autoscaling)) "true" }}
*/}}
{{- define "oneuptime.autoscalingEnabled" -}}
{{- $g := .Values.autoscaling | default dict -}}
{{- $o := .Override | default dict -}}
{{- $enabled := $g.enabled -}}
{{- if hasKey $o "enabled" -}}{{- $enabled = $o.enabled -}}{{- end -}}
{{- if $enabled -}}true{{- end -}}
{{- end -}}

{{/*
oneuptime.autoscaler renders a HorizontalPodAutoscaler. Each field falls back to
the global .Values.autoscaling block, but a per-service Override block (passed as
.Override, e.g. .Values.nginx.autoscaling) can override any subset of
enabled / minReplicas / maxReplicas / targetCPUUtilizationPercentage /
targetMemoryUtilizationPercentage. Keys absent from Override inherit the global.

The block below intentionally preserves the newline immediately before
"apiVersion" (the last override `{{- end }}` is NOT right-trimmed). Callers place
a descriptive "# ... autoscaler" comment right before this include; without the
leading newline Helm's whitespace trimming glues apiVersion onto that comment
line, silently commenting it out and producing "error validating data: apiVersion
not set" on upgrade. Mirrors the leading newline that oneuptime.service relies on.
*/}}
{{- define "oneuptime.autoscaler" }}
{{- $g := .Values.autoscaling | default dict -}}
{{- $o := .Override | default dict -}}
{{- $enabled := $g.enabled -}}
{{- if hasKey $o "enabled" -}}{{- $enabled = $o.enabled -}}{{- end -}}
{{- if and $enabled (not .DisableAutoscaler) }}
{{- $minReplicas := $g.minReplicas -}}
{{- if hasKey $o "minReplicas" -}}{{- $minReplicas = $o.minReplicas -}}{{- end -}}
{{- $maxReplicas := $g.maxReplicas -}}
{{- if hasKey $o "maxReplicas" -}}{{- $maxReplicas = $o.maxReplicas -}}{{- end -}}
{{- $targetCPU := $g.targetCPUUtilizationPercentage -}}
{{- if hasKey $o "targetCPUUtilizationPercentage" -}}{{- $targetCPU = $o.targetCPUUtilizationPercentage -}}{{- end -}}
{{- $targetMemory := $g.targetMemoryUtilizationPercentage -}}
{{- if hasKey $o "targetMemoryUtilizationPercentage" -}}{{- $targetMemory = $o.targetMemoryUtilizationPercentage -}}{{- end }}
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
  minReplicas: {{ $minReplicas }}
  maxReplicas: {{ $maxReplicas }}
  metrics:
    {{- if $targetCPU }}
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ $targetCPU }}
    {{- end }}
    {{- if $targetMemory }}
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: {{ $targetMemory }}
    {{- end }}
{{- end }}
{{- end }}


{{/*
PodDisruptionBudget template for a stateless deployment.

Merges the global ".Values.podDisruptionBudget" defaults with an optional
per-service override object, then renders a policy/v1 PodDisruptionBudget that
selects the deployment by its "app: <release>-<service>" label (the same label
the Deployment uses, so the names line up across resource kinds).

minAvailable takes precedence over maxUnavailable when both resolve to a value
(the PDB spec permits only one). Empty / null values are treated as unset, so a
service can switch from the default maxUnavailable to minAvailable just by
setting minAvailable in its override. If neither resolves, nothing is rendered.

Usage:
  include "oneuptime.pdb" (dict
    "ServiceName" "app"
    "Override" $.Values.app.podDisruptionBudget
    "Release" $.Release
    "Values" $.Values)
*/}}
{{- define "oneuptime.pdb" -}}
{{- $g := .Values.podDisruptionBudget | default dict -}}
{{- $o := .Override | default dict -}}
{{- $enabled := $g.enabled -}}
{{- if hasKey $o "enabled" -}}{{- $enabled = $o.enabled -}}{{- end -}}
{{- if $enabled -}}
{{- $minAvailable := $g.minAvailable -}}
{{- $maxUnavailable := $g.maxUnavailable -}}
{{- if hasKey $o "minAvailable" -}}{{- $minAvailable = $o.minAvailable -}}{{- end -}}
{{- if hasKey $o "maxUnavailable" -}}{{- $maxUnavailable = $o.maxUnavailable -}}{{- end -}}
{{- $hasMin := and (not (kindIs "invalid" $minAvailable)) (ne ($minAvailable | toString) "") -}}
{{- $hasMax := and (not (kindIs "invalid" $maxUnavailable)) (ne ($maxUnavailable | toString) "") -}}
{{- if or $hasMin $hasMax }}
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ printf "%s-%s" $.Release.Name $.ServiceName }}
  namespace: {{ $.Release.Namespace }}
  labels:
    app: {{ printf "%s-%s" $.Release.Name $.ServiceName }}
    app.kubernetes.io/part-of: oneuptime
    app.kubernetes.io/managed-by: Helm
    appname: oneuptime
spec:
  {{- if $hasMin }}
  minAvailable: {{ $minAvailable }}
  {{- else }}
  maxUnavailable: {{ $maxUnavailable }}
  {{- end }}
  selector:
    matchLabels:
      app: {{ printf "%s-%s" $.Release.Name $.ServiceName }}
{{- end -}}
{{- end -}}
{{- end -}}


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
  annotations:
    meta.helm.sh/release-name: {{ .Release.Name }}
    meta.helm.sh/release-namespace: {{ .Release.Namespace }}
spec:
  scaleTargetRef:
    name: {{ printf "%s-%s" .Release.Name .ServiceName }}
  minReplicaCount: {{ .MetricsConfig.minReplicas }}
  maxReplicaCount: {{ .MetricsConfig.maxReplicas }}
  pollingInterval: {{ .MetricsConfig.pollingInterval }}
  cooldownPeriod: {{ .MetricsConfig.cooldownPeriod }}
  {{- if and .MetricsConfig.fallback (gt (int .MetricsConfig.fallback.replicas) 0) }}
  fallback:
    failureThreshold: {{ .MetricsConfig.fallback.failureThreshold | default 3 }}
    replicas: {{ .MetricsConfig.fallback.replicas }}
  {{- end }}
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
        url: http://{{ printf "%s-%s" $.Release.Name $.ServiceName }}:{{ .port }}{{ if .urlPath }}{{ .urlPath }}{{ else }}/metrics/queue-size{{ end }}
        valueLocation: 'queueSize'
        method: 'GET'
      # authenticationRef:
      #   name: {{ printf "%s-%s-trigger-auth" $.Release.Name $.ServiceName }}
    {{- end }}
    {{- if and .MetricsConfig.targetCPUUtilizationPercentage (gt (int .MetricsConfig.targetCPUUtilizationPercentage) 0) }}
    - type: cpu
      metricType: Utilization
      metadata:
        value: {{ .MetricsConfig.targetCPUUtilizationPercentage | quote }}
    {{- end }}
    {{- if and .MetricsConfig.targetMemoryUtilizationPercentage (gt (int .MetricsConfig.targetMemoryUtilizationPercentage) 0) }}
    - type: memory
      metricType: Utilization
      metadata:
        value: {{ .MetricsConfig.targetMemoryUtilizationPercentage | quote }}
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
  annotations:
    meta.helm.sh/release-name: {{ .Release.Name }}
    meta.helm.sh/release-namespace: {{ .Release.Namespace }}
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
