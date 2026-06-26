# Guía de inicio rápido del proveedor Terraform

Esta guía te ayudará a comenzar con el Proveedor Terraform de OneUptime en solo unos minutos.

## Prerrequisitos

- Terraform >= 1.0 instalado
- Cuenta de OneUptime (en la nube o auto-alojada)
- Clave de API de OneUptime

## Paso 1: Crear la clave de API

### Para OneUptime Cloud

1. Ve a [OneUptime Cloud](https://oneuptime.com) e inicia sesión
2. Navega a **Configuración** → **Claves de API**
3. Haz clic en **Crear clave de API**
4. Nómbrala "Proveedor Terraform"
5. Selecciona los permisos requeridos
6. Copia la clave de API generada

### Para OneUptime auto-alojado

1. Accede a tu instancia de OneUptime
2. Navega a **Configuración** → **Claves de API**
3. Haz clic en **Crear clave de API**
4. Nómbrala "Proveedor Terraform"
5. Selecciona los permisos requeridos
6. Copia la clave de API generada

## Paso 2: Crear la configuración de Terraform

Crea un nuevo directorio y un archivo `main.tf`:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      # Para clientes en la nube
      version = "~> 7.0"

      # Para clientes auto-alojados: fija a tu versión exacta
      # version = "= 7.0.123"  # Reemplaza con tu versión de OneUptime
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  # Para clientes en la nube
  oneuptime_url = "https://oneuptime.com"

  # Para clientes auto-alojados: usa la URL de tu instancia
  # oneuptime_url = "https://oneuptime.yourcompany.com"

  api_key = var.oneuptime_api_key
}

variable "oneuptime_api_key" {
  description = "Clave de API de OneUptime"
  type        = string
  sensitive   = true
}

# Nota: Los proyectos deben crearse manualmente en el panel de OneUptime
# Usa el ID de tu proyecto existente aquí
variable "project_id" {
  description = "ID del proyecto de OneUptime"
  type        = string
}

# Crea un monitor de sitio web simple
resource "oneuptime_monitor" "website" {
  name        = "Monitor de sitio web"
  description = "Monitor para el tiempo de actividad del sitio web"
  data        = jsonencode({
    url = "https://example.com"
    interval = "5m"
    timeout = "30s"
  })
}

# Salida del ID del monitor
output "monitor_id" {
  value = oneuptime_monitor.website.id
}
```

## Paso 3: Crear el archivo de variables

Crea `terraform.tfvars`:

```hcl
# terraform.tfvars
oneuptime_api_key = "your-api-key-here"
project_id        = "your-project-id-here"  # Obtén esto del panel de OneUptime
```

**Importante**: ¡Agrega `terraform.tfvars` a tu `.gitignore` para mantener las claves de API en secreto!

## Paso 4: Inicializar y aplicar

```bash
# Inicializar Terraform
terraform init

# Planificar el despliegue
terraform plan

# Aplicar la configuración
terraform apply
```

## Paso 5: Verificar los recursos

1. Comprueba tu panel de OneUptime
2. Ve a tu proyecto existente
3. Verifica que el "Monitor de sitio web" esté creado y en ejecución

## Próximos pasos

1. **Explora más recursos**: Consulta la [documentación completa](./README.md) para todos los recursos disponibles
2. **Configura alertas**: Agrega políticas de alertas y canales de notificación
3. **Crea páginas de estado**: Configura páginas de estado públicas para tus servicios
4. **Organiza con equipos**: Crea equipos y asigna permisos

## Ejemplos específicos por versión

### Clientes en la nube (última versión)

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Siempre obtiene la última versión compatible 7.x
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### Clientes auto-alojados (versión fijada)

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Debe coincidir exactamente con tu versión de OneUptime
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.mycompany.com"  # Tu URL auto-alojada
  api_key       = var.oneuptime_api_key
}
```

## Solución de problemas del inicio rápido

### Problema: Proveedor no encontrado

```
Error: Failed to query available provider packages
```

**Solución**: Ejecuta `terraform init` para descargar el proveedor

### Problema: Autenticación fallida

```
Error: Invalid API key
```

**Solución**:

1. Verifica tu clave de API en el panel de OneUptime
2. Comprueba que la clave de API tenga permisos suficientes
3. Asegúrate de que `oneuptime_url` sea correcta para tu instancia

### Problema: Desajuste de versiones (auto-alojado)

```
Error: API version incompatible
```

**Solución**:

1. Comprueba tu versión de OneUptime en el panel
2. Actualiza la versión del proveedor para que coincida exactamente
3. Ejecuta `terraform init -upgrade`

## Limpieza

Para eliminar todos los recursos creados en este inicio rápido:

```bash
terraform destroy
```

Esto eliminará el monitor y el proyecto creados durante el inicio rápido.
