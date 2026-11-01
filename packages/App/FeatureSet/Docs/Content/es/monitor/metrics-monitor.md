# Monitor de métricas

Un monitor de métricas consulta las métricas que tus aplicaciones y tu infraestructura envían a OneUptime, las combina con fórmulas cuando necesitas una proporción o un total, y compara el resultado con tus criterios a lo largo de un intervalo de tiempo móvil. Úsalo para tasas de solicitudes, proporciones de errores, profundidad de colas, CPU, memoria y disco (cualquier serie numérica), con una alerta por host o por contenedor cuando lo agrupas.

:::cards
- [Crear el monitor](#crear-un-monitor-de-métricas): Consultas, fórmulas, un intervalo de tiempo y criterios.
- [Cómo se evalúa](#cómo-se-evalúa): Puntos de datos, fórmulas y la agregación de los criterios.
- [Ejemplo práctico](#ejemplo-práctico-una-cola-que-crece): Los mismos datos con cada agregación.
- [Alertas por serie](#alertas-por-serie-group-by): Una alerta por host, contenedor o punto de montaje.
:::

## Cómo funciona

```mermaid title="De las consultas de métricas a un estado, cada minuto"
flowchart TB
    Src["Aplicaciones y hosts"] -->|OpenTelemetry| Store[("Métricas en OneUptime")]
    Store --> Query["Consultas a, b<br/>un punto de datos por intervalo"]
    Query --> Formula["Fórmulas, como a / b * 100"]
    Formula --> Reduce["Agregación del criterio<br/>Promedio, Máximo, Any Value"]
    Reduce --> Check{"¿Se cumple la condición?"}
    Check -->|Sí| Act["Cambiar el estado,<br/>alerta o incidente"]
```

Cada minuto, OneUptime ejecuta cada consulta de métricas del monitor sobre su intervalo de tiempo. Una consulta devuelve un punto de datos por intervalo, y las fórmulas combinan las consultas intervalo a intervalo. Después, cada criterio reduce los puntos de datos de la consulta o la fórmula que comprueba (a su promedio, a su máximo o a una prueba de cada punto) y compara el resultado con su umbral.

## Antes de empezar

- Tus aplicaciones o tu infraestructura envían métricas a OneUptime mediante OpenTelemetry. Consulta [OpenTelemetry](/docs/telemetry/open-telemetry).
- Conoce el nombre de la métrica y los atributos por los que quieres filtrar o agrupar. Las listas **Métrica** y **Agrupar por** solo ofrecen nombres y atributos que OneUptime ha recibido.

## Crear un monitor de métricas

:::steps
### Empezar un monitor nuevo

Ve a **Monitores** y haz clic en **Crear monitor**. O, en el explorador de métricas, crea el gráfico que quieres vigilar y haz clic en **Crear monitor a partir de esta vista**: el nuevo monitor empieza con sus consultas.

### Elegir Metrics

En **Tipo de monitor**, haz clic en **Más tipos de monitor** y elige **Métricas** en **Telemetría**, o escribe `metrics` en el cuadro de búsqueda. Escribe un **Nombre** y haz clic en **Siguiente**.

### Añadir las consultas de métricas

En **Métrica que vigilar**, elige una **Métrica** y cómo **Agregar por** ella. Abre **Filtros y agrupación** para filtrar por atributos o para **Agrupar por** uno de ellos. Haz clic en **Añadir métrica** para otra consulta, o en **Añadir fórmula** para combinarlas. El gráfico bajo las consultas muestra las últimas horas, con el valor de la regla como una línea roja, para que veas los valores que comprobará la regla.

### Decir cuándo alertar

En **Cuándo alertar**, elige en **Medido como** cómo se mide la métrica, una **Ventana de tiempo**, una **Condición** y un **Valor**. Cuando el paso tiene más de una consulta o fórmula, elige también la **Métrica** que lee la regla. La frase de debajo repite la regla con palabras sencillas.

### Elegir qué pasa

En **Qué pasa**, elige **Crear una alerta**, **Declarar un incidente** o **Ambos**, y dale un título y una gravedad. Mientras la regla coincide, el monitor muestra el estado indicado en **Más campos**; cuando deja de coincidir, el monitor vuelve a su estado predeterminado y la alerta o el incidente se resuelve solo.

### Crear el monitor

Haz clic en **Crear monitor**. El monitor se abre en su página **Vista general**, y su primera evaluación se ejecuta en menos de un minuto.
:::

## Qué consulta

### Consultas de métricas

| Campo | Qué hace | Predeterminado |
| --- | --- | --- |
| **Métrica** | La métrica que se consulta. | Obligatorio |
| **Agregar por** | Cómo se combinan los valores de cada intervalo de tiempo en un punto de datos: Prom., Suma, Mín., Máx., Recuento o un percentil (P50, P75, P90, P95 o P99). | Prom. |
| **Filtrar por atributos** (en **Filtros y agrupación**) | Solo las series cuyos atributos cumplen estas condiciones. | Sin filtro |
| **Agrupar por** (en **Filtros y agrupación**) | Una serie por cada valor único de estos atributos; consulta [Alertas por serie](#alertas-por-serie-group-by). | Una sola serie |

Cada consulta y cada fórmula recibe una variable (`a`, `b`, `c`, etc.) en el orden en que las añades.

### Fórmulas

Una fórmula combina variables de consulta con `+`, `-`, `*`, `/`, `%`, `^` y paréntesis, intervalo a intervalo. Puedes escribir las variables con o sin un `$` delante:

- `a / b * 100`: la parte de `b` que es `a`, como porcentaje
- `a + b`: dos métricas sumadas
- `a - b`: la diferencia entre ellas

### Ventana de tiempo móvil

La **Ventana de tiempo** de **Cuándo alertar** define hasta dónde mira atrás cada evaluación: **Último minuto**, **Últimos 5 minutos**, **Últimos 10 minutos**, **Últimos 15 minutos**, **Últimos 30 minutos**, **Última hora**, **Últimas 2 horas**, **Últimas 3 horas**, **Últimas 6 horas**, **Últimas 12 horas**, **Últimas 24 horas**, **Últimos 2 días**, **Últimos 3 días**, **Últimos 7 días**, **Últimos 14 días**, **Últimos 30 días**, **Últimos 60 días**, **Últimos 90 días**, **Últimos 180 días** o **Últimos 365 días**.

Cuanto más larga es la ventana, más ancho es cada tramo de tiempo, así que un punto de datos representa más tiempo:

| Ventana de tiempo | Un punto de datos por |
| --- | --- |
| De Último minuto a Últimas 3 horas | minuto |
| Últimas 6 horas, Últimas 12 horas | 5 minutos |
| Últimas 24 horas | 15 minutos |
| Últimos 2 días, Últimos 3 días | 30 minutos |
| Últimos 7 días | hora |
| Últimos 14 días, Últimos 30 días | día |
| De Últimos 60 días a Últimos 180 días | semana |
| Últimos 365 días | mes |

## Cómo se evalúa

- **Cada minuto.** Un monitor de métricas no lo comprueban sondas, así que no tiene intervalo que configurar ni página **Sondas e intervalo**.
- **Primero las consultas, luego las fórmulas.** Cada consulta devuelve un punto de datos por tramo de tiempo del intervalo, según su **Agregar por**. Las fórmulas se calculan para cada tramo a partir de los puntos de datos de las consultas.
- **Después, la medida de la regla.** La regla reduce los puntos de datos de su métrica a lo que compara con su valor, según dice **Medido como**:

| Medido como | En los criterios propios | La condición se comprueba con… |
| --- | --- | --- |
| La media | Promedio | el promedio de los puntos de datos |
| La suma | Suma | la suma de los puntos de datos |
| El valor más alto | Maximum Value | el punto de datos más alto |
| El valor más bajo | Minimum Value | el punto de datos más bajo |
| Cada valor (toda la ventana) | All Values | cada punto de datos: todos deben cumplir la condición y cubrir todo el intervalo de tiempo |
| Algún valor (en cualquier momento) | Any Value | cada punto de datos: basta con que uno la cumpla |

- **Criterios de arriba abajo.** En un monitor sin Group By decide el primer criterio que coincide, así que pon primero el más grave. Un monitor agrupado comprueba todos los criterios para cada serie; consulta [La evaluación de los criterios es distinta](#la-evaluación-de-los-criterios-es-distinta).
- **Sin datos no es cero.** Cuando la consulta no devuelve puntos de datos en el intervalo, la regla hace lo que dice **Si no hay datos**, en **Más campos** de **Cuándo alertar**: **Nada** (el predeterminado: la regla no coincide), **Contar como cero** o **Alertar, como si coincidiera**.
- **Cada valor necesita todo el intervalo de tiempo.** Una serie cumple una regla medida como **Cada valor (toda la ventana)** solo cuando sus puntos de datos cubren el intervalo de tiempo, desde su inicio hasta ahora, sin un hueco de más de un punto de datos ausente. Cuando todos los datos del monitor llegan con retraso, como los de CloudWatch, su punto de datos más reciente ocupa el lugar de ahora. Un host, un contenedor o un deployment que acaba de empezar a enviar datos, o que estuvo en silencio un tiempo, espera hasta tener datos de todo un intervalo de tiempo, y el registro de evaluación indica cuánto lleva: `Waiting for 15 minutes of data: 2 of 15 minutes so far`. Una serie cuya alerta o incidente ya está abierto se juzga solo por sus puntos de datos, así que un hueco corto en sus datos no lo resuelve. Si la métrica envía datos con menos frecuencia de lo que dura el intervalo de tiempo, un único punto de datos cuenta para todo el intervalo cuando ya tiene unos minutos; para juzgar cuánto dura un valor, el intervalo de tiempo debe abarcar al menos dos intervalos de envío.
- **La caída del propio OneUptime no es silencio.** Mientras el intervalo de tiempo contenga un periodo en el que OneUptime no recibía datos (se estaba reiniciando, actualizando o poniéndose al día), la comprobación espera: el estado no cambia y no se abre ni se resuelve ningún incidente ni alerta, diga lo que diga **Si no hay datos**. Consulta [Cuando OneUptime no recibe datos](/docs/monitor/when-oneuptime-is-not-receiving).

## Criterios

Estos monitores evalúan siempre el **Metric Value**: el valor agregado de la consulta de métricas o la fórmula configurada. **Cuándo alertar** configura un criterio a partir de **Medido como**, **Ventana de tiempo**, **Condición** y **Valor**. Cuando la métrica tiene unidad, elige la unidad del valor a su lado. Su **Condición** es **Por encima de**, **Igual o por encima de**, **Por debajo de**, **Igual o por debajo de**, **Exactamente**, **Inusualmente alto**, **Inusualmente bajo** o **Inusualmente alto o bajo**. Para varios criterios, como franjas de gravedad, haz clic en **Editar como criterios propios** en **Más campos** de **Qué pasa**: cada criterio tiene allí una **Métrica**, una **Agregación**, una **Condición** y un **Umbral**.

| Condición | Coincide cuando el valor está… |
| --- | --- |
| **Mayor que** | por encima del umbral |
| **Mayor o igual que** | en el umbral o por encima |
| **Menor que** | por debajo del umbral |
| **Menor o igual que** | en el umbral o por debajo |
| **Igual a** | exactamente en el umbral |
| **Anomalously High** | por encima del rango esperado para esta hora de la semana |
| **Anomalously Low** | por debajo de ese rango |
| **Anomalous** | fuera de ese rango, en cualquier sentido |
| **Sin datos** | ausente: la consulta no envió nada en la ventana |
| **Con datos** | presente: la consulta envió algo en la ventana |

Las condiciones de anomalía no tienen umbral. En su lugar, **Cuándo alertar** muestra **Sensibilidad** (Baja, Media, la predeterminada, o Alta), y los criterios propios también una **Ventana de referencia** (14 días, la predeterminada, 28, 60 o 90), y cada punto de datos se compara con la referencia de la misma hora de la semana construida con esa ventana. Hasta que esa hora de la semana tenga suficiente historial, el criterio sigue aprendiendo y no genera alertas.

Un monitor de métricas creado en Crear monitor empieza con una regla sobre su primera consulta: **La media** en **Últimos 5 minutos**, **Por encima de** el **Valor** que indiques, y **Crear una alerta**.

Un monitor de métricas nuevo creado mediante la API o Terraform sin criterios empieza con dos criterios sobre su primera consulta, ambos con la agregación **Any Value**:

| Criterio | Condición | Efecto |
| --- | --- | --- |
| Check if … is offline | **Igual a** `0` | Pone el monitor fuera de línea y declara un incidente que se resuelve solo |
| Check if … is online | **Mayor que** `0` | Pone el monitor en línea |

> [!NOTE]
> El criterio de fuera de línea se dispara con un valor informado de 0, no con el silencio. Para alertar cuando una métrica deja de llegar, pon su **Si no hay datos** en **Disparador**.

## Ejemplo práctico: una cola que crece

Quieres un incidente cuando la cola de checkout se mantiene profunda. La consulta `a` es el gauge `checkout.queue.depth`, con **Agregar por** Máx., y la **Ventana de tiempo** es **Últimos 5 minutos**. Una evaluación ve estos cinco puntos de datos de un minuto:

| Minuto | 10:01 | 10:02 | 10:03 | 10:04 | 10:05 |
| --- | --- | --- | --- | --- | --- |
| `a` | 640 | 980 | 1500 | 1620 | 1100 |

Una regla **Por encima de** `1000` da una respuesta distinta para cada opción de **Medido como**:

| Medido como | Comparado con 1000 | ¿Coincide? |
| --- | --- | --- |
| La media | 1168 | Sí |
| La suma | 5840 | Sí |
| El valor más alto | 1620 | Sí |
| El valor más bajo | 640 | No |
| Cada valor (toda la ventana) | 640, 980, 1500, 1620, 1100 | No: dos puntos no superan 1000 |
| Algún valor (en cualquier momento) | 640, 980, 1500, 1620, 1100 | Sí: 1500 lo supera |

**La media** avisa ante un atasco sostenido e ignora un minuto profundo aislado; **Cada valor (toda la ventana)** espera a que cada minuto del intervalo sea profundo; **Algún valor (en cualquier momento)** avisa en el primer minuto profundo.

## Alertas por serie (Group By)

**Agrupar por** en una consulta de métricas divide esa consulta en una serie por cada valor único de atributo (una por host, una por contenedor, una por punto de montaje), y un monitor con Group By evalúa cada serie de forma independiente. Ese único ajuste marca la diferencia entre «la flota no está bien» y «`prod-db-01` no está bien».

### Una alerta por grupo

Con Group By en `host.name`, un monitor de uso de disco que vigila cincuenta hosts lanza **una alerta (o un incidente) por cada host que supera el umbral**. El host A que se llena abre su propia alerta; el host B que se llena diez minutos después abre una segunda alerta, independiente, junto a ella.

Sin Group By, el mismo monitor es un único escalar: la consulta reduce todos los hosts a un solo número y el monitor lanza **una sola alerta para todo el monitor**. Mientras esa alerta está abierta, un segundo host que supera el umbral no produce nada (el monitor ya está alertando, así que no hay nada nuevo que lanzar) y el ingeniero de guardia nunca se entera del host B. **Definir Group By es la forma de obtener alertas por host.** Si quieres que te avisen por host, por contenedor o por punto de montaje, defínelo.

### Resolución independiente

Cada alerta por grupo sigue a su propio grupo. Cuando el host A vuelve por debajo del umbral, su alerta se resuelve por su cuenta, y la alerta del host B sigue abierta hasta que el host B se recupere. La recuperación de un grupo nunca cierra la alerta de otro.

### La evaluación de los criterios es distinta

- **Los monitores agrupados evalúan todos los criterios.** Así, distintos niveles de gravedad pueden dispararse en distintos grupos a la vez: con «Critical: mayor que 95» por encima de «Warning: mayor que 80», un host al 96 % abre una alerta crítica mientras que un host al 85 % abre una de advertencia en la misma comprobación. Un host que supera ambos niveles sigue recibiendo exactamente una alerta, la del primer criterio que coincide, así que **ordena los criterios del más grave al menos grave**.
- **Los monitores sin agrupar se detienen en el primer criterio que coincide.** Solo se dispara ese criterio, otra razón para poner el criterio de alerta por encima del de buen estado: un criterio de buen estado amplio colocado primero coincide en casi todas las comprobaciones e impide que el criterio de alerta de debajo llegue a evaluarse.

| Host | Disco usado | Critical (> 95) | Warning (> 80) | Alerta lanzada |
| --- | --- | --- | --- | --- |
| `prod-db-01` | 96 % | Sí | Sí | Critical |
| `prod-db-02` | 85 % | No | Sí | Warning |
| `prod-db-03` | 40 % | No | No | Ninguna |

### Elegir un atributo para agrupar

Agrupa por un atributo que identifique de verdad algo distinto por lo que avisarías a alguien: el atributo de host para una métrica de host de toda la flota, el atributo de contenedor o de pod para una métrica de contenedor, el atributo de punto de montaje o de dispositivo para una métrica de sistema de archivos o de E/S de disco, el atributo de interfaz para una métrica de red. La lista desplegable **Agrupar por** se rellena con los atributos que tu colector envía de verdad, así que elige de la lista en lugar de escribir una clave a mano.

No agrupes una métrica que ya es un único escalar para todo el sistema (un indicador de líder de todo el clúster, una cola pendiente de un planificador o la CPU de un único host en un monitor de un solo host). Agruparla produce exactamente una serie y no cambia nada salvo los títulos de las alertas.

Los valores del atributo de agrupación también están disponibles como [variables de plantilla](/docs/monitor/incident-alert-templating) en el título, la descripción y las notas de remediación de la alerta o el incidente: agrupar por `host.name` permite que el título diga `Disk almost full on {{host.name}}`.

## Solución de problemas

:::details El gráfico muestra que se superó el umbral, pero el monitor no alertó
Comprueba primero **Medido como**: **Cada valor (toda la ventana)** solo coincide cuando todos los puntos de datos del intervalo superan el valor, y **La media** suaviza un pico breve. **Cada valor (toda la ventana)** también espera hasta que una serie tenga datos de todo el intervalo de tiempo, así que un host o un deployment que acaba de empezar a enviar datos todavía no se juzga. Después comprueba que la regla lea la consulta o la fórmula que quieres (`a` no es la fórmula `c`) y que el **Valor** esté en la unidad que crees.
:::

:::details La métrica dejó de llegar y no pasó nada
Un intervalo sin puntos de datos no es un valor de 0. Con **Si no hay datos** en su valor predeterminado, **Nada**, la regla no coincide. Ponlo en **Alertar, como si coincidiera** en **Más campos** de **Cuándo alertar** para alertar ante el silencio.
:::

:::details Recibo una sola alerta para toda la flota
La consulta no tiene **Agrupar por**, así que todos los hosts se reducen a un solo número. Agrupa la consulta por el atributo de host, de contenedor o de punto de montaje; consulta [Alertas por serie](#alertas-por-serie-group-by).
:::

:::details Un criterio de anomalía nunca se dispara
Sigue aprendiendo: la hora de la semana con la que compara aún no tiene suficiente historial dentro de la **Ventana de referencia**.
:::

## Próximos pasos

:::cards
- [Plantillas de incidentes y alertas](/docs/monitor/incident-alert-templating): Pon el host y el valor en los títulos de las alertas.
- [Monitor de registros](/docs/monitor/logs-monitor): Alerta sobre el volumen y el contenido de los registros, por grupo.
- [Monitor de hosts](/docs/monitor/host-monitor): Comprobaciones listas de CPU, memoria y disco para tus hosts.
- [OpenTelemetry](/docs/telemetry/open-telemetry): Envía métricas a OneUptime.
:::
