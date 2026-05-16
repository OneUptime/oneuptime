# Servidor MCP

El servidor MCP (Model Context Protocol) de OneUptime proporciona a los LLMs acceso directo a tu instancia de OneUptime, habilitando operaciones de monitoreo, gestión de incidentes y observabilidad impulsadas por IA.

## ¿Qué es el servidor MCP de OneUptime?

El servidor MCP de OneUptime es un puente entre los Modelos de Lenguaje Grande (LLMs) y tu instancia de OneUptime. Implementa el Model Context Protocol (MCP), lo que permite que asistentes de IA como Claude interactúen directamente con tu infraestructura de monitoreo.

## Cómo funciona

El servidor MCP se aloja junto a tu instancia de OneUptime y es accesible a través del transporte HTTP transmisible. No se requiere instalación local.

**Usuarios en la nube**: `https://oneuptime.com/mcp`
**Usuarios auto-alojados**: `https://your-oneuptime-domain.com/mcp`

## Características principales

- **Cobertura completa de la API**: Acceso a 711 puntos de conexión de la API de OneUptime
- **126 tipos de recursos**: Gestiona todos los recursos de OneUptime, incluyendo monitores, incidentes, equipos, sondas y más
- **Operaciones en tiempo real**: Crea, lee, actualiza y elimina recursos en tiempo real
- **Interfaz con tipos seguros**: Completamente tipado con validación de entrada exhaustiva
- **Autenticación segura**: Autenticación basada en clave de API con manejo adecuado de errores
- **Fácil integración**: Funciona con Claude Desktop y otros clientes compatibles con MCP
- **Gestión de sesiones**: Manejo de sesiones integrado con soporte de reconexión automática

## Qué puedes hacer

Con el servidor MCP de OneUptime, los asistentes de IA pueden ayudarte a:

- **Gestión de monitores**: Crear y configurar monitores, verificar su estado y gestionar grupos de monitores
- **Respuesta a incidentes**: Crear incidentes, agregar notas, asignar miembros del equipo y hacer seguimiento de la resolución
- **Operaciones de equipo**: Gestionar equipos, permisos y horarios de guardia
- **Páginas de estado**: Actualizar páginas de estado, crear anuncios y gestionar suscriptores
- **Alertas**: Configurar reglas de alerta, gestionar políticas de escalada y verificar registros de notificaciones
- **Sondas**: Implementar y gestionar sondas de monitoreo en diferentes ubicaciones
- **Informes y análisis**: Generar informes y analizar datos de monitoreo

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
"¿Qué monitores tengo en OneUptime?"
"Muéstrame los incidentes recientes"
"Crea un nuevo monitor para https://example.com"
```

#### Nota de seguridad

La configuración anterior usa variables de entrada con `"password": true` para solicitar de forma segura tu clave de API en lugar de almacenarla en texto plano. VS Code te pedirá confirmación de confianza al iniciar el servidor MCP por primera vez.

## Puntos de conexión disponibles

| Punto de conexión | Método | Descripción |
|----------|--------|-------------|
| `/mcp` | GET | Flujo de eventos enviados por el servidor para notificaciones de servidor a cliente |
| `/mcp` | POST | Solicitudes JSON-RPC para llamadas a herramientas y otras operaciones |
| `/mcp` | DELETE | Limpieza y terminación de sesión |
| `/mcp/health` | GET | Punto de conexión de verificación de salud |
| `/mcp/tools` | GET | API REST para listar herramientas disponibles |

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

## Verificación

Verifica que el servidor MCP esté en ejecución:

```bash
# Para OneUptime Cloud
curl https://oneuptime.com/mcp/health

# Para auto-alojado
curl https://your-oneuptime-domain.com/mcp/health
```

Lista las herramientas disponibles:

```bash
# Para OneUptime Cloud
curl https://oneuptime.com/mcp/tools

# Para auto-alojado
curl https://your-oneuptime-domain.com/mcp/tools
```

## Ejemplos de uso

### Consultas básicas de información

```
"¿Cuál es el estado actual de todos mis monitores?"
"Muéstrame los incidentes de las últimas 24 horas"
```

### Gestión de monitores

```
"Crea un nuevo monitor de sitio web para https://example.com que verifique cada 5 minutos"
"Configura un monitor de API para https://api.example.com/health con un tiempo de espera de 30 segundos"
"Cambia el intervalo de monitoreo de mi monitor de sitio web a cada 2 minutos"
"Deshabilita el monitor para staging.example.com mientras realizamos mantenimiento"
```

### Gestión de incidentes

```
"Crea un incidente de alta prioridad por la interrupción de la base de datos que afecta la autenticación de usuarios"
"Agrega una nota al incidente #123 que diga 'Conexión de base de datos restaurada, monitoreando estabilidad'"
"Marca el incidente #456 como resuelto"
"Asigna el incidente actual de la pasarela de pago al equipo de infraestructura"
```

### Equipo y guardia

```
"¿Quiénes son los miembros del equipo de infraestructura?"
"¿Quién está actualmente de guardia para el equipo de infraestructura?"
"Muéstrame el horario de guardia para esta semana"
```

### Gestión de páginas de estado

```
"Actualiza nuestra página de estado para mostrar 'Investigando problemas de pago' en el servicio de pagos"
"Crea un anuncio en la página de estado sobre el mantenimiento programado este fin de semana"
```

### Consultas de páginas de estado públicas (sin clave de API requerida)

Estas consultas funcionan sin autenticación, usando solo las herramientas públicas de páginas de estado:

```
"¿Cuál es el estado actual de status.example.com?"
"Muéstrame los incidentes recientes de la página de estado de OneUptime"
"¿Hay eventos de mantenimiento programado en status.acme.com?"
"Obtén los últimos anuncios de mi página de estado pública con ID abc123-..."
```

### Operaciones avanzadas

```
"Crea una ventana de mantenimiento programado para el sábado de 2 a 4 AM, deshabilita todos los monitores para api.example.com durante ese tiempo y actualiza la página de estado"
"Muéstrame todos los monitores que han estado caídos en la última hora, crea incidentes para los que no tengan uno"
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
- El servidor MCP usa el encabezado `mcp-session-id` para rastrear sesiones
- Asegúrate de que tu cliente maneje correctamente el ID de sesión devuelto por el servidor
- Las sesiones se limpian automáticamente cuando se cierran las conexiones

## Recursos disponibles

El servidor MCP proporciona acceso a 126 tipos de recursos, incluyendo:

**Monitoreo**: Monitor, MonitorStatus, MonitorGroup, Probe
**Incidentes**: Incident, IncidentState, IncidentNote, IncidentTemplate
**Alertas**: Alert, AlertState, AlertSeverity
**Páginas de estado**: StatusPage, StatusPageAnnouncement, StatusPageSubscriber
**Guardia**: On-CallPolicy, EscalationRule, On-CallSchedule
**Equipos**: Team, TeamMember, TeamPermission
**Telemetría**: TelemetryService, Log, Span, Metric
**Flujos de trabajo**: Workflow, WorkflowVariable, WorkflowLog

Cada recurso admite operaciones estándar: List, Count, Get, Create, Update y Delete.
