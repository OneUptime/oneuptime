# Proveedor Terraform de OneUptime

El Proveedor Terraform de OneUptime te permite gestionar recursos de OneUptime usando Infraestructura como Código (IaC). Este proveedor te permite configurar monitoreo, gestión de incidentes, páginas de estado y otras características de OneUptime a través de Terraform.

## Tabla de contenidos

- [Instalación](#installation)
- [Configuración del proveedor](#provider-configuration)
- [Inicio rápido](#quick-start)
- [Compatibilidad de versiones](#version-compatibility)
- [Recursos disponibles](#available-resources)
- [Ejemplos](#examples)
- [Buenas prácticas](#best-practices)
- [Guía de migración](#migration-guide)

## Instalación

### Desde el Registro de Terraform (recomendado)

El proveedor Terraform de OneUptime está disponible en el [Registro de Terraform](https://registry.terraform.io/providers/oneuptime/oneuptime).

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Usa la última versión 7.x
    }
  }
  required_version = ">= 1.0"
}
```

### Fijación de versión para instalaciones auto-alojadas

⚠️ **Importante para clientes auto-alojados**: Siempre fija la versión del proveedor Terraform para que coincida con la versión de tu instalación de OneUptime y garantizar la compatibilidad de la API.

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Fija a la versión exacta que coincida con tu instalación de OneUptime
    }
  }
  required_version = ">= 1.0"
}
```

#### Encontrar tu versión de OneUptime

Puedes encontrar tu versión de OneUptime de varias formas:

1. **Panel**: Ve a Configuración → Acerca de en tu panel de OneUptime
2. **API**: Llama al punto de conexión `GET /api/status`
3. **Docker**: Comprueba la etiqueta de imagen que estás usando
4. **Helm**: Comprueba tu versión del gráfico Helm

```bash
# Ejemplo: Si ejecutas OneUptime 7.0.123
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"
    }
  }
}
```

## Configuración del proveedor

### Configuración básica

```hcl
provider "oneuptime" {
  oneuptime_url = "https://your-oneuptime-instance.com"  # O https://oneuptime.com para la nube
  api_key       = var.oneuptime_api_key
}
```

### Variables de entorno

Puedes configurar el proveedor usando variables de entorno:

```bash
export ONEUPTIME_URL="https://your-oneuptime-instance.com"
export ONEUPTIME_API_KEY="your-api-key-here"
```

Luego usa el proveedor sin configuración explícita:

```hcl
provider "oneuptime" {
  # La configuración se leerá de las variables de entorno
}
```

### Opciones de configuración

| Argumento | Variable de entorno | Descripción | Requerido |
|----------|---------------------|-------------|----------|
| `oneuptime_url` | `ONEUPTIME_URL` | URL de OneUptime | Sí |
| `api_key` | `ONEUPTIME_API_KEY` | Clave de API de OneUptime | Sí |

## Inicio rápido

### 1. Crear clave de API

Primero, crea una clave de API en tu panel de OneUptime:

1. Ve a **Configuración** → **Claves de API**
2. Haz clic en **Crear clave de API**
3. Dale un nombre descriptivo (por ejemplo, "Automatización Terraform")
4. Selecciona los permisos apropiados
5. Copia la clave de API generada

### 2. Configuración básica de Terraform

Crea un archivo `main.tf`:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"  # Usa la URL de tu instancia
  api_key       = var.oneuptime_api_key
}

# Nota: Los proyectos deben crearse manualmente en el panel de OneUptime
variable "project_id" {
  description = "ID del proyecto de OneUptime"
  type        = string
}

# Crea un monitor
resource "oneuptime_monitor" "website" {
  name        = "Monitor de sitio web"
  description = "Monitor para el tiempo de actividad del sitio web"
  data        = jsonencode({
    url = "https://example.com"
    interval = "5m"
    timeout = "30s"
  })
}

# Crea un equipo
resource "oneuptime_team" "platform" {
  name        = "Equipo de plataforma"
  description = "Equipo de ingeniería de plataforma"
}
    value = "alerts@example.com"
  }
}
```

### 3. Inicializar y aplicar

```bash
# Inicializar Terraform
terraform init

# Planificar los cambios
terraform plan

# Aplicar la configuración
terraform apply
```

## Compatibilidad de versiones

### Clientes en la nube

Para clientes de OneUptime Cloud, usa la última versión del proveedor:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Siempre obtiene la última versión compatible 7.x
    }
  }
}
```

### Clientes auto-alojados

**Crítico**: Los clientes auto-alojados deben fijar la versión del proveedor para que coincida con su instalación de OneUptime:

| Versión de OneUptime | Versión del proveedor | Configuración |
|-------------------|------------------|---------------|
| 7.0.x | 7.0.x | `version = "~> 7.0.0"` |
| 7.1.x | 7.1.x | `version = "~> 7.1.0"` |
| 7.2.x | 7.2.x | `version = "~> 7.2.0"` |

Ejemplo para OneUptime 7.0.123:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Coincidencia exacta de versión
    }
  }
}
```

## Recursos disponibles

El proveedor Terraform de OneUptime admite los siguientes recursos:

### Recursos principales
- `oneuptime_team`: Gestionar equipos

### Monitoreo
- `oneuptime_monitor`: Crear y gestionar monitores
- `oneuptime_probe`: Gestionar sondas de monitoreo

### Gestión de guardia
- `oneuptime_on_call_duty_policy`: Configurar horarios de guardia

### Páginas de estado
- `oneuptime_status_page`: Crear páginas de estado

### Catálogo de servicios
- `oneuptime_service_catalog`: Gestionar entradas del catálogo de servicios

### Catálogo de servicios
- `oneuptime_service`: Definir servicios
- `oneuptime_service_dependency`: Mapear dependencias de servicios

### Fuentes de datos
Nota: Las fuentes de datos no están disponibles actualmente en el proveedor ya que no se definen datasources en el esquema del proveedor.

## Ejemplos

### Configuración completa de monitoreo

```hcl
# Variables
variable "oneuptime_api_key" {
  description = "Clave de API de OneUptime"
  type        = string
  sensitive   = true
}

variable "project_id" {
  description = "ID del proyecto de OneUptime (crea el proyecto manualmente en el panel)"
  type        = string
}

variable "oneuptime_url" {
  description = "URL de OneUptime"
  type        = string
  default     = "https://oneuptime.com"
}

# Configuración del proveedor
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = var.oneuptime_url
  api_key       = var.oneuptime_api_key
}

# Equipo
resource "oneuptime_team" "platform" {
  name        = "Equipo de plataforma"
  description = "Equipo de ingeniería de plataforma"
}

# Monitores
resource "oneuptime_monitor" "api" {
  name        = "Verificación de estado de la API"
  description = "Monitor para el punto de conexión de estado de la API"
  data        = jsonencode({
    url = "https://api.mycompany.com/health"
    method = "GET"
    interval = "1m"
    timeout = "30s"
  })
  }
}
```

### Ejemplo de configuración auto-alojada

```hcl
# Para instancia auto-alojada de OneUptime versión 7.0.123
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Debe coincidir exactamente con tu versión de OneUptime
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.mycompany.com"  # Tu URL auto-alojada
  api_key       = var.oneuptime_api_key
}

# El resto de tu configuración...
```

## Buenas prácticas

### 1. Gestión de versiones

**Para clientes en la nube:**
- Usa el versionado semántico con `~>` para obtener actualizaciones compatibles
- Revisa el registro de cambios antes de actualizar versiones principales

**Para clientes auto-alojados:**
- Siempre fija a la versión exacta que coincida con tu instalación
- Actualiza la versión del proveedor cuando actualices OneUptime
- Prueba primero en un entorno que no sea de producción

### 2. Gestión del estado

```hcl
terraform {
  backend "s3" {
    bucket = "my-terraform-state"
    key    = "oneuptime/terraform.tfstate"
    region = "us-west-2"
  }
}
```

### 3. Separación de entornos

Usa espacios de trabajo o archivos de estado separados para diferentes entornos:

```bash
# Usando espacios de trabajo
terraform workspace new production
terraform workspace new staging

# Usando directorios separados
mkdir -p environments/{staging,production}
```

### 4. Gestión de variables

```hcl
# variables.tf
variable "environment" {
  description = "Nombre del entorno"
  type        = string
}

variable "monitors" {
  description = "Lista de monitores a crear"
  type = list(object({
    name = string
    url  = string
    type = string
  }))
}

# terraform.tfvars
environment = "production"
monitors = [
  {
    name = "Sitio web"
    url  = "https://example.com"
    type = "website"
  },
  {
    name = "API"
    url  = "https://api.example.com/health"
    type = "api"
  }
]
```

### 5. Nomenclatura de recursos

Usa convenciones de nomenclatura consistentes:

```hcl
resource "oneuptime_monitor" "website_production" {
  name = "${var.environment}-website-monitor"
  # ...
}

resource "oneuptime_alert_policy" "critical_production" {
  name = "${var.environment}-critical-alerts"
  # ...
}
```

## Guía de migración

### Desde la configuración manual

1. **Audita los recursos existentes** en el panel de OneUptime
2. **Crea la configuración de Terraform** para los recursos existentes
3. **Importa los recursos existentes** al estado de Terraform
4. **Valida la configuración** coincide con el estado actual
5. **Aplica los cambios** incrementalmente

Ejemplo de importación:

```bash
# Importar monitor existente
terraform import oneuptime_monitor.website monitor-id-here

# Importar proyecto existente
terraform import oneuptime_project.main project-id-here
```

### Actualizaciones de versiones

Al actualizar OneUptime (auto-alojado):

1. **Haz una copia de seguridad de tu estado actual**
2. **Comprueba la compatibilidad del proveedor**
3. **Actualiza la versión del proveedor** en la configuración
4. **Prueba en el entorno de staging**
5. **Aplica en producción**

```bash
# Copia de seguridad del estado
terraform state pull > backup.tfstate

# Actualizar la versión del proveedor
# Edita el bloque terraform en tu configuración

# Planificar y aplicar
terraform init -upgrade
terraform plan
terraform apply
```

## Soporte y recursos

- **Documentación**: [Documentos de OneUptime](https://docs.oneuptime.com)
- **Registro de Terraform**: [Proveedor de OneUptime](https://registry.terraform.io/providers/oneuptime/oneuptime)
- **Problemas de GitHub**: [GitHub de OneUptime](https://github.com/OneUptime/oneuptime/issues)
- **Comunidad**: [Comunidad de OneUptime](https://community.oneuptime.com)

## Solución de problemas

### Problemas comunes

1. **Desajuste de versiones (auto-alojado)**
   ```
   Error: API version incompatible
   ```
   **Solución**: Asegúrate de que la versión del proveedor coincida con la instalación de OneUptime

2. **Problemas de autenticación**
   ```
   Error: Invalid API key
   ```
   **Solución**: Verifica la clave de API y los permisos

3. **Recurso no encontrado**
   ```
   Error: Resource not found
   ```
   **Solución**: Comprueba los IDs de recursos y asegúrate de que el recurso exista

### Modo de depuración

Habilita el registro detallado:

```bash
export TF_LOG=DEBUG
terraform apply
```

### Verificación de versión

Verifica tu configuración:

```bash
# Comprueba la versión de Terraform
terraform version

# Comprueba la versión del proveedor
terraform providers

# Valida la configuración
terraform validate
```
