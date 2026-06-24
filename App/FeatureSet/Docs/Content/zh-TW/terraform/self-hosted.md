# 自架 OneUptime Terraform 設定指南

本指南專為執行自架 OneUptime 實例的客戶而撰寫。內容涵蓋版本管理、設定，以及搭配您自己的 OneUptime 部署使用 Terraform provider 的最佳實踐。

## 重要注意事項

⚠️ **無法透過 Terraform 建立專案** - 專案必須先在 OneUptime 儀表板中手動建立。請在您的 Terraform 設定中使用該專案 ID。

⚠️ **自架客戶最重要的規則**：請務必將您的 Terraform provider 版本固定為與您的 OneUptime 安裝版本完全一致。

## 資源結構

所有 OneUptime Terraform 資源都遵循簡化的結構：

- `name`（必填）- 資源名稱
- `description`（選填）- 資源描述
- `data`（選填）- 以 JSON 表示的複雜設定

## 重要：版本相容性

⚠️ **自架客戶最重要的規則**：請務必將您的 Terraform provider 版本固定為與您的 OneUptime 安裝版本完全一致。

### 為什麼版本固定至關重要

- Terraform provider 是從 OneUptime API 自動產生的
- 每個 OneUptime 版本可能有不同的 API 端點與結構描述
- 使用不相符的 provider 版本可能導致錯誤或非預期的行為
- 版本固定可確保相容性與可預測的行為

## 查詢您的 OneUptime 版本

### 方法 1：儀表板

1. 登入您的 OneUptime 儀表板
2. 前往 **Settings** → **About**
3. 查看版本號碼（例如「7.0.123」）

### 方法 2：API 端點

```bash
curl https://your-oneuptime-instance.com/api/status
```

### 方法 3：Docker 映像檔

如果您是使用 Docker 執行 OneUptime：

```bash
docker images | grep oneuptime
# Look for the tag, e.g., oneuptime/dashboard:7.0.123
```

### 方法 4：Helm Chart

如果您是使用 Helm：

```bash
helm list -n oneuptime
# Check the chart version
```

### 方法 5：環境變數

檢查您的設定檔中的版本變數：

```bash
grep -r "APP_VERSION\|IMAGE_TAG" /path/to/your/oneuptime/config
```

## Provider 設定範本

### 版本 7.0.x 範本

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Replace 123 with your exact build number
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"  # Your self-hosted URL
  api_key       = var.oneuptime_api_key
}
```

### 版本 7.1.x 範本

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.1.45"  # Replace with your exact version
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"
  api_key       = var.oneuptime_api_key
}
```

## 完整的自架設定範例

以下是自架 OneUptime 實例的完整範例：

```hcl
# versions.tf
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Must match your OneUptime version
    }
  }
  required_version = ">= 1.0"

  # Optional: Use remote state for team collaboration
  backend "s3" {
    bucket = "your-terraform-state-bucket"
    key    = "oneuptime/terraform.tfstate"
    region = "us-west-2"
  }
}

# variables.tf
variable "oneuptime_url" {
  description = "OneUptime instance URL"
  type        = string
  default     = "https://oneuptime.yourcompany.com"
}

variable "oneuptime_api_key" {
  description = "OneUptime API Key"
  type        = string
  sensitive   = true
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "production"
}

# providers.tf
provider "oneuptime" {
  oneuptime_url = var.oneuptime_url
  api_key       = var.oneuptime_api_key
}

# variables.tf
variable "project_id" {
  description = "OneUptime project ID (create manually in dashboard)"
  type        = string
}

# main.tf
# Create teams
resource "oneuptime_team" "infrastructure" {
  name        = "Infrastructure Team"
  description = "Infrastructure and operations team"
}

resource "oneuptime_team" "development" {
  name        = "Development Team"
  description = "Application development team"
  project_id = oneuptime_project.main.id
}

# Infrastructure monitors
resource "oneuptime_monitor" "database" {
  name       = "${var.environment}-database"
  project_id = oneuptime_project.main.id

  monitor_type = "port"
  hostname     = "db.internal.yourcompany.com"
  port         = 5432
  interval     = "2m"
  timeout      = "10s"

  tags = {
    team        = "infrastructure"
    service     = "database"
    environment = var.environment
    criticality = "critical"
  }
}

resource "oneuptime_monitor" "application" {
  name       = "${var.environment}-application"
  project_id = oneuptime_project.main.id

  monitor_type = "website"
  url          = "https://app.yourcompany.com/health"
  interval     = "1m"
  timeout      = "30s"

  expected_status_codes = [200]

  tags = {
    team        = "development"
    service     = "application"
    environment = var.environment
    criticality = "high"
  }
}

# On-call policies
resource "oneuptime_on_call_policy" "infrastructure_oncall" {
  name       = "Infrastructure On-Call"
  project_id = oneuptime_project.main.id
  team_id    = oneuptime_team.infrastructure.id

  schedules {
    name     = "24x7 Infrastructure"
    timezone = "America/New_York"

    layers {
      name          = "Primary"
      users         = ["infra1@yourcompany.com", "infra2@yourcompany.com"]
      rotation_type = "weekly"
      start_time    = "00:00"
      end_time      = "23:59"
      days          = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    }
  }
}

# Alert policies
resource "oneuptime_alert_policy" "critical_infrastructure" {
  name       = "Critical Infrastructure Alerts"
  project_id = oneuptime_project.main.id

  conditions {
    monitor_id = oneuptime_monitor.database.id
    threshold  = "down"
  }

  actions {
    type = "email"
    recipients = ["infrastructure@yourcompany.com"]
  }

  actions {
    type             = "oncall_escalation"
    oncall_policy_id = oneuptime_on_call_policy.infrastructure_oncall.id
  }
}

# Internal status page
resource "oneuptime_status_page" "internal" {
  name       = "Internal Services Status"
  project_id = oneuptime_project.main.id

  domain = "status.internal.yourcompany.com"

  components {
    name       = "Database"
    monitor_id = oneuptime_monitor.database.id
  }

  components {
    name       = "Application"
    monitor_id = oneuptime_monitor.application.id
  }
}

# outputs.tf
output "project_id" {
  description = "Project ID"
  value       = oneuptime_project.main.id
}

output "status_page_url" {
  description = "Status page URL"
  value       = "https://${oneuptime_status_page.internal.domain}"
}
```

## 環境專屬設定

### 開發環境

```hcl
# dev.tfvars
oneuptime_url = "https://oneuptime-dev.yourcompany.com"
environment = "development"
```

### 預備環境

```hcl
# staging.tfvars
oneuptime_url = "https://oneuptime-staging.yourcompany.com"
environment = "staging"
```

### 正式環境

```hcl
# prod.tfvars
oneuptime_url = "https://oneuptime.yourcompany.com"
environment = "production"
```

## 自架的升級流程

升級您的 OneUptime 實例時：

### 1. 升級前檢查清單

```bash
# Backup current Terraform state
terraform state pull > backup-$(date +%Y%m%d).tfstate

# Note current OneUptime version
curl https://oneuptime.yourcompany.com/api/status | jq '.version'

# Note current provider version
terraform providers | grep oneuptime
```

### 2. 升級 OneUptime 實例

請遵循您標準的 OneUptime 升級流程（Docker、Helm 等）

### 3. 更新 Terraform Provider

```hcl
# Update version in terraform block
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.124"  # New version after upgrade
    }
  }
}
```

### 4. 測試與套用

```bash
# Update provider
terraform init -upgrade

# Plan to see any changes
terraform plan

# Apply if everything looks good
terraform apply
```

## 網路設定

### 防火牆規則

請確保您的 Terraform runner 可以存取：

- OneUptime API 端點（通常為連接埠 443/HTTPS）
- 任何受監控的內部資源

### VPN／私有網路

如果 OneUptime 位於私有網路上：

```hcl
provider "oneuptime" {
  oneuptime_url = "https://10.0.1.100:443"  # Internal IP
  api_key       = var.oneuptime_api_key
}
```

## 安全性最佳實踐

### 1. API 金鑰管理

```bash
# Use environment variables
export ONEUPTIME_API_KEY="your-api-key"

# Or use a secret management system
export ONEUPTIME_API_KEY=$(vault kv get -field=api_key secret/oneuptime)
```

### 2. 最小權限 API 金鑰

建立具有最低必要權限的 API 金鑰：

- 監控管理
- 警示政策管理
- 團隊管理（如有需要）

### 3. 網路安全性

```hcl
# Example with TLS verification
provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"
  api_key       = var.oneuptime_api_key

  # Additional security options if supported
  verify_ssl = true
  timeout    = "30s"
}
```

## 監控您的 Terraform 自動化

為您的 Terraform 自動化建立監控：

```hcl
resource "oneuptime_monitor" "terraform_runner" {
  name       = "Terraform Runner Health"
  project_id = oneuptime_project.main.id

  monitor_type = "heartbeat"
  interval     = "15m"

  tags = {
    automation = "terraform"
    criticality = "medium"
  }
}
```

## 自架問題疑難排解

### 問題：連線遭拒（Connection Refused）

```
Error: connection refused
```

**解決方案**：

1. 檢查 OneUptime 實例是否正在執行
2. 確認 API URL 是否正確
3. 檢查防火牆／網路連線
4. 確認 TLS 憑證是否有效

### 問題：API 版本不相符

```
Error: API version incompatible
```

**解決方案**：

1. 檢查 OneUptime 版本：`curl https://your-instance/api/status`
2. 更新 provider 版本以使其相符
3. 執行 `terraform init -upgrade`

### 問題：自我簽署憑證

如果使用自我簽署憑證：

```bash
# Temporarily skip TLS verification (not recommended for production)
export ONEUPTIME_SKIP_TLS_VERIFY=true
```

更好的解決方案：將您的 CA 憑證加入系統信任儲存區。

## 備份與災難復原

### 狀態備份

```bash
# Regular state backups
terraform state pull > backup-$(date +%Y%m%d-%H%M%S).tfstate

# Automated backup script
#!/bin/bash
DATE=$(date +%Y%m%d-%H%M%S)
terraform state pull > "backups/terraform-state-${DATE}.tfstate"
find backups/ -name "terraform-state-*.tfstate" -mtime +30 -delete
```

### 設定備份

```bash
# Backup Terraform configuration
tar -czf terraform-config-$(date +%Y%m%d).tar.gz *.tf *.tfvars
```

## 多環境管理

### 使用 Workspaces

```bash
# Create environments
terraform workspace new dev
terraform workspace new staging
terraform workspace new prod

# Switch between environments
terraform workspace select prod
terraform apply -var-file="prod.tfvars"
```

### 使用獨立目錄

```
terraform/
├── environments/
│   ├── dev/
│   │   ├── main.tf
│   │   └── terraform.tfvars
│   ├── staging/
│   │   ├── main.tf
│   │   └── terraform.tfvars
│   └── prod/
│       ├── main.tf
│       └── terraform.tfvars
└── modules/
    └── oneuptime/
        ├── main.tf
        ├── variables.tf
        └── outputs.tf
```

此方法能為每個環境提供更好的隔離性，並讓版本管理更為容易。
