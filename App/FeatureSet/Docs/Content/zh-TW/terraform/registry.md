# Terraform Provider 安裝與使用指南

## 從 Terraform Registry 安裝

OneUptime Terraform Provider 已發佈於官方的 [Terraform Registry](https://registry.terraform.io/providers/oneuptime/oneuptime)。

### 給 OneUptime Cloud 使用者

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Use latest compatible version
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### 給自架 OneUptime 使用者

⚠️ **重要**：自架客戶必須將 provider 版本精確鎖定為與其 OneUptime 安裝版本完全相符。

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Replace with your exact OneUptime version
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"  # Your self-hosted URL
  api_key       = var.oneuptime_api_key
}
```

## 為何自架需要鎖定版本？

OneUptime Terraform provider 是根據 OneUptime API 規格自動產生的。每個 OneUptime 版本可能有：

- 不同的 API 端點
- 更新過的資源結構描述
- 新增或移除的功能
- 變更過的驗證規則

使用與您的 OneUptime 安裝版本不符的 provider 版本，可能會導致：

- API 相容性錯誤
- 資源建立／更新失敗
- 非預期的行為
- 資源狀態漂移

## 找出您的 OneUptime 版本

### 方法 1：儀表板

1. 登入您的 OneUptime 儀表板
2. 前往 **Settings** → **About**
3. 記下版本號（例如「7.0.123」）

### 方法 2：API

```bash
curl https://your-oneuptime-instance.com/api/version | jq '.version'
```

### 方法 3：Docker

```bash
docker images | grep oneuptime
# Look for the tag, e.g., oneuptime/dashboard:7.0.123
```

## Provider Registry 資訊

- **Registry URL**：https://registry.terraform.io/providers/oneuptime/oneuptime
- **原始碼儲存庫**：https://github.com/OneUptime/terraform-provider-oneuptime
- **文件**：https://registry.terraform.io/providers/oneuptime/oneuptime/latest/docs
- **發行版本**：https://github.com/OneUptime/terraform-provider-oneuptime/releases

## 版本相容性對照表

| OneUptime 版本 | Provider 版本 | Terraform 設定         |
| -------------- | ------------- | ---------------------- |
| 7.0.x          | 7.0.x         | `version = "~> 7.0.0"` |
| 7.1.x          | 7.1.x         | `version = "~> 7.1.0"` |
| 最新 Cloud     | 最新 Provider | `version = "~> 7.0"`   |

## 快速入門範例

```hcl
# Configure the provider
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Adjust for self-hosted
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"  # Adjust for self-hosted
  api_key       = var.oneuptime_api_key
}

# Create a project
resource "oneuptime_project" "example" {
  name        = "Terraform Example"
  description = "Created with Terraform"
}

# Create a website monitor
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

1. **建立您的 Terraform 設定**，並加入 provider 區塊
2. **初始化 Terraform**：`terraform init`
3. **設定您的 API 金鑰**：建立 `terraform.tfvars` 並填入您的 API 金鑰
4. **規劃您的部署**：`terraform plan`
5. **套用您的設定**：`terraform apply`

## 取得協助

- **完整文件**：請參閱[完整的 Terraform 文件](./README.md)
- **自架指南**：查看[自架設定指南](./self-hosted.md)
- **範例**：瀏覽[設定範例](./examples.md)
- **快速入門**：依照[快速入門指南](./quick-start.md)操作

## Registry 更新

當新的 OneUptime 版本發行時，provider 會自動發佈至 Terraform Registry。Cloud 使用者可以使用語意化版本（`~> 7.0`）來自動取得相容的更新，而自架使用者則應鎖定至確切版本。
