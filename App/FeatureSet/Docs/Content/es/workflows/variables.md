# Variables

Los workflows tratan de mover datos: del disparador al primer bloque, de un bloque al siguiente, y de valores compartidos hacia cualquier lugar donde los necesites. Las variables son la forma en que esos datos se mueven.

Hay dos ámbitos de variables, más las salidas de componentes producidas durante una ejecución.

## Variables globales

Valores de todo el proyecto que guardas una vez y reutilizas en cualquier lugar. Piensa en claves de API, URLs, nombres de canal: cualquier cosa que no quieras copiar en diez workflows distintos.

Encuéntralas en **Flujos de trabajo → Variables Globales**. Cada una tiene:

- **Name** — cómo la referenciarás. Al menos dos caracteres, sin espacios, y solo letras, números, guiones y guiones bajos. `UPPER_SNAKE_CASE` es un buen hábito porque destaca en tus bloques.
- **Description** — opcional, texto libre para recordarte para qué sirve.
- **Secret** — cuando está activado, el valor se elimina de los registros de ejecución y de los rastros de pasos.
- **Content** — el valor real. Es un campo de texto largo, así que los valores multilínea funcionan.

Usa una variable global en cualquier workflow con:

```
{{global.variables.NAME}}
```

Por ejemplo, si guardaste tu clave de PagerDuty como `PAGERDUTY_KEY`, cualquier bloque puede usarla como `{{global.variables.PAGERDUTY_KEY}}`: el editor guarda la referencia, y el registro de workflow elimina el valor secreto resuelto.

Las variables se crean y se eliminan, no se editan. No hay botón de editar en la tabla, así que para cambiar un valor en la interfaz eliminas la variable y la creas de nuevo, o la actualizas por la API, lo cual se explica al final de esta página. Las variables globales y de workflow son una función del plan Growth.

## Variables locales de workflow

Variables con alcance a un solo workflow, gestionadas en **Workflow Variables** en el menú lateral de ese workflow. Referéncialas con:

```
{{local.variables.NAME}}
```

## Salidas de componentes (datos de bloques anteriores)

Cada disparador y componente puede producir una salida durante una ejecución. Usa el selector de valores de componente en el editor para crear la referencia en lugar de escribirla a mano: inserta exactamente los ids que el runner espera.

Referencia la salida de un bloque anterior así:

```
{{local.components.COMPONENT_ID.returnValues.FIELD_ID}}
```

`COMPONENT_ID` es el **Identifier** del bloque: el id corto mostrado en el bloque, no el nombre que se muestra en él. Los bloques nuevos reciben uno como `api-get-1`, y puedes renombrarlo en la sección **ID** del bloque. Renombrarlo rompe cada referencia que ya apunte a él, igual que renombrar una variable. `FIELD_ID` es el id del return-value seleccionado.

Ejemplos:

- Después de que se ejecute un componente **API** cuyo ID es `lookup-user`, su código de estado es `{{local.components.lookup-user.returnValues.response-status}}` y su cuerpo es `{{local.components.lookup-user.returnValues.response-body}}`.
- Después de un componente **Run Custom JavaScript** cuyo ID es `transform`, su valor devuelto es `{{local.components.transform.returnValues.returnValue}}`.
- Los disparadores para un tipo de registro — **On Create Incident** y similares — devuelven exactamente un valor, `model`, y tú profundizas en él. Para un disparador cuyo ID es `incident-on-create-1`, el título del incidente es `{{local.components.incident-on-create-1.returnValues.model.title}}`.

Las variables locales solo existen durante la ejecución actual. Cada ejecución nueva empieza de cero.

## Dónde funcionan las variables

Casi todos los campos de texto aceptan variables:

- La URL en un bloque API.
- El texto del mensaje en Slack, Teams, Discord, Telegram, Email.
- El asunto y el cuerpo de un correo.
- Los campos de cabeceras y cuerpo (dentro de valores de cadena).
- Ambos lados de un bloque **If / Else** (listado en la categoría Conditions).

En campos JSON puedes usar una variable dentro de un valor de cadena, pero no como clave. Una referencia que ocupa un valor completo por sí sola se sustituye tal cual, así que puedes soltar un objeto entero en un campo JSON de esa forma. Si necesitas construir una estructura dinámicamente, usa un bloque **Run Custom JavaScript** para construirla, y luego pasa su salida al siguiente bloque.

El bloque **Run Custom JavaScript** no recibe variables automáticamente: no se inyecta nada en el sandbox. Pon `{{global.variables.NAME}}` (o cualquier referencia de componente) en el campo JSON **Arguments** del bloque; esos valores se sustituyen antes de que se ejecute el script y llegan como `args`.

## Iterar sobre arrays

Dentro de un campo de texto puedes iterar un array con `{{#each path}}…{{/each}}`. Dentro del bloque, `{{property}}` lee del elemento actual, `{{@index}}` es la posición basada en 0, y `{{this}}` es el elemento mismo para arrays de valores simples. Los nombres dentro de un bloque `{{#each}}` se recortan, así que los espacios sueltos son inofensivos ahí, a diferencia de en cualquier otro lugar.

## Ejemplos

### Construir un payload a partir de un webhook

Llega un webhook con un cuerpo como `{ "service": "checkout", "status": "failed" }`. Para convertir eso en un incidente de OneUptime:

1. Disparador **Webhook** con el id `ci-webhook`.
2. Bloque **If / Else**: selecciona la salida Request Body del webhook y usa su propiedad `status`, operador `==`, lado derecho `failed`.
3. Desde la rama **Yes**, un bloque **Create One Incident** con:
   - Title: `CI build failed: {{local.components.ci-webhook.returnValues.request-body.service}}`
   - Description: `See {{local.components.ci-webhook.returnValues.request-body.url}} for the logs.`

### Usar un secreto en una llamada a la API

Un workflow que llama a PagerDuty:

1. Guarda `PAGERDUTY_KEY` como variable global secreta.
2. En el bloque **API**, establece la cabecera `Authorization` como `Token token={{global.variables.PAGERDUTY_KEY}}`.

La clave se mantiene fuera del workflow y de los registros.

### Encadenar dos llamadas a la API

La primera llamada te da un ID que la segunda necesita:

1. Componente **API** `lookup-order`: usa el selector para insertar el campo JSON de email del disparador manual en `GET /orders?email=...`.
2. Componente **API** `cancel-order`: `POST /orders/{{local.components.lookup-order.returnValues.response-body.id}}/cancel`.

Si `lookup-order` falla, su salida **Error** se activa en lugar de **Success**. Conecta eso a un bloque de Email o Slack para que los fallos no pasen desapercibidos.

## Actualizar una variable desde un workflow

Un patrón común es rotar una credencial según una programación: obtener un token nuevo de un tercero, y luego guardarlo de vuelta en la variable para que la siguiente ejecución lo use. Haz eso con un bloque **API** que llame a la API de OneUptime.

`PUT /api/workflow-variable/<variable-id>` con una cabecera `ApiKey`, y —esta es la parte que suele confundir a la gente— los campos que quieres cambiar **envueltos en un objeto `data`**:

```json
{
  "data": {
    "content": "{{local.components.get-token.returnValues.response-body.access_token}}"
  }
}
```

Un cuerpo plano sin el envoltorio `data` se rechaza con un 400. Envía solo los campos que realmente quieres cambiar; `name` y `description` pueden quedarse fuera del payload.

La clave de API necesita **Edit Workflow Variables**. No se requiere permiso de lectura: la actualización no vuelve a leer la fila.

Dos cosas a vigilar:

- **No renombres una variable que referencias.** `name` forma parte de `{{local.variables.NAME}}`. Cambiarlo deja cada referencia existente sin resolver, y una referencia sin resolver se pasa como texto literal; consulta la trampa más abajo.
- **Una variable se puede escribir de esta forma pero nunca leer de vuelta.** `content` es de solo escritura por la API para toda variable, secreta o no. Eso es lo que hace de una variable un lugar seguro para guardar un token que rota. Marcarla como secreta además mantiene el valor fuera de los registros de ejecución y de los rastros de pasos.

## Trampas comunes

- **Usa los selectores.** Insertan exactamente los ids de componente, return-value y variable que el runner espera, y mantienen las referencias independientes de las etiquetas mostradas.
- **Los nombres de variable distinguen mayúsculas de minúsculas.** `{{global.variables.MyKey}}` y `{{global.variables.mykey}}` son diferentes.
- **Una referencia que no se resuelve se deja tal cual, no se deja en blanco.** Referirse a algo que no existe no es un error, y tampoco te da una cadena vacía: las llaves se pasan tal cual, así que `{{local.components.api-get-1.returnValues.body}}` con un id de paso mal escrito termina en tu mensaje de Slack, URL o cuerpo de la solicitud tal cual, y la ejecución sigue reportando **Executed**. El registro de la ejecución lleva una línea de advertencia nombrando cualquier referencia que se haya colado.
- **El builder no puede comprobar nombres de variable.** Marca las referencias de componente que no puede emparejar —un id de paso desconocido, un return value desconocido, una raíz malformada— antes de que guardes. No puede saber si una variable existe, así que una variable renombrada solo se detecta en el registro de la ejecución.
- **Los espacios dentro de las llaves no se recortan.** `{{ local.variables.NAME }}` es una búsqueda distinta de `{{local.variables.NAME}}` y nunca se resuelve. La única excepción es dentro de un bloque `{{#each}}`, donde los nombres sí se recortan.

## Qué leer a continuación

- [Componentes de flujo de trabajo](/docs/workflows/components) — la lista completa de salidas que produce cada bloque.
- [Ejecuciones y registros de flujo de trabajo](/docs/workflows/runs-and-logs) — ver el valor real de cada variable después de una ejecución.
- [Configuración y seguridad del flujo de trabajo](/docs/workflows/configuration) — qué es seguro poner en una variable global.
