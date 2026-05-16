# Autenticación

La CLI de OneUptime admite múltiples formas de autenticarse con tu instancia de OneUptime. Puedes usar contextos con nombre, variables de entorno o pasar credenciales directamente como indicadores.

## Inicio de sesión

Autentícate con tu instancia de OneUptime usando una clave de API:

```bash
oneuptime login <api-key> <instance-url>
```

**Argumentos:**

| Argumento | Descripción |
|----------|-------------|
| `<api-key>` | Tu clave de API de OneUptime (por ejemplo, `sk-your-api-key`) |
| `<instance-url>` | La URL de tu instancia de OneUptime (por ejemplo, `https://oneuptime.com`) |

**Opciones:**

| Opción | Descripción |
|--------|-------------|
| `--context-name <name>` | Nombre para este contexto (predeterminado: `"default"`) |

**Ejemplos:**

```bash
# Iniciar sesión con el contexto predeterminado
oneuptime login sk-abc123 https://oneuptime.com

# Iniciar sesión con un contexto con nombre
oneuptime login sk-abc123 https://oneuptime.com --context-name production

# Configurar múltiples entornos
oneuptime login sk-prod-key https://oneuptime.com --context-name production
oneuptime login sk-staging-key https://staging.oneuptime.com --context-name staging
```

## Contextos

Los contextos te permiten guardar y cambiar entre múltiples entornos de OneUptime (por ejemplo, producción, staging, desarrollo).

### Listar contextos

```bash
oneuptime context list
```

Muestra todos los contextos configurados. El contexto actual está marcado con `*`.

### Cambiar de contexto

```bash
oneuptime context use <name>
```

Cambia a un contexto con nombre diferente para todos los comandos posteriores.

```bash
# Cambiar a staging
oneuptime context use staging

# Cambiar a producción
oneuptime context use production
```

### Ver el contexto actual

```bash
oneuptime context current
```

Muestra el contexto activo actual, incluyendo la URL de instancia y una clave de API enmascarada.

### Eliminar un contexto

```bash
oneuptime context delete <name>
```

Elimina un contexto con nombre. Si el contexto eliminado es el actual, la CLI cambia automáticamente al primer contexto restante.

## Resolución de credenciales

Las credenciales se resuelven en el siguiente orden de prioridad:

1. **Indicadores de CLI** (`--api-key` y `--url`)
2. **Variables de entorno** (`ONEUPTIME_API_KEY` y `ONEUPTIME_URL`)
3. **Contexto con nombre** (a través del indicador `--context`)
4. **Contexto actual** (desde la configuración guardada)

Puedes mezclar fuentes; por ejemplo, usar una variable de entorno para la clave de API y un contexto guardado para la URL.

### Uso de indicadores de CLI

```bash
oneuptime --api-key sk-abc123 --url https://oneuptime.com incident list
```

### Uso de variables de entorno

```bash
export ONEUPTIME_API_KEY=sk-abc123
export ONEUPTIME_URL=https://oneuptime.com

oneuptime incident list
```

### Uso de un contexto específico

```bash
oneuptime --context production incident list
```

## Verificar la autenticación

Verifica tu estado de autenticación actual:

```bash
oneuptime whoami
```

Esto muestra:
- URL de instancia
- Clave de API enmascarada
- Nombre del contexto actual (solo se muestra si hay un contexto guardado activo)

Si no estás autenticado, el comando muestra un mensaje útil sugiriendo que ejecutes `oneuptime login`.

## Archivo de configuración

Las credenciales se almacenan en `~/.oneuptime/config.json` con permisos restringidos (`0600`).

```json
{
  "currentContext": "production",
  "contexts": {
    "production": {
      "name": "production",
      "apiUrl": "https://oneuptime.com",
      "apiKey": "sk-..."
    },
    "staging": {
      "name": "staging",
      "apiUrl": "https://staging.oneuptime.com",
      "apiKey": "sk-..."
    }
  },
  "defaults": {
    "output": "table",
    "limit": 10
  }
}
```
