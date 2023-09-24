{{- define "oneuptime.env.common" }}
- name: HOST
  value: {{ $.Values.host }}
- name: NODE_ENV
  value: {{ $.Values.nodeEnvironment }}
- name: BILLING_ENABLED
  value: {{ $.Values.billing.enabled }}
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
- name: METERED_PLAN_ACTIVE_MONITORING
  value: {{ $.Values.meteredPlan.activeMonitoring }}
- name: ANALYTICS_KEY
  value: {{ $.Values.analytics.key }}
- name: ANALYTICS_HOST
  value: {{ $.Values.analytics.host }}
{{- end }}





{{- define "oneuptime.env.commonUi" }}
- name: IS_SERVER
  value: false
- name: STATUS_PAGE_CNAME_RECORD
  value: {{ $.Values.statusPage.cnameRecord }}
{{- end }}


{{- define "oneuptime.env.commonServer" }}
- name: IS_SERVER
  value: true

- name: ONEUPTIME_SECRET
  value: {{ $.Values.secrets.oneuptime }}
- name: ENCRYPTION_SECRET
  value: {{ $.Values.secrets.encryption }}

- name: CLICKHOUSE_USER
  value: {{ $.Values.clickhouse.user }}
- name: CLICKHOUSE_PASSWORD
  value: {{ $.Values.clickhouse.password }}
- name: CLICKHOUSE_HOST
  value: {{ $.Values.clickhouse.host }}
- name: CLICKHOUSE_PORT
  value: {{ $.Values.clickhouse.port }}
- name: CLICKHOUSE_DATABASE
  value: {{ $.Values.clickhouse.database }}

- name: REDIS_HOST
  value: {{ $.Values.redis.host }}
- name: REDIS_PORT
  value: {{ $.Values.redis.port }}
- name: REDIS_PASSWORD
  value: {{ $.Values.redis.password }}
- name: REDIS_DB
  value: {{ $.Values.redis.database }}
- name: REDIS_USERNAME
  value: {{ $.Values.redis.user }}
- name: REDIS_TLS_CA
  value: {{ $.Values.redis.tlsCa }}
- name: REDIS_TLS_SENTINEL_MODE
  value: {{ $.Values.redis.tlsSentinelMode }}

- name: POSTGRES_HOST
  value: {{ $.Values.postgres.host }}
- name: POSTGRES_PORT 
  value: {{ $.Values.postgres.port }}
- name: POSTGRES_USER
  value: {{ $.Values.postgres.user }}
- name: POSTGRES_PASSWORD 
  value: {{ $.Values.postgres.password }}
- name: POSTGRES_DATABASE 
  value: {{ $.Values.postgres.database }}
- name: POSTGRES_SSL_CA 
  value: {{ $.Values.postgres.sslCa }}
- name: POSTGRES_SSL_CERT
  value: {{ $.Values.postgres.sslCert }}
- name: POSTGRES_SSL_KEY
  value: {{ $.Values.postgres.sslKey }}
- name: POSTGRES_SSL_REJECT_UNAUTHORIZED
  value: {{ $.Values.postgres.sslRejectUnauthorized }}

- name: BILLING_ENABLED
  value: {{ $.Values.billing.enabled }}
- name: BILLING_PUBLIC_KEY
  value: {{ $.Values.billing.publicKey }}
- name: BILLING_PRIVATE_KEY
  value: {{ $.Values.billing.privateKey }}


- name: DISABLE_AUTOMATIC_INCIDENT_CREATION
  value: {{ $.Values.incidents.disableAutomaticCreation }}
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



{{- define "oneuptime.service.clusterIP" }}
apiVersion: v1
kind: Service
metadata:
    labels:
        app: {{ printf "%s-%s" $.ReleaseName $.ServiceName  }}
        app.kubernetes.io/part-of: oneuptime
        app.kubernetes.io/managed-by: Helm
    name: {{ printf "%s-%s" $.ReleaseName $.ServiceName  }}
    namespace: {{ $.Namespace }}
spec:
    ports:
        - port: {{ $.Port }}
          targetPort: {{ $.Port }}
    selector:
        app: {{ printf "%s-%s" $.ReleaseName $.ServiceName  }}
    type: ClusterIP
{{- end }}