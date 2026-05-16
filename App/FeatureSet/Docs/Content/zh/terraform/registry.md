# Terraform 提供商安装与使用指南

## 从 Terraform Registry 安装

OneUptime Terraform 提供商可在官方 [Terraform Registry](https://registry.terraform.io/providers/oneuptime/oneuptime) 上获取。

### 适用于 OneUptime 云端用户

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

### 适用于自托管 OneUptime 用户

⚠️ **关键**：自托管客户必须将提供商版本固定到与其 OneUptime 安装完全匹配的版本。

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # 替换为您的确切 OneUptime 版本
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"  # 您的自托管 URL
  api_key       = var.oneuptime_api_key
}
```

## 自托管为何需要版本固定？

OneUptime Terraform 提供商是从 OneUptime API 规范自动生成的。每个 OneUptime 版本可能具有：

- 不同的 API 端点
- 更新的资源 Schema
- 新增或删除的功能
- 更改的验证规则

使用与您的 OneUptime 安装不匹配的提供商版本可能导致：
- API 兼容性错误
- 资源创建/更新失败
- 意外行为
- 资源状态漂移

## 查找您的 OneUptime 版本

### 方法一：控制台
1. 登录您的 OneUptime 控制台
2. 前往 **设置** → **关于**
3. 记录版本号（例如"7.0.123"）

### 方法二：API
```bash
curl https://your-oneuptime-instance.com/api/version | jq '.version'
```

### 方法三：Docker
```bash
docker images | grep oneuptime
# 查看标签，例如 oneuptime/dashboard:7.0.123
```

## 提供商 Registry 信息

- **Registry URL**：https://registry.terraform.io/providers/oneuptime/oneuptime
- **源代码仓库**：https://github.com/OneUptime/terraform-provider-oneuptime
- **文档**：https://registry.terraform.io/providers/oneuptime/oneuptime/latest/docs
- **发布版本**：https://github.com/OneUptime/terraform-provider-oneuptime/releases

## 版本兼容性矩阵

| OneUptime 版本 | 提供商版本 | Terraform 配置 |
|--------------|----------|---------------|
| 7.0.x | 7.0.x | `version = "~> 7.0.0"` |
| 7.1.x | 7.1.x | `version = "~> 7.1.0"` |
| 最新云端版本 | 最新提供商 | `version = "~> 7.0"` |

## 快速开始示例

```hcl
# 配置提供商
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # 自托管请调整
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"  # 自托管请调整
  api_key       = var.oneuptime_api_key
}

# 创建项目
resource "oneuptime_project" "example" {
  name        = "Terraform Example"
  description = "Created with Terraform"
}

# 创建网站监控器
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

## 安装步骤

1. **使用提供商块创建您的 Terraform 配置**
2. **初始化 Terraform**：`terraform init`
3. **设置您的 API 密钥**：使用您的 API 密钥创建 `terraform.tfvars`
4. **规划您的部署**：`terraform plan`
5. **应用您的配置**：`terraform apply`

## 获取帮助

- **完整文档**：参见[完整 Terraform 文档](./README.md)
- **自托管指南**：查看[自托管配置指南](./self-hosted.md)
- **示例**：浏览[配置示例](./examples.md)
- **快速开始**：遵循[快速开始指南](./quick-start.md)

## Registry 更新

提供商在发布新的 OneUptime 版本时自动发布到 Terraform Registry。云端用户可以使用语义版本控制（`~> 7.0`）自动获取兼容更新，而自托管用户应固定到精确版本。
