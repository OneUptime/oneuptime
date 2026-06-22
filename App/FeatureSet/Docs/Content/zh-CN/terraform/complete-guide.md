# OneUptime Terraform 提供商

OneUptime Terraform 提供商允许您使用基础设施即代码（IaC）来管理 OneUptime 资源。通过此提供商，您可以通过 Terraform 配置监控、事件管理、状态页面和其他 OneUptime 功能。

## 目录

- [安装](#安装)
- [提供商配置](#提供商配置)
- [快速开始](#快速开始)
- [版本兼容性](#版本兼容性)
- [可用资源](#可用资源)
- [示例](#示例)
- [最佳实践](#最佳实践)
- [迁移指南](#迁移指南)

## 安装

### 从 Terraform Registry 安装（推荐）

OneUptime Terraform 提供商可在 [Terraform Registry](https://registry.terraform.io/providers/oneuptime/oneuptime) 上获取。

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

### 自托管安装的版本固定

⚠️ **自托管客户的重要提示**：始终将 Terraform 提供商版本固定到与您的 OneUptime 安装版本匹配的版本，以确保 API 兼容性。

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # 固定到与您的 OneUptime 安装完全匹配的版本
    }
  }
  required_version = ">= 1.0"
}
```

#### 查找您的 OneUptime 版本

您可以通过几种方式找到您的 OneUptime 版本：

1. **控制台**：在 OneUptime 控制台中前往 设置 → 关于
2. **API**：调用 `GET /api/status` 端点
3. **Docker**：检查您使用的镜像标签
4. **Helm**：检查您的 Helm Chart 版本

```bash
# 示例：如果运行 OneUptime 7.0.123
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
  oneuptime_url = "https://your-oneuptime-instance.com"  # 或 https://oneuptime.com（云端）
  api_key       = var.oneuptime_api_key
}
```

### 环境变量

您可以使用环境变量配置提供商：

```bash
export ONEUPTIME_URL="https://your-oneuptime-instance.com"
export ONEUPTIME_API_KEY="your-api-key-here"
```

然后不需要显式配置地使用提供商：

```hcl
provider "oneuptime" {
  # 配置将从环境变量中读取
}
```

### 配置选项

| 参数            | 环境变量            | 描述               | 是否必填 |
| --------------- | ------------------- | ------------------ | -------- |
| `oneuptime_url` | `ONEUPTIME_URL`     | OneUptime URL      | 是       |
| `api_key`       | `ONEUPTIME_API_KEY` | OneUptime API 密钥 | 是       |

## 快速开始

### 1. 创建 API 密钥

首先，在您的 OneUptime 控制台中创建 API 密钥：

1. 前往 **设置** → **API 密钥**
2. 点击 **创建 API 密钥**
3. 提供描述性名称（例如"Terraform 自动化"）
4. 选择适当的权限
5. 复制生成的 API 密钥

### 2. 基本 Terraform 配置

创建 `main.tf` 文件：

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
  oneuptime_url = "https://oneuptime.com"  # 使用您的实例 URL
  api_key       = var.oneuptime_api_key
}

# 注意：项目必须在 OneUptime 控制台中手动创建
variable "project_id" {
  description = "OneUptime 项目 ID"
  type        = string
}

# 创建监控器
resource "oneuptime_monitor" "website" {
  name        = "Website Monitor"
  description = "Monitor for website uptime"
  data        = jsonencode({
    url = "https://example.com"
    interval = "5m"
    timeout = "30s"
  })
}

# 创建团队
resource "oneuptime_team" "platform" {
  name        = "Platform Team"
  description = "Platform engineering team"
}
    value = "alerts@example.com"
  }
}
```

### 3. 初始化并应用

```bash
# 初始化 Terraform
terraform init

# 计划变更
terraform plan

# 应用配置
terraform apply
```

## 版本兼容性

### 云端客户

对于 OneUptime 云端客户，使用最新的提供商版本：

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # 始终使用最新兼容版本
    }
  }
}
```

### 自托管客户

**关键**：自托管客户必须将提供商版本固定到与其 OneUptime 安装匹配的版本：

| OneUptime 版本 | 提供商版本 | 配置                   |
| -------------- | ---------- | ---------------------- |
| 7.0.x          | 7.0.x      | `version = "~> 7.0.0"` |
| 7.1.x          | 7.1.x      | `version = "~> 7.1.0"` |
| 7.2.x          | 7.2.x      | `version = "~> 7.2.0"` |

OneUptime 7.0.123 的示例：

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # 精确版本匹配
    }
  }
}
```

## 可用资源

OneUptime Terraform 提供商支持以下资源：

### 核心资源

- `oneuptime_team` - 管理团队

### 监控

- `oneuptime_monitor` - 创建和管理监控器
- `oneuptime_probe` - 管理监控探针

### 值班管理

- `oneuptime_on_call_duty_policy` - 设置值班排班

### 状态页面

- `oneuptime_status_page` - 创建状态页面

### 服务目录

- `oneuptime_service_catalog` - 管理服务目录条目

### 服务目录

- `oneuptime_service` - 定义服务
- `oneuptime_service_dependency` - 映射服务依赖

### 数据源

注意：提供商架构中当前未定义数据源，因此目前数据源不可用。

## 示例

### 完整监控设置

```hcl
# 变量
variable "oneuptime_api_key" {
  description = "OneUptime API 密钥"
  type        = string
  sensitive   = true
}

variable "project_id" {
  description = "OneUptime 项目 ID（在控制台中手动创建项目）"
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

# 团队
resource "oneuptime_team" "platform" {
  name        = "Platform Team"
  description = "Platform engineering team"
}

# 监控器
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

# 告警策略
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

# 状态页面
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

### 自托管配置示例

```hcl
# 适用于自托管 OneUptime 实例版本 7.0.123
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # 必须与您的 OneUptime 版本完全匹配
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.mycompany.com"  # 您的自托管 URL
  api_key       = var.oneuptime_api_key
}

# 其余配置...
```

## 最佳实践

### 1. 版本管理

**对于云端客户：**

- 使用语义版本控制 `~>` 获取兼容更新
- 在主版本升级前查看更新日志

**对于自托管客户：**

- 始终固定到与您的安装完全匹配的版本
- 升级 OneUptime 时更新提供商版本
- 先在非生产环境中测试

### 2. 状态管理

```hcl
terraform {
  backend "s3" {
    bucket = "my-terraform-state"
    key    = "oneuptime/terraform.tfstate"
    region = "us-west-2"
  }
}
```

### 3. 环境分离

使用工作区或独立状态文件区分不同环境：

```bash
# 使用工作区
terraform workspace new production
terraform workspace new staging

# 使用独立目录
mkdir -p environments/{staging,production}
```

### 4. 变量管理

```hcl
# variables.tf
variable "environment" {
  description = "环境名称"
  type        = string
}

variable "monitors" {
  description = "要创建的监控器列表"
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

### 5. 资源命名

使用一致的命名规范：

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

## 迁移指南

### 从手动配置迁移

1. **审计 OneUptime 控制台中的现有资源**
2. **为现有资源创建 Terraform 配置**
3. **将现有资源导入 Terraform 状态**
4. **验证配置与当前状态匹配**
5. **逐步应用变更**

导入示例：

```bash
# 导入现有监控器
terraform import oneuptime_monitor.website monitor-id-here

# 导入现有项目
terraform import oneuptime_project.main project-id-here
```

### 版本升级

升级 OneUptime（自托管）时：

1. **备份您的当前状态**
2. **检查提供商兼容性**
3. **更新配置中的提供商版本**
4. **在预发布环境中测试**
5. **应用到生产环境**

```bash
# 备份状态
terraform state pull > backup.tfstate

# 更新提供商版本
# 编辑配置中的 terraform 块

# 计划并应用
terraform init -upgrade
terraform plan
terraform apply
```

## 支持和资源

- **文档**：[OneUptime 文档](https://docs.oneuptime.com)
- **Terraform Registry**：[OneUptime 提供商](https://registry.terraform.io/providers/oneuptime/oneuptime)
- **GitHub Issues**：[OneUptime GitHub](https://github.com/OneUptime/oneuptime/issues)
- **社区**：[OneUptime 社区](https://community.oneuptime.com)

## 故障排查

### 常见问题

1. **版本不匹配（自托管）**

   ```
   Error: API version incompatible
   ```

   **解决方案**：确保提供商版本与 OneUptime 安装版本匹配

2. **认证问题**

   ```
   Error: Invalid API key
   ```

   **解决方案**：验证 API 密钥和权限

3. **资源未找到**
   ```
   Error: Resource not found
   ```
   **解决方案**：检查资源 ID 并确保资源存在

### 调试模式

启用详细日志：

```bash
export TF_LOG=DEBUG
terraform apply
```

### 版本检查

验证您的设置：

```bash
# 检查 Terraform 版本
terraform version

# 检查提供商版本
terraform providers

# 验证配置
terraform validate
```
