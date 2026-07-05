# MCP 服务器

OneUptime 模型上下文协议（MCP）服务器为 LLM 提供对您 OneUptime 实例的直接访问，从而实现 AI 驱动的监控、事件管理和可观测性操作。

## 什么是 OneUptime MCP 服务器？

OneUptime MCP 服务器是大型语言模型（LLM）与您的 OneUptime 实例之间的桥梁。它实现了模型上下文协议（MCP），使 Claude 等 AI 助手能够直接与您的监控基础设施进行交互。

## 工作原理

MCP 服务器与您的 OneUptime 实例一起托管，可通过 Streamable HTTP 传输协议访问。无需本地安装。

**云端用户**：`https://oneuptime.com/mcp`
**自托管用户**：`https://your-oneuptime-domain.com/mcp`

## 主要功能

- **约 155 个工具**：为 22 种资源类型（事件、告警、监控器、状态页面、值班等）提供完整的 CRUD 工具，以及只读遥测工具、工作流工具和辅助工具
- **实时操作**：实时创建、读取、更新和删除资源
- **类型安全接口**：完整类型定义，具有全面的输入验证
- **安全认证**：按请求进行 API 密钥认证，具有适当的错误处理
- **安全注解**：只读工具带有 `readOnlyHint`，删除工具带有 `destructiveHint`，因此 MCP 客户端可以自动批准安全调用，并在执行破坏性操作前进行询问
- **易于集成**：适用于 Claude Desktop 和其他兼容 MCP 的客户端
- **无状态设计**：无会话 ID——每个请求都是自包含的，因此服务器可在负载均衡器和多副本部署环境下正常工作

## 您可以做什么

借助 OneUptime MCP 服务器，AI 助手可以帮助您：

- **监控器管理**：创建和配置监控器，检查其状态，查看状态历史
- **事件响应**：创建、确认和解决事件，添加内部或公开备注，跟踪解决进度
- **团队操作**：管理团队和值班策略
- **状态页面**：管理状态页面并创建公告
- **告警**：确认和解决告警，添加告警备注，管理告警状态和严重程度
- **计划维护**：创建和管理计划维护事件
- **遥测**：查询日志、指标、追踪、异常和监控器日志（只读）

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

API 密钥以项目为作用域：MCP 服务器会从密钥中推断出您的项目，因此创建类工具永远不需要 `projectId` 参数。

> **警告——切勿将主密钥交给 AI 代理。** OneUptime 的*主* API 密钥同样可以在该请求头中使用，并授予实例级的管理员访问权限。请始终使用具有代理所需最小权限的项目 API 密钥（只读密钥即可满足所有 `get_`/`list_`/`count_` 工具的需要）。

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

| 端点          | 方法   | 描述                                                                                                                    |
| ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `/mcp`        | POST   | 用于工具调用和其他操作的 JSON-RPC 请求                                                                            |
| `/mcp`        | GET    | 不带 SSE `Accept` 请求头时：返回友好的 JSON 发现信息。带有该请求头时：返回 `405`——无状态服务器不提供独立的 SSE 流（合规的客户端会在没有该流的情况下继续工作） |
| `/mcp`        | DELETE | 空操作（服务器是无状态的，因此没有可终止的会话）                                                             |
| `/mcp/health` | GET    | 健康检查端点                                                                                                            |
| `/mcp/tools`  | GET    | 列出可用工具的 REST API                                                                                                 |

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

`Bearer` 方案不区分大小写。工具错误以带内工具结果的形式返回（`isError: true`），其中包含 `statusCode`、详细信息和建议——而不是作为 MCP 协议错误返回——因此代理可以读取失败原因并自行纠正。

## 工作流工具

除了按资源划分的 CRUD 工具外，服务器还提供专为事件和告警响应打造的工作流工具：

- **`acknowledge_incident`** / **`resolve_incident`**：将事件移动到项目的"已确认"或"已解决"状态——等同于在仪表板中点击相应按钮
- **`acknowledge_alert`** / **`resolve_alert`**：对告警执行同样的操作
- **`add_incident_note`**：为事件添加备注，可选 `visibility: "internal"`（仅团队可见，为默认值）或 `visibility: "public"`（发布到状态页面）。支持 Markdown
- **`add_alert_note`**：为告警添加内部备注

典型流程：`list_incidents` → `acknowledge_incident` → 使用 `list_logs` 进行调查 → `add_incident_note`（公开）→ `resolve_incident`。

## 我是谁

**`oneuptime_whoami`** 工具返回您的 API 密钥所属的项目（ID 和名称）。它是代理用来确定自身环境的一个非常有用的首次调用——而且由于创建类工具会从 API 密钥中推断 `projectId`，代理永远不需要传递项目 ID。

## 查询遥测数据

日志、指标、追踪（span）、异常和监控器日志以只读的 `list_` 和 `count_` 工具形式提供（`list_logs`、`list_metrics`、`list_spans`、`list_exception_instances`、`list_monitor_logs` 及其对应的 `count_` 工具）。遥测数据通过 OpenTelemetry 摄取，因此没有创建类工具。

查询遥测数据时请始终带上时间范围过滤条件。查询字段可接受直接值或操作符对象：

```json
{
  "query": {
    "time": { "_type": "GreaterThan", "value": "2026-07-04T00:00:00.000Z" }
  },
  "sort": { "time": "DESC" },
  "limit": 50
}
```

支持的操作符：`EqualTo`、`NotEqual`、`IsNull`、`NotNull`、`EqualToOrNull`、`GreaterThan`、`LessThan`、`GreaterThanOrEqual`、`LessThanOrEqual`、`InBetween`、`Search`、`Includes`。排序取值为 `"ASC"` 或 `"DESC"`。

## 字段选择与分页

`get_` 和 `list_` 工具接受一个可选的 `select` 字段名数组。默认返回所有可读字段，但重型字段（JSON、超长文本和 HTML 列）除外，这些字段必须在 `select` 中显式请求。

列表类工具通过 `limit`（默认 10，最大 100）和 `skip` 进行分页，且每个列表响应都会精确报告其返回的内容：

```json
{
  "returnedCount": 10,
  "totalCount": 42,
  "skip": 0,
  "limit": 10,
  "hasMore": true,
  "data": ["..."]
}
```

## 验证

验证 MCP 服务器是否正在运行：

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/health

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/health
```

列出可用工具：

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/tools

# For Self-Hosted
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
"List the teams in this project"
"Show me our on-call policies"
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

- MCP 服务器是无状态的——它不签发也不跟踪会话 ID，因此每个请求都可以由任意服务器副本处理
- 仍在发送旧版本服务器的 `mcp-session-id` 请求头的客户端可以直接省略该请求头；它会被忽略
- 请更新那些期望服务器返回会话 ID 的旧版 MCP 客户端配置

## 可用资源

MCP 服务器为以下资源提供工具：

**监控**：监控器、监控器状态、监控器状态事件
**事件**：事件、事件状态、事件严重程度、事件状态时间线、事件公开备注、事件内部备注
**告警**：告警、告警状态、告警严重程度、告警状态时间线、告警内部备注
**状态页面**：状态页面、状态页面公告
**计划维护**：计划维护事件、计划维护状态、计划维护状态时间线
**团队与值班**：团队、值班策略
**标签**：标签
**遥测（只读）**：日志、指标、Span、异常实例、监控器日志

每种数据库资源都支持通过 snake_case 工具进行创建、获取、列表、更新、删除和计数——例如 `create_incident`、`get_incident`、`list_incidents`、`update_incident`、`delete_incident`、`count_incidents`。遥测资源仅提供 `list_` 和 `count_` 工具（例如 `list_logs`、`count_spans`）。
