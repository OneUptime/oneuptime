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

En un clúster **standard** verás un Deployment de metrics-collector más un pod de DaemonSet de log-collector por cada nodo:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
kubernetes-agent-logs-yyyyy                   1/1     Running   0          1m
```

En **GKE Autopilot** o **EKS Fargate** verás dos Deployments en su lugar (sin DaemonSet):

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
```

Una vez que el agente se conecta, tu clúster aparecerá automáticamente en la sección **Kubernetes** del panel de OneUptime.

## Opciones de configuración

### Filtrado de namespaces

De forma predeterminada, `kube-system` se excluye. Para monitorear solo namespaces específicos:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set "namespaceFilters.include={default,production,staging}"
```

### Deshabilitar la recopilación de logs

Si solo necesitas métricas y eventos (sin logs de pods):

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set logs.enabled=false
```

### Forzar un modo específico de recopilación de logs

Los usuarios avanzados pueden anular la elección del preset con `logs.mode`:

- `logs.mode=daemonset` — DaemonSet con hostPath (menor sobrecarga, requiere hostPath)
- `logs.mode=api` — Deployment de lector de logs mediante la API de Kubernetes (funciona en cualquier clúster)
- `logs.mode=disabled` — sin recopilación de logs

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
4. Para clústeres muy grandes, una sola réplica puede ser un cuello de botella — fragmenta por namespace usando `namespaceFilters.include` en releases separados

### No aparecen métricas

1. Primero descarta una clave de ingesta rechazada — es la causa más común y es invisible desde el lado del agente. Consulta [El agente muestra "Disconnected"](#agent-shows-disconnected) más arriba (o simplemente ejecuta el script de diagnóstico).
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
