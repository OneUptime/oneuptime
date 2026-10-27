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

{{/*
The name the bundled Altinity operator chart gives its resources (its own
"altinity-clickhouse-operator.fullname"), worked out from its values: the
operator reads its credentials Secret by that name (its config.yaml's
clickhouse.access.secret.name), and this chart renders that Secret.
*/}}
{{- define "oneuptime.altinityOperator.fullname" -}}
{{- $values := index .Values "altinity-clickhouse-operator" | default dict -}}
{{- if $values.fullnameOverride -}}
{{- $values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default "altinity-clickhouse-operator" $values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
The namespace the bundled Altinity operator runs in, as its chart decides it.
*/}}
{{- define "oneuptime.altinityOperator.namespace" -}}
{{- $values := index .Values "altinity-clickhouse-operator" | default dict -}}
{{- $values.namespaceOverride | default .Release.Namespace -}}
{{- end -}}

{{/*
The password of the operator's own ClickHouse user as values or the cluster
already hold it: the one set in values, else the one its Secret stores, else
nothing - and the Secret's template then makes a random one.
*/}}
{{- define "oneuptime.altinityOperator.password" -}}
{{- $values := index .Values "altinity-clickhouse-operator" | default dict -}}
{{- $secret := $values.secret | default dict -}}
{{- if $secret.password -}}
{{- $secret.password -}}
{{- else -}}
{{- $stored := ((lookup "v1" "Secret" (include "oneuptime.altinityOperator.namespace" .) (include "oneuptime.altinityOperator.fullname" .)).data) | default dict -}}
{{- if (index $stored "password") -}}
{{- index $stored "password" | b64dec -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
The password the bundled Altinity operator's chart ships to every
installation. A value of the installation's own replaces it (secrets.yaml);
NOTES.txt says so to an installation that still runs with it.
*/}}
{{- define "oneuptime.altinityOperator.shippedPassword" -}}
clickhouse_operator_password
{{- end -}}

{{/*
The effective settings for the cache/queue tier, which runs Valkey.

These lived under `redis:` and `externalRedis:` until 13.0.0. Both old keys are
still honoured -- a values.yaml written against any earlier chart has to keep
working with no edits -- so every template reads through these helpers instead of
touching `.Values.valkey` directly.

Precedence is "whatever you actually wrote wins": the chart ships its defaults
under `valkey:` and ships `redis:` EMPTY, so anything present in `.Values.redis`
can only have come from the user and is layered on top. The consequence, for the
one person who sets both names for the same setting, is that the legacy name
wins; NOTES.txt tells them to drop it.

Usage:
{{- $valkey := include "oneuptime.valkey" . | fromYaml }}
*/}}
{{- define "oneuptime.valkey" -}}
{{- mergeOverwrite (deepCopy (.Values.valkey | default dict)) (.Values.redis | default dict) | toYaml -}}
{{- end -}}

{{/*
Same, for the external (bring-your-own) cache. Any Redis-protocol server is
valid there, real Redis included -- only the values key changed name.

Usage:
{{- $externalValkey := include "oneuptime.externalValkey" . | fromYaml }}
*/}}
{{- define "oneuptime.externalValkey" -}}
{{- mergeOverwrite (deepCopy (.Values.externalValkey | default dict)) (.Values.externalRedis | default dict) | toYaml -}}
{{- end -}}

{{/*
The Service port for the in-cluster cache. `master.service.ports.valkey` is the
current key and `ports.redis` is the legacy one, and this is the ONE setting
where the two names differ, so the map merge cannot resolve it: it keeps both
sub-keys, and the chart's own `valkey: "6379"` default would beat a legacy
`redis: "6380"` override. Reading the legacy key first is what stops that, and
it matches the precedence rule above -- if you wrote it, it wins.

Usage:
{{- include "oneuptime.valkey.port" . }}
*/}}
{{- define "oneuptime.valkey.port" -}}
{{- $valkey := include "oneuptime.valkey" . | fromYaml -}}
{{- $ports := (($valkey.master).service).ports | default dict -}}
{{- $ports.redis | default $ports.valkey | default "6379" -}}
{{- end -}}

{{/*
Convert a Kubernetes memory quantity (e.g. "3Gi", "512Mi", "2G", "1500M") to a
plain byte count. Used to derive the cache's `maxmemory` from its container memory
limit so the two never drift apart. Unsuffixed input is treated as bytes.
*/}}
{{- define "oneuptime.memoryToBytes" -}}
{{- $q := . | toString -}}
{{- if hasSuffix "Gi" $q -}}{{ trimSuffix "Gi" $q | float64 | mulf 1073741824 | int64 }}
{{- else if hasSuffix "Mi" $q -}}{{ trimSuffix "Mi" $q | float64 | mulf 1048576 | int64 }}
{{- else if hasSuffix "Ki" $q -}}{{ trimSuffix "Ki" $q | float64 | mulf 1024 | int64 }}
{{- else if hasSuffix "G" $q -}}{{ trimSuffix "G" $q | float64 | mulf 1000000000 | int64 }}
{{- else if hasSuffix "M" $q -}}{{ trimSuffix "M" $q | float64 | mulf 1000000 | int64 }}
{{- else if hasSuffix "k" $q -}}{{ trimSuffix "k" $q | float64 | mulf 1000 | int64 }}
{{- else -}}{{ $q | float64 | int64 }}{{- end -}}
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
  {{- $default := printf "%s/%s/%s:%s" $values.image.registry $values.image.repository $imageName (include "oneuptime.image.tag" (dict "Values" $values)) -}}
  {{- include "oneuptime.imageReference" (dict "Values" $values "Key" $imageName "Default" $default) -}}
{{- end -}}

{{/*
The image one component runs, by its key - app, nginx, probe, runner, home,
test, postgres, clickhouse, clickhouseKeeper, valkey, pgbouncer, vllm, kubectl
- or `Default`, the reference the chart builds from its own values, when
nothing replaces it:

  global.azure.images.<key>   {registry, image, tag | digest}. A Microsoft
                              Marketplace Kubernetes application lists every
                              image there; Microsoft copies them to its own
                              registry and rewrites these values at install.
  image.overrides.<key>       a full reference, as the Google Cloud Marketplace
                              deployer passes its images.

Usage:
  image: {{`{{ include "oneuptime.imageReference" (dict "Values" .Values "Key" "postgres" "Default" "postgres:15") }}`}}
*/}}
{{- define "oneuptime.imageReference" -}}
  {{- $azureImages := (((.Values.global).azure).images) | default dict -}}
  {{- $azure := get $azureImages .Key -}}
  {{- $overrides := ((.Values.image).overrides) | default dict -}}
  {{- $override := get $overrides .Key -}}
  {{- if and $azure (kindIs "map" $azure) $azure.image -}}
    {{- $name := ternary (printf "%s/%s" $azure.registry $azure.image) $azure.image (not (empty $azure.registry)) -}}
    {{- if $azure.digest -}}
      {{- printf "%s@%s" $name $azure.digest -}}
    {{- else -}}
      {{- printf "%s:%s" $name (toString $azure.tag) -}}
    {{- end -}}
  {{- else if and (kindIs "map" $override) $override.repository -}}
    {{- /* {registry, repository, tag | digest}: the form AWS Marketplace checks and rewrites */ -}}
    {{- $name := ternary (printf "%s/%s" $override.registry $override.repository) $override.repository (not (empty $override.registry)) -}}
    {{- if $override.digest -}}
      {{- printf "%s@%s" $name $override.digest -}}
    {{- else if $override.tag -}}
      {{- printf "%s:%s" $name (toString $override.tag) -}}
    {{- else -}}
      {{- $name -}}
    {{- end -}}
  {{- else if and $override (kindIs "string" $override) -}}
    {{- $override -}}
  {{- else -}}
    {{- .Default -}}
  {{- end -}}
{{- end -}}

{{/*
The service account the OneUptime app and worker pods run as: `name`, or
"<release>-oneuptime" for one the chart creates. Empty runs them as the
namespace's default service account.
*/}}
{{- define "oneuptime.serviceAccountName" -}}
  {{- $serviceAccount := .Values.serviceAccount | default dict -}}
  {{- if $serviceAccount.name -}}
    {{- $serviceAccount.name -}}
  {{- else if $serviceAccount.create -}}
    {{- printf "%s-oneuptime" .Release.Name -}}
  {{- end -}}
{{- end -}}

{{/*
Billing this Enterprise installation through the cloud marketplace it was
bought on (enterpriseMarketplace). Every process that runs the App image
(app, worker, telemetry writer) is told WHICH marketplace, because the
license each of them enforces is the marketplace's (ee/Server/License/
MarketplaceLicense.ts). Only the app and the worker, which run the usage job,
are given what reporting needs (Reporter=true): Microsoft's extension
identity, plan and resource, and Google's reporting secret - so a wrong
secret name can only ever stop those two.
*/}}
{{- define "oneuptime.env.enterpriseMarketplace" }}
{{- $marketplace := .Values.enterpriseMarketplace | default dict }}
{{- if $marketplace.provider }}
- name: ENTERPRISE_MARKETPLACE
  value: {{ $marketplace.provider | quote }}
{{- if .Reporter }}
{{- if eq $marketplace.provider "aws" }}
{{- if (($marketplace.aws).region) }}
- name: ENTERPRISE_MARKETPLACE_AWS_REGION
  value: {{ $marketplace.aws.region | quote }}
{{- end }}
{{- else if eq $marketplace.provider "azure" }}
{{- $azure := ((.Values.global).azure) | default dict }}
- name: ENTERPRISE_MARKETPLACE_AZURE_RESOURCE_ID
  value: {{ default "" (($azure.extension).resourceId) | quote }}
- name: ENTERPRISE_MARKETPLACE_AZURE_PLAN_ID
  value: {{ default "" (($azure.marketplace).planId) | quote }}
- name: ENTERPRISE_MARKETPLACE_AZURE_CLIENT_ID
  value: {{ default "" (($azure.identity).clientId) | quote }}
{{- else if eq $marketplace.provider "google-cloud" }}
{{- $google := $marketplace.googleCloud | default dict }}
- name: ENTERPRISE_MARKETPLACE_GOOGLE_CLOUD_SERVICE_NAME
  value: {{ default "" $google.serviceName | quote }}
{{- if $google.reportingSecret }}
- name: ENTERPRISE_MARKETPLACE_GOOGLE_CLOUD_CONSUMER_ID
  valueFrom:
    secretKeyRef:
      name: {{ $google.reportingSecret | quote }}
      key: consumer-id
- name: ENTERPRISE_MARKETPLACE_GOOGLE_CLOUD_ENTITLEMENT_ID
  valueFrom:
    secretKeyRef:
      name: {{ $google.reportingSecret | quote }}
      key: entitlement-id
- name: ENTERPRISE_MARKETPLACE_GOOGLE_CLOUD_REPORTING_KEY
  valueFrom:
    secretKeyRef:
      name: {{ $google.reportingSecret | quote }}
      key: reporting-key
{{- end }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}

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

{{- /*
IS_ENTERPRISE_EDITION is deprecated and never turns anything on. It is derived
from image.type, so it always agrees with the image (true on a Community image
would make the App refuse to start). What the App runs is decided by the image (image.type picks the
enterprise- tags, and the Enterprise image carries ONEUPTIME_EDITION=enterprise
itself), so the chart must never set ONEUPTIME_EDITION: an empty or wrong value
here would override the image's own marker.
*/}}
- name: IS_ENTERPRISE_EDITION
  value: {{ (ternary "true" "false" $isEnterpriseEdition) | squote }}
- name: MICROSOFT_TEAMS_APP_CLIENT_ID
  {{- if $.Values.microsoftTeamsApp.existingSecret }}
  valueFrom:
    secretKeyRef:
      name: {{ $.Values.microsoftTeamsApp.existingSecret.name | quote }}
      key: {{ $.Values.microsoftTeamsApp.existingSecret.clientIdKey | quote }}
  {{- else }}
  value: {{ $.Values.microsoftTeamsApp.clientId }}
  {{- end }}
- name: MICROSOFT_TEAMS_APP_TENANT_ID
  {{- if $.Values.microsoftTeamsApp.existingSecret }}
  valueFrom:
    secretKeyRef:
      name: {{ $.Values.microsoftTeamsApp.existingSecret.name | quote }}
      key: {{ $.Values.microsoftTeamsApp.existingSecret.tenantIdKey | quote }}
  {{- else }}
  value: {{ $.Values.microsoftTeamsApp.tenantId }}
  {{- end }}

{{- if $.Values.openTelemetryExporter.endpoint }}
- name: OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT
  value: {{ $.Values.openTelemetryExporter.endpoint }}
{{- end }}
{{- if $.Values.openTelemetryExporter.headers }}
- name: OPENTELEMETRY_EXPORTER_OTLP_HEADERS
  value: {{ $.Values.openTelemetryExporter.headers }}
{{- end }}
{{- if $.Values.openTelemetryExporter.captureAiMessageContent }}
- name: OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT
  value: "true"
{{- end }}
{{- if $.Values.browserOpenTelemetryExporter.endpoint }}
- name: PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT
  value: {{ $.Values.browserOpenTelemetryExporter.endpoint }}
{{- end }}
{{- if $.Values.browserOpenTelemetryExporter.browserIngestionKey }}
- name: PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_BROWSER_INGESTION_KEY
  value: {{ $.Values.browserOpenTelemetryExporter.browserIngestionKey }}
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
{{- /*
The public client ids of the apps behind the one-click Connect of a video
call provider. The Dashboard offers it for a provider whose id is set
(FRONTEND_ENV_ALLOW_LIST); their secrets are in oneuptime.env.runtime.
*/}}
- name: ZOOM_APP_CLIENT_ID
  {{- if $.Values.zoomApp.existingSecret }}
  valueFrom:
    secretKeyRef:
      name: {{ $.Values.zoomApp.existingSecret.name | quote }}
      key: {{ $.Values.zoomApp.existingSecret.clientIdKey | quote }}
  {{- else }}
  value: {{ default "" $.Values.zoomApp.clientId | quote }}
  {{- end }}
- name: GOOGLE_MEET_APP_CLIENT_ID
  {{- if $.Values.googleMeetApp.existingSecret }}
  valueFrom:
    secretKeyRef:
      name: {{ $.Values.googleMeetApp.existingSecret.name | quote }}
      key: {{ $.Values.googleMeetApp.existingSecret.clientIdKey | quote }}
  {{- else }}
  value: {{ default "" $.Values.googleMeetApp.clientId | quote }}
  {{- end }}
- name: MICROSOFT_TEAMS_MEETINGS_APP_CLIENT_ID
  {{- if $.Values.microsoftTeamsMeetingsApp.existingSecret }}
  valueFrom:
    secretKeyRef:
      name: {{ $.Values.microsoftTeamsMeetingsApp.existingSecret.name | quote }}
      key: {{ $.Values.microsoftTeamsMeetingsApp.existingSecret.clientIdKey | quote }}
  {{- else }}
  value: {{ default "" $.Values.microsoftTeamsMeetingsApp.clientId | quote }}
  {{- end }}
{{- /*
Sign in with Microsoft: the public client id. The sign-in page offers the
button when it is set; the secret is in oneuptime.env.runtime.
*/}}
- name: MICROSOFT_SIGN_IN_CLIENT_ID
  {{- if ($.Values.microsoftSignInApp).existingSecret }}
  valueFrom:
    secretKeyRef:
      name: {{ $.Values.microsoftSignInApp.existingSecret.name | quote }}
      key: {{ $.Values.microsoftSignInApp.existingSecret.clientIdKey | quote }}
  {{- else }}
  value: {{ default "" ($.Values.microsoftSignInApp).clientId | quote }}
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
- name: MARKETING_WEBHOOK_URL
  value: {{ default "" ((($.Values.marketing).webhook).url) | quote }}
- name: MARKETING_WEBHOOK_SECRET
  value: {{ default "" ((($.Values.marketing).webhook).secret) | quote }}
{{- $googleTagManagerEnabled := ((($.Values.analytics).googleTagManager).enabled) }}
- name: GOOGLE_TAG_MANAGER_ENABLED
  value: {{ if kindIs "invalid" $googleTagManagerEnabled }}"true"{{ else }}{{ ternary "true" "false" $googleTagManagerEnabled | quote }}{{ end }}
- name: CAPTCHA_ENABLED
  value: {{ ternary "true" "false" (default false $.Values.captcha.enabled) | quote }}
- name: CAPTCHA_SITE_KEY
  value: {{ default "" $.Values.captcha.siteKey | quote }}
# Outbound webhook egress policy. Off by default and instance-wide; there is no
# per-project setting. See values.yaml for the full explanation.
- name: ALLOW_PRIVATE_NETWORK_WEBHOOKS
  value: {{ ternary "true" "false" (default false (($.Values.webhooks).allowPrivateNetwork)) | quote }}
- name: PRIVATE_NETWORK_WEBHOOK_ALLOWLIST
  value: {{ default "" (($.Values.webhooks).privateNetworkAllowlist) | quote }}
# Egress policy for everything that is not a webhook (data sources, LLM
# providers, SMTP, OIDC, runbook HTTP steps). Off by default, so private ranges
# stay reachable on a self-hosted install. See values.yaml.
- name: DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES
  value: {{ ternary "true" "false" (default false (($.Values.outboundConnections).blockPrivateNetwork)) | quote }}
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
# Ack mode for telemetry ClickHouse inserts. Default false = fire-and-forget
# async inserts (ClickHouse owns flushing; acks mean "accepted into the
# async-insert buffer"). Set true to make acks wait for the durable flush —
# each waiting insert then holds a ClickHouse query slot until flushed.
- name: TELEMETRY_WAIT_FOR_ASYNC_INSERT
  value: {{ $.Values.telemetryWaitForAsyncInsert | default false | quote }}
- name: IP_WHITELIST
  value: {{ default "" $.Values.ipWhitelist | quote }}
{{- include "oneuptime.env.globalLlmProvider" $ }}
{{- include "oneuptime.env.globalRunner" $ }}
{{- end }}

{{/*
The bundled global Runner's key, for the server's pods (see
templates/global-runner.yaml): the App keeps the global Runner's row from it on
every boot (App/FeatureSet/Workers/StartupMigrations/SeedBundledGlobalRunner),
the migrate Job included, which runs the same startup migrations. Emitted only
while globalRunner.enabled: without it - or with globalRunner.replicaCount 0 -
the next boot removes the row, so no project lists a global Runner nobody runs.
*/}}
{{- define "oneuptime.env.globalRunner" }}
{{- if (($.Values.globalRunner).enabled) }}
- name: GLOBAL_RUNNER_KEY
  {{- include "oneuptime.globalRunnerKeyValue" $ | nindent 2 }}
- name: GLOBAL_RUNNER_REPLICAS
  value: {{ $.Values.globalRunner.replicaCount | squote }}
{{- end }}
{{- end }}

{{/*
Where the bundled global Runner's key comes from, as an env var's value: the
literal globalRunner.key, a Secret the user manages
(globalRunner.existingSecret), or the release Secret's global-runner-key,
which templates/secrets.yaml generates once and keeps.
*/}}
{{- define "oneuptime.globalRunnerKeyValue" }}
{{- if $.Values.globalRunner.key }}
value: {{ $.Values.globalRunner.key | quote }}
{{- else if (($.Values.globalRunner.existingSecret).name) }}
valueFrom:
  secretKeyRef:
    name: {{ ($.Values.globalRunner.existingSecret).name }}
    key: {{ ($.Values.globalRunner.existingSecret).passwordKey }}
{{- else }}
valueFrom:
  secretKeyRef:
    name: {{ printf "%s-%s" $.Release.Name "secrets" }}
    key: global-runner-key
{{- end }}
{{- end }}

{{/*
Env vars that declaratively seed a Global LLM Provider at startup (see
App/FeatureSet/Workers/StartupMigrations). Emitted when the bundled vLLM is
enabled and vllm.globalProvider.enabled is true; when the vars are absent,
the next boot removes the seeded provider row. The provider type is
"OpenAICompatible" — vLLM speaks the OpenAI API but is keyless by default — so
GLOBAL_LLM_PROVIDER_API_KEY is rendered only when an API key is configured.
*/}}
{{- define "oneuptime.env.globalLlmProvider" }}
{{- if and $.Values.vllm.enabled $.Values.vllm.globalProvider.enabled }}
- name: GLOBAL_LLM_PROVIDER_NAME
  value: {{ $.Values.vllm.globalProvider.name | quote }}
- name: GLOBAL_LLM_PROVIDER_DESCRIPTION
  value: {{ default "Automatically registered by the OneUptime Helm chart (vllm.globalProvider)." $.Values.vllm.globalProvider.description | quote }}
- name: GLOBAL_LLM_PROVIDER_TYPE
  value: "OpenAICompatible"
- name: GLOBAL_LLM_PROVIDER_BASE_URL
  value: http://{{ $.Release.Name }}-vllm.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}:{{ $.Values.vllm.ports.http }}/v1
- name: GLOBAL_LLM_PROVIDER_MODEL_NAME
  value: {{ if $.Values.vllm.servedModelName }}{{ $.Values.vllm.servedModelName | quote }}{{ else }}{{ $.Values.vllm.model | quote }}{{ end }}
{{- if $.Values.vllm.existingApiKeySecret.name }}
- name: GLOBAL_LLM_PROVIDER_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ $.Values.vllm.existingApiKeySecret.name }}
      key: {{ required "vllm.existingApiKeySecret.key is required when vllm.existingApiKeySecret.name is set" $.Values.vllm.existingApiKeySecret.key }}
{{- else if $.Values.vllm.apiKey }}
- name: GLOBAL_LLM_PROVIDER_API_KEY
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
{{- end }}
{{- end }}
{{- end }}

{{- define "oneuptime.env.oneuptimeSecret" }}
- name: ONEUPTIME_SECRET
  {{- if $.Values.oneuptimeSecret }}
  value: {{ $.Values.oneuptimeSecret }}
  {{- else }}
  {{- if ((($.Values.externalSecrets).oneuptimeSecret).existingSecret).name }}
  valueFrom:
    secretKeyRef:
      name: {{ ((($.Values.externalSecrets).oneuptimeSecret).existingSecret).name }}
      key: {{ ((($.Values.externalSecrets).oneuptimeSecret).existingSecret).passwordKey }}
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
  {{- if ((($.Values.externalSecrets).registerProbeKey).existingSecret).name }}
  valueFrom:
    secretKeyRef:
      name: {{ ((($.Values.externalSecrets).registerProbeKey).existingSecret).name }}
      key: {{ ((($.Values.externalSecrets).registerProbeKey).existingSecret).passwordKey }}
  {{- else }}
  valueFrom:
    secretKeyRef:
      name: {{ printf "%s-%s" $.Release.Name "secrets"  }}
      key: register-probe-key
  {{- end }}
  {{- end }}
{{- end }}

{{/*
The Secret the operator keeps the VAPID private key (web push) in,
vapid.existingSecret.name, or nothing when the key comes from vapid.privateKey
or is not set. Every pod given VAPID_PRIVATE_KEY (oneuptime.env.runtime) then
reads it from that Secret, and the chart writes the key nowhere: not as a plain
value, not into a Secret of its own.

Setting both is refused rather than resolved, as the Kubernetes agent chart
refuses oneuptime.apiKey next to oneuptime.existingSecretName: a Secret of your
own is there to keep the key out of the release's values, and a key left in
privateKey would stay in every revision Helm stores. The name is trimmed, as
kubectl would have created the Secret, and read through parentheses, so values
from before vapid.existingSecret (helm upgrade --reuse-values) still render.
*/}}
{{- define "oneuptime.vapid.existingSecretName" -}}
{{- $vapid := .Values.vapid | default dict -}}
{{- $existing := trim (toString (default "" ($vapid.existingSecret).name)) -}}
{{- if and $existing (trim (toString (default "" $vapid.privateKey))) -}}
{{- fail (printf "vapid.privateKey and vapid.existingSecret.name are both set. Set one of them: to read the VAPID private key from the Secret %s, clear privateKey (--set vapid.privateKey=\"\")." $existing) -}}
{{- end -}}
{{- $existing -}}
{{- end }}

{{/*
The key of that Secret that holds the private key: vapid.existingSecret.privateKeyKey,
or privateKey - the name `npx web-push generate-vapid-keys --json` gives it - when
that is empty.
*/}}
{{- define "oneuptime.vapid.privateKeyKey" -}}
{{- $vapid := .Values.vapid | default dict -}}
{{- trim (toString (default "" ($vapid.existingSecret).privateKeyKey)) | default "privateKey" -}}
{{- end }}

{{- define "oneuptime.env.runtime" }}
{{- $vapidPrivateKeySecret := include "oneuptime.vapid.existingSecretName" $ }}

- name: VAPID_PRIVATE_KEY
  {{- if $vapidPrivateKeySecret }}
  valueFrom:
    secretKeyRef:
      name: {{ $vapidPrivateKeySecret | quote }}
      key: {{ include "oneuptime.vapid.privateKeyKey" $ | quote }}
  {{- else }}
  value: {{ $.Values.vapid.privateKey }}
  {{- end }}

- name: EXPO_ACCESS_TOKEN
  value: {{ default "" $.Values.expo.accessToken | quote }}

- name: PUSH_NOTIFICATION_RELAY_URL
  value: {{ default "https://oneuptime.com/api/notification/push-relay/send" $.Values.pushNotification.relayUrl | quote }}

{{- /*
Unset renders empty, which the app reads as "only where billing is on". An
explicit false must stay false, so this cannot be `default`: false is empty
to `default`, and would render as unset - a relay again where billing is on.
*/}}
- name: PUSH_NOTIFICATION_RELAY_SERVER_ENABLED
  value: {{ if kindIs "bool" ($.Values.pushNotification).relayServerEnabled }}{{ ternary "true" "false" ($.Values.pushNotification).relayServerEnabled | quote }}{{ else }}""{{ end }}

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
  {{- if $.Values.microsoftTeamsApp.existingSecret }}
  valueFrom:
    secretKeyRef:
      name: {{ $.Values.microsoftTeamsApp.existingSecret.name | quote }}
      key: {{ $.Values.microsoftTeamsApp.existingSecret.clientSecretKey | quote }}
  {{- else }}
  value: {{ $.Values.microsoftTeamsApp.clientSecret }}
  {{- end }}

- name: ZOOM_APP_CLIENT_SECRET
  {{- if $.Values.zoomApp.existingSecret }}
  valueFrom:
    secretKeyRef:
      name: {{ $.Values.zoomApp.existingSecret.name | quote }}
      key: {{ $.Values.zoomApp.existingSecret.clientSecretKey | quote }}
  {{- else }}
  value: {{ default "" $.Values.zoomApp.clientSecret | quote }}
  {{- end }}

- name: ZOOM_APP_WEBHOOK_SECRET_TOKEN
  {{- if $.Values.zoomApp.existingSecret }}
  valueFrom:
    secretKeyRef:
      name: {{ $.Values.zoomApp.existingSecret.name | quote }}
      key: {{ $.Values.zoomApp.existingSecret.webhookSecretTokenKey | quote }}
  {{- else }}
  value: {{ default "" $.Values.zoomApp.webhookSecretToken | quote }}
  {{- end }}

- name: GOOGLE_MEET_APP_CLIENT_SECRET
  {{- if $.Values.googleMeetApp.existingSecret }}
  valueFrom:
    secretKeyRef:
      name: {{ $.Values.googleMeetApp.existingSecret.name | quote }}
      key: {{ $.Values.googleMeetApp.existingSecret.clientSecretKey | quote }}
  {{- else }}
  value: {{ default "" $.Values.googleMeetApp.clientSecret | quote }}
  {{- end }}

- name: MICROSOFT_TEAMS_MEETINGS_APP_CLIENT_SECRET
  {{- if $.Values.microsoftTeamsMeetingsApp.existingSecret }}
  valueFrom:
    secretKeyRef:
      name: {{ $.Values.microsoftTeamsMeetingsApp.existingSecret.name | quote }}
      key: {{ $.Values.microsoftTeamsMeetingsApp.existingSecret.clientSecretKey | quote }}
  {{- else }}
  value: {{ default "" $.Values.microsoftTeamsMeetingsApp.clientSecret | quote }}
  {{- end }}

{{- /*
Cloud > Connect: the AWS identity that signs in to customers' read-only IAM
roles. The app reads it for a test and for the role setup the form shows, and
the worker for every read, so it is part of the runtime env. Unset, both are
empty and AWS accounts connect with an access key instead.
*/}}
- name: CLOUD_CONNECT_AWS_ACCESS_KEY_ID
  {{- if (($.Values.cloudConnect).aws).existingSecret }}
  valueFrom:
    secretKeyRef:
      name: {{ $.Values.cloudConnect.aws.existingSecret.name | quote }}
      key: {{ $.Values.cloudConnect.aws.existingSecret.accessKeyIdKey | quote }}
  {{- else }}
  value: {{ default "" (($.Values.cloudConnect).aws).accessKeyId | quote }}
  {{- end }}

- name: CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY
  {{- if (($.Values.cloudConnect).aws).existingSecret }}
  valueFrom:
    secretKeyRef:
      name: {{ $.Values.cloudConnect.aws.existingSecret.name | quote }}
      key: {{ $.Values.cloudConnect.aws.existingSecret.secretAccessKeyKey | quote }}
  {{- else }}
  value: {{ default "" (($.Values.cloudConnect).aws).secretAccessKey | quote }}
  {{- end }}

- name: GITHUB_APP_CLIENT_SECRET
  value: {{ $.Values.gitHubApp.clientSecret }}

- name: GITHUB_APP_PRIVATE_KEY
  value: {{ $.Values.gitHubApp.privateKey | quote }}

- name: GITHUB_APP_WEBHOOK_SECRET
  value: {{ $.Values.gitHubApp.webhookSecret }}

- name: MICROSOFT_SIGN_IN_CLIENT_SECRET
  {{- if ($.Values.microsoftSignInApp).existingSecret }}
  valueFrom:
    secretKeyRef:
      name: {{ $.Values.microsoftSignInApp.existingSecret.name | quote }}
      key: {{ $.Values.microsoftSignInApp.existingSecret.clientSecretKey | quote }}
  {{- else }}
  value: {{ default "" ($.Values.microsoftSignInApp).clientSecret | quote }}
  {{- end }}

{{- /*
Cloud marketplaces (AWS, Microsoft, Google Cloud and Vercel Marketplace). Read
only where billing is enabled; each marketplace is offered only when all of its
values are set. Secrets can come from an existing Kubernetes secret.
*/}}
- name: AWS_MARKETPLACE_ACCESS_KEY_ID
  value: {{ default "" ((($.Values.cloudMarketplace).aws).accessKeyId) | quote }}
- name: AWS_MARKETPLACE_SECRET_ACCESS_KEY
  {{- if ((($.Values.cloudMarketplace).aws).existingSecret) }}
  valueFrom:
    secretKeyRef:
      name: {{ $.Values.cloudMarketplace.aws.existingSecret.name | quote }}
      key: {{ $.Values.cloudMarketplace.aws.existingSecret.secretAccessKeyKey | quote }}
  {{- else }}
  value: {{ default "" ((($.Values.cloudMarketplace).aws).secretAccessKey) | quote }}
  {{- end }}
- name: AWS_MARKETPLACE_PRODUCT_CODE
  value: {{ default "" ((($.Values.cloudMarketplace).aws).productCode) | quote }}
- name: AWS_MARKETPLACE_EVENTS_SECRET
  {{- if ((($.Values.cloudMarketplace).aws).existingSecret) }}
  valueFrom:
    secretKeyRef:
      name: {{ $.Values.cloudMarketplace.aws.existingSecret.name | quote }}
      key: {{ $.Values.cloudMarketplace.aws.existingSecret.eventsSecretKey | quote }}
  {{- else }}
  value: {{ default "" ((($.Values.cloudMarketplace).aws).eventsSecret) | quote }}
  {{- end }}
- name: AZURE_MARKETPLACE_TENANT_ID
  value: {{ default "" ((($.Values.cloudMarketplace).azure).tenantId) | quote }}
- name: AZURE_MARKETPLACE_CLIENT_ID
  value: {{ default "" ((($.Values.cloudMarketplace).azure).clientId) | quote }}
- name: AZURE_MARKETPLACE_CLIENT_SECRET
  {{- if ((($.Values.cloudMarketplace).azure).existingSecret) }}
  valueFrom:
    secretKeyRef:
      name: {{ $.Values.cloudMarketplace.azure.existingSecret.name | quote }}
      key: {{ $.Values.cloudMarketplace.azure.existingSecret.clientSecretKey | quote }}
  {{- else }}
  value: {{ default "" ((($.Values.cloudMarketplace).azure).clientSecret) | quote }}
  {{- end }}
- name: GOOGLE_CLOUD_MARKETPLACE_PROVIDER_ID
  value: {{ default "" ((($.Values.cloudMarketplace).googleCloud).providerId) | quote }}
- name: GOOGLE_CLOUD_MARKETPLACE_SERVICE_ACCOUNT_KEY
  {{- if ((($.Values.cloudMarketplace).googleCloud).existingSecret) }}
  valueFrom:
    secretKeyRef:
      name: {{ $.Values.cloudMarketplace.googleCloud.existingSecret.name | quote }}
      key: {{ $.Values.cloudMarketplace.googleCloud.existingSecret.serviceAccountKeyKey | quote }}
  {{- else }}
  value: {{ default "" ((($.Values.cloudMarketplace).googleCloud).serviceAccountKey) | quote }}
  {{- end }}
- name: GOOGLE_CLOUD_MARKETPLACE_SERVICE_NAME
  value: {{ default "" ((($.Values.cloudMarketplace).googleCloud).serviceName) | quote }}
- name: GOOGLE_CLOUD_MARKETPLACE_USAGE_METRIC
  value: {{ default "" ((($.Values.cloudMarketplace).googleCloud).usageMetric) | quote }}
- name: GOOGLE_CLOUD_MARKETPLACE_PUBSUB_SERVICE_ACCOUNT_EMAIL
  value: {{ default "" ((($.Values.cloudMarketplace).googleCloud).pubSubServiceAccountEmail) | quote }}
- name: GOOGLE_CLOUD_MARKETPLACE_SIGNUP_AUDIENCE
  value: {{ default "" ((($.Values.cloudMarketplace).googleCloud).signupAudience) | quote }}
- name: GOOGLE_CLOUD_MARKETPLACE_PUBSUB_AUDIENCE
  value: {{ default "" ((($.Values.cloudMarketplace).googleCloud).pubSubAudience) | quote }}
- name: VERCEL_MARKETPLACE_CLIENT_ID
  value: {{ default "" ((($.Values.cloudMarketplace).vercel).clientId) | quote }}
- name: VERCEL_MARKETPLACE_CLIENT_SECRET
  {{- if ((($.Values.cloudMarketplace).vercel).existingSecret) }}
  valueFrom:
    secretKeyRef:
      name: {{ $.Values.cloudMarketplace.vercel.existingSecret.name | quote }}
      key: {{ $.Values.cloudMarketplace.vercel.existingSecret.clientSecretKey | quote }}
  {{- else }}
  value: {{ default "" ((($.Values.cloudMarketplace).vercel).clientSecret) | quote }}
  {{- end }}

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

- name: NOTIFICATION_SLACK_WEBHOOK_ON_AI_FEEDBACK
  value: {{ $.Values.notifications.webhooks.slack.onAiFeedback }}

- name: LETS_ENCRYPT_NOTIFICATION_EMAIL
  value: {{ $.Values.letsEncrypt.email }}

- name: LETS_ENCRYPT_ACCOUNT_KEY
  value: {{ $.Values.letsEncrypt.accountKey }}

- name: ENCRYPTION_SECRET
  {{- if $.Values.encryptionSecret }}
  value: {{ $.Values.encryptionSecret }}
  {{- else }}
  {{- if ((($.Values.externalSecrets).encryptionSecret).existingSecret).name }}
  valueFrom:
    secretKeyRef:
      name: {{ ((($.Values.externalSecrets).encryptionSecret).existingSecret).name }}
      key: {{ ((($.Values.externalSecrets).encryptionSecret).existingSecret).passwordKey }}
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




{{/*
  Cache / queue wiring.

  Every setting is emitted TWICE: once as VALKEY_*, and once as the REDIS_* name
  it used until 13.0.0, carrying the identical value. The app reads VALKEY_*
  and only falls back to REDIS_*, so for a matching image the second copy is
  dead weight -- it is here because `image.tag` is a documented pin (the
  production checklist tells you to set it), so a chart from after the rename
  routinely runs an app image from before it. Dropping the REDIS_* copy silently
  points those pods at the "redis" default hostname instead.
*/}}
{{- $valkey := include "oneuptime.valkey" . | fromYaml }}
{{- $externalValkey := include "oneuptime.externalValkey" . | fromYaml }}

{{- $valkeyHost := ternary (printf "%s-valkey-master.%s.svc.%s" $.Release.Name $.Release.Namespace $.Values.global.clusterDomain) (toString ($externalValkey.host | default "")) $valkey.enabled }}
{{- $valkeyPort := ternary (include "oneuptime.valkey.port" .) (toString ($externalValkey.port | default "")) $valkey.enabled }}
{{- $valkeyDb := ternary "0" (toString ($externalValkey.database | default "")) $valkey.enabled }}
{{- $valkeyUsername := ternary "default" (toString ($externalValkey.username | default "")) $valkey.enabled }}
{{- $valkeyIpFamily := ternary (toString ($valkey.ipFamily | default "")) (toString ($externalValkey.ipFamily | default "")) $valkey.enabled }}

{{- range $name := (list "VALKEY" "REDIS") }}
- name: {{ $name }}_HOST
  value: {{ $valkeyHost | quote }}
- name: {{ $name }}_PORT
  value: {{ $valkeyPort | quote }}
- name: {{ $name }}_PASSWORD
  {{- if $valkey.enabled }}
  valueFrom:
    secretKeyRef:
      {{- if $valkey.auth.existingSecret.name }}
      name: {{ $valkey.auth.existingSecret.name }}
      key: {{ $valkey.auth.existingSecret.passwordKey }}
      {{- else }}
      name: {{ $.Release.Name }}-valkey
      key: valkey-password
      {{- end }}
  {{- else }}
  {{- if $externalValkey.password }}
  valueFrom:
    secretKeyRef:
        name: {{ printf "%s-%s" $.Release.Name "external-valkey"  }}
        key: password
  {{- end }}
  {{- if $externalValkey.existingSecret.name }}
  valueFrom:
    secretKeyRef:
        name: {{ printf "%s" $externalValkey.existingSecret.name }}
        key: {{ $externalValkey.existingSecret.passwordKey }}
  {{- end }}
  {{- end }}
- name: {{ $name }}_IP_FAMILY
  value: {{ $valkeyIpFamily | quote }}
- name: {{ $name }}_DB
  value: {{ $valkeyDb | quote }}
- name: {{ $name }}_USERNAME
  value: {{ $valkeyUsername | quote }}

## CACHE TLS BLOCK -- only an external cache can carry certificates.
{{- if not $valkey.enabled }}
{{- if $externalValkey.tls.enabled }}

{{- if $externalValkey.tls.ca }}
- name: {{ $name }}_TLS_CA
  valueFrom:
    secretKeyRef:
        name: {{ printf "%s-%s" $.Release.Name "external-valkey"  }}
        key: tls-ca
{{- end }}

{{- if $externalValkey.tls.cert }}
- name: {{ $name }}_TLS_CERT
  valueFrom:
    secretKeyRef:
        name: {{ printf "%s-%s" $.Release.Name "external-valkey"  }}
        key: tls-cert
{{- end }}

{{- if $externalValkey.tls.key }}
- name: {{ $name }}_TLS_KEY
  valueFrom:
    secretKeyRef:
        name: {{ printf "%s-%s" $.Release.Name "external-valkey"  }}
        key: tls-key
{{- end }}
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
# Nor do they start on a schema older than their code: each waits at boot for
# the migrate Job to apply the schema migrations it needs
# (migrate.runtimeWaitTimeoutSeconds). Except on an install with migrate.hook:
# that post-install hook runs only after these pods exist (after they are ready,
# under `helm install --wait` and Argo CD), so they must not wait for it.
{{- if and $.Values.migrate.hook $.Release.IsInstall }}
- name: DATABASE_MIGRATION_WAIT_TIMEOUT_MS
  value: "0"
{{- else if not (kindIs "invalid" $.Values.migrate.runtimeWaitTimeoutSeconds) }}
- name: DATABASE_MIGRATION_WAIT_TIMEOUT_MS
  value: {{ mul (int $.Values.migrate.runtimeWaitTimeoutSeconds) 1000 | quote }}
{{- end }}
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

- name: DISABLE_UPDATE_CHECK
  value: {{ default false $.Values.updateCheck.disabled | squote }}

- name: LATEST_RELEASE_CHECK_URL
  value: {{ default "" $.Values.updateCheck.url | quote }}

- name: DISABLE_INSTANCE_CHECK_IN
  value: {{ default false (($.Values.instanceCheckIn).disabled) | squote }}

{{/*
  Not `default 1 ...`: Helm's default treats 0 as empty, and 0 is a meaningful
  setting here (ignore X-Forwarded-For, use the connecting address).
*/}}
- name: TRUSTED_PROXY_HOPS
{{- if kindIs "invalid" $.Values.trustedProxyHops }}
  value: '1'
{{- else }}
  value: {{ $.Values.trustedProxyHops | squote }}
{{- end }}

{{/*
  On-call calendar feeds: the kill switch and the fixed-window rate limits for
  the token-in-URL .ics routes. `default` is safe on the limits because 0 is
  not a valid value for any of them (the app falls back to its default too).
*/}}
- name: DISABLE_ON_CALL_CALENDAR_FEED
  value: {{ default false $.Values.onCallCalendarFeed.disabled | squote }}

- name: ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS
  value: {{ default 60 $.Values.onCallCalendarFeed.rateLimit.windowSeconds | squote }}

- name: ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW
  value: {{ default 60 $.Values.onCallCalendarFeed.rateLimit.perTokenPerWindow | squote }}

- name: ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW
  value: {{ default 3000 $.Values.onCallCalendarFeed.rateLimit.perIpPerWindow | squote }}

{{/*
  OAuth sign-in for the MCP server: the kill switch, and the switch for
  instances that cannot fetch a client's metadata document. Read through
  `dig` so a values file written before these keys existed still renders.
*/}}
- name: DISABLE_MCP_OAUTH
  value: {{ dig "disabled" false ($.Values.mcpOAuth | default dict) | squote }}

- name: DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS
  value: {{ dig "disableClientIdMetadataDocuments" false ($.Values.mcpOAuth | default dict) | squote }}

{{/*
  Source map ingestion and resolution limits. `default` is safe on all of
  these because 0 is not a valid value for any of them -- the app falls back
  to its own default too -- and every one is clamped app-side, so a value the
  chart cannot honour is narrowed rather than silently ignored.

  `int64` before quoting is NOT decoration. Helm parses values.yaml through
  JSON, so a number arrives as a float64, and Go prints a float64 above 1e6 in
  exponent form: the 52428800 an operator wrote in a values file would reach
  the container as '5.24288e+07'. The same value passed with --set goes
  through strvals as an int64 and renders plainly, so without this the env var
  depends on HOW it was set, not what it was set to. Node's Number() happens
  to accept exponent notation, which is the only reason that was not already a
  bug -- and not a property to rely on.
*/}}
- name: SOURCE_MAP_MAX_MAPS_PER_RELEASE
  value: {{ default 1000 $.Values.sourceMaps.maxMapsPerRelease | int64 | squote }}

- name: SOURCE_MAP_MAX_FILES_PER_REQUEST
  value: {{ default 50 $.Values.sourceMaps.maxFilesPerRequest | int64 | squote }}

- name: SOURCE_MAP_MAX_FILE_SIZE_BYTES
  value: {{ default 52428800 $.Values.sourceMaps.maxFileSizeBytes | int64 | squote }}

- name: SOURCE_MAP_MAX_BYTES_PER_RESOLVE
  value: {{ default 536870912 $.Values.sourceMaps.maxBytesPerResolve | int64 | squote }}

- name: SOURCE_MAP_RETENTION_DAYS
  value: {{ default 90 $.Values.sourceMaps.retentionDays | int64 | squote }}

- name: WORKFLOW_SCRIPT_TIMEOUT_IN_MS
  value: {{ $.Values.script.workflowScriptTimeoutInMs | squote }}

- name: WORKFLOW_TIMEOUT_IN_MS
  value: {{ $.Values.script.workflowTimeoutInMs | squote }}

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

{{/*
Kubernetes identity for OneUptime's own telemetry. Without it the OpenTelemetry
SDK only reports host.name — the pod hostname — so every pod that ever ran is
catalogued as a separate "host". Usage:
  include "oneuptime.env.telemetryIdentity" (dict "Values" $.Values "DeploymentName" (printf "%s-%s" $.Release.Name "app"))
*/}}
{{- define "oneuptime.env.telemetryIdentity" }}
{{- include "oneuptime.env.pod" . }}
- name: POD_UID
  valueFrom:
    fieldRef:
      fieldPath: metadata.uid
- name: K8S_DEPLOYMENT_NAME
  value: {{ .DeploymentName | quote }}
{{- if .Values.openTelemetryExporter.kubernetesClusterName }}
- name: K8S_CLUSTER_NAME
  value: {{ .Values.openTelemetryExporter.kubernetesClusterName | quote }}
{{- end }}
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


{{/*
Pod nodeSelector with the Linux-only pin merged in.

Every image this chart deploys — the OneUptime services as well as the
bundled postgres, valkey, clickhouse, pgbouncer, kubectl and vLLM images —
is built for linux only. On mixed-OS clusters (e.g. AKS with Windows node
pools) an unpinned pod spec can be scheduled onto a Windows node, where the
image pull can never succeed and the pod sits in ImagePullBackOff forever.
The kubelet labels every node with kubernetes.io/os (stable since
Kubernetes 1.14), so requiring "linux" is always safe.

Takes the workload's user-configured nodeSelector map (or an empty dict when
the workload has no such knob). User-supplied keys win on conflict.

Usage (the include is nindent-ed under the `nodeSelector:` key):
  nodeSelector:
    {{`{{- include "oneuptime.nodeSelector" .Values.app.nodeSelector | nindent 8 }}`}}
*/}}
{{- define "oneuptime.nodeSelector" -}}
{{- /* mergeOverwrite, not merge: sprig merge won't let a zero value ("")
     in the user map displace the pin, breaking last-writer-wins. The
     dest dict is a fresh literal, so .Values is never mutated. */ -}}
{{- toYaml (mergeOverwrite (dict "kubernetes.io/os" "linux") (. | default dict)) -}}
{{- end }}


{{/*
Pod topology spread constraints for a stateless OneUptime service.

The first of these that is set wins:
  1. the service's own list (.Constraints);
  2. the chart-wide `topologySpreadConstraints`, unless the service passes
     "SkipChartWide" (pgbouncer, whose nodeSelector, affinity and tolerations
     never inherit the chart-wide ones either);
  3. when `deployment.spreadReplicasAcrossNodes` is on, one soft rule that
     spreads the service's replicas across nodes.
Renders nothing when none applies.

A constraint without a labelSelector is scoped to the service's own pods
(app: <release>-<service>). On Kubernetes 1.27 and later it is also counted per
rollout revision (matchLabelKeys: [pod-template-hash]) unless it lists
matchLabelKeys of its own. Counting per revision matters because an upgrade
rolls these pods: counted together with the old pods, the second new pod can
join the first on the node that already pulled the new image while the old
pods leave the other node, and the rollout ends with every replica on one
node. Before 1.27 the key is left out, because clusters older than 1.25 do not
know it and Helm's schema validation rejects the manifest.

The soft rule has no zone constraint on purpose. A pod that declares
topologySpreadConstraints replaces the scheduler's built-in defaults, and the
scheduler then leaves out of the scoring every node that lacks one of the
constraints' topology keys. On clusters whose nodes carry no zone label (bare
metal, kind, k3s) a zone constraint would switch the spreading off entirely.
Multi-zone installs add one through `topologySpreadConstraints`.

Each constraint is deep-copied before the labelSelector is filled in, so one
service's selector never leaks into the chart-wide list the next service reads.

Usage (nindent-ed to the pod spec's indentation):
  {{`{{- include "oneuptime.topologySpreadConstraints" (dict "ServiceName" "app" "Constraints" $.Values.app.topologySpreadConstraints "Release" $.Release "Values" $.Values "Capabilities" $.Capabilities) | nindent 6 }}`}}
*/}}
{{- define "oneuptime.topologySpreadConstraints" -}}
{{- $constraints := .Constraints -}}
{{- if and (not $constraints) (not .SkipChartWide) -}}
{{- $constraints = .Values.topologySpreadConstraints -}}
{{- end -}}
{{- if and (not $constraints) .Values.deployment.spreadReplicasAcrossNodes -}}
{{- $constraints = list (dict "maxSkew" 1 "topologyKey" "kubernetes.io/hostname" "whenUnsatisfiable" "ScheduleAnyway") -}}
{{- end -}}
{{- if $constraints -}}
{{- $rendered := list -}}
{{- range $constraints -}}
{{- $constraint := deepCopy . -}}
{{- if not (hasKey $constraint "labelSelector") -}}
{{- $_ := set $constraint "labelSelector" (dict "matchLabels" (dict "app" (printf "%s-%s" $.Release.Name $.ServiceName))) -}}
{{- if and (not (hasKey $constraint "matchLabelKeys")) (semverCompare ">=1.27-0" $.Capabilities.KubeVersion.Version) -}}
{{- $_ := set $constraint "matchLabelKeys" (list "pod-template-hash") -}}
{{- end -}}
{{- end -}}
{{- $rendered = append $rendered $constraint -}}
{{- end -}}
topologySpreadConstraints:
{{ toYaml $rendered | indent 2 }}
{{- end -}}
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
      {{- with ($.Affinity | default $.Values.affinity) }}
      affinity: {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- include "oneuptime.topologySpreadConstraints" (dict "ServiceName" $.ServiceName "Constraints" $.TopologySpreadConstraints "Release" $.Release "Values" $.Values "Capabilities" $.Capabilities) | nindent 6 }}
      {{- if $.Values.tolerations }}
      tolerations: {{- $.Values.tolerations | toYaml | nindent 8 }}
      {{- end }}
      nodeSelector:
        {{- include "oneuptime.nodeSelector" ($.NodeSelector | default $.Values.nodeSelector) | nindent 8 }}
      {{- if or $.Volumes $.ExtraVolumes }}
      volumes:
      {{- range $key, $val := $.Volumes }}
        - name: {{ $key }}
          emptyDir:
            sizeLimit: {{ $val.SizeLimit }}
      {{- end }}
      {{- with $.ExtraVolumes }}
        {{- toYaml . | nindent 8 }}
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
            {{- with $.ExtraEnv }}
            {{- toYaml . | nindent 12 }}
            {{- end }}
          {{- if or $.Volumes $.ExtraVolumeMounts }}
          volumeMounts:
            {{- range $key, $val := $.Volumes }}
            - name: {{ $key }}
              mountPath: {{ $val.MountPath }}
            {{- end }}
            {{- with $.ExtraVolumeMounts }}
            {{- toYaml . | nindent 12 }}
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
Whether THIS release installs the bundled KEDA operator subchart. Returns the
string "true" or "" so it composes with `if`/`eq`.

This must agree with the `condition: keda.install,keda.enabled` on the keda
dependency in Chart.yaml, because Helm evaluates that condition itself and the
templates never see the result. Helm walks the comma-separated paths in order and
takes the FIRST one that resolves to an actual bool — a path that is absent, null
or a quoted string is skipped (with a warning, in the non-absent cases) and the
next path is tried. `kindIs "bool"` reproduces that test exactly; anything looser
(hasKey, a plain truthiness check, `default`) would disagree with Helm on a
`--set-string keda.install=true`, and the guard that reads this would then talk
about an operator that is not there, or stay silent about one that is. (`install:
~` cannot get this far — values.schema.json pins install to boolean — but the
test costs nothing and keeps this honest if that ever loosens.)

Usage: include "oneuptime.kedaOperatorInstalled" .   ($ or any ctx with .Values)
*/}}
{{- define "oneuptime.kedaOperatorInstalled" -}}
{{- $install := .Values.keda.enabled -}}
{{- if kindIs "bool" .Values.keda.install -}}
{{- $install = .Values.keda.install -}}
{{- end -}}
{{- if $install }}true{{ end -}}
{{- end }}


{{/*
KEDA ScaledObject template for metric-based autoscaling
Usage: include "oneuptime.kedaScaledObject" (dict "ServiceName" "service-name" "Release" .Release "Values" .Values "MetricsConfig" {...})

This helper emits TWO objects (a ScaledObject and a TriggerAuthentication) and is
included back to back, once per enabled tier. Both objects therefore MUST open
with their own `---`: Helm's manifest splitter only breaks documents on a `---`
line, so without the leading separator each TriggerAuthentication would be glued
into the same YAML document as the next include's ScaledObject, and on decode the
later duplicate top-level keys win — silently dropping the earlier object.
*/}}
{{- define "oneuptime.kedaScaledObject" }}
{{- if and .Values.keda.enabled .MetricsConfig.enabled (not .DisableAutoscaler) }}
---
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
        valueLocation: {{ .valueLocation | default "queueSize" | squote }}
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
    {{- if (((.Values.externalSecrets).oneuptimeSecret).existingSecret).name }}
    - parameter: clusterkey
      name: {{ (((.Values.externalSecrets).oneuptimeSecret).existingSecret).name }}
      key: {{ (((.Values.externalSecrets).oneuptimeSecret).existingSecret).passwordKey }}
    {{- else }}
    - parameter: clusterkey
      name: {{ printf "%s-%s" .Release.Name "secrets" }}
      key: oneuptime-secret
    {{- end }}
{{- end }}
{{- end }}

{{/*
TELEMETRY_WRITER_URL for pods that process telemetry ingest (app, worker).
Emitted only when the dedicated telemetry-writer tier is enabled: the fan-in
writer on these pods then ships ClickHouse inserts to that tier over HTTP, so
ClickHouse insert concurrency is (telemetryWriter.replicaCount x
telemetryWriter.telemetryFanInMaxConcurrentInserts) no matter how far the
worker fleet scales. The telemetry-writer pods themselves MUST NOT get this
var — its absence is what makes them insert directly (and they refuse to
serve inserts when it is set, to prevent forwarding loops).
*/}}
{{- define "oneuptime.env.telemetryWriterUrl" }}
{{- if $.Values.telemetryWriter.enabled }}
- name: TELEMETRY_WRITER_URL
  value: http://{{ $.Release.Name }}-telemetry-writer.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}:{{ $.Values.telemetryWriter.ports.http }}
{{- end }}
{{- end }}
