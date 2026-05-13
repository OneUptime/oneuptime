# Terraform 提供商快速开始指南

本指南将帮助您在几分钟内开始使用 OneUptime Terraform 提供商。

## 前提条件

- 已安装 Terraform >= 1.0
- OneUptime 账号（云端或自托管）
- OneUptime API 密钥

## 第一步：创建 API 密钥

### 适用于 OneUptime 云端
1. 前往 [OneUptime Cloud](https://oneuptime.com) 并登录
2. 导航至 **设置** → **API 密钥**
3. 点击 **创建 API 密钥**
4. 将其命名为"Terraform Provider"
5. 选择所需权限
6. 复制生成的 API 密钥

### 适用于自托管 OneUptime
1. 访问您的 OneUptime 实例
2. 导航至 **设置** → **API 密钥**
3. 点击 **创建 API 密钥**
4. 将其命名为"Terraform Provider"
5. 选择所需权限
6. 复制生成的 API 密钥

## 第二步：创建 Terraform 配置

创建新目录和 `main.tf` 文件：

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      # 对于云端客户
      version = "~> 7.0"
      
      # 对于自托管客户 - 固定到您的确切版本
      # version = "= 7.0.123"  # 替换为您的 OneUptime 版本
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  # 对于云端客户
  oneuptime_url = "https://oneuptime.com"
  
  # 对于自托管客户 - 使用您的实例 URL
  # oneuptime_url = "https://oneuptime.yourcompany.com"
  
  api_key = var.oneuptime_api_key
}

variable "oneuptime_api_key" {
  description = "OneUptime API 密钥"
  type        = string
  sensitive   = true
}

# 注意：项目必须在 OneUptime 控制台中手动创建
# 在此使用您现有的项目 ID
variable "project_id" {
  description = "OneUptime 项目 ID"
  type        = string
}

# 创建简单的网站监控器
resource "oneuptime_monitor" "website" {
  name        = "Website Monitor"
  description = "Monitor for website uptime"
  data        = jsonencode({
    url = "https://example.com"
    interval = "5m"
    timeout = "30s"
  })
}

# 输出监控器 ID
output "monitor_id" {
  value = oneuptime_monitor.website.id
}
```

## 第三步：创建变量文件

创建 `terraform.tfvars`：

```hcl
# terraform.tfvars
oneuptime_api_key = "your-api-key-here"
project_id        = "your-project-id-here"  # 从 OneUptime 控制台获取
```

**重要提示**：将 `terraform.tfvars` 添加到您的 `.gitignore` 以保护 API 密钥安全！

## 第四步：初始化并应用

```bash
# 初始化 Terraform
terraform init

# 规划部署
terraform plan

# 应用配置
terraform apply
```

## 第五步：验证资源

1. 检查您的 OneUptime 控制台
2. 前往您现有的项目
3. 验证"Website Monitor"已创建并正在运行

## 后续步骤

1. **探索更多资源**：查看[完整文档](./README.md)了解所有可用资源
2. **设置告警**：添加告警策略和通知渠道
3. **创建状态页面**：为您的服务设置公共状态页面
4. **使用团队组织**：创建团队并分配权限

## 版本特定示例

### 云端客户（最新版本）

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # 始终获取最新兼容的 7.x 版本
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### 自托管客户（版本固定）

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # 必须与您的 OneUptime 版本完全匹配
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.mycompany.com"  # 您的自托管 URL
  api_key       = var.oneuptime_api_key
}
```

## 快速开始故障排查

### 问题：找不到提供商
```
Error: Failed to query available provider packages
```
**解决方案**：运行 `terraform init` 下载提供商

### 问题：认证失败
```
Error: Invalid API key
```
**解决方案**：
1. 在 OneUptime 控制台中验证您的 API 密钥
2. 检查 API 密钥是否有足够的权限
3. 确保 `oneuptime_url` 对您的实例是正确的

### 问题：版本不匹配（自托管）
```
Error: API version incompatible
```
**解决方案**：
1. 在控制台中检查您的 OneUptime 版本
2. 将提供商版本更新为完全匹配
3. 运行 `terraform init -upgrade`

## 清理

要删除此快速开始中创建的所有资源：

```bash
terraform destroy
```

这将删除快速开始期间创建的监控器和项目。
