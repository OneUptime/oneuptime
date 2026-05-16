# Terraform-leverantörsexempel

Det här dokumentet innehåller omfattande exempel för vanliga OneUptime Terraform-konfigurationer.

## Grundläggande exempel

### Enkelt projekt

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Use "= 7.0.123" for self-hosted
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"  # Change for self-hosted
  api_key       = var.oneuptime_api_key
}

```

### Grundläggande monitor

```hcl
resource "oneuptime_monitor" "manual_monitor" {
  name        = "Homepage Monitor"
  description = "Monitor for the main website homepage"
  monitor_type = "Manual"
}
```

### Statussidor

```hcl
# Public status page
resource "oneuptime_status_page" "public" {
  name        = "Public Status Page"
  description = "Public status page for customer-facing services"
}
```
