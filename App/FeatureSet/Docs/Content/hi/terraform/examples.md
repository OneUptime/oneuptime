# Terraform Provider Examples

यह document सामान्य OneUptime Terraform configurations के लिए व्यापक उदाहरण प्रदान करता है।

## Basic Examples

### Simple Project

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # self-hosted के लिए "= 7.0.123" उपयोग करें
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"  # self-hosted के लिए बदलें
  api_key       = var.oneuptime_api_key
}

```

### Basic Monitor

```hcl
resource "oneuptime_monitor" "manual_monitor" {
  name        = "Homepage Monitor"
  description = "main website homepage के लिए Monitor"
  monitor_type = "Manual"
}
```

### Status Pages

```hcl
# Public status page
resource "oneuptime_status_page" "public" {
  name        = "Public Status Page"
  description = "customer-facing services के लिए Public status page"
}
```
