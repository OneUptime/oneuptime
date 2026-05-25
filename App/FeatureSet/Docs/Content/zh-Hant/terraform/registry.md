# Terraform 提供商安裝與使用指南

## 從 Terraform Registry 安裝

OneUptime Terraform 提供商可在官方 [Terraform Registry](https://registry.terraform.io/providers/oneuptime/oneuptime) 上獲取。

### 適用於 OneUptime 雲端用戶

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # 使用最新兼容版本
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### 適用於自託管 OneUptime 用戶

⚠️ **關鍵**：自託管客戶必須將提供商版本固定到與其 OneUptime 安裝完全匹配的版本。

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # 替換爲您的確切 OneUptime 版本
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"  # 您的自託管 URL
  api_key       = var.oneuptime_api_key
}
```

## 自託管爲何需要版本固定？

OneUptime Terraform 提供商是從 OneUptime API 規範自動生成的。每個 OneUptime 版本可能具有：

- 不同的 API 端點
- 更新的資源 Schema
- 新增或刪除的功能
- 更改的驗證規則

使用與您的 OneUptime 安裝不匹配的提供商版本可能導致：
- API 兼容性錯誤
- 資源創建/更新失敗
- 意外行爲
- 資源狀態漂移

## 查找您的 OneUptime 版本

### 方法一：控制台
1. 登錄您的 OneUptime 控制台
2. 前往 **設置** → **關於**
3. 記錄版本號（例如"7.0.123"）

### 方法二：API
```bash
curl https://your-oneuptime-instance.com/api/version | jq '.version'
```

### 方法三：Docker
```bash
docker images | grep oneuptime
# 查看標籤，例如 oneuptime/dashboard:7.0.123
```

## 提供商 Registry 信息

- **Registry URL**：https://registry.terraform.io/providers/oneuptime/oneuptime
- **源代碼倉庫**：https://github.com/OneUptime/terraform-provider-oneuptime
- **文檔**：https://registry.terraform.io/providers/oneuptime/oneuptime/latest/docs
- **發佈版本**：https://github.com/OneUptime/terraform-provider-oneuptime/releases

## 版本兼容性矩陣

| OneUptime 版本 | 提供商版本 | Terraform 配置 |
|--------------|----------|---------------|
| 7.0.x | 7.0.x | `version = "~> 7.0.0"` |
| 7.1.x | 7.1.x | `version = "~> 7.1.0"` |
| 最新雲端版本 | 最新提供商 | `version = "~> 7.0"` |

## 快速開始示例

```hcl
# 配置提供商
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # 自託管請調整
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"  # 自託管請調整
  api_key       = var.oneuptime_api_key
}

# 創建項目
resource "oneuptime_project" "example" {
  name        = "Terraform Example"
  description = "Created with Terraform"
}

# 創建網站監控器
resource "oneuptime_monitor" "website" {
  name       = "Website Monitor"
  project_id = oneuptime_project.example.id
  
  monitor_type = "website"
  url          = "https://example.com"
  interval     = "5m"
  
  tags = {
    managed_by = "terraform"
  }
}
```

## 安裝步驟

1. **使用提供商塊創建您的 Terraform 配置**
2. **初始化 Terraform**：`terraform init`
3. **設置您的 API 密鑰**：使用您的 API 密鑰創建 `terraform.tfvars`
4. **規劃您的部署**：`terraform plan`
5. **應用您的配置**：`terraform apply`

## 獲取幫助

- **完整文檔**：參見[完整 Terraform 文檔](./README.md)
- **自託管指南**：查看[自託管配置指南](./self-hosted.md)
- **示例**：瀏覽[配置示例](./examples.md)
- **快速開始**：遵循[快速開始指南](./quick-start.md)

## Registry 更新

提供商在發佈新的 OneUptime 版本時自動發佈到 Terraform Registry。雲端用戶可以使用語義版本控制（`~> 7.0`）自動獲取兼容更新，而自託管用戶應固定到精確版本。
