# Alertas e incidentes de tasa de consumo

Los presupuestos de errores te dicen dónde estás; las reglas de tasa de consumo te dicen cuándo levantarte. Cuando un SLO gasta su presupuesto de errores lo bastante rápido como para importar, una regla de tasa de consumo genera una alerta, declara un incidente o ambas cosas, con tu propio título y descripción, gravedad, propietarios, etiquetas, escalado de guardia y notificaciones del espacio de trabajo.

:::cards
- [Cómo decide una regla](#cómo-decide-una-regla-si-se-activa): Dos ventanas, ambas por encima del umbral.
- [Reglas predeterminadas](#reglas-predeterminadas): Fast burn, Slow burn y Slow leak, ajustadas a la ventana del SLO.
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

Para actuar en cambio según cuánto presupuesto queda, por ejemplo publicar solo trabajo de fiabilidad cuando queda una cuarta parte, dale al SLO una [política de presupuesto de errores](/docs/slo/error-budget-policy).

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

Una regla no puede activarse hasta que el SLO tenga una ventana larga completa de historial de supervisión: si no, la primera comprobación fallida de un monitor, dividida entre unos pocos minutos de historial, daría una tasa de consumo enorme. Así que un SLO nuevo no puede activar su regla **Fast burn** durante su primera hora, ni su regla **Slow burn** durante las seis primeras, ni su regla **Slow leak** durante sus tres primeros días. Si más adelante un SLO deja de tener tanto historial, por ejemplo después de cambiar sus monitores por otros nuevos, la regla resuelve lo que tiene abierto en lugar de dejarlo colgado. Una regla tampoco se activa mientras alguno de los monitores del SLO esté en un mantenimiento programado: consulta [Mantenimiento programado](#mantenimiento-programado).

## Reglas predeterminadas

Cada SLO nuevo recibe tres reglas de tasa de consumo. Para una ventana de 30 días:

| Regla | Umbral | Ventana larga | Ventana corta | Se activa cuando |
| --- | --- | --- | --- | --- |
| **Fast burn** | 14.4× | 1 hora | 5 minutos | Se consume alrededor del 2 % del presupuesto en una hora: se agotaría en unos 2 días. |
| **Slow burn** | 6× | 6 horas | 30 minutos | Se consume alrededor del 5 % del presupuesto en seis horas: se agotaría en unos 5 días. |
| **Slow leak** | 1× | 3 días | 6 horas | Se consume alrededor del 10 % del presupuesto en tres días: se agotaría al final de la ventana. |

Fast burn y Slow burn sirven para avisar a alguien: generan una alerta con la gravedad de alerta más alta del proyecto. Slow leak sirve como ticket: genera su alerta con la gravedad de alerta más baja del proyecto. Detecta un consumo constante que nunca llega al umbral de las otras dos: a 3×, el presupuesto de un SLO del 99,9 % se agota en 10 días y, aun así, solo se activa Slow leak. Cuando su alerta se resuelve, espera 24 horas, no su ventana larga de 3 días, antes de generar otra.

Los umbrales están calculados para un presupuesto de 30 días, así que OneUptime los ajusta a la ventana de tu SLO. Fast burn y Slow burn significan siempre «el 2 % del presupuesto en 1 hora» y «el 5 % del presupuesto en 6 horas»:

| Ventana del SLO | Umbral de Fast burn | Umbral de Slow burn |
| --- | --- | --- |
| 7 días | 3.36× | 1.4× |
| 28 días | 13.44× | 5.6× |
| 30 días | 14.4× | 6× |
| 90 días | 43.2× | 18× |

Slow leak significa siempre «el 10 % del presupuesto en su ventana larga». En una ventana de 30 días o más, sus ventanas siguen siendo de 3 días y 6 horas y su umbral crece con la ventana. En una ventana más corta, su ventana larga es una décima parte de la ventana del SLO y su ventana corta, una duodécima parte de esa, así que su umbral se queda en 1×. Si su ventana larga se quedara en 3 días, su umbral bajaría de 1× y se activaría en un SLO que va camino de cumplir su objetivo.

| Ventana del SLO | Umbral de Slow leak | Ventana larga | Ventana corta |
| --- | --- | --- | --- |
| 7 días | 1× | 16,8 horas | 84 minutos |
| 28 días | 1× | 2,8 días | 5,6 horas |
| 30 días | 1× | 3 días | 6 horas |
| 90 días | 3× | 3 días | 6 horas |

Los SLO de mes natural reciben los valores de 30 días. Las reglas usan el título y la descripción integrados, resuelven sus alertas automáticamente y no añaden propietarios ni etiquetas. Ninguna de ellas declara un incidente, así que actualizar OneUptime nunca empieza a declarar incidentes por ti. Edítalas, elimínalas o añade las tuyas.

### Añadir las reglas recomendadas a un SLO existente

Los SLO creados antes de que existiera Slow leak solo tienen Fast burn y Slow burn: actualizar OneUptime nunca añade por su cuenta una regla que empezaría a generar alertas. Mientras a un SLO le falte una de las tres reglas predeterminadas, su página **Reglas de tasa de consumo** las nombra en un aviso sobre la tabla. Haz clic en **Agregar reglas recomendadas** en el aviso para ver exactamente lo que añade, ajustado a la ventana del SLO, y confirma. Solo añade las reglas que faltan, y volver a hacer clic no añade nada.

Una regla cuenta como existente cuando el SLO tiene una regla con el mismo nombre, o una con la misma ventana larga, esté activada o no. Así, una regla predeterminada que hayas renombrado o ajustado nunca se añade dos veces. Para que el aviso deje de ofrecer una regla predeterminada que no quieres, conserva la regla y deshabilítala en lugar de eliminarla. Necesitas permiso para crear reglas de tasa de consumo de SLO. Cada regla que se añade así se publica en el feed del SLO y queda en sus registros de auditoría, como una regla que creas tú.

### Añadirlas a muchos SLO a la vez

Para dar las reglas recomendadas a muchos SLO, empieza por la lista de SLO en lugar de por la página de cada SLO.

:::steps
#### Seleccionar los SLO

Abre **SLO** y selecciona los SLO que quieras actualizar. Para tomar todos los SLO que muestra un filtro, selecciona la página entera y luego todas las coincidencias que ofrece la lista.

#### Elegir la acción masiva

Abre **Acciones masivas** y elige **Agregar reglas recomendadas**.

#### Revisar lo que añade y confirmar

Antes de añadir nada, la confirmación cuenta cuántos de los SLO seleccionados reciben cada regla, ajustada a sus propias ventanas. Cuando varios SLO con ventanas distintas reciben una regla en variantes distintas, como Slow leak en un SLO de 7 días y en uno de 30 días, muestra cada variante con su umbral, sus ventanas y los SLO que la reciben. También indica cuántos tienen ya todas las reglas recomendadas y cuántos no se pudieron leer. Haz clic en **Agregar reglas recomendadas** para añadirlas.
:::

Cada SLO recibe solo las reglas que le faltan, exactamente como las añadiría su propia página **Reglas de tasa de consumo**: la misma comprobación de lo que cuenta como existente, y un elemento en el feed y una entrada en los registros de auditoría por cada regla. El resultado indica, para cada SLO, si se añadieron reglas, si ya tenía todas las reglas recomendadas o si no se cambió y por qué, por ejemplo un SLO que no tienes permiso para cambiar. Un SLO sin cambios no detiene nunca a los demás, y volver a ejecutar la acción sobre los mismos SLO no añade nada. Los SLO archivados no están en la lista y nunca se les ofrecen las reglas, porque no se evalúan: desarchiva primero el SLO.

Los scripts pueden hacer lo mismo a través de la API, con una [clave de API](/docs/api-reference/api-reference) del proyecto. Las solicitudes para un solo SLO reciben `{ "serviceLevelObjectiveId": "..." }` y responden con las reglas en `rules`. Las solicitudes masivas reciben `{ "serviceLevelObjectiveIds": ["..."] }`, como máximo 100 SLO por solicitud, y responden con una entrada por cada SLO en `results`, en el orden pedido:

| Solicitud | Qué hace |
| --- | --- |
| `POST /api/service-level-objective-burn-rate-rule/recommended-rules` | Muestra las reglas recomendadas que le faltan al SLO. No guarda nada. |
| `POST /api/service-level-objective-burn-rate-rule/recommended-rules/add` | Las añade y muestra lo que añadió. Volver a pedirlo no añade nada. |
| `POST /api/service-level-objective-burn-rate-rule/recommended-rules/bulk` | Indica qué le falta a cada SLO: `Missing` con las reglas, `NothingMissing` o `Refused` para un SLO que no tienes permiso para leer. No guarda nada. |
| `POST /api/service-level-objective-burn-rate-rule/recommended-rules/bulk/add` | Añade lo que le falta a cada SLO, un SLO tras otro: `Added` con las reglas, `NothingMissing`, `Refused` o `Failed` con las reglas añadidas antes del fallo. Volver a pedirlo solo añade lo que aún falta. |

## Crear o editar una regla

Necesitas permiso para crear reglas de tasa de consumo de SLO.

:::steps
### Abrir Reglas de tasa de consumo

Abre el SLO, ve a **Reglas de tasa de consumo** en la sección **Reglas** de su menú lateral y haz clic en **Crear Regla de tasa de consumo del SLO**, o edita una de las reglas predeterminadas.

### Ponerle nombre a la regla

En **Regla**, escribe un **Nombre**, como «Fast burn». Una regla nueva está activada; para que deje de dispararse más adelante, desactiva **Habilitado** en su formulario de edición.

### Fijar la ventana de consumo

En **Ventana de consumo**, fija el **Umbral de tasa de consumo** (por ejemplo `14.4`), la **Ventana larga (minutos)** y la **Ventana corta (minutos)**, y si quieres la **Supresión de nueva activación (minutos)**.

### Elegir qué declara

En **Qué declara**, responde a **Cuando se dispara**: **Crear una alerta**, la opción predeterminada, **Declarar un incidente** o **Ambos**. **Añadir propietarios del SLO como propietarios** convierte además a los propietarios del SLO en propietarios de todo lo que crea la regla.

### Describir la alerta y el incidente

Los pasos **Alerta** e **Incidente** solo aparecen para lo que declara la regla. Cada uno tiene un título y una gravedad, y secciones plegadas: **Descripción**, **Propiedad y etiquetas**, **Guardia** y **Más campos**, que contiene la resolución automática, la privacidad y las notas de corrección. Las reglas nuevas empiezan con el título y la descripción integrados, listos para editar. Haz clic en **Crear Regla de tasa de consumo del SLO** en el último paso.
:::

OneUptime comprueba los números de una regla al guardarla:

| Ajuste | Debe ser |
| --- | --- |
| **Umbral de tasa de consumo** | Mayor que 0. |
| **Ventana corta (minutos)** | Mayor que 0. |
| **Ventana larga (minutos)** | Más larga que la ventana corta. |
| **Supresión de nueva activación (minutos)** | 0 o más. Vacío significa la duración de la ventana larga. |

Cada respuesta a **Cuando se dispara** abre algo. La API rechaza una regla que no crearía ninguna alerta ni declararía ningún incidente, porque se comprobaría en cada evaluación sin declarar nunca nada.

La tabla de reglas muestra, para cada regla, su umbral, sus ventanas y su supresión, qué declara (y si la alerta o el incidente solo se resuelve a mano, o es privado), sus gravedades, políticas de guardia, propietarios y etiquetas.

> [!TIP]
> Un buen comienzo: conserva las tres reglas predeterminadas, envía la regla de consumo rápido a tu política de guardia que avisa con una gravedad alta, deja que la regla de consumo lento genere una alerta de gravedad más baja para el horario laboral, y mantén la regla de fuga lenta como un ticket para el equipo responsable. Si tu equipo lo gestiona todo con incidentes, elige **Declarar un incidente** para la regla de consumo rápido, o **Ambos** para recibir también una alerta.

## Qué declara una regla

|  | **Alerta** | **Incidente** |
| --- | --- | --- |
| Lo abre | **Crear una alerta**, la opción predeterminada, o **Ambos** | **Declarar un incidente** o **Ambos** |
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
| `{{policyTier}}` | Nombre del nivel de la política de presupuesto de errores en el que está el SLO tras esta evaluación. "None" cuando no está en ningún nivel. | `Reliability first` |
| `{{policyTierThresholdPercentage}}` | Umbral de presupuesto restante de ese nivel, como porcentaje. Vacío cuando el SLO no está en ningún nivel. | `25` |
| `{{policyTierWhatWeDo}}` | Lo que el equipo acordó hacer en ese nivel, tal como está escrito en el nivel. Vacío cuando el SLO no está en ningún nivel. | `Only reliability work and critical fixes ship.` |

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
- **Supresión de nuevas activaciones.** Después de que un registro se resuelve, la regla no vuelve a declarar ese tipo de registro durante el periodo de supresión, de forma predeterminada la duración de la ventana larga. Así un sistema que se recupera tiene margen para hacerlo sin avisar por el ruido que queda. Slow leak se crea con 24 horas en lugar de su ventana larga de 3 días, así que una fuga que reaparece vuelve a señalarse al día siguiente.

Algunos cambios siempre resuelven lo que una regla tiene abierto, digan lo que digan sus ajustes de resolución automática, para que nada siga escalando por una regla que ya no puede justificarlo:

- cambiar **Cuando se dispara** para quitar la alerta o el incidente cierra lo que abrió esa salida;
- desactivar la regla o eliminarla;
- desactivar la evaluación del SLO, archivar el SLO o eliminarlo;
- que el SLO pase a **Pausado** o **Mal configurado**, porque entonces no mide nada;
- que la regla pierda su umbral o sus ventanas, o que el SLO deje de tener una ventana larga completa de historial.

## Mantenimiento programado

Mientras algún monitor del SLO esté en un evento de mantenimiento en curso, sus reglas de tasa de consumo no generan alertas ni declaran incidentes: el trabajo planificado no debería avisar a nadie. Lo que las reglas ya tienen abierto se sigue resolviendo como siempre. El tiempo sigue contando para el presupuesto de errores, según los estados de inactividad del SLO.

## El feed del SLO

El **Feed** del SLO publica cada alerta que genera una regla y cada incidente que declara, con un enlace y las tasas de consumo que lo explican, y cuándo se resuelve cada uno, automáticamente o a mano. Un registro que la regla vuelve a tomar porque seguía abierto no se publica dos veces. Crear, cambiar y eliminar una regla también se publica, y queda en los **Registros de auditoría** del SLO. Consulta [Feed y registros de auditoría de SLO](/docs/slo/feed-and-audit-logs).

## Solución de problemas

:::details Una regla no se activó justo después de crear el SLO
Una regla solo se activa cuando el SLO tiene una ventana larga completa de historial de supervisión: una hora para la regla de consumo rápido predeterminada, seis horas para la de consumo lento y tres días para la de fuga lenta, o una décima parte de la ventana del SLO cuando esta dura menos de 30 días.
:::

:::details Una alerta se resolvió mientras la caída seguía
La resolución automática sigue a la ventana larga: en cuanto la tasa de consumo de la ventana larga baja del umbral, la alerta se resuelve. Dale a la regla una ventana larga más larga, o desactiva **Resolver alerta automáticamente** y resuelve la alerta a mano.
:::

:::details No se activó nada durante un evento de mantenimiento
Las reglas de tasa de consumo permanecen en silencio mientras alguno de los monitores del SLO esté en un evento de mantenimiento en curso. El tiempo de inactividad sigue contando para el presupuesto.
:::

:::details ¿Hay un número mínimo de muestras?
No para los SLO que se miden con la disponibilidad de los monitores. La disponibilidad se mide en segundos, así que cada segundo de la ventana es una muestra y no hay casos de poco tráfico de los que protegerse. Un número mínimo de muestras solo importa para los SLI basados en eventos, que todavía no están disponibles.
:::

## Próximos pasos

:::cards
- [Presupuestos de errores](/docs/slo/error-budget): Qué es el presupuesto y cuánto dura.
- [Política de presupuesto de errores](/docs/slo/error-budget-policy): Actúa según cuánto presupuesto queda, nivel a nivel.
- [Reglas de escalado](/docs/on-call/escalation-rules): A quién se avisa y en qué orden.
- [Feed y registros de auditoría de SLO](/docs/slo/feed-and-audit-logs): Cada alerta e incidente que generó una regla.
:::
