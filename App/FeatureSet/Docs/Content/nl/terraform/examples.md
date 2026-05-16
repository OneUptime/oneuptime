# Terraform Provider-voorbeelden

Dit document biedt uitgebreide voorbeelden voor veelgebruikte OneUptime Terraform-configuraties.

## Basisvoorbeelden

### Eenvoudig project

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Gebruik "= 7.0.123" voor zelf-gehost
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"  # Wijzig voor zelf-gehost
  api_key       = var.oneuptime_api_key
}

```

### Basismonitor

```hcl
resource "oneuptime_monitor" "manual_monitor" {
  name        = "Homepage Monitor"
  description = "Monitor voor de hoofdwebsite"
  monitor_type = "Manual"
}
```

### Statuspagina's

```hcl
# Openbare statuspagina
resource "oneuptime_status_page" "public" {
  name        = "Openbare statuspagina"
  description = "Openbare statuspagina voor klantgerichte diensten"
}
```
