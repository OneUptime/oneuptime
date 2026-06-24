# 资源操作

OneUptime CLI 为所有支持的资源提供完整的 CRUD（创建、读取、更新、删除）操作。资源从您的 OneUptime 实例自动发现。

## 可用资源

运行以下命令查看所有可用的资源类型：

```bash
oneuptime resources
```

您可以按类型过滤：

```bash
# 仅显示数据库资源
oneuptime resources --type database

# 仅显示分析资源
oneuptime resources --type analytics
```

常用资源包括：

| 资源         | 命令                                    |
| ------------ | --------------------------------------- |
| 事件         | `oneuptime incident`                    |
| 告警         | `oneuptime alert`                       |
| 监控器       | `oneuptime monitor`                     |
| 监控器状态   | `oneuptime monitor-status`              |
| 事件状态     | `oneuptime incident-state`              |
| 状态页面     | `oneuptime status-page`                 |
| 值班策略     | `oneuptime on-call-policy`              |
| 团队         | `oneuptime team`                        |
| 计划维护事件 | `oneuptime scheduled-maintenance-event` |

## 列出资源

获取资源列表，支持可选的过滤、分页和排序。

```bash
oneuptime <resource> list [options]
```

**选项：**

| 选项                    | 描述                | 默认值  |
| ----------------------- | ------------------- | ------- |
| `--query <json>`        | JSON 格式的过滤条件 | 无      |
| `--limit <n>`           | 最大结果数          | `10`    |
| `--skip <n>`            | 跳过的结果数        | `0`     |
| `--sort <json>`         | JSON 格式的排序顺序 | 无      |
| `-o, --output <format>` | 输出格式            | `table` |

**示例：**

```bash
# 列出最近 10 个事件
oneuptime incident list

# 按状态 ID 过滤事件
oneuptime incident list --query '{"currentIncidentStateId":"<state-id>"}'

# 带分页的列表
oneuptime incident list --limit 20 --skip 40

# 按创建日期降序排序
oneuptime incident list --sort '{"createdAt":-1}'

# 以 JSON 格式输出
oneuptime incident list -o json
```

## 获取资源

通过 ID 获取单个资源。

```bash
oneuptime <resource> get <id>
```

**参数：**

| 参数   | 描述            |
| ------ | --------------- |
| `<id>` | 资源 ID（UUID） |

**示例：**

```bash
# 获取特定事件
oneuptime incident get 550e8400-e29b-41d4-a716-446655440000

# 以 JSON 格式获取监控器
oneuptime monitor get abc-123 -o json
```

## 创建资源

从内联 JSON 或文件创建新资源。

```bash
oneuptime <resource> create [options]
```

**选项：**

| 选项                    | 描述                         |
| ----------------------- | ---------------------------- |
| `--data <json>`         | JSON 对象格式的资源数据      |
| `--file <path>`         | 包含资源数据的 JSON 文件路径 |
| `-o, --output <format>` | 输出格式                     |

必须提供 `--data` 或 `--file` 之一。

**示例：**

```bash
# 使用内联 JSON 创建事件
oneuptime incident create --data '{"title":"API Outage","currentIncidentStateId":"<state-id>","incidentSeverityId":"<severity-id>","declaredAt":"2025-01-15T10:30:00Z"}'

# 从 JSON 文件创建
oneuptime incident create --file incident.json

# 创建并以 JSON 格式输出以捕获 ID
oneuptime monitor create --data '{"name":"API Health Check"}' -o json
```

## 更新资源

通过 ID 更新现有资源。

```bash
oneuptime <resource> update <id> [options]
```

**参数：**

| 参数   | 描述    |
| ------ | ------- |
| `<id>` | 资源 ID |

**选项：**

| 选项                    | 描述                          |
| ----------------------- | ----------------------------- |
| `--data <json>`         | JSON 格式的待更新字段（必填） |
| `-o, --output <format>` | 输出格式                      |

**示例：**

```bash
# 更改事件状态（例如更改为已解决）
oneuptime incident update abc-123 --data '{"currentIncidentStateId":"<resolved-state-id>"}'

# 重命名监控器
oneuptime monitor update abc-123 --data '{"name":"Updated Monitor Name"}'
```

## 删除资源

通过 ID 删除资源。

```bash
oneuptime <resource> delete <id> [--force]
```

**参数：**

| 参数   | 描述    |
| ------ | ------- |
| `<id>` | 资源 ID |

**选项：**

| 选项      | 描述         |
| --------- | ------------ |
| `--force` | 跳过确认提示 |

**示例：**

```bash
oneuptime incident delete abc-123
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000

# 跳过确认
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000 --force
```

## 统计资源数量

统计符合可选过滤条件的资源数量。

```bash
oneuptime <resource> count [options]
```

**选项：**

| 选项             | 描述                |
| ---------------- | ------------------- |
| `--query <json>` | JSON 格式的过滤条件 |

**示例：**

```bash
# 统计所有事件
oneuptime incident count

# 按状态统计事件
oneuptime incident count --query '{"currentIncidentStateId":"<state-id>"}'

# 统计监控器数量
oneuptime monitor count
```

## 分析资源

分析资源与数据库资源相比，支持的操作较为有限：

| 操作     | 是否支持 |
| -------- | -------- |
| `list`   | 是       |
| `create` | 是       |
| `count`  | 是       |
| `get`    | 否       |
| `update` | 否       |
| `delete` | 否       |

使用 `oneuptime resources --type analytics` 查看您的实例上可用的分析资源。
