# Plantillas y eventos recurrentes

Una plantilla de mantenimiento programado guarda un evento que planificas a menudo: su título y su descripción, los monitores que pausa, las páginas de estado en las que aparece y a quién se avisa. Úsala para rellenar el formulario con un clic, o hazla recurrente para que OneUptime programe el evento por ti, cada semana, cada mes o con el intervalo que elijas.

:::cards
- [Crear una plantilla](#crear-una-plantilla): Los pasos del formulario, con un nombre delante y una programación al final.
- [Usar una plantilla](#usar-una-plantilla): Rellenar un evento nuevo a partir de ella.
- [Eventos recurrentes](#eventos-recurrentes): Deja que OneUptime programe el evento por sí solo.
- [Cambiar o detener una plantilla](#cambiar-o-detener-una-plantilla): Editarla, pausar su programación o eliminarla.
:::

## Cómo funciona

Una plantilla es un punto de partida. Un evento creado a partir de ella es una copia con sus propios valores: cambiar la plantilla después solo cambia los eventos creados a partir de entonces.

```mermaid title="Dos formas en que una plantilla se convierte en un evento"
flowchart TB
    template["Una plantilla<br/>en Plantillas<br/>de mantenimiento"] --> byhand["Crear desde plantilla<br/>rellena el formulario"]
    template --> schedule["Recurrente activado<br/>revisado cada minuto"]
    byhand --> event["Un evento nuevo<br/>en Programado"]
    schedule --> event
```

## Antes de empezar

- **Tu plan.** En OneUptime Cloud, las plantillas requieren el plan **Growth** o superior.
- **Tu rol.** Crear una plantilla requiere **Propietario del proyecto**, **Administrador del proyecto**, **Miembro del proyecto**, **Administrador de mantenimiento programado** o **Miembro de mantenimiento programado**, o un rol personalizado que pueda crear plantillas de mantenimiento programado.

## Crear una plantilla

:::steps
### Abrir las plantillas

Ve a **Mantenimiento programado → Ajustes → Plantillas de mantenimiento**. **Ajustes** empieza plegado en el menú lateral: despliégalo primero. Haz clic en **Crear Plantilla de mantenimiento programado**.

### Nombrar la plantilla

En **Información de la plantilla**, dale un **Nombre de la plantilla** y una **Descripción de la plantilla**, para que tu equipo sepa cuándo usarla. Ambos son obligatorios.

### Describir el evento

En **Detalles del mantenimiento**, rellena el **Título** y la **Descripción** con los que empieza cada evento creado con ella. **Propietarios** y **Etiquetas** esperan en **Más campos**.

### Elegir qué afecta

En **Recursos afectados**, elige los **Monitores**, el **Cambiar el estado del monitor a** para ellos, los **Otros recursos afectados** que haya, las páginas de estado en **Mostrar evento en estas páginas de estado** y las **Notificaciones a suscriptores**.

### Decidir si se repite

En **Recurrente**, deja **Evento recurrente** desactivado para una plantilla que usas a mano, o actívalo, elige cada cuánto se repite y su **Zona horaria**, y fija las horas del primer evento en **Primer evento**. Haz clic en **Siguiente** para revisar y luego crea la plantilla.
:::

Una plantilla pide **Cambiar el estado del monitor a** aunque no nombre ningún monitor: el estado también se aplica a los monitores que añades al programar un evento a partir de ella. En **Otros recursos afectados**, una plantilla admite hosts, clústeres de Kubernetes, hosts de Docker, hosts de Podman y servicios.

## Qué rellena una plantilla

| Parte del evento                                  | Crear desde plantilla                | Un evento recurrente            |
| ------------------------------------------------- | ------------------------------------ | ------------------------------- |
| **Título** y **Descripción**                      | Rellenados, y puedes cambiarlos      | Copiados                        |
| **Monitores** y **Cambiar el estado del monitor a** | Rellenados                         | Copiados                        |
| **Otros recursos afectados**                      | Rellenados                           | Copiados                        |
| Las páginas de estado y **Notificaciones a suscriptores** | Rellenadas                   | Copiadas                        |
| **Propietarios** y **Etiquetas**                  | Rellenados                           | Copiados                        |
| **Comienza en** y **Termina en**                  | La próxima hora en punto, durante una hora | Calculados a partir de la programación |

## Usar una plantilla

:::steps
### Elegir la plantilla

En **Mantenimiento programado → Todos los eventos de mantenimiento**, haz clic en **Crear desde plantilla** y elige una plantilla en **Seleccionar plantilla de mantenimiento programado**.

### Revisar el formulario

Haz clic en **Crear desde plantilla**. El formulario de creación se abre con las respuestas de la plantilla ya rellenas. Ajusta la ventana y cambia lo que este evento necesite.

### Crear el evento

Recorre los pasos con **Siguiente** y luego haz clic en **Crear evento de mantenimiento** en la revisión.
:::

Cuando el proyecto aún no tiene ninguna plantilla, **Crear desde plantilla** lo dice y enlaza a **Plantillas de mantenimiento**.

## Eventos recurrentes

Una plantilla recurrente crea el evento según una programación. Tú fijas cada cuánto se repite, la zona horaria que mantiene, y cuándo se crea el primer evento, cuándo empieza y cuándo termina; cada evento posterior es el primero desplazado intervalos enteros del calendario de esa zona horaria, a las mismas horas del día.

| Campo                                    | Qué significa                                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Evento recurrente**                    | Activa la programación.                                                                             |
| **¿Con qué frecuencia quieres que se repita este evento?** | Un número y una unidad: horas, días, semanas, meses o años.                       |
| **Zona horaria**                         | La zona horaria en la que los eventos mantienen su hora del día. Una plantilla nueva empieza con la tuya. |
| **Primer evento programado a las**       | Cuándo crea OneUptime el primer evento, que es cuando sus suscriptores se enteran de que está programado. |
| **El primer evento comienza a las**      | Cuándo empieza el primer evento.                                                                    |
| **El primer evento termina a las**       | Cuándo termina el primer evento.                                                                    |

Los tres primeros están en el paso **Recurrente**. Las horas del primer evento están en el paso **Primer evento**, que aparece en cuanto **Evento recurrente** está activado.

Por ejemplo, una ventana semanal cuyo primer evento se crea un lunes para el sábado siguiente:

| Evento       | Creado             | Empieza            | Termina            |
| ------------ | ------------------ | ------------------ | ------------------ |
| El primero   | `2030-06-03 09:00` | `2030-06-08 02:00` | `2030-06-08 04:00` |
| El segundo   | `2030-06-10 09:00` | `2030-06-15 02:00` | `2030-06-15 04:00` |

Cada evento mantiene las horas del día del primer evento en la zona horaria de la plantilla, también cuando los relojes cambian por el horario de verano: una ventana de 02:00 a 04:00 en Berlín es de 02:00 a 04:00 allí en verano y en invierno. Algunos días quedan así:

- **Un día que el mes no tiene.** Un evento mensual el día 29, 30 o 31 cae en el último día de un mes más corto, como el 30 de abril o el 28 de febrero, y vuelve a su propio día en los meses que lo tienen. Un evento anual el 29 de febrero cae el 28 de febrero en los demás años.
- **La noche en que se adelantan los relojes.** Una hora que no existe esa noche, como las 02:30 cuando las 02:00 saltan a las 03:00, avanza lo que dura el salto, a las 03:30. Un evento cuyo inicio pasa así de su fin conserva la duración del primer evento.
- **La noche en que se atrasan los relojes.** Una hora que ocurre dos veces esa noche, como las 01:30 en Nueva York, es la primera de las dos.
- **Cada pocas horas.** Las horas se cuentan a medida que pasan, así que una plantilla que se repite cada pocas horas se mueve una hora en el reloj cuando este cambia.
- **Una zona horaria sin horario de verano.** Una zona horaria que ya no cambia sus relojes, como la de Columbia Británica (America/Vancouver) desde noviembre de 2026, mantiene el mismo desfase, así que nada se mueve.

Una plantilla creada antes de que las plantillas tuvieran zona horaria muestra **UTC**, la zona horaria en la que se calcularon sus eventos hasta entonces. Elige la zona horaria en la que se pensaron sus horas y, desde su próximo evento, cada evento mantiene allí la hora del día del primer evento.

Pon **Primer evento programado a las** con tanta antelación al inicio como quieras que tus clientes se enteren del trabajo. Las tres horas deben estar en el futuro al crear la plantilla, el evento debe crearse antes de empezar y de terminar, y debe empezar antes de terminar; el formulario dice qué regla incumple una hora.

Una tarea revisa las plantillas recurrentes cada minuto. Cuando llega la próxima hora de una plantilla, crea el evento y adelanta esa hora al próximo evento de la programación. La lista de plantillas muestra esa hora en su columna **Evento recurrente**, y **No** para una plantilla que no se repite. Un evento creado por la programación es como cualquier otro: se ejecutan sus reglas, se añaden sus propietarios y sus suscriptores se enteran de que está programado.

## Cambiar o detener una plantilla

Abre una plantilla desde la lista para ver su página:

- **Detalles de la plantilla de mantenimiento programado** muestra con qué empiezan los eventos nuevos. Su **Editar** recorre **Información de la plantilla**, **Detalles del mantenimiento**, **Páginas de estado** y **Recurrente**, y luego **Primer evento** para una plantilla que se repite.
- **Recursos afectados** contiene sus **Monitores**, su **Cambiar el estado del monitor a** y sus **Otros recursos afectados**, con su propio **Editar**.
- **Propietarios** lista las personas y los equipos a los que pertenece cada evento programado a partir de ella.

Los cambios se aplican a los eventos creados después de guardarlos; los eventos ya creados conservan sus propios valores. Para detener una programación, desactiva **Evento recurrente** en **Editar**, o elimina la plantilla. Una plantilla desactivada conserva su programación: vuelve a activarla y retoma la próxima hora de la programación, saltándose las horas en que estuvo desactivada. Eliminar una plantilla deja los eventos que creó.

## Solución de problemas

:::details Al crear una plantilla recurrente dice que una hora debería estar en el futuro
Las tres primeras horas deben ser posteriores al momento actual cuando la creas. Adelántalas: la programación continúa después a partir del primer evento.
:::

:::details Una plantilla recurrente no creó ningún evento
Comprueba que **Evento recurrente** sigue activado y mira la hora en la columna **Evento recurrente** de la lista: el evento se crea entonces, no en su inicio. La tarea se ejecuta cada minuto, así que espera un minuto.
:::

:::details Los eventos de una plantilla recurrente llegan una hora antes o después tras el cambio de hora
Abre la plantilla y revisa su **Zona horaria**: sus eventos mantienen la hora del día del primer evento en esa zona horaria. Una plantilla creada antes de que las plantillas tuvieran zona horaria muestra **UTC**: elige la zona horaria en la que se pensaron sus horas. Los eventos ya creados conservan sus horas.
:::

:::details A un evento creado con una plantilla le falta un recurso que elegí
En **Otros recursos afectados**, una plantilla admite hosts, clústeres de Kubernetes, hosts de Docker, hosts de Podman y servicios. Añade otros tipos de recursos al propio evento, con **Editar** en su tarjeta **Recursos afectados**.
:::

## Próximos pasos

:::cards
- [Crear eventos de mantenimiento](/docs/scheduled-maintenance/creating-events): El formulario que rellena una plantilla.
- [Estados del mantenimiento](/docs/scheduled-maintenance/states): Cómo avanza cada evento una vez creado.
- [Reglas y ajustes del mantenimiento](/docs/scheduled-maintenance/settings): Añade propietarios y etiquetas a cada evento nuevo automáticamente.
- [Visión general del mantenimiento programado](/docs/scheduled-maintenance/index): Dónde encajan las plantillas en el resto del mantenimiento.
:::
