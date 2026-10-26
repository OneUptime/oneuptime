# Estados y severidades de alertas

Toda alerta lleva un **estado**, en qué punto está tu equipo con ella, y una **gravedad**, cuánto importa. Los estados dirigen lo que hace OneUptime: a quién se sigue avisando, qué cuenta como activo, cuándo se resuelve un episodio. Las gravedades ordenan las alertas, y las reglas pueden coincidir con ellas. Esta página es para quien las configura o se pregunta por qué una alerta avisó o no.

:::cards
- [Los estados predefinidos](#los-estados-predefinidos): Identificado, Reconocido y Resuelto, y qué hace cada uno.
- [Añadir tus propios estados](#añadir-tus-propios-estados): Un paso propio, como "Investigando".
- [Mover una alerta por sus estados](#mover-una-alerta-por-sus-estados): Todas las formas en que cambia un estado.
- [Gravedades](#las-gravedades-predefinidas): Alta y Low, y cómo añadir las tuyas.
:::

## Cómo funciona

Los estados de alerta de un proyecto forman una lista ordenada, y las alertas solo bajan por ella. La posición de un estado decide cómo cuenta una alerta que está en él: aún no reconocida, reconocida o resuelta. Los episodios de alertas recorren la misma lista.

```mermaid title="Las alertas solo bajan por la lista; la posición de un estado decide cómo cuenta"
flowchart TB
    subgraph open["Cuenta como<br/>no reconocida"]
        identified["Identificado"]
    end
    subgraph working["Cuenta como<br/>reconocida"]
        acknowledged["Reconocido"]
        investigating["Investigando<br/>(propio)"]
    end
    subgraph done["Cuenta como<br/>resuelta"]
        resolved["Resuelto"]
        closed["Cerrado<br/>(propio)"]
    end
    identified --> acknowledged
    acknowledged --> investigating
    investigating --> resolved
    resolved --> closed
    identified -. "saltar" .-> resolved
```

El modelo `AlertState` tiene `name`, `description`, `color` y `order`, más tres indicadores: `isCreatedState`, `isAcknowledgedState` y `isResolvedState`. OneUptime lee los indicadores y el orden, nunca el nombre, así que puedes renombrar **Resuelto** como "Cerrado" sin que nada se rompa. El modelo `AlertSeverity` tiene `name`, `description`, `color` y `order`, y ningún indicador.

> [!TIP]
> Ambas listas están en **Alertas → Ajustes**, que empieza plegado en el menú lateral: despliega **Ajustes** para encontrar **Estado de la alerta** y **Gravedad de la alerta**.

## Los estados predefinidos

Todo proyecto nuevo empieza con tres estados de alerta, en este orden:

| Estado           | `order` | Indicador             | Color     | Qué significa                                     |
| ---------------- | ------- | --------------------- | --------- | ------------------------------------------------- |
| **Identificado** | `1`     | `isCreatedState`      | `#fd625e` | El estado en el que empiezan las alertas nuevas.  |
| **Reconocido**   | `2`     | `isAcknowledgedState` | `#ffbf53` | Alguien se está ocupando y los avisos se detienen. |
| **Resuelto**     | `3`     | `isResolvedState`     | `#2ab57d` | La alerta ha terminado y ya no cuenta como activa. |

Los tres estados con indicador llevan la etiqueta **Predefinido** en la página de ajustes. Puedes renombrarlos, cambiarles el color y arrastrarlos, pero conservan su orden, creación antes que reconocimiento antes que resolución, y no se pueden eliminar: su **Eliminar** queda bloqueado y explica por qué.

## Qué hace cada indicador

| Indicador             | Qué hace OneUptime con él                                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isCreatedState`      | Las alertas nuevas empiezan aquí cuando nadie elige otro estado: cada alerta que genera un monitor y cada una que se crea con **Estado inicial** vacío.                          |
| `isAcknowledgedState` | **Reconocer** lleva una alerta aquí. En este estado o en cualquiera posterior, la alerta cuenta como reconocida: sus políticas de guardia dejan de avisar y **Reconocer** ya no se ofrece. |
| `isResolvedState`     | **Resolver** lleva una alerta aquí. En este estado o en cualquiera posterior, la alerta cuenta como resuelta: sale de **Alertas activas**, sus recordatorios se detienen y su episodio puede resolverse. |

## Añadir tus propios estados

Un estado que añades es un paso por el que pasa tu equipo y que los tres predefinidos no nombran: "Investigando", "Mitigado", "Cerrado".

:::steps
### Abrir la lista de estados

Ve a **Alertas → Ajustes → Estado de la alerta**. La tarjeta **Estados de alerta** muestra tus estados en su orden. Cada fila muestra su color y su nombre, cómo **Cuenta como** una alerta que está en él, y su descripción.

### Crear el estado

Haz clic en **Crear Estado de la alerta** y rellena su **Nombre**, **Descripción** y **Color**. El color ya viene elegido: uno que todavía no usa ningún otro estado. El nuevo estado se añade justo encima del estado resuelto, así que mantiene las alertas activas.

### Arrastrarlo a su sitio

Arrastra una fila por su asa para moverla; el nuevo orden se guarda al soltarla. La columna **Cuenta como** se ajusta: por encima del estado reconocido una alerta está **No reconocido**, desde él hacia abajo **Reconocido**, y desde el estado resuelto hacia abajo **Resuelto**.
:::

Un estado que añades no tiene indicador, así que su posición es lo que significa. Pon un paso de mitigación entre **Reconocido** y **Resuelto**, y un paso de triaje por encima de **Reconocido**. Un estado situado por debajo de **Resuelto** cuenta como resuelto en todas partes.

Llevas una alerta a un estado propio desde el menú **⋯** de la cabecera de la alerta, en **Cambiar el estado a**, que muestra cada estado posterior al actual. Su confirmación se titula **Marcar alerta como {{state}}**, con el nombre del estado dentro.

> [!NOTE]
> En OneUptime Cloud, añadir o cambiar estados y gravedades de alerta requiere el plan **Growth** o superior. Cualquier plan puede leerlos, usarlos y eliminar un estado que hayas añadido.

## El orden se impone

Cada cambio de estado de una alerta se comprueba contra la lista, lo haga quien lo haga: el panel, Slack, Microsoft Teams, la API, Terraform, un flujo de trabajo o el propio OneUptime.

- **Los retrocesos se rechazan**, con un mensaje que nombra ambos estados: "Alert cannot transition to Acknowledged state from Resolved state because Acknowledged is before Resolved in the order of alert states."
- **Pasar al estado en el que ya está se rechaza**: "Alert state cannot be same as previous state."
- **Los selectores solo ofrecen los estados posteriores al actual**, así que a nadie se le ofrece un cambio que se rechazaría.

Los episodios de alertas se rigen por la misma lista, con sus propios mensajes ("Episode cannot transition to …"). El único paso de vuelta hacia arriba en la lista es del propio OneUptime: una regla de agrupación que reabre un episodio resuelto hace poco. Para corregir un estado puesto por error, elimina su fila en la página **Cronología de estados** de la alerta; la alerta vuelve al estado de su última fila restante.

## Las gravedades predefinidas

Todo proyecto nuevo empieza con dos gravedades de alerta, de la más grave a la menos:

| Gravedad | `order` | Color     | Descripción predefinida                                                           |
| -------- | ------- | --------- | --------------------------------------------------------------------------------- |
| **Alta** | `1`     | `#b70400` | Issues causing very high impact to customers. Immediate attention is required.    |
| **Baja**  | `2`     | `#ffbf53` | Issues causing low impact to customers.                                           |

Los incidentes empiezan con tres gravedades y las alertas con dos. Cuando la plantilla de una recomendación de monitor dice **Crítico** o **Advertencia**, OneUptime la asigna a tu primera y segunda gravedad de alerta, que en un proyecto nuevo son **Alta** y **Baja**.

## Editar las gravedades

Ve a **Alertas → Ajustes → Gravedad de la alerta**. La tarjeta **Gravedades de alerta** las muestra de la más grave a la menos; arrastra una fila para cambiar su rango. **Crear Gravedad de la alerta** añade una al final de la lista, la menos grave, con los mismos **Nombre**, **Descripción** y **Color** que un estado.

El rango decide qué gravedad gana allí donde OneUptime las compara: la gravedad de un episodio sube hasta la de la alerta más grave que se le une. Las gravedades no tienen indicadores ni bloqueo de eliminación: cualquier gravedad se puede eliminar, incluidas las dos predefinidas.

Una gravedad no avisa a nadie por sí sola. Para avisar según la gravedad, añade una regla de guardia cuyas **Gravedades de alerta** coincidan con ella: consulta [Reglas y ajustes de alertas](/docs/alerts/settings). Cambiar la gravedad de una alerta escribe una entrada en su feed y vuelve a comprobar su regla de recordatorio.

## Archivar un estado o una gravedad

Archive un estado o una gravedad que su equipo ya no deba usar, en lugar de eliminarlo. Archivar no cambia ninguna alerta. Eliminar un estado quita sus filas del historial de cada alerta, y una gravedad no se puede eliminar mientras haya alertas que la tengan.

- **Archivar** está en el menú **⋯** de la fila. Primero pide confirmación y enumera las reglas, mediciones, criterios de monitor y flujos de trabajo configurados para usar el valor: lo siguen usando hasta que los cambie.
- **Nadie puede volver a elegirlo.** **Cambiar estado**, la cabecera de la alerta, Slack, Microsoft Teams, las reglas y los criterios de monitor lo omiten. La API, Terraform y MCP lo rechazan, indicando el valor y dónde desarchivarlo.
- **Las alertas lo conservan.** Una alerta que lo tiene lo conserva en cada edición posterior, su cronología de estados lo sigue mostrando y puede seguir filtrando por él.
- **Los valores archivados se listan aparte**, en la sección plegada **Estados de alerta archivados** o **Gravedades de alerta archivadas** bajo la tabla, con quién archivó cada uno y cuándo. **Desarchivar** devuelve uno tal como estaba.
- **Algunos no se pueden archivar.** Los estados creado, reconocido y resuelto, y la última gravedad sin archivar del proyecto. Su **Archivar** está bloqueado, con el motivo.

**Eliminar** dice primero lo que haría. Mientras haya alertas o episodios con el valor, la eliminación se rechaza y el diálogo los enumera. En caso contrario, enumera lo que cambiaría la eliminación y ofrece **Archivar en su lugar**.

## Mover una alerta por sus estados

| Forma                       | Dónde                                                                                     | Qué pregunta                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Botones de la cabecera**  | La cabecera de la alerta: **Reconocer**, **Resolver** y **Cambiar el estado a** en su menú **⋯** | Una breve confirmación, **Reconocer alerta**, **Resolver alerta** o **Marcar alerta como {{state}}**, con una nota opcional en **Añadir una nota privada**. |
| **Cronología de estados**   | **Cronología de estados** en el menú lateral de la alerta                                 | Una fila que añades a mano, con **Estado de la alerta** y **Comienza en**.                                                            |
| **Fila de la lista** | El menú **⋯** de la fila de una alerta en la lista de alertas: **Reconocer**, **Resolver** y **Cambiar estado** | La confirmación de la cabecera, con el nombre de la alerta. Una alerta que otro cambio ya movió se deja como está, y el diálogo dice por qué. |
| **Cambio masivo**           | **Reconocer**, **Resolver** o **Cambiar estado** sobre una selección en la lista de alertas                              | El estado y una nota privada que se añade a cada alerta. Las alertas que ya están en ese estado o después se omiten.                  |
| **Automáticamente**         | Un monitor, un episodio, un incidente vinculado o tu propio código                        | **Resolver alerta automáticamente** en los criterios de un monitor, el cambio de estado de un episodio, los interruptores de incidente de [Alertas vinculadas](/docs/incidents/linked-alerts) o una fila creada en `/api/alert-state-timeline`. |

La cabecera ofrece **Reconocer** y **Resolver** mientras la alerta aún no está reconocida, y solo **Resolver** cuando ya lo está. Una alerta resuelta no muestra ninguno de los dos. Quien, por su rol, no puede cambiar el estado de la alerta ve los botones bloqueados y ningún menú de otros estados: al señalar uno, se nombran los permisos que se lo permitirían.

## Qué hace reconocer

Una alerta está reconocida desde el momento en que pasa a tu estado reconocido o a cualquier estado posterior, incluido uno resuelto. Entonces:

- **La guardia deja de avisar por ella.** Sus políticas de guardia no avisan al siguiente nivel.
- **Reconocer ya no se ofrece**, ni en la cabecera ni en Slack y Microsoft Teams, donde volver a reconocerla se rechaza con "Alert is already acknowledged." o "Alert is already resolved." Quien responda a su aviso después de eso ve su aviso reconocido, y la alerta se queda donde está.
- **Se fija el tiempo hasta el reconocimiento**, a partir del primero de esos cambios: el primer recuadro de la **Vista general** y una medición que termina cuando **Se reconoce la alerta**.

## Qué hace resolver

Una alerta está resuelta cuando pasa a tu estado resuelto o a cualquier estado posterior. Entonces:

- **Sale de Alertas activas** y del recuento del menú lateral.
- **Sus recordatorios se detienen**, diga lo que diga su regla de recordatorio.
- **Su episodio puede resolverse.** Un episodio se resuelve solo cuando todas sus alertas están resueltas. Consulta [Episodios de alertas y reglas de agrupación](/docs/alerts/episodes).
- **Su monitor puede generar una alerta nueva.** Un criterio mantiene una sola alerta abierta a la vez; una vez resuelta, la siguiente coincidencia abre otra.

Pasar de **Resuelto** a un estado posterior, "Cerrado" por ejemplo, no cambia nada de esto: la alerta ya estaba resuelta.

## La cronología de estados

La página **Cronología de estados** de la alerta es el registro de cada estado en el que ha estado. Su tarjeta, **Cronología de estados**, los dibuja como una cronología: una banda con cada estado tan largo como duró y, debajo, cada cambio, del más reciente al más antiguo. **Tabla**, en la cabecera de la tarjeta, los muestra en filas, con **Estado de la alerta**, **Comienza en**, **Termina en** y **Duración**.

- **Ver causa** muestra la causa raíz registrada con ese cambio.
- **Ver registros** muestra lo que OneUptime registró cuando la alerta cambió, como la comprobación del monitor que lo provocó.

Las filas se pueden añadir y eliminar, pero no editar, y una alerta siempre conserva al menos una. Eliminar la última fila devuelve la alerta al estado de la fila anterior.

> [!WARNING]
> Eliminar una fila reescribe el historial de la alerta y cada medición calculada a partir de él. Úsalo para corregir un error, no para ordenar.

## La lista Alertas activas

**Alertas → Alertas activas** contiene cada alerta cuyo estado está por encima de tu estado resuelto, y nada más lo decide: ni la gravedad, ni la antigüedad, ni si alguien la reconoció. La insignia roja a su lado en el menú lateral cuenta las mismas alertas.

Así que un estado propio por encima de **Resuelto** mantiene las alertas en la lista, y uno por debajo las saca, como hace resolver. **Episodios activos** funciona igual para los episodios.

## Próximos pasos

:::cards
- [Visión general de las alertas](/docs/alerts/index): De dónde vienen las alertas y cómo trabaja tu equipo con ellas.
- [Episodios de alertas y reglas de agrupación](/docs/alerts/episodes): Cómo el estado de un episodio mueve sus alertas.
- [Reglas y ajustes de alertas](/docs/alerts/settings): Avisar y recordar según la gravedad.
- [Estados y severidades de incidentes](/docs/incidents/states-and-severities): El mismo ciclo de vida, para incidentes.
:::
