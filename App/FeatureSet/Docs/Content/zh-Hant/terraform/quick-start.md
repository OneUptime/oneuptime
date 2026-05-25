# Terraform 提供商快速開始指南

本指南將幫助您在幾分鐘內開始使用 OneUptime Terraform 提供商。

## 前提條件

- 已安裝 Terraform >= 1.0
- OneUptime 賬號（雲端或自託管）
- OneUptime API 密鑰

## 第一步：創建 API 密鑰

### 適用於 OneUptime 雲端
1. 前往 [OneUptime Cloud](https://oneuptime.com) 並登錄
2. 導航至 **設置** → **API 密鑰**
3. 點擊 **創建 API 密鑰**
4. 將其命名爲"Terraform Provider"
5. 選擇所需權限
6. 複製生成的 API 密鑰

### 適用於自託管 OneUptime
1. 訪問您的 OneUptime 實例
2. 導航至 **設置** → **API 密鑰**
3. 點擊 **創建 API 密鑰**
4. 將其命名爲"Terraform Provider"
5. 選擇所需權限
6. 複製生成的 API 密鑰

## 第二步：創建 Terraform 配置

創建新目錄和 `main.tf` 文件：

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      # 對於雲端客戶
      version = "~> 7.0"
      
      # 對於自託管客戶 - 固定到您的確切版本
      # version = "= 7.0.123"  # 替換爲您的 OneUptime 版本
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  # 對於雲端客戶
  oneuptime_url = "https://oneuptime.com"
  
  # 對於自託管客戶 - 使用您的實例 URL
  # oneuptime_url = "https://oneuptime.yourcompany.com"
  
  api_key = var.oneuptime_api_key
}

variable "oneuptime_api_key" {
  description = "OneUptime API 密鑰"
  type        = string
  sensitive   = true
}

# 注意：項目必須在 OneUptime 控制台中手動創建
# 在此使用您現有的項目 ID
variable "project_id" {
  description = "OneUptime 項目 ID"
  type        = string
}

# 創建簡單的網站監控器
resource "oneuptime_monitor" "website" {
  name        = "Website Monitor"
  description = "Monitor for website uptime"
  data        = jsonencode({
    url = "https://example.com"
    interval = "5m"
    timeout = "30s"
  })
}

# 輸出監控器 ID
output "monitor_id" {
  value = oneuptime_monitor.website.id
}
```

## 第三步：創建變量文件

創建 `terraform.tfvars`：

```hcl
# terraform.tfvars
oneuptime_api_key = "your-api-key-here"
project_id        = "your-project-id-here"  # 從 OneUptime 控制台獲取
```

**重要提示**：將 `terraform.tfvars` 添加到您的 `.gitignore` 以保護 API 密鑰安全！

## 第四步：初始化並應用

```bash
# 初始化 Terraform
terraform init

# 規劃部署
terraform plan

# 應用配置
terraform apply
```

## 第五步：驗證資源

1. 檢查您的 OneUptime 控制台
2. 前往您現有的項目
3. 驗證"Website Monitor"已創建並正在運行

## 後續步驟

1. **探索更多資源**：查看[完整文檔](./README.md)瞭解所有可用資源
2. **設置警報**：添加警報策略和通知渠道
3. **創建狀態頁面**：爲您的服務設置公共狀態頁面
4. **使用團隊組織**：創建團隊並分配權限

## 版本特定示例

### 雲端客戶（最新版本）

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # 始終獲取最新兼容的 7.x 版本
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### 自託管客戶（版本固定）

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # 必須與您的 OneUptime 版本完全匹配
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.mycompany.com"  # 您的自託管 URL
  api_key       = var.oneuptime_api_key
}
```

## 快速開始故障排查

### 問題：找不到提供商
```
Error: Failed to query available provider packages
```
**解決方案**：運行 `terraform init` 下載提供商

### 問題：認證失敗
```
Error: Invalid API key
```
**解決方案**：
1. 在 OneUptime 控制台中驗證您的 API 密鑰
2. 檢查 API 密鑰是否有足夠的權限
3. 確保 `oneuptime_url` 對您的實例是正確的

### 問題：版本不匹配（自託管）
```
Error: API version incompatible
```
**解決方案**：
1. 在控制台中檢查您的 OneUptime 版本
2. 將提供商版本更新爲完全匹配
3. 運行 `terraform init -upgrade`

## 清理

要刪除此快速開始中創建的所有資源：

```bash
terraform destroy
```

這將刪除快速開始期間創建的監控器和項目。
