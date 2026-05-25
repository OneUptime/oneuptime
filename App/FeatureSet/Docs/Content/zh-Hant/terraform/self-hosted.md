# 自託管 OneUptime Terraform 配置指南

本指南專門針對運行自託管 OneUptime 實例的客戶。它涵蓋了使用 Terraform 提供商與您自己的 OneUptime 部署時的版本管理、配置和最佳實踐。

## 重要提示

⚠️ **無法通過 Terraform 創建項目** - 必須先在 OneUptime 控制台中手動創建項目。在您的 Terraform 配置中使用項目 ID。

⚠️ **自託管客戶最重要的規則**：始終將您的 Terraform 提供商版本固定到與您的 OneUptime 安裝版本完全匹配的版本。

## 資源結構

所有 OneUptime Terraform 資源遵循簡化結構：
- `name`（必填）- 資源名稱
- `description`（可選）- 資源描述
- `data`（可選）- JSON 格式的複雜配置

## 關鍵：版本兼容性

⚠️ **自託管客戶最重要的規則**：始終將您的 Terraform 提供商版本固定到與您的 OneUptime 安裝版本完全匹配的版本。

### 爲什麼版本固定至關重要

- Terraform 提供商是從 OneUptime API 自動生成的
- 每個 OneUptime 版本可能有不同的 API 端點和 Schema
- 使用不匹配的提供商版本可能導致錯誤或意外行爲
- 版本固定確保兼容性和可預測的行爲

## 查找您的 OneUptime 版本

### 方法一：控制台
1. 登錄您的 OneUptime 控制台
2. 前往 **設置** → **關於**
3. 查找版本號（例如"7.0.123"）

### 方法二：API 端點
```bash
curl https://your-oneuptime-instance.com/api/status
```

### 方法三：Docker 鏡像
如果您使用 Docker 運行 OneUptime：
```bash
docker images | grep oneuptime
# 查看標籤，例如 oneuptime/dashboard:7.0.123
```

### 方法四：Helm Chart
如果您使用 Helm：
```bash
helm list -n oneuptime
# 檢查 Chart 版本
```

### 方法五：環境變量
檢查您的配置文件中的版本變量：
```bash
grep -r "APP_VERSION\|IMAGE_TAG" /path/to/your/oneuptime/config
```

## 提供商配置模板

### 版本 7.0.x 的模板

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # 替換 123 爲您的確切構建號
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"  # 您的自託管 URL
  api_key       = var.oneuptime_api_key
}
```

### 版本 7.1.x 的模板

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.1.45"  # 替換爲您的確切版本
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"
  api_key       = var.oneuptime_api_key
}
```

## 完整的自託管配置示例

以下是自託管 OneUptime 實例的完整示例：

```hcl
# versions.tf
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # 必須與您的 OneUptime 版本匹配
    }
  }
  required_version = ">= 1.0"
  
  # 可選：使用遠程狀態進行團隊協作
  backend "s3" {
    bucket = "your-terraform-state-bucket"
    key    = "oneuptime/terraform.tfstate"
    region = "us-west-2"
  }
}

# variables.tf
variable "oneuptime_url" {
  description = "OneUptime 實例 URL"
  type        = string
  default     = "https://oneuptime.yourcompany.com"
}

variable "oneuptime_api_key" {
  description = "OneUptime API 密鑰"
  type        = string
  sensitive   = true
}

variable "environment" {
  description = "環境名稱"
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
  description = "OneUptime 項目 ID（在控制台中手動創建）"
  type        = string
}

# main.tf
# 創建團隊
resource "oneuptime_team" "infrastructure" {
  name        = "Infrastructure Team"
  description = "Infrastructure and operations team"
}

resource "oneuptime_team" "development" {
  name        = "Development Team"
  description = "Application development team"  
  project_id = oneuptime_project.main.id
}

# 基礎設施監控器
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

# 值班策略
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

# 警報策略
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

# 內部狀態頁面
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
  description = "項目 ID"
  value       = oneuptime_project.main.id
}

output "status_page_url" {
  description = "狀態頁面 URL"
  value       = "https://${oneuptime_status_page.internal.domain}"
}
```

## 特定環境配置

### 開發環境

```hcl
# dev.tfvars
oneuptime_url = "https://oneuptime-dev.yourcompany.com"
environment = "development"
```

### 預發佈環境

```hcl
# staging.tfvars
oneuptime_url = "https://oneuptime-staging.yourcompany.com"  
environment = "staging"
```

### 生產環境

```hcl
# prod.tfvars
oneuptime_url = "https://oneuptime.yourcompany.com"
environment = "production"
```

## 自託管升級流程

升級您的 OneUptime 實例時：

### 1. 升級前檢查清單

```bash
# 備份當前 Terraform 狀態
terraform state pull > backup-$(date +%Y%m%d).tfstate

# 記錄當前 OneUptime 版本
curl https://oneuptime.yourcompany.com/api/status | jq '.version'

# 記錄當前提供商版本
terraform providers | grep oneuptime
```

### 2. 升級 OneUptime 實例

按照您的標準 OneUptime 升級流程（Docker、Helm 等）

### 3. 更新 Terraform 提供商

```hcl
# 更新 terraform 塊中的版本
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.124"  # 升級後的新版本
    }
  }
}
```

### 4. 測試並應用

```bash
# 更新提供商
terraform init -upgrade

# 規劃以查看任何變更
terraform plan

# 如果一切正常，應用
terraform apply
```

## 網絡配置

### 防火牆規則

確保您的 Terraform 運行器可以訪問：
- OneUptime API 端點（通常是 443 端口/HTTPS）
- 任何被監控的內部資源

### VPN/私有網絡

如果 OneUptime 在私有網絡上：

```hcl
provider "oneuptime" {
  oneuptime_url = "https://10.0.1.100:443"  # 內部 IP
  api_key       = var.oneuptime_api_key
}
```

## 安全最佳實踐

### 1. API 密鑰管理

```bash
# 使用環境變量
export ONEUPTIME_API_KEY="your-api-key"

# 或使用密鑰管理系統
export ONEUPTIME_API_KEY=$(vault kv get -field=api_key secret/oneuptime)
```

### 2. 最小權限 API 密鑰

創建具有所需最低權限的 API 密鑰：
- 監控器管理
- 警報策略管理
- 團隊管理（如需要）

### 3. 網絡安全

```hcl
# 帶 TLS 驗證的示例
provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"
  api_key       = var.oneuptime_api_key
  
  # 如果支持的話，添加其他安全選項
  verify_ssl = true
  timeout    = "30s"
}
```

## 監控您的 Terraform 自動化

爲您的 Terraform 自動化創建監控器：

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

## 自託管問題故障排查

### 問題：連接被拒絕

```
Error: connection refused
```

**解決方案**：
1. 檢查 OneUptime 實例是否正在運行
2. 驗證 API URL 是否正確
3. 檢查防火牆/網絡連接
4. 驗證 TLS 證書是否有效

### 問題：API 版本不匹配

```
Error: API version incompatible
```

**解決方案**：
1. 檢查 OneUptime 版本：`curl https://your-instance/api/status`
2. 將提供商版本更新爲匹配版本
3. 運行 `terraform init -upgrade`

### 問題：自簽名證書

如果使用自簽名證書：

```bash
# 臨時跳過 TLS 驗證（不建議用於生產）
export ONEUPTIME_SKIP_TLS_VERIFY=true
```

更好的解決方案：將您的 CA 證書添加到系統信任儲存。

## 備份和災難恢復

### 狀態備份

```bash
# 定期備份狀態
terraform state pull > backup-$(date +%Y%m%d-%H%M%S).tfstate

# 自動備份腳本
#!/bin/bash
DATE=$(date +%Y%m%d-%H%M%S)
terraform state pull > "backups/terraform-state-${DATE}.tfstate"
find backups/ -name "terraform-state-*.tfstate" -mtime +30 -delete
```

### 配置備份

```bash
# 備份 Terraform 配置
tar -czf terraform-config-$(date +%Y%m%d).tar.gz *.tf *.tfvars
```

## 多環境管理

### 使用工作區

```bash
# 創建環境
terraform workspace new dev
terraform workspace new staging  
terraform workspace new prod

# 在環境間切換
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

這種方法提供更好的隔離性和更容易的每環境版本管理。
