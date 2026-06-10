# Terraform Provider 範例

本文件提供常見 OneUptime Terraform 設定的完整範例。

## 基本範例

### 簡易專案

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

### 基本 Monitor

```hcl
resource "oneuptime_monitor" "manual_monitor" {
  name        = "Homepage Monitor"
  description = "Monitor for the main website homepage"
  monitor_type = "Manual"
}
```

### 狀態頁面

```hcl
# Public status page
resource "oneuptime_status_page" "public" {
  name        = "Public Status Page"
  description = "Public status page for customer-facing services"
}
```
