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
- **安全认证**：使用您的 OneUptime 账户登录（OAuth 2.1），或为无人值守的代理按请求发送 API 密钥
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
- 用于登录的 OneUptime 账户，或供无人值守运行的代理使用的 OneUptime API 密钥（仅认证操作需要 - 公共工具两者都不需要）

## 使用 OneUptime 账户登录

最简单的连接方式是只把服务器 URL 提供给您的 MCP 客户端，无需提供其他任何信息。当客户端首次需要您的数据时，它会在您的浏览器中打开一个 OneUptime 页面，您在该页面上：

1. 登录 OneUptime（如果您尚未登录）
2. 选择客户端要在其中工作的项目
3. 选择客户端可以 **读取和写入** 还是 **只读**
4. 点击 **授权**

此后，客户端将在该项目中以您的身份执行操作。无需创建、复制或轮换任何 API 密钥，配置文件中也不会存储任何机密信息。

已连接的客户端可以做什么：

- **它拥有您的权限，绝不会更多。** 您所在的团队允许您在该项目中执行的操作，就是客户端可以执行的操作。如果您的角色发生变化或您离开了项目，该变化会在客户端的下一次请求时立即生效。离开项目也会断开客户端：其授权会被删除，如果您重新加入项目，需要重新连接它。
- **只读就是只读。** 被授权为只读的客户端可以使用 `get_`、`list_` 和 `count_` 工具。执行创建、更新、删除、确认或解决操作的工具会被拒绝——MCP 服务器及其背后的 OneUptime API 都会拒绝。您永远无法授予客户端超出其请求范围的访问权限。
- **它只适用于一个项目。** 要使用另一个项目，请重新连接客户端并选择该项目。
- **它只能通过 MCP 服务器工作。** 客户端的访问令牌仅被 MCP 端点接受，在其他任何地方都不被接受。它不能用于直接调用 OneUptime REST API。
- **实例管理员没有特殊待遇。** 由主管理员连接的客户端拥有的是该用户所在团队在项目中授予的权限，而不是实例级访问权限。

### 管理已连接的客户端

所有通过登录方式连接的客户端都会列在 **项目设置** → **MCP 服务器** → **Connected MCP Clients**（已连接的 MCP 客户端）下，并显示连接者、允许它执行的操作以及上次使用时间。您可以看到自己连接的客户端；项目所有者和管理员可以看到所有人连接的客户端。

点击 **Disconnect**（断开连接）可让客户端退出登录。它会立即停止工作。

只要客户端仍在使用，它就会保持连接。30 天未使用的客户端必须重新登录。

### 控制谁可以连接客户端

默认情况下，每位项目成员都可以连接 MCP 客户端。要阻止某个团队的成员这样做，请打开该团队，进入 **阻止权限**，并添加 **Authorize MCP Client**（授权 MCP 客户端）权限。这些成员已连接的客户端会立即停止工作。

如果项目要求使用单点登录（SSO），请在授权客户端之前，先在浏览器中通过 SSO 登录该项目。客户端的连接在该 SSO 登录有效期间持续有效；该登录失效后，请重新连接客户端。

在 OneUptime 云端，连接 MCP 客户端的功能与 API 密钥在相同的套餐中提供（Growth 及以上）。

在 Enterprise Edition 中，已连接的客户端所做的每一项更改都会记录在审计日志中，记在连接该客户端的用户名下，并附上客户端的名称。使用 API 密钥所做的更改则显示密钥的名称。

## 获取您的 API 密钥

对于无人值守运行的代理（例如计划任务或 CI 流水线），由于没有人在场进行登录，请使用 API 密钥。

1. 登录您的 OneUptime 实例
2. 导航至 **项目设置** → **API 密钥**
3. 点击 **创建 API 密钥**
4. 提供名称（例如"MCP Server"）
5. 选择适合您使用场景的权限
6. 复制生成的 API 密钥

API 密钥以项目为作用域：MCP 服务器会从密钥中推断出您的项目，因此创建类工具永远不需要 `projectId` 参数。

> **警告——切勿将主密钥交给 AI 代理。** OneUptime 的*主* API 密钥同样可以在该请求头中使用，并授予实例级的管理员访问权限。请始终使用具有代理所需最小权限的项目 API 密钥（只读密钥即可满足所有 `get_`/`list_`/`count_` 工具的需要）。

## 配置

### 通过登录进行连接

将服务器 URL 添加到您的客户端，无需任何凭据。对于自托管实例，请使用 `https://your-oneuptime-domain.com/mcp`。

**Claude Code**

```bash
claude mcp add --transport http oneuptime https://oneuptime.com/mcp
```

然后在 Claude Code 中运行 `/mcp` 并选择 **oneuptime** 进行登录。

**Claude（网页版和桌面版）**

打开 **Customize** → **Connectors**，选择 **Add custom connector**，然后输入 `https://oneuptime.com/mcp`。Claude 首次需要您的数据时，会要求您登录 OneUptime。

**VS Code with GitHub Copilot**

将以下内容添加到您的 MCP 配置中（该文件的位置请参阅 [VS Code with GitHub Copilot](#vs-code-with-github-copilot)）。启动服务器时，VS Code 会打开 OneUptime 供您登录：

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://oneuptime.com/mcp"
    }
  }
}
```

**Cursor**

```json
{
  "mcpServers": {
    "oneuptime": {
      "url": "https://oneuptime.com/mcp"
    }
  }
}
```

任何其他支持 MCP 授权的客户端都以相同方式工作：只需向它提供 URL，其余一切都由它自行发现。有关协议细节，请参阅[登录（OAuth 2.1）](#登录oauth-21)。

本节的其余部分展示了改用 API 密钥配置这些客户端的方法。

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

通过登录连接的 MCP 客户端还会使用下列 OAuth 端点。客户端会自行找到这些端点；在此列出，是为了方便编写客户端或配置代理服务器的人员。

| 端点                                          | 方法   | 描述 |
| --------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| `/mcp/.well-known/oauth-protected-resource`   | GET    | 受保护资源元数据（RFC 9728）。也可通过 `/.well-known/oauth-protected-resource/mcp` 访问 |
| `/.well-known/oauth-authorization-server/mcp` | GET    | 授权服务器元数据（RFC 8414）。也可通过 `/mcp/.well-known/oauth-authorization-server` 访问 |
| `/mcp/oauth/authorize`                        | GET    | 授权端点：客户端将您的浏览器引导至此处进行登录 |
| `/mcp/oauth/token`                            | POST   | 令牌端点：兑换授权码或刷新令牌 |
| `/mcp/oauth/register`                         | POST   | 动态客户端注册（RFC 7591） |
| `/mcp/oauth/revoke`                           | POST   | 令牌撤销（RFC 7009） |

## 认证

MCP 服务器支持三种操作模式：

### 公共工具（无需认证）

您可以无需 API 密钥连接到 MCP 服务器来访问公共工具：

- **`oneuptime_help`**：获取有关 OneUptime MCP 功能的帮助和指导
- **`oneuptime_list_resources`**：列出可用资源及其操作
- **`get_public_status_page_overview`**：获取公共状态页面的概览
- **`get_public_status_page_incidents`**：获取公共状态页面的事件
- **`get_public_status_page_scheduled_maintenance`**：获取计划维护事件
- **`get_public_status_page_announcements`**：获取公共状态页面的公告

公共状态页面工具接受状态页面 ID（UUID）或状态页面域名。

### 登录（OAuth 2.1）

对于所有其他操作（管理监控器、事件、团队等），必须识别调用方的身份。未发送任何凭据就调用这些工具的客户端会收到 `401 Unauthorized` 响应，以及一个指向服务器受保护资源元数据的 `WWW-Authenticate` 响应头。MCP 客户端正是根据这一信号来引导您登录的；`initialize`、`tools/list` 和公共工具永远不会要求登录。

服务器实现了 [MCP 授权规范](https://modelcontextprotocol.io/specification/latest/basic/authorization)：

- **流程**：使用 PKCE（仅支持 `S256`）的 OAuth 2.1 授权码流程。访问令牌以 `Authorization: Bearer` 的形式发送。
- **发现**：受保护资源元数据（RFC 9728）和授权服务器元数据（RFC 8414）。颁发者（issuer）和资源均为 `https://<host>/mcp`。
- **客户端身份**：Client ID Metadata Document（客户端 ID 是一个由服务器获取的 `https` URL），或动态客户端注册（Dynamic Client Registration，RFC 7591）。任何客户端都无需由管理员注册。
- **作用域**：`mcp:read` 适用于 `get_`、`list_` 和 `count_` 工具；`mcp:write` 增加了所有会进行更改的工具，并包含 `mcp:read`。只读令牌调用写入工具时，会收到 `403` 和 `error="insufficient_scope"` 响应。
- **令牌有效期**：访问令牌的有效期为一小时。刷新令牌的有效期为 30 天，且每次使用时都会被替换；使用已被替换的刷新令牌会终止连接。
- **资源指示符**（RFC 8707）：令牌是为 `https://<host>/mcp` 颁发的，在其他任何地方都不被接受。
- **撤销**（RFC 7009）：撤销任一令牌都会终止连接。

### API 密钥

无人值守运行的代理通过以下请求头之一携带 OneUptime API 密钥进行认证：

- `x-api-key`：您的 OneUptime API 密钥
- `Authorization`：携带您的 API 密钥的 Bearer 令牌（例如 `Bearer your-api-key-here`）

`Bearer` 方案不区分大小写。携带 API 密钥的请求永远不会被要求登录。

工具错误以带内工具结果的形式返回（`isError: true`），其中包含 `statusCode`、详细信息和建议——而不是作为 MCP 协议错误返回——因此代理可以读取失败原因并自行纠正。

## 工作流工具

除了按资源划分的 CRUD 工具外，服务器还提供专为事件和告警响应打造的工作流工具：

- **`acknowledge_incident`** / **`resolve_incident`**：将事件移动到项目的"已确认"或"已解决"状态——等同于在仪表板中点击相应按钮
- **`acknowledge_alert`** / **`resolve_alert`**：对告警执行同样的操作
- **`add_incident_note`**：为事件添加备注，可选 `visibility: "internal"`（仅团队可见，为默认值）或 `visibility: "public"`（发布到状态页面）。支持 Markdown
- **`add_alert_note`**：为告警添加内部备注

典型流程：`list_incidents` → `acknowledge_incident` → 使用 `list_logs` 进行调查 → `add_incident_note`（公开）→ `resolve_incident`。

## 我是谁

**`oneuptime_whoami`** 工具返回您的凭据所属的项目（ID 和名称）。对于通过登录连接的客户端，它还会返回该客户端是以谁的身份登录的，以及它是否可以进行更改。它是代理用来确定自身环境的一个非常有用的首次调用——而且由于创建类工具会从凭据中推断 `projectId`，代理永远不需要传递项目 ID。

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

## 自托管配置

在自托管实例上，登录功能开箱即用。有两项设置可用：

| 环境变量 | Helm 值 | 作用 |
| --- | --- | --- |
| `DISABLE_MCP_OAUTH` | `mcpOAuth.disabled` | 设置为 `true` 可关闭登录功能。OAuth 端点将停止提供服务，MCP 服务器仅接受 API 密钥。不会删除任何内容；重新开启后，已连接的客户端可恢复工作。 |
| `DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS` | `mcpOAuth.disableClientIdMetadataDocuments` | 在无法访问互联网的实例上设置为 `true`。客户端可以用一个由 OneUptime 获取的 URL 来标识自己；设置此项后，客户端会改为直接向您的实例注册，这不需要任何出站请求。 |

如果您在 OneUptime 前面运行自己的反向代理，请将 `/.well-known/oauth-protected-resource` 和 `/.well-known/oauth-authorization-server`（及其下的所有路径）连同 `/mcp` 一起转发到 OneUptime。自带的 ingress 已经这样做了。

服务器根据 `HOST` 和 `HTTP_PROTOCOL` 设置构建每个 OAuth URL，因此它们必须与人们访问您实例所用的地址一致。

## 故障排查

### 登录问题

- **客户端从不要求我登录**：客户端可能不支持 MCP 授权，或者配置了 API 密钥请求头，而该请求头优先生效。移除该请求头即可改用登录。
- **我的项目在授权页面上显示为灰色**：页面会在项目名称旁边说明原因——项目的套餐不包含连接 MCP 客户端的功能、项目要求使用 SSO 而此浏览器尚未通过 SSO 登录该项目，或者您的团队被阻止连接客户端。
- **工具被拒绝并提示"read-only"**：该客户端被授权为只读。请重新连接并选择 **读取和写入**。
- **客户端停止工作**：它已被断开连接、已有 30 天未使用、您已被移出项目，或者项目的 SSO 登录已失效。请重新连接。
- **自托管——客户端报告找不到授权服务器**：检查 `HOST` 和 `HTTP_PROTOCOL` 是否与您的公开地址一致，以及您的代理服务器是否转发了 `/.well-known/oauth-*` 路径。

### 权限错误

确保您的 API 密钥（对于通过登录连接的客户端，则是您自己的账户）具有必要的权限：

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
