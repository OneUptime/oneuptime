# Monitor de excepciones

Un monitor de excepciones cuenta, en una ventana de tiempo, las excepciones que tus servicios notifican a OneUptime y que coinciden con tus filtros (mensaje, tipo de excepción, entorno, servicio). Cuando el recuento cumple tus criterios, cambia el estado del monitor, crea una alerta o declara un incidente. Úsalo para alertar sobre cualquier fallo nuevo en producción, sobre un tipo de excepción concreto o sobre un aumento repentino de errores.

:::cards
- [Crear el monitor](#crear-un-monitor-de-excepciones): Elige qué excepciones contar y cuándo alertar.
- [Entornos](#entornos): Limita el monitor a `production`.
- [Cómo se evalúa](#cómo-se-evalúa): Qué se cuenta y qué hace resolver una excepción.
- [Criterios](#criterios): Las condiciones y los valores predeterminados.
:::

## Cómo funciona

```mermaid title="Cada minuto, un monitor de excepciones cuenta y comprueba"
flowchart TB
    App["Tus servicios"] -->|OpenTelemetry| Store[("Excepciones en OneUptime")]
    Store --> Skip["Dejar fuera las excepciones<br/>resueltas y archivadas"]
    Skip --> Count["Contar las excepciones que coinciden<br/>en la ventana de tiempo"]
    Count --> Check{"¿Se cumplen los criterios?"}
    Check -->|"Primera coincidencia"| Act["Cambiar el estado,<br/>alerta o incidente"]
    Check -->|Ninguno| Default["Estado predeterminado"]
```

Cada minuto, OneUptime cuenta las excepciones que coinciden con los filtros del monitor y ocurrieron dentro de su ventana de tiempo, dejando fuera las que marcaste como resueltas o archivaste. Compara ese recuento con los criterios del monitor de arriba abajo, y el primer criterio que coincide decide qué pasa. Si no coincide ninguno, el monitor vuelve a su estado predeterminado.

## Antes de empezar

- Tus servicios envían excepciones a OneUptime mediante OpenTelemetry. Consulta [OpenTelemetry](/docs/telemetry/open-telemetry).
- Para limitar un monitor a un entorno, tus servicios deben definir el atributo de recurso `deployment.environment`.

## Crear un monitor de excepciones

:::steps
### Empezar un monitor nuevo

Ve a **Monitores** y haz clic en **Crear monitor**. O, en la página de una excepción, haz clic en **Crear monitor** junto a **Resolver**: el nuevo monitor empieza vigilando el tipo de esa excepción en su servicio, y alerta cuando vuelve a ocurrir.

### Elegir Exceptions

En **Tipo de monitor**, haz clic en **Más tipos de monitor** y elige **Excepciones** en **Telemetría**, o escribe `exceptions` en el cuadro de búsqueda. Escribe un **Nombre** y haz clic en **Siguiente**.

### Elegir de qué te avisa el monitor

En **¿Sobre qué debe avisarte este monitor?**, elige **Cualquier excepción** o **Demasiadas excepciones**. Cada opción rellena la regla, que puedes cambiar más abajo. Elige **Otra cosa** para configurarla tú.

### Elegir las excepciones que se cuentan

En **Excepciones que vigilar**, rellena **El mensaje contiene**, **Tipos de excepción** y **Entornos**. Un filtro que dejas vacío coincide con todas las excepciones. **Excepciones coincidentes**, bajo los filtros, muestra las excepciones con las que coinciden ahora mismo.

### Acotarlas (opcional)

Abre **Más campos** para filtrar por servicio de telemetría o entidad de infraestructura, o para contar también las excepciones resueltas y archivadas.

### Decir cuándo alertar

En **Cuándo alertar**, elige una **Condición**, el **Número de excepciones** y una **Ventana de tiempo**. La frase de debajo repite la regla con palabras sencillas. El gráfico que hay debajo cuenta las excepciones coincidentes en cada ventana de las últimas horas, dibuja el número de la regla como una línea e indica cuántas veces habría alertado la regla. Su botón propone un número que la regla no habría superado en ese tiempo.

### Elegir qué pasa

En **Qué pasa**, elige **Crear una alerta**, **Declarar un incidente** o **Ambos**, y dale un título y una gravedad. Mientras la regla coincide, el monitor muestra el estado indicado en **Más campos**; cuando deja de coincidir, el monitor vuelve a su estado predeterminado y la alerta o el incidente se resuelve solo.

### Crear el monitor

Haz clic en **Crear monitor**. El monitor se abre en su página **Vista general**, y su primera evaluación se ejecuta en menos de un minuto.
:::

## Qué consulta

| Campo | Con qué coincide | Predeterminado |
| --- | --- | --- |
| **El mensaje contiene** | Excepciones cuyo mensaje contiene este texto, sin distinguir mayúsculas y minúsculas. | Vacío: todas las excepciones |
| **Tipos de excepción** | Excepciones de cualquiera de estos tipos, separados por comas, como `TypeError, NullReferenceException`. El nombre del tipo debe coincidir exactamente. | Vacío: todos los tipos |
| **Entornos** | Excepciones de cualquiera de estos entornos, separados por comas; consulta [Entornos](#entornos). | Vacío: todos los entornos |
| **Ventana de tiempo** (en **Cuándo alertar**) | Excepciones de los últimos 5 segundos hasta las últimas 24 horas. | **Últimos 5 minutos** |
| **Filtrar por servicio de telemetría** (en **Más campos**) | Excepciones de cualquiera de los servicios elegidos. | Vacío: todos los servicios |
| **Filtrar por entidad de infraestructura** (en **Más campos**) | Excepciones de cualquiera de los hosts, pods, contenedores y otras entidades elegidos. | Vacío: todas las entidades |
| **Incluir excepciones resueltas** (en **Más campos**) | Contar también las excepciones marcadas como resueltas. | Desactivado |
| **Incluir excepciones archivadas** (en **Más campos**) | Contar también las excepciones archivadas. | Desactivado |

Todos los filtros que definas deben coincidir para que una excepción se cuente.

### Entornos

Los entornos proceden del atributo de recurso de OpenTelemetry `deployment.environment` de cada excepción, el mismo valor que el explorador de excepciones filtra con `env:production`. Escribe un entorno, o varios separados por comas; una excepción se cuenta cuando su entorno coincide con alguno de ellos.

La coincidencia es exacta y distingue mayúsculas y minúsculas: `production` no coincide con `Production` ni con `prod`. Las excepciones sin entorno no se cuentan cuando este filtro está definido. Déjalo vacío para contar las excepciones de todos los entornos, incluidas las que no tienen ninguno.

El filtro de entorno se combina con todos los demás filtros, así que un monitor limitado a un servicio de telemetría y a `production` solo cuenta las excepciones de producción de ese servicio.

Al crear el monitor mediante la API, define `environments` en el `exceptionMonitor` del paso como una lista de nombres de entorno:

```json
{
  "exceptionMonitor": {
    "telemetryServiceIds": [],
    "environments": ["production"],
    "exceptionTypes": [],
    "message": "",
    "includeResolved": false,
    "includeArchived": false,
    "lastXSecondsOfExceptions": 300
  }
}
```

## Cómo se evalúa

- **Cada minuto.** Un monitor de excepciones no lo comprueban sondas, así que no tiene intervalo que configurar ni página **Sondas e intervalo**.
- **Ocurrencias, no tipos de excepción.** El monitor cuenta cada vez que una excepción que coincide ocurrió dentro de la **Ventana de tiempo**. Una excepción lanzada 40 veces cuenta 40.
- **Las excepciones resueltas y archivadas quedan fuera.** Salvo que actives **Incluir excepciones resueltas** o **Incluir excepciones archivadas**, las ocurrencias de una excepción que marcaste como resuelta o archivaste no cuentan. Por eso, marcar una excepción como resuelta puede cerrar el incidente que abrió. Cuando una excepción resuelta vuelve a ocurrir, se marca automáticamente como no resuelta y vuelve a contarse.
- **Sin excepciones, el recuento es 0.**
- **La caída del propio OneUptime no es silencio.** Mientras la ventana de tiempo contenga un periodo en el que OneUptime no recibía datos (se estaba reiniciando, actualizando o poniéndose al día), la comprobación espera: el estado no cambia y no se abre ni se resuelve ningún incidente ni alerta. Consulta [Cuando OneUptime no recibe datos](/docs/monitor/when-oneuptime-is-not-receiving).
- **Criterios de arriba abajo.** Decide el primer criterio que coincide, así que pon primero el más grave.

Cada cambio de estado, con su motivo, queda registrado en la **Cronología de estados** del monitor.

## Criterios

Los criterios de un monitor de excepciones tienen un único **Tipo de filtro**: **Exception Count**, el número de excepciones que coincidieron en la ventana. **Cuándo alertar** configura un criterio, cuya **Condición** es **Más de**, **Al menos**, **Menos de**, **Como mucho** o **Exactamente**. Para varios criterios, o uno con más de un filtro, haz clic en **Editar como criterios propios** en **Más campos** de **Qué pasa**: cada criterio tiene allí una **Condición de filtro** y un **Valor**.

| Condición de filtro | Coincide cuando el recuento de excepciones está… |
| --- | --- |
| **Mayor que** | por encima del valor |
| **Mayor o igual que** | en el valor o por encima |
| **Menor que** | por debajo del valor |
| **Menor o igual que** | en el valor o por debajo |
| **Igual a** | exactamente en el valor |
| **Distinto de** | en cualquier valor menos ese |

Los recuentos de excepciones no tienen condiciones de anomalía: no hay ninguna referencia con la que compararlos.

Un monitor de excepciones creado en Crear monitor empieza con la regla de lo que elegiste en **¿Sobre qué debe avisarte este monitor?**:

| Opción | Regla | Qué pasa |
| --- | --- | --- |
| **Cualquier excepción** | **Más de** `0` en **Últimos 5 minutos** | Crea una alerta, que se resuelve sola |
| **Demasiadas excepciones** | **Más de** `20` en **Últimos 5 minutos** | Crea una alerta, que se resuelve sola |

Un monitor de excepciones creado mediante la API o Terraform sin criterios empieza con estos criterios:

| Criterio | Filtro | Efecto |
| --- | --- | --- |
| Check if … has exceptions | **Exception Count** **Mayor que** `0` | Pone el monitor fuera de línea y declara un incidente que se resuelve solo |
| Check if … has no exceptions | **Exception Count** **Igual a** `0` | Pone el monitor en línea |

## Ejemplo práctico: solo las excepciones de producción

Quieres un incidente cada vez que la API lance una excepción en producción, y nada para staging. Eliges **Cualquier excepción**, pones **Entornos** en `production`, dejas la **Ventana de tiempo** en **Últimos 5 minutos** y eliges **Declarar un incidente** en **Qué pasa**. En los últimos cinco minutos:

| Excepciones | Entorno | Estado | ¿Se cuenta? |
| --- | --- | --- | --- |
| `TypeError` × 3 | `production` | Activa | Sí: 3 |
| `TypeError` × 40 | `staging` | Activa | No: otro entorno |
| `TimeoutError` × 2 | ninguno | Activa | No: sin entorno |
| `NullReferenceException` × 4 | `production` | Resuelta después de ocurrir | No: resuelta |

El **Exception Count** es 3, así que **Más de** `0` coincide: el monitor pasa a fuera de línea y se declara un incidente. Cuando pasan cinco minutos sin ninguna excepción de producción activa, la regla deja de coincidir, el monitor vuelve a su estado predeterminado y el incidente se resuelve solo.

## Solución de problemas

:::details Las excepciones aparecen en el explorador, pero el monitor cuenta 0
Compara el valor de **Entornos** con el filtro `env:` del explorador: la coincidencia es exacta y distingue mayúsculas y minúsculas, y las excepciones sin entorno quedan fuera cuando el filtro está definido. Después comprueba si esas excepciones están resueltas o archivadas. Abre la página **Criterios** del monitor (en **Configuración**) y haz clic en **Editar criterios de monitoreo**: **Excepciones coincidentes** muestra con qué coinciden los filtros.
:::

:::details El incidente se resolvió cuando resolví la excepción
Es lo esperado. Las excepciones resueltas no se cuentan, así que el recuento bajó y el criterio dejó de coincidir. Si la excepción vuelve a ocurrir, se marca como no resuelta y vuelve a contarse. Activa **Incluir excepciones resueltas** para contarlas de todos modos.
:::

:::details Un filtro de tipo de excepción no coincide con nada
Los **Tipos de excepción** se comparan exactamente con el nombre de tipo con el que se notificó la excepción, como `TypeError`. Copia el tipo desde el explorador de excepciones.
:::

## Próximos pasos

:::cards
- [Monitor de trazas](/docs/monitor/traces-monitor): Alerta sobre spans y endpoints que fallan.
- [Monitor de registros](/docs/monitor/logs-monitor): Alerta sobre el volumen y el contenido de los registros.
- [Plantillas de incidentes y alertas](/docs/monitor/incident-alert-templating): Escribe títulos y descripciones de alerta útiles.
- [OpenTelemetry](/docs/telemetry/open-telemetry): Envía excepciones a OneUptime.
:::
