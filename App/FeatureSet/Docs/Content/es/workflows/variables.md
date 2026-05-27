# Variables

Los workflows tratan sobre mover datos: del disparador al primer bloque, de un bloque al siguiente y de valores compartidos a cualquier lugar donde los necesites. Las variables son la forma en que esos datos se mueven.

Hay dos tipos, y comparten la misma sintaxis.

## Variables globales

Valores a nivel de proyecto que guardas una vez y reutilizas en cualquier lugar. Piensa en claves de API, URLs, nombres de canales: cualquier cosa que no quieras copiar en diez workflows distintos.

Encuéntralas en **Workflows → Variables Globales**. Cada una tiene:

- **Nombre** — cómo la referenciarás. Usa `UPPER_SNAKE_CASE` para que destaque en tus bloques.
- **Valor** — el valor real. También funcionan valores de varias líneas.
- **Es Secreta** — cuando está activada, el valor se oculta en la interfaz tras guardar y se oculta en los registros de ejecución.

Usa una variable global en cualquier workflow con:

```
{{variable.NAME}}
```

Por ejemplo, si guardaste tu clave de PagerDuty como `PAGERDUTY_KEY`, cualquier bloque puede usarla como `{{variable.PAGERDUTY_KEY}}` — la clave real nunca aparece en el workflow ni en sus registros.

## Variables locales (datos de bloques anteriores)

Las variables locales son la salida de los bloques que ya se ejecutaron en esta ejecución. Cada disparador y cada componente produce alguna salida que puedes leer.

Referencia la salida de un bloque anterior así:

```
{{BlockName.fieldName}}
```

`BlockName` es el nombre del disparador o componente en el lienzo (puedes renombrarlo a algo corto y claro). `fieldName` es lo que produzca ese bloque.

Ejemplos:

- Tras ejecutar un bloque **API** llamado `LookupUser`, puedes leer el código de estado como `{{LookupUser.response-status}}` y el cuerpo como `{{LookupUser.response-body}}`.
- Tras un disparador **Incidente → Al Crear** llamado `Incident`, puedes leer `{{Incident.title}}`, `{{Incident.description}}` y cualquier otro campo del incidente.
- Tras un bloque **Código personalizado** llamado `Transform`, el valor devuelto está en `{{Transform.value}}`.

Las variables locales solo existen durante la ejecución actual. Cada nueva ejecución empieza desde cero.

## Dónde funcionan las variables

Casi cualquier campo de texto acepta variables:

- La URL de un bloque API.
- El texto del mensaje en Slack, Teams, Discord, Telegram, Correo electrónico.
- El asunto y el cuerpo de un correo.
- Las cabeceras y los campos del cuerpo (dentro de valores de tipo cadena).
- Ambos lados de un bloque Condiciones.

Los campos JSON puros aceptan variables dentro de valores de cadena, pero no puedes usar una variable como clave. Si necesitas construir una estructura dinámicamente, usa un bloque **Código personalizado** para construirla y luego pasa su salida al siguiente bloque.

El bloque **Código personalizado** lee las variables de manera diferente: las variables globales llegan en `args.variables`, y tú decides qué salidas anteriores pasar como argumentos.

## Ejemplos

### Construir una carga útil desde un webhook

Llega un webhook con un cuerpo como `{ "service": "checkout", "status": "failed" }`. Para convertir eso en un incidente de OneUptime:

1. Disparador **Webhook** llamado `CIWebhook`.
2. Bloque **Condiciones**: izquierdo `{{CIWebhook.Request Body.status}}`, operador `==`, derecho `failed`.
3. Desde la rama **Sí**, un bloque **Crear Incidente** con:
   - Título: `CI build failed: {{CIWebhook.Request Body.service}}`
   - Descripción: `See {{CIWebhook.Request Body.url}} for the logs.`

### Usar un secreto en una llamada de API

Un workflow que llama a PagerDuty:

1. Guarda `PAGERDUTY_KEY` como una variable global secreta.
2. En el bloque **API**, configura la cabecera `Authorization` como `Token token={{variable.PAGERDUTY_KEY}}`.

La clave queda fuera del workflow y de los registros.

### Encadenar dos llamadas API

La primera llamada te da un ID que la segunda necesita:

1. Bloque **API** `LookupOrder`: `GET /orders?email={{Manual.JSON.email}}`.
2. Bloque **API** `CancelOrder`: `POST /orders/{{LookupOrder.response-body.id}}/cancel`.

Si `LookupOrder` falla, su salida **error** se activa en lugar de **éxito**. Conecta esa a un bloque de Correo o Slack para que los fallos no pasen desapercibidos.

## Aspectos a tener en cuenta

- **Renombrar un bloque rompe las referencias.** Si renombras un bloque, actualiza todos los lugares donde se usa. En el registro de ejecución, una referencia no resuelta aparece como el texto literal `{{BlockName.field}}`.
- **Los nombres de variables distinguen mayúsculas y minúsculas.** `{{variable.MyKey}}` y `{{variable.mykey}}` son distintos.
- **Los campos ausentes se convierten en vacíos.** Referirse a un campo que no existe te da una cadena vacía, no un error. Conveniente, pero puede ocultar errores. Usa un bloque **Condiciones** para comprobar campos importantes antes de continuar.

## Dónde seguir leyendo

- [Componentes](/docs/workflows/components) — la lista completa de salidas que produce cada bloque.
- [Ejecuciones y Registros](/docs/workflows/runs-and-logs) — ver el valor real de cada variable tras una ejecución.
- [Configuración y Seguridad](/docs/workflows/configuration) — qué es seguro poner en una variable global.
