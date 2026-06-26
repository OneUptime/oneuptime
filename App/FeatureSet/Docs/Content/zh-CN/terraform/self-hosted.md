# 自托管 OneUptime Terraform 配置指南

本指南专门针对运行自托管 OneUptime 实例的客户。它涵盖了使用 Terraform 提供商与您自己的 OneUptime 部署时的版本管理、配置和最佳实践。

## 重要提示

⚠️ **无法通过 Terraform 创建项目** - 必须先在 OneUptime 控制台中手动创建项目。在您的 Terraform 配置中使用项目 ID。

⚠️ **自托管客户最重要的规则**：始终将您的 Terraform 提供商版本固定到与您的 OneUptime 安装版本完全匹配的版本。

## 资源结构

所有 OneUptime Terraform 资源遵循简化结构：

- `name`（必填）- 资源名称
- `description`（可选）- 资源描述
- `data`（可选）- JSON 格式的复杂配置

## 关键：版本兼容性

⚠️ **自托管客户最重要的规则**：始终将您的 Terraform 提供商版本固定到与您的 OneUptime 安装版本完全匹配的版本。

### 为什么版本固定至关重要

- Terraform 提供商是从 OneUptime API 自动生成的
- 每个 OneUptime 版本可能有不同的 API 端点和 Schema
- 使用不匹配的提供商版本可能导致错误或意外行为
- 版本固定确保兼容性和可预测的行为

## 查找您的 OneUptime 版本

### 方法一：控制台

1. 登录您的 OneUptime 控制台
2. 前往 **设置** → **关于**
3. 查找版本号（例如"7.0.123"）

### 方法二：API 端点

```bash
curl https://your-oneuptime-instance.com/api/status
```

### 方法三：Docker 镜像

如果您使用 Docker 运行 OneUptime：

```bash
docker images | grep oneuptime
# 查看标签，例如 oneuptime/dashboard:7.0.123
```

### 方法四：Helm Chart

如果您使用 Helm：

```bash
helm list -n oneuptime
# 检查 Chart 版本
```

### 方法五：环境变量

检查您的配置文件中的版本变量：

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
      version = "= 7.0.123"  # 替换 123 为您的确切构建号
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"  # 您的自托管 URL
  api_key       = var.oneuptime_api_key
}
```

### 版本 7.1.x 的模板

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.1.45"  # 替换为您的确切版本
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"
  api_key       = var.oneuptime_api_key
}
```

## 完整的自托管配置示例

以下是自托管 OneUptime 实例的完整示例：

```hcl
# versions.tf
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # 必须与您的 OneUptime 版本匹配
    }
  }
  required_version = ">= 1.0"

  # 可选：使用远程状态进行团队协作
  backend "s3" {
    bucket = "your-terraform-state-bucket"
    key    = "oneuptime/terraform.tfstate"
    region = "us-west-2"
  }
}

# variables.tf
variable "oneuptime_url" {
  description = "OneUptime 实例 URL"
  type        = string
  default     = "https://oneuptime.yourcompany.com"
}

variable "oneuptime_api_key" {
  description = "OneUptime API 密钥"
  type        = string
  sensitive   = true
}

variable "environment" {
  description = "环境名称"
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
  description = "OneUptime 项目 ID（在控制台中手动创建）"
  type        = string
}

# main.tf
# 创建团队
resource "oneuptime_team" "infrastructure" {
  name        = "Infrastructure Team"
  description = "Infrastructure and operations team"
}

resource "oneuptime_team" "development" {
  name        = "Development Team"
  description = "Application development team"
  project_id = oneuptime_project.main.id
}

# 基础设施监控器
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

# 告警策略
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

# 内部状态页面
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
  description = "项目 ID"
  value       = oneuptime_project.main.id
}

output "status_page_url" {
  description = "状态页面 URL"
  value       = "https://${oneuptime_status_page.internal.domain}"
}
```

## 特定环境配置

### 开发环境

```hcl
# dev.tfvars
oneuptime_url = "https://oneuptime-dev.yourcompany.com"
environment = "development"
```

### 预发布环境

```hcl
# staging.tfvars
oneuptime_url = "https://oneuptime-staging.yourcompany.com"
environment = "staging"
```

### 生产环境

```hcl
# prod.tfvars
oneuptime_url = "https://oneuptime.yourcompany.com"
environment = "production"
```

## 自托管升级流程

升级您的 OneUptime 实例时：

### 1. 升级前检查清单

```bash
# 备份当前 Terraform 状态
terraform state pull > backup-$(date +%Y%m%d).tfstate

# 记录当前 OneUptime 版本
curl https://oneuptime.yourcompany.com/api/status | jq '.version'

# 记录当前提供商版本
terraform providers | grep oneuptime
```

### 2. 升级 OneUptime 实例

按照您的标准 OneUptime 升级流程（Docker、Helm 等）

### 3. 更新 Terraform 提供商

```hcl
# 更新 terraform 块中的版本
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.124"  # 升级后的新版本
    }
  }
}
```

### 4. 测试并应用

```bash
# 更新提供商
terraform init -upgrade

# 规划以查看任何变更
terraform plan

# 如果一切正常，应用
terraform apply
```

## 网络配置

### 防火墙规则

确保您的 Terraform 运行器可以访问：

- OneUptime API 端点（通常是 443 端口/HTTPS）
- 任何被监控的内部资源

### VPN/私有网络

如果 OneUptime 在私有网络上：

```hcl
provider "oneuptime" {
  oneuptime_url = "https://10.0.1.100:443"  # 内部 IP
  api_key       = var.oneuptime_api_key
}
```

## 安全最佳实践

### 1. API 密钥管理

```bash
# 使用环境变量
export ONEUPTIME_API_KEY="your-api-key"

# 或使用密钥管理系统
export ONEUPTIME_API_KEY=$(vault kv get -field=api_key secret/oneuptime)
```

### 2. 最小权限 API 密钥

创建具有所需最低权限的 API 密钥：

- 监控器管理
- 告警策略管理
- 团队管理（如需要）

### 3. 网络安全

```hcl
# 带 TLS 验证的示例
provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"
  api_key       = var.oneuptime_api_key

  # 如果支持的话，添加其他安全选项
  verify_ssl = true
  timeout    = "30s"
}
```

## 监控您的 Terraform 自动化

为您的 Terraform 自动化创建监控器：

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

## 自托管问题故障排查

### 问题：连接被拒绝

```
Error: connection refused
```

**解决方案**：

1. 检查 OneUptime 实例是否正在运行
2. 验证 API URL 是否正确
3. 检查防火墙/网络连接
4. 验证 TLS 证书是否有效

### 问题：API 版本不匹配

```
Error: API version incompatible
```

**解决方案**：

1. 检查 OneUptime 版本：`curl https://your-instance/api/status`
2. 将提供商版本更新为匹配版本
3. 运行 `terraform init -upgrade`

### 问题：自签名证书

如果使用自签名证书：

```bash
# 临时跳过 TLS 验证（不建议用于生产）
export ONEUPTIME_SKIP_TLS_VERIFY=true
```

更好的解决方案：将您的 CA 证书添加到系统信任存储。

## 备份和灾难恢复

### 状态备份

```bash
# 定期备份状态
terraform state pull > backup-$(date +%Y%m%d-%H%M%S).tfstate

# 自动备份脚本
#!/bin/bash
DATE=$(date +%Y%m%d-%H%M%S)
terraform state pull > "backups/terraform-state-${DATE}.tfstate"
find backups/ -name "terraform-state-*.tfstate" -mtime +30 -delete
```

### 配置备份

```bash
# 备份 Terraform 配置
tar -czf terraform-config-$(date +%Y%m%d).tar.gz *.tf *.tfvars
```

## 多环境管理

### 使用工作区

```bash
# 创建环境
terraform workspace new dev
terraform workspace new staging
terraform workspace new prod

# 在环境间切换
terraform workspace select prod
terraform apply -var-file="prod.tfvars"
```

### 使用独立目录

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

这种方法提供更好的隔离性和更容易的每环境版本管理。
