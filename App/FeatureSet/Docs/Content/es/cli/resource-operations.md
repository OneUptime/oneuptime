# Operaciones de recursos

La CLI de OneUptime proporciona operaciones CRUD (Crear, Leer, Actualizar, Eliminar) completas para todos los recursos admitidos. Los recursos se detectan automáticamente desde tu instancia de OneUptime.

## Recursos disponibles

Ejecuta el siguiente comando para ver todos los tipos de recursos disponibles:

```bash
oneuptime resources
```

Puedes filtrar por tipo:

```bash
# Mostrar solo recursos de base de datos
oneuptime resources --type database

# Mostrar solo recursos de análisis
oneuptime resources --type analytics
```

Los recursos comunes incluyen:

| Recurso | Comando |
|----------|---------|
| Incidente | `oneuptime incident` |
| Alerta | `oneuptime alert` |
| Monitor | `oneuptime monitor` |
| Estado del monitor | `oneuptime monitor-status` |
| Estado del incidente | `oneuptime incident-state` |
| Página de estado | `oneuptime status-page` |
| Política de guardia | `oneuptime on-call-policy` |
| Equipo | `oneuptime team` |
| Evento de mantenimiento programado | `oneuptime scheduled-maintenance-event` |

## Listar recursos

Recupera una lista de recursos con filtrado, paginación y ordenación opcionales.

```bash
oneuptime <resource> list [options]
```

**Opciones:**

| Opción | Descripción | Predeterminado |
|--------|-------------|---------|
| `--query <json>` | Criterios de filtro en formato JSON | Ninguno |
| `--limit <n>` | Número máximo de resultados | `10` |
| `--skip <n>` | Número de resultados a omitir | `0` |
| `--sort <json>` | Orden de clasificación en formato JSON | Ninguno |
| `-o, --output <format>` | Formato de salida | `table` |

**Ejemplos:**

```bash
# Listar los 10 incidentes más recientes
oneuptime incident list

# Filtrar incidentes por ID de estado
oneuptime incident list --query '{"currentIncidentStateId":"<state-id>"}'

# Listar con paginación
oneuptime incident list --limit 20 --skip 40

# Ordenar por fecha de creación (descendente)
oneuptime incident list --sort '{"createdAt":-1}'

# Salida en formato JSON
oneuptime incident list -o json
```

## Obtener un recurso

Recupera un solo recurso por su ID.

```bash
oneuptime <resource> get <id>
```

**Argumentos:**

| Argumento | Descripción |
|----------|-------------|
| `<id>` | El ID del recurso (UUID) |

**Ejemplos:**

```bash
# Obtener un incidente específico
oneuptime incident get 550e8400-e29b-41d4-a716-446655440000

# Obtener un monitor en formato JSON
oneuptime monitor get abc-123 -o json
```

## Crear un recurso

Crea un nuevo recurso a partir de JSON en línea o desde un archivo.

```bash
oneuptime <resource> create [options]
```

**Opciones:**

| Opción | Descripción |
|--------|-------------|
| `--data <json>` | Datos del recurso como objeto JSON |
| `--file <path>` | Ruta a un archivo JSON que contiene los datos del recurso |
| `-o, --output <format>` | Formato de salida |

Debes proporcionar `--data` o `--file`.

**Ejemplos:**

```bash
# Crear un incidente con JSON en línea
oneuptime incident create --data '{"title":"API Outage","currentIncidentStateId":"<state-id>","incidentSeverityId":"<severity-id>","declaredAt":"2025-01-15T10:30:00Z"}'

# Crear desde un archivo JSON
oneuptime incident create --file incident.json

# Crear y mostrar en JSON para capturar el ID
oneuptime monitor create --data '{"name":"API Health Check"}' -o json
```

## Actualizar un recurso

Actualiza un recurso existente por ID.

```bash
oneuptime <resource> update <id> [options]
```

**Argumentos:**

| Argumento | Descripción |
|----------|-------------|
| `<id>` | El ID del recurso |

**Opciones:**

| Opción | Descripción |
|--------|-------------|
| `--data <json>` | Campos a actualizar en formato JSON (requerido) |
| `-o, --output <format>` | Formato de salida |

**Ejemplos:**

```bash
# Cambiar el estado de un incidente (por ejemplo, a resuelto)
oneuptime incident update abc-123 --data '{"currentIncidentStateId":"<resolved-state-id>"}'

# Renombrar un monitor
oneuptime monitor update abc-123 --data '{"name":"Updated Monitor Name"}'
```

## Eliminar un recurso

Elimina un recurso por ID.

```bash
oneuptime <resource> delete <id> [--force]
```

**Argumentos:**

| Argumento | Descripción |
|----------|-------------|
| `<id>` | El ID del recurso |

**Opciones:**

| Opción | Descripción |
|--------|-------------|
| `--force` | Omitir la solicitud de confirmación |

**Ejemplos:**

```bash
oneuptime incident delete abc-123
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000

# Omitir la confirmación
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000 --force
```

## Contar recursos

Cuenta los recursos que coincidan con criterios de filtro opcionales.

```bash
oneuptime <resource> count [options]
```

**Opciones:**

| Opción | Descripción |
|--------|-------------|
| `--query <json>` | Criterios de filtro en formato JSON |

**Ejemplos:**

```bash
# Contar todos los incidentes
oneuptime incident count

# Contar incidentes por estado
oneuptime incident count --query '{"currentIncidentStateId":"<state-id>"}'

# Contar monitores
oneuptime monitor count
```

## Recursos de análisis

Los recursos de análisis admiten un conjunto limitado de operaciones en comparación con los recursos de base de datos:

| Operación | Compatible |
|-----------|-----------|
| `list` | Sí |
| `create` | Sí |
| `count` | Sí |
| `get` | No |
| `update` | No |
| `delete` | No |

Usa `oneuptime resources --type analytics` para ver qué recursos de análisis están disponibles en tu instancia.
