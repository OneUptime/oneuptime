# Observabilidad de costos de Kubernetes

## Resumen

OneUptime puede mostrarte lo que realmente cuesta cada carga de trabajo de Kubernetes — gasto por namespace, por controlador y por pod, con la capacidad ociosa y la eficiencia de request frente a uso — justo al lado de las métricas, logs y trazas que ya recopilas con el [Agente de Kubernetes](/docs/telemetry/kubernetes-agent).

Habilitarlo es un solo comando:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set cost.enabled=true
```

Eso es una instalación completa. El chart incluye el motor de código abierto [OpenCost](https://opencost.io) (Apache-2.0, CNCF — el [cost-model](https://github.com/kubecost/cost-model) que también impulsa a Kubecost) más un Prometheus mínimo y dedicado que este necesita para el historial de uso — dos pequeños pods de fontanería invisible. OpenCost tarifica tus nodos, volúmenes y balanceadores de carga a partir de los **precios de lista públicos de tu proveedor de nube, automáticamente y sin credenciales** (AWS, GCP, Azure); los clústeres on-prem establecen en su lugar una tabla de tarifas (más abajo).

En aproximadamente una hora (la primera ventana horaria cerrada), obtienes:

- Una **página de Costs por clúster** (_Kubernetes → tu clúster → Costs_): tendencia del gasto, gasto por namespace con desglose de cpu/memoria/almacenamiento, gasto por carga de trabajo, gasto ocioso y eficiencia.
- Una **página de Costs a nivel de proyecto** (_Kubernetes → Costs_): el gasto de todos los clústeres del proyecto.
- Una **plantilla de panel Kubernetes Cost** (_Dashboards → Create → Kubernetes Cost Dashboard_): tendencias del costo por hora de los nodos, costos unitarios de CPU/RAM, gasto en volúmenes persistentes y balanceadores de carga.
- Métricas de costo sin procesar (`node_total_hourly_cost`, `pv_hourly_cost`, ...) en el **Metric Explorer**, utilizables en paneles personalizados y alertas de métricas.

## Cómo funciona

Con `cost.enabled=true` el chart ejecuta cuatro cosas:

1. **OpenCost** (incluido) — observa el clúster, descubre los precios de lista de la nube y calcula asignaciones de costos con precios ya aplicados por carga de trabajo.
2. **Un Prometheus mínimo** (incluido) — OpenCost requiere un endpoint de PromQL para el historial de uso y precios. Este existe únicamente para eso: una sola réplica, 3 días de retención y exactamente dos objetivos de recopilación (cAdvisor a través del proxy de nodo del API-server, y el propio OpenCost — OpenCost emite sus propias métricas de requests de recursos al estilo KSM, así que kube-state-metrics no interviene). Nunca se expone fuera del clúster y sus datos nunca lo abandonan.
3. **El poller de asignación de costos** (`cost.agent`) — consulta la API de Allocation de OpenCost una vez por cada ventana horaria cerrada y envía mediante POST a OneUptime filas de costo por carga de trabajo (cpu / ram / gpu / pv / red / balanceador de carga / ocioso, más la eficiencia). Las ventanas se envían exactamente una vez — el servidor omite las ventanas que ya ingirió, por lo que los reinicios no pueden contar el gasto dos veces.
4. **Una recopilación de métricas de costo** (`cost.metrics`) — el colector de OpenTelemetry del agente recopila las métricas de Prometheus de OpenCost (restringidas por lista de permitidos a las series de costo) a través de la misma canalización OTLP que el resto de tus métricas del clúster.

## ¿Ya ejecutas Kubecost u OpenCost?

Apunta el chart a tu motor existente en su lugar — entonces no se incluye nada:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set cost.enabled=true \
  --set cost.engine.url=http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090
```

| Motor    | URL de servicio típica                                           |
| -------- | ---------------------------------------------------------------- |
| OpenCost | `http://opencost.opencost.svc.cluster.local:9003`                |
| Kubecost | `http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090`  |

La ruta de la API de Allocation se detecta automáticamente (`/model/allocation` para Kubecost, `/allocation/compute` o `/allocation` para OpenCost). Establece `cost.engine.allocationPath` solo para instalaciones no estándar.

## Precios on-prem / bare metal

Los clústeres cuyos nodos no tienen un precio de lista público de nube pueden establecer una tabla de tarifas — OpenCost tarifica entonces cada recurso a partir de estas cifras. Todos los valores son **USD por recurso-hora**:

```yaml
cost:
  enabled: true
  opencost:
    customPricing:
      enabled: true
      cpuPerCoreHour: "0.031611"       # ~$23 per core-month
      ramPerGiBHour: "0.004237"        # ~$3 per GiB-month
      storagePerGBHour: "0.00005479452" # ~$0.04 per GB-month
      gpuPerHour: "0.95"
```

## Ajustes útiles

Todos opcionales — consulta el `values.yaml` del chart para ver la lista completa:

```yaml
cost:
  agent:
    windowSeconds: 3600   # allocation window length (hourly = native)
    includeIdle: true     # ship the engine's __idle__ allocation
    currency: USD         # currency code shown in the UI (informational)
  prometheus:
    retention: 3d         # bundled TSDB history — a few days is plenty
    persistence:
      enabled: false      # set true for a small PVC; emptyDir otherwise
  metrics:
    enabled: true         # cost metrics for dashboards / Metric Explorer
    scrapeInterval: 60s
```

## Alertas sobre costos

Las métricas de costo recopiladas son métricas ordinarias de OneUptime, así que puedes ponerles alertas de métricas como a cualquier otra — p. ej., alertar cuando el promedio de `node_total_hourly_cost` supera un umbral de presupuesto, o cuando `pv_hourly_cost` aparece para una clase de volumen que no debería existir en un clúster.

## Modelo de datos y retención

Las filas de asignación se almacenan en ClickHouse (una fila por clúster, ventana, namespace, controlador, pod y contenedor) y siguen la retención de telemetría del clúster: el ajuste `retainTelemetryDataForDays` del recurso de clúster de Kubernetes, con la retención de datos del proyecto como respaldo. La capacidad ociosa y la no asignada se almacenan como filas normales bajo los namespaces `__idle__` / `__unallocated__`, por lo que se pueden consultar con las mismas agrupaciones que el gasto de las cargas de trabajo.

## Solución de problemas

- **Las páginas de Costs están vacías** — revisa los logs del agente de costos: `kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-cost`. Un `401` significa que la clave de ingesta es inválida; `cost engine did not answer any known allocation path` significa que el motor aún no está listo (el OpenCost incluido necesita unos minutos después de la instalación para tarificar sus primeras ventanas) o que `cost.engine.url` es incorrecto.
- **El OpenCost incluido no está listo** — `kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-opencost`. Registra qué proveedor de nube detectó y si se cargaron los datos de precios.
- **La plantilla de panel no muestra datos** — la plantilla lee las métricas de costo recopiladas; confirma que `cost.metrics.enabled` esté en `true`.
- **Los números difieren de la propia interfaz del motor** — OneUptime incluye los ajustes de conciliación del motor en cada componente de costo y envía ventanas cerradas completas; el gasto parcial de la hora en curso aparece después de que la ventana se cierra.
- **El pod de Prometheus se reinició** — con el almacenamiento `emptyDir` predeterminado, un reinicio pierde unas horas de historial de uso, por lo que las asignaciones de esas ventanas pueden ser menores. Establece `cost.prometheus.persistence.enabled=true` si eso te importa.
