# Crear un flujo de trabajo

Para crear un flujo de trabajo, abre **Flujos de Trabajo** y haz clic en **Crear flujo de trabajo**. Un asistente llamado **Create a workflow** te guía por el proceso: primero **Start from** — elige **Start from scratch** o una de las plantillas — luego **Name**, y finalmente un paso **Configure**, que solo aparece cuando la plantilla que elegiste pide ajustes propios.

Una vez creado, abre **Constructor** en el menú izquierdo. Ese es el lienzo donde diseñas el flujo de trabajo.

## El lienzo

Un flujo de trabajo desde cero se abre con un único bloque punteado que dice **Please click here to add trigger**. Ese bloque es el punto de partida — haz clic en él para elegir un disparador. Un flujo de trabajo creado a partir de una plantilla se abre con sus bloques ya colocados.

Todo flujo de trabajo tiene exactamente un **disparador** en la parte superior. Todo lo demás es un **componente** que hace algo. Añadir un segundo disparador reemplaza al primero, y eliminar el último vuelve a colocar el marcador de posición punteado.

Añadir bloques:

- **El disparador** — haz clic en el bloque marcador de posición punteado. Se abre un panel titulado **Add Trigger**.
- **Todo lo demás** — haz clic en **Añadir componente** en la barra de herramientas sobre el lienzo. Se abre el mismo panel, titulado **Add Component**.

Ambos paneles se pueden buscar — pulsa `/` para saltar al cuadro de búsqueda — y están agrupados por categoría. Selecciona un bloque y haz clic en **Add to Workflow**.

Los bloques nuevos siempre aterrizan en el mismo lugar del lienzo, así que uno nuevo puede caer encima de algo que ya colocaste. Arrástralo para despejarlo; el lienzo se ajusta a una cuadrícula a medida que lo mueves. Las posiciones de los bloques se guardan, así que la siguiente persona ve la misma disposición que dejaste.

Los cambios se guardan automáticamente. Una píldora en la barra de herramientas lo indica: **Saving…** mientras el cambio está en curso, luego **Saved**, o **Could not save** si no funcionó. No hay botón de guardar ni un paso de publicación aparte.

## Qué hay en un bloque

| Campo                         | Qué hace                                                                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identifier** (bajo **ID**) | El id corto que se muestra en el bloque, como `log-1`. Así es como otros bloques se refieren a este, así que renombrarlo rompe cualquier referencia `{{local.components.…}}` que apunte a él. El encabezado del bloque es el propio nombre del componente y no se puede cambiar. |
| **Settings**                  | Lo que el bloque necesita para hacer su trabajo — una URL, un canal de Slack, un cuerpo de mensaje. Los campos opcionales están etiquetados como **(Optional)**; todo lo demás es obligatorio. Los ajustes menos usados están detrás de un desplegable **Advanced**. |
| **Input**                     | El punto en el borde superior, donde entran las líneas de los bloques anteriores. Los disparadores no tienen uno — nada se ejecuta antes de ellos.                                                                                       |
| **Outputs**                   | Los puntos a lo largo del borde inferior, etiquetados justo encima de ellos, donde salen las líneas hacia los siguientes bloques. Muchos bloques tienen salidas **Success** y **Error** separadas para que puedas manejar ambos casos.                  |

## Conectar bloques

Arrastra desde un punto en la parte inferior de un bloque hasta el punto en la parte superior del siguiente. La línea que dibujas decide qué se ejecuta a continuación.

- Si conectas desde **Success**, el siguiente bloque solo se ejecuta cuando el anterior funcionó.
- Si conectas desde **Error**, el siguiente bloque solo se ejecuta cuando el anterior falló.
- Si no conectas una salida, ese camino simplemente se detiene.

Puedes conectar una salida a varios bloques. Todos se ejecutan — pero uno tras otro, en una sola cola, no en paralelo. No confíes en el orden entre ramas, ni cuentes con que se superpongan en el tiempo. Cada bloque se ejecuta como máximo una vez por ejecución, así que un bucle que vuelva a un bloque anterior no lo ejecutará dos veces.

## Configurar un bloque

Haz clic en un bloque para abrir sus ajustes en un diálogo. Cada ajuste tiene el tipo de entrada adecuado — campos de texto, listas desplegables, editores de código, interruptores, etc. Rellénalo y haz clic en **Guardar**.

El mismo diálogo es donde encuentras:

- **Eliminar** — elimina este bloque.
- **Run just this step** — ejecuta este bloque solo, sin el resto del flujo de trabajo. Los valores que habría leído de otros pasos llegan vacíos, y cualquier cosa que envíe, escriba o elimine realmente ocurre.
- **Documentación**, **Inputs**, **Outputs** y **Returns** — fichas de referencia sobre lo que este bloque espera y produce.

La mayoría de los campos de texto aceptan variables — así es como fluyen los datos de un bloque a otro. En lugar de escribir la sintaxis a mano, usa el selector de valores en el editor: construye una referencia correcta a partir del bloque y el campo que elijas. Consulta [Variables de flujo de trabajo](/docs/workflows/variables).

## Comprobaciones mientras construyes

El Constructor comprueba todo el gráfico cada vez que lo cambias, y muestra lo que encuentra en una píldora en la barra de herramientas. Haz clic en la píldora para abrir **Problems with this workflow**, que lista cada problema y te lleva al bloque responsable. Los bloques con un problema también llevan una insignia roja en el lienzo.

Detecta los errores que de otro modo serían invisibles hasta que una ejecución sale mal — sin disparador, dos bloques que comparten un id, un punto dentro de un id, un bloque al que nada conecta, un ajuste obligatorio dejado vacío, JSON mal formado, espacios dentro de `{{ }}`, y referencias a un paso o valor de retorno que no existe.

Una cosa que no puede comprobar: si existe un nombre de variable. Una variable renombrada solo aparece en el registro de ejecución.

## Tu primer flujo de trabajo

La forma más rápida de familiarizarte con el lienzo:

1. Haz clic en el bloque marcador de posición punteado, elige **Manual** en el panel **Add Trigger**, y haz clic en **Add to Workflow**.
2. Haz clic en **Añadir componente**, elige **Log** (bajo **Utils**), y haz clic en **Add to Workflow**. Arrastra el bloque nuevo lejos del disparador, luego conecta el punto **Execute** del disparador hacia abajo con el punto de entrada del bloque Log.
3. Abre el bloque Log y configura su **Value** como `Hello from {{local.components.manual-1.returnValues.value.name}}`. `manual-1` es el **Identifier** del disparador, mostrado en el bloque del disparador — comprueba que coincide.
4. Ve a **Vista General**, haz clic en **Editar flujo de trabajo** en la tarjeta **Detalles del flujo de trabajo**, y activa **Habilitado**. Un flujo de trabajo deshabilitado no puede ejecutarse en absoluto, ni siquiera manualmente.
5. De vuelta en el **Constructor**, haz clic en **Ejecutar flujo de trabajo**, pon `{ "name": "Ada" }` en el campo **JSON**, haz clic en **Run Workflow Manually**, y confirma con **Run**.
6. Se abre por sí solo un panel de **Workflow Run** y sigue la ejecución. El registro muestra `Value:` seguido de `Hello from Ada`.

Ese ciclo — añadir, conectar, configurar, ejecutar, leer el registro — es como construirás cada flujo de trabajo.

## Activarlo

Los flujos de trabajo nuevos comienzan deshabilitados, y también cualquier flujo de trabajo que dupliques o importes.

El interruptor **Habilitado** está en la página **Vista General** del flujo de trabajo, en la tarjeta **Detalles del flujo de trabajo** — no en la página de Ajustes. La misma tarjeta muestra el estado actual como una píldora verde **Enabled** o roja **Disabled**.

Un flujo de trabajo deshabilitado no puede ejecutarse en absoluto. Las ejecuciones manuales se rechazan con "This workflow is not enabled" igual que las disparadas, así que el orden es: habilítalo, pruébalo con **Ejecutar flujo de trabajo**, lee el registro de ejecución, y vuelve a desactivar **Habilitado** si no estás listo para que se dispare su disparador. Para probar un solo bloque sin ejecutar todo el flujo de trabajo, usa **Run just this step** en los ajustes de ese bloque.

Para pausar un flujo de trabajo sin eliminarlo, desactiva **Habilitado**. No empiezan ejecuciones nuevas. Una ejecución que está a mitad de camino termina, pero una que está detenida en un bloque **Sleep** se cancela cuando despierta y se registra como un error.

## Ordenando

- Arrastra los bloques para moverlos. La disposición se guarda.
- Para eliminar una línea, arrastra cualquiera de sus extremos fuera del punto y suéltalo en el lienzo vacío.
- Para eliminar un bloque, haz clic en él y usa **Eliminar** al final de su diálogo de ajustes. Seleccionar un bloque o una línea y pulsar Retroceso también lo elimina.
- No hay forma de duplicar un solo bloque. **Duplicate Workflow** en la página **Ajustes** del flujo de trabajo copia todo el conjunto, y la copia aterriza deshabilitada.
- Apila los bloques de arriba a abajo para que se lean en la dirección en que se ejecutan — las entradas están en el borde superior, las salidas en el inferior, así que el flujo va naturalmente hacia abajo.

## Dónde leer a continuación

- [Disparadores de flujo de trabajo](/docs/workflows/triggers) — las cuatro formas en que un flujo de trabajo puede iniciarse.
- [Componentes de flujo de trabajo](/docs/workflows/components) — cada bloque que puedes añadir.
- [Variables de flujo de trabajo](/docs/workflows/variables) — moviendo datos entre bloques.
- [Ejecuciones y registros de flujo de trabajo](/docs/workflows/runs-and-logs) — comprobando qué ocurrió.
