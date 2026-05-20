# Crear un flujo de trabajo

Crea un flujo de trabajo en **Workflows → Create Workflow**, dale un nombre y una descripción opcional, y luego abre la pestaña **Builder** para empezar a colocar nodos en el lienzo.

## El lienzo

El Builder es un grafo con zoom y desplazamiento. Añades nodos desde una paleta de componentes, los conectas con aristas y configuras los argumentos de cada nodo en un panel lateral. Un indicador de guardado en el encabezado te informa si tu última edición se ha persistido.

Un flujo de trabajo siempre comienza con exactamente un nodo **disparador**. Los disparadores no tienen puerto de entrada — son donde comienza la ejecución. Todo lo que está aguas abajo es un **componente**.

## Anatomía de un nodo

Cada nodo tiene:

| Campo | Propósito |
| --- | --- |
| **Título** | La etiqueta que se muestra en el lienzo. Por defecto, el nombre del componente; sobrescríbelo para hacer más legibles los flujos de trabajo complejos. |
| **Argumentos** | La configuración que el componente necesita para hacer su trabajo — una URL, un canal de Slack, un fragmento de JavaScript, etc. Los argumentos obligatorios se marcan con un asterisco. |
| **Puertos de entrada** | Conectores en la parte izquierda del nodo donde aterrizan las aristas entrantes. Los componentes tienen un puerto de entrada llamado `in`; los disparadores no tienen ninguno. |
| **Puertos de salida** | Conectores a la derecha donde empiezan las aristas salientes. Los componentes definen puertos como `success`, `error`, `yes`, `no`. |
| **Valores de retorno** | Datos que produce el nodo — los payloads de sus puertos de salida. Los nodos aguas abajo los referencian como `{{NodeId.fieldName}}`. |

## Conectar nodos

Arrastra desde un puerto de salida hasta el puerto de entrada de un nodo aguas abajo para crear una arista. Una arista desde `success` ejecuta esa rama solo cuando el nodo aguas arriba tuvo éxito; una arista desde `error` se ejecuta solo cuando falló. Si no conectas un puerto, esa rama simplemente termina.

Puedes ramificar: un puerto de salida puede alimentar a múltiples nodos aguas abajo, y todos se ejecutan en paralelo desde ese punto.

## Configurar argumentos

Haz clic en un nodo para abrir su panel lateral. Cada argumento tiene un editor tipado:

- **Texto / URL / Email / Número / Contraseña** — una entrada de una sola línea.
- **JSON** — un editor JSON con resaltado de sintaxis y un indicador de validación.
- **JavaScript** — un editor de código para los fragmentos utilizados por el componente **Custom Code**.
- **Markdown / HTML** — cuerpos de texto enriquecido para los componentes de correo electrónico y de mensajes.
- **CronTab** — una expresión de programación (utilizada por el disparador Schedule).
- **Booleano** — un interruptor.
- **Select / Query** — desplegables para campos que aceptan un conjunto fijo de valores o una consulta estilo modelo.

Cualquier campo de texto admite interpolación de variables — consulta [Variables](/docs/workflows/variables) para las reglas.

## Un primer flujo de trabajo mínimo

La forma más rápida de hacerse al lienzo:

1. Coloca un disparador **Manual**.
2. Coloca un componente **Log** (en **Utils**). Conecta el puerto de salida del disparador al puerto de entrada del componente Log.
3. En el argumento del componente Log, escribe `Hello from {{Manual.JSON.name}}`.
4. Guarda y habilita el flujo de trabajo.
5. Haz clic en **Run Manually**, pega `{ "name": "Ada" }` como entrada y envía.
6. Abre la pestaña **Logs**. La última ejecución muestra la salida capturada del nodo Log: `Hello from Ada`.

Ese viaje de ida y vuelta — arrastrar, cablear, configurar, ejecutar, inspeccionar — es el ritmo de la creación de cada flujo de trabajo.

## Guardar, habilitar y probar en producción

Los flujos de trabajo se almacenan como un grafo JSON en la columna `Workflow.graph`. El Builder guarda mientras editas; el indicador de guardado del encabezado muestra cuándo el último cambio ha llegado al servidor. No hay un paso separado de "publicar".

Pero: un flujo de trabajo solo activa su disparador cuando **isEnabled** está activo. Los flujos nuevos se envían deshabilitados. Trata ese flag como tu interruptor de "listo para producción" — construye, haz clic en **Run Manually** para hacer un ensayo con un payload de muestra, mira los **Logs**, y solo entonces activa Enable.

Si necesitas pausar un flujo de trabajo sin eliminarlo (por ejemplo, durante un incidente no relacionado), desactiva **isEnabled** en **Settings**. Las ejecuciones en curso continúan; no se inician ejecuciones nuevas.

## Reordenar y reorganizar

- Arrastra un nodo para reposicionarlo. La posición se almacena en el grafo, así que la siguiente persona que abra el lienzo verá el mismo diseño.
- Haz clic derecho en una arista para eliminarla; haz clic derecho en un nodo para opciones de eliminar y duplicar.
- Para flujos de trabajo anchos, organízalos de izquierda a derecha para que la dirección de ejecución coincida con la dirección de lectura.

## Qué leer a continuación

- [Disparadores](/docs/workflows/triggers) — las cuatro familias de disparadores y qué expone cada una como valores de retorno.
- [Componentes](/docs/workflows/components) — el catálogo completo y sus argumentos.
- [Variables](/docs/workflows/variables) — cómo referenciar datos entre nodos y desde variables globales.
- [Ejecuciones y registros](/docs/workflows/runs-and-logs) — cómo depurar un flujo de trabajo que se comporta mal.
