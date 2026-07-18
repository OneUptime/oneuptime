# Agente de Kubernetes de OneUptime (Helm)

## Resumen

El Agente de Kubernetes de OneUptime es un chart de Helm preempaquetado que instala una canalización de colectores basada en OpenTelemetry en tu clúster. Envía métricas de nodos, pods, contenedores y del clúster; eventos de Kubernetes; logs de pods; y — con eBPF activado de forma predeterminada — trazas de aplicaciones, métricas RED de HTTP, datos del grafo de servicios y métricas de flujo de red entre pods. Sin cambios en el código, sin SDK, un solo `helm install`.

Esta página es la **guía de instalación**. Para configurar monitores y alertas de Kubernetes sobre los datos que recopila el agente, consulta [Agente de Kubernetes (monitores)](/docs/monitor/kubernetes-agent).

## Requisitos previos

- Un clúster de Kubernetes en ejecución (v1.23+)
- `kubectl` configurado para acceder a tu clúster
- `helm` v3 instalado
- Una **clave de API de OneUptime** — crea una desde _Project Settings → API Keys_

## Paso 1 — Agregar el repositorio de Helm de OneUptime

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update
```

## Paso 2 — Elegir un preset para tu clúster

El chart expone una única opción de nivel superior — `preset` — que selecciona valores predeterminados compatibles para tu distribución de Kubernetes. Controla aspectos que de otro modo tendrías que ajustar manualmente: si enviar logs mediante un DaemonSet con hostPath o mediante la API de Kubernetes, y qué contexto de seguridad aplicar.

| `preset`                      | Usar para                                                                                 | Recopilación de logs                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `standard` _(predeterminado)_ | Clústeres autogestionados, **EKS en EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet que lee `/var/log/pods` mediante hostPath (menor sobrecarga)                        |
| `gke-autopilot`               | **GKE Autopilot**                                                                         | Deployment de lector de logs mediante la API de Kubernetes (sin hostPath, sin acceso al host) |
| `eks-fargate`                 | **EKS Fargate**                                                                           | Deployment de lector de logs mediante la API de Kubernetes (sin hostPath, sin acceso al host) |

Si no estás seguro, comienza con `standard`. Si la instalación falla con un error de Pod Security que menciona `hostPath`, vuelve a ejecutarla con `preset=gke-autopilot` (o `eks-fargate` en Fargate) y funcionará.

## Paso 3 — Instalar el Agente de Kubernetes

Reemplaza `YOUR_ONEUPTIME_URL`, `YOUR_ONEUPTIME_API_KEY` y el nombre del clúster con los valores de tu entorno. El nombre del clúster es como aparecerá el clúster en OneUptime — elige algo estable como `prod-us-east-1`.

### Clústeres estándar (autogestionados, EKS en EC2, GKE Standard, AKS)

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster"
```

### GKE Autopilot

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set preset=gke-autopilot
```

### EKS Fargate

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set preset=eks-fargate
```

## Paso 4 — Verificar la instalación

Comprueba que los pods del agente estén en ejecución:

```bash
kubectl get pods -n oneuptime-agent
```

En un clúster **standard** verás un Deployment de cluster-collector más un pod de DaemonSet de node-collector por cada nodo:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
kubernetes-agent-logs-yyyyy                   1/1     Running   0          1m
```

En **GKE Autopilot** el colector de nodos sigue ejecutándose — recopila métricas de kubelet y cAdvisor sin necesitar hostPath — y un Deployment adicional lee los logs de pods a través de la API de Kubernetes:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
```

En **EKS Fargate** verás dos Deployments y ningún DaemonSet — Fargate le da a cada pod su propia micro-VM y nunca programa DaemonSets, por lo que las métricas a nivel de nodo no están disponibles allí:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
```

Una vez que el agente se conecta, tu clúster aparecerá automáticamente en la sección **Kubernetes** del panel de OneUptime.

## Opciones de configuración

### Filtrado de namespaces

`namespaceFilters.rules` aplica patrones de espacios de nombres de forma independiente a cuatro ámbitos:

- `podLogs`: filtra stdout/stderr de los pods en el receptor filelog hostPath o en el recolector de logs por API; no afecta a los eventos de Kubernetes ni a los logs de auditoría.
- `ebpfDiscovery`: filtra el descubrimiento de procesos de OBI y, por tanto, tanto las trazas como las métricas eBPF.
- `metrics`: filtra series de métricas con espacio de nombres después del enriquecimiento de metadatos; se conservan las series de nodo y clúster sin espacio de nombres.
- `traces`: filtra tanto spans eBPF como spans OTLP enviados por aplicaciones después del enriquecimiento de metadatos.

Los patrones coinciden con el nombre completo del espacio de nombres y admiten * como comodín, por ejemplo team-*. Si un ámbito tiene alguna regla include, solo se conservan los espacios de nombres que coincidan en ese ámbito. Las reglas exclude siempre prevalecen. La regla predeterminada excluye kube-system únicamente de podLogs y ebpfDiscovery.

Para limitar los logs de pods y el descubrimiento eBPF a espacios de nombres concretos:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set-json 'namespaceFilters.rules=[{"action":"include","namespaces":["default","production","staging"],"scopes":["podLogs","ebpfDiscovery"]}]'
```

Para detener los logs de un espacio de nombres ruidoso y conservar sus trazas eBPF, mapa de servicios y métricas, limite la exclusión a podLogs:

```bash
  --set-json 'namespaceFilters.rules=[{"action":"exclude","namespaces":["kube-system"],"scopes":["podLogs","ebpfDiscovery"]},{"action":"exclude","namespaces":["noisy-*"],"scopes":["podLogs"]}]'
```

Las reglas de podLogs y ebpfDiscovery filtran en el origen: los archivos de log excluidos nunca se abren y las cargas excluidas nunca se instrumentan. Las reglas de metrics y traces se ejecutan más tarde en el collector, una vez añadidos los metadatos del espacio de nombres.

#### Filtrar métricas y trazas por espacio de nombres

Añada esos ámbitos directamente a la regla cuando también quiera filtrar métricas o spans con espacio de nombres:

```bash
  --set-json 'namespaceFilters.rules=[{"action":"exclude","namespaces":["kube-system","noisy-*"],"scopes":["podLogs","ebpfDiscovery","metrics","traces"]}]'
```

> **Las métricas de nodo y clúster siempre se conservan. Un espacio de nombres pertenece a un pod, no a un nodo; por eso las series sin espacio de nombres no coinciden con la regla y no se eliminan.**

Los eventos de Kubernetes no se pueden filtrar por espacio de nombres en el agente. Llegan del receptor k8sobjects sin el atributo k8s.namespace.name; el espacio de nombres está en el cuerpo del evento. Fíltrelos en el servidor.

### Filtrado por severidad de logs

`filters.logs.minSeverity` descarta los registros de **logs de pods** por debajo de una severidad, en el agente, antes de que se envíe nada:

```bash
  --set filters.logs.minSeverity=WARN
```

Acepta `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`. `WARN` conserva WARN, ERROR y FATAL y descarta INFO, DEBUG y TRACE. El valor predeterminado (`""`) lo conserva todo. Se aplica en **ambos** modos de logs — en modo `daemonset` mediante el colector, en modo `api` dentro del propio lector de logs — por lo que los presets no pueden desactivártelo a tus espaldas.

Los runtimes de contenedores no registran una severidad en la línea de log, por lo que el agente extrae una del propio texto del log (`[ERROR]`, `WARN:`, `level=info`, …).

> **Los eventos de Kubernetes y las especificaciones de recursos nunca se filtran con esto.** Llegan desde la API de Kubernetes sin una severidad propia, por lo que un umbral eliminaría el feed entero en lugar de adelgazarlo — incluidos los avisos de `FailedScheduling`, `BackOff` y `OOMKilling` que más te interesan. Son de bajo volumen y alto valor, así que el agente siempre los envía. Para adelgazarlos, usa en su lugar los **Logs → Settings → Drop Filters** del lado del servidor en el panel.

**Lo que ocurre con una línea sin un nivel reconocible depende del modo de logs**, porque los dos modos disponen de información distinta:

| Modo | Línea sin etiquetar | Por qué |
| ---- | ------------------- | ------- |
| `daemonset` | `stderr` → se trata como ERROR (se conserva), `stdout` → se trata como INFO (descartada por un umbral WARN) | El runtime de contenedores registra de qué flujo proviene cada línea. |
| `api` | Siempre se **conserva** | La API `pods/log` de Kubernetes fusiona stdout y stderr en un único flujo sin marcador por línea. En lugar de adivinar, el agente conserva la línea. |

> Por tanto, el modo `api` descarta estrictamente menos que el modo `daemonset`. Es deliberado: un traceback de Python o un `npm ERR!` no llevan ninguna palabra clave de severidad, y eliminarlo silenciosamente es exactamente el fallo del que se supone que te protege un umbral de severidad.

Los eventos multilínea se recombinan **antes** del filtrado en ambos modos, por lo que un stack trace de Java se juzga por su primera línea y se conserva o se descarta entero — nunca obtendrás una línea `ERROR` suelta con sus frames recortados.

### Incluir o excluir métricas por nombre

`filters.metrics` controla qué métricas salen del clúster, en todos los receptores de la canalización.

**Descartar unas pocas métricas ruidosas** (una lista de denegación — normalmente lo que quieres):

```bash
  --set-json 'filters.metrics.exclude=["k8s.volume.available","k8s.volume.capacity"]'
```

**Enviar solo un conjunto fijo** (una lista de permitidos — todo lo demás se descarta):

```bash
  --set-json 'filters.metrics.include=["k8s.pod.cpu.utilization","k8s.pod.memory.usage"]'
```

**Coincidir por patrón** en lugar de por nombre exacto:

```bash
  --set filters.metrics.matchType=regexp \
  --set-json 'filters.metrics.exclude=["^container_network_"]'
```

| Clave | Significado |
| --- | ----------- |
| `filters.metrics.exclude` | Nombres de métricas que descartar. Se aplica por encima de `include`, así que exclude siempre prevalece. |
| `filters.metrics.include` | Cuando no está vacío, **solo** se envían estas. |
| `filters.metrics.matchType` | `strict` (nombre exacto, el predeterminado) o `regexp` (RE2, **sin anclar**). |

Notas que te ahorrarán un incidente:

- `regexp` **no está anclado** — `system.cpu` también coincide con `system.cpu.time`. Áncralo (`^system\.cpu$`) cuando te refieras exactamente a una métrica.
- RE2 **no tiene lookahead**, por lo que `^(?!container_)` no compilará. Expresa "todo excepto" con `include`, no con una regex negativa.
- `include` abarca todos los receptores a la vez. Una lista de permitidos que olvida una métrica elimina silenciosamente los monitores construidos sobre ella. Prefiere `exclude` a menos que realmente quieras un conjunto cerrado.
- Usa `--set-json` (o un archivo de valores) para las listas. Un `--set` normal reemplaza una lista en lugar de fusionarla.

> **Prueba una regex antes de desplegarla.** El colector compila los patrones al arrancar, no por registro, así que uno inválido no falla de forma discreta — el colector se niega a arrancar y entra en CrashLoopBackOff, tumbando los **logs** de ese colector junto con sus métricas. Helm no puede compilar RE2, por lo que `helm upgrade` acepta un patrón incorrecto sin rechistar.

### Muestreo de trazas

Los filtros anteriores eliminan una **categoría** de telemetría — un namespace, una severidad, un nombre de métrica. El muestreo es distinto: conserva todas las categorías y, en su lugar, adelgaza la población. Ajusta `sampling.traces.percentage` a la proporción de trazas que quieres conservar:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set sampling.traces.percentage=10
```

Eso conserva una traza de cada diez y descarta las otras nueve en el agente, antes de que salgan de tu clúster.

**Obtienes trazas completas, no fragmentos.** La decisión es un hash del ID de traza en lugar de un lanzamiento de moneda por span, así que todos los spans de una traza se conservan o se descartan juntos — las trazas que sobreviven están completas y se leen de principio a fin. Esta es la propiedad que hace que el muestreo sea seguro de activar.

**Tus monitores basados en métricas no se mueven.** Las métricas RED de eBPF — tasa de solicitudes, tasa de errores, duración — son una familia de *métricas*. OBI las calcula a partir de cada solicitud y viajan por la canalización de métricas, en la que el muestreador no está. Con `percentage: 10` obtienes una décima parte de las trazas y una tasa/error/latencia 100% exactas. Los paneles y monitores construidos sobre esas métricas no se ven afectados.

**Tus monitores basados en spans sí.** Todo lo que OneUptime deriva de los propios spans se reduce con la tasa — consulta la advertencia de más abajo antes de activar esto.

| Clave | Significado |
| --- | ----------- |
| `sampling.traces.percentage` | Porcentaje de trazas que **conservar**, 0-100. Predeterminado: `100` (conservarlo todo). |
| `sampling.traces.hashSeed` | Semilla para el hash del ID de traza. Predeterminado: `22`. |

Notas que te ahorrarán un incidente:

- **`0` no conserva ninguna traza.** Es una tasa, no un interruptor de apagado — elimina todas las trazas mientras el DaemonSet de eBPF sigue ejecutándose y costándote. Si no quieres trazas, usa `ebpf.enabled=false`. Si no quieres trazas pero *sí* quieres las métricas RED y el mapa de servicios, deja eBPF activado y pon esto a `0` deliberadamente.
- **Solo se aplica cuando `ebpf.enabled`.** De lo contrario, la canalización de trazas no existe, así que con `ebpf.enabled=false` este valor no hace nada.
- **Solo trazas.** No hay `sampling.logs` ni `sampling.metrics`, y es deliberado — consulta la nota de abajo.
- **Las fracciones necesitan `--set-json`, y tienen un suelo.** `--set sampling.traces.percentage=0.5` falla, porque Helm lee `0.5` como una cadena. Usa `--set-json 'sampling.traces.percentage=0.5'` o un archivo de valores. Los números enteros funcionan bien con `--set`. Por debajo de aproximadamente `0.0061` la tasa se cuantiza a cero y se comporta exactamente como `0` — todas las trazas descartadas, sin ningún error. `0.01` (una de cada diez mil) es el valor más pequeño que hace lo que dice.
- **El multiclúster funciona de forma predeterminada.** Dos agentes conservan la misma traza solo si coinciden tanto en `hashSeed` como en `percentage`. Ambos tienen el mismo valor predeterminado en todas partes, así que una traza que cruza dos clústeres sobrevive entera sin ninguna configuración adicional. Cambia `hashSeed` solo para *descorrelacionar* deliberadamente dos niveles de muestreo — como la decisión es un umbral sobre el mismo hash, la misma semilla con tasas distintas se anida, por lo que un segundo nivel simplemente vuelve a elegir las trazas que el primero ya conservó en lugar de sortearlas de forma independiente.
- **Los logs de pods nunca se muestrean**, así que con `ebpf.logToTraceCorrelation: true` cada registro de log sigue llevando un ID de traza mientras que solo se conserva el `percentage`% de esas trazas. Aproximadamente el (100 − `percentage`)% de los registros de log mostrará un enlace a una traza que no lleva a ninguna parte. La navegación de traza → logs no se ve afectada; solo la de logs → traza puede fallar.

> **Reajusta tus monitores basados en spans cuando establezcas esto.** El muestreo reduce los spans que llegan a OneUptime, así que todo lo que los cuenta cuenta menos: un monitor **Traces** sobre `Span Count` y un monitor **Exceptions** sobre `Exception Count` verán aproximadamente el `percentage`% del volumen de ayer. Un umbral ajustado sobre tráfico sin muestrear deja de cruzarse en silencio — el monitor no da error, simplemente se queda callado. Divide esos umbrales por el mismo factor cuando establezcas la tasa; la tasa es de todo el clúster, así que no hay forma de eximir de ella a un servicio individual. La **agrupación** de errores se degrada peor que linealmente: una excepción común sigue apareciendo, pero una rara y puntual tiene más probabilidades de desaparecer por completo que de aparecer una décima parte de las veces.

> **Por qué aquí no hay muestreo de logs ni de métricas.** El muestreador del colector no puede muestrear métricas en absoluto. Sí puede muestrear logs, pero extrae su aleatoriedad del ID de traza — y los logs de pods no tienen uno. Cada registro sin ID de traza acaba entonces en el mismo bucket del hash, así que una tasa para logs no adelgazaría el feed: lo conservaría entero o lo eliminaría entero según la semilla. En lugar de ofrecer un control que elimine tus logs de forma silenciosa, el chart no ofrece ninguno. Adelgaza los logs con [Filtrado por severidad de logs](#filtrado-por-severidad-de-logs) y [Filtrado de namespaces](#filtrado-de-namespaces), que son precisos sobre lo que eliminan.

### Deshabilitar la recopilación de logs

Si no necesitas logs de pods:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set logs.enabled=false
```

Tus métricas no se ven afectadas: el colector de nodos sigue ejecutándose para las métricas de kubelet, cAdvisor y del host, simplemente deja de leer los logs de pods. Las alertas basadas en logs se detienen, y nada más.

### Forzar un modo específico de recopilación de logs

Los usuarios avanzados pueden anular la elección del preset con `logs.mode`:

- `logs.mode=daemonset` — DaemonSet con hostPath (menor sobrecarga, requiere hostPath)
- `logs.mode=api` — Deployment de lector de logs mediante la API de Kubernetes (funciona en cualquier clúster)
- `logs.mode=disabled` — sin recopilación de logs

> El modo de logs solo decide de dónde provienen los **logs de pods**. Las métricas de nodos se recopilan independientemente de él, así que `api` y `disabled` conservan tus métricas de kubelet, cAdvisor y del host.
>
> La única excepción es la plataforma, no el modo: **EKS Fargate no puede programar DaemonSets en absoluto**, por lo que allí no hay colector de nodos y las métricas de nodos, pods y contenedores no están disponibles. GKE Autopilot ejecuta el colector de nodos sin problema, pero bloquea `hostPath`, así que recopila las métricas de kubelet y cAdvisor sin las de `hostmetrics` (E/S de disco, inodos, errores de NIC) que necesitan leer el `/proc` y el `/sys` del host.

El `logs.mode` explícito siempre prevalece sobre el valor predeterminado del preset. Úsalo si conoces tu clúster mejor que el preset.

### Habilitar la monitorización del plano de control

Para clústeres autogestionados (no EKS / GKE / AKS), puedes habilitar las métricas del plano de control:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set controlPlane.enabled=true
```

> Los servicios gestionados de Kubernetes (EKS, GKE, AKS) normalmente no exponen métricas del plano de control. Habilita esto solo para clústeres autogestionados.

### Etiquetado automático con labels del proyecto

Cualquier atributo de recurso con el prefijo `oneuptime.label.` se promueve a un Label del proyecto y se adjunta al clúster, los servicios y los hosts emitidos desde este agente. Patrón: `oneuptime.label.<dimension>=<value>` se convierte en un label llamado `<dimension>:<value>`.

Pasa labels en el momento de la instalación con `--set oneuptime.labels.<key>=<value>`:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="prod" \
  --set oneuptime.labels.team=payments \
  --set oneuptime.labels.env=production \
  --set oneuptime.labels.region=us-east-1
```

O mantenlos en un archivo de valores:

```yaml
# values.yaml
oneuptime:
  url: YOUR_ONEUPTIME_URL
  apiKey: YOUR_ONEUPTIME_API_KEY
  labels:
    team: payments
    env: production
    region: us-east-1
clusterName: prod
```

Los labels se comparan sin distinguir mayúsculas y minúsculas, por lo que un label `Production` existente creado manualmente se reutiliza en lugar de duplicarse. Los labels agregados manualmente en la interfaz de OneUptime nunca son eliminados por el agente.

## Actualizar el agente

```bash
helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values
```

`--reuse-values` mantiene tu configuración existente (preset, nombre del clúster, filtros); pasa cualquier nueva anulación `--set` por encima de ella.

## Desinstalar el agente

```bash
helm uninstall kubernetes-agent --namespace oneuptime-agent
kubectl delete namespace oneuptime-agent
```

## Qué se recopila

| Categoría                                                                      | Datos                                                                                                                                                           |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Métricas de nodos**                                                          | Utilización de CPU, uso de memoria, uso del sistema de archivos, E/S de red                                                                                     |
| **Métricas de pods**                                                           | Uso de CPU, uso de memoria, E/S de red, reinicios                                                                                                               |
| **Métricas de contenedores**                                                   | Uso de CPU, uso de memoria por contenedor                                                                                                                       |
| **Métricas del clúster**                                                       | Condiciones de los nodos, recursos asignables, recuentos de pods                                                                                                |
| **Eventos de Kubernetes**                                                      | Advertencias, errores, eventos de programación                                                                                                                  |
| **Logs de pods**                                                               | Logs de stdout/stderr de todos los contenedores (mediante DaemonSet con hostPath en clústeres estándar, o mediante la API de Kubernetes en Autopilot / Fargate) |
| **Trazas de aplicaciones** _(mediante eBPF, activado de forma predeterminada)_ | Spans de HTTP, gRPC, SQL/Redis de cada pod — sin SDK ni cambios en el código                                                                                    |
| **Métricas RED de HTTP** _(mediante eBPF)_                                     | `http.server.request.duration`, tamaños de cuerpo de solicitud y respuesta, por servicio                                                                        |
| **Grafo de servicios** _(mediante eBPF)_                                       | Tasa de solicitudes, latencia y aristas de error de llamador → llamado — impulsa la vista del mapa de servicios                                                 |
| **Métricas de flujo de red** _(mediante eBPF)_                                 | Contadores de bytes y paquetes TCP/UDP entre pods con metadatos de k8s                                                                                          |
| **Estadísticas de TCP** _(mediante eBPF)_                                      | Contadores de RTT, conexiones fallidas y retransmisiones a nivel de nodo                                                                                        |

## Trazas de aplicaciones y métricas de HTTP mediante eBPF (activado de forma predeterminada)

El chart ejecuta un DaemonSet con [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) en cada nodo. Carga programas eBPF en el kernel y captura automáticamente tráfico HTTP/HTTPS, gRPC y SQL/Redis de cada runtime compatible (Go, .NET, Java, Node.js, Python, Ruby, Rust) — sin SDK ni sidecar requerido. Las trazas y las métricas de solicitudes luego fluyen a través del colector dentro del clúster hacia OneUptime.

**Requisitos:** kernel de Linux **5.8+** con BTF (predeterminado en Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL/Stream 9+). El DaemonSet de eBPF se ejecuta en **modo privilegiado** porque debe hacerlo, para cargar los programas eBPF.

### Deshabilitar la instrumentación automática de eBPF

Deberías deshabilitarla cuando:

- Instales en **GKE Autopilot** o **EKS Fargate** — esas plataformas bloquean los pods privilegiados (usa `preset=gke-autopilot` / `preset=eks-fargate` y combínalo con `ebpf.enabled=false`).
- Los nodos ejecuten un kernel anterior a 5.8 sin backports de BTF.
- Ya envíes trazas mediante SDK de OpenTelemetry desde tus aplicaciones y no quieras duplicados.

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set ebpf.enabled=false
```

### Activar familias de señales individuales

Todas activadas de forma predeterminada. Desactiva cualquiera con `--set ebpf.features.<name>=false`:

| `ebpf.features.*`         | Predeterminado | Qué agrega                                                                      |
| ------------------------- | -------------- | ------------------------------------------------------------------------------- |
| `httpMetrics`             | activado       | Métricas RED de HTTP/gRPC (tasa de solicitudes, latencia, errores) por servicio |
| `spanMetrics`             | activado       | Tamaño de solicitud/respuesta y duración por span                               |
| `serviceGraph`            | activado       | Métricas de aristas de llamador → llamado; impulsa el mapa de servicios         |
| `hostMetrics`             | activado       | CPU y memoria por proceso instrumentado                                         |
| `networkMetrics`          | activado       | Contadores de flujo TCP/UDP entre pods                                          |
| `networkInterZoneMetrics` | desactivado    | Variante entre zonas de las métricas de red (duplica la cardinalidad)           |
| `tcpStats`                | activado       | Contadores de RTT de TCP, conexiones fallidas y retransmisiones a nivel de nodo |

La propagación del contexto de traza entre servicios también está activada de forma predeterminada — OBI inyecta `traceparent` de W3C en el tráfico saliente HTTP/TCP para que una solicitud que cruza del pod A → pod B aparezca como una sola traza, sin cambios de SDK en ninguna parte. Desactívala con `--set ebpf.contextPropagation=false`.

## Reducir el volumen de datos recopilados

De forma predeterminada, el agente está ajustado para la **cobertura** — envía métricas, logs de pods y trazas de eBPF de todo el clúster para que cada panel y monitor funcione desde el primer día. En clústeres grandes o con mucha actividad, eso puede ser más telemetría de la que necesitas, lo que se manifiesta como un mayor volumen de ingesta (y, en OneUptime Cloud, un mayor costo). Nada de esto es obligatorio, pero si un clúster envía más de lo que quieres, estos son los controles que ajustar — aproximadamente en orden de impacto.

El truco es **dejar de recopilar lo que no vas a mirar**, en lugar de recopilar todo y pagar por almacenarlo. Cada palanca a continuación es un valor de Helm, por lo que puedes aplicarla con `--set` en `helm upgrade --reuse-values` y revertirla de la misma manera.

### De dónde proviene el volumen

| Señal                                 | Mayor factor                                                         | Redúcelo con                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Logs de pods**                      | Cada línea de cada contenedor, en todo el clúster                    | `namespaceFilters`, `filters.logs.minSeverity`, `logs.enabled`, `logs.mode`                  |
| **Trazas de eBPF y métricas de span** | Una traza por solicitud de cada proceso instrumentado                | `sampling.traces.percentage`, `ebpf.enabled`, `ebpf.features.*`, `ebpf.autoTargetExe`, `ebpf.excludeExePaths` |
| **Puntos de datos de métricas**       | Frecuencia de recopilación × número de pods/contenedores             | `collectionInterval`, `hostMetrics.collectionInterval`, `cadvisor.scrapeInterval`            |
| **Cardinalidad de métricas**          | Número de series distintas (por contenedor, por PVC, …)              | `filters.metrics.exclude`, `namespaceFilters.rules` (`metrics`), `cadvisor.metricsAllowlist`, `kubeletstats.volumeMetrics` |
| **Extras opcionales**                 | Profiling, logs de auditoría, plano de control, métricas entre zonas | Déjalos desactivados (ya lo están de forma predeterminada)                                   |

Hay tres formas de recortar el volumen, y vale la pena saber cuál estás usando:

- **En el receptor** — los datos nunca se recopilan. `namespaceFilters` en los logs de pods, `cadvisor.metricsAllowlist`, un `collectionInterval` más largo. No cuesta nada ejecutarlo y ahorra CPU, egreso e ingesta a la vez. Prefiere siempre estos cuando cubran tu caso.
- **En el procesador de filtro** — los datos se recopilan y luego se descartan antes de exportarse. `filters.logs.minSeverity`, `filters.metrics.*`, `namespaceFilters.rules` (`metrics`/`traces`). Consume algo más de CPU del colector, pero funciona en todos los receptores y puede expresar cosas que un receptor no puede.
- **En el muestreador** — los datos se recopilan y luego se conserva una fracción representativa. `sampling.traces.percentage`. Es el caso atípico: los dos anteriores eliminan una *categoría* entera de telemetría, así que lo que descartan desaparece de todas las trazas. El muestreo conserva todas las categorías y adelgaza la población, por lo que lo que sobrevive sigue siendo completo y representativo.

Las tres son **irreversibles**: lo que descartes aquí nunca llega a OneUptime, y las tres pueden dejar en silencio a un monitor. Las dos primeras silencian a un monitor eliminando la señal que vigila. El muestreo es más acotado: las métricas RED de eBPF se calculan antes de que se ejecute el muestreador, así que los monitores basados en métricas se mantienen exactos — pero los monitores que cuentan *spans* (**Traces** sobre `Span Count`, **Exceptions** sobre `Exception Count`) ven proporcionalmente menos y necesitan que reajustes sus umbrales por el mismo factor. Si prefieres decidirlo más tarde, OneUptime puede descartar los datos del lado del servidor (**Logs → Settings → Drop Filters**, **Metrics → Settings → Pipeline Rules**) — eso sigue costando egreso, pero es una opción que puedes cambiar sin volver a desplegar.

### Palanca 1 — Los logs de pods suelen ser la mayor fuente

Los logs de contenedores son casi siempre la porción más grande de la ingesta, porque es un registro por cada línea de log de cada contenedor del clúster.

- **¿Solo necesita logs de determinados espacios de nombres? Use una regla include con el ámbito podLogs. La coincidencia ocurre en el origen del log, por lo que los espacios filtrados nunca se leen y la telemetría eBPF permanece independiente.**

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set-json 'namespaceFilters.rules=[{"action":"include","namespaces":["default","production"],"scopes":["podLogs"]}]'
  ```

  Para conservar todos los espacios de nombres salvo una familia ruidosa, use una regla exclude con namespaces: [noisy-*] y scopes: [podLogs].

- **¿Solo te importan las advertencias y los errores?** `filters.logs.minSeverity` descarta el resto en el agente. En un clúster con mucha actividad, esta suele ser la mayor reducción disponible, porque INFO y DEBUG son la mayor parte de la salida de la mayoría de las aplicaciones:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.logs.minSeverity=WARN
  ```

  Consulta [Filtrado por severidad de logs](#filtrado-por-severidad-de-logs) para saber cómo se determina la severidad y qué ocurre con los logs que no puede clasificar.

- **¿No necesitas logs de pods en OneUptime en absoluto?** Desactívalos:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set logs.enabled=false
  ```

  > Esto solo detiene los logs de pods. Las métricas de nodos, pods y contenedores siguen fluyendo, y los monitores construidos sobre ellas (OOM kills, throttling de CPU, poco espacio en disco de PVC) siguen funcionando — el colector de nodos permanece, simplemente deja de leer `/var/log/pods`. Lo mismo se aplica a `logs.mode: api` y `logs.mode: disabled`.

### Palanca 2 — Recorta la instrumentación automática de eBPF

eBPF te da trazas, métricas RED, el mapa de servicios y métricas de flujo de red sin cambios en el código — pero también es la segunda mayor fuente de datos porque emite un span por solicitud y varias familias de métricas por servicio. Tienes tres niveles de control:

- **¿Ya envías trazas desde SDK de OTel o no quieres trazas automáticas?** Desactiva eBPF por completo:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.enabled=false
  ```

- **Conserva las trazas, elimina las familias de métricas pesadas.** La [tabla de familias de señales de arriba](#activar-familias-de-señales-individuales) enumera cada opción `ebpf.features.*`. Las familias de mayor volumen son las métricas de red y de span — desactivarlas deja intactas las trazas, las métricas RED de HTTP y el mapa de servicios:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.features.networkMetrics=false \
    --set ebpf.features.tcpStats=false \
    --set ebpf.features.spanMetrics=false
  ```

  Deja `ebpf.features.networkInterZoneMetrics` desactivado (su valor predeterminado) — duplica la cardinalidad del flujo de red.

- **Instrumenta solo los runtimes que te interesan.** De forma predeterminada, OBI se adjunta a cada proceso que reconoce (`ebpf.autoTargetExe: "*"`). Acótalo a runtimes específicos, o agrega binarios a la lista de exclusión, para reducir el número de "servicios" y trazas que produce el agente:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.autoTargetExe='*/python,*/java'
  ```

  Consulta [Activar familias de señales individuales](#activar-familias-de-señales-individuales) y la nota sobre `excludeExePaths` en los valores del chart para ver los valores predeterminados completos.

### Palanca 3 — Ralentiza los intervalos de recopilación

El volumen de métricas es directamente proporcional a la frecuencia con la que el agente recopila. Duplicar un intervalo reduce aproximadamente a la mitad el número de puntos de datos que produce esa métrica, sin pérdida de cobertura — solo una resolución más gruesa. Si no necesitas una granularidad de 30 segundos, 60s o 120s es una reducción grande y segura:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set collectionInterval=60s \
  --set hostMetrics.collectionInterval=60s \
  --set cadvisor.scrapeInterval=60s
```

- `collectionInterval` (predeterminado `30s`) impulsa las métricas de nodos / pods / contenedores (`kubeletstats`) y las métricas de estado del clúster (`k8s_cluster`) — la mayor parte del volumen de métricas.
- `hostMetrics.collectionInterval` y `cadvisor.scrapeInterval` cubren las métricas del sistema operativo por nodo y los contadores de throttling / OOM.
- `resourceSpecs.interval` (predeterminado `300s`) controla con qué frecuencia se extraen las especificaciones completas de recursos (labels, anotaciones, estado) — auméntalo si no necesitas que los cambios de especificación se reflejen rápidamente.
- Si habilitaste alguno de los recopiladores opcionales, también tienen sus propios controles: `kubeStateMetrics.scrapeInterval`, `serviceMesh.*.scrapeInterval`, `coreDns.scrapeInterval`, `csi.scrapeInterval`.

### Palanca 4 — Mantén acotada la cardinalidad de métricas

La cardinalidad (el número de series temporales distintas) importa tanto como la frecuencia, porque cada serie se almacena y se factura por separado.

- **cAdvisor está en lista de permitidos a propósito.** El receptor de cAdvisor (activado de forma predeterminada) puede emitir cientos de métricas; el chart reenvía solo el puñado que impulsa los monitores (`cadvisor.metricsAllowlist`). Mantén la lista ajustada — **cada entrada se conserva por contenedor, por lo que una métrica adicional se multiplica por el número de contenedores del clúster.** kube-state-metrics está desactivado de forma predeterminada, pero si lo habilitas (`kubeStateMetrics.enabled=true`), su `kubeStateMetrics.metricsAllowlist` controla la cardinalidad de la misma manera.
- **Las métricas de volumen por PVC** (`kubeletstats.volumeMetrics.enabled`, activado de forma predeterminada) emiten una serie por PVC por pod. Eso está bien para la mayoría de los clústeres, pero puede ser considerable en cargas de trabajo con estado (Kafka, bases de datos) con miles de PVC — desactívalo allí si no supervisas el espacio en disco de los PVC:

  ```bash
  --set kubeletstats.volumeMetrics.enabled=false
  ```

- **Las métricas de saturación** (`kubeletstats.utilizationMetrics.enabled`, activado de forma predeterminada) agregan 8 familias derivadas de "% de request/limit". Son económicas (sin recopilación adicional) pero si no usas los monitores de CPU/memoria frente al límite, puedes eliminarlas con `--set kubeletstats.utilizationMetrics.enabled=false`.

- **Descarta métricas concretas por nombre.** Las listas de permitidos de arriba son por receptor; `filters.metrics.exclude` los abarca todos, así que úsalo para cualquier cosa que los controles a nivel de receptor no puedan expresar:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.metrics.matchType=regexp \
    --set-json 'filters.metrics.exclude=["^container_network_"]'
  ```

  Consulta [Incluir o excluir métricas por nombre](#incluir-o-excluir-métricas-por-nombre) para la coincidencia exacta frente a la de regex y para la forma de lista de permitidos.

- **¿Quiere descartar las métricas de un espacio de nombres completo? Añada una regla exclude con el ámbito metrics. Se filtran las series por pod y contenedor, mientras que se conservan las series de nodo y clúster sin espacio de nombres.**

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set-json 'namespaceFilters.rules=[{"action":"exclude","namespaces":["noisy-*"],"scopes":["metrics"]}]'
  ```

### Palanca 5 — Deja desactivadas las funciones opcionales pesadas

Estas están **desactivadas de forma predeterminada** precisamente porque agregan carga — habilita una solo cuando uses activamente lo que impulsa, y vuelve a desactivarla si solo la estabas probando:

| Valor                                                     | Agrega                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `profiling.enabled`                                       | DaemonSet de profiling continuo de CPU — más pesado que las trazas de eBPF                              |
| `auditLogs.enabled`                                       | Cada solicitud a la API de Kubernetes como un registro de log (alto volumen)                            |
| `controlPlane.enabled`                                    | Métricas de etcd / API-server / scheduler / controller-manager                                          |
| `kubeStateMetrics.enabled`                                | Métricas de CrashLoop / ImagePull / motivo de programación (agrega un Deployment de KSM + recopilación) |
| `ebpf.features.networkInterZoneMetrics`                   | Duplica la cardinalidad de las métricas de flujo de red                                                 |
| `serviceMesh.enabled` / `csi.enabled` / `coreDns.enabled` | Trabajos adicionales de recopilación de Prometheus                                                      |

### Palanca 6 — Muestrea las trazas en lugar de descartarlas

Cada palanca anterior compra volumen a cambio de renunciar a algo: un namespace que dejas de vigilar, una severidad que dejas de conservar, una familia de métricas que dejas de recopilar. El muestreo es la excepción, y en un clúster con mucha actividad suele ser la mayor reducción disponible por la menor pérdida:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set sampling.traces.percentage=10
```

Eso es un recorte del 90% en el volumen de trazas a cambio de una pérdida más acotada que la de cualquier otra palanca de aquí:

- Las trazas que conservas están **enteras** — la decisión aplica un hash al ID de traza, así que todos los spans de una traza lo comparten. Obtienes menos trazas, no trazas rotas.
- Tus **métricas RED se mantienen exactas**. La tasa de solicitudes, la tasa de errores y la duración las calcula OBI a partir de cada solicitud y viajan por la canalización de métricas, en la que el muestreador no está. Cada panel y monitor construido sobre ellas se lee igual que antes.

Lo que cedes son sobre todo las trazas de ejemplo: cuando un monitor se dispara, tienes una décima parte de trazas que abrir. En un clúster que atiende miles de solicitudes idénticas por segundo, eso suele ser un buen trato — el span número cien de `/healthz` no te enseña nada que no te enseñara el primero. En un clúster tranquilo es un mal trato, porque puede que no tengas ningún ejemplo de la solicitud rara que falló.

La excepción, y lo único que conviene comprobar antes de desplegar esto: los monitores que **cuentan spans** en lugar de métricas — **Traces** sobre `Span Count`, **Exceptions** sobre `Exception Count` — ven proporcionalmente menos, así que sus umbrales necesitan reajustarse por el mismo factor. Consulta [Muestreo de trazas](#muestreo-de-trazas).

Recurre a esto cuando las trazas de eBPF sean una parte grande de tu ingesta pero aun así quieras el mapa de servicios y las métricas RED intactos. Prefiere la Palanca 2 cuando quieras dejar de instrumentar algo por completo.

Consulta [Muestreo de trazas](#muestreo-de-trazas) para conocer el comportamiento completo, incluyendo por qué `0` es una tasa en lugar de un interruptor de apagado y por qué no hay un equivalente para logs ni métricas.

### Un punto de partida ligero

Si quieres una huella más pequeña pero aun así quieres que los monitores funcionen, este perfil conserva la **cobertura completa de métricas** y recorta las dos cosas que realmente impulsan el volumen: las líneas de log y los spans de eBPF:

```yaml
# lean-values.yaml
oneuptime:
  url: YOUR_ONEUPTIME_URL
  apiKey: YOUR_ONEUPTIME_API_KEY
clusterName: my-cluster

# Reduce a la mitad los puntos de datos de métricas. Resolución más gruesa, misma cobertura.
collectionInterval: 60s
hostMetrics:
  collectionInterval: 60s
cadvisor:
  scrapeInterval: 60s

# Conserva los logs de pods, pero envía solo los que merecen una alerta. (Las
# métricas no dependen de esto — el colector de nodos se ejecuta igualmente.)
logs:
  enabled: true
  mode: daemonset

filters:
  logs:
    minSeverity: WARN # descarta INFO / DEBUG / TRACE en el agente

namespaceFilters:
  rules:
    - action: exclude
      namespaces: [kube-system]
      scopes: [podLogs, ebpfDiscovery]
    - action: exclude
      namespaces: [noisy-*]
      scopes: [podLogs]

ebpf:
  enabled: true
  features:
    networkMetrics: false # las familias de eBPF más pesadas
    tcpStats: false
    spanMetrics: false
```

```bash
helm upgrade --install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --create-namespace \
  -f lean-values.yaml
```

Reduzca más si es necesario: suba minSeverity a ERROR, añada metrics a los ámbitos de una regla de espacio de nombres o configure ebpf.enabled=false si ya envía trazas desde SDK de OTel.

> **Ten cuidado con lo que recortas.** Algunos monitores dependen de señales específicas: deshabilitar `cadvisor` elimina los monitores de OOM-kill y de throttling de CPU; deshabilitar `kubeletstats.volumeMetrics` elimina el monitor de poco espacio en disco de PVC; deshabilitar los logs elimina las alertas basadas en logs; y `sampling.traces.percentage` no elimina ningún monitor, pero reduce los basados en spans (**Traces** sobre `Span Count`, **Exceptions** sobre `Exception Count`), así que reajusta sus umbrales para que coincidan. Recorta las señales sobre las que no actúas, no las que un monitor está observando.

### Mide el efecto

El uso de telemetría se agrega por día, así que revisa la tendencia durante uno o dos días en **Project Settings → Usage History** para confirmar la reducción — no cambiará en el instante en que apliques un cambio. Cambia una palanca a la vez para que puedas atribuir la diferencia — logs desactivados, luego intervalo aumentado, luego eBPF recortado — en lugar de reducir todo a la vez y perder un monitor del que realmente dependías.

## Solución de problemas

> **Camino más rápido — ejecuta el script de diagnóstico.** Inspecciona el estado de los pods, decodifica y valida la clave de ingesta, comprueba que tu clúster puede alcanzar OneUptime y le pregunta a OneUptime si tu token realmente se acepta — luego imprime un único veredicto de causa raíz:
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/HelmChart/Public/kubernetes-agent/troubleshoot.sh \
>   | bash -s -- -n oneuptime-agent
> ```
>
> Solo lee el estado del clúster y ejecuta un par de sondas; no cambia nada. Para la prueba de egreso más precisa, instala primero con `--set debug.enabled=true` (esto agrega un pequeño sidecar de herramientas de red a los pods del agente para que el script pruebe la ruta de egreso exacta del colector), luego vuelve a ejecutar.

### La instalación falla con "hostPath volumes are not allowed" o un error de admisión de Pod Security

Tu clúster bloquea `hostPath` — común en **GKE Autopilot** y **EKS Fargate**. Cambia al preset de modo API:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set preset=gke-autopilot   # o eks-fargate
```

### El agente muestra "Disconnected"

El estado de conexión de un clúster se determina puramente por la llegada de telemetría — si no aterriza ningún dato, el clúster se marca como desconectado después de ~15 minutos. Por lo tanto, "disconnected" y "no metrics" casi siempre tienen la **misma** causa: la telemetría del agente no se está aceptando.

La razón más común — especialmente después de una reinstalación — es una **clave de ingesta incorrecta o revocada**. Esto es fácil de pasar por alto porque los endpoints de ingesta de OTLP devuelven deliberadamente HTTP `200` incluso para un token incorrecto (para que un colector mal configurado no pueda provocar una tormenta de reintentos en el servidor). El resultado: el colector informa éxito, sus logs no muestran errores y los datos se descartan silenciosamente.

1. Comprueba que los pods del agente estén en ejecución: `kubectl get pods -n oneuptime-agent`
2. Revisa los logs del metrics-collector: `kubectl logs -n oneuptime-agent -l component=metrics-collector -c otel-collector` (la ausencia de errores aquí **no** significa que los datos estén aterrizando — consulta más arriba)
3. **Valida la clave de ingesta.** Pregúntale directamente a OneUptime si tu token se acepta (`200` = válido, `401` = desconocido/revocado):

   ```bash
   curl -i -H "x-oneuptime-token: <YOUR_API_KEY>" https://oneuptime.com/otlp/v1/validate
   ```

   Si devuelve `401`, la clave en tu release es incorrecta o fue revocada. Copia una clave activa desde _Project Settings → Telemetry Ingestion Keys_ y vuelve a desplegar:

   ```bash
   helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
     --namespace oneuptime-agent --reuse-values \
     --set oneuptime.apiKey=<LIVE_KEY>
   ```

4. Verifica que tu URL de OneUptime sea correcta y que tu clúster pueda alcanzarla a través de la red.
5. Si cambiaste `clusterName` en la reinstalación, el agente aparece como un clúster **nuevo** — la entrada anterior permanece "Disconnected" (eso es lo esperado; está obsoleta).

### No aparecen logs (solo modo API)

1. Confirma que el pod del lector de logs esté Ready: `kubectl get pods -n oneuptime-agent -l component=log-collector`
2. Revisa su `/healthz` — informa el número de streams activos y el último error de exportación
3. Revisa los logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent-logs`
4. En clústeres muy grandes, una sola réplica puede ser un cuello de botella; divida versiones independientes con reglas include de ámbito podLogs en namespaceFilters.rules.

### No aparecen métricas

1. Primero descarta una clave de ingesta rechazada — es la causa más común y es invisible desde el lado del agente. Consulta [El agente muestra "Disconnected"](#el-agente-muestra-disconnected) más arriba (o simplemente ejecuta el script de diagnóstico).
2. Comprueba que el identificador del clúster coincida con el valor que pasaste como `clusterName`
3. Verifica los permisos de RBAC: `kubectl get clusterrolebinding | grep kubernetes-agent`
4. Revisa los logs del colector de OTel en busca de errores de exportación

### Los pods de eBPF están en CrashLoopBackOff o no se inician

```bash
kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200
```

Causas comunes:

- **Kernel demasiado antiguo o BTF ausente.** OBI necesita Linux 5.8+ con BTF. Ejecuta `uname -r` en un nodo. Si no puedes actualizar, deshabilita eBPF: `--set ebpf.enabled=false`.
- **Pods privilegiados bloqueados.** Algunos clústeres rechazan los pods privilegiados (GKE Autopilot, EKS Fargate y entornos restringidos). Deshabilita eBPF.
- **`debugfs` / `tracefs` no montados en el host.** La función `tcpStats` se adjunta a tracepoints del kernel que los necesitan. El chart monta ambos mediante `hostPath` — pero si tu host no los expone, deshabilita solo esa familia: `--set ebpf.features.tcpStats=false`.

### No aparecen trazas de aplicaciones

1. Confirma que el DaemonSet de eBPF esté en buen estado: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`
2. Activa el impresor de trazas de depuración para confirmar que OBI está capturando tráfico: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, luego revisa `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`
3. Si ves spans en la salida estándar de OBI pero no en el panel, el problema es la exportación del colector → OneUptime — revisa los logs del pod de metrics-collector.

## Próximos pasos

- Configura **Monitores de Kubernetes** sobre las métricas que recopila este agente — consulta [Agente de Kubernetes (monitores)](/docs/monitor/kubernetes-agent).
- Agrega **Monitores de Logs** para alertar sobre patrones de logs específicos (p. ej., recuentos de errores por encima de un umbral por pod o por namespace).
- Para hosts que no son de Kubernetes (VM y bare metal de Linux / macOS / Windows), usa la página [Colector de OpenTelemetry para Hosts](/docs/telemetry/host-otel-collector).
