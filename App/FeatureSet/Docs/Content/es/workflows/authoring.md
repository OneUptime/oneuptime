# Crear un flujo de trabajo

Para crear un flujo de trabajo, abre **Flujos de Trabajo** y haz clic en **Crear flujo de trabajo**. Se abre un asistente, **Create a workflow**, que te lleva de la mano: primero **Start from** — elige **Start from scratch** o una de las plantillas —, luego **Name**, y por último un paso **Configure**, que solo aparece si la plantilla que elegiste pide ajustes propios.

Una vez creado, abre **Constructor** en el menú izquierdo. Ese es el lienzo donde diseñas el flujo de trabajo.

## El lienzo

Un flujo de trabajo empezado desde cero se abre con un único bloque punteado que dice **Please click here to add trigger**. Ese bloque es el punto de partida — haz clic en él para elegir un disparador. Un flujo de trabajo creado a partir de una plantilla se abre con sus bloques ya colocados.

Todo flujo de trabajo tiene exactamente un **disparador** arriba del todo. Lo demás son **componentes**, y cada uno hace algo. Si añades un segundo disparador, sustituye al primero; si eliminas el último, vuelve el bloque punteado.

Para añadir bloques:

- **El disparador** — haz clic en el bloque punteado. Se abre un panel titulado **Add Trigger**.
- **Todo lo demás** — haz clic en **Añadir componente** en la barra de herramientas, encima del lienzo. Se abre ese mismo panel, ahora titulado **Add Component**.

Los dos paneles tienen buscador — pulsa `/` para saltar al cuadro de búsqueda — y están agrupados por categoría. Selecciona un bloque y haz clic en **Add to Workflow**.

Los bloques nuevos aparecen siempre en el mismo punto del lienzo, así que uno recién añadido puede caer encima de otro que ya habías colocado. Arrástralo a un hueco libre; el lienzo se ajusta a una cuadrícula mientras lo mueves. Las posiciones se guardan, de modo que la siguiente persona verá la misma disposición que dejaste tú.

Los cambios se guardan solos. Una píldora en la barra de herramientas te lo cuenta: **Saving…** mientras el cambio va en camino, después **Saved**, o **Could not save** si algo falló. No hay botón de guardar ni un paso de publicación aparte.

## Qué hay en un bloque

| Campo                         | Qué hace                                                                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identifier** (en **ID**) | El id corto que se ve en el bloque, tipo `log-1`. Es el nombre con el que los demás bloques se refieren a este, así que cambiarlo rompe todas las referencias `{{local.components.…}}` que apunten aquí. El encabezado del bloque es el nombre propio del componente y no se puede cambiar. |
| **Settings**                  | Lo que el bloque necesita para hacer su trabajo — una URL, un canal de Slack, el texto de un mensaje. Los campos opcionales llevan la etiqueta **(Optional)**; el resto son obligatorios. Los ajustes menos frecuentes están detrás de un desplegable **Advanced**. |
| **Input**                     | El punto del borde superior, por donde entran las líneas que vienen de bloques anteriores. Los disparadores no lo tienen — nada se ejecuta antes que ellos.                                                                                       |
| **Outputs**                   | Los puntos del borde inferior, con su etiqueta justo encima, por donde salen las líneas hacia los bloques siguientes. Muchos bloques tienen salidas **Success** y **Error** separadas para que puedas atender los dos casos.                  |

## Conectar bloques

Arrastra desde un punto de la parte inferior de un bloque hasta el punto de la parte superior del siguiente. La línea que dibujas decide qué se ejecuta después.

- Si conectas desde **Success**, el bloque siguiente solo se ejecuta cuando el anterior salió bien.
- Si conectas desde **Error**, el bloque siguiente solo se ejecuta cuando el anterior falló.
- Si dejas una salida sin conectar, ese camino simplemente termina ahí.

Puedes conectar una misma salida a varios bloques. Se ejecutan todos, pero uno detrás de otro, en una única cola, no en paralelo. No des por hecho un orden entre ramas ni cuentes con que se solapen en el tiempo. Cada bloque se ejecuta como mucho una vez por ejecución, así que volver con una línea a un bloque anterior no lo ejecuta dos veces.

## Configurar un bloque

Haz clic en un bloque para abrir sus ajustes en un diálogo. Cada ajuste tiene el tipo de campo que le corresponde — texto, desplegables, editores de código, interruptores, y así. Rellénalo y haz clic en **Guardar**.

En ese mismo diálogo encuentras:

- **Eliminar** — quita este bloque.
- **Run just this step** — ejecuta solo este bloque, sin el resto del flujo de trabajo. Los valores que habría leído de otros pasos llegan vacíos, y todo lo que envíe, escriba o elimine ocurre de verdad.
- **Documentación**, **Inputs**, **Outputs** y **Returns** — fichas de referencia con lo que este bloque espera y lo que produce.

Casi todos los campos de texto aceptan variables — así es como fluyen los datos de un bloque al siguiente. En vez de escribir la sintaxis a mano, usa el selector de valores del editor: construye una referencia correcta a partir del bloque y el campo que elijas. Consulta [Variables de flujo de trabajo](/docs/workflows/variables).

## Comprobaciones mientras construyes

El Constructor revisa el grafo entero cada vez que lo cambias e informa de lo que encuentra en una píldora de la barra de herramientas. Haz clic en la píldora para abrir **Problems with this workflow**, que enumera cada problema y te lleva al bloque responsable. Los bloques con algún problema llevan además un distintivo rojo en el lienzo.

Detecta los fallos que, si no, no ves hasta que una ejecución sale mal — que no haya disparador, que dos bloques compartan id, que un id lleve un punto, que un bloque no esté conectado a nada, que un ajuste obligatorio esté vacío, JSON mal formado, espacios dentro de `{{ }}` y referencias a un paso o a un valor de retorno que no existe.

Hay una cosa que no puede comprobar: si un nombre de variable existe. Una variable renombrada solo se delata en el registro de la ejecución.

## Tu primer flujo de trabajo

La forma más rápida de cogerle el pulso al lienzo:

1. Haz clic en el bloque punteado, elige **Manual** en el panel **Add Trigger** y haz clic en **Add to Workflow**.
2. Haz clic en **Añadir componente**, elige **Log** (dentro de **Utils**) y haz clic en **Add to Workflow**. Aparta el bloque nuevo del disparador y conecta el punto **Execute** del disparador con el punto de entrada del bloque Log.
3. Abre el bloque Log y pon en su **Valor** `Hello from {{local.components.manual-1.returnValues.value.name}}`. `manual-1` es el **Identifier** del disparador, visible en su bloque — comprueba que coincide.
4. Ve a **Vista General**, haz clic en **Editar flujo de trabajo** en la tarjeta **Detalles del flujo de trabajo** y activa **Habilitado**. Un flujo de trabajo deshabilitado no se puede ejecutar de ninguna manera, ni siquiera a mano.
5. Vuelve al **Constructor**, haz clic en **Ejecutar flujo de trabajo**, pon `{ "name": "Ada" }` en el campo **JSON**, haz clic en **Run Workflow Manually** y confirma con **Run**.
6. Se abre solo un panel **Workflow Run** que sigue la ejecución. El registro muestra `Value:` seguido de `Hello from Ada`.

Ese ciclo — añadir, conectar, configurar, ejecutar y leer el registro — es como construirás todos tus flujos de trabajo.

## Encenderlo

Los flujos de trabajo nuevos nacen deshabilitados, y también los que duplicas o importas.

El interruptor **Habilitado** está en la página **Vista General** del flujo de trabajo, dentro de la tarjeta **Detalles del flujo de trabajo** — no en la página de ajustes. Esa misma tarjeta muestra el estado actual como una píldora verde **Habilitado** o roja **Deshabilitado**.

Un flujo de trabajo deshabilitado no se ejecuta en absoluto. Las ejecuciones manuales se rechazan con «This workflow is not enabled» igual que las disparadas, así que el orden es: habilítalo, pruébalo con **Ejecutar flujo de trabajo**, lee el registro de la ejecución y vuelve a apagar **Habilitado** si aún no quieres que su disparador salte. Para probar un solo bloque sin ejecutar todo lo demás, usa **Run just this step** en los ajustes de ese bloque.

Para pausar un flujo de trabajo sin eliminarlo, apaga **Habilitado**. No arranca ninguna ejecución nueva. Una ejecución que esté a medias termina, pero una que esté aparcada en un bloque **Sleep** se cancela al despertar y queda registrada como error.

## Poner orden

- Arrastra los bloques para moverlos. La disposición se guarda.
- Para eliminar una línea, arrastra cualquiera de sus extremos fuera del punto y suéltalo en una zona vacía del lienzo.
- Para eliminar un bloque, haz clic en él y usa **Eliminar** al final de su diálogo de ajustes. Seleccionar un bloque o una línea y pulsar Retroceso también los quita.
- No hay forma de duplicar un bloque suelto. **Duplicate Workflow**, en la página **Ajustes** del flujo de trabajo, copia el conjunto entero, y la copia nace deshabilitada.
- Apila los bloques de arriba abajo para que se lean en el mismo orden en que se ejecutan — las entradas están en el borde superior y las salidas en el inferior, así que el flujo baja de forma natural.

## Qué leer a continuación

- [Disparadores de flujo de trabajo](/docs/workflows/triggers) — las cuatro formas de arrancar un flujo de trabajo.
- [Componentes de flujo de trabajo](/docs/workflows/components) — todos los bloques que puedes añadir.
- [Variables de flujo de trabajo](/docs/workflows/variables) — mover datos entre bloques.
- [Ejecuciones y registros de flujo de trabajo](/docs/workflows/runs-and-logs) — comprobar qué pasó.
