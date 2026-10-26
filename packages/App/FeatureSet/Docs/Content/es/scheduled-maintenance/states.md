# Estados del mantenimiento

Cada evento de mantenimiento programado está en un **estado**: en qué punto está el trabajo, de planificado a aprobado. Los estados deciden qué hace OneUptime con el evento: cuándo dejan de comprobarse sus monitores, qué muestran tus páginas de estado, cuándo paran sus recordatorios. Esta página cubre los cuatro estados con los que empieza cada proyecto, qué mueve un evento entre ellos y cómo añadir pasos propios.

:::cards
- [Los estados iniciales](#los-estados-iniciales): Programado, En curso, Finalizado y Completado.
- [Qué mueve un evento](#qué-mueve-un-evento): El reloj, la cabecera, la cronología, el chat y la API.
- [Estados propios](#estados-propios): Un paso antes de que empiece el trabajo, o una comprobación después.
- [La cronología de estados](#la-cronología-de-estados): Cada estado en el que ha estado un evento, y cómo corregirlo.
:::

## Cómo funciona

Los estados de mantenimiento de un proyecto son una sola lista ordenada, y los eventos solo bajan por ella. El lugar de un estado decide qué cuenta como un evento que está en él: esperando a empezar, en curso o terminado.

```mermaid title="Los eventos solo bajan por la lista; el lugar de un estado decide qué cuenta como"
flowchart TB
    subgraph waiting["Esperando a empezar"]
        scheduled["Programado"]
        confirmed["Confirmado<br/>(propio)"]
    end
    subgraph progress["En curso"]
        ongoing["En curso"]
        verifying["Verificando<br/>(propio)"]
    end
    subgraph over["Terminado"]
        ended["Finalizado"]
        completed["Completado"]
    end
    scheduled --> confirmed
    confirmed -->|"su Comienza en"| ongoing
    ongoing --> verifying
    verifying -->|"su Termina en"| ended
    ended --> completed
```

El modelo `ScheduledMaintenanceState` tiene `name`, `description`, `color` y `order`, más cuatro indicadores: `isScheduledState`, `isOngoingState`, `isEndedState` y `isResolvedState`. OneUptime lee los indicadores y el orden, nunca el nombre, así que puedes cambiar el nombre de **Completado** a «Aprobado» sin que nada se rompa.

> [!TIP]
> La lista está en **Mantenimiento programado → Ajustes → Estado del evento**. **Ajustes** empieza plegado en el menú lateral: despliégalo primero.

## Los estados iniciales

Cada proyecto nuevo empieza con cuatro estados de mantenimiento, en este orden:

| Estado        | `order` | Indicador          | Color     | Qué significa                                                  |
| ------------- | ------- | ------------------ | --------- | -------------------------------------------------------------- |
| **Programado** | `1`    | `isScheduledState` | `#000000` | Cada evento nuevo empieza aquí y espera su hora de inicio.     |
| **En curso**  | `2`     | `isOngoingState`   | `#ffbf53` | El trabajo está en marcha, y los monitores del evento no se comprueban. |
| **Finalizado** | `3`    | `isEndedState`     | `#4a4a4a` | La ventana ha terminado, y las comprobaciones se reanudan.     |
| **Completado** | `4`    | `isResolvedState`  | `#2ab57d` | Alguien aprobó el trabajo, y los recordatorios a los propietarios paran. |

Los cuatro estados marcados llevan la etiqueta **Predefinido** en la página de ajustes. Puedes cambiarles el nombre, el color y arrastrarlos, pero mantienen su orden y no se pueden eliminar: su **Eliminar** sigue bloqueado y dice por qué.

**Finalizado** y **Completado** están ambos terminados. La diferencia es quién mueve el evento: OneUptime lo pasa a **Finalizado** en su **Termina en**, y una persona, un botón de chat o la API lo pasa a **Completado** una vez revisado el trabajo.

## Qué mueve un evento

| Vía              | Dónde                                                                                       | Qué pide                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **El reloj**     | Una tarea que se ejecuta cada minuto                                                        | Nada: en **Comienza en** pasa un evento en espera a **En curso**, y en **Termina en** un evento en curso a **Finalizado**. |
| **La cabecera**  | La **Vista general** del evento: los botones **Marcar como {{state}}**, y **Cambiar el estado a** en su menú **⋯** | Un diálogo corto, **Marcar el mantenimiento programado como {{state}}**, con **Notificar a suscriptores de la página de estado** y una nota opcional en **Añadir una nota pública**. |
| **La cronología** | **Cronología de estados** en el menú lateral del evento                                    | Una fila que añades a mano, con **Estado del mantenimiento programado** y **Comienza en**.                      |
| **Una fila de la lista** | El menú **⋯** de la fila de un evento en la lista de eventos: los pasos **Marcar como {{state}}** y **Cambiar estado** | El diálogo de la cabecera, con el nombre del evento. Un evento que otro cambio ya movió se deja como está, y el diálogo dice por qué. |
| **Cambio masivo** | **Marcar como {{state}}** o **Cambiar estado** sobre una selección en la lista de eventos                              | El estado, y una nota pública añadida a cada evento. Se omiten los eventos que ya están en ese estado o más allá. |
| **El chat**      | Los botones de los mensajes de Slack y Microsoft Teams del evento                           | El mismo cambio, hecho en tu nombre. Consulta [Slack](/docs/workspace-connections/slack#actuar-sobre-incidentes-alertas-y-eventos-desde-slack). |
| **La API**       | Una fila creada en `/api/scheduled-maintenance-state-timeline`                              | El estado, y si se avisa a los suscriptores.                                                                    |

Los botones de la cabecera llevan el nombre de tus estados. Mientras el evento espera, ofrece dos: uno que lo inicia, con el nombre de tu estado en curso, y otro que lo termina, con el nombre de tu estado finalizado. Mientras el evento está en curso, solo el segundo. El menú **⋯** lista todos los demás estados posteriores al actual. Quien, por su rol, no puede cambiar el estado del evento ve los botones bloqueados y ningún menú de otros estados: al señalar uno, se nombran los permisos que se lo permitirían.

## Qué hacen el inicio y el final

Un evento empieza cuando pasa de un estado en el que espera a **En curso**, o directamente a un estado propio situado entre **En curso** y **Finalizado**. Entonces:

- **Sus monitores dejan de comprobarse** y pasan a su **Cambiar el estado del monitor a**, si tiene uno. Un monitor que añades al evento mientras está en marcha también cambia.
- **Sus páginas de estado lo muestran en curso**, y se avisa a sus suscriptores: a su hora si **Cuando empieza el evento** está activado, y a mano según indique **Notificar a suscriptores de la página de estado** en el diálogo.
- **Se avisa a sus propietarios**, si activaron la notificación de cambio de estado, y el evento aparece en **Eventos en curso**.

Un evento termina cuando pasa de un estado en el que está en curso a **Finalizado**, **Completado** o un estado propio situado después de **Finalizado**. Entonces sus monitores se vuelven a comprobar y regresan a «operativo», salvo que otro evento en curso todavía los retenga, y se avisa a sus suscriptores del mismo modo: a su hora si **Cuando termina el evento** está activado, y a mano según indique el diálogo.

Pasar de **En curso** a «Verificando», o de **Finalizado** a **Completado**, no vuelve a iniciar ni a terminar nada: el evento ya había empezado, o ya había terminado.

## El reloj de la cabecera

Antes del inicio, la cabecera hace una cuenta atrás; mientras el evento está en marcha, cuenta cuánto lleva; una vez terminado, dice cuánto duró. Cuando el evento se salta un límite por más de dos minutos, un aviso ámbar lo indica:

- **Inicio atrasado**: el evento sigue esperando después de su **Comienza en**.
- **Excediéndose**: el evento sigue en curso después de su **Termina en**.

El aviso indica la hora planificada y el estado al que el evento aún no ha llegado. Justo después de un límite, puede que la tarea que mueve los eventos aún no se haya ejecutado, así que durante los minutos siguientes la cabecera vuelve a comprobar por sí sola y muestra el nuevo estado sin recargar.

## El orden es obligatorio

Cada cambio de estado se comprueba contra la lista, lo haga quien lo haga: el panel, Slack, Microsoft Teams, la API, Terraform, un flujo de trabajo o el propio OneUptime.

- **Se rechazan los retrocesos**, con un mensaje que nombra ambos estados: "Scheduled Maintenance cannot transition to Scheduled state from Ongoing state because Scheduled is before Ongoing in the order of scheduled maintenance states."
- **Se rechaza pasar al estado en el que ya está**: "Scheduled Maintenance state cannot be same as previous state."
- **Los selectores solo ofrecen los estados posteriores al actual**, así que a nadie se le ofrece un cambio que se rechazaría.

Para corregir un estado puesto por error, elimina su fila en la página **Cronología de estados** del evento; el evento vuelve al estado de la fila anterior.

## Estados propios

Un estado que añades es un paso por el que pasa tu equipo y que los cuatro iniciales no nombran: «Confirmado» antes de que empiece el trabajo, «Verificando» después.

:::steps
### Abrir la lista de estados

Ve a **Mantenimiento programado → Ajustes → Estado del evento**. La tarjeta **Estados de mantenimiento programado** lista tus estados en su orden. Cada fila muestra su color y su nombre, qué cuenta como un evento que está en él (columna **Cuenta como**) y su descripción.

### Crear el estado

Haz clic en **Crear Estado de mantenimiento programado** y rellena su **Nombre**, su **Descripción** y su **Color**. El estado nuevo se añade justo encima del estado completado.

### Arrastrarlo a su sitio

Arrastra una fila por su asa para moverla; el nuevo orden se guarda al soltarla. La columna **Cuenta como** sigue el lugar donde la sueltas.
:::

Un estado que añades no tiene indicador, así que su lugar es lo que significa:

| Dónde lo colocas                        | Un evento que está en él                                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Entre **Programado** y **En curso**     | Espera su **Comienza en**, como en **Programado**, y empieza desde ahí a su hora.                                |
| Entre **En curso** y **Finalizado**     | Está en curso, como en **En curso**: sus monitores siguen sin comprobarse, y termina en su **Termina en**.       |
| Entre **Finalizado** y **Completado**   | Ha terminado, pero aún no está completado: los recordatorios que duran hasta completarse continúan.              |
| Debajo de **Completado**                | Está completado, como en **Completado**.                                                                         |

Mantén tus estados por debajo de **Programado**: cada evento nuevo empieza ahí, y un evento nunca vuelve a subir por la lista, así que un estado por encima nunca se alcanza. Mueves un evento a un estado propio desde el menú **⋯** de su cabecera, en **Cambiar el estado a**.

> [!NOTE]
> En OneUptime Cloud, añadir o cambiar estados de mantenimiento requiere el plan **Growth** o superior. Todos los planes pueden leerlos, usarlos y eliminar un estado que hayas añadido.

## Archivar un estado

Archive un estado propio que su equipo ya no deba usar, en lugar de eliminarlo. Archivar no cambia ningún evento: un evento en ese estado sigue en él y avanza como de costumbre, y su cronología de estados lo sigue mostrando.

- **Archivar** está en el menú **⋯** de la fila. Primero pide confirmación y enumera las mediciones y los flujos de trabajo configurados para usar el estado.
- **Nadie puede volver a elegirlo.** La cabecera del evento, **Cambiar estado**, Slack y Microsoft Teams lo omiten, y la API, Terraform y MCP lo rechazan. Puede seguir filtrando los eventos por él.
- **Los estados archivados se listan aparte**, en la sección plegada **Estados de mantenimiento programado archivados** bajo la tabla. **Desarchivar** devuelve uno tal como estaba.
- **Los cuatro estados integrados no se pueden archivar**: OneUptime mueve los eventos a ellos. Su **Archivar** está bloqueado, con el motivo.

## La cronología de estados

La página **Cronología de estados** del evento es el registro de cada estado en el que ha estado. Su tarjeta los dibuja como una cronología: una banda con cada estado tan largo como duró y, debajo, cada cambio, el más reciente primero. **Tabla**, en la cabecera de la tarjeta, los lista como filas, con **Estado del mantenimiento programado**, **Comienza en**, **Termina en**, **Duración**, si se debía avisar a los suscriptores y cómo fue su notificación.

En el panel, las filas se pueden añadir y eliminar, pero no editar, y un evento conserva siempre al menos una. A través de la API se puede corregir el `startsAt` de una fila, y cada medición calculada a partir de la cronología lo sigue. Eliminar la fila más reciente devuelve el evento al estado de la fila anterior.

> [!WARNING]
> Eliminar una fila reescribe el historial del evento y cada medición calculada a partir de él. Úsalo para corregir un error, no para ordenar.

## Solución de problemas

:::details La cabecera dice Inicio atrasado
El evento sigue esperando más de dos minutos después de su **Comienza en**, así que la tarea que inicia los eventos aún no lo ha movido. Inícialo tú con el botón de la cabecera: un inicio a mano hace todo lo que hace la tarea, también con sus monitores.
:::

:::details Un evento no puede volver a un estado en el que estuvo
Los estados solo bajan por la lista. Elimina las filas posteriores al estado que quieres en la página **Cronología de estados** del evento, empezando por la más reciente.
:::

:::details Falta el estado completado entre los botones de la cabecera
Los botones de la cabecera inician y terminan el evento. Completarlo está en el menú **⋯**, en **Cambiar el estado a**.
:::

## Próximos pasos

:::cards
- [Visión general del mantenimiento programado](/docs/scheduled-maintenance/index): Dónde está todo y qué afecta un evento.
- [Crear eventos de mantenimiento](/docs/scheduled-maintenance/creating-events): El formulario, campo a campo.
- [Reglas y ajustes del mantenimiento](/docs/scheduled-maintenance/settings): Recordar a los propietarios hasta que un evento se completa.
- [Estados y severidades de incidentes](/docs/incidents/states-and-severities): La misma lista ordenada, para incidentes.
:::
