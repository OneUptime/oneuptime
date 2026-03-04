# Terraform Provider Examples

This document provides comprehensive examples for common OneUptime Terraform configurations.

## Basic Examples

### Simple Project

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

### Basic Monitor

```hcl
resource "oneuptime_monitor" "manual_monitor" {
  name        = "Homepage Monitor"
  description = "Monitor for the main website homepage"
  monitor_type = "Manual"
}
```

### Status Pages

```hcl
# Public status page
resource "oneuptime_status_page" "public" {
  name        = "Public Status Page"
  description = "Public status page for customer-facing services"
}
```