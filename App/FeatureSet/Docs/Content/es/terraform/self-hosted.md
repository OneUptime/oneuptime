# Guía de configuración de Terraform para OneUptime auto-alojado

Esta guía es específicamente para clientes que ejecutan instancias auto-alojadas de OneUptime. Cubre la gestión de versiones, la configuración y las buenas prácticas para usar el proveedor Terraform con tu propio despliegue de OneUptime.

## Notas importantes

⚠️ **Los proyectos no se pueden crear a través de Terraform**: Los proyectos deben crearse manualmente en el panel de OneUptime primero. Usa el ID del proyecto en tus configuraciones de Terraform.

⚠️ **La regla más importante para clientes auto-alojados**: Siempre fija la versión de tu proveedor Terraform para que coincida exactamente con la versión de tu instalación de OneUptime.

## Estructura de recursos

Todos los recursos Terraform de OneUptime siguen una estructura simplificada:
- `name` (requerido): Nombre del recurso
- `description` (opcional): Descripción del recurso  
- `data` (opcional): Configuración compleja en formato JSON

## Crítico: Compatibilidad de versiones

⚠️ **La regla más importante para clientes auto-alojados**: Siempre fija la versión de tu proveedor Terraform para que coincida exactamente con la versión de tu instalación de OneUptime.

### Por qué la fijación de versiones es crítica

- El proveedor Terraform se genera automáticamente desde la API de OneUptime
- Cada versión de OneUptime puede tener diferentes puntos de conexión de API y esquemas
- El uso de una versión no coincidente del proveedor puede causar errores o comportamiento inesperado
- La fijación de versiones garantiza la compatibilidad y el comportamiento predecible

## Encontrar tu versión de OneUptime

### Método 1: Panel
1. Inicia sesión en tu panel de OneUptime
2. Ve a **Configuración** → **Acerca de**
3. Busca el número de versión (por ejemplo, "7.0.123")

### Método 2: Punto de conexión de API
```bash
curl https://your-oneuptime-instance.com/api/status
```

### Método 3: Imágenes Docker
Si ejecutas OneUptime con Docker:
```bash
docker images | grep oneuptime
# Busca la etiqueta, por ejemplo, oneuptime/dashboard:7.0.123
```

### Método 4: Gráfico Helm
Si usas Helm:
```bash
helm list -n oneuptime
# Comprueba la versión del gráfico
```

### Método 5: Variables de entorno
Comprueba tus archivos de configuración para variables de versión:
```bash
grep -r "APP_VERSION\|IMAGE_TAG" /path/to/your/oneuptime/config
```

## Plantillas de configuración del proveedor

### Plantilla para la versión 7.0.x

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Reemplaza 123 con tu número de compilación exacto
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"  # Tu URL auto-alojada
  api_key       = var.oneuptime_api_key
}
```

### Plantilla para la versión 7.1.x

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.1.45"  # Reemplaza con tu versión exacta
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"
  api_key       = var.oneuptime_api_key
}
```

## Ejemplo completo de configuración auto-alojada

Aquí tienes un ejemplo completo para una instancia auto-alojada de OneUptime:

```hcl
# versions.tf
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Debe coincidir con tu versión de OneUptime
    }
  }
  required_version = ">= 1.0"
  
  # Opcional: Usa estado remoto para colaboración en equipo
  backend "s3" {
    bucket = "your-terraform-state-bucket"
    key    = "oneuptime/terraform.tfstate"
    region = "us-west-2"
  }
}

# variables.tf
variable "oneuptime_url" {
  description = "URL de la instancia de OneUptime"
  type        = string
  default     = "https://oneuptime.yourcompany.com"
}

variable "oneuptime_api_key" {
  description = "Clave de API de OneUptime"
  type        = string
  sensitive   = true
}

variable "environment" {
  description = "Nombre del entorno"
  type        = string
  default     = "production"
}

# providers.tf
provider "oneuptime" {
  oneuptime_url = var.oneuptime_url
  api_key       = var.oneuptime_api_key
}

# variables.tf
variable "project_id" {
  description = "ID del proyecto de OneUptime (crea manualmente en el panel)"
  type        = string
}

# main.tf
# Crear equipos
resource "oneuptime_team" "infrastructure" {
  name        = "Equipo de infraestructura"
  description = "Equipo de infraestructura y operaciones"
}

# Monitores de infraestructura
resource "oneuptime_monitor" "database" {
  name       = "${var.environment}-database"
  
  monitor_type = "port"
  hostname     = "db.internal.yourcompany.com"
  port         = 5432
  interval     = "2m"
  timeout      = "10s"
  
  tags = {
    team        = "infrastructure"
    service     = "database"
    environment = var.environment
    criticality = "critical"
  }
}

# Política de guardia
resource "oneuptime_on_call_policy" "infrastructure_oncall" {
  name       = "Guardia de infraestructura"
  team_id    = oneuptime_team.infrastructure.id
  
  schedules {
    name     = "Infraestructura 24x7"
    timezone = "America/New_York"
    
    layers {
      name          = "Primario"
      users         = ["infra1@yourcompany.com", "infra2@yourcompany.com"]
      rotation_type = "weekly"
      start_time    = "00:00"
      end_time      = "23:59"
      days          = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    }
  }
}

# Página de estado interna
resource "oneuptime_status_page" "internal" {
  name       = "Estado de servicios internos"
  
  domain = "status.internal.yourcompany.com"
  
  components {
    name       = "Base de datos"
    monitor_id = oneuptime_monitor.database.id
  }
}

# outputs.tf
output "status_page_url" {
  description = "URL de la página de estado"
  value       = "https://${oneuptime_status_page.internal.domain}"
}
```

## Configuración específica por entorno

### Entorno de desarrollo

```hcl
# dev.tfvars
oneuptime_url = "https://oneuptime-dev.yourcompany.com"
environment = "development"
```

### Entorno de staging

```hcl
# staging.tfvars
oneuptime_url = "https://oneuptime-staging.yourcompany.com"  
environment = "staging"
```

### Entorno de producción

```hcl
# prod.tfvars
oneuptime_url = "https://oneuptime.yourcompany.com"
environment = "production"
```

## Proceso de actualización para auto-alojados

Al actualizar tu instancia de OneUptime:

### 1. Lista de verificación previa a la actualización

```bash
# Haz una copia de seguridad del estado actual de Terraform
terraform state pull > backup-$(date +%Y%m%d).tfstate

# Anota la versión actual de OneUptime
curl https://oneuptime.yourcompany.com/api/status | jq '.version'

# Anota la versión actual del proveedor
terraform providers | grep oneuptime
```

### 2. Actualizar la instancia de OneUptime

Sigue tu proceso estándar de actualización de OneUptime (Docker, Helm, etc.)

### 3. Actualizar el proveedor Terraform

```hcl
# Actualiza la versión en el bloque terraform
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.124"  # Nueva versión después de la actualización
    }
  }
}
```

### 4. Probar y aplicar

```bash
# Actualizar el proveedor
terraform init -upgrade

# Planificar para ver los cambios
terraform plan

# Aplicar si todo se ve bien
terraform apply
```

## Configuración de red

### Reglas de firewall

Asegúrate de que tu ejecutor de Terraform pueda acceder a:
- Punto de conexión de la API de OneUptime (generalmente el puerto 443/HTTPS)
- Cualquier recurso interno que se esté monitoreando

### VPN/Redes privadas

Si OneUptime está en una red privada:

```hcl
provider "oneuptime" {
  oneuptime_url = "https://10.0.1.100:443"  # IP interna
  api_key       = var.oneuptime_api_key
}
```

## Buenas prácticas de seguridad

### 1. Gestión de claves de API

```bash
# Usa variables de entorno
export ONEUPTIME_API_KEY="your-api-key"

# O usa un sistema de gestión de secretos
export ONEUPTIME_API_KEY=$(vault kv get -field=api_key secret/oneuptime)
```

### 2. Claves de API con privilegios mínimos

Crea claves de API con los permisos mínimos requeridos:
- Gestión de monitores
- Gestión de políticas de alertas
- Gestión de equipos (si es necesario)

## Monitoreo de tu automatización Terraform

Crea monitores para tu automatización Terraform:

```hcl
resource "oneuptime_monitor" "terraform_runner" {
  name       = "Estado del ejecutor de Terraform"
  
  monitor_type = "heartbeat"
  interval     = "15m"
  
  tags = {
    automation = "terraform"
    criticality = "medium"
  }
}
```

## Solución de problemas para auto-alojados

### Problema: Conexión rechazada

```
Error: connection refused
```

**Soluciones**:
1. Comprueba que la instancia de OneUptime esté en ejecución
2. Verifica que la URL de la API sea correcta
3. Comprueba la conectividad de red/firewall
4. Verifica que los certificados TLS sean válidos

### Problema: Desajuste de versiones de API

```
Error: API version incompatible
```

**Soluciones**:
1. Comprueba la versión de OneUptime: `curl https://your-instance/api/status`
2. Actualiza la versión del proveedor para que coincida
3. Ejecuta `terraform init -upgrade`

### Problema: Certificados firmados automáticamente

Si usas certificados firmados automáticamente:

```bash
# Omite temporalmente la verificación TLS (no recomendado para producción)
export ONEUPTIME_SKIP_TLS_VERIFY=true
```

Mejor solución: Agrega tu certificado de CA al almacén de confianza del sistema.

## Copia de seguridad y recuperación ante desastres

### Copia de seguridad del estado

```bash
# Copias de seguridad regulares del estado
terraform state pull > backup-$(date +%Y%m%d-%H%M%S).tfstate

# Script de copia de seguridad automatizado
#!/bin/bash
DATE=$(date +%Y%m%d-%H%M%S)
terraform state pull > "backups/terraform-state-${DATE}.tfstate"
find backups/ -name "terraform-state-*.tfstate" -mtime +30 -delete
```

### Copia de seguridad de la configuración

```bash
# Copia de seguridad de la configuración de Terraform
tar -czf terraform-config-$(date +%Y%m%d).tar.gz *.tf *.tfvars
```

## Gestión multi-entorno

### Uso de espacios de trabajo

```bash
# Crear entornos
terraform workspace new dev
terraform workspace new staging  
terraform workspace new prod

# Cambiar entre entornos
terraform workspace select prod
terraform apply -var-file="prod.tfvars"
```

### Uso de directorios separados

```
terraform/
├── environments/
│   ├── dev/
│   │   ├── main.tf
│   │   └── terraform.tfvars
│   ├── staging/
│   │   ├── main.tf
│   │   └── terraform.tfvars
│   └── prod/
│       ├── main.tf
│       └── terraform.tfvars
└── modules/
    └── oneuptime/
        ├── main.tf
        ├── variables.tf
        └── outputs.tf
```

Este enfoque proporciona un mejor aislamiento y una gestión más fácil de versiones por entorno.
