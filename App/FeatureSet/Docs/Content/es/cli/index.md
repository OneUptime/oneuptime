# CLI de OneUptime

La CLI de OneUptime es una interfaz de línea de comandos para gestionar tus recursos de OneUptime directamente desde la terminal. Admite operaciones CRUD completas en monitores, incidentes, alertas, páginas de estado y más.

## Características

- **Soporte multi-entorno** con contextos con nombre para producción, staging y desarrollo
- **Detección automática** de recursos disponibles en tu instancia de OneUptime
- **Autenticación flexible** mediante indicadores de CLI, variables de entorno o contextos guardados
- **Formato de salida inteligente** con modos de visualización JSON, tabla y wide
- **Admite scripting** para pipelines de CI/CD y flujos de trabajo de automatización

## Instalación

```bash
npm install -g @oneuptime/cli
```

## Inicio rápido

```bash
# Autenticarse con tu instancia de OneUptime
oneuptime login <your-api-key> https://oneuptime.com

# Listar tus monitores
oneuptime monitor list

# Ver un incidente específico
oneuptime incident get <incident-id>

# Ver todos los recursos disponibles
oneuptime resources
```

## Documentación

| Guía | Descripción |
|-------|-------------|
| [Autenticación](./authentication.md) | Inicio de sesión, contextos y gestión de credenciales |
| [Operaciones de recursos](./resource-operations.md) | Operaciones CRUD en monitores, incidentes, alertas y más |
| [Formatos de salida](./output-formats.md) | Modos de salida JSON, tabla y wide |
| [Scripting y CI/CD](./scripting.md) | Automatización, variables de entorno y uso en pipelines |
| [Referencia de comandos](./command-reference.md) | Referencia completa de todos los comandos y opciones |

## Opciones globales

Estos indicadores se pueden usar con cualquier comando:

| Indicador | Descripción |
|------|-------------|
| `--api-key <key>` | Reemplazar la clave de API para este comando |
| `--url <url>` | Reemplazar la URL de instancia para este comando |
| `--context <name>` | Usar un contexto con nombre específico |
| `-o, --output <format>` | Formato de salida: `json`, `table`, `wide` |
| `--no-color` | Deshabilitar la salida con colores |
| `--help` | Mostrar ayuda del comando |
| `--version` | Mostrar la versión de la CLI |

## Obtener ayuda

```bash
# Ayuda general
oneuptime --help

# Ayuda para un comando específico
oneuptime monitor --help
oneuptime monitor list --help
```
