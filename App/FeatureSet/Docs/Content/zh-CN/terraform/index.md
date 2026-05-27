# Terraform 提供商文档

OneUptime Terraform 提供商支持以基础设施即代码（IaC）的方式管理您的 OneUptime 监控、告警和可观测性资源。

## 文档目录

### [快速开始](./quick-start.md)
快速设置指南，帮助您在几分钟内开始使用 OneUptime Terraform 提供商。

### [完整提供商指南](./README.md)
涵盖安装、配置、资源和最佳实践的综合文档。

### [自托管配置](./self-hosted.md)
**自托管客户的关键信息**：版本固定、兼容性和部署策略。

### [示例](./examples.md)
常见 OneUptime Terraform 配置的实际示例和模式。

## 快速链接

### 适用于 OneUptime 云端客户
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
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### 适用于自托管客户
```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # 必须与您的 OneUptime 版本匹配
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"
  api_key       = var.oneuptime_api_key
}
```

## 自托管用户的重要提示

**版本兼容性至关重要**：始终将 Terraform 提供商版本固定到与您的 OneUptime 安装版本完全匹配的版本。版本不匹配可能导致 API 兼容性问题。

## 外部资源

- **Terraform Registry**：[OneUptime 提供商](https://registry.terraform.io/providers/oneuptime/oneuptime)
- **GitHub 仓库**：[OneUptime 源代码](https://github.com/OneUptime/oneuptime)
- **社区支持**：[OneUptime 社区](https://community.oneuptime.com)

## 可用资源

提供商支持全面的 OneUptime 资源管理：

- **项目和团队**：组织您的监控结构
- **监控器**：网站、API、端口、心跳和自定义监控器
- **事件管理**：告警策略、值班排班、升级链
- **状态页面**：具有自定义品牌的公共和私有状态页面
- **服务目录**：服务定义和依赖关系映射
- **工作流**：自动化响应和修复工作流

## 支持

如有问题、疑问或贡献：

1. **文档问题**：在 [OneUptime 仓库](https://github.com/OneUptime/oneuptime/issues) 中创建 Issue
2. **提供商错误**：在主 OneUptime 仓库中报告
3. **功能请求**：在 OneUptime 社区中讨论
4. **一般问题**：使用社区论坛

## 下一步

1. **新用户**：从[快速开始指南](./quick-start.md)开始
2. **自托管用户**：查看[自托管配置](./self-hosted.md)
3. **高级用户**：探索[示例](./examples.md)了解复杂设置
4. **完整参考**：查看[完整指南](./README.md)了解所有功能
