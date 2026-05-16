# Referencia de comandos

Referencia completa de todos los comandos de la CLI de OneUptime.

## Comandos de autenticación

### `oneuptime login`

Autenticarse con una instancia de OneUptime.

```bash
oneuptime login <api-key> <instance-url> [--context-name <name>]
```

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|----------|-------------|
| `<api-key>` | argumento | Sí | Clave de API para la autenticación |
| `<instance-url>` | argumento | Sí | URL de la instancia de OneUptime |
| `--context-name` | opción | No | Nombre del contexto (predeterminado: `"default"`) |

---

### `oneuptime context list`

Listar todos los contextos guardados.

```bash
oneuptime context list
```

---

### `oneuptime context use`

Cambiar a un contexto con nombre.

```bash
oneuptime context use <name>
```

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|----------|-------------|
| `<name>` | argumento | Sí | Nombre del contexto a activar |

---

### `oneuptime context current`

Mostrar el contexto activo con la clave de API enmascarada.

```bash
oneuptime context current
```

---

### `oneuptime context delete`

Eliminar un contexto guardado.

```bash
oneuptime context delete <name>
```

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|----------|-------------|
| `<name>` | argumento | Sí | Nombre del contexto a eliminar |

---

## Comandos de recursos

Todos los comandos de recursos siguen el mismo patrón. Reemplaza `<resource>` con cualquier nombre de recurso admitido (por ejemplo, `incident`, `monitor`, `alert`, `status-page`).

### `oneuptime <resource> list`

Listar recursos con filtrado y paginación.

```bash
oneuptime <resource> list [options]
```

| Opción | Tipo | Predeterminado | Descripción |
|--------|------|---------|-------------|
| `--query <json>` | cadena | Ninguno | Criterios de filtro en formato JSON |
| `--limit <n>` | número | `10` | Número máximo de resultados |
| `--skip <n>` | número | `0` | Resultados a omitir |
| `--sort <json>` | cadena | Ninguno | Orden de clasificación en formato JSON |
| `-o, --output` | cadena | `table` | Formato de salida |

---

### `oneuptime <resource> get`

Obtener un solo recurso por ID.

```bash
oneuptime <resource> get <id> [-o <format>]
```

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|----------|-------------|
| `<id>` | argumento | Sí | ID del recurso (UUID) |
| `-o, --output` | opción | No | Formato de salida |

---

### `oneuptime <resource> create`

Crear un nuevo recurso.

```bash
oneuptime <resource> create [--data <json> | --file <path>] [-o <format>]
```

| Opción | Tipo | Requerido | Descripción |
|--------|------|----------|-------------|
| `--data <json>` | cadena | Uno de `--data` o `--file` | Datos del recurso en formato JSON |
| `--file <path>` | cadena | Uno de `--data` o `--file` | Ruta al archivo JSON |
| `-o, --output` | cadena | No | Formato de salida |

---

### `oneuptime <resource> update`

Actualizar un recurso existente.

```bash
oneuptime <resource> update <id> --data <json> [-o <format>]
```

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|----------|-------------|
| `<id>` | argumento | Sí | ID del recurso |
| `--data <json>` | opción | Sí | Campos a actualizar en formato JSON |
| `-o, --output` | opción | No | Formato de salida |

---

### `oneuptime <resource> delete`

Eliminar un recurso.

```bash
oneuptime <resource> delete <id> [--force]
```

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|----------|-------------|
| `<id>` | argumento | Sí | ID del recurso |
| `--force` | opción | No | Omitir la solicitud de confirmación |

---

### `oneuptime <resource> count`

Contar recursos que coincidan con un filtro.

```bash
oneuptime <resource> count [--query <json>]
```

| Opción | Tipo | Predeterminado | Descripción |
|--------|------|---------|-------------|
| `--query <json>` | cadena | Ninguno | Criterios de filtro en formato JSON |

---

## Comandos de utilidad

### `oneuptime version`

Mostrar la versión de la CLI.

```bash
oneuptime version
```

---

### `oneuptime whoami`

Mostrar los detalles de autenticación actuales.

```bash
oneuptime whoami
```

Muestra la URL de la instancia y la clave de API enmascarada. Si hay un contexto guardado activo, también se muestra el nombre del contexto.

---

### `oneuptime resources`

Listar todos los tipos de recursos disponibles.

```bash
oneuptime resources [--type <type>]
```

| Opción | Tipo | Predeterminado | Descripción |
|--------|------|---------|-------------|
| `--type <type>` | cadena | Ninguno | Filtrar por `database` o `analytics` |

---

## Opciones globales

Estos indicadores están disponibles en todos los comandos:

| Opción | Descripción |
|--------|-------------|
| `--api-key <key>` | Reemplazar la clave de API |
| `--url <url>` | Reemplazar la URL de la instancia |
| `--context <name>` | Usar un contexto específico |
| `-o, --output <format>` | Formato de salida: `json`, `table`, `wide` |
| `--no-color` | Deshabilitar la salida con colores |
| `--help` | Mostrar ayuda |
| `--version` | Mostrar versión |

## Rutas de la API

Como referencia, la CLI asigna los comandos a estos puntos de conexión de la API:

| Comando | Método | Punto de conexión |
|---------|--------|----------|
| `list` | POST | `/api/<resource>/get-list` |
| `get` | POST | `/api/<resource>/<id>/get-item` |
| `create` | POST | `/api/<resource>` |
| `update` | PUT | `/api/<resource>/<id>/` |
| `delete` | DELETE | `/api/<resource>/<id>/` |
| `count` | POST | `/api/<resource>/count` |

Todas las solicitudes incluyen el encabezado `APIKey` para la autenticación.
