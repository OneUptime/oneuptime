# OneUptime Terraform 提供商

OneUptime Terraform 提供商允許您使用基礎設施即代碼（IaC）來管理 OneUptime 資源。通過此提供商，您可以通過 Terraform 配置監控、事件管理、狀態頁面和其他 OneUptime 功能。

## 目錄

- [安裝](#安裝)
- [提供商配置](#提供商配置)
- [快速開始](#快速開始)
- [版本兼容性](#版本兼容性)
- [可用資源](#可用資源)
- [示例](#示例)
- [最佳實踐](#最佳實踐)
- [遷移指南](#遷移指南)

## 安裝

### 從 Terraform Registry 安裝（推薦）

OneUptime Terraform 提供商可在 [Terraform Registry](https://registry.terraform.io/providers/oneuptime/oneuptime) 上獲取。

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # 使用最新的 7.x 版本
    }
  }
  required_version = ">= 1.0"
}
```

### 自託管安裝的版本固定

⚠️ **自託管客戶的重要提示**：始終將 Terraform 提供商版本固定到與您的 OneUptime 安裝版本匹配的版本，以確保 API 兼容性。

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # 固定到與您的 OneUptime 安裝完全匹配的版本
    }
  }
  required_version = ">= 1.0"
}
```

#### 查找您的 OneUptime 版本

您可以通過幾種方式找到您的 OneUptime 版本：

1. **控制台**：在 OneUptime 控制台中前往 設置 → 關於
2. **API**：調用 `GET /api/status` 端點
3. **Docker**：檢查您使用的鏡像標籤
4. **Helm**：檢查您的 Helm Chart 版本

```bash
# 示例：如果運行 OneUptime 7.0.123
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"
    }
  }
}
```

## 提供商配置

### 基本配置

```hcl
provider "oneuptime" {
  oneuptime_url = "https://your-oneuptime-instance.com"  # 或 https://oneuptime.com（雲端）
  api_key       = var.oneuptime_api_key
}
```

### 環境變量

您可以使用環境變量配置提供商：

```bash
export ONEUPTIME_URL="https://your-oneuptime-instance.com"
export ONEUPTIME_API_KEY="your-api-key-here"
```

然後不需要顯式配置地使用提供商：

```hcl
provider "oneuptime" {
  # 配置將從環境變量中讀取
}
```

### 配置選項

| 參數 | 環境變量 | 描述 | 是否必填 |
|------|---------|------|---------|
| `oneuptime_url` | `ONEUPTIME_URL` | OneUptime URL | 是 |
| `api_key` | `ONEUPTIME_API_KEY` | OneUptime API 密鑰 | 是 |

## 快速開始

### 1. 創建 API 密鑰

首先，在您的 OneUptime 控制台中創建 API 密鑰：

1. 前往 **設置** → **API 密鑰**
2. 點擊 **創建 API 密鑰**
3. 提供描述性名稱（例如"Terraform 自動化"）
4. 選擇適當的權限
5. 複製生成的 API 密鑰

### 2. 基本 Terraform 配置

創建 `main.tf` 文件：

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
  oneuptime_url = "https://oneuptime.com"  # 使用您的實例 URL
  api_key       = var.oneuptime_api_key
}

# 注意：項目必須在 OneUptime 控制台中手動創建
variable "project_id" {
  description = "OneUptime 項目 ID"
  type        = string
}

# 創建監控器
resource "oneuptime_monitor" "website" {
  name        = "Website Monitor"
  description = "Monitor for website uptime"
  data        = jsonencode({
    url = "https://example.com"
    interval = "5m"
    timeout = "30s"
  })
}

# 創建團隊
resource "oneuptime_team" "platform" {
  name        = "Platform Team"
  description = "Platform engineering team"
}
    value = "alerts@example.com"
  }
}
```

### 3. 初始化並應用

```bash
# 初始化 Terraform
terraform init

# 計劃變更
terraform plan

# 應用配置
terraform apply
```

## 版本兼容性

### 雲端客戶

對於 OneUptime 雲端客戶，使用最新的提供商版本：

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # 始終使用最新兼容版本
    }
  }
}
```

### 自託管客戶

**關鍵**：自託管客戶必須將提供商版本固定到與其 OneUptime 安裝匹配的版本：

| OneUptime 版本 | 提供商版本 | 配置 |
|--------------|----------|------|
| 7.0.x | 7.0.x | `version = "~> 7.0.0"` |
| 7.1.x | 7.1.x | `version = "~> 7.1.0"` |
| 7.2.x | 7.2.x | `version = "~> 7.2.0"` |

OneUptime 7.0.123 的示例：

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # 精確版本匹配
    }
  }
}
```

## 可用資源

OneUptime Terraform 提供商支持以下資源：

### 核心資源
- `oneuptime_team` - 管理團隊

### 監控
- `oneuptime_monitor` - 創建和管理監控器
- `oneuptime_probe` - 管理監控探針

### 值班管理
- `oneuptime_on_call_duty_policy` - 設置值班排班

### 狀態頁面
- `oneuptime_status_page` - 創建狀態頁面

### 服務目錄
- `oneuptime_service_catalog` - 管理服務目錄條目

### 服務目錄
- `oneuptime_service` - 定義服務
- `oneuptime_service_dependency` - 映射服務依賴

### 數據源
注意：提供商架構中當前未定義數據源，因此目前數據源不可用。

## 示例

### 完整監控設置

```hcl
# 變量
variable "oneuptime_api_key" {
  description = "OneUptime API 密鑰"
  type        = string
  sensitive   = true
}

variable "project_id" {
  description = "OneUptime 項目 ID（在控制台中手動創建項目）"
  type        = string
}

variable "oneuptime_url" {
  description = "OneUptime URL"
  type        = string
  default     = "https://oneuptime.com"
}

# 提供商配置
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

# 團隊
resource "oneuptime_team" "platform" {
  name        = "Platform Team"
  description = "Platform engineering team"
}

# 監控器
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

# 值班策略
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

# 警報策略
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

# 狀態頁面
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

### 自託管配置示例

```hcl
# 適用於自託管 OneUptime 實例版本 7.0.123
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # 必須與您的 OneUptime 版本完全匹配
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.mycompany.com"  # 您的自託管 URL
  api_key       = var.oneuptime_api_key
}

# 其餘配置...
```

## 最佳實踐

### 1. 版本管理

**對於雲端客戶：**
- 使用語義版本控制 `~>` 獲取兼容更新
- 在主版本升級前查看更新日誌

**對於自託管客戶：**
- 始終固定到與您的安裝完全匹配的版本
- 升級 OneUptime 時更新提供商版本
- 先在非生產環境中測試

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

### 3. 環境分離

使用工作區或獨立狀態文件區分不同環境：

```bash
# 使用工作區
terraform workspace new production
terraform workspace new staging

# 使用獨立目錄
mkdir -p environments/{staging,production}
```

### 4. 變量管理

```hcl
# variables.tf
variable "environment" {
  description = "環境名稱"
  type        = string
}

variable "monitors" {
  description = "要創建的監控器列表"
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

使用一致的命名規範：

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

### 從手動配置遷移

1. **審計 OneUptime 控制台中的現有資源**
2. **爲現有資源創建 Terraform 配置**
3. **將現有資源導入 Terraform 狀態**
4. **驗證配置與當前狀態匹配**
5. **逐步應用變更**

導入示例：

```bash
# 導入現有監控器
terraform import oneuptime_monitor.website monitor-id-here

# 導入現有項目
terraform import oneuptime_project.main project-id-here
```

### 版本升級

升級 OneUptime（自託管）時：

1. **備份您的當前狀態**
2. **檢查提供商兼容性**
3. **更新配置中的提供商版本**
4. **在預發佈環境中測試**
5. **應用到生產環境**

```bash
# 備份狀態
terraform state pull > backup.tfstate

# 更新提供商版本
# 編輯配置中的 terraform 塊

# 計劃並應用
terraform init -upgrade
terraform plan
terraform apply
```

## 支持和資源

- **文檔**：[OneUptime 文檔](https://docs.oneuptime.com)
- **Terraform Registry**：[OneUptime 提供商](https://registry.terraform.io/providers/oneuptime/oneuptime)
- **GitHub Issues**：[OneUptime GitHub](https://github.com/OneUptime/oneuptime/issues)
- **社區**：[OneUptime 社區](https://community.oneuptime.com)

## 故障排查

### 常見問題

1. **版本不匹配（自託管）**
   ```
   Error: API version incompatible
   ```
   **解決方案**：確保提供商版本與 OneUptime 安裝版本匹配

2. **認證問題**
   ```
   Error: Invalid API key
   ```
   **解決方案**：驗證 API 密鑰和權限

3. **資源未找到**
   ```
   Error: Resource not found
   ```
   **解決方案**：檢查資源 ID 並確保資源存在

### 調試模式

啓用詳細日誌：

```bash
export TF_LOG=DEBUG
terraform apply
```

### 版本檢查

驗證您的設置：

```bash
# 檢查 Terraform 版本
terraform version

# 檢查提供商版本
terraform providers

# 驗證配置
terraform validate
```
