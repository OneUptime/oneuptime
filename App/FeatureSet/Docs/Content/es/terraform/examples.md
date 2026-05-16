# Ejemplos del proveedor Terraform

Este documento proporciona ejemplos completos para configuraciones comunes de Terraform en OneUptime.

## Ejemplos básicos

### Proyecto simple

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Usa "= 7.0.123" para auto-alojado
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"  # Cambia para auto-alojado
  api_key       = var.oneuptime_api_key
}

```

### Monitor básico

```hcl
resource "oneuptime_monitor" "manual_monitor" {
  name        = "Monitor de página principal"
  description = "Monitor para la página principal del sitio web"
  monitor_type = "Manual"
}
```

### Páginas de estado

```hcl
# Página de estado pública
resource "oneuptime_status_page" "public" {
  name        = "Página de estado pública"
  description = "Página de estado pública para servicios orientados al cliente"
}
```
