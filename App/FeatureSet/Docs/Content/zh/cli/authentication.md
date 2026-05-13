# 认证

OneUptime CLI 支持多种方式与您的 OneUptime 实例进行认证。您可以使用命名上下文、环境变量，或直接通过标志传递凭据。

## 登录

使用 API 密钥向您的 OneUptime 实例进行认证：

```bash
oneuptime login <api-key> <instance-url>
```

**参数：**

| 参数 | 描述 |
|------|------|
| `<api-key>` | 您的 OneUptime API 密钥（例如 `sk-your-api-key`） |
| `<instance-url>` | 您的 OneUptime 实例 URL（例如 `https://oneuptime.com`） |

**选项：**

| 选项 | 描述 |
|------|------|
| `--context-name <name>` | 此上下文的名称（默认：`"default"`） |

**示例：**

```bash
# 使用默认上下文登录
oneuptime login sk-abc123 https://oneuptime.com

# 使用命名上下文登录
oneuptime login sk-abc123 https://oneuptime.com --context-name production

# 设置多个环境
oneuptime login sk-prod-key https://oneuptime.com --context-name production
oneuptime login sk-staging-key https://staging.oneuptime.com --context-name staging
```

## 上下文

上下文允许您保存和切换多个 OneUptime 环境（例如生产、预发布、开发）。

### 列出上下文

```bash
oneuptime context list
```

显示所有已配置的上下文。当前上下文用 `*` 标记。

### 切换上下文

```bash
oneuptime context use <name>
```

切换到不同的命名上下文，用于所有后续命令。

```bash
# 切换到预发布
oneuptime context use staging

# 切换到生产
oneuptime context use production
```

### 查看当前上下文

```bash
oneuptime context current
```

显示当前活动的上下文，包括实例 URL 和掩码后的 API 密钥。

### 删除上下文

```bash
oneuptime context delete <name>
```

删除命名上下文。如果删除的是当前上下文，CLI 会自动切换到第一个剩余的上下文。

## 凭据解析

凭据按以下优先级顺序解析：

1. **CLI 标志**（`--api-key` 和 `--url`）
2. **环境变量**（`ONEUPTIME_API_KEY` 和 `ONEUPTIME_URL`）
3. **命名上下文**（通过 `--context` 标志）
4. **当前上下文**（来自保存的配置）

您可以混合使用不同来源——例如，使用环境变量提供 API 密钥，使用保存的上下文提供 URL。

### 使用 CLI 标志

```bash
oneuptime --api-key sk-abc123 --url https://oneuptime.com incident list
```

### 使用环境变量

```bash
export ONEUPTIME_API_KEY=sk-abc123
export ONEUPTIME_URL=https://oneuptime.com

oneuptime incident list
```

### 使用特定上下文

```bash
oneuptime --context production incident list
```

## 验证认证

检查您当前的认证状态：

```bash
oneuptime whoami
```

此命令显示：
- 实例 URL
- 掩码后的 API 密钥
- 当前上下文名称（仅在活动的已保存上下文时显示）

如果未认证，该命令会显示一条有帮助的消息，建议您运行 `oneuptime login`。

## 配置文件

凭据存储在 `~/.oneuptime/config.json` 中，具有受限权限（`0600`）。

```json
{
  "currentContext": "production",
  "contexts": {
    "production": {
      "name": "production",
      "apiUrl": "https://oneuptime.com",
      "apiKey": "sk-..."
    },
    "staging": {
      "name": "staging",
      "apiUrl": "https://staging.oneuptime.com",
      "apiKey": "sk-..."
    }
  },
  "defaults": {
    "output": "table",
    "limit": 10
  }
}
```
