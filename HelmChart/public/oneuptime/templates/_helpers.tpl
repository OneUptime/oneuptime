{{- define "oneuptime.env.common" }}
- name: HOST
  value: {{ $.Values.host }}
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
- name: METERED_PLAN_ACTIVE_MONITORING
  value: {{ $.Values.meteredPlan.activeMonitoring }}
- name: ANALYTICS_KEY
  value: {{ $.Values.analytics.key }}
- name: ANALYTICS_HOST
  value: {{ $.Values.analytics.host }}
{{- end }}


{{- define "oneuptime.env.probe-api-url" }}
{{ $.Release.Name }}-probe-api.{{ $.Release.Namespace }}.svc.cluster.local
{{- end}}


{{- define "oneuptime.env.commonUi" }}
- name: IS_SERVER
  value: {{ printf "false" | squote }}
- name: STATUS_PAGE_CNAME_RECORD
  value: {{ $.Values.statusPage.cnameRecord }}
{{- end }}


{{- define "oneuptime.env.commonServer" }}
- name: IS_SERVER
  value: {{ printf "true" | squote }}

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
  value: {{ printf "8123" | squote}}
- name: CLICKHOUSE_DATABASE
  value: {{ $.Values.clickhouse.database }}

- name: REDIS_HOST
  value: {{ $.Release.Name }}-redis-master.{{ $.Release.Namespace }}.svc.cluster.local
- name: REDIS_PORT
  value: {{ printf "6379" | squote}}
- name: REDIS_PASSWORD
  value: {{ $.Values.redis.password }}
- name: REDIS_DB
  value: {{ printf "0" | squote}}
- name: REDIS_USERNAME
  value: default

- name: DATABASE_HOST
  value: {{ $.Release.Name }}-postgresql.{{ $.Release.Namespace }}.svc.cluster.local
- name: DATABASE_PORT 
  value: {{ printf "5432" | squote}}
- name: DATABASE_USERNAME
  value: {{ $.Values.postgresql.auth.username }}
- name: DATABASE_PASSWORD 
  value: {{ $.Values.postgresql.auth.password }}
- name: DATABASE_DATABASE 
  value: {{ $.Values.postgresql.auth.database }}


- name: BILLING_PRIVATE_KEY
  value: {{ $.Values.billing.privateKey }}


- name: DISABLE_AUTOMATIC_INCIDENT_CREATION
  value: {{ $.Values.incidents.disableAutomaticCreation | squote }}
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
  name: {{ printf "%s-%s" $.Release.Name $.ServiceName  }}
  namespace: {{ $.Release.Namespace }}
spec:
  ports:
    - port: {{ $.Port }}
      targetPort: {{ $.Port }}
      name: port
  selector:
      app: {{ printf "%s-%s" $.Release.Name $.ServiceName  }}
  type: ClusterIP
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
spec:
  selector:
    matchLabels:
      app: {{ printf "%s-%s" $.Release.Name $.ServiceName  }}
  replicas: {{ $.Values.replicaCount }}
  template:
    metadata:
      labels:
        app: {{ printf "%s-%s" $.Release.Name $.ServiceName  }}
    spec:
      containers:
        - image: {{ printf "%s/%s/%s:%s" .Values.image.registry .Values.image.repository $.ServiceName .Values.image.tag }}
          name: {{ printf "%s-%s" $.Release.Name $.ServiceName  }}
          imagePullPolicy: {{ $.Values.image.pullPolicy }}
          env:
            {{- include "oneuptime.env.common" . | nindent 12 }}
            {{- if $.IsUI }}
            {{- include "oneuptime.env.commonUi" . | nindent 12 }}
            {{- end }}
            {{- if $.IsServer  }}
            {{- include "oneuptime.env.commonServer" . | nindent 12 }}
            {{- end }}
            {{- if $.Env }}
            {{- range $key, $val := $.Env }}
            - name: {{ $key }}
              value: {{ $val | squote }}
            {{- end }}
            {{- end }}
          ports:
            - containerPort: {{ $.Port }}
              hostPort: {{ $.Port }}
              protocol: TCP
              name: http
      restartPolicy: {{ $.Values.image.restartPolicy }}
{{- end }}



{{- define "oneuptime.autoscaler" }}
{{- if .Values.autoscaling.enabled }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ printf "%s-%s" $.Release.Name $.ServiceName  }}
  namespace: {{ $.Release.Namespace }}
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