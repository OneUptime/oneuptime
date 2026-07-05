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
- **Autenticación segura**: Autenticación con clave de API por solicitud con manejo adecuado de errores
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
- Clave de API válida de OneUptime (solo requerida para operaciones autenticadas; las herramientas públicas funcionan sin ella)

## Obtención de tu clave de API

1. Inicia sesión en tu instancia de OneUptime
2. Navega a **Configuración** → **Claves de API**
3. Haz clic en **Crear clave de API**
4. Proporciona un nombre (por ejemplo, "Servidor MCP")
5. Selecciona los permisos apropiados para tu caso de uso
6. Copia la clave de API generada

Las claves de API tienen alcance de proyecto: el servidor MCP infiere tu proyecto a partir de la clave, por lo que las herramientas de creación nunca necesitan un argumento `projectId`.

> **Advertencia — nunca entregues una clave maestra a un agente de IA.** Una clave de API *maestra* de OneUptime también se acepta en este encabezado y otorga acceso de administrador a toda la instancia. Usa siempre una clave de API de proyecto con el mínimo privilegio que el agente necesite (una clave de solo lectura es suficiente para todas las herramientas `get_`/`list_`/`count_`).

## Configuración

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

## Autenticación

El servidor MCP admite dos modos de operación:

### Herramientas públicas (sin autenticación requerida)

Puedes conectarte al servidor MCP sin una clave de API para acceder a herramientas públicas:

- **`oneuptime_help`**: Obtener ayuda y orientación sobre las capacidades del MCP de OneUptime
- **`oneuptime_list_resources`**: Listar recursos disponibles y sus operaciones
- **`get_public_status_page_overview`**: Obtener una descripción general de una página de estado pública
- **`get_public_status_page_incidents`**: Obtener incidentes de una página de estado pública
- **`get_public_status_page_scheduled_maintenance`**: Obtener eventos de mantenimiento programado
- **`get_public_status_page_announcements`**: Obtener anuncios de una página de estado pública

Las herramientas de páginas de estado públicas aceptan un ID de página de estado (UUID) o el nombre de dominio de la página de estado.

### Herramientas autenticadas (clave de API requerida)

Para todas las demás operaciones (gestión de monitores, incidentes, equipos, etc.), se requiere autenticación a través de uno de los siguientes encabezados:

- `x-api-key`: Tu clave de API de OneUptime
- `Authorization`: Token Bearer con tu clave de API (por ejemplo, `Bearer your-api-key-here`)

El esquema `Bearer` no distingue entre mayúsculas y minúsculas. Los errores de herramientas se devuelven como resultados de herramienta dentro de banda (`isError: true`) con un `statusCode`, detalles y una sugerencia — no como errores del protocolo MCP — de modo que los agentes puedan leer el fallo y autocorregirse.

## Herramientas de flujo de trabajo

Más allá de las herramientas CRUD por recurso, el servidor incluye herramientas de flujo de trabajo diseñadas específicamente para la respuesta a incidentes y alertas:

- **`acknowledge_incident`** / **`resolve_incident`**: Mueven un incidente al estado Reconocido o Resuelto del proyecto — equivalente a presionar el botón en el panel de control
- **`acknowledge_alert`** / **`resolve_alert`**: Lo mismo para alertas
- **`add_incident_note`**: Agrega una nota a un incidente con `visibility: "internal"` (solo para el equipo, el valor predeterminado) o `visibility: "public"` (publicada en la página de estado). Se admite Markdown
- **`add_alert_note`**: Agrega una nota interna a una alerta

Un ciclo típico: `list_incidents` → `acknowledge_incident` → investigar con `list_logs` → `add_incident_note` (pública) → `resolve_incident`.

## Quién soy

La herramienta **`oneuptime_whoami`** devuelve el proyecto al que pertenece tu clave de API (ID y nombre). Es una primera llamada útil para que un agente se oriente — y dado que las herramientas de creación infieren `projectId` a partir de la clave de API, el agente nunca necesita pasar un ID de proyecto.

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

## Solución de problemas

### Errores de permisos

Asegúrate de que tu clave de API tenga los permisos necesarios:

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
