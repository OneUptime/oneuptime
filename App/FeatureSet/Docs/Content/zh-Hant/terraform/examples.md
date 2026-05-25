# Terraform 提供商示例

本文檔提供了常見 OneUptime Terraform 配置的綜合示例。

## 基礎示例

### 簡單項目

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # 自託管使用 "= 7.0.123"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"  # 自託管請更改
  api_key       = var.oneuptime_api_key
}

```

### 基礎監控器

```hcl
resource "oneuptime_monitor" "manual_monitor" {
  name        = "Homepage Monitor"
  description = "Monitor for the main website homepage"
  monitor_type = "Manual"
}
```

### 狀態頁面

```hcl
# 公共狀態頁面
resource "oneuptime_status_page" "public" {
  name        = "Public Status Page"
  description = "Public status page for customer-facing services"
}
```
