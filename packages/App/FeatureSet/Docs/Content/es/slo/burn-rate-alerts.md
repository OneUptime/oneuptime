# Alertas e incidentes de tasa de consumo

Los presupuestos de errores te dicen dónde estás; las reglas de tasa de consumo te dicen cuándo levantarte. Cuando un SLO gasta su presupuesto de errores lo bastante rápido como para importar, una regla de tasa de consumo genera una alerta, declara un incidente o ambas cosas, con tu propio título y descripción, gravedad, propietarios, etiquetas, escalado de guardia y notificaciones del espacio de trabajo.

:::cards
- [Cómo decide una regla](#cómo-decide-una-regla-si-se-activa): Dos ventanas, ambas por encima del umbral.
- [Reglas predeterminadas](#reglas-predeterminadas): Fast burn y Slow burn, ajustadas a la ventana del SLO.
- [Crear una regla](#crear-o-editar-una-regla): Cinco pasos en la página Reglas de tasa de consumo del SLO.
- [Variables de plantilla](#qué-dice-cada-alerta-e-incidente): Escribe tus propios títulos y descripciones.
:::

## Qué significa la tasa de consumo

La tasa de consumo es la velocidad a la que gastas presupuesto de errores comparada con un ritmo uniforme:

```text
burn rate = (share of time that was bad) ÷ (share of time the target allows to be bad)
```

Con una tasa de consumo de 1 gastas el presupuesto justo a lo largo de la ventana y alcanzas el objetivo sin nada de sobra. Las cifras más altas lo agotan antes. Para un SLO del 99,9 % en 30 días:

| Tasa de consumo, si se mantiene | Presupuesto agotado en |
| --- | --- |
| 1 | 30 días |
| 2 | 15 días |
| 6 | 5 días |
| 14.4 | unos 2 días (50 horas) |

La tasa de consumo no depende de cuánto presupuesto queda. Responde a «¿qué tan grave es ahora mismo?», que es lo que necesita la decisión de avisar a alguien.

## Cómo decide una regla si se activa

OneUptime comprueba cada regla de tasa de consumo habilitada cada vez que evalúa el SLO, cada 5 minutos. Cada regla mide la tasa de consumo en dos ventanas y solo se activa cuando ambas están en su umbral o por encima:

- La **ventana larga** (por ejemplo, 1 hora) muestra que el consumo es sostenido y significativo, no una sola comprobación fallida.
- La **ventana corta** (por ejemplo, 5 minutos) muestra que sigue ocurriendo. Sin ella, un pico de hace una hora seguiría avisando mucho después de la recuperación.

Es el patrón de varias ventanas y varias tasas de consumo del Google SRE Workbook, y el que OneUptime configura por ti de forma predeterminada.

```mermaid title="Qué hace una regla de tasa de consumo en cada evaluación"
flowchart TB
    start["Se evalúa el SLO"] --> long(["¿Ventana larga<br/>en el umbral o<br/>por encima?"])
    long -->|"No"| recover["Resolver lo abierto,<br/>si la resolución<br/>automática está activa"]
    long -->|"Sí"| short(["¿Ventana corta<br/>en el umbral o<br/>por encima?"])
    short -->|"No"| hold["Mantener abierto<br/>lo que está abierto"]
    short -->|"Sí"| fire["Generar la alerta,<br/>declarar el incidente<br/>o ambas cosas"]
```

Una regla no puede activarse hasta que el SLO tenga una ventana larga completa de historial de supervisión: si no, la primera comprobación fallida de un monitor, dividida entre unos pocos minutos de historial, daría una tasa de consumo enorme. Así que un SLO nuevo no puede activar su regla **Fast burn** durante su primera hora, ni su regla **Slow burn** durante las seis primeras. Si más adelante un SLO deja de tener tanto historial, por ejemplo después de cambiar sus monitores por otros nuevos, la regla resuelve lo que tiene abierto en lugar de dejarlo colgado. Una regla tampoco se activa mientras alguno de los monitores del SLO esté en un mantenimiento programado: consulta [Mantenimiento programado](#mantenimiento-programado).

## Reglas predeterminadas

Cada SLO nuevo recibe dos reglas de tasa de consumo. Para una ventana de 30 días:

| Regla | Umbral | Ventana larga | Ventana corta | Se activa cuando |
| --- | --- | --- | --- | --- |
| **Fast burn** | 14.4× | 1 hora | 5 minutos | Se consume alrededor del 2 % del presupuesto en una hora: se agotaría en unos 2 días. |
| **Slow burn** | 6× | 6 horas | 30 minutos | Se consume alrededor del 5 % del presupuesto en seis horas: se agotaría en unos 5 días. |

Los umbrales de 14.4× y 6× están calculados para un presupuesto de 30 días, así que OneUptime los ajusta a la ventana de tu SLO. Cada regla significa siempre «el 2 % del presupuesto en 1 hora» o «el 5 % del presupuesto en 6 horas»:

| Ventana del SLO | Umbral de Fast burn | Umbral de Slow burn |
| --- | --- | --- |
| 7 días | 3.36× | 1.4× |
| 28 días | 13.44× | 5.6× |
| 30 días | 14.4× | 6× |
| 90 días | 43.2× | 18× |

Los SLO de mes natural reciben los valores de 30 días. Las dos reglas generan una alerta con la gravedad de alerta más alta del proyecto, con el título y la descripción integrados, la resuelven automáticamente y no añaden propietarios ni etiquetas. No declaran incidentes, así que actualizar OneUptime nunca empieza a declarar incidentes por ti. Edítalas, elimínalas o añade las tuyas.

## Crear o editar una regla

Necesitas permiso para crear reglas de tasa de consumo de SLO.

:::steps
### Abrir Reglas de tasa de consumo

Abre el SLO, ve a **Reglas de tasa de consumo** y haz clic en **Crear Regla de tasa de consumo del SLO**, o edita una de las reglas predeterminadas.

### Ponerle nombre a la regla

En **Regla**, escribe un **Nombre**, como «Fast burn». **Habilitado** está activado.

### Fijar la ventana de consumo

En **Ventana de consumo**, fija el **Umbral de tasa de consumo** (por ejemplo `14.4`), la **Ventana larga (minutos)** y la **Ventana corta (minutos)**, y si quieres la **Supresión de nueva activación (minutos)**.

### Elegir qué declara

En **Qué declara**, activa **Crear alerta**, **Declarar incidente** o ambas. **Añadir propietarios del SLO como propietarios** convierte además a los propietarios del SLO en propietarios de todo lo que crea la regla.

### Describir la alerta y el incidente

Los pasos **Alerta** e **Incidente** solo aparecen para lo que declara la regla. Cada uno tiene un título y una gravedad, y secciones plegadas: **Descripción**, **Propiedad y etiquetas**, **De guardia** y **Más campos**, que contiene la resolución automática, la privacidad y las notas de corrección. Las reglas nuevas empiezan con el título y la descripción integrados, listos para editar. Haz clic en **Crear Regla de tasa de consumo del SLO** en el último paso.
:::

OneUptime comprueba los números de una regla al guardarla:

| Ajuste | Debe ser |
| --- | --- |
| **Umbral de tasa de consumo** | Mayor que 0. |
| **Ventana corta (minutos)** | Mayor que 0. |
| **Ventana larga (minutos)** | Más larga que la ventana corta. |
| **Supresión de nueva activación (minutos)** | 0 o más. Vacío significa la duración de la ventana larga. |

Una regla debe crear una alerta, declarar un incidente o ambas cosas: una regla con las dos desactivadas se rechaza, porque se comprobaría en cada evaluación sin declarar nunca nada.

La tabla de reglas muestra, para cada regla, su umbral, sus ventanas y su supresión, qué declara (y si la alerta o el incidente solo se resuelve a mano, o es privado), sus gravedades, políticas de guardia, propietarios y etiquetas.

> [!TIP]
> Un buen comienzo: conserva las dos reglas predeterminadas, envía la regla de consumo rápido a tu política de guardia que avisa con una gravedad alta, y deja que la regla de consumo lento genere una alerta de gravedad más baja para el horario laboral. Si tu equipo lo gestiona todo con incidentes, activa **Declarar incidente** en la regla de consumo rápido, y desactiva en ella **Crear alerta** si prefieres no recibir ambas.

## Qué declara una regla

|  | **Crear alerta** | **Declarar incidente** |
| --- | --- | --- |
| Al empezar | Activada | Desactivada |
| Qué es | La señal ligera: llega a la lista de alertas. | La señal fuerte: recibe un número de incidente y abre todo el flujo de respuesta. |
| Título y descripción | Los suyos, o el texto integrado | Los suyos, o el texto integrado |
| Gravedad | **Gravedad de la alerta**: la más alta del proyecto si está vacía | **Gravedad del incidente**: la más alta del proyecto si está vacía |
| Escalado | **Políticas de guardia de la alerta** | **Políticas de guardia del incidente** |
| Propietarios y etiquetas | **Propietarios de la alerta** y **Etiquetas de alertas** | **Propietarios del incidente** y **Etiquetas de incidentes** |
| Privado | Desactivado | Desactivado |
| Resolución automática | Activada | Activada |
| Páginas de estado | Nunca se publica | Nunca se publica |

Como cada una se configura por separado, puedes enviar una alerta breve a la rotación del equipo responsable y un incidente detallado a tu rotación de incidentes graves. También viven por separado: cada una se deduplica, se resuelve y se suprime por su cuenta, así que resolver el incidente no reinicia la supresión de la alerta, ni al revés.

### El SLO es un recurso afectado

Cada alerta e incidente que crea una regla de tasa de consumo muestra su SLO en **Recursos afectados** y enlaza a él. El filtro **Recursos afectados** de las listas de alertas e incidentes las limita a un SLO, y las páginas **Alertas** e **Incidentes** del SLO los muestran, con distintivos en el menú lateral que cuentan los abiertos. OneUptime establece este vínculo por sí mismo, y editar la alerta o el incidente nunca lo quita.

### Los incidentes de tasa de consumo son internos

Un presupuesto de errores que se consume rápido es una señal para ingeniería, no una caída declarada. Un incidente de tasa de consumo nunca se muestra en las páginas de estado ni avisa a los suscriptores de las páginas de estado. Tampoco está vinculado a ningún monitor, porque al resolverlo se reescribiría el propio historial de estado de los monitores con el que se mide el SLO.

Si resuelves un incidente así a mano, nada lo vuelve a declarar hasta que el consumo se recupere y la regla se vuelva a activar de verdad, así que nunca peleas con la regla mientras trabajas en un incidente.

## Qué dice cada alerta e incidente

Las reglas nuevas empiezan con el título y la descripción integrados, tanto en la alerta como en el incidente. Vacía un título o una descripción para volver al texto integrado. El título integrado es:

```text
SLO burn rate: {{sloName}} — {{ruleName}}
```

La descripción integrada nombra la regla, da la tasa de consumo de ambas ventanas frente al umbral, y el presupuesto de errores restante.

Para escribir los tuyos, usa variables de plantilla en el título, la descripción y las notas de corrección. Cada uno de esos campos las muestra en **Variables de plantilla**: haz clic en una para insertarla donde está el cursor, o escribe `{{` en el campo y elige una. La descripción y las notas de corrección también tienen **Insertar variable** en su barra de herramientas. Las variables se rellenan cuando la regla se activa:

| Variable | Qué contiene | Ejemplo |
| --- | --- | --- |
| `{{sloName}}` | Nombre del SLO. | `Checkout availability` |
| `{{sloId}}` | ID del SLO. | `b7f4c2d8-1f3e-4a5b-9c6d-7e8f9a0b1c2d` |
| `{{sloLink}}` | Enlace al SLO en el panel de OneUptime. | `https://oneuptime.com/dashboard/project-id/slos/slo-id` |
| `{{sloStatus}}` | Estado del SLO después de esta evaluación. | `At Risk` |
| `{{ruleName}}` | Nombre de la regla de tasa de consumo que se activó. | `Fast burn` |
| `{{burnRateThreshold}}` | El umbral de tasa de consumo de la regla (un múltiplo del ritmo sostenible). | `14.4` |
| `{{longWindowBurnRate}}` | Tasa de consumo medida en la ventana larga de la regla. | `21.5` |
| `{{shortWindowBurnRate}}` | Tasa de consumo medida en la ventana corta de la regla. | `36` |
| `{{longWindowInMinutes}}` | Duración de la ventana larga de la regla, en minutos. | `60` |
| `{{shortWindowInMinutes}}` | Duración de la ventana corta de la regla, en minutos. | `5` |
| `{{targetPercentage}}` | El objetivo del SLO, en porcentaje. | `99.9` |
| `{{currentSliPercentage}}` | El SLI medido en la ventana de cumplimiento del SLO, en porcentaje. | `99.87` |
| `{{errorBudgetRemainingPercentage}}` | Parte del presupuesto de errores que queda, en porcentaje. Negativa cuando el presupuesto se ha superado. | `42.5` |
| `{{errorBudgetRemaining}}` | Presupuesto de errores que queda, como duración. Empieza con un signo menos cuando el presupuesto se ha superado. | `18m 22s` |
| `{{errorBudgetRemainingMinutes}}` | Presupuesto de errores que queda, en minutos. | `18.37` |
| `{{windowDescription}}` | La ventana de cumplimiento del SLO, en palabras. | `rolling 30-day window` |

Por ejemplo, el título `{{ruleName}}: {{sloName}} is burning {{longWindowBurnRate}}x` se convierte en `Fast burn: Checkout availability is burning 21.5x`.

:::details Cómo se rellenan las variables
- Los números se redondean a dos decimales.
- Los espacios dentro de las llaves no importan: `{{ sloName }}` funciona.
- Una variable mal escrita se deja tal cual, así que una errata se ve en la alerta en lugar de desaparecer sin avisar.
- Los títulos pueden tener 500 caracteres, y las descripciones y notas de corrección 50.000. Un título que supera los 500 caracteres al rellenar sus variables se pone en una línea y se acorta con puntos suspensivos, así que la alerta o el incidente se crea igualmente.
- Si no se puede construir el enlace al SLO cuando la regla se activa, `{{sloLink}}` se deja vacío y la alerta o el incidente se crea igualmente.
:::

## Propietarios, etiquetas y privacidad

- **Propietarios de la alerta** y **Propietarios del incidente** son personas y equipos, elegidos de una misma lista con **Añadir propietario**. Se añaden a la alerta o al incidente en cuanto se crea, y se les avisa. Las personas deben ser miembros del proyecto.
- **Añadir propietarios del SLO como propietarios** añade además a los propietarios del SLO, sus usuarios propietarios y los miembros de sus equipos propietarios, a todo lo que crea la regla. Los propietarios del SLO ya se enteran de los cambios de estado del propio SLO, así que esto puede avisarles dos veces. Está desactivado de forma predeterminada.
- Cada propietario se añade una vez: un usuario que ya es propietario de la alerta o del incidente, por ejemplo por las reglas del propietario del proyecto, o que está en un equipo propietario que se añade, no se vuelve a añadir.
- **Etiquetas de alertas** y **Etiquetas de incidentes** se añaden a la alerta o al incidente, para que los filtros, las reglas del propietario y las reglas de notificación del espacio de trabajo puedan coincidir con ellos.
- Una alerta o un incidente privado solo lo ven sus propietarios, los administradores del proyecto y los propietarios del proyecto.

Las etiquetas, los equipos propietarios y las políticas de guardia deben pertenecer al proyecto del SLO.

## Resolución y supresión de nuevas activaciones

- **La resolución sigue a la ventana larga.** Con la resolución automática activada (lo predeterminado), OneUptime resuelve la alerta y el incidente de una regla en cuanto la tasa de consumo de la ventana larga baja del umbral. Resolver con la ventana corta haría que oscilara: una caída recurrente se resolvería tras cinco minutos tranquilos y volvería a avisar toda la noche.
- **Resolución automática desactivada.** Desactiva **Resolver alerta automáticamente** o **Resolver incidente automáticamente** y ese registro queda abierto hasta que alguien lo resuelva, aunque el consumo se recupere. La regla no abre otro encima, y una vez resuelto a mano y con la ventana larga por debajo del umbral, la regla puede volver a activarse tras su supresión.
- **Supresión de nuevas activaciones.** Después de que un registro se resuelve, la regla no vuelve a declarar ese tipo de registro durante el periodo de supresión, de forma predeterminada la duración de la ventana larga. Así un sistema que se recupera tiene margen para hacerlo sin avisar por el ruido que queda.

Algunos cambios siempre resuelven lo que una regla tiene abierto, digan lo que digan sus ajustes de resolución automática, para que nada siga escalando por una regla que ya no puede justificarlo:

- desactivar **Crear alerta** o **Declarar incidente** cierra lo que abrió esa salida;
- desactivar la regla o eliminarla;
- desactivar la evaluación del SLO, archivar el SLO o eliminarlo;
- que el SLO pase a **Pausado** o **Mal configurado**, porque entonces no mide nada;
- que la regla pierda su umbral o sus ventanas, o que el SLO deje de tener una ventana larga completa de historial.

## Mantenimiento programado

Mientras algún monitor del SLO esté en un evento de mantenimiento programado en curso, sus reglas de tasa de consumo no generan alertas ni declaran incidentes: el trabajo planificado no debería avisar a nadie. Lo que las reglas ya tienen abierto se sigue resolviendo como siempre. El tiempo sigue contando para el presupuesto de errores, según los estados de inactividad del SLO.

## El feed del SLO

El **Feed** del SLO publica cada alerta que genera una regla y cada incidente que declara, con un enlace y las tasas de consumo que lo explican, y cuándo se resuelve cada uno, automáticamente o a mano. Un registro que la regla vuelve a tomar porque seguía abierto no se publica dos veces. Crear, cambiar y eliminar una regla también se publica, y queda en los **Registros de auditoría** del SLO. Consulta [Feed y registros de auditoría de SLO](/docs/slo/feed-and-audit-logs).

## Solución de problemas

:::details Una regla no se activó justo después de crear el SLO
Una regla solo se activa cuando el SLO tiene una ventana larga completa de historial de supervisión: una hora para la regla de consumo rápido predeterminada, seis horas para la de consumo lento.
:::

:::details Una alerta se resolvió mientras la caída seguía
La resolución automática sigue a la ventana larga: en cuanto la tasa de consumo de la ventana larga baja del umbral, la alerta se resuelve. Dale a la regla una ventana larga más larga, o desactiva **Resolver alerta automáticamente** y resuelve la alerta a mano.
:::

:::details No se activó nada durante un evento de mantenimiento programado
Las reglas de tasa de consumo permanecen en silencio mientras alguno de los monitores del SLO esté en un evento de mantenimiento programado en curso. El tiempo de inactividad sigue contando para el presupuesto.
:::

:::details ¿Hay un número mínimo de muestras?
No para los SLO que se miden con la disponibilidad de los monitores. La disponibilidad se mide en segundos, así que cada segundo de la ventana es una muestra y no hay casos de poco tráfico de los que protegerse. Un número mínimo de muestras solo importa para los SLI basados en eventos, que todavía no están disponibles.
:::

## Próximos pasos

:::cards
- [Presupuestos de errores](/docs/slo/error-budget): Qué es el presupuesto y cuánto dura.
- [Reglas de escalado](/docs/on-call/escalation-rules): A quién se avisa y en qué orden.
- [Feed y registros de auditoría de SLO](/docs/slo/feed-and-audit-logs): Cada alerta e incidente que generó una regla.
:::
