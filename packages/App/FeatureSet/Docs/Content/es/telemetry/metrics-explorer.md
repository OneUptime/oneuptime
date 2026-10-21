# Explorador de métricas

Las métricas son los números que sus servicios y su infraestructura informan a lo largo del tiempo: recuentos de solicitudes, latencias, CPU, profundidad de colas. El explorador de métricas enumera cada métrica que recibe su proyecto, representa cualquiera de ellas en un gráfico, las combina con fórmulas y convierte un gráfico en un monitor o en un widget de panel.

:::cards
- [Encontrar una métrica](#encontrar-una-métrica): Buscar en la lista de nombres de métricas.
- [Representar una métrica](#representar-una-métrica): Agregar, filtrar y agrupar una consulta.
- [Combinar consultas con una fórmula](#combinar-consultas-con-una-fórmula): Tasas de error y otras proporciones.
- [Usar lo que ha representado](#usar-lo-que-ha-representado): Un monitor, un widget de panel o un enlace.
:::

## Cómo funciona el explorador

El explorador tiene dos niveles. La pestaña **Visor** enumera las métricas que recibe su proyecto. Haga clic en una y el explorador de métricas se abre con una consulta para ella: una métrica, cómo agregarla y cómo filtrarla y agruparla. Cada consulta es una variable, `a`, `b` y así sucesivamente, que una fórmula puede usar.

```mermaid title="De las consultas de métricas a un gráfico, un monitor o un panel"
flowchart TB
    a["Consulta a: solicitudes,<br/>agregadas por Sum"] --> f["Fórmula:<br/>$b / $a * 100"]
    b["Consulta b: errores,<br/>agregados por Sum"] --> f
    f --> chart["Gráfico: tasa de<br/>errores en porcentaje"]
    chart --> monitor["Un monitor de métricas"]
    chart --> dash["Un widget de panel"]
```

El explorador tiene cuatro pestañas:

| Pestaña | Para qué sirve |
| --- | --- |
| **Visor** | La lista de métricas, cada una con un pequeño gráfico y su último valor. Se abre con la última hora. |
| **Análisis** | Qué servicios informan métricas, y cuántas. |
| **Guía de configuración** | Cómo enviar métricas con OpenTelemetry, usando una de sus claves de ingesta. |
| **Ajustes** | **Reglas de canalización** y **Reglas de grabación**: lo que les pasa a las métricas al llegar. |

## Antes de empezar

- **Métricas que llegan.** Envíelas con [OpenTelemetry](/docs/telemetry/open-telemetry), o desde un agente como el [colector de OpenTelemetry para hosts](/docs/telemetry/host-otel-collector) o el [agente de Kubernetes](/docs/telemetry/kubernetes-agent).
- **Un rol que pueda leer telemetría.** Project Owner, Project Admin, Project Member, Viewer, Telemetry Admin, Telemetry Member o Telemetry Viewer, o un rol personalizado con el permiso Read Telemetry Service Metrics. Consulte [Telemetría](/docs/permissions/index#telemetría) para saber qué métricas lee.

## Encontrar una métrica

Vaya a **Productos → Observabilidad → Métricas**. El **Visor** enumera cada métrica que ha recibido su proyecto, por nombre, cada una con un pequeño gráfico del intervalo de tiempo y su último valor.

- Busque nombres con palabras sueltas o `name:`, por ejemplo `name:http.server` encuentra `http.server.request.duration`. Consulte [Sintaxis de búsqueda](/docs/telemetry/search-syntax#métricas).
- Filtre por **Servicio** en la barra lateral para ver solo las métricas que informa un servicio.
- Haga clic en una métrica para representarla en el explorador de métricas.

## Representar una métrica

:::steps
### Abrir la métrica

Haga clic en la métrica en el **Visor**. El explorador se abre con una consulta, `a`, para el intervalo de tiempo y los filtros de la lista.

### Elegir cómo agregarla

En **Agregar por**, elija cómo se combinan los valores de cada punto del gráfico: Avg, que es el predeterminado, Sum, Min, Max, Count, o un percentil, P50, P75, P90, P95 o P99. El percentil de una métrica de histograma, como la duración de una solicitud, se calcula a partir de sus buckets.

### Filtrarla y agruparla

Abra **Filtros y agrupación**. **Filtrar por atributos** conserva los puntos de datos cuyos atributos coinciden, como una `http.route` concreta, y **Agrupar por** dibuja una línea por valor de los atributos que elija, como una línea por host.

### Ajustar el gráfico

Abra **Ajustes de visualización** para elegir el **Tipo de gráfico** (líneas, áreas o barras), dibujar un **Umbral de advertencia** y un **Umbral crítico** en el gráfico, o activar **Convertir a tasa por segundo**.
:::

> [!TIP]
> Un contador que solo sube, como `system.disk.io`, se lee mejor como tasa. Active **Convertir a tasa por segundo** para mostrar lo rápido que cambia en lugar de su total acumulado; el explorador lo sugiere cuando detecta un contador así.

Cada consulta dibuja su propio gráfico. Para dibujar una consulta en el mismo gráfico que la anterior, active **Superponer con la consulta anterior** en sus **Ajustes de visualización**.

## Combinar consultas con una fórmula

:::steps
### Añadir las consultas

Haga clic en **Añadir métrica** por cada métrica que necesite. Las nuevas consultas son `b`, `c` y así sucesivamente.

### Añadir una fórmula

Haga clic en **Añadir fórmula** y escriba la **Fórmula** con las variables de las consultas, los operadores `+`, `-`, `*`, `/`, `%` y `^`, y paréntesis. Para una tasa de errores en porcentaje, escriba `$b / $a * 100`.
:::

Una variable se puede escribir con o sin su `$`, en mayúsculas o minúsculas. Una fórmula que nombra una consulta que no ha definido lo indica en lugar de dibujar.

## Explorar alrededor de un gráfico

Los botones encima de los gráficos trabajan sobre el intervalo de tiempo que está viendo:

| Botón | Qué hace |
| --- | --- |
| **Registros** | Abre el [Explorador de registros](/docs/telemetry/logs-explorer) para este intervalo de tiempo y sus filtros. |
| **Trazas** | Abre el [Explorador de trazas](/docs/telemetry/traces-explorer) para este intervalo de tiempo y sus filtros. |
| **Investigar** | Abre un panel lateral con los registros, las trazas y las excepciones de este intervalo de tiempo. |
| **Eventos** | Marca en los gráficos los incidentes y las alertas de este intervalo de tiempo. |
| **Comparar** | Dibuja el periodo anterior en cada gráfico como línea discontinua, para ver qué ha cambiado. |

Arrastre sobre un gráfico para acercarse a un momento y haga doble clic para alejarse: consulte [Hacer zoom en un intervalo de tiempo](/docs/telemetry/charts-and-time-ranges).

## Usar lo que ha representado

- **Acciones → Crear monitor a partir de esta vista** abre un nuevo monitor de métricas con estas consultas y fórmulas ya rellenadas. Consulte [Monitor de métricas](/docs/monitor/metrics-monitor).
- **Acciones → Añadir al panel** añade el gráfico al panel que elija. Necesita permiso para editar ese panel.
- **Copiar enlace** copia un enlace exactamente a esta vista: consultas, fórmulas e intervalo de tiempo.
- **Vistas guardadas** conserva la vista con un nombre para todos en el proyecto. El **Visor** tiene sus propias vistas guardadas, para su búsqueda y sus filtros. Las vistas guardadas funcionan como en el [Explorador de registros](/docs/telemetry/logs-explorer#guardar-una-vista).

## Análisis de métricas

La pestaña **Análisis** cuenta las métricas de un intervalo de tiempo: **Métricas activas**, **Servicios de informes** y la media por servicio. Agrupa las métricas en categorías y enumera los servicios que las informan.

## Qué les pasa a las métricas al llegar

**Métricas → Ajustes → Reglas de canalización** cambia las métricas al llegar, antes de almacenarlas. Las reglas se ejecutan en el orden de la lista, que cambia arrastrándolas; una regla para un servicio se ejecuta antes que las reglas para todos los servicios.

| Tipo de regla | Qué hace |
| --- | --- |
| Filtro (lista de permitidos) | Conserva solo los puntos de datos que coinciden y descarta el resto. |
| Descartar | Descarta los puntos de datos que coinciden. |
| Renombrar métrica | Cambia el nombre de la métrica. |
| Renombrar atributo | Cambia la clave de un atributo en los puntos de datos que coinciden. |
| Añadir atributo | Añade un atributo a los puntos de datos que coinciden. |
| Eliminar atributo | Quita un atributo, como uno con demasiados valores para ser útil. |
| Redactar atributo | Sustituye el valor de un atributo por un marcador. |
| Muestra | Conserva un porcentaje de los puntos de datos que coinciden. |

**Métricas → Ajustes → Reglas de grabación** calcula cada minuto métricas nuevas a partir de otras métricas. Consulte [Reglas de grabación de registros](/docs/telemetry/log-recording-rules) para ver cómo funcionan las reglas de grabación.

## Solución de problemas

:::details El gráfico de un contador solo sube
Es un contador acumulativo. Active **Convertir a tasa por segundo** en los **Ajustes de visualización** de la consulta.
:::

:::details La lista dice que no se encontraron métricas
Borre primero su búsqueda y sus chips de filtro. Si la lista sigue vacía, todavía no ha llegado ninguna métrica a OneUptime: compare su configuración con la **Guía de configuración**.
:::

:::details Faltan las métricas de un servicio
Filtre el **Visor** por ese **Servicio** y amplíe el intervalo de tiempo. Si siguen faltando, puede que el ámbito de su rol deje fuera ese servicio: consulte [Telemetría](/docs/permissions/index#telemetría).
:::

## Próximos pasos

:::cards
- [Monitor de métricas](/docs/monitor/metrics-monitor): Recibir alertas cuando una métrica supere un umbral.
- [Crear un panel](/docs/dashboards/authoring): Poner sus gráficos uno junto a otro.
- [Sintaxis de búsqueda](/docs/telemetry/search-syntax): Todos los filtros que entiende el cuadro de búsqueda.
:::
