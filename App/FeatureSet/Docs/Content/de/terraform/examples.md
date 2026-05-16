# Terraform-Provider-Beispiele

Dieses Dokument enthält umfassende Beispiele für häufige OneUptime-Terraform-Konfigurationen.

## Grundlegende Beispiele

### Einfaches Projekt

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Verwenden Sie "= 7.0.123" für selbst gehostete Instanzen
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"  # Für selbst gehostete Instanzen ändern
  api_key       = var.oneuptime_api_key
}

```

### Einfacher Monitor

```hcl
resource "oneuptime_monitor" "manual_monitor" {
  name        = "Homepage Monitor"
  description = "Monitor für die Hauptwebseite"
  monitor_type = "Manual"
}
```

### Status-Seiten

```hcl
# Öffentliche Status-Seite
resource "oneuptime_status_page" "public" {
  name        = "Öffentliche Status-Seite"
  description = "Öffentliche Status-Seite für kundenseitige Dienste"
}
```
