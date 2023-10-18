{{- define "oneuptime.env.common" }}
- name: HOST
  value: {{ $.Values.host }}
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
- name: METERED_PLAN_ACTIVE_MONITORING
  value: {{ $.Values.meteredPlan.activeMonitoring }}
- name: ANALYTICS_KEY
  value: {{ $.Values.analytics.key }}
- name: ANALYTICS_HOST
  value: {{ $.Values.analytics.host }}
- name: SERVER_ACCOUNTS_HOSTNAME
  value: {{ $.Release.Name }}-accounts.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_DASHBOARD_API_HOSTNAME
  value: {{ $.Release.Name }}-dashboard-api.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_WORKFLOW_HOSTNAME
  value: {{ $.Release.Name }}-workflow.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_LINK_SHORTENER_HOSTNAME
  value: {{ $.Release.Name }}-link-shortener.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_INGESTOR_HOSTNAME
  value: {{ $.Release.Name }}-ingestor.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_TEST_SERVER_HOSTNAME
  value: {{ $.Release.Name }}-test-server.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_FILE_HOSTNAME
  value: {{ $.Release.Name }}-file.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_HOME_HOSTNAME
  value: {{ $.Release.Name }}-home.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_IDENTITY_HOSTNAME
  value: {{ $.Release.Name }}-identity.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_NOTIFICATION_HOSTNAME
  value: {{ $.Release.Name }}-notification.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: OTEL_COLLECTOR_HOSTNAME
  value: {{ $.Release.Name }}-otel-collector.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_WORKERS_HOSTNAME
  value: {{ $.Release.Name }}-workers.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_STATUS_PAGE_HOSTNAME
  value: {{ $.Release.Name }}-status-page.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_DASHBOARD_HOSTNAME
  value: {{ $.Release.Name }}-dashboard.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_ADMIN_DASHBOARD_HOSTNAME
  value: {{ $.Release.Name }}-admin-dashboard.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: SERVER_API_REFERENCE_HOSTNAME
  value: {{ $.Release.Name }}-api-reference.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}

- name: DASHBOARD_API_PORT
  value: {{ $.Values.port.dashboardApi | squote }}
- name: API_REFERENCE_PORT
  value: {{ $.Values.port.apiReference | squote }}
- name: WORKFLOW_PORT
  value: {{ $.Values.port.workflow | squote }}
- name: LINK_SHORTENER_PORT
  value: {{ $.Values.port.linkShortener | squote }}
- name: ALERT_PORT
  value: {{ $.Values.port.alert | squote }}
- name: INGESTOR_PORT
  value: {{ $.Values.port.ingestor | squote }}
- name: PROBE_PORT
  value: {{ $.Values.port.probe | squote }}
- name: TEST_SERVER_PORT
  value: {{ $.Values.port.testServer | squote }}
- name: FILE_PORT
  value: {{ $.Values.port.file | squote }}
- name: HOME_PORT
  value: {{ $.Values.port.home | squote }}
- name: IDENTITY_PORT
  value: {{ $.Values.port.identity | squote }}
- name: NOTIFICATION_PORT
  value: {{ $.Values.port.notification | squote }}
- name: REALTIME_PORT
  value: {{ $.Values.port.realtime | squote }}
- name: WORKERS_PORT
  value: {{ $.Values.port.workers | squote }}
- name: ACCOUNTS_PORT
  value: {{ $.Values.port.accounts | squote }}
- name: STATUS_PAGE_PORT
  value: {{ $.Values.port.statusPage | squote }}
- name: DASHBOARD_PORT
  value: {{ $.Values.port.dashboard | squote }}
- name: ADMIN_DASHBOARD_PORT
  value: {{ $.Values.port.adminDashboard | squote }}
- name: OTEL_COLLECTOR_PORT
  value: {{ $.Values.port.otelCollector | squote }}
{{- end }}


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
  valueFrom:
    secretKeyRef:
      name: {{ printf "%s-%s" $.Release.Name "secrets"  }}
      key: oneuptime-secret
- name: ENCRYPTION_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ printf "%s-%s" $.Release.Name "secrets"  }}
      key: encryption-secret

- name: CLICKHOUSE_USER
  value: {{ $.Values.clickhouse.auth.username }}
- name: CLICKHOUSE_PASSWORD
  valueFrom: 
    secretKeyRef:
        name: {{ printf "%s-%s" $.Release.Name "clickhouse"  }}
        key: admin-password
- name: CLICKHOUSE_HOST
  value: {{ $.Release.Name }}-clickhouse.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: CLICKHOUSE_PORT
  value: {{ printf "8123" | squote}}
- name: CLICKHOUSE_DATABASE
  value: {{ printf "oneuptime" | squote}}

- name: REDIS_HOST
  value: {{ $.Release.Name }}-redis-master.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: REDIS_PORT
  value: {{ printf "6379" | squote}}
- name: REDIS_PASSWORD
  valueFrom: 
    secretKeyRef:
        name: {{ printf "%s-%s" $.Release.Name "redis"  }}
        key: redis-password
- name: REDIS_DB
  value: {{ printf "0" | squote}}
- name: REDIS_USERNAME
  value: default

- name: DATABASE_HOST
  value: {{ $.Release.Name }}-postgresql.{{ $.Release.Namespace }}.svc.{{ $.Values.global.clusterDomain }}
- name: DATABASE_PORT 
  value: {{ printf "5432" | squote}}
- name: DATABASE_USERNAME
  value: {{ $.Values.postgresql.auth.username }}
- name: DATABASE_PASSWORD 
  valueFrom: 
    secretKeyRef:
        name: {{ printf "%s-%s" $.Release.Name "postgresql"  }}
        key: password
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
  ports:
    - port: {{ $.Port }}
      targetPort: {{ $.Port }}
      name: port
    {{- if $.isHTTPSPortEnabled }}
    - port: 443
      targetPort: 443
      name: https
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
  replicas: {{ $.Values.deployment.replicaCount }}
  template:
    metadata:
      labels:
        app: {{ printf "%s-%s" $.Release.Name $.ServiceName  }}
        date: "{{ now | unixEpoch }}"
    spec:
      {{- if $.Volumes }}
      volumes:
      {{- range $key, $val := $.Volumes }}
        - name: {{ $key }}
          persistentVolumeClaim:
            claimName: {{ $val.Name }}
      {{- end }}
      {{- end }}
      containers:
        {{- if $.ImageName }}
        - image: {{ printf "%s/%s/%s:%s" .Values.image.registry .Values.image.repository $.ImageName .Values.image.tag }}
        {{- else }}
        - image: {{ printf "%s/%s/%s:%s" .Values.image.registry .Values.image.repository $.ServiceName .Values.image.tag }}
        {{- end}}
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
          {{- if $.Volumes }}
          volumeMounts:
            {{- range $key, $val := $.Volumes }}
            - name: {{ $key }}
              mountPath: {{ $val.MountPath }}
            {{- end }}
          {{- end }}
          {{- if $.Port }}
          ports:
            - containerPort: {{ $.Port }}
              protocol: TCP
              name: http
              {{- if $.isHTTPSPortEnabled }}
            - containerPort: 443
              protocol: TCP
              name: https
              {{- end }}
          {{- end }}
      restartPolicy: {{ $.Values.image.restartPolicy }}
{{- end }}



{{- define "oneuptime.autoscaler" }}
{{- if .Values.autoscaling.enabled }}
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