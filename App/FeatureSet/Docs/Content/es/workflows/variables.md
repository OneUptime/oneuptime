# Variables

Un flujo de trabajo solo es útil cuando los datos fluyen a través de él. Las variables son la forma en que esos datos se mueven — desde el disparador hasta el primer componente, desde la salida de un componente hasta la entrada del siguiente, y desde los secretos a nivel de proyecto hasta cualquier lugar donde se referencien.

OneUptime tiene dos tipos de variables y una sintaxis de interpolación que funciona para ambos.

## Variables globales

Valores a nivel de proyecto definidos una sola vez en **Workflows → Global Variables**. Piensa en claves de API, URLs base, nombres de canales, cualquier cosa que no quieras codificar a mano en diez flujos de trabajo.

Una variable global tiene:

- **Name** — el identificador con el que la referencias. Usa `UPPER_SNAKE_CASE` para que sea obvia en las plantillas.
- **Value** — el valor de cadena. Se admiten valores multilínea.
- **Is Secret** — cuando está activo, el valor es de solo escritura en la interfaz tras guardar y se redacta en los logs de ejecución.

Referencia una variable global desde cualquier parte de cualquier flujo de trabajo con:

```
{{variable.NAME}}
```

Por ejemplo, si definiste `PAGERDUTY_KEY` como una variable secreta, cada componente API que llame a PagerDuty puede leerla como `{{variable.PAGERDUTY_KEY}}` sin que nadie vea la clave real en el JSON del flujo de trabajo.

## Variables locales

Las variables locales son los valores de retorno de los nodos que ya se ejecutaron en esta ejecución. Cada disparador y cada componente publica uno — consulta [Disparadores](/docs/workflows/triggers) y [Componentes](/docs/workflows/components) para las listas por nodo.

Referencia una variable local así:

```
{{NodeId.fieldName}}
```

El `NodeId` es el nombre del disparador o componente en el lienzo (puedes renombrarlo para mejorar la legibilidad — mantenlo corto y en `PascalCase` para que las referencias queden limpias). El `fieldName` es lo que publique ese nodo.

Ejemplos:

- Después de que un componente **API** llamado `LookupUser` retorne con éxito, los nodos aguas abajo pueden leer su código de estado como `{{LookupUser.response-status}}` y el cuerpo parseado como `{{LookupUser.response-body}}`.
- Después de un disparador **Incident → On Create** llamado `Incident`, puedes leer `{{Incident.title}}`, `{{Incident.description}}`, `{{Incident.incidentSeverityId}}` y cualquier otra columna del incidente.
- Después de un componente **Custom Code** llamado `Transform`, el valor devuelto se expone como `{{Transform.value}}`.

Las variables locales tienen su alcance limitado a una única ejecución. La siguiente ejecución empieza con la pizarra en blanco.

## Dónde funciona la interpolación

Casi todo argumento de tipo texto soporta interpolación:

- Campos URL en el componente API
- Texto del mensaje en Slack / Teams / Discord / Telegram / Email
- Asunto y cuerpo en Email
- Campos de headers y body (úsala dentro de valores JSON)
- Operandos izquierdo y derecho en Conditions

Los argumentos puramente JSON aceptan interpolación dentro de los valores de cadena; no puedes interpolar una clave. Si necesitas construir una estructura dinámica, usa **Custom Code** para ensamblar el payload y luego canaliza su valor de retorno al siguiente nodo.

El componente **Custom Code** lee las variables de manera diferente — las variables globales se exponen en `args.variables`, y los valores de retorno aguas arriba se pasan como argumentos nombrados que configuras en el componente.

## Ejemplos

### Construir un payload a partir de un disparador

Un webhook recibe el resultado de un build de CI. El cuerpo es JSON como `{ "service": "checkout", "status": "failed" }`. Para convertirlo en un incidente de OneUptime:

1. Disparador **Webhook** llamado `CIWebhook`.
2. Componente **Conditions**: izquierdo `{{CIWebhook.Request Body.status}}`, operador `==`, derecho `failed`.
3. Desde el puerto `yes`, un componente **Create Incident** con:
   - Título: `CI build failed: {{CIWebhook.Request Body.service}}`
   - Descripción: `See {{CIWebhook.Request Body.url}} for the build logs.`

### Usar un secreto en una llamada API saliente

Un flujo de trabajo que llama a PagerDuty:

1. Define `PAGERDUTY_KEY` como variable global secreta.
2. En el componente **API**, establece el header `Authorization` a `Token token={{variable.PAGERDUTY_KEY}}`.

La clave nunca aparece en el JSON del flujo de trabajo ni en los logs de ejecución.

### Encadenar dos llamadas API

La primera llamada devuelve un ID que la segunda llamada necesita:

1. Componente **API** `LookupOrder`: `GET /orders?email={{Manual.JSON.email}}`.
2. Componente **API** `CancelOrder`: `POST /orders/{{LookupOrder.response-body.id}}/cancel`.

Si `LookupOrder` devuelve una respuesta no 2xx, su puerto `error` se dispara en lugar de `success` — cablea esa rama a un componente Email o Slack para que los fallos no sean silenciosos.

## Algunos detalles a tener en cuenta

- **Las erratas en los nombres de nodos rompen las referencias silenciosamente.** Si renombras un nodo después de cablear `{{OldName.field}}` aguas abajo, actualiza cada referencia. Mira el log de la ejecución — si ves el literal `{{OldName.field}}` en el argumento capturado, la búsqueda no se resolvió.
- **Los secretos distinguen mayúsculas y minúsculas.** `{{variable.MyKey}}` y `{{variable.mykey}}` son variables distintas.
- **Los campos ausentes son vacíos.** Referenciar `{{Foo.nonexistent}}` produce una cadena vacía, no un error. Útil, pero puede ocultar bugs — usa un nodo **Conditions** para verificar la presencia si el campo es necesario para el siguiente paso.

## Qué leer a continuación

- [Componentes](/docs/workflows/components) — el catálogo completo de nombres de valores de retorno.
- [Ejecuciones y registros](/docs/workflows/runs-and-logs) — inspeccionar el valor literal de cada argumento interpolado tras una ejecución.
- [Configuración y seguridad](/docs/workflows/configuration) — qué es seguro poner en una variable global.
