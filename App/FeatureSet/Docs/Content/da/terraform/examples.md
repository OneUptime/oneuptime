# Terraform Provider-eksempler

Dette dokument indeholder omfattende eksempler til almindelige OneUptime Terraform-konfigurationer.

## Grundlæggende eksempler

### Simpelt projekt

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Brug "= 7.0.123" til selvhostet
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"  # Skift til selvhostet
  api_key       = var.oneuptime_api_key
}

```

### Grundlæggende monitor

```hcl
resource "oneuptime_monitor" "manual_monitor" {
  name        = "Homepage Monitor"
  description = "Monitor til webstedets hjemmeside"
  monitor_type = "Manual"
}
```

### Statussider

```hcl
# Offentlig statusside
resource "oneuptime_status_page" "public" {
  name        = "Offentlig statusside"
  description = "Offentlig statusside til kundevendte tjenester"
}
```
