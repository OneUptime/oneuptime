# Línea de tiempo de guardias

La línea de tiempo de guardias muestra todas las programaciones de guardia de tu proyecto en una sola cuadrícula semanal o mensual: una fila por programación y una columna por día. Responde a «¿quién está de guardia en mi equipo, o en toda la organización, esta semana?» sin abrir cada programación.

Los turnos de la línea de tiempo son los mismos con los que OneUptime avisa a las personas, sustituciones de usuario incluidas: la línea de tiempo, las reglas de escalado y los feeds de calendario los leen del mismo sitio.

```mermaid title="Un mismo conjunto de turnos detrás de la línea de tiempo, los avisos y los feeds de calendario"
flowchart TB
    subgraph setup["Cada programación"]
        direction LR
        layers["Capas y rotaciones"]
        overrides["Sustituciones de usuario"]
    end
    layers --> shifts["Quién está de guardia, y cuándo"]
    overrides --> shifts
    shifts --> timeline["Cronología de la programación"]
    shifts --> paging["Las reglas de escalado los avisan"]
    shifts --> feeds["Feeds de calendario"]
```

## Abre la línea de tiempo

- **Guardia** > **Cronología de la programación** muestra todas las programaciones que puedes ver, agrupadas por equipo propietario. El botón **Vista de cronología** de **Programaciones de guardia** abre la misma página.
- **Equipos** > un equipo > **Programaciones de guardia** muestra solo las programaciones de las que ese equipo es propietario.

Un equipo es propietario de una programación cuando figura en la página **Propietarios** de la programación. Las programaciones sin equipo propietario se agrupan en **Sin equipo propietario**. Desactiva **Group by team** para ver todas las programaciones en una sola lista, ordenada por nombre.

## Lee la cuadrícula

| En la cuadrícula | Qué significa |
| --- | --- |
| Una barra | Un turno: quién está de guardia, desde cuándo y hasta cuándo. Una persona tiene el mismo color en todas las programaciones. |
| Una barra atenuada | Un turno pasado. |
| Una barra marcada con **⇄** | Una sustitución: alguien cubre un turno. El carril fino de debajo nombra a la persona cuyo turno se cubre, tachada. |
| Un bloque ámbar rayado | Un hueco de cobertura: nadie está de guardia. Una alerta que escala a esa programación no avisa entonces a nadie. |
| La línea roja | Ahora. |
| La línea bajo el nombre de una programación | Quién está de guardia ahora, o **No one on call now**. |

Pasa el puntero por encima de una barra o un hueco, o llega a ellos con el teclado, para ver sus detalles.

Debajo de la cuadrícula, **On call this week** (**On call this month** en la vista mensual) lista a todas las personas de guardia en el periodo. Pasa el puntero por un nombre para ver cuánto tiempo está de guardia esa persona y en cuántas programaciones.

## Cambia el periodo y la zona horaria

- Cambia entre **Semana** y **Mes**, muévete con las flechas y vuelve con **Hoy**.
- Las horas se muestran en tu propia zona horaria. El botón de zona horaria abre **View timeline in timezone**, que muestra la línea de tiempo en cualquier otra zona sin cambiar quién está de guardia: cada programación sigue haciendo sus relevos en su propia zona horaria.
- La línea de tiempo abarca 180 días hacia atrás y 365 días hacia adelante.

> [!NOTE]
> Los turnos pasados se recalculan a partir de la configuración actual de cada programación, así que muestran la rotación tal como está configurada ahora, que puede diferir de a quién se avisó realmente en su momento. Para las horas que las personas pasaron realmente de guardia, usa **Guardia** > **Informes** > **Tiempo de guardia del usuario**.

## Encuentra una programación o una persona

- **Buscar** encuentra nombres de programaciones, nombres de equipos y a las personas de guardia.
- El filtro de equipo limita la vista a un equipo o a **Mis equipos**; **Schedules I'm on** deja solo las programaciones en las que participas.
- Encima de la cuadrícula, haz clic en **with no one on call now** o **with coverage gaps this week** (**with coverage gaps this month** en la vista mensual) para ver solo esas programaciones. Haz clic de nuevo para verlas todas.
- Haz clic en una persona debajo de la cuadrícula, o en una de sus barras, para resaltar todos sus turnos. **Quitar resaltado** lo deshace, y **Borrar filtros** restablece la búsqueda y los filtros.

## Quién ve qué

| Se aplica a | Regla |
| --- | --- |
| Permisos | Los mismos permisos y restricciones por etiqueta que **Programaciones de guardia**, además del permiso para leer las capas de las programaciones. |
| Sustituciones | A quién cubre una sustitución solo lo ven quienes pueden leer las sustituciones de usuario. Los demás siguen viendo a quién se avisa. |
| Número de programaciones | Hasta 250 programaciones a la vez, ordenadas por nombre. La página **Programaciones de guardia** de un equipo la limita a las programaciones de ese equipo. |
| Plan | En OneUptime Cloud, la línea de tiempo necesita el plan **Growth**, como las programaciones de guardia. |

## Próximos pasos

:::cards
- [Programaciones de guardia](/docs/on-call/schedules): Configura quiénes se turnan, las capas y las horas de guardia.
- [Feeds de calendario](/docs/on-call/calendar-feeds): Lleva tus turnos a Google Calendar, Outlook o el Calendario de Apple.
- [Reglas de escalado](/docs/on-call/escalation-rules): Decide a quién avisa cada nivel de una política de guardia.
:::
