# Componentes

Los componentes son los bloques de construcción que añades después del disparador. Cada uno hace una cosa: enviar un mensaje, llamar a una API, comprobar una condición, y se conecta con lo que venga después.

Esta página es el catálogo. Para saber cómo añadirlos y conectarlos en el lienzo, consulta [Crear un flujo de trabajo](/docs/workflows/authoring).

## API

Haz una solicitud HTTP a cualquier URL.

**Settings**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH`, o `DELETE`.
- **URL** — la dirección a llamar.
- **Headers** — cualquier cabecera a enviar.
- **Body** — el cuerpo de la solicitud para `POST` / `PUT` / `PATCH`.

**Outputs**:

- **Success** — se activa cuando la llamada funcionó (respuesta 2xx). Pasa el estado, las cabeceras y el cuerpo.
- **Error** — se activa en un fallo de red o una respuesta que no es 2xx. Pasa el mensaje de error.

Úsalo para: cualquier API externa, tus propios endpoints de administración, o cualquier integración que no tenga su propio componente.

## AI

### Generate Text with AI

Genera una respuesta de texto a partir de un prompt y contexto JSON opcional. El componente usa el proveedor de LLM predeterminado configurado del proyecto, recurriendo al proveedor global de la instalación cuando hay uno disponible. Las credenciales y los endpoints del proveedor se configuran centralmente; no son argumentos del workflow.

**Settings**:

- **System Instructions** — guía opcional para el rol, tono y restricciones del modelo.
- **Prompt** — la tarea requerida. Puede incluir variables de workflow y salidas de componentes anteriores.
- **Context** — JSON opcional que incluyes deliberadamente con la solicitud. Se añade después de un marcador explícito de fin de mensaje de confianza y se trata como datos no confiables durante el resto del mensaje.
- **Temperature** — variación de `0` a `1`. El valor predeterminado es `0.2` para una automatización predecible.
- **Maximum Output Tokens** — de `1` a `4096`. El valor predeterminado es `1024`.

La combinación de System Instructions, Prompt y Context serializado está limitada a 50.000 caracteres. La solicitud al proveedor tiene una duración máxima de 60 segundos y se intenta una sola vez. Como máximo pueden ejecutarse tres solicitudes de AI de workflow concurrentemente por proyecto.

**Outputs**:

- **Response** — el texto generado.
- **Provider** y **Model** — la configuración usada para la llamada.
- **Total Tokens** y **Completion Tokens** — uso reportado por el proveedor.
- **LLM Log ID** — la entrada de registro de AI medida para la llamada.
- **Error** — el error de validación, acceso, proveedor, presupuesto, facturación o tiempo de espera, cuando esté presente.

Conecta **Success** a los componentes que deban usar la respuesta. Conecta **Error** a una alternativa, alerta o ruta de registro explícita. El componente hace una sola solicitud al modelo sin definiciones de herramientas ni campos de capacidad nativa del proveedor: no puede consultar OneUptime, llamar a APIs ni cambiar datos del proyecto por sí mismo. Aparte de las instrucciones fijas de seguridad de componente de OneUptime, solo se envían al proveedor el System Instructions, Prompt y Context que configures, después de que se resuelvan las variables de workflow en esos campos. El proveedor/modelo configurado sigue siendo un límite de confianza porque un modelo puede tener capacidades intrínsecas gestionadas por el proveedor.

La salida del modelo es texto no confiable. Revísala antes de enviar comunicaciones de cara al cliente, y no uses texto de AI de forma libre por sí solo para autorizar acciones destructivas de workflow. Consulta [Configuración y seguridad del flujo de trabajo](/docs/workflows/configuration) para detalles sobre proveedor, salida de datos, registro y costes.

## Webhook (saliente)

Una versión más simple del componente API para casos de «disparar y olvidar». Envía un cuerpo JSON a una URL.

Usa **API** si necesitas leer la respuesta. Usa **Webhook** si solo quieres enviar una notificación y seguir adelante.

## Slack

Publica un mensaje en un canal de Slack.

**Settings**:

- **Channel** — el nombre del canal. El bot ya debe estar en ese canal.
- **Message** — el texto a enviar. Admite el formato de Slack.

Conecta Slack a tu proyecto primero en **Project Settings → Workspace → Slack**. Consulta [Conexión del espacio de trabajo de Slack](/docs/workspace-connections/slack).

## Microsoft Teams

Publica un mensaje en un canal de Microsoft Teams.

**Settings**:

- **Team and channel** — dónde publicar.
- **Message** — el texto a enviar.

Consulta [Conexión del espacio de trabajo de Microsoft Teams](/docs/workspace-connections/microsoft-teams) para la configuración.

## Discord

Publica un mensaje en un canal de Discord a través de una URL de webhook entrante.

## Telegram

Envía un mensaje a un chat de Telegram usando un token de bot y un chat ID.

## Email

Envía un correo a través de OneUptime.

**Settings**:

- **To** — la dirección de correo del destinatario.
- **Subject** — la línea de asunto.
- **Body** — el mensaje en Markdown o HTML.

El correo sale desde el remitente configurado de tu proyecto; consulta [SMTP](/docs/emails/smtp).

## Custom Code

Ejecuta un pequeño fragmento de JavaScript cuando necesites algo que los demás bloques no puedan hacer.

**Settings**:

- **Code** — tu JavaScript. El último valor (o lo que devuelvas desde una función async) se convierte en la salida del bloque.
- **Arguments** — valores con nombre que puedes pasar.

**Outputs**: success (tu valor devuelto) y error (cualquier excepción).

Úsalo para: dar forma a datos entre dos sistemas, hacer un pequeño cálculo, cualquier cosa que no merezca su propio bloque. Para scripting más pesado, usa un [Runbook](/docs/runbooks/index) en su lugar.

## JSON

Convierte entre texto y JSON.

- **JSON → Text** — convierte un objeto JSON en una cadena. Útil cuando el siguiente bloque espera texto.
- **Text → JSON** — analiza una cadena en un objeto JSON. Útil cuando algo llegó como texto y necesitas leer un campo.

## Conditions

Ramifica según una comparación. En el panel **Add Component** este bloque se llama **If / Else**, en la categoría Conditions.

**Settings**:

- **Left value** — normalmente un valor de un bloque anterior.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — con qué comparar.

**Outputs**: **Yes** y **No**. Conecta los siguientes bloques a la rama que quieras.

## Delay

Pausa el workflow durante un tiempo determinado antes de continuar. Útil cuando necesitas darle a otro sistema un momento para ponerse al día.

## Log

Escribe una línea en el registro de la ejecución. Sin efecto externo; solo aparece en los registros del workflow para que lo leas. Útil para depurar.

## Execute Workflow

Llama a otro workflow desde este. El workflow llamado se ejecuta por su cuenta; tu workflow continúa sin esperar a que termine.

Úsalo para compartir lógica común. Construye un workflow «publicar en el canal de incidentes» una vez, y luego llámalo desde cualquier otro workflow que necesite notificar al canal.

Hay un límite de seguridad para que los workflows no puedan seguir llamándose unos a otros en bucle. Consulta [Configuración y seguridad del flujo de trabajo](/docs/workflows/configuration).

## Componentes de datos de OneUptime

Para cada tipo de registro en OneUptime (monitores, incidentes, alertas, páginas de estado, políticas de guardia y muchos más), el panel **Add Component** tiene estos componentes; búscalos por el nombre del tipo. Cada título se genera a partir del tipo de registro, así que el conjunto de Monitor dice:

- **Find One Monitor** — leer un registro que coincida con la consulta.
- **Find Many Monitors** — leer una lista de registros que coincidan con la consulta.
- **Create One Monitor** — añadir un registro a partir de un objeto JSON.
- **Create Many Monitors** — añadir varios registros a partir de un array JSON.
- **Update One Monitor** — aplicar el payload de escritura a un registro que coincida.
- **Update Many Monitors** — aplicar el payload de escritura a registros que coincidan, hasta Limit.
- **Delete One Monitor** — eliminar un registro que coincida.
- **Delete Many Monitors** — eliminar registros que coincidan, hasta Limit.

El mismo conjunto te da tres disparadores: **On Create Monitor**, **On Update Monitor** y **On Delete Monitor**. Consulta [Disparadores de flujo de trabajo](/docs/workflows/triggers).

Un tipo solo ofrece los componentes que su modelo permite. Un tipo de solo lectura tiene los dos componentes Find y nada más, así que si no encuentras **Delete One Monitor** en el panel, ese tipo no lo permite.

Así es como un workflow puede leer y cambiar datos de OneUptime. Por ejemplo: un webhook de tu herramienta de CI puede usar **Create One Incident** para abrir un incidente con los detalles del fallo.

## Trabajar con registros

Cada campo de un componente de datos está indexado por los nombres de **columna** propios del registro; los mismos nombres que usa la API, no las etiquetas del formulario del panel. La columna del ID es `_id`. La grafía `id` se acepta como alias en cualquier lugar donde puedas escribir un nombre de columna, pero `_id` es lo que devuelve un registro, así que eso es lo que hay que leer al recibirlo:

```json
{ "_id": "00000000-0000-0000-0000-000000000000" }
```

**Query** decide sobre qué registros actúa el componente. Las claves son columnas, los valores son lo que hay que emparejar:

```json
{ "monitorType": "Website", "isEnabled": true }
```

Una consulta siempre está limitada al proyecto en el que se ejecuta el workflow. No puedes alcanzar los registros de otro proyecto, y no necesitas añadir el proyecto a la consulta tú mismo.

**JSON Object** en Create One, **JSON Array** en Create Many, y **Data (JSON Object)** en los componentes Update llevan los campos a escribir, indexados de la misma forma:

```json
{ "name": "Checkout API", "monitorType": "Website" }
```

Una clave que no es una columna se ignora en lugar de rechazarse; el registro de la ejecución nombra las que descartó, así que revisa allí cuando un campo no llegue. **Select Fields**, en los componentes Find y en los disparadores, usa las mismas claves de columna con valores `true`: `{"_id": true, "name": true}`.

**Skip** y **Limit** son dos campos numéricos en Find Many, Update Many y Delete Many; `Skip: 0` con `Limit: 100` toma los primeros cien resultados. Limit tiene un valor predeterminado de `10`, y en Update Many y Delete Many limita cuántos registros se escriben realmente, no solo cuántos se devuelven. Así que `Items Deleted: 10` significa que se eliminaron diez registros, no que diez coincidieron. Aumenta Limit cuando quieras cambiar más de diez.

**Success** y **Error** informan si la consulta se ejecutó, no lo que encontró. Una consulta que no coincide con nada devuelve `0` y sigue saliendo por Success; eso no es un fallo. Para ramificar según si algo coincidió, lee el conteo devuelto en un bloque **If / Else**.

## ¿Qué componente debería usar?

Unas cuantas reglas rápidas:

- Si hay un bloque dedicado para lo que quieres (Slack, Email, un registro de OneUptime), úsalo: obtienes mejor manejo de errores y registros más claros.
- Para cualquier otra API externa, usa **API**.
- Para resumir, clasificar o redactar texto a partir de datos de workflow explícitamente seleccionados, usa **Generate Text with AI**.
- Para dar forma a datos entre bloques, usa **Custom Code** o **JSON**.
- Para tomar acciones diferentes según un valor, usa **Conditions**.

## Qué leer a continuación

- [Variables de flujo de trabajo](/docs/workflows/variables) — pasar datos entre bloques.
- [Ejecuciones y registros de flujo de trabajo](/docs/workflows/runs-and-logs) — comprobar qué hizo cada bloque en una ejecución.
- [Configuración y seguridad del flujo de trabajo](/docs/workflows/configuration) — límites, propietarios y secretos.
