# Componentes

Los componentes son los nodos de acción que colocas después de un disparador. Cada uno hace un trabajo — realizar una petición HTTP, enviar un mensaje de Slack, ramificar según una condición, ejecutar un fragmento de JavaScript — y expone uno o más puertos de salida a los que conectar el siguiente nodo.

Esta página es un catálogo. Para las reglas de cableado y el lienzo en sí, consulta [Crear un flujo de trabajo](/docs/workflows/authoring).

## API

Realiza una petición HTTP saliente a cualquier URL.

**Argumentos**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH`, `DELETE`.
- **URL** — la URL de la petición. Interpolada.
- **Request Headers** — objeto JSON de headers.
- **Request Body** — cuerpo JSON o de texto para `POST` / `PUT` / `PATCH`.

**Puertos de salida**:

- `success` — se dispara cuando el estado de la respuesta es 2xx. Valores de retorno: `response-status`, `response-headers`, `response-body`.
- `error` — se dispara ante un fallo de red o una respuesta no 2xx. Valor de retorno: mensaje de `error`.

Úsalo para: cualquier API REST de terceros, tus propios endpoints de admin, integraciones ligeras que no tienen un componente dedicado.

## Webhook (saliente)

Un envoltorio fino sobre el componente API para el caso común de "disparar y olvidar". Publica un cuerpo JSON en una URL y expone un único par `success` / `error`.

Prefiere **API** si necesitas leer el cuerpo de la respuesta aguas abajo; prefiere **Webhook** si solo quieres notificar a otro sistema.

## Slack

Publica un mensaje en un canal de Slack utilizando la conexión de espacio de trabajo Slack de tu proyecto.

**Argumentos**:

- **Channel name** — el canal donde publicar. El bot ya debe ser miembro de ese canal.
- **Message text** — el cuerpo. Interpolado; admite mrkdwn de Slack.

Configura primero la conexión de espacio de trabajo en **Project Settings → Workspace Connections → Slack**. Consulta [Conexión de espacio de trabajo de Slack](/docs/workspace-connections/slack).

## Microsoft Teams

Publica un mensaje en un canal de Microsoft Teams utilizando la conexión Teams de tu proyecto.

**Argumentos**:

- **Team & channel** — el destino.
- **Message text** — el cuerpo.

Consulta [Conexión de espacio de trabajo de Microsoft Teams](/docs/workspace-connections/microsoft-teams) para la configuración de la conexión.

## Discord

Publica un mensaje en un canal de Discord mediante una URL de webhook entrante configurada en el componente.

## Telegram

Envía un mensaje a un chat de Telegram mediante un token de bot y un ID de chat configurados en el componente.

## Email

Envía un correo electrónico a través de la configuración SMTP de OneUptime.

**Argumentos**:

- **To** — dirección de correo electrónico del destinatario.
- **Subject** — interpolado.
- **Body** — Markdown o HTML.

El correo se envía desde la dirección de remitente configurada del proyecto (consulta [SMTP](/docs/emails/smtp)).

## Custom Code

Ejecuta un fragmento de JavaScript con acceso a las variables del flujo de trabajo y a los valores de retorno del nodo aguas arriba.

**Argumentos**:

- **Code** — el cuerpo JavaScript. El valor de la última expresión (o cualquier cosa devuelta desde `(async () => { ... })()`) se convierte en el valor de retorno del componente.
- **Arguments** — valores nombrados opcionales pasados como `args`.

**Puertos de salida**: `success` (valor de retorno), `error` (excepción capturada).

Úsalo para: transformar un payload entre dos sistemas, hacer un pequeño cálculo que no merece su propio componente, llamar a lógica exclusiva de JS. Las tareas más pesadas que deban ejecutarse dentro de tu propia infraestructura corresponden a un paso Bash o JavaScript de un [Runbook](/docs/runbooks/index).

## JSON

Convierte entre texto y JSON.

- **JSON → Text** — serializa un objeto JSON a una cadena (útil para canalizarlo al argumento `body` de un componente saliente que espera texto).
- **Text → JSON** — parsea una cadena en un objeto JSON. Útil cuando una API aguas arriba devolvió su cuerpo como texto pero necesitas leer un campo.

## Conditions

Ramifica con una comparación. Configura:

- **Left value** — típicamente una referencia interpolada como `{{Incident.title}}`.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — el valor con el que comparar.

**Puertos de salida**: `yes` y `no`. Cablea el resto del flujo de trabajo desde la rama que coincida con tu intención.

## Schedule (retraso)

Pausa un flujo de trabajo durante una duración configurada antes de continuar. Útil cuando necesitas dar a un sistema externo un momento para estabilizarse antes de comprobar su estado.

## Log

Escribe una línea en el registro de ejecución del flujo de trabajo. Pura ayuda de depuración; la línea queda capturada en la ejecución y visible en **Logs**. Sin efecto secundario externo.

## Execute Workflow

Llama a otro flujo de trabajo como un sub-paso. El flujo de trabajo llamado se ejecuta de forma independiente (disparar y olvidar) — el control regresa al llamador en cuanto se despacha la llamada.

Úsalo para extraer lógica compartida de varios flujos de trabajo: construye una vez un flujo "publicar-en-canal-de-incidentes" y llámalo desde cualquier otro flujo de trabajo que necesite notificar al canal.

Un límite de recursión previene que los flujos de trabajo se llamen entre sí en un bucle infinito. Consulta [Configuración y seguridad](/docs/workflows/configuration).

## Componentes de modelo (CRUD sobre entidades de OneUptime)

Para cada entidad de OneUptime que soporta flujos de trabajo (monitores, incidentes, alertas, páginas de estado, políticas de guardia, etc.), la paleta expone automáticamente los siguientes componentes — buscables por el nombre de la entidad:

- **Find One {Entity}** — obtener un único registro por consulta.
- **Find {Entity}** — obtener una lista de registros por consulta (paginada).
- **Create {Entity}** — insertar un nuevo registro.
- **Update {Entity}** — actualizar un registro por ID.
- **Delete {Entity}** — eliminar un registro por ID.
- **Count {Entity}** — contar registros que coinciden con una consulta.

Así es como un flujo de trabajo puede leer y escribir el estado de OneUptime sin salir de la plataforma. Por ejemplo: un webhook de tu herramienta de CI llama a **Create Incident** con el mensaje de fallo del build; o un flujo de trabajo programado ejecuta **Find Incident** cada cinco minutos y envía un resumen por correo electrónico.

## Elegir el componente adecuado

Algunas reglas rápidas:

- Si existe un componente dedicado para lo que quieres hacer (Slack, Email, un CRUD sobre una entidad de OneUptime), úsalo — te da un mejor manejo de errores y logs más claros que hacerlo tú mismo.
- Si necesitas llamar a una API HTTP externa que no tiene un componente dedicado, usa **API**.
- Si necesitas *darle forma* a los datos entre dos componentes, usa **Custom Code** o **JSON**.
- Si necesitas tomar acciones distintas según un valor, usa **Conditions**.

## Qué leer a continuación

- [Variables](/docs/workflows/variables) — cómo alimentar datos de un componente al siguiente.
- [Ejecuciones y registros](/docs/workflows/runs-and-logs) — cómo inspeccionar lo que devolvió cada componente durante una ejecución.
- [Configuración y seguridad](/docs/workflows/configuration) — límites, propiedad y secretos.
