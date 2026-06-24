# Crear un Workflow

Para crear un workflow, abre **Workflows → Crear Workflow**, dale un nombre y haz clic en la pestaña **Constructor**. Verás un lienzo en blanco donde construirás la automatización.

## El lienzo

El Constructor es un lienzo de arrastrar y soltar. Añades bloques desde la paleta lateral, los conectas con líneas y haces clic en cada bloque para configurar lo que hace. Los cambios se guardan automáticamente: verás un indicador en la parte superior una vez que se hayan guardado.

Cada workflow comienza con un **disparador** al principio. Todo lo demás es un **componente** que hace algo.

## Qué hay en un bloque

| Campo             | Qué hace                                                                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Título**        | El nombre que aparece en el lienzo. Renómbralo para que los workflows complejos sean más fáciles de leer.                                                                           |
| **Configuración** | Lo que el bloque necesita para hacer su trabajo: una URL, un canal de Slack, el cuerpo de un mensaje, etc. Los campos obligatorios están marcados con un asterisco.                 |
| **Entrada**       | El punto en la izquierda donde llegan las líneas desde bloques anteriores.                                                                                                          |
| **Salidas**       | Los puntos en la derecha donde salen las líneas hacia los siguientes bloques. Muchos bloques tienen salidas separadas de **éxito** y **error** para que puedas manejar ambos casos. |

## Conectar bloques

Arrastra desde el punto de salida de un bloque hasta el punto de entrada del siguiente. La línea que dibujas decide qué se ejecuta a continuación.

- Si conectas desde **éxito**, el siguiente bloque solo se ejecuta cuando el anterior funcionó.
- Si conectas desde **error**, el siguiente bloque solo se ejecuta cuando el anterior falló.
- Si no conectas una salida, ese camino simplemente termina.

Puedes conectar una salida a múltiples bloques. Todos se ejecutan al mismo tiempo desde ese punto.

## Configurar un bloque

Haz clic en un bloque para abrir su configuración en el panel lateral. Cada ajuste tiene el tipo de entrada adecuado: campos de texto, listas desplegables, editores de código, interruptores, etc.

La mayoría de los campos de texto aceptan variables: así es como fluyen los datos de un bloque al siguiente. Consulta [Variables](/docs/workflows/variables) para conocer la sintaxis.

## Tu primer workflow

La forma más rápida de familiarizarte con el lienzo:

1. Arrastra un disparador **Manual** al lienzo.
2. Arrastra un componente **Log** (en **Utils**) junto a él. Conecta el disparador al componente Log.
3. En el campo de mensaje del bloque Log, escribe `Hello from {{Manual.JSON.name}}`.
4. Guarda y activa el workflow.
5. Haz clic en **Ejecutar Manualmente**, pega `{ "name": "Ada" }` como entrada y envía.
6. Abre la pestaña **Registros**. La última ejecución muestra `Hello from Ada`.

Ese ciclo —arrastrar, conectar, configurar, ejecutar, comprobar el registro— es como construirás cada workflow.

## Guardar y activar

El lienzo se guarda mientras trabajas. No hay un paso separado de "publicar".

Pero un workflow solo se ejecuta realmente cuando **Activado** está en marcha en Configuración. Los workflows nuevos comienzan desactivados. Usa ese interruptor como red de seguridad: constrúyelo, pruébalo con **Ejecutar Manualmente**, revisa los registros y luego actívalo.

Para pausar un workflow sin eliminarlo, desactiva **Activado**. Las ejecuciones que ya están en curso terminan; no se inician nuevas.

## Organización

- Arrastra los bloques para moverlos. El diseño se guarda para que la siguiente persona vea la misma disposición.
- Haz clic derecho en una línea para eliminarla. Haz clic derecho en un bloque para eliminarlo o duplicarlo.
- Para workflows amplios, organízalos de izquierda a derecha para que se lean en la dirección en la que se ejecutan.

## Dónde seguir leyendo

- [Disparadores](/docs/workflows/triggers) — las cuatro maneras en que un workflow puede iniciarse.
- [Componentes](/docs/workflows/components) — todos los bloques que puedes añadir.
- [Variables](/docs/workflows/variables) — mover datos entre bloques.
- [Ejecuciones y Registros](/docs/workflows/runs-and-logs) — comprobar lo que ocurrió.
