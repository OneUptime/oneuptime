# OneUptime Terraform Provider

OneUptime Terraform Provider 讓您能夠使用基礎設施即程式碼（IaC）來管理 OneUptime 資源。此 provider 讓您能透過 Terraform 設定監控、事件管理、狀態頁面以及其他 OneUptime 功能。

## 目錄

- [安裝](#installation)
- [Provider 設定](#provider-configuration)
- [快速開始](#quick-start)
- [版本相容性](#version-compatibility)
- [可用資源](#available-resources)
- [範例](#examples)
- [最佳實踐](#best-practices)
- [遷移指南](#migration-guide)

## 安裝

### 從 Terraform Registry 安裝（建議）

OneUptime Terraform provider 可在 [Terraform Registry](https://registry.terraform.io/providers/oneuptime/oneuptime) 取得。

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Use latest 7.x version
    }
  }
  required_version = ">= 1.0"
}
```

### 自架安裝的版本鎖定

⚠️ **自架客戶須注意**：請務必將 Terraform provider 版本鎖定為與您的 OneUptime 安裝版本相符，以確保 API 相容性。

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Pin to exact version matching your OneUptime installation
    }
  }
  required_version = ">= 1.0"
}
```

#### 尋找您的 OneUptime 版本

您可以透過下列幾種方式找到您的 OneUptime 版本：

1. **儀表板**：在您的 OneUptime 儀表板中前往 Settings → About
2. **API**：呼叫 `GET /api/status` 端點
3. **Docker**：檢查您正在使用的映像標籤
4. **Helm**：檢查您的 Helm chart 版本

```bash
# Example: If running OneUptime 7.0.123
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"
    }
  }
}
```

## Provider 設定

### 基本設定

```hcl
provider "oneuptime" {
  oneuptime_url = "https://your-oneuptime-instance.com"  # Or https://oneuptime.com for cloud
  api_key       = var.oneuptime_api_key
}
```

### 環境變數

您可以使用環境變數來設定 provider：

```bash
export ONEUPTIME_URL="https://your-oneuptime-instance.com"
export ONEUPTIME_API_KEY="your-api-key-here"
```

然後即可在不需明確設定的情況下使用 provider：

```hcl
provider "oneuptime" {
  # Configuration will be read from environment variables
}
```

### 設定選項

| 參數            | 環境變數            | 說明               | 必填 |
| --------------- | ------------------- | ------------------ | ---- |
| `oneuptime_url` | `ONEUPTIME_URL`     | OneUptime URL      | 是   |
| `api_key`       | `ONEUPTIME_API_KEY` | OneUptime API 金鑰 | 是   |

## 快速開始

### 1. 建立 API 金鑰

首先，在您的 OneUptime 儀表板中建立一個 API 金鑰：

1. 前往 **Settings** → **API Keys**
2. 點選 **Create API Key**
3. 為它取一個具描述性的名稱（例如「Terraform Automation」）
4. 選擇適當的權限
5. 複製產生的 API 金鑰

### 2. 基本 Terraform 設定

建立一個 `main.tf` 檔案：

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"  # Use your instance URL
  api_key       = var.oneuptime_api_key
}

# Note: Projects must be created manually in the OneUptime dashboard
variable "project_id" {
  description = "OneUptime project ID"
  type        = string
}

# Create a monitor
resource "oneuptime_monitor" "website" {
  name        = "Website Monitor"
  description = "Monitor for website uptime"
  data        = jsonencode({
    url = "https://example.com"
    interval = "5m"
    timeout = "30s"
  })
}

# Create a team
resource "oneuptime_team" "platform" {
  name        = "Platform Team"
  description = "Platform engineering team"
}
    value = "alerts@example.com"
  }
}
```

### 3. 初始化並套用

```bash
# Initialize Terraform
terraform init

# Plan the changes
terraform plan

# Apply the configuration
terraform apply
```

## 版本相容性

### 雲端客戶

對於 OneUptime Cloud 客戶，請使用最新的 provider 版本：

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Always use latest compatible version
    }
  }
}
```

### 自架客戶

**重要**：自架客戶必須將 provider 版本鎖定為與其 OneUptime 安裝版本相符：

| OneUptime 版本 | Provider 版本 | 設定                   |
| -------------- | ------------- | ---------------------- |
| 7.0.x          | 7.0.x         | `version = "~> 7.0.0"` |
| 7.1.x          | 7.1.x         | `version = "~> 7.1.0"` |
| 7.2.x          | 7.2.x         | `version = "~> 7.2.0"` |

OneUptime 7.0.123 的範例：

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Exact version match
    }
  }
}
```

## 可用資源

OneUptime Terraform provider 支援下列資源：

### 核心資源

- `oneuptime_team` - 管理團隊

### 監控

- `oneuptime_monitor` - 建立並管理監控器
- `oneuptime_probe` - 管理監控探針

### 待命管理

- `oneuptime_on_call_duty_policy` - 設定待命排程

### 狀態頁面

- `oneuptime_status_page` - 建立狀態頁面

### 服務目錄

- `oneuptime_service_catalog` - 管理服務目錄項目

### 服務目錄

- `oneuptime_service` - 定義服務
- `oneuptime_service_dependency` - 對應服務相依性

### 資料來源

注意：provider 目前不提供資料來源，因為 provider schema 中未定義任何 datasource。

## 範例

### 完整監控設定

```hcl
# Variables
variable "oneuptime_api_key" {
  description = "OneUptime API Key"
  type        = string
  sensitive   = true
}

variable "project_id" {
  description = "OneUptime project ID (create project manually in dashboard)"
  type        = string
}

variable "oneuptime_url" {
  description = "OneUptime URL"
  type        = string
  default     = "https://oneuptime.com"
}

# Provider configuration
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = var.oneuptime_url
  api_key       = var.oneuptime_api_key
}

# Team
resource "oneuptime_team" "platform" {
  name        = "Platform Team"
  description = "Platform engineering team"
}

# Monitors
resource "oneuptime_monitor" "api" {
  name        = "API Health Check"
  description = "Monitor for API health endpoint"
  data        = jsonencode({
    url = "https://api.mycompany.com/health"
    method = "GET"
    interval = "1m"
    timeout = "30s"
  })
  }
}

resource "oneuptime_monitor" "database" {
  name       = "Database Connection"
  project_id = oneuptime_project.production.id

  monitor_type = "port"
  hostname     = "db.mycompany.com"
  port         = 5432
  interval     = "2m"

  tags = {
    service     = "database"
    environment = "production"
    criticality = "critical"
  }
}

# On-call policy
resource "oneuptime_on_call_policy" "platform_oncall" {
  name       = "Platform On-Call"
  project_id = oneuptime_project.production.id
  team_id    = oneuptime_team.platform.id

  schedules {
    name      = "Business Hours"
    timezone  = "America/New_York"

    layers {
      name = "Primary"
      users = ["user1@mycompany.com", "user2@mycompany.com"]
      rotation_type = "weekly"
      start_time = "09:00"
      end_time = "17:00"
      days = ["monday", "tuesday", "wednesday", "thursday", "friday"]
    }
  }
}

# Alert policy
resource "oneuptime_alert_policy" "critical_alerts" {
  name       = "Critical System Alerts"
  project_id = oneuptime_project.production.id

  conditions {
    monitor_id = oneuptime_monitor.api.id
    threshold  = "down"
  }

  conditions {
    monitor_id = oneuptime_monitor.database.id
    threshold  = "down"
  }

  actions {
    type = "webhook"
    url  = "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK"
  }

  actions {
    type           = "oncall_escalation"
    oncall_policy_id = oneuptime_on_call_policy.platform_oncall.id
  }
}

# Status page
resource "oneuptime_status_page" "public" {
  name       = "MyCompany Status"
  project_id = oneuptime_project.production.id

  domain = "status.mycompany.com"

  components {
    name       = "API"
    monitor_id = oneuptime_monitor.api.id
  }

  components {
    name       = "Database"
    monitor_id = oneuptime_monitor.database.id
  }
}
```

### 自架設定範例

```hcl
# For self-hosted OneUptime instance version 7.0.123
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Must match your OneUptime version exactly
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.mycompany.com"  # Your self-hosted URL
  api_key       = var.oneuptime_api_key
}

# Rest of your configuration...
```

## 最佳實踐

### 1. 版本管理

**雲端客戶：**

- 使用語意化版本搭配 `~>` 以取得相容的更新
- 在進行主要版本升級前審閱變更日誌

**自架客戶：**

- 務必鎖定為與您安裝版本完全相符的版本
- 在升級 OneUptime 時更新 provider 版本
- 先在非正式環境中測試

### 2. 狀態管理

```hcl
terraform {
  backend "s3" {
    bucket = "my-terraform-state"
    key    = "oneuptime/terraform.tfstate"
    region = "us-west-2"
  }
}
```

### 3. 環境隔離

針對不同環境使用 workspace 或個別的狀態檔案：

```bash
# Using workspaces
terraform workspace new production
terraform workspace new staging

# Using separate directories
mkdir -p environments/{staging,production}
```

### 4. 變數管理

```hcl
# variables.tf
variable "environment" {
  description = "Environment name"
  type        = string
}

variable "monitors" {
  description = "List of monitors to create"
  type = list(object({
    name = string
    url  = string
    type = string
  }))
}

# terraform.tfvars
environment = "production"
monitors = [
  {
    name = "Website"
    url  = "https://example.com"
    type = "website"
  },
  {
    name = "API"
    url  = "https://api.example.com/health"
    type = "api"
  }
]
```

### 5. 資源命名

使用一致的命名慣例：

```hcl
resource "oneuptime_monitor" "website_production" {
  name = "${var.environment}-website-monitor"
  # ...
}

resource "oneuptime_alert_policy" "critical_production" {
  name = "${var.environment}-critical-alerts"
  # ...
}
```

## 遷移指南

### 從手動設定遷移

1. **稽核既有資源**（在 OneUptime 儀表板中）
2. **為既有資源建立 Terraform 設定**
3. **將既有資源匯入** Terraform 狀態
4. **驗證設定**是否與目前狀態相符
5. **逐步套用變更**

匯入範例：

```bash
# Import existing monitor
terraform import oneuptime_monitor.website monitor-id-here

# Import existing project
terraform import oneuptime_project.main project-id-here
```

### 版本升級

在升級 OneUptime（自架）時：

1. **備份您目前的狀態**
2. **檢查 provider 相容性**
3. **更新設定中的 provider 版本**
4. **在測試環境中測試**
5. **套用至正式環境**

```bash
# Backup state
terraform state pull > backup.tfstate

# Update provider version
# Edit terraform block in your configuration

# Plan and apply
terraform init -upgrade
terraform plan
terraform apply
```

## 支援與資源

- **文件**：[OneUptime Docs](https://docs.oneuptime.com)
- **Terraform Registry**：[OneUptime Provider](https://registry.terraform.io/providers/oneuptime/oneuptime)
- **GitHub Issues**：[OneUptime GitHub](https://github.com/OneUptime/oneuptime/issues)
- **社群**：[OneUptime Community](https://community.oneuptime.com)

## 疑難排解

### 常見問題

1. **版本不符（自架）**

   ```
   Error: API version incompatible
   ```

   **解決方法**：確保 provider 版本與 OneUptime 安裝版本相符

2. **驗證問題**

   ```
   Error: Invalid API key
   ```

   **解決方法**：驗證 API 金鑰與權限

3. **找不到資源**
   ```
   Error: Resource not found
   ```
   **解決方法**：檢查資源 ID 並確保資源存在

### 除錯模式

啟用詳細記錄：

```bash
export TF_LOG=DEBUG
terraform apply
```

### 版本檢查

驗證您的設定：

```bash
# Check Terraform version
terraform version

# Check provider version
terraform providers

# Validate configuration
terraform validate
```
