# Widgets del panel

Un widget es una baldosa en un panel. Cada widget tiene un tipo (gráfico, valor, lista, …), una posición, un tamaño y una configuración. Esta página es el catálogo — qué muestra cada widget, qué toma como entrada, cuándo recurrir a él.

Para la mecánica del lienzo, consulta [Crear un panel](/docs/dashboards/authoring).

## Widgets de series temporales

### Chart

Un gráfico de líneas / barras / áreas de una o más series de métricas sobre el rango de tiempo del panel.

**Configurar**:

- Una o más consultas de métrica (`metricQueryConfig` para una sola serie, `metricQueryConfigs` para varias).
- **formula** opcional que combina varias consultas (por ejemplo, `errors / total * 100`).
- **transformAsRate** opcional para contadores acumulativos de OpenTelemetry (por ejemplo, `system.disk.io`) — el widget calcula `(value - previousValue) / Δt` por bucket.
- Visualización: series apiladas vs. superpuestas, unidad del eje Y, leyenda on/off, tipo de gráfico.

Recurre a él cuando: las tendencias importan. Latencia de peticiones, conteo de errores a lo largo del tiempo, profundidad de cola, cualquier cosa donde la forma de la curva te dice algo.

### Value

Un único número grande con umbrales opcionales y un sparkline opcional.

**Configurar**:

- Una consulta de métrica (valor único — generalmente `last`, `avg` o `max` sobre el rango de tiempo).
- **Umbral de advertencia** opcional (amarillo por encima).
- **Umbral crítico** opcional (rojo por encima).
- Visualización: formato del número, sufijo de unidad.

Recurre a él cuando: un solo número responde a la pregunta. Tasa de error actual, latencia P95 ahora mismo, conteo de incidentes abiertos.

### Gauge

Un indicador circular con un mínimo, máximo, banda de advertencia y banda crítica.

**Configurar**: la consulta de métrica y los cuatro límites (mínimo, máximo, advertencia, crítico).

Recurre a él cuando: el valor se sitúa dentro de un rango conocido. Utilización de CPU (0–100%), llenado de disco, capacidad de cola.

### Table

Una visualización tabular de los resultados de una consulta de métrica, una fila por grupo.

**Configurar**: la consulta de métrica (típicamente agrupada por una etiqueta como `host.name` o `service.name`), las columnas a mostrar y un límite de filas.

Recurre a él cuando: quieres el desglose en lugar de la tendencia. Top 10 hosts más ruidosos, conteo de errores por servicio, tasa de peticiones por endpoint.

## Widget de anotación

### Text

Un bloque estático de Markdown.

**Configurar**: el cuerpo Markdown. Encabezados, listas, enlaces, énfasis, code spans y bloques de código se renderizan.

Recurre a él cuando: quieres un encabezado de sección, un párrafo de contexto ("este panel cubre el servicio checkout"), una lista de enlaces a runbooks o paneles relacionados, o un banner temporal durante un incidente.

## Logs y trazas

### LogStream

Un tail en vivo de líneas de log que coinciden con un filtro.

**Configurar**: filtros de log (servicio, severidad, coincidencias de atributo), las columnas a mostrar.

Recurre a él cuando: quieres ver lo que la aplicación está diciendo *ahora mismo* en un panel, sin salir de la página para abrir el explorador de logs.

### TraceList

Una lista de trazas recientes que coinciden con un filtro, con duración, estado y nombre del servicio.

**Configurar**: filtros de trazas (servicio, estado, coincidencias de atributo).

Recurre a él cuando: quieres una vista paginada de la actividad reciente en lugar de un gráfico. Emparejamiento común: un Chart de latencia arriba, un TraceList de trazas lentas debajo.

## Listas operacionales

### IncidentList

Una lista en vivo de incidentes que coinciden con un filtro.

**Configurar**: filtros por estado, severidad, etiquetas, monitor o equipo asignado.

Recurre a él cuando: un panel está destinado a responder "¿qué está roto ahora mismo?".

### AlertList

Una lista en vivo de alertas que coinciden con un filtro.

**Configurar**: filtros por estado, severidad, etiquetas.

Recurre a él cuando: paneles para flujos de trabajo dirigidos por alertas (por ejemplo, paneles de equipos de desarrollo que vigilan las alertas de su servicio).

### MonitorList

Una lista en vivo de monitores que coinciden con un filtro, mostrando el estado actual de cada monitor.

**Configurar**: filtros por tipo de monitor, etiquetas o estado actual.

Recurre a él cuando: quieres una vista a nivel de flota del estilo "¿están todos los sitios web activos?", o una lista por equipo de endpoints monitorizados.

## Listas de recursos de Kubernetes

Para los proyectos con un [Agente de Kubernetes](/docs/monitor/kubernetes-agent) instalado, los siguientes widgets de recursos en vivo están disponibles. Cada uno acepta filtros opcionales para `cluster`, `namespace` y etiquetas.

- **KubernetesPodList** — pods con fase, reinicios y asignación de nodo.
- **KubernetesNodeList** — nodos con condiciones, capacidad y asignaciones.
- **KubernetesNamespaceList** — namespaces y sus recuentos de cargas de trabajo.
- **KubernetesDeploymentList** — deployments con réplicas deseadas vs. listas.
- **KubernetesStatefulSetList** — stateful sets con réplicas listas.
- **KubernetesDaemonSetList** — daemon sets con deseadas vs. listas.
- **KubernetesJobList** — jobs con estado de completado.
- **KubernetesCronJobList** — cron jobs con programación y última ejecución.

Recurre a estos cuando: quieres un solo panel que mezcle el estado de los recursos de Kubernetes con la telemetría de esas cargas de trabajo.

## Listas de recursos de Docker

Para los proyectos con un monitor de Docker instalado:

- **DockerHostList** — hosts ejecutando Docker, con recuentos de contenedores.
- **DockerContainerList** — contenedores con estado, imagen, host, uptime.
- **DockerImageList** — imágenes y sus tamaños.
- **DockerNetworkList** — redes Docker y recuentos de contenedores conectados.
- **DockerVolumeList** — volúmenes Docker y su uso.

## Infraestructura

### HostList

Hosts monitorizados por el monitor de servidor de OneUptime — con estado actual, CPU, memoria y uptime.

**Configurar**: filtros por etiquetas o estado de salud actual.

## Elegir el widget adecuado

Algunas reglas rápidas:

- **¿Tendencia a lo largo del tiempo?** Chart.
- **¿Un número que importa ahora mismo?** Value (o Gauge si tiene un rango natural).
- **¿Desglose entre muchas cosas?** Table.
- **¿Qué está pasando en el sistema ahora mismo?** LogStream, TraceList, IncidentList.
- **¿Estado de una flota específica de recursos?** El widget de lista de recursos correspondiente.
- **¿Un encabezado, un párrafo o un enlace?** Text.

La mayoría de los paneles usan una mezcla — un Chart arriba, uno o dos Value al lado, un divisor Text, y luego una o dos listas debajo.

## Qué leer a continuación

- [Variables y filtros del panel](/docs/dashboards/variables) — hacer widgets reutilizables entre servicios / clientes / clusters.
- [Crear un panel](/docs/dashboards/authoring) — el lienzo, la cuadrícula y el modo edit.
- [Compartir y paneles públicos](/docs/dashboards/sharing) — exponer un panel fuera del equipo.
