# Componentes

Los componentes son los bloques de construcción que añades después del disparador. Cada uno hace una cosa —enviar un mensaje, llamar a una API, comprobar una condición— y se conecta a lo que viene a continuación.

Esta página es el catálogo. Para saber cómo arrastrarlos, soltarlos y conectarlos en el lienzo, consulta [Crear un Workflow](/docs/workflows/authoring).

## API

Realiza una solicitud HTTP a cualquier URL.

**Configuración**:

- **Método** — `GET`, `POST`, `PUT`, `PATCH` o `DELETE`.
- **URL** — la dirección a la que llamar.
- **Cabeceras** — cualquier cabecera a enviar.
- **Cuerpo** — el cuerpo de la solicitud para `POST` / `PUT` / `PATCH`.

**Salidas**:

- **Éxito** — se activa cuando la llamada funcionó (respuesta 2xx). Pasa el estado, las cabeceras y el cuerpo.
- **Error** — se activa ante un fallo de red o una respuesta no 2xx. Pasa el mensaje de error.

Úsalo para: cualquier API externa, tus propios endpoints administrativos o cualquier integración que no tenga su propio componente.

## Webhook (saliente)

Una versión más simple del componente API para casos de "disparar y olvidar". Publica un cuerpo JSON en una URL.

Usa **API** si necesitas leer la respuesta. Usa **Webhook** si solo quieres enviar una notificación y seguir adelante.

## Slack

Publica un mensaje en un canal de Slack.

**Configuración**:

- **Canal** — el nombre del canal. El bot ya debe estar en ese canal.
- **Mensaje** — el texto a enviar. Admite el formato de Slack.

Primero conecta Slack a tu proyecto en **Configuración del Proyecto → Conexiones de Espacio de Trabajo → Slack**. Consulta [Conexión de Espacio de Trabajo de Slack](/docs/workspace-connections/slack).

## Microsoft Teams

Publica un mensaje en un canal de Microsoft Teams.

**Configuración**:

- **Equipo y canal** — dónde publicar.
- **Mensaje** — el texto a enviar.

Consulta [Conexión de Espacio de Trabajo de Microsoft Teams](/docs/workspace-connections/microsoft-teams) para la configuración.

## Discord

Publica un mensaje en un canal de Discord mediante una URL de webhook entrante.

## Telegram

Envía un mensaje a un chat de Telegram usando un token de bot y un ID de chat.

## Correo electrónico

Envía un correo electrónico a través de OneUptime.

**Configuración**:

- **Para** — la dirección de correo del destinatario.
- **Asunto** — la línea de asunto.
- **Cuerpo** — el mensaje en Markdown o HTML.

El correo se envía desde el remitente configurado de tu proyecto; consulta [SMTP](/docs/emails/smtp).

## Código personalizado

Ejecuta un pequeño fragmento de JavaScript cuando necesitas algo que los otros bloques no pueden hacer.

**Configuración**:

- **Código** — tu JavaScript. El último valor (o lo que devuelvas de una función asíncrona) se convierte en la salida del bloque.
- **Argumentos** — valores con nombre que puedes pasar al código.

**Salidas**: éxito (tu valor devuelto) y error (cualquier excepción).

Úsalo para: reformatear datos entre dos sistemas, hacer un cálculo pequeño, cualquier cosa que no merezca su propio bloque. Para scripting más complejo, usa un [Runbook](/docs/runbooks/index) en su lugar.

## JSON

Convierte entre texto y JSON.

- **JSON → Texto** — convierte un objeto JSON en una cadena. Útil cuando el siguiente bloque espera texto.
- **Texto → JSON** — analiza una cadena para convertirla en un objeto JSON. Útil cuando algo llegó como texto y necesitas leer un campo.

## Condiciones

Ramifica según una comparación.

**Configuración**:

- **Valor izquierdo** — normalmente un valor de un bloque anterior.
- **Operador** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Valor derecho** — con qué comparar.

**Salidas**: **Sí** y **No**. Conecta los siguientes bloques a la rama que quieras.

## Retraso

Pausa el workflow durante un tiempo determinado antes de continuar. Útil cuando necesitas darle un momento a otro sistema para ponerse al día.

## Log

Escribe una línea en el registro de la ejecución. Sin efecto externo; simplemente aparece en los registros del workflow para que lo leas. Práctico para depurar.

## Ejecutar Workflow

Llama a otro workflow desde este. El workflow llamado se ejecuta por su cuenta; tu workflow continúa sin esperar a que termine.

Usa esto para compartir lógica común. Construye una vez un workflow "publicar en el canal de incidentes" y luego llámalo desde cualquier otro workflow que necesite notificar al canal.

Hay un límite de seguridad para que los workflows no se llamen unos a otros en bucle. Consulta [Configuración y Seguridad](/docs/workflows/configuration).

## Componentes de datos de OneUptime

Para cada tipo de registro en OneUptime (monitores, incidentes, alertas, páginas de estado, políticas de guardia y muchos más), la paleta tiene estos componentes: búscalos por el nombre del tipo:

- **Buscar Uno** — obtener un registro por ID o filtro.
- **Buscar** — obtener una lista de registros.
- **Crear** — añadir un nuevo registro.
- **Actualizar** — cambiar un registro.
- **Eliminar** — quitar un registro.
- **Contar** — contar registros que coinciden con un filtro.

Así es como un workflow puede leer y cambiar datos de OneUptime. Por ejemplo: un webhook de tu herramienta de CI puede usar **Crear Incidente** para abrir un incidente con los detalles del fallo.

## ¿Qué componente debo usar?

Algunas reglas rápidas:

- Si hay un bloque dedicado para lo que quieres (Slack, Email, un registro de OneUptime), úsalo: obtienes un mejor manejo de errores y registros más claros.
- Para cualquier otra API externa, usa **API**.
- Para reformatear datos entre bloques, usa **Código personalizado** o **JSON**.
- Para tomar diferentes acciones según un valor, usa **Condiciones**.

## Dónde seguir leyendo

- [Variables](/docs/workflows/variables) — pasar datos entre bloques.
- [Ejecuciones y Registros](/docs/workflows/runs-and-logs) — comprobar qué hizo cada bloque en una ejecución.
- [Configuración y Seguridad](/docs/workflows/configuration) — límites, propietarios y secretos.
