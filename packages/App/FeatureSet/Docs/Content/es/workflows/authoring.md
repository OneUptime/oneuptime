# Crear un flujo de trabajo

Para crear un flujo de trabajo, abre **Flujos de Trabajo** y haz clic en **Crear flujo de trabajo**. El diálogo **Crear un flujo de trabajo** te pregunta primero cómo quieres empezar y después un nombre. Una plantilla que necesita ajustes propios, como la URL de un webhook de Slack, te los pide en un paso más.

Elige cómo empezar:

- **Empezar desde cero**, arriba del todo en el diálogo, te da un lienzo vacío. Es por donde empiezan la mayoría de los flujos de trabajo.
- **O empieza con una plantilla** muestra unas pocas plantillas **Recomendadas**. Para ver las demás, elige una categoría junto al cuadro de búsqueda, como **Incidentes**, **Monitores** o **Jira**, o **Todas las plantillas**, o escribe en **Buscar plantillas…**. Cada palabra que escribas tiene que coincidir.

Haz clic en una plantilla para ver qué hace: su disparador, los bloques que la forman y los ajustes que te pedirá. Después haz clic en **Usar esta plantilla**, o haz doble clic en la plantilla. En el cuadro de búsqueda, las flechas eligen una plantilla y **Enter** la usa. `/` te devuelve al cuadro de búsqueda.

Los flujos de trabajo se crean desactivados, así que nada se ejecuta hasta que los actives. Un flujo de trabajo nuevo se abre en el **Constructor**, el lienzo donde lo diseñas.

## El lienzo

Un flujo de trabajo empezado desde cero se abre con un único bloque punteado que dice **Choose what starts this workflow**. Ese bloque es el punto de partida — haz clic en él para elegir un disparador. Un flujo de trabajo creado a partir de una plantilla se abre con sus bloques ya colocados.

Todo flujo de trabajo tiene exactamente un **disparador** arriba del todo. Lo demás son **componentes**, y cada uno hace algo. Si añades un segundo disparador, sustituye al primero; si eliminas el último, vuelve el bloque punteado.

Para añadir bloques:

- **El disparador** — haz clic en el bloque punteado. Se abre un panel titulado **Add Trigger**.
- **Todo lo demás** — haz clic en **Añadir componente** en la barra de herramientas, encima del lienzo. Se abre ese mismo panel, ahora titulado **Add Component**.

Los dos paneles empiezan por los bloques que usan casi todos los flujos de trabajo, en **Popular**, seguidos del resto de bloques integrados. En **OneUptime resources**, haz clic en un recurso como **Incident** para ver qué puedes hacer con él; **Browse all resources** los muestra todos. O busca: escribe unas pocas palabras, como `create incident`, y la coincidencia más cercana sale primero. Pulsa `/` para saltar al cuadro de búsqueda, las flechas para moverte por los resultados y **Enter** para añadir el bloque resaltado. Un clic en un bloque lo añade.

Un bloque nuevo aparece debajo del bloque más bajo del lienzo, y un disparador nuevo ocupa arriba el lugar del anterior. El bloque nuevo queda seleccionado y, si aparece fuera de la vista, el lienzo se desplaza lo justo para mostrarlo. Sus ajustes no se abren solos: haz clic en el bloque cuando quieras configurarlo. Mientras falten sus ajustes obligatorios, el bloque dice **Click to set up**. Arrastra los bloques adonde quieras; el lienzo se ajusta a una cuadrícula mientras los mueves. Las posiciones se guardan, de modo que la siguiente persona verá la misma disposición que dejaste tú.

Los cambios se guardan solos. Una píldora en la barra de herramientas te lo cuenta: **Saving…** mientras el cambio va en camino, después **Saved**, o **Could not save** si algo falló. No hay botón de guardar ni un paso de publicación aparte.

## Qué hay en un bloque

| Campo                         | Qué hace                                                                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identifier** (en **ID**) | El id corto que se ve en el bloque, tipo `log-1`. Es el nombre con el que los demás bloques se refieren a este, así que cambiarlo rompe todas las referencias `{{local.components.…}}` que apunten aquí. El encabezado del bloque es el nombre propio del componente y no se puede cambiar. |
| **Settings**                  | Lo que el bloque necesita para hacer su trabajo — una URL, un canal de Slack, el texto de un mensaje. Los campos opcionales llevan la etiqueta **(Optional)**; el resto son obligatorios. Los ajustes menos frecuentes están plegados bajo **More fields**, cuya cabecera los nombra y muestra los que tienen valor. |
| **Input**                     | El punto del borde superior, por donde entran las líneas que vienen de bloques anteriores. Los disparadores no lo tienen — nada se ejecuta antes que ellos.                                                                                       |
| **Outputs**                   | Los puntos del borde inferior, con su etiqueta justo encima, por donde salen las líneas hacia los bloques siguientes. Muchos bloques tienen salidas **Success** y **Error** separadas para que puedas atender los dos casos.                  |

## Conectar bloques

Arrastra desde un punto de la parte inferior de un bloque hasta el punto de la parte superior del siguiente. La línea que dibujas decide qué se ejecuta después.

- Si conectas desde **Success**, el bloque siguiente solo se ejecuta cuando el anterior salió bien.
- Si conectas desde **Error**, el bloque siguiente solo se ejecuta cuando el anterior falló.
- Si dejas una salida sin conectar, ese camino simplemente termina ahí.

Puedes conectar una misma salida a varios bloques. Se ejecutan todos, pero uno detrás de otro, en una única cola, no en paralelo. No des por hecho un orden entre ramas ni cuentes con que se solapen en el tiempo. Cada bloque se ejecuta como mucho una vez por ejecución, así que volver con una línea a un bloque anterior no lo ejecuta dos veces.

## Configurar un bloque

Haz clic en un bloque para abrir sus ajustes en un diálogo (o llega hasta él con **Tab** y pulsa **Enter**). Cada ajuste tiene el tipo de campo que le corresponde — texto, desplegables, editores de código, interruptores, y así. Rellénalo y haz clic en **Guardar**.

En ese mismo diálogo encuentras:

- **Eliminar** — quita este bloque.
- **Run just this step** — ejecuta solo este bloque, sin el resto del flujo de trabajo. Los valores que habría leído de otros pasos llegan vacíos, y todo lo que envíe, escriba o elimine ocurre de verdad.
- **Documentación**, **Inputs**, **Outputs** y **Returns** — fichas de referencia con lo que este bloque espera y lo que produce.

Casi todos los campos de texto aceptan variables — así es como fluyen los datos de un bloque al siguiente. En vez de escribir la sintaxis a mano, usa el selector de valores del editor: construye una referencia correcta a partir del bloque y el campo que elijas. Consulta [Variables de flujo de trabajo](/docs/workflows/variables).

## Comprobaciones mientras construyes

El Constructor revisa el grafo entero cada vez que lo cambias e informa de lo que encuentra en una píldora de la barra de herramientas. Haz clic en la píldora para abrir **Problems with this workflow**, que enumera cada problema y te lleva al bloque responsable. En el lienzo, un bloque con ajustes obligatorios aún vacíos dice **Click to set up**, y un bloque con cualquier otro problema lleva un distintivo en la esquina: rojo para un error, ámbar para una advertencia. Pasa el ratón por encima del distintivo para leer qué falla.

Detecta los fallos que, si no, no ves hasta que una ejecución sale mal — que no haya disparador, que dos bloques compartan id, que un id lleve un punto, que un bloque no esté conectado a nada, que un ajuste obligatorio esté vacío, JSON mal formado, espacios dentro de `{{ }}` y referencias a un paso o a un valor de retorno que no existe.

Hay una cosa que no puede comprobar: si un nombre de variable existe. Una variable renombrada solo se delata en el registro de la ejecución.

## Tu primer flujo de trabajo

La forma más rápida de cogerle el pulso al lienzo:

1. Haz clic en el bloque punteado y luego en **Manual**, en el panel **Add Trigger**.
2. Haz clic en **Añadir componente** y luego en **Log**, dentro de **Popular**. El bloque nuevo aparece debajo del disparador. Conecta el punto **Execute** del disparador con el punto de entrada del bloque Log.
3. Haz clic en el bloque Log, que dice **Click to set up**, y pon en su **Valor** `Hello from {{local.components.manual-1.returnValues.value.name}}`. `manual-1` es el **Identifier** del disparador, visible en su bloque — comprueba que coincide.
4. Activa **Habilitado** en la parte superior del Constructor. Un flujo de trabajo deshabilitado no se puede ejecutar de ninguna manera, ni siquiera a mano; si te saltas este paso, **Ejecutar flujo de trabajo** te pide activarlo primero.
5. Vuelve al **Constructor**, haz clic en **Ejecutar flujo de trabajo**, pon `{ "name": "Ada" }` en el campo **JSON**, haz clic en **Run Workflow Manually** y confirma con **Run**.
6. Se abre solo un panel **Workflow Run** que sigue la ejecución. El registro muestra `Value:` seguido de `Hello from Ada`.

Ese ciclo — añadir, conectar, configurar, ejecutar y leer el registro — es como construirás todos tus flujos de trabajo.

## Encenderlo

Los flujos de trabajo nuevos nacen deshabilitados, y también los que duplicas o importas. Mientras un flujo de trabajo está apagado, el Constructor lo indica encima del lienzo, con un botón **Activar flujo de trabajo**.

El interruptor **Habilitado** está en la parte superior del **Constructor**, junto a **Añadir componente** y **Ejecutar flujo de trabajo**. También está en la página **Vista General** del flujo de trabajo: haz clic en **Editar flujo de trabajo** en la tarjeta **Detalles del flujo de trabajo**, que muestra el estado actual como una píldora verde **Habilitado** o roja **Deshabilitado**. Solo quien puede editar el flujo de trabajo puede encenderlo o apagarlo; los demás ven el interruptor atenuado.

Un flujo de trabajo deshabilitado no se ejecuta en absoluto: su disparador se ignora, y también **Ejecutar flujo de trabajo** y **Run just this step**. Si lo ejecutas, o ejecutas uno de sus bloques, mientras está apagado, el Constructor te pregunta **¿Activar este flujo de trabajo?**. **Activar y ejecutar** (o **Activar y ejecutar paso**) lo enciende y luego ejecuta lo que pediste, con los valores que diste. Así que el orden es: constrúyelo, pruébalo con **Ejecutar flujo de trabajo**, lee el registro de la ejecución y vuelve a apagar **Habilitado** si aún no quieres que su disparador salte. Para probar un solo bloque sin ejecutar todo lo demás, usa **Run just this step** en los ajustes de ese bloque.

Todo lo demás que inicia un flujo de trabajo deshabilitado se rechaza con el mismo consejo. Una llamada a su URL de webhook recibe un HTTP 400 y «This workflow is turned off, so it can't run. Turn it on with the Enabled switch at the top of its Builder, then try again.» Un bloque **Execute Workflow** que lo llama toma su camino **Error**, y el error nombra el flujo de trabajo al que llamó.

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
- [Ejecuciones de flujo de trabajo](/docs/workflows/runs-and-logs) — comprobar qué pasó.
