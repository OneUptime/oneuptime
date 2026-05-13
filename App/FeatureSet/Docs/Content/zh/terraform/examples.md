# Terraform 提供商示例

本文档提供了常见 OneUptime Terraform 配置的综合示例。

## 基础示例

### 简单项目

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # 自托管使用 "= 7.0.123"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"  # 自托管请更改
  api_key       = var.oneuptime_api_key
}

```

### 基础监控器

```hcl
resource "oneuptime_monitor" "manual_monitor" {
  name        = "Homepage Monitor"
  description = "Monitor for the main website homepage"
  monitor_type = "Manual"
}
```

### 状态页面

```hcl
# 公共状态页面
resource "oneuptime_status_page" "public" {
  name        = "Public Status Page"
  description = "Public status page for customer-facing services"
}
```
