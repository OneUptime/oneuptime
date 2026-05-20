# Instalar el agente de Kubernetes

El agente de Kubernetes de OneUptime recopila métricas del clúster, eventos, registros de Pod, **trazas de aplicación (HTTP/gRPC mediante eBPF)** y **métricas de nodos a nivel de sistema operativo** desde su clúster de Kubernetes y los envía a OneUptime. Se distribuye como un chart de Helm y se instala con un solo comando — la auto-instrumentación eBPF está activada por defecto, por lo que verá trazas a nivel de servicio y métricas RED sin cambios de código. Los **gráficos de llamas continuos de CPU (perfilador eBPF)** también están disponibles — actívelos con `--set profiling.enabled=true` cuando desee más telemetría.

## Inicio rápido

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update

helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=<A_UNIQUE_NAME_FOR_THIS_CLUSTER>
```

Su clúster aparecerá en OneUptime en pocos minutos.

## Elija el preset adecuado para su clúster

Diferentes distribuciones de Kubernetes tienen restricciones distintas — sobre todo, si las cargas de trabajo pueden montar volúmenes `hostPath`. En lugar de obligarle a leer documentación de seguridad, el chart expone una sola opción de nivel superior: `preset`.

| Preset | Usar para | Recopilación de registros | Notas |
| --- | --- | --- | --- |
| `standard` (por defecto) | Autogestionado, **EKS en EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet leyendo `/var/log/pods` mediante hostPath | Menor sobrecarga. hostPath está disponible en estas plataformas. |
| `gke-autopilot` | **GKE Autopilot** | Tailer de la API de Kubernetes (Deployment) | hostPath está bloqueado en Autopilot. Establece un contexto de seguridad reforzado que pasa los Pod Security Standards de Autopilot. |
| `eks-fargate` | **EKS Fargate** | Tailer de la API de Kubernetes (Deployment) | Igual que `gke-autopilot`. Fargate bloquea hostPath y DaemonSets. |

Si no está seguro, deje `preset` sin establecer — obtendrá los valores por defecto de `standard`. Si su clúster rechaza la instalación con un error de política de seguridad de Pod mencionando `hostPath`, cambie a `gke-autopilot` (o `eks-fargate` en EKS Fargate) y reinstale.

### Ejemplos

**GKE Standard, EKS en EC2, autogestionado o AKS:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod
```

**GKE Autopilot:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod-gke-autopilot \
  --set preset=gke-autopilot
```

**EKS Fargate:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod-eks-fargate \
  --set preset=eks-fargate
```

## Cómo difieren los dos modos de recopilación de registros

Internamente, `preset` establece `logs.mode` — y también puede establecerlo directamente si necesita anular el valor por defecto del preset.

### Modo DaemonSet (`logs.mode: daemonset`)

Un DaemonSet ejecuta un pod del OpenTelemetry Collector por nodo. Lee archivos de registro bajo `/var/log/pods/` mediante un volumen hostPath y los reenvía por OTLP.

- **Pros:** menor sobrecarga, escala linealmente con los nodos, sin carga sobre el servidor de API de Kubernetes, maneja la rotación de registros.
- **Contras:** requiere hostPath, requiere la capacidad de programar DaemonSets — ambos no disponibles en GKE Autopilot y EKS Fargate.

### Modo API (`logs.mode: api`)

Un Deployment de una sola réplica (la imagen `oneuptime/kubernetes-log-tailer`) usa la API de Kubernetes para transmitir los registros de los contenedores — el mismo endpoint que usa `kubectl logs -f`. Sin hostPath, sin acceso al host, sin DaemonSet.

- **Pros:** funciona en GKE Autopilot, EKS Fargate y cualquier clúster que bloquee hostPath o aplique el Pod Security Standard `restricted`.
- **Contras:** cada flujo de contenedor es una conexión de larga duración a `kube-apiserver`. En la práctica, una réplica maneja cómodamente unos pocos miles de contenedores. Para clústeres muy grandes, fragmente por namespace usando `logs.api.replicas` junto con `namespaceFilters.include` en cada réplica.

### ¿Cuál debería usar?

Si hostPath funciona, use DaemonSet. En cualquier otro lugar, use el modo API. La configuración `preset` selecciona la correcta por usted.

También puede desactivar por completo la recopilación de registros con `--set logs.enabled=false` y enviar los registros de la aplicación mediante SDKs de OpenTelemetry. Consulte la documentación de [OpenTelemetry](/docs/telemetry/open-telemetry).

## Trazas de aplicación y peticiones HTTP mediante eBPF (activado por defecto)

El chart incluye un DaemonSet que ejecuta [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) en cada nodo. OBI carga programas eBPF en el kernel de Linux y observa el tráfico a nivel de socket para reconstruir llamadas HTTP/HTTPS, gRPC y SQL/Redis desde cada pod del nodo — sin cambios de código, sin SDK, sin sidecar. El tráfico capturado se exporta como trazas OTLP y métricas de petición/latencia directamente a OneUptime.

Después de instalar, sus servicios empiezan a aparecer bajo **Telemetry → Traces** y en el mapa de servicios en uno o dos minutos, con `k8s.cluster.name` establecido a su `clusterName` para que pueda filtrar por clúster.

### Cuándo desactivarlo

eBPF está **activado por defecto**. Debería desactivarlo (`--set ebpf.enabled=false`) si:

- Está instalando en **GKE Autopilot** o **EKS Fargate**. Esas plataformas bloquean los pods privilegiados, y OBI necesita el modo privilegiado para cargar los programas eBPF.
- Sus nodos ejecutan un kernel anterior a **Linux 5.8** sin retroportes de BTF. (Las distribuciones modernas — Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL/Stream 9+ — están bien.)
- Ya está enviando trazas mediante el SDK de OpenTelemetry desde sus aplicaciones y no quiere duplicados.

### Qué se emite

OBI extrae varias familias de señales del tráfico capturado. Todas están activadas por defecto; cada una puede desactivarse de forma independiente con `--set ebpf.features.<key>=false`:

| Señal | Por defecto | Qué añade |
| --- | --- | --- |
| `ebpf.features.httpMetrics` | on | Métricas RED de HTTP/gRPC — tasa de peticiones, histogramas de latencia, recuentos de errores — por servicio. |
| `ebpf.features.spanMetrics` | on | Métricas indexadas por atributos de span: tamaño de petición, tamaño de respuesta, duración desglosada por ruta/operación. |
| `ebpf.features.serviceGraph` | on | Métricas de aristas servicio-a-servicio (llamador → llamado, tasa de peticiones + latencia). Alimenta el mapa de servicios. |
| `ebpf.features.hostMetrics` | on | CPU y memoria por proceso instrumentado — evita ejecutar un perfilador separado para preguntas básicas de capacidad. |
| `ebpf.features.networkMetrics` | on | Contadores de bytes y paquetes de flujos TCP/UDP pod-a-pod con metadatos de k8s. Revela cada par de pods que se comunican, incluyendo los que ejecutan protocolos que OBI no puede analizar. |
| `ebpf.features.networkInterZoneMetrics` | off | Variante inter-zona de las métricas de red. Duplica la cardinalidad; sólo merece la pena activarla si realmente usa la programación basada en zonas. |
| `ebpf.features.tcpStats` | on | Estadísticas TCP a nivel de nodo: histogramas de RTT, recuentos de conexiones fallidas, retransmisiones. |

OBI también propaga el contexto de traza a través de los límites de servicio por defecto. Cuando el pod A hace una petición HTTP/gRPC al pod B, OBI inyecta una cabecera W3C `traceparent` en la petición saliente — para que el span resultante en el lado del pod B se enlace con la misma traza que la saliente del pod A. No se necesitan cambios de SDK en ninguna aplicación.

| Opción | Por defecto | Descripción |
| --- | --- | --- |
| `ebpf.contextPropagation` | on | Inyecta W3C `traceparent` en el tráfico saliente (cabeceras HTTP + opción TCP personalizada). Establézcalo a `false` para mantener los spans de cada servicio locales. |
| `ebpf.trackRequestHeaders` | on | Seguimiento de cabeceras de petición a nivel del kernel para que la propagación también funcione en servidores HTTP planos (no-Go, no-TLS). Sólo tiene efecto cuando `contextPropagation` es true. |

### Correlación registros ↔ trazas

También activado por defecto. El enriquecedor de registros de OBI intercepta las escrituras a stdout del pod desde los procesos instrumentados y:

- Para **registros en formato JSON**: inyecta los campos `trace_id` y `span_id` en la línea (cualquier valor existente en el registro se preserva). El DaemonSet filelog luego eleva esos campos a los slots nativos de trace_id/span_id del LogRecord, de modo que al hacer clic en un span en la vista de trazas se salta a sus registros en OneUptime — y al hacer clic en una línea de registro se salta a su traza padre.
- Para **registros que no son JSON**: la línea se preserva sin cambios — todavía se recopila, simplemente no se enlaza automáticamente.

| Opción | Por defecto | Descripción |
| --- | --- | --- |
| `ebpf.logToTraceCorrelation` | on | Habilita el enriquecedor de registros de OBI y la elevación de trace_id de la canalización filelog. Establézcalo a `false` para omitir ambos. |

Salvedades:

- **Los registros deben ser JSON para que aparezca trace_id.** Cambie su logger a un formateador JSON — `structlog`, `pino`, `winston`, `serilog`, `logback-json`, klog `--logging-format=json`, etc.
- **El stdout con búfer rompe la correlación** porque la llamada al sistema `write()` se dispara en un hilo diferente al que manejó la petición. Soluciones comunes:
  - **Python**: establezca `PYTHONUNBUFFERED=1` (el runtime hace búfer por bloques de stdout cuando no es una TTY).
  - **.NET**: al inicio, `Console.SetOut(new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true })`. Microsoft.Extensions.Logging `AddConsole()` y los sinks asíncronos de Serilog tampoco funcionarán — cambie a un escritor de consola síncrono (el `WriteTo.Console()` por defecto de Serilog está bien).
- Greenlet / gevent, Tornado y otros runtimes asíncronos personalizados no están cubiertos.

### Ajuste

| Opción | Por defecto | Descripción |
| --- | --- | --- |
| `ebpf.enabled` | `true` | Interruptor principal. Establézcalo a `false` para omitir por completo el DaemonSet eBPF. |
| `ebpf.image.tag` | `v0.9.0` | Etiqueta de imagen de OBI. OBI es pre-1.0; fije a una versión conocida buena y vuelva a probar en las actualizaciones. |
| `ebpf.autoTargetExe` | `*` | Glob de ejecutables a instrumentar. Acote esto (p. ej. `*/python,*/java`) si desea limitar el alcance de la auto-instrumentación. |
| `ebpf.excludeExePaths` | (shells, kubelet, runc, containerd, otelcol, el propio OBI) | Globs separados por comas que se omiten. |
| `ebpf.logLevel` | `info` | `debug`, `info`, `warn` o `error`. Establezca a `debug` durante la resolución de problemas. |
| `ebpf.printTraces` | `false` | Imprime spans al stdout de OBI además de la exportación OTLP — útil para verificar la captura durante la instalación. |
| `ebpf.resources.*` | `100m / 256Mi` requests, `1000m / 1Gi` limits | Aumente para clústeres de alto tráfico. |

Para verificar que OBI está ejecutándose y viendo tráfico:

```bash
kubectl get pods -n oneuptime-kubernetes-agent -l component=ebpf-instrument
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

## Perfilado continuo de CPU (desactivado por defecto)

Un DaemonSet separado ejecuta el [OpenTelemetry eBPF Profiler](https://github.com/open-telemetry/opentelemetry-ebpf-profiler) — empaquetado como la imagen `otel/opentelemetry-collector-ebpf-profiler`. Muestrea pilas en-CPU a 19Hz a través de cada runtime soportado (Go, Java, .NET, Python, Ruby, Node.js, PHP, Perl, C/C++, Rust) y envía perfiles OTLP a OneUptime, donde aparecen bajo **Telemetry → Performance Profiles** y como gráficos de llamas enlazados desde spans de traza individuales.

El perfilado está **desactivado por defecto** — es más pesado que la auto-instrumentación de OBI (más CPU por nodo, mayor huella de memoria) y no todos los clústeres quieren gráficos de llamas siempre activos. Actívelo cuando desee una telemetría más rica: `--set profiling.enabled=true`.

Cuando la auto-instrumentación eBPF también está activada (`ebpf.enabled: true`, el valor por defecto), cada muestra de CPU se correlaciona con el contexto de traza de OBI a través de un mapa bpffs compartido — de modo que los gráficos de llamas llevan trace_id/span_id y la interfaz de OneUptime puede mostrarle un gráfico de llamas por span.

Requisitos:

- **Kernel de Linux 5.10+** (ligeramente más nuevo que el 5.8 que necesita OBI).
- Pod privilegiado con hostPID — las mismas restricciones que el DaemonSet de auto-instrumentación eBPF. No puede ejecutarse en GKE Autopilot, EKS Fargate u otros entornos bloqueados.

Ajuste:

| Opción | Por defecto | Descripción |
| --- | --- | --- |
| `profiling.enabled` | `false` | Interruptor principal. Desactivado por defecto; actívelo para gráficos de llamas continuos de CPU. |
| `profiling.image.tag` | `0.152.0` | Etiqueta de imagen de `otel/opentelemetry-collector-ebpf-profiler`. El perfilador es pre-1.0; fije a una versión conocida buena. |
| `profiling.samplesPerSecond` | `19` | Frecuencia de muestreo en Hz. Valor por defecto del upstream; evita el aliasing accidental con frecuencias de temporizador comunes. |
| `profiling.offCpuThreshold` | `0` | (0–1] habilita el perfilado off-CPU — diagnostica contención de bloqueos y E/S bloqueante. Desactivado por defecto porque añade sobrecarga de tracepoint. |
| `profiling.tracers` | `""` *(todos los runtimes)* | Lista separada por comas de tracers de lenguaje a cargar. |
| `profiling.obiProcessContext` | `true` | Correlaciona muestras con el contexto de traza de OBI para enlazar traza ↔ perfil. |

## Otra recopilación de datos (métricas de host, saturación, cAdvisor, KSM, registros de auditoría, CSI, CoreDNS)

El chart también puede recopilar:

| `<key>.enabled` | Por defecto | Qué añade |
| --- | --- | --- |
| `hostMetrics` | on | Métricas del sistema operativo por nodo desde `/proc` y `/sys` — profundidad de la cola de E/S del disco, uso de inodos del sistema de archivos, contadores de errores de NIC, estadísticas de paginación, carga promedio. Reside dentro del DaemonSet recopilador de registros (sin pods adicionales). |
| `kubeletstats.utilizationMetrics` | on | Métricas de saturación — CPU/memoria de contenedor y pod expresadas como un porcentaje de request y limit. Ocho familias de métricas derivadas que alimentan los monitores "CPU/Memory vs Request" y "CPU/Memory vs Limit". El mismo scrape que el receptor `kubeletstats` existente, sin pods adicionales. Siempre 0 cuando un pod no tiene request/limit establecido. |
| `kubeletstats.volumeMetrics` | on | Uso de disco por PVC (`k8s.volume.available`, `k8s.volume.capacity`). Alimenta el monitor "PVC Low Disk Space". Una serie por PVC por pod — acotado para la mayoría de clústeres, más pesado en cargas de trabajo con estado con miles de PVCs. |
| `cadvisor` | on | Recoge el endpoint `/metrics/cadvisor` del kubelet desde el pod del DaemonSet de cada nodo para las métricas de contenedor que `kubeletstats` no traduce: throttling de CFS (`container_cpu_cfs_throttled_seconds_total`, `container_cpu_cfs_periods_total`) y eventos de OOM kill (`container_oom_events_total`). Una lista de permitidos de relabel descarta todo lo demás en el receptor para que la cardinalidad se mantenga acotada. |
| `kubeStateMetrics` | off | Extrae métricas de estado del clúster desde kube-state-metrics: fases de pod (Pending / Terminating), motivos de espera del contenedor (CrashLoopBackOff, ImagePullBackOff) y uso de cuota de recursos. `mode: bundled` (por defecto) despliega un pequeño Deployment de KSM por usted; `mode: external` recoge un KSM existente mediante `endpoint`. Desactivado por defecto porque el modo bundled añade un Deployment a la huella del chart. |
| `auditLogs` | off | Lee `/var/log/kubernetes/audit.log` desde el host. Captura cada petición de API de Kubernetes — quién hizo qué a qué recurso. Sólo clústeres autogestionados — K8s gestionado (EKS, GKE, AKS, DOKS) enruta los registros de auditoría al sink del proveedor de la nube. |
| `csi` | off | Auto-descubre pods etiquetados con `app=csi-driver` (o `app.kubernetes.io/component=csi-driver`) y recoge su puerto Prometheus `metrics` — latencia de adjuntar/desadjuntar volúmenes, fallos de aprovisionamiento, IOPS. |
| `coreDns` | off | Recoge el servicio CoreDNS del clúster en `:9153/metrics`. Revela tasa de consultas, latencia, tasa de aciertos de caché, recuentos de errores — culpables comunes de latencia P99. |

## Opciones comunes

| Opción | Por defecto | Descripción |
| --- | --- | --- |
| `preset` | (vacío — tratado como `standard`) | Vea la tabla anterior. |
| `oneuptime.url` | *(requerido)* | URL de su instancia de OneUptime. |
| `oneuptime.apiKey` | *(requerido)* | Clave de API del proyecto (Settings → API Keys). |
| `clusterName` | *(requerido)* | Nombre único para este clúster. Estampado como `k8s.cluster.name` en cada registro. |
| `namespaceFilters.include` | `[]` | Si se establece, sólo se monitorean estos namespaces. |
| `namespaceFilters.exclude` | `["kube-system"]` | Namespaces a omitir. |
| `logs.enabled` | `true` | Activa o desactiva la recopilación de registros. |
| `logs.mode` | (derivado de `preset`) | `daemonset`, `api`, o `disabled`. Anula el preset. |
| `logs.api.replicas` | `1` | Número de réplicas del Deployment del tailer de registros (sólo en modo API). |
| `ebpf.enabled` | `true` | Auto-captura trazas HTTP/gRPC desde cada pod mediante OpenTelemetry eBPF Instrumentation. Vea la sección anterior. |
| `profiling.enabled` | `false` | Gráficos de llamas continuos de CPU mediante el OpenTelemetry eBPF Profiler. Desactivado por defecto; actívelo para más telemetría. Vea la sección anterior. |
| `hostMetrics.enabled` | `true` | Métricas del sistema operativo por nodo. |
| `kubeletstats.utilizationMetrics.enabled` | `true` | Saturación de CPU/memoria de contenedor y pod (% de request y limit). Sin scrape adicional — derivado de los datos de kubeletstats. |
| `kubeletstats.volumeMetrics.enabled` | `true` | Uso de disco por PVC (`k8s.volume.available`, `k8s.volume.capacity`). |
| `cadvisor.enabled` | `true` | Recoge el `/metrics/cadvisor` del kubelet de este nodo para contadores de throttling de CFS + OOM kill. Lista de permitidos a 3 métricas. |
| `kubeStateMetrics.enabled` | `false` | Extrae fases de pod, motivos de espera del contenedor (CrashLoopBackOff / ImagePullBackOff) y uso de ResourceQuota desde kube-state-metrics. Vea `kubeStateMetrics.mode` para bundled vs external. |
| `auditLogs.enabled` | `false` | Recopilación de registros de auditoría de Kubernetes (clústeres autogestionados). |
| `csi.enabled` | `false` | Métricas Prometheus de controlador CSI. |
| `coreDns.enabled` | `false` | Métricas Prometheus de CoreDNS. |
| `controlPlane.enabled` | `false` | Recoge etcd / api-server / scheduler / controller-manager. Sólo clústeres autogestionados — las ofertas gestionadas (EKS/GKE/AKS) normalmente no exponen estos endpoints. |

Vea el [`values.yaml` del chart](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/kubernetes-agent/values.yaml) para la lista completa.

## Actualización

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values` mantiene su configuración existente; pase cualquier nueva anulación `--set` encima.

> **Aviso: `--reuse-values` no fusiona los nuevos valores por defecto del chart.** Helm reutiliza sus valores previamente renderizados de forma literal — por lo que cualquier nuevo campo de nivel superior añadido en una versión más reciente del chart (p. ej. `profiling.*`, `ebpf.features.*`) permanece sin establecer en su release existente y la plantilla se renderiza como si lo hubiera desactivado.
>
> **Helm 3.14+** — cambie a `--reset-then-reuse-values`. Vuelve a leer los valores por defecto del chart para las claves que no haya anulado:
>
> ```bash
> helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
>   --namespace oneuptime-kubernetes-agent \
>   --reset-then-reuse-values
> ```
>
> **Helm 3.13 o anterior** — quite `--reuse-values` y pase sus banderas `--set` originales (o `-f values.yaml`) explícitamente. Los nuevos valores por defecto del chart se aplicarán a todo lo que no anule.
>
> Si los pods de una nueva característica (p. ej. `kubernetes-agent-profiling-*`) no aparecen después de actualizar, esto es casi siempre por qué. `helm get values <release>` muestra lo que Helm realmente tiene — los campos que faltan en la salida significan que los valores por defecto no se fusionaron para ellos.

## Desinstalación

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## Resolución de problemas

### La instalación falla con "hostPath volumes are not allowed"

Su clúster bloquea hostPath. Cambie a un preset de modo API:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values \
  --set preset=gke-autopilot   # or eks-fargate
```

### No aparecen registros en OneUptime

Compruebe los pods del agente:

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```

En modo API, el pod del tailer de registros expone `/healthz` en el puerto 13133 — acceda a él mediante `kubectl port-forward` para obtener una instantánea del estado de exportación.

### El pod del DaemonSet eBPF está en `CrashLoopBackOff` o no se inicia

Compruebe los registros del pod de OBI:

```bash
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

Causas comunes:

- **Kernel demasiado antiguo o sin BTF.** OBI necesita Linux 5.8+ con BTF. Compruebe con `uname -r` en un nodo. Si no puede actualizar, desactive eBPF: `--set ebpf.enabled=false`.
- **Los pods privilegiados están bloqueados.** Algunos clústeres rechazan los pods privilegiados incluso fuera de Autopilot/Fargate. Desactive eBPF.
- **No hay trazas en el panel pero OBI está ejecutándose.** Establezca `--set ebpf.printTraces=true` y compruebe el stdout de OBI — si ve spans allí, el problema es la entrega OTLP (compruebe el `OTEL_EXPORTER_OTLP_ENDPOINT` y su URL/clave de API de OneUptime). Si no ve spans, el tráfico que OBI está observando puede estar todo cifrado por una librería TLS que OBI no puede interceptar (p. ej. una implementación TLS enlazada estáticamente que no reconoce).

### Mi clúster tiene demasiados pods para una réplica del tailer de registros (sólo modo API)

Escale horizontalmente fragmentando los namespaces. Despliegue una vez por grupo de namespaces:

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

Alternativamente, aumente `logs.api.replicas` — pero tenga en cuenta que cada réplica procesa todos los namespaces permitidos, por lo que para la deduplicación todavía necesita fragmentación por namespace.
