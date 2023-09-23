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
- name: ONEUPTIME_SECRET
  value: {{ $.Values.secrets.oneuptime }}
- name: CLICKHOUSE_USER
  value: {{ $.Values.clickhouse.user }}
  
{{- end }}