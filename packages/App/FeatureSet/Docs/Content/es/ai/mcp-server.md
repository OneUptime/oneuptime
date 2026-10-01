# Servidor MCP

El servidor MCP (Model Context Protocol) de OneUptime proporciona a los LLMs acceso directo a tu instancia de OneUptime, habilitando operaciones de monitoreo, gestión de incidentes y observabilidad impulsadas por IA.

## ¿Qué es el servidor MCP de OneUptime?

El servidor MCP de OneUptime es un puente entre los Modelos de Lenguaje Grande (LLMs) y tu instancia de OneUptime. Implementa el Model Context Protocol (MCP), lo que permite que asistentes de IA como Claude interactúen directamente con tu infraestructura de monitoreo.

## Cómo funciona

El servidor MCP se aloja junto a tu instancia de OneUptime y es accesible a través del transporte HTTP transmisible (Streamable HTTP). No se requiere instalación local.

**Usuarios en la nube**: `https://oneuptime.com/mcp`
**Usuarios auto-alojados**: `https://your-oneuptime-domain.com/mcp`

## Características principales

- **~155 herramientas**: Herramientas CRUD completas para 22 tipos de recursos (incidentes, alertas, monitores, páginas de estado, guardia y más), herramientas de telemetría de solo lectura, además de herramientas de flujo de trabajo y auxiliares
- **Operaciones en tiempo real**: Crea, lee, actualiza y elimina recursos en tiempo real
- **Interfaz con tipos seguros**: Completamente tipada con validación de entrada exhaustiva
- **Autenticación segura**: Inicia sesión con tu cuenta de OneUptime (OAuth 2.1), o envía una clave de API por solicitud para agentes desatendidos
- **Anotaciones de seguridad**: Las herramientas de solo lectura llevan `readOnlyHint` y las herramientas de eliminación llevan `destructiveHint`, de modo que los clientes MCP pueden aprobar automáticamente las llamadas seguras y preguntar antes de las destructivas
- **Fácil integración**: Funciona con Claude Desktop y otros clientes compatibles con MCP
- **Sin estado por diseño**: Sin IDs de sesión — cada solicitud es autocontenida, por lo que el servidor funciona detrás de balanceadores de carga y despliegues con múltiples réplicas

## Qué puedes hacer

Con el servidor MCP de OneUptime, los asistentes de IA pueden ayudarte a:

- **Gestión de monitores**: Crear y configurar monitores, verificar su estado y revisar el historial de estados
- **Respuesta a incidentes**: Crear, reconocer y resolver incidentes, agregar notas internas o públicas y hacer seguimiento de la resolución
- **Operaciones de equipo**: Gestionar equipos y políticas de guardia
- **Páginas de estado**: Gestionar páginas de estado y crear anuncios
- **Alertas**: Reconocer y resolver alertas, agregar notas de alertas y gestionar estados y severidades de alertas
- **Mantenimiento programado**: Crear y gestionar eventos de mantenimiento programado
- **Telemetría**: Consultar registros, métricas, trazas, excepciones y registros de monitores (solo lectura)

## Requisitos

- Instancia de OneUptime (en la nube o auto-alojada)
- Cliente compatible con MCP (Claude Desktop, VS Code con GitHub Copilot, etc.)
- Una cuenta de OneUptime con la que iniciar sesión, o una clave de API de OneUptime para un agente que se ejecute de forma desatendida (solo se requieren para operaciones autenticadas; las herramientas públicas funcionan sin ninguna de las dos)

## Inicio de sesión con OneUptime

La forma más sencilla de conectarte es darle a tu cliente MCP la URL del servidor y nada más. La primera vez que necesita tus datos, el cliente abre una página de OneUptime en tu navegador, donde sigues estos pasos:

1. Inicia sesión en OneUptime, si aún no lo has hecho
2. Elige el proyecto en el que debe trabajar el cliente
3. Elige si el cliente tendrá acceso de **lectura y escritura** o de **solo lectura**
4. Haz clic en **Autorizar**

A partir de ahí, el cliente actúa en tu nombre en ese proyecto. No hay ninguna clave de API que crear, copiar o rotar, y no se guarda nada secreto en un archivo de configuración.

Qué puede hacer un cliente conectado:

- **Tiene tus permisos, y nunca más que esos.** Lo que tus equipos te permiten hacer en el proyecto es lo que puede hacer el cliente. Si tu rol cambia o dejas el proyecto, eso se aplica ya a la siguiente solicitud del cliente.
- **Solo lectura significa solo lectura.** Un cliente autorizado con acceso de solo lectura puede usar las herramientas `get_`, `list_` y `count_`. Las herramientas que crean, actualizan, eliminan, reconocen o resuelven son rechazadas, tanto por el servidor MCP como por la API de OneUptime que está detrás. Nunca puedes darle a un cliente más acceso del que pidió.
- **Es para un solo proyecto.** Para usar un segundo proyecto, conecta el cliente de nuevo y elige ese proyecto.
- **Funciona únicamente a través del servidor MCP.** El token de acceso del cliente se acepta en el punto de conexión MCP y en ningún otro lugar. No se puede usar para llamar directamente a la API REST de OneUptime.
- **Los administradores de la instancia no reciben un trato especial.** Un cliente conectado por un administrador maestro tiene lo que los equipos de esa persona conceden en el proyecto, no acceso a toda la instancia.

### Gestión de clientes conectados

Todos los clientes que se conectaron mediante inicio de sesión aparecen en **Ajustes del proyecto** → **Servidor MCP** → **Connected MCP Clients**, con quién los conectó, qué pueden hacer y cuándo se usaron por última vez. Tú ves los clientes que conectaste; los propietarios y administradores del proyecto ven los de todos.

Haz clic en **Disconnect** para cerrar la sesión de un cliente. El cliente deja de funcionar de inmediato.

Un cliente permanece conectado mientras se use. Uno que no se haya usado durante 30 días tiene que volver a iniciar sesión.

### Control de quién puede conectar clientes

De forma predeterminada, todos los miembros del proyecto pueden conectar un cliente MCP. Para impedir que los miembros de un equipo lo hagan, abre el equipo, ve a **Bloquear permisos** y agrega el permiso **Authorize MCP Client**. Los clientes que esos miembros ya habían conectado dejan de funcionar al instante.

Si el proyecto requiere inicio de sesión único, inicia sesión en el proyecto con SSO en tu navegador antes de autorizar un cliente. La conexión del cliente dura lo mismo que ese inicio de sesión con SSO; cuando este caduque, conecta el cliente de nuevo.

En OneUptime Cloud, conectar un cliente MCP está disponible en los mismos planes que las claves de API (Growth y superiores).

En la Enterprise Edition, cada cambio que hace un cliente conectado se anota en el registro de auditoría a nombre de la persona que lo conectó, junto con el nombre del cliente. Los cambios hechos con una clave de API muestran el nombre de la clave.

## Obtención de tu clave de API

Usa una clave de API para un agente que se ejecute de forma desatendida — una tarea programada o un pipeline de CI — donde no haya nadie para iniciar sesión.

1. Inicia sesión en tu instancia de OneUptime
2. Navega a **Ajustes** → **Claves API**
3. Haz clic en **Crear clave de API**
4. Proporciona un nombre (por ejemplo, "Servidor MCP")
5. Selecciona los permisos apropiados para tu caso de uso
6. Copia la clave de API generada

Las claves de API tienen alcance de proyecto: el servidor MCP infiere tu proyecto a partir de la clave, por lo que las herramientas de creación nunca necesitan un argumento `projectId`.

> **Advertencia — nunca entregues una clave maestra a un agente de IA.** Una clave de API *maestra* de OneUptime también se acepta en este encabezado y otorga acceso de administrador a toda la instancia. Usa siempre una clave de API de proyecto con el mínimo privilegio que el agente necesite (una clave de solo lectura es suficiente para todas las herramientas `get_`/`list_`/`count_`).

## Configuración

### Conexión mediante inicio de sesión

Agrega la URL del servidor a tu cliente sin credenciales. Usa `https://your-oneuptime-domain.com/mcp` para una instancia auto-alojada.

**Claude Code**

```bash
claude mcp add --transport http oneuptime https://oneuptime.com/mcp
```

Luego ejecuta `/mcp` dentro de Claude Code y elige **oneuptime** para iniciar sesión.

**Claude (web y escritorio)**

Abre **Customize** → **Connectors**, elige **Add custom connector** e ingresa `https://oneuptime.com/mcp`. Claude te pide que inicies sesión en OneUptime la primera vez que necesita tus datos.

**VS Code con GitHub Copilot**

Agrega esto a tu configuración MCP (consulta [VS Code con GitHub Copilot](#vs-code-con-github-copilot) para saber dónde está ese archivo). VS Code abre OneUptime para que inicies sesión cuando inicias el servidor:

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://oneuptime.com/mcp"
    }
  }
}
```

**Cursor**

```json
{
  "mcpServers": {
    "oneuptime": {
      "url": "https://oneuptime.com/mcp"
    }
  }
}
```

Cualquier otro cliente que admita la autorización MCP funciona igual: dale la URL y descubrirá por sí solo todo lo demás. Consulta [Inicio de sesión (OAuth 2.1)](#inicio-de-sesión-oauth-21) para ver los detalles del protocolo.

El resto de esta sección muestra los mismos clientes configurados, en cambio, con una clave de API.

### Configuración de Claude Desktop

Encuentra tu archivo de configuración de Claude Desktop:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

### Para OneUptime Cloud

Agrega la siguiente configuración:

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://oneuptime.com/mcp",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

### Para OneUptime auto-alojado

Reemplaza `oneuptime.com` con tu dominio de OneUptime:

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://your-oneuptime-domain.com/mcp",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

### Acceso público (sin clave de API)

Para usar solo herramientas públicas (información de páginas de estado, ayuda), puedes conectarte sin una clave de API:

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://oneuptime.com/mcp"
    }
  }
}
```

Esta configuración permite el acceso a las herramientas públicas de páginas de estado y recursos de ayuda sin requerir autenticación.

### VS Code con GitHub Copilot

VS Code admite servidores MCP de forma nativa con GitHub Copilot (versión 1.99+). Esto permite que Copilot acceda directamente a los datos de OneUptime.

#### Paso 1: Requisitos

- VS Code versión 1.99 o posterior
- Extensión de GitHub Copilot instalada y activada
- GitHub Copilot Chat habilitado

#### Paso 2: Abrir la configuración MCP

1. Presiona `Ctrl+Shift+P` (Windows/Linux) o `Cmd+Shift+P` (macOS)
2. Escribe "MCP: Open User Configuration" y presiona Enter
3. Esto abre o crea el archivo de configuración `mcp.json`

Como alternativa, crea `.vscode/mcp.json` en tu espacio de trabajo para una configuración específica del proyecto.

#### Para OneUptime Cloud

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://oneuptime.com/mcp",
      "headers": {
        "x-api-key": "${input:oneuptime-api-key}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "oneuptime-api-key",
      "description": "OneUptime API Key",
      "password": true
    }
  ]
}
```

#### Para OneUptime auto-alojado

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://your-oneuptime-domain.com/mcp",
      "headers": {
        "x-api-key": "${input:oneuptime-api-key}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "oneuptime-api-key",
      "description": "OneUptime API Key",
      "password": true
    }
  ]
}
```

#### Paso 3: Iniciar el servidor MCP

1. Presiona `Ctrl+Shift+P` / `Cmd+Shift+P`
2. Escribe "MCP: List Servers" para ver los servidores disponibles
3. Haz clic en "oneuptime" para iniciar el servidor
4. Cuando se solicite, ingresa tu clave de API de OneUptime

#### Paso 4: Usar con Copilot Chat

Abre GitHub Copilot Chat y usa el modo agente (`@workspace` o pregunta directamente):

```
"What monitors do I have in OneUptime?"
"Show me recent incidents"
"Create a new monitor for https://example.com"
```

#### Nota de seguridad

La configuración anterior usa variables de entrada con `"password": true` para solicitar de forma segura tu clave de API en lugar de almacenarla en texto plano. VS Code te pedirá confirmación de confianza al iniciar el servidor MCP por primera vez.

## Puntos de conexión disponibles

| Punto de conexión | Método | Descripción                                                                                                                    |
| ----------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `/mcp`            | POST   | Solicitudes JSON-RPC para llamadas a herramientas y otras operaciones                                                            |
| `/mcp`            | GET    | Sin un encabezado `Accept` de SSE: carga JSON amigable de descubrimiento. Con uno: `405` — el servidor sin estado no ofrece un flujo SSE independiente (los clientes conformes continúan sin él) |
| `/mcp`            | DELETE | Sin efecto (el servidor no tiene estado, por lo que no hay sesión que terminar)                                                  |
| `/mcp/health`     | GET    | Punto de conexión de verificación de salud                                                                                       |
| `/mcp/tools`      | GET    | API REST para listar herramientas disponibles                                                                                    |

Los clientes MCP que inician sesión también usan los puntos de conexión de OAuth que aparecen a continuación. Un cliente los encuentra por sí mismo; se enumeran aquí para quienes escriben un cliente o configuran un proxy.

| Punto de conexión                             | Método | Descripción                                                              |
| --------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| `/mcp/.well-known/oauth-protected-resource`   | GET    | Metadatos del recurso protegido (RFC 9728). También en `/.well-known/oauth-protected-resource/mcp` |
| `/.well-known/oauth-authorization-server/mcp` | GET    | Metadatos del servidor de autorización (RFC 8414). También en `/mcp/.well-known/oauth-authorization-server` |
| `/mcp/oauth/authorize`                        | GET    | Punto de conexión de autorización: adonde el cliente envía tu navegador para que inicies sesión |
| `/mcp/oauth/token`                            | POST   | Punto de conexión de tokens: canjea un código de autorización o un token de actualización |
| `/mcp/oauth/register`                         | POST   | Dynamic Client Registration (RFC 7591)                                   |
| `/mcp/oauth/revoke`                           | POST   | Revocación de tokens (RFC 7009)                                          |

## Autenticación

El servidor MCP admite tres modos de operación:

### Herramientas públicas (sin autenticación requerida)

Puedes conectarte al servidor MCP sin una clave de API para acceder a herramientas públicas:

- **`oneuptime_help`**: Obtener ayuda y orientación sobre las capacidades del MCP de OneUptime
- **`oneuptime_list_resources`**: Listar recursos disponibles y sus operaciones
- **`get_public_status_page_overview`**: Obtener una descripción general de una página de estado pública
- **`get_public_status_page_incidents`**: Obtener incidentes de una página de estado pública
- **`get_public_status_page_scheduled_maintenance`**: Obtener eventos de mantenimiento programado
- **`get_public_status_page_announcements`**: Obtener anuncios de una página de estado pública

Las herramientas de páginas de estado públicas aceptan un ID de página de estado (UUID) o el nombre de dominio de la página de estado.

### Inicio de sesión (OAuth 2.1)

Para todas las demás operaciones (gestión de monitores, incidentes, equipos, etc.), hay que identificar a quien hace la llamada. Un cliente que no envía credenciales y llama a una de estas herramientas recibe como respuesta `401 Unauthorized` y un encabezado `WWW-Authenticate` que apunta a los metadatos del recurso protegido del servidor. Esa es la señal ante la que actúa un cliente MCP para iniciar tu sesión; `initialize`, `tools/list` y las herramientas públicas nunca piden iniciar sesión.

El servidor implementa la [especificación de autorización de MCP](https://modelcontextprotocol.io/specification/latest/basic/authorization):

- **Flujo**: código de autorización de OAuth 2.1 con PKCE (solo `S256`). Los tokens de acceso se envían como `Authorization: Bearer`.
- **Descubrimiento**: metadatos del recurso protegido (RFC 9728) y metadatos del servidor de autorización (RFC 8414). El emisor y el recurso son ambos `https://<host>/mcp`.
- **Identidad del cliente**: un Client ID Metadata Document (el ID de cliente es una URL `https` que el servidor consulta) o Dynamic Client Registration (RFC 7591). Ningún cliente tiene que ser registrado por un administrador.
- **Ámbitos**: `mcp:read` para las herramientas `get_`, `list_` y `count_`; `mcp:write` agrega todas las herramientas que cambian algo, e incluye `mcp:read`. Un token de solo lectura que llama a una herramienta de escritura recibe como respuesta `403` y `error="insufficient_scope"`.
- **Vigencia de los tokens**: un token de acceso dura una hora. Un token de actualización dura 30 días y se reemplaza cada vez que se usa; usar un token de actualización que ya fue reemplazado termina la conexión.
- **Indicadores de recurso** (RFC 8707): un token se emite para `https://<host>/mcp` y no se acepta en ningún otro lugar.
- **Revocación** (RFC 7009): revocar cualquiera de los dos tokens termina la conexión.

### Clave de API

Un agente que se ejecuta de forma desatendida se autentica con una clave de API de OneUptime en uno de los siguientes encabezados:

- `x-api-key`: Tu clave de API de OneUptime
- `Authorization`: Token Bearer con tu clave de API (por ejemplo, `Bearer your-api-key-here`)

El esquema `Bearer` no distingue entre mayúsculas y minúsculas. A una solicitud que lleva una clave de API nunca se le pide iniciar sesión.

Los errores de herramientas se devuelven como resultados de herramienta dentro de banda (`isError: true`) con un `statusCode`, detalles y una sugerencia — no como errores del protocolo MCP — de modo que los agentes puedan leer el fallo y autocorregirse.

## Herramientas de flujo de trabajo

Más allá de las herramientas CRUD por recurso, el servidor incluye herramientas de flujo de trabajo diseñadas específicamente para la respuesta a incidentes y alertas:

- **`acknowledge_incident`** / **`resolve_incident`**: Mueven un incidente al estado Reconocido o Resuelto del proyecto — equivalente a presionar el botón en el panel de control
- **`acknowledge_alert`** / **`resolve_alert`**: Lo mismo para alertas
- **`add_incident_note`**: Agrega una nota a un incidente con `visibility: "internal"` (solo para el equipo, el valor predeterminado) o `visibility: "public"` (publicada en la página de estado). Se admite Markdown
- **`add_alert_note`**: Agrega una nota interna a una alerta

Un ciclo típico: `list_incidents` → `acknowledge_incident` → investigar con `list_logs` → `add_incident_note` (pública) → `resolve_incident`.

## Quién soy

La herramienta **`oneuptime_whoami`** devuelve el proyecto al que pertenecen tus credenciales (ID y nombre). Para un cliente que inició sesión, también devuelve con qué usuario inició sesión y si puede hacer cambios. Es una primera llamada útil para que un agente se oriente — y dado que las herramientas de creación infieren `projectId` a partir de las credenciales, el agente nunca necesita pasar un ID de proyecto.

## Consulta de telemetría

Los registros, métricas, trazas (spans), excepciones y registros de monitores se exponen como herramientas `list_` y `count_` de solo lectura (`list_logs`, `list_metrics`, `list_spans`, `list_exception_instances`, `list_monitor_logs` y sus contrapartes `count_`). La telemetría se ingiere a través de OpenTelemetry, por lo que no hay herramientas de creación.

Consulta siempre la telemetría con un filtro de rango de tiempo. Los campos de consulta aceptan un valor directo o un objeto de operador:

```json
{
  "query": {
    "time": { "_type": "GreaterThan", "value": "2026-07-04T00:00:00.000Z" }
  },
  "sort": { "time": "DESC" },
  "limit": 50
}
```

Operadores admitidos: `EqualTo`, `NotEqual`, `IsNull`, `NotNull`, `EqualToOrNull`, `GreaterThan`, `LessThan`, `GreaterThanOrEqual`, `LessThanOrEqual`, `InBetween`, `Search`, `Includes`. Los valores de ordenamiento son `"ASC"` o `"DESC"`.

## Selección de campos y paginación

Las herramientas `get_` y `list_` aceptan un arreglo opcional `select` con nombres de campos. De forma predeterminada se devuelven todos los campos legibles excepto los pesados (columnas JSON, de texto muy largo y HTML), que deben solicitarse explícitamente en `select`.

Las herramientas de listado paginan con `limit` (predeterminado 10, máximo 100) y `skip`, y cada respuesta de listado informa exactamente lo que devolvió:

```json
{
  "returnedCount": 10,
  "totalCount": 42,
  "skip": 0,
  "limit": 10,
  "hasMore": true,
  "data": ["..."]
}
```

## Verificación

Verifica que el servidor MCP esté en ejecución:

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/health

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/health
```

Lista las herramientas disponibles:

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/tools

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/tools
```

## Ejemplos de uso

### Consultas básicas de información

```
"What's the current status of all my monitors?"
"Show me incidents from the last 24 hours"
```

### Gestión de monitores

```
"Create a new website monitor for https://example.com that checks every 5 minutes"
"Set up an API monitor for https://api.example.com/health with a 30-second timeout"
"Change the monitoring interval for my website monitor to every 2 minutes"
"Disable the monitor for staging.example.com while we're doing maintenance"
```

### Gestión de incidentes

```
"Create a high-priority incident for the database outage affecting user authentication"
"Add a note to incident #123 saying 'Database connection restored, monitoring for stability'"
"Mark incident #456 as resolved"
"Assign the current payment gateway incident to the infrastructure team"
```

### Equipo y guardia

```
"List the teams in this project"
"Show me our on-call policies"
```

### Gestión de páginas de estado

```
"Update our status page to show 'Investigating Payment Issues' for the payment service"
"Create a status page announcement about scheduled maintenance this weekend"
```

### Consultas de páginas de estado públicas (sin clave de API requerida)

Estas consultas funcionan sin autenticación, usando solo las herramientas públicas de páginas de estado:

```
"What's the current status of status.example.com?"
"Show me recent incidents from the OneUptime status page"
"Are there any scheduled maintenance events on status.acme.com?"
"Get the latest announcements from my public status page with ID abc123-..."
```

### Operaciones avanzadas

```
"Create a scheduled maintenance window for Saturday 2-4 AM, disable all monitors for api.example.com during that time, and update the status page"
"Show me all monitors that have been down in the last hour, create incidents for any that don't already have one"
```

## Permisos de clave de API

### Acceso de solo lectura

Para ver datos únicamente, agrega permisos de lectura para tu clave de API.

### Acceso completo

Para acceso completo para crear, actualizar y eliminar recursos, asegúrate de que tu clave de API tenga permisos de administrador del proyecto.

### Buenas prácticas

- Usa permisos específicos: Solo otorga los permisos mínimos necesarios
- Rota las claves de API: Rota regularmente tus claves de API
- Monitorea el uso: Realiza un seguimiento del uso de claves de API en OneUptime
- Claves separadas: Usa diferentes claves de API para diferentes entornos

## Configuración para OneUptime auto-alojado

El inicio de sesión funciona sin configuración adicional en una instancia auto-alojada. Hay dos ajustes disponibles:

| Variable de entorno | Valor de Helm | Qué hace |
| --- | --- | --- |
| `DISABLE_MCP_OAUTH` | `mcpOAuth.disabled` | Establécelo en `true` para desactivar el inicio de sesión. Los puntos de conexión de OAuth dejan de servirse y el servidor MCP solo acepta claves de API. No se elimina nada; los clientes conectados vuelven a funcionar cuando se reactiva el inicio de sesión. |
| `DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS` | `mcpOAuth.disableClientIdMetadataDocuments` | Establécelo en `true` en una instancia que no puede acceder a internet. Un cliente puede identificarse con una URL que OneUptime consulta; con este ajuste, los clientes se registran, en su lugar, directamente en tu instancia, lo que no requiere ninguna solicitud saliente. |

Si ejecutas tu propio proxy inverso delante de OneUptime, reenvía `/.well-known/oauth-protected-resource` y `/.well-known/oauth-authorization-server` (y todo lo que haya debajo) a OneUptime junto con `/mcp`. El ingress incluido ya lo hace.

El servidor construye todas las URL de OAuth a partir de los ajustes `HOST` y `HTTP_PROTOCOL`, así que deben coincidir con la dirección que la gente usa para llegar a tu instancia.

## Solución de problemas

### Problemas de inicio de sesión

- **El cliente nunca me pide iniciar sesión**: puede que el cliente no admita la autorización MCP, o puede que esté configurado con un encabezado de clave de API, que tiene prioridad. Quita el encabezado para iniciar sesión en su lugar.
- **Mi proyecto aparece atenuado en la página de autorización**: la página indica el motivo junto al nombre del proyecto — el plan del proyecto no incluye la conexión de clientes MCP, el proyecto requiere SSO y este navegador no ha iniciado sesión en él con SSO, o tu equipo tiene bloqueada la conexión de clientes.
- **Una herramienta es rechazada con "read-only"**: el cliente fue autorizado con acceso de solo lectura. Conéctalo de nuevo y elige **Lectura y escritura**.
- **El cliente dejó de funcionar**: fue desconectado, no se usó durante 30 días, te quitaron del proyecto o el inicio de sesión con SSO del proyecto caducó. Conéctalo de nuevo.
- **Auto-alojado — el cliente informa que no puede encontrar el servidor de autorización**: comprueba que `HOST` y `HTTP_PROTOCOL` coincidan con tu dirección pública y que tu proxy reenvíe las rutas `/.well-known/oauth-*`.

### Errores de permisos

Asegúrate de que tu clave de API — o, en el caso de un cliente que inició sesión, tu propia cuenta — tenga los permisos necesarios:

- Acceso de lectura para listar recursos
- Acceso de escritura para crear/actualizar recursos
- Acceso de eliminación si deseas eliminar recursos

### Problemas de conexión

1. Verifica que la URL de tu instancia de OneUptime sea correcta
2. Comprueba que tu clave de API sea válida
3. Asegúrate de que tu instancia de OneUptime sea accesible
4. Prueba el punto de conexión de salud

### Clave de API no válida

- Verifica la clave de API en tu configuración de OneUptime
- Comprueba si hay espacios o caracteres adicionales
- Asegúrate de que la clave no haya expirado

### Errores de sesión

Si recibes errores relacionados con la sesión:

- El servidor MCP no tiene estado — no emite ni rastrea IDs de sesión, por lo que cada solicitud funciona contra cualquier réplica del servidor
- Los clientes que envían un encabezado `mcp-session-id` de una versión anterior del servidor pueden simplemente omitirlo; se ignora
- Actualiza las configuraciones de clientes MCP antiguos que esperan que el servidor devuelva un ID de sesión

## Recursos disponibles

El servidor MCP proporciona herramientas para los siguientes recursos:

**Monitoreo**: Monitor, Estado de monitor, Evento de estado de monitor
**Incidentes**: Incidente, Estado de incidente, Severidad de incidente, Línea de tiempo de estado de incidente, Nota pública de incidente, Nota interna de incidente
**Alertas**: Alerta, Estado de alerta, Severidad de alerta, Línea de tiempo de estado de alerta, Nota interna de alerta
**Páginas de estado**: Página de estado, Anuncio de página de estado
**Mantenimiento programado**: Evento de mantenimiento programado, Estado de mantenimiento programado, Línea de tiempo de estado de mantenimiento programado
**Equipos y guardia**: Equipo, Política de guardia
**Etiquetas**: Etiqueta
**Telemetría (solo lectura)**: Registro, Métrica, Span, Instancia de excepción, Registro de monitor

Cada recurso de base de datos admite las operaciones Create, Get, List, Update, Delete y Count a través de herramientas en snake_case — por ejemplo `create_incident`, `get_incident`, `list_incidents`, `update_incident`, `delete_incident`, `count_incidents`. Los recursos de telemetría exponen solo herramientas `list_` y `count_` (por ejemplo `list_logs`, `count_spans`).
