# Variables

Los flujos de trabajo van de mover datos — del disparador al primer bloque, de un bloque al siguiente y de los valores compartidos a cualquier sitio donde los necesites. Las variables son el vehículo de esos datos.

Hay dos ámbitos de variables, más las salidas que los componentes producen durante una ejecución.

## Variables globales

Valores de todo el proyecto que guardas una vez y reutilizas donde quieras. Piensa en claves de API, URLs, nombres de canal — cualquier cosa que no te apetezca copiar en diez flujos de trabajo distintos.

Las encuentras en **Flujos de Trabajo → Variables Globales**. Cada una tiene:

- **Nombre** — con lo que la referenciarás. Mínimo dos caracteres, sin espacios y solo letras, números, guiones y guiones bajos. `UPPER_SNAKE_CASE` es una buena costumbre porque destaca dentro de tus bloques.
- **Descripción** — opcional, texto libre para recordarte para qué sirve.
- **Secreto** — al activarlo, el valor se elimina de los registros de ejecución y de las trazas de pasos.
- **Contenido** — el valor en sí. Es un campo de texto largo, así que admite varias líneas.

Para usar una variable global en cualquier flujo de trabajo:

```
{{global.variables.NAME}}
```

Por ejemplo, si guardaste tu clave de PagerDuty como `PAGERDUTY_KEY`, cualquier bloque puede usarla como `{{global.variables.PAGERDUTY_KEY}}` — el editor guarda la referencia, y el registro del flujo de trabajo depura el valor secreto ya resuelto.

Las variables se crean y se eliminan, no se editan. La tabla no tiene botón de editar, así que para cambiar un valor desde la interfaz eliminas la variable y la vuelves a crear — o la actualizas por la API, cosa que se explica al final de esta página. Las variables globales y de flujo de trabajo son una función del plan Growth.

## Variables locales de un flujo de trabajo

Variables que solo existen en un flujo de trabajo y se gestionan en **Variables de Flujo**, en el menú izquierdo de ese flujo. Se referencian así:

```
{{local.variables.NAME}}
```

## Salidas de componentes (datos de bloques anteriores)

Todo disparador y todo componente puede producir salida durante una ejecución. Usa el selector de valores de componente del editor para crear la referencia en vez de escribirla: inserta exactamente los ids que el runner espera.

Para referenciar la salida de un bloque anterior:

```
{{local.components.COMPONENT_ID.returnValues.FIELD_ID}}
```

`COMPONENT_ID` es el **Identifier** del bloque — el id corto que se ve en él, no el nombre que muestra. Los bloques nuevos reciben uno del tipo `api-get-1`, y puedes cambiarlo en la sección **ID** del bloque. Cambiarlo rompe todas las referencias que ya apuntaban ahí, igual que pasa al renombrar una variable. `FIELD_ID` es el id del valor de retorno que elijas.

Ejemplos:

- Después de ejecutarse un componente **API** cuyo ID es `lookup-user`, su código de estado es `{{local.components.lookup-user.returnValues.response-status}}` y su cuerpo es `{{local.components.lookup-user.returnValues.response-body}}`.
- Después de un componente **Run Custom JavaScript** cuyo ID es `transform`, el valor que devuelve es `{{local.components.transform.returnValues.returnValue}}`.
- Los disparadores de un tipo de registro — **On Create Incident** y compañía — devuelven un único valor, `model`, y tú profundizas dentro de él. Para un disparador cuyo ID es `incident-on-create-1`, el título del incidente es `{{local.components.incident-on-create-1.returnValues.model.title}}`.

Las variables locales solo existen mientras dura la ejecución en curso. Cada ejecución nueva empieza de cero.

## Dónde funcionan las variables

Casi cualquier campo de texto acepta variables:

- La URL de un bloque API.
- El texto del mensaje en Slack, Teams, Discord, Telegram y correo electrónico.
- El asunto y el cuerpo de un correo.
- Los campos de cabeceras y de cuerpo (dentro de valores de tipo cadena).
- Los dos lados de un bloque **If / Else** (que está en la categoría Condiciones).

En los campos JSON puedes usar una variable dentro de un valor de tipo cadena, pero no como clave. Una referencia que ocupa un valor entero ella sola se sustituye tal cual, así que por esa vía puedes colocar un objeto completo en un campo JSON. Si necesitas construir una estructura de forma dinámica, usa un bloque **Run Custom JavaScript** para armarla y pasa su salida al bloque siguiente.

El bloque **Run Custom JavaScript** no recibe variables automáticamente — no se inyecta nada en el sandbox. Pon `{{global.variables.NAME}}` (o cualquier referencia a un componente) en el campo JSON **Arguments** del bloque; esos valores se sustituyen antes de que se ejecute el script y llegan como `args`.

## Recorrer arrays

Dentro de un campo de texto puedes iterar un array con `{{#each path}}…{{/each}}`. Dentro del bloque, `{{property}}` lee del elemento actual, `{{@index}}` es la posición empezando en 0 y `{{this}}` es el elemento en sí cuando el array contiene valores simples. Los nombres dentro de un bloque `{{#each}}` se recortan, así que ahí los espacios sobrantes son inofensivos — al contrario que en el resto de sitios.

## Ejemplos

### Construir un payload a partir de un webhook

Llega un webhook con un cuerpo del estilo `{ "service": "checkout", "status": "failed" }`. Para convertirlo en un incidente de OneUptime:

1. Un disparador **Webhook** con el id `ci-webhook`.
2. Un bloque **If / Else**: selecciona la salida Request Body del webhook y usa su propiedad `status`, operador `==`, a la derecha `failed`.
3. Desde la rama **Sí**, un bloque **Create One Incident** con:
   - Título: `CI build failed: {{local.components.ci-webhook.returnValues.request-body.service}}`
   - Descripción: `See {{local.components.ci-webhook.returnValues.request-body.url}} for the logs.`

### Usar un secreto en una llamada a una API

Un flujo de trabajo que llama a PagerDuty:

1. Guarda `PAGERDUTY_KEY` como variable global secreta.
2. En el bloque **API**, pon la cabecera `Authorization` a `Token token={{global.variables.PAGERDUTY_KEY}}`.

La clave se queda fuera del flujo de trabajo y fuera de los registros.

### Encadenar dos llamadas a una API

La primera llamada te da un ID que necesita la segunda:

1. Componente **API** `lookup-order`: usa el selector para insertar el campo de correo del JSON del disparador manual en `GET /orders?email=...`.
2. Componente **API** `cancel-order`: `POST /orders/{{local.components.lookup-order.returnValues.response-body.id}}/cancel`.

Si `lookup-order` falla, se activa su salida **Error** en lugar de **Success**. Conéctala a un bloque de correo electrónico o de Slack para que los fallos no pasen desapercibidos.

## Actualizar una variable desde un flujo de trabajo

Un patrón habitual es rotar una credencial de forma programada: pides un token nuevo a un tercero y lo guardas de vuelta en la variable para que la siguiente ejecución lo use. Eso se hace con un bloque **API** que llama a la API de OneUptime.

`PUT /api/workflow-variable/<variable-id>` con una cabecera `ApiKey` y — esta es la parte con la que todo el mundo tropieza — los campos que quieras cambiar **envueltos en un objeto `data`**:

```json
{
  "data": {
    "content": "{{local.components.get-token.returnValues.response-body.access_token}}"
  }
}
```

Un cuerpo plano, sin el envoltorio `data`, se rechaza con un 400. Envía solo los campos que de verdad quieras cambiar; `name` y `description` pueden quedarse fuera del payload.

La clave de API necesita **Edit Workflow Variables**. No hace falta permiso de lectura — la actualización no vuelve a leer la fila.

Dos cosas a vigilar:

- **No renombres una variable que estés referenciando.** `name` forma parte de `{{local.variables.NAME}}`. Cambiarlo deja sin resolver todas las referencias existentes, y una referencia sin resolver se pasa tal cual como texto literal — mira el detalle más abajo.
- **Una variable se puede escribir por esta vía, pero nunca leer.** `content` es de solo escritura en la API para cualquier variable, sea secreta o no. Eso es justo lo que convierte a una variable en un buen sitio donde aparcar un token rotatorio. Marcarla como secreta añade que el valor se quede fuera de los registros de ejecución y de las trazas de pasos.

## Detalles que se atragantan

- **Usa los selectores.** Insertan exactamente los ids de componente, de valor de retorno y de variable que el runner espera, y mantienen las referencias al margen de las etiquetas visibles.
- **Los nombres de variable distinguen mayúsculas de minúsculas.** `{{global.variables.MyKey}}` y `{{global.variables.mykey}}` son cosas distintas.
- **Una referencia que no se resuelve se deja tal cual, no se vacía.** Referenciar algo que no existe no es un error, y tampoco te da una cadena vacía: las llaves pasan de largo, así que `{{local.components.api-get-1.returnValues.body}}` con un id de paso mal escrito acaba literalmente en tu mensaje de Slack, en tu URL o en tu cuerpo de petición, y la ejecución sigue reportándose como **Executed**. El registro de la ejecución incluye una línea de advertencia con el nombre de cada referencia que se coló.
- **El constructor no puede comprobar los nombres de variable.** Sí marca, antes de que guardes, las referencias a componentes que no encajan — un id de paso desconocido, un valor de retorno desconocido, una raíz mal formada. Pero no sabe si una variable existe, así que una variable renombrada solo se descubre en el registro de la ejecución.
- **Los espacios dentro de las llaves no se recortan.** `{{ local.variables.NAME }}` es una búsqueda distinta de `{{local.variables.NAME}}` y no se resuelve nunca. La única excepción es dentro de un bloque `{{#each}}`, donde los nombres sí se recortan.

## Qué leer a continuación

- [Componentes de flujo de trabajo](/docs/workflows/components) — la lista completa de salidas que produce cada bloque.
- [Ejecuciones y registros de flujo de trabajo](/docs/workflows/runs-and-logs) — ver el valor real de cada variable tras una ejecución.
- [Configuración y seguridad del flujo de trabajo](/docs/workflows/configuration) — qué es seguro poner en una variable global.
