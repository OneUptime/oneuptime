# MCP 服务器

OneUptime 模型上下文协议（MCP）服务器为 LLM 提供对您 OneUptime 实例的直接访问，从而实现 AI 驱动的监控、事件管理和可观测性操作。

## 什么是 OneUptime MCP 服务器？

OneUptime MCP 服务器是大型语言模型（LLM）与您的 OneUptime 实例之间的桥梁。它实现了模型上下文协议（MCP），使 Claude 等 AI 助手能够直接与您的监控基础设施进行交互。

## 工作原理

MCP 服务器与您的 OneUptime 实例一起托管，可通过 Streamable HTTP 传输协议访问。无需本地安装。

**云端用户**：`https://oneuptime.com/mcp`
**自托管用户**：`https://your-oneuptime-domain.com/mcp`

## 主要功能

- **完整 API 覆盖**：访问 711 个 OneUptime API 端点
- **126 种资源类型**：管理所有 OneUptime 资源，包括监控器、事件、团队、探针等
- **实时操作**：实时创建、读取、更新和删除资源
- **类型安全接口**：完整类型定义，具有全面的输入验证
- **安全认证**：基于 API 密钥的认证，具有适当的错误处理
- **易于集成**：适用于 Claude Desktop 和其他兼容 MCP 的客户端
- **会话管理**：内置会话处理，支持自动重连

## 您可以做什么

借助 OneUptime MCP 服务器，AI 助手可以帮助您：

- **监控器管理**：创建和配置监控器，检查其状态，管理监控器组
- **事件响应**：创建事件、添加备注、分配团队成员、跟踪解决进度
- **团队操作**：管理团队、权限和值班排班
- **状态页面**：更新状态页面、创建公告、管理订阅者
- **告警**：配置告警规则、管理升级策略、检查通知日志
- **探针**：在不同地点部署和管理监控探针
- **报告和分析**：生成报告并分析监控数据

## 要求

- OneUptime 实例（云端或自托管）
- 兼容 MCP 的客户端（Claude Desktop、VS Code with GitHub Copilot 等）
- 有效的 OneUptime API 密钥（仅认证操作需要 - 公共工具无需认证）

## 获取您的 API 密钥

1. 登录您的 OneUptime 实例
2. 导航至 **设置** → **API 密钥**
3. 点击 **创建 API 密钥**
4. 提供名称（例如"MCP Server"）
5. 选择适合您使用场景的权限
6. 复制生成的 API 密钥

## 配置

### Claude Desktop 配置

找到您的 Claude Desktop 配置文件：

**macOS**：`~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**：`%APPDATA%\Claude\claude_desktop_config.json`
**Linux**：`~/.config/Claude/claude_desktop_config.json`

### 适用于 OneUptime 云端

添加以下配置：

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://oneuptime.com/mcp",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

### 适用于自托管 OneUptime

将 `oneuptime.com` 替换为您的 OneUptime 域名：

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://your-oneuptime-domain.com/mcp",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

### 公共访问（无需 API 密钥）

要仅使用公共工具（状态页面信息、帮助），可以不使用 API 密钥进行连接：

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://oneuptime.com/mcp"
    }
  }
}
```

此配置允许访问公共状态页面工具和帮助资源，无需认证。

### VS Code with GitHub Copilot

VS Code 原生支持 MCP 服务器与 GitHub Copilot（1.99+ 版本）配合使用。这允许 Copilot 直接访问 OneUptime 数据。

#### 第一步：要求

- VS Code 1.99 或更高版本
- 已安装并激活 GitHub Copilot 扩展
- 已启用 GitHub Copilot Chat

#### 第二步：打开 MCP 配置

1. 按 `Ctrl+Shift+P`（Windows/Linux）或 `Cmd+Shift+P`（macOS）
2. 输入"MCP: Open User Configuration"并按 Enter
3. 这将打开或创建 `mcp.json` 配置文件

或者，在您的工作区中创建 `.vscode/mcp.json` 以进行项目特定配置。

#### 适用于 OneUptime 云端

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://oneuptime.com/mcp",
      "headers": {
        "x-api-key": "${input:oneuptime-api-key}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "oneuptime-api-key",
      "description": "OneUptime API Key",
      "password": true
    }
  ]
}
```

#### 适用于自托管 OneUptime

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://your-oneuptime-domain.com/mcp",
      "headers": {
        "x-api-key": "${input:oneuptime-api-key}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "oneuptime-api-key",
      "description": "OneUptime API Key",
      "password": true
    }
  ]
}
```

#### 第三步：启动 MCP 服务器

1. 按 `Ctrl+Shift+P` / `Cmd+Shift+P`
2. 输入"MCP: List Servers"以查看可用服务器
3. 点击"oneuptime"以启动服务器
4. 在提示时输入您的 OneUptime API 密钥

#### 第四步：与 Copilot Chat 配合使用

打开 GitHub Copilot Chat 并使用 Agent 模式（`@workspace` 或直接提问）：

```
"What monitors do I have in OneUptime?"
"Show me recent incidents"
"Create a new monitor for https://example.com"
```

#### 安全说明

上述配置使用带有 `"password": true` 的输入变量，以安全地提示输入您的 API 密钥，而不是以明文形式存储。VS Code 在首次启动 MCP 服务器时会提示您确认信任。

## 可用端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/mcp` | GET | 用于服务器到客户端通知的服务器发送事件流 |
| `/mcp` | POST | 用于工具调用和其他操作的 JSON-RPC 请求 |
| `/mcp` | DELETE | 会话清理和终止 |
| `/mcp/health` | GET | 健康检查端点 |
| `/mcp/tools` | GET | 列出可用工具的 REST API |

## 认证

MCP 服务器支持两种操作模式：

### 公共工具（无需认证）

您可以无需 API 密钥连接到 MCP 服务器来访问公共工具：

- **`oneuptime_help`**：获取有关 OneUptime MCP 功能的帮助和指导
- **`oneuptime_list_resources`**：列出可用资源及其操作
- **`get_public_status_page_overview`**：获取公共状态页面的概览
- **`get_public_status_page_incidents`**：获取公共状态页面的事件
- **`get_public_status_page_scheduled_maintenance`**：获取计划维护事件
- **`get_public_status_page_announcements`**：获取公共状态页面的公告

公共状态页面工具接受状态页面 ID（UUID）或状态页面域名。

### 认证工具（需要 API 密钥）

对于所有其他操作（管理监控器、事件、团队等），需要通过以下请求头之一进行认证：

- `x-api-key`：您的 OneUptime API 密钥
- `Authorization`：携带您的 API 密钥的 Bearer 令牌（例如 `Bearer your-api-key-here`）

## 验证

验证 MCP 服务器是否正在运行：

```bash
# 适用于 OneUptime 云端
curl https://oneuptime.com/mcp/health

# 适用于自托管
curl https://your-oneuptime-domain.com/mcp/health
```

列出可用工具：

```bash
# 适用于 OneUptime 云端
curl https://oneuptime.com/mcp/tools

# 适用于自托管
curl https://your-oneuptime-domain.com/mcp/tools
```

## 使用示例

### 基本信息查询

```
"What's the current status of all my monitors?"
"Show me incidents from the last 24 hours"
```

### 监控器管理

```
"Create a new website monitor for https://example.com that checks every 5 minutes"
"Set up an API monitor for https://api.example.com/health with a 30-second timeout"
"Change the monitoring interval for my website monitor to every 2 minutes"
"Disable the monitor for staging.example.com while we're doing maintenance"
```

### 事件管理

```
"Create a high-priority incident for the database outage affecting user authentication"
"Add a note to incident #123 saying 'Database connection restored, monitoring for stability'"
"Mark incident #456 as resolved"
"Assign the current payment gateway incident to the infrastructure team"
```

### 团队和值班

```
"Who are the members of the infrastructure team?"
"Who's currently on call for the infrastructure team?"
"Show me the on-call schedule for this week"
```

### 状态页面管理

```
"Update our status page to show 'Investigating Payment Issues' for the payment service"
"Create a status page announcement about scheduled maintenance this weekend"
```

### 公共状态页面查询（无需 API 密钥）

这些查询无需认证，仅使用公共状态页面工具：

```
"What's the current status of status.example.com?"
"Show me recent incidents from the OneUptime status page"
"Are there any scheduled maintenance events on status.acme.com?"
"Get the latest announcements from my public status page with ID abc123-..."
```

### 高级操作

```
"Create a scheduled maintenance window for Saturday 2-4 AM, disable all monitors for api.example.com during that time, and update the status page"
"Show me all monitors that have been down in the last hour, create incidents for any that don't already have one"
```

## API 密钥权限

### 只读访问
对于仅查看数据，请为您的 API 密钥添加读取权限。

### 完全访问
对于创建、更新和删除资源的完全访问权限，请确保您的 API 密钥具有项目管理员权限。

### 最佳实践
- 使用特定权限：仅授予所需的最低权限
- 轮换 API 密钥：定期轮换您的 API 密钥
- 监控使用情况：在 OneUptime 中跟踪 API 密钥使用情况
- 分离密钥：对不同环境使用不同的 API 密钥

## 故障排查

### 权限错误
确保您的 API 密钥具有必要的权限：
- 列出资源的读取访问权限
- 创建/更新资源的写入访问权限
- 如果您想删除资源，需要删除访问权限

### 连接问题
1. 验证您的 OneUptime URL 是否正确
2. 检查您的 API 密钥是否有效
3. 确保您的 OneUptime 实例可访问
4. 测试健康端点

### API 密钥无效
- 在您的 OneUptime 设置中验证 API 密钥
- 检查是否有多余的空格或字符
- 确保密钥尚未过期

### 会话错误
如果您收到与会话相关的错误：
- MCP 服务器使用 `mcp-session-id` 请求头来跟踪会话
- 确保您的客户端正确处理服务器返回的会话 ID
- 连接关闭时会话会自动清理

## 可用资源

MCP 服务器提供对 126 种资源类型的访问，包括：

**监控**：Monitor、MonitorStatus、MonitorGroup、Probe
**事件**：Incident、IncidentState、IncidentNote、IncidentTemplate
**告警**：Alert、AlertState、AlertSeverity
**状态页面**：StatusPage、StatusPageAnnouncement、StatusPageSubscriber
**值班**：On-CallPolicy、EscalationRule、On-CallSchedule
**团队**：Team、TeamMember、TeamPermission
**遥测**：TelemetryService、Log、Span、Metric
**工作流**：Workflow、WorkflowVariable、WorkflowLog

每种资源支持标准操作：列表、计数、获取、创建、更新和删除。
