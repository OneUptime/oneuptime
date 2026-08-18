# Componentes

Los componentes son las piezas que añades después del disparador. Cada uno hace una sola cosa — enviar un mensaje, llamar a una API, comprobar una condición — y se conecta con lo que venga a continuación.

Esta página es el catálogo. Para saber cómo añadirlos y conectarlos en el lienzo, consulta [Crear un flujo de trabajo](/docs/workflows/authoring).

## API

Hace una petición HTTP a cualquier URL.

**Settings**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH` o `DELETE`.
- **URL** — la dirección a la que llamar.
- **Headers** — las cabeceras que quieras enviar.
- **Body** — el cuerpo de la petición, para `POST` / `PUT` / `PATCH`.

**Outputs**:

- **Success** — se activa cuando la llamada salió bien (respuesta 2xx). Pasa adelante el estado, las cabeceras y el cuerpo.
- **Error** — se activa ante un fallo de red o una respuesta que no sea 2xx. Pasa adelante el mensaje de error.

Úsalo para: cualquier API externa, tus propios endpoints de administración o cualquier integración que no tenga componente propio.

## AI

### Generate Text with AI

Genera una respuesta de texto a partir de un prompt y de un contexto JSON opcional. El componente usa el proveedor de LLM predeterminado configurado en el proyecto y recurre al proveedor global de la instalación cuando lo hay. Las credenciales y los endpoints del proveedor se configuran de forma centralizada; no son argumentos del flujo de trabajo.

**Settings**:

- **System Instructions** — indicaciones opcionales sobre el papel, el tono y las restricciones del modelo.
- **Prompt** — la tarea, obligatoria. Puede incluir variables del flujo de trabajo y salidas de componentes anteriores.
- **Context** — JSON opcional que decides incluir en la petición. Se añade después de un marcador explícito de fin de mensaje de confianza y se trata como dato no fiable durante el resto del mensaje.
- **Temperature** — la variación, de `0` a `1`. El valor predeterminado es `0.2`, pensado para una automatización predecible.
- **Maximum Output Tokens** — de `1` a `4096`. El valor predeterminado es `1024`.

La suma de System Instructions, Prompt y el Context serializado está limitada a 50.000 caracteres. La petición al proveedor dura como máximo 60 segundos y se intenta una sola vez. Por proyecto pueden ejecutarse a la vez tres peticiones de AI de flujo de trabajo como mucho.

**Outputs**:

- **Response** — el texto generado.
- **Provider** y **Model** — la configuración usada en la llamada.
- **Total Tokens** y **Completion Tokens** — el consumo que reporta el proveedor.
- **LLM Log ID** — la entrada de registro de AI contabilizada para esta llamada.
- **Error** — el error de validación, de acceso, del proveedor, de presupuesto, de facturación o de tiempo de espera, cuando lo hay.

Conecta **Success** a los componentes que deban usar la respuesta. Conecta **Error** a un camino explícito de reserva, aviso o registro. El componente hace una única petición al modelo, sin definiciones de herramientas ni campos de capacidades propias del proveedor: por sí solo no puede consultar OneUptime, llamar a APIs ni cambiar datos del proyecto. Además de las instrucciones fijas de seguridad de componente de OneUptime, al proveedor solo se le envían las System Instructions, el Prompt y el Context que tú configures, una vez resueltas las variables del flujo de trabajo en esos campos. El proveedor y el modelo configurados siguen siendo una frontera de confianza, porque un modelo puede tener capacidades intrínsecas gestionadas por el proveedor.

La salida del modelo es texto no fiable. Revísala antes de enviar comunicaciones a clientes, y no uses texto libre generado por AI como única autorización para acciones destructivas del flujo de trabajo. Consulta [Configuración y seguridad del flujo de trabajo](/docs/workflows/configuration) para los detalles de proveedor, salida de datos, registro y coste.

## Webhook (saliente)

Una versión más sencilla del componente API para los casos de «dispara y olvida». Publica un cuerpo JSON en una URL.

Usa **API** si necesitas leer la respuesta. Usa **Webhook** si solo quieres enviar un aviso y seguir.

## Slack

Publica un mensaje en un canal de Slack.

**Settings**:

- **Canal** — el nombre del canal. El bot ya tiene que estar en ese canal.
- **Mensaje** — el texto a enviar. Admite el formato de Slack.

Conecta antes Slack a tu proyecto en **Ajustes del proyecto → Espacio de trabajo → Slack**. Consulta [Slack Workspace Connection](/docs/workspace-connections/slack).

## Microsoft Teams

Publica un mensaje en un canal de Microsoft Teams.

**Settings**:

- **Team and channel** — dónde publicar.
- **Mensaje** — el texto a enviar.

Consulta [Microsoft Teams Workspace Connection](/docs/workspace-connections/microsoft-teams) para la configuración.

## Discord

Publica un mensaje en un canal de Discord a través de una URL de webhook entrante.

## Telegram

Envía un mensaje a un chat de Telegram usando un token de bot y un ID de chat.

## Correo electrónico

Envía un correo a través de OneUptime.

**Settings**:

- **Para** — la dirección de correo del destinatario.
- **Asunto** — la línea de asunto.
- **Body** — el mensaje, en Markdown o HTML.

El correo sale desde el remitente configurado en tu proyecto — consulta [SMTP](/docs/emails/smtp).

## Custom Code

Ejecuta un trozo pequeño de JavaScript cuando necesites algo que los demás bloques no cubren.

**Settings**:

- **Código** — tu JavaScript. El último valor (o lo que devuelvas desde una función async) se convierte en la salida del bloque.
- **Arguments** — valores con nombre que puedes pasarle.

**Outputs**: éxito (tu valor de retorno) y error (cualquier excepción).

Úsalo para: transformar datos entre dos sistemas, hacer un cálculo pequeño, cualquier cosa que no merezca un bloque propio. Para scripts más pesados, usa un [Runbook](/docs/runbooks/index) en su lugar.

## JSON

Convierte entre texto y JSON.

- **JSON → Text** — convierte un objeto JSON en una cadena. Útil cuando el bloque siguiente espera texto.
- **Text → JSON** — convierte una cadena en un objeto JSON. Útil cuando algo llegó como texto y necesitas leer un campo.

## Condiciones

Se ramifica según una comparación. En el panel **Add Component** este bloque se llama **If / Else** y está en la categoría Condiciones.

**Settings**:

- **Left value** — normalmente un valor de un bloque anterior.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — con qué comparar.

**Outputs**: **Sí** y **No**. Conecta los bloques siguientes a la rama que te interese.

## Delay

Pausa el flujo de trabajo un rato antes de continuar. Va bien cuando necesitas darle un momento a otro sistema para ponerse al día.

## Registro

Escribe una línea en el registro de la ejecución. No tiene ningún efecto externo — simplemente aparece en los registros del flujo de trabajo para que la leas. Muy práctico para depurar.

## Execute Workflow

Llama a otro flujo de trabajo desde este. El flujo llamado se ejecuta por su cuenta — el tuyo sigue adelante sin esperar a que termine.

Úsalo para compartir lógica común. Construye una vez un flujo de trabajo de «publicar en el canal del incidente» y llámalo desde cualquier otro que necesite avisar al canal.

Hay un límite de seguridad para que los flujos de trabajo no acaben llamándose entre ellos en bucle. Consulta [Configuración y seguridad del flujo de trabajo](/docs/workflows/configuration).

## Componentes de datos de OneUptime

Para cada tipo de registro de OneUptime (monitores, incidentes, alertas, páginas de estado, políticas de guardia y muchos más), el panel **Add Component** ofrece estos componentes — búscalos por el nombre del tipo. Cada título se genera a partir del tipo de registro, así que el juego de Monitor queda así:

- **Find One Monitor** — lee un registro que coincida con la consulta.
- **Find Many Monitors** — lee una lista de registros que coincidan con la consulta.
- **Create One Monitor** — añade un registro a partir de un objeto JSON.
- **Create Many Monitors** — añade varios registros a partir de un array JSON.
- **Update One Monitor** — aplica los datos de escritura a un registro que coincida.
- **Update Many Monitors** — aplica los datos de escritura a los registros que coincidan, hasta el Limit.
- **Delete One Monitor** — elimina un registro que coincida.
- **Delete Many Monitors** — elimina los registros que coincidan, hasta el Limit.

El mismo juego te da tres disparadores — **On Create Monitor**, **On Update Monitor** y **On Delete Monitor**. Consulta [Disparadores de flujo de trabajo](/docs/workflows/triggers).

Cada tipo ofrece solo los componentes que su modelo permite. Un tipo de solo lectura tiene los dos componentes Find y nada más, así que si no encuentras **Delete One Monitor** en el panel, es que ese tipo no lo admite.

Así es como un flujo de trabajo lee y modifica datos de OneUptime. Por ejemplo: un webhook de tu herramienta de CI puede usar **Create One Incident** para abrir un incidente con los detalles del fallo.

## Trabajar con registros

Todos los campos de un componente de datos van por los nombres de **columna** del propio registro — los mismos nombres que usa la API, no las etiquetas del formulario del panel. La columna de ID es `_id`. La forma `id` se acepta como alias en cualquier sitio donde puedas escribir un nombre de columna, pero lo que devuelve un registro es `_id`, así que eso es lo que hay que leer a la salida:

```json
{ "_id": "00000000-0000-0000-0000-000000000000" }
```

**Query** decide sobre qué registros actúa el componente. Las claves son columnas y los valores, lo que debe coincidir:

```json
{ "monitorType": "Website", "isEnabled": true }
```

Una consulta siempre está acotada al proyecto en el que se ejecuta el flujo de trabajo. No puedes llegar a los registros de otro proyecto, y tampoco hace falta que añadas el proyecto a la consulta.

**JSON Object** en Create One, **JSON Array** en Create Many y **Data (JSON Object)** en los componentes Update llevan los campos que se van a escribir, con las mismas claves:

```json
{ "name": "Checkout API", "monitorType": "Website" }
```

Una clave que no sea una columna se ignora en lugar de rechazarse — el registro de la ejecución nombra las que descartó, así que míralo ahí cuando un campo no cuaje. **Select Fields**, en los componentes Find y en los disparadores, usa esas mismas claves de columna con valores `true`: `{"_id": true, "name": true}`.

**Omitir** y **Limit** son dos campos numéricos de Find Many, Update Many y Delete Many — `Skip: 0` con `Limit: 100` se queda con las cien primeras coincidencias. Limit vale `10` por defecto, y en Update Many y Delete Many limita cuántos registros se escriben de verdad, no solo cuántos se devuelven. Así que `Items Deleted: 10` significa que se eliminaron diez registros, no que coincidieran diez. Sube el Limit cuando de verdad quieras cambiar más de diez.

**Success** y **Error** te dicen si la consulta se ejecutó, no qué encontró. Una consulta que no encuentra nada devuelve `0` y sale igualmente por Success — eso no es un fallo. Para ramificar según si hubo coincidencias, lee el recuento devuelto en un bloque **If / Else**.

## ¿Qué componente uso?

Unas cuantas reglas rápidas:

- Si hay un bloque dedicado a lo que quieres (Slack, correo electrónico, un registro de OneUptime), úsalo — ganas mejor gestión de errores y registros más claros.
- Para cualquier otra API externa, usa **API**.
- Para resumir, clasificar o redactar texto a partir de datos del flujo de trabajo que hayas seleccionado explícitamente, usa **Generate Text with AI**.
- Para transformar datos entre bloques, usa **Custom Code** o **JSON**.
- Para hacer cosas distintas según un valor, usa **Condiciones**.

## Qué leer a continuación

- [Variables de flujo de trabajo](/docs/workflows/variables) — pasar datos entre bloques.
- [Ejecuciones y registros de flujo de trabajo](/docs/workflows/runs-and-logs) — comprobar qué hizo cada bloque en una ejecución.
- [Configuración y seguridad del flujo de trabajo](/docs/workflows/configuration) — límites, propietarios y secretos.
