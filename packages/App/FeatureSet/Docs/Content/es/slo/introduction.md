# Visión general de los SLO

Un objetivo de nivel de servicio (SLO) es un objetivo de fiabilidad para lo que supervisas, como «disponible el 99,9 % del tiempo durante 30 días móviles». OneUptime mide cada SLO frente a su objetivo cada 5 minutos, así que en lugar de «¿funciona ahora mismo?» puedes responder «¿hemos sido lo bastante fiables, en una ventana que importa a nuestros usuarios, y cuánto margen de fallo nos queda?».

:::cards
- [Crear un SLO](#crear-un-slo): Un nombre y un objetivo. Todo lo demás empieza con un valor predeterminado.
- [Monitores y reglas de monitores](/docs/slo/monitor-rules): Elige los monitores que mide un SLO.
- [Presupuestos de errores](/docs/slo/error-budget): Cuánto tiempo de inactividad permite un objetivo y cómo se recupera.
- [Alertas e incidentes de tasa de consumo](/docs/slo/burn-rate-alerts): Avisa a tu equipo cuando el presupuesto se consume demasiado rápido.
:::

## Cómo funciona

Un SLO lee las líneas de tiempo de estado de los monitores asociados a él: los mismos datos que muestran tus páginas de estado. A partir de ellas, OneUptime calcula qué parte de la ventana de cumplimiento fue tiempo bueno, cuánto queda del presupuesto de errores y a qué velocidad se consume.

```mermaid title="De las comprobaciones de los monitores al estado de un SLO"
flowchart TB
    monitors["Monitores asociados al SLO"] --> timeline["Sus líneas de tiempo de estado"]
    timeline --> sli["SLI: parte de tiempo bueno<br/>en la ventana de cumplimiento"]
    sli --> budget["Presupuesto de errores restante"]
    budget --> status["Estado: En buen estado,<br/>En riesgo o Presupuesto agotado"]
    status --> owners["Se notifica a los<br/>propietarios del SLO"]
    timeline --> burn["Tasa de consumo en las<br/>ventanas de cada regla"]
    burn --> rules["Alertas e incidentes<br/>para tu equipo de guardia"]
```

## Conceptos clave

| Término | Significado |
| --- | --- |
| **SLI** (indicador de nivel de servicio) | La medición: el porcentaje de la ventana de cumplimiento en el que los monitores del SLO estuvieron disponibles. |
| **SLO** (objetivo de nivel de servicio) | Un objetivo para el SLI, por ejemplo «al menos el 99,9 % en los últimos 30 días». |
| **Presupuesto de errores** | El tiempo de inactividad que permite el objetivo: `(100% − target) × window`. Con 99,9 % en 30 días son 43 minutos y 12 segundos. |
| **Tasa de consumo** | La velocidad a la que se gasta el presupuesto comparada con un ritmo uniforme. Con una tasa de consumo de 1, el presupuesto se agota justo al final de la ventana. |

Un presupuesto de errores convierte la fiabilidad en algo que puedes gastar. Si queda mucho, publica más rápido y asume riesgos; si queda poco, frena e invierte en estabilidad. El SLO le da a esa conversación una cifra que todos ven.

## Crear un SLO

Necesitas un rol que pueda crear SLO: Project Owner, Project Admin o un rol personalizado con el permiso Create Service Level Objective.

:::steps
### Abrir los SLO

Abre **SLO** desde el menú **Productos** de la barra superior. Está en el primer grupo, junto a monitores e incidentes. Haz clic en **Crear Objetivo de nivel de servicio**.

### Ponerle nombre y fijar un objetivo

Escribe un **Nombre**, por ejemplo «API Availability», y un **Objetivo (%)**: la parte del tiempo en la que sus monitores deben estar disponibles. El objetivo empieza en `99.9`. Debe ser mayor que 0 y como máximo 99,999, porque un objetivo del 100 % no deja presupuesto de errores que seguir.

### Revisar los valores predeterminados en Más campos

**Más campos** está plegado, con una línea que explica lo que hacen sus valores predeterminados: el SLO se mide sobre una ventana móvil de 30 días y pasa a estar en riesgo cuando queda menos del 20 % de su presupuesto de errores. Despliégalo para cambiar cualquiera de los campos de la tabla de abajo.

### Guardar el SLO

Haz clic en **Crear Objetivo de nivel de servicio**. OneUptime abre el nuevo SLO. Su **Vista general** muestra **Elige qué mide este SLO**, porque un SLO nuevo todavía no tiene monitores.

### Asociar monitores

Haz clic en **Crear una regla de monitores** para asociar todos los monitores que coincidan, ahora y en el futuro, o en **Añadir monitores** para elegirlos a mano. Consulta [Monitores y reglas de monitores](/docs/slo/monitor-rules).

### Ver llegar las primeras cifras

OneUptime evalúa los SLO habilitados cada 5 minutos. El SLI, el presupuesto de errores y el gráfico de consumo aparecen tras la primera evaluación que tiene monitores que medir.
:::

Los campos de **Más campos**:

| Campo | Qué defines | Predeterminado |
| --- | --- | --- |
| **Descripción** | Para qué sirve el SLO. | Vacío |
| **Umbral de riesgo (%)** | La parte del presupuesto de errores restante en la que el SLO pasa a **En riesgo**. Un número entero de 0 a 100. | 20 |
| **Tipo de ventana** | **Móvil**: los últimos N días, que se recuperan a medida que el tiempo de inactividad antiguo sale de la ventana. **Calendar Month**: cada mes por separado, que se reinicia el día 1. | **Móvil** |
| **Ventana (días)** | Solo ventanas móviles: cuántos días mirar hacia atrás, de 1 a 366. Lo habitual es 28 o 30. | 30 |
| **Zona horaria** | Solo meses naturales: la zona horaria en la que empieza y termina cada mes. | UTC |
| **Etiquetas** | Etiquetas para organizar y filtrar los SLO. | Ninguna |

Todo lo que determina cómo mide el SLO empieza con un valor predeterminado que cambias después:

| Ajuste | Un SLO nuevo empieza con | Dónde cambiarlo |
| --- | --- | --- |
| Monitores | Ninguno | **Monitores** o **Reglas de monitores** |
| Estados de inactividad | Todos los estados no operativos del proyecto | **Ajustes** → **Cálculo del tiempo de inactividad** |
| Modo de varios monitores | **Cualquier monitor caído** | **Ajustes** → **Cálculo del tiempo de inactividad** |
| Evaluación | Activada | **Ajustes** → **Evaluación** |
| Reglas de tasa de consumo | Una regla **Fast burn** y una regla **Slow burn**, ajustadas a la ventana | **Reglas de tasa de consumo** |

## De qué está hecho un SLO

| Parte | Qué decide |
| --- | --- |
| Monitores | De dónde sale el SLI. Asócialos a mano o con reglas de monitores: consulta [Monitores y reglas de monitores](/docs/slo/monitor-rules). |
| Objetivo | La parte de tiempo bueno que promete el SLO, mayor que 0 y como máximo 99,999. |
| Ventana de cumplimiento | El periodo sobre el que se miden el SLI y el presupuesto: una ventana móvil de 1 a 366 días o un mes natural. |
| Umbral de riesgo | La parte del presupuesto restante en la que el SLO pasa a **En riesgo**. |
| Estados de inactividad | Qué estados de monitor cuentan como tiempo de inactividad. |
| Modo de varios monitores | Cómo se combina el tiempo de inactividad de varios monitores. |

### Qué estados cuentan como tiempo de inactividad

Cada SLO tiene su propia lista de estados de monitor que cuentan como tiempo de inactividad. Un SLO nuevo empieza con todos los estados del proyecto que no están marcados como operativos, como Degraded y Offline, igual que hacen tus páginas de estado. Cambia la lista en **Ajustes** → **Cálculo del tiempo de inactividad**. Déjala vacía para contar todos los estados no operativos, incluidos los que se añadan más tarde al proyecto.

> [!TIP]
> Mide los mismos monitores de dos formas con dos SLO: un SLO de disponibilidad estricto en el que cuentan tanto Degraded como Offline, y un SLO de caída total más laxo en el que solo cuenta Offline.

### Ventanas de cumplimiento

| Tipo de ventana | Cómo se comporta |
| --- | --- |
| **Móvil** | Mira hacia atrás un número fijo de días desde ahora. El tiempo de inactividad antiguo sale de la ventana, así que el presupuesto vuelve poco a poco. |
| **Calendar Month** | Mide desde el primer día del mes, en la zona horaria del SLO (UTC de forma predeterminada). Todo el presupuesto vuelve al empezar cada mes. |

### Varios monitores en un SLO

Cuando un SLO mide más de un monitor, su **Modo de varios monitores** decide cómo se combina su tiempo de inactividad. Un SLO nuevo usa **Cualquier monitor caído**.

| Modo | Cómo cuenta el tiempo de inactividad | Úsalo cuando |
| --- | --- | --- |
| **Cualquier monitor caído** | Cualquier momento en que al menos un monitor esté caído cuenta como tiempo de inactividad para todo el SLO. Las caídas que se solapan se cuentan una vez. | Los monitores forman juntos un único servicio: si cualquiera de ellos cae, los usuarios lo notan. |
| **Promedio de segundos del monitor** | El tiempo de inactividad de cada monitor cuenta por separado, promediado sobre todo el tiempo supervisado: SLI = 1 − (segundos caídos de todos los monitores ÷ segundos supervisados de todos los monitores). | Los monitores son una flota de recursos similares y un impacto parcial debe contar parcialmente. |

Por ejemplo, el monitor A está caído de 10:00 a 11:00 mientras el monitor B sigue disponible. **Cualquier monitor caído** registra 60 minutos de inactividad; **Promedio de segundos del monitor** registra el equivalente a 30 minutos, porque uno de dos monitores estuvo caído una hora. En ese modo el presupuesto también se cuenta en segundos-monitor: consulta [Presupuestos de errores](/docs/slo/error-budget).

## Estado del SLO

OneUptime da un estado a cada SLO evaluado:

| Estado | Qué significa |
| --- | --- |
| **En buen estado** | Queda más presupuesto que el umbral de riesgo. |
| **En riesgo** | El presupuesto restante ha bajado al umbral de riesgo o por debajo: el 20 % de forma predeterminada. |
| **Presupuesto agotado** | El presupuesto se ha gastado por completo, o se ha superado. |
| **Mal configurado** | El SLO no se puede medir: no tiene monitores, sus monitores ya no existen o todavía no han registrado ningún estado en su ventana, o su objetivo está fuera de rango. |
| **Pausado** | Todos los monitores que mide están archivados o tienen la supervisión activa desactivada, a mano, por un incidente manual o por un mantenimiento programado. Se reanuda solo en cuanto alguno de ellos vuelve a supervisarse. |

Un SLO desactivado o archivado no se evalúa, así que su estado se queda como estaba; la lista de SLO muestra en su lugar una etiqueta **Deshabilitado** o **Archivado**. Se notifica a los propietarios de un SLO cuando el estado cambia a **En riesgo** o **Presupuesto agotado**: consulta [Presupuestos de errores](/docs/slo/error-budget).

## La lista de SLO

La página **SLO** muestra cada SLO no archivado, con su estado, SLI, presupuesto restante, tasa de consumo, objetivo, ventana, monitores, etiquetas y propietarios.

- Los mosaicos sobre la lista cuentan los SLO por estado: **En buen estado**, **En riesgo**, **Presupuesto agotado**, **Mal configurado**, **Pausado** y **Deshabilitado**. Haz clic en un mosaico para ver solo esos SLO, y otra vez para verlos todos.
- Selecciona SLO para añadir o quitar etiquetas y propietarios, archivarlos o eliminarlos, todos a la vez.
- La sección **Ajustes** del menú lateral contiene **Reglas de etiquetas** y **Reglas del propietario**, que etiquetan los SLO nuevos y les asignan propietarios: consulta [Reglas de etiquetas y propietarios](/docs/slo/label-and-owner-rules).
- La sección **Avanzado** del menú lateral contiene **Archivado**, la lista de SLO archivados.

## Las páginas de un SLO

Abre un SLO para ver sus páginas en el menú lateral:

| Página | Qué muestra |
| --- | --- |
| **Vista general** | El estado, las cifras principales, el consumo del presupuesto de errores, la actividad reciente, las alertas e incidentes abiertos y las reglas de tasa de consumo. |
| **Métricas** | Las métricas `oneuptime.slo.*` del SLO, su historial a largo plazo del presupuesto de errores y las métricas de los incidentes y alertas que lo afectan. Consulta [Métricas y paneles de SLO](/docs/slo/metrics). |
| **Incidentes** | Los incidentes que declararon sus reglas de tasa de consumo. El distintivo cuenta los abiertos. |
| **Alertas** | Las alertas que generaron sus reglas de tasa de consumo. El distintivo cuenta las abiertas. |
| **Feed** | Lo que le ha pasado al SLO, como línea de tiempo. Consulta [Feed y registros de auditoría de SLO](/docs/slo/feed-and-audit-logs). |
| **Monitores** | Los monitores que mide, y si cada uno lo asoció una persona o una regla. |
| **Reglas de monitores** | Las reglas que asocian los monitores que coinciden. |
| **Reglas de tasa de consumo** | Las reglas que generan alertas y declaran incidentes cuando el presupuesto se consume demasiado rápido. |
| **Propietarios** | Los usuarios y equipos que se enteran de sus cambios de estado. |
| **Ajustes** | El objetivo, el periodo de cumplimiento, el cálculo del tiempo de inactividad, el interruptor de evaluación y la tarjeta de archivo. |
| **Registros de auditoría** | Quién cambió el SLO, sus reglas y sus propietarios, y cuándo. |
| **Eliminar SLO** | Elimina el SLO para siempre y resuelve las alertas e incidentes de tasa de consumo que tenía abiertos. |

**Monitores**, **Reglas de monitores** y **Reglas de tasa de consumo** están en una sección **Configuración**, y **Propietarios**, **Ajustes**, **Registros de auditoría** y **Eliminar SLO** en una sección **Gestión**. Ambas empiezan plegadas, igual que una sección **Desarrolladores** para gestionar el SLO desde código: haz clic en el título de una sección para abrirla.

Cuando algo impide que un SLO mida, un aviso en la parte superior de cada una de sus páginas dice qué falla y enlaza a la página que lo arregla: consulta [Solución de problemas](#solución-de-problemas).

### La vista general

La **Vista general** responde a «¿estamos dentro del presupuesto?», de arriba abajo:

- **El resumen**: el estado, una frase sobre lo que significa y la descripción. Al lado están **Actualizar** y cuándo se evaluó el SLO por última vez. Debajo están el objetivo, la **Ventana de cumplimiento** (con un indicador de llenado mientras una ventana móvil joven se llena: consulta [Los SLO jóvenes y el indicador de llenado de la ventana](#los-slo-jóvenes-y-el-indicador-de-llenado-de-la-ventana)), el número de monitores y los propietarios.
- **Las cifras principales**:
  - **SLI**: la parte de tiempo bueno en la ventana, y cuánto está por encima o por debajo del objetivo.
  - **Presupuesto de errores restante**: un porcentaje, una duración como "12m 30s left of 43m 12s" y una barra con una marca en el umbral de riesgo. Cuando el presupuesto se supera, muestra **Budget exceeded** y por cuánto.
  - **Tasa de consumo**: a qué velocidad se gasta el presupuesto en los últimos 60 minutos, el periodo que usa la regla de consumo rápido predeterminada. Se vuelve ámbar por encima de 1× y roja, con **Se alcanzó el umbral de la regla**, en el umbral más bajo de las reglas de tasa de consumo habilitadas del SLO.
  - **Autonomía del presupuesto**: cuánto dura el presupuesto a ese ritmo. Consulta [Presupuestos de errores](/docs/slo/error-budget#autonomía-del-presupuesto).
- **Consumo del presupuesto de errores**: el presupuesto restante a lo largo de la ventana actual. Consulta [Presupuestos de errores](/docs/slo/error-budget#consumo-del-presupuesto-de-errores).
- **Actividad reciente**: los últimos elementos del feed del SLO.
- **Detalles del SLO**: el nombre, la descripción y las etiquetas, los únicos ajustes que se editan en la vista general.
- **Alertas e incidentes abiertos**: lo que las reglas de tasa de consumo tienen abierto ahora mismo.
- **Reglas de tasa de consumo**: el umbral de cada regla habilitada junto a la tasa de consumo actual, y lo que declara la regla.

### Ajustes

La página **Ajustes** reúne cómo mide un SLO, una tarjeta para cada cosa:

| Tarjeta | Qué cambias | Conviene saber |
| --- | --- | --- |
| **Objetivo** | **Objetivo (%)** y **Umbral de riesgo (%)**, con **Editar objetivo**. | Muestra el tiempo de inactividad que permite el objetivo, por ejemplo «43m 12s de inactividad por ventana de 30 días». |
| **Periodo de cumplimiento** | **Tipo de ventana**, **Ventana (días)** y **Zona horaria**, con **Editar periodo**. | Las reglas de tasa de consumo conservan sus umbrales cuando cambia la ventana, así que revísalas después. |
| **Cálculo del tiempo de inactividad** | **Modo de varios monitores** y **Estados de monitor de tiempo de inactividad**, con **Editar cálculo del tiempo de inactividad**. | Sin estados se cuentan todos los estados no operativos, incluidos los que se añadan después. |
| **Evaluación** | El interruptor **Evaluar este SLO**, que guarda en cuanto lo cambias. | Al desactivarlo pide confirmación, porque también resuelve las alertas e incidentes de tasa de consumo abiertos del SLO. |
| **Archive SLO** | **Archivar** o **Desarchivar**. | Consulta [Archivar un SLO](#archivar-un-slo). |

Tras un cambio en el objetivo, el periodo o el cálculo del tiempo de inactividad, OneUptime vuelve a evaluar el SLO en su siguiente ejecución.

## Archivar un SLO

Archiva un SLO que ya no mides pero quieres conservar, como un servicio retirado o el objetivo del año pasado. Archívalo desde **Ajustes** → **Archive SLO**, o selecciona SLO en la lista y elige **Archivar**.

Un SLO archivado:

- se oculta de la lista de SLO, de sus mosaicos de estado y de los selectores y listas de SLO de los paneles;
- no se evalúa: sus cifras se quedan como en la última evaluación, sus reglas de tasa de consumo no se activan y no envía métricas;
- tiene sus alertas e incidentes de tasa de consumo abiertos resueltos;
- conserva sus ajustes, su historial, sus reglas y sus propietarios. Sus reglas de monitores mantienen al día su lista de monitores, así que se reanuda con los monitores correctos.

Los SLO archivados aparecen en la página **Archivado**, en **Avanzado** dentro del menú lateral de la lista de SLO. Selecciónalos ahí y elige **Desarchivar** para recuperarlos: se vuelven a evaluar en la siguiente ejecución, con el SLI y el presupuesto recalculados a partir del historial de sus monitores.

Archivar y desactivar la evaluación son interruptores distintos. Un SLO que estaba desactivado antes de archivarse sigue desactivado al desarchivarlo: vuelve a activarlo con **Activar la evaluación** en su aviso, o con **Evaluar este SLO** en **Ajustes** → **Evaluación**.

| Quieres | Haz esto |
| --- | --- |
| Dejar de medir un tiempo y mantenerlo en la lista | Desactiva la evaluación |
| Retirarlo, pero conservar su historial y sus ajustes | Archívalo |
| Quitarlo para siempre | Elimínalo |

## Los SLO en alertas, incidentes y monitores

Cada alerta e incidente que crea una regla de tasa de consumo está vinculado a su SLO:

- La página de la alerta o del incidente muestra el SLO en **Recursos afectados**, con un enlace a él.
- Las listas de alertas e incidentes muestran el SLO entre los recursos afectados, y el filtro **Recursos afectados** limita una lista a un SLO.
- Las páginas **Alertas** e **Incidentes** del SLO los muestran, y sus distintivos del menú lateral cuentan los abiertos.

OneUptime establece este vínculo cuando una regla crea la alerta o el incidente; no puedes añadirlo a mano, y editar la alerta o el incidente nunca lo quita.

El menú lateral de un monitor también tiene una página **SLO**: los SLO que miden ese monitor, para que sepas qué objetivos dependen de él antes de pausarlo o cambiarlo.

## Los SLO jóvenes y el indicador de llenado de la ventana

Un SLO con ventana móvil más joven que su ventana se mide sobre los datos que existen hasta ahora: un SLO de 30 días creado ayer tiene un día de datos. Su presupuesto de errores empieza pequeño y crece a medida que la ventana se llena, así que sus primeras cifras se mueven más de lo que lo harán después.

Mientras sea así, la **Vista general** lo indica: el resumen muestra un indicador **Window 23% full** (**Window under 1% full** el primer día), y el mosaico **Presupuesto de errores restante** lo repite bajo su cifra. Ambos desaparecen cuando la ventana está llena. Los SLO de mes natural nunca los muestran, porque su presupuesto cubre todo el mes desde el primer día, y tampoco los SLO en modo **Promedio de segundos del monitor**, cuyo presupuesto se cuenta entre varios monitores.

## Solución de problemas

Un aviso en la parte superior de las páginas del SLO dice qué le impide medir:

| Aviso | Qué significa | Qué hacer |
| --- | --- | --- |
| **No hay monitores asociados** | El SLO no tiene monitores, así que no hay nada que medir. | Asocia monitores o crea una regla de monitores. |
| **Waiting for SLO evaluation** | Hay monitores asociados, pero la última evaluación no tenía datos de estado de ellos. | Comprueba que los monitores se están comprobando. Las cifras aparecen tras la siguiente evaluación con datos. |
| **Measurement is paused** | Todos los monitores que mide están archivados o tienen la supervisión activa desactivada. | Vuelve a activar la supervisión de al menos un monitor, o espera a que termine el mantenimiento. |
| **The target is out of range** | El objetivo no es mayor que 0 y menor que 100. | Fija un objetivo como 99,9 en **Ajustes** → **Objetivo**. |
| **This SLO is disabled** | La evaluación está desactivada. | Haz clic en **Activar la evaluación**. |
| **This SLO is archived** | El SLO está archivado. | Desarchívalo en **Ajustes**. |
| **Aún no evaluado** | El SLO se acaba de crear. | Espera a la primera evaluación, unos minutos como mucho. |

## Próximos pasos

:::cards
- [Monitores y reglas de monitores](/docs/slo/monitor-rules): Asocia monitores a mano o con reglas.
- [Presupuestos de errores](/docs/slo/error-budget): El cálculo del presupuesto, la autonomía y cómo vuelve el presupuesto.
- [Alertas e incidentes de tasa de consumo](/docs/slo/burn-rate-alerts): Avisa a tu equipo de guardia cuando el presupuesto se consume demasiado rápido.
- [Métricas y paneles de SLO](/docs/slo/metrics): Representa los SLO en gráficos y crea un panel de SLO.
:::
