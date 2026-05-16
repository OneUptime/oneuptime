# Exemplos do Provedor Terraform

Este documento fornece exemplos abrangentes para configurações comuns do OneUptime no Terraform.

## Exemplos Básicos

### Projeto Simples

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Use "= 7.0.123" para auto-hospedado
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"  # Altere para auto-hospedado
  api_key       = var.oneuptime_api_key
}

```

### Monitor Básico

```hcl
resource "oneuptime_monitor" "manual_monitor" {
  name        = "Monitor da Página Inicial"
  description = "Monitor para a página inicial principal do site"
  monitor_type = "Manual"
}
```

### Páginas de Status

```hcl
# Página de status pública
resource "oneuptime_status_page" "public" {
  name        = "Página de Status Pública"
  description = "Página de status pública para serviços voltados ao cliente"
}
```
