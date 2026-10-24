# Explorador de métricas

Las métricas son los números que sus servicios y su infraestructura informan a lo largo del tiempo: recuentos de solicitudes, latencias, CPU, profundidad de colas. El explorador de métricas enumera cada métrica que recibe su proyecto, representa cualquiera de ellas en un gráfico, las combina con fórmulas y convierte un gráfico en un monitor o en un widget de panel.

:::cards
- [Encontrar una métrica](#encontrar-una-métrica): Buscar en la lista de nombres de métricas.
- [Representar una métrica](#representar-una-métrica): Agregar, filtrar y agrupar una consulta.
- [Combinar consultas con una fórmula](#combinar-consultas-con-una-fórmula): Tasas de error y otras proporciones.
- [Usar lo que ha representado](#usar-lo-que-ha-representado): Un monitor, un widget de panel o un enlace.
- [Mejorar las métricas y añadir las que faltan con IA](#mejorar-las-métricas-y-añadir-las-que-faltan-con-ia): Pull requests que corrigen sus métricas y añaden las que le faltan a un servicio.
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

El explorador tiene cinco pestañas:

| Pestaña | Para qué sirve |
| --- | --- |
| **Visor** | La lista de métricas, cada una con un pequeño gráfico y su último valor. Se abre con la última hora. |
| **Análisis** | Qué servicios informan métricas, y cuántas. |
| **IA** | Las métricas que registran demasiados valores o cuyos buckets no encajan, y las métricas que faltan, que OneUptime encuentra, y lo que la IA de OneUptime hizo al respecto. Consulte [Mejorar las métricas y añadir las que faltan con IA](#mejorar-las-métricas-y-añadir-las-que-faltan-con-ia). |
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

## Mejorar las métricas y añadir las que faltan con IA

Cada hora OneUptime revisa las métricas que sus servicios enviaron en la última hora en busca de las que registran demasiados valores o cuyos buckets de histograma no encajan, y de servicios con mucho tráfico que no envían métricas, y registra lo que encuentra como hallazgos de IA, con las pruebas. Después, la IA de OneUptime analiza cada uno y abre una pull request para corregirlo. Nunca se fusiona nada: su equipo revisa cada pull request.

OneUptime lee con detalle las 10 métricas para las que sus servicios enviaron más puntos de datos en la hora, cada una con al menos 1,000 de ellos, y registra tres tipos de hallazgo:

| Hallazgo | Cuándo lo registra OneUptime | La pull request |
| --- | --- | --- |
| **Alta cardinalidad** | Un atributo que el código pone en una de esas métricas tomó 1,000 o más valores en la hora, como ID de usuario o URL completas, así que cada valor es una serie propia. O 50 o más de los nombres de métricas de un servicio son un mismo nombre con un ID distinto dentro. | Deja de registrar el valor en la métrica, o quita los ID de sus nombres. |
| **Buckets de histograma incorrectos** | Una de esas métricas es un histograma que registró 1,000 o más valores, y el 90 % o más cayó en su bucket más pequeño o por encima del más grande, o no tiene buckets, así que sus percentiles no se pueden distinguir. | Da al histograma buckets que encajan con sus valores, o corrige su unidad. |
| **Métricas faltantes** | Un servicio envió 1,000 o más spans en la hora y nunca ha enviado una métrica. | Añade como métricas el número de solicitudes, los errores y la duración de sus operaciones más concurridas. |

Un hallazgo nunca guarda los valores de un atributo: solo el nombre del atributo, cuántos valores tomó y cómo son.

### Activarlo

**Métricas → IA → Ajustes** contiene el interruptor **Mejorar las métricas y añadir las que faltan**, activado en los proyectos nuevos. Con **Habilitar IA** desactivado, los problemas de sus métricas se siguen encontrando, pero la IA de OneUptime no hace nada con ellos. Para abrir pull requests, la IA de OneUptime necesita un repositorio conectado en [Código](/docs/ai/ai-agent): la página indica primero lo que falta. El código de cada repositorio se cambia en el Runner que el repositorio elige en Código.

La IA de OneUptime abre por su cuenta como máximo 5 pull requests al día (UTC), una por hallazgo, y nunca más que el límite de pull requests de IA abiertas de un repositorio.

### Reglas de IA

Sin reglas, la IA de OneUptime analiza de inmediato cada problema que encuentra en sus métricas y abre una pull request para cada uno que pueda corregir. Las **Reglas de IA** de **Más ajustes** lo acotan, en tres pasos:

| Paso | Qué decide |
| --- | --- |
| **Coincidencia** | Qué servicios: los elegidos, los que tienen ciertas etiquetas o aquellos cuyo nombre coincide con un patrón. |
| **Investigar** | **De inmediato**, o **Solo si sigue encontrándose tras una espera**: un problema que desaparece durante la espera no se analiza. |
| **Corrección** | **No corregir**, **Preguntar antes de corregir** o **Corregir sin preguntar**. Preguntar primero deja la pull request en manos de una persona: el hallazgo ofrece **Corregir con IA**. |

En **Más campos** una regla elige los repositorios de código, los servidores MCP y el proveedor de LLM que la IA de OneUptime puede usar para ella. Si no se elige ninguno, puede usar cualquiera, y el proveedor de LLM predeterminado del proyecto.

### Ver lo que hizo

- **Métricas → IA → Análisis** muestra lo que OneUptime encontró, cada hallazgo con sus pruebas y **Abrir en Métricas**, que abre su métrica para su servicio, de la hora en que se encontró. Un servicio sin métricas ofrece en su lugar **Abrir en Trazas**: los spans que sus métricas medirían.
- **Métricas → IA → Registros** muestra cada investigación y cada pull request, lo más reciente primero, con el estado de cada una.
- En Código, la tarea indica que OneUptime la inició, con un enlace a su hallazgo, y la pull request explica por qué se abrió.

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
