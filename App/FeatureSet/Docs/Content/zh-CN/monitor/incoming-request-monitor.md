# 传入请求监控器

传入请求监控器为你提供一个 URL，其他系统可以向它发送 HTTP 请求。OneUptime 会按你的条件评估每一个请求，并可以更改监控器状态、创建事件、呼叫值班轮值人员。

它承担两种不同的职责：

- **心跳监控** —— cron 作业、工作进程或设备按计划调用该 URL，当心跳不再到达时 OneUptime 创建一个事件。
- **接收来自其他系统的告警** —— Prometheus Alertmanager、Grafana，或任何能够 POST JSON 的系统把告警推送进来，OneUptime 把每一条告警变成一个事件，带值班升级，并在恢复时自动解决。

两者使用同一种监控器类型。区别在于你配置的条件。

## 概览

传入请求监控器提供一个唯一的 URL，供你的服务调用。它让你可以：

- 监控 cron 作业和计划任务
- 确认后台工作进程正在运行
- 监控防火墙后无法从外部访问的服务
- 接收来自 Prometheus Alertmanager、Grafana 及其他告警系统的告警
- 跟踪任何支持 HTTP 的系统发来的心跳信号

## 创建传入请求监控器

1. 在 OneUptime 仪表板中进入 **监控器**
2. 点击 **创建监控器**
3. 选择 **传入请求** 作为监控器类型
4. 系统会为该监控器生成一个 **密钥** 和一个 URL
5. 打开该监控器，点击左侧菜单中的 **Documentation** 复制 URL
6. 配置你的服务向该 URL 发送请求
7. 按下文所述配置监控条件

## 请求 URL

你的监控器有一个如下格式的唯一 URL：

```
https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
```

如果是自托管，请把 `https://oneuptime.com` 替换成你自己的 OneUptime 实例 URL。

向该 URL 发送 **GET** 或 **POST** 请求。HEAD 会被接受并按 GET 处理。其他方法返回 404。路径中的密钥是唯一的凭据——不需要任何请求头或令牌。

> **Warning:** 任何知道这个 URL 的人都可以把监控器标记为健康，因此请把它当作机密。你发送的每个请求头都会保存在监控器上，任何能读取它的人都能看到——不要把 API 密钥或令牌放在请求头里发送到该端点。

OneUptime 会立即返回一个空的 `200`，然后在队列中处理该请求。这个响应在任何校验之前就写出了，因此 `200` **并不**代表请求被接受——密钥错误、监控器已删除、监控器已禁用，同样都会返回 `200`。请查看监控器自身的时间线来确认请求确实送达。

### 发送请求体

如果你想引用请求体内部的字段——事件标题中的 `{{requestBody.status}}`、事件分组中的 JSON 路径，或者 JavaScript Expression 条件——请发送 `Content-Type: application/json`，本文档通篇都假定这种格式。`application/x-www-form-urlencoded` 的请求体也会被解析，但只会得到扁平的顶层字段。其他任何 content type（或者根本没有）都不会被解析，所有 `requestBody` 引用都解析不到任何内容。

请求体最大接受 50 MB。不要用 `Content-Encoding: gzip` 压缩请求体；它会以未解析的形式保存，指向其中的路径无法解析。

### 发送心跳

#### 使用 curl

```bash
# Simple GET request
curl https://oneuptime.com/heartbeat/YOUR_SECRET_KEY

# POST request with custom body
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'
```

#### 从 cron 作业

```bash
# Add to crontab to send heartbeat every 5 minutes
*/5 * * * * curl -s https://oneuptime.com/heartbeat/YOUR_SECRET_KEY > /dev/null
```

#### 从应用代码

```javascript
// Node.js example
const https = require("https");
https.get("https://oneuptime.com/heartbeat/YOUR_SECRET_KEY");
```

```python
# Python example
import requests
requests.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY')
```

## 监控条件

你可以配置条件来判断服务何时算作在线、降级或离线。每个条件过滤器都有 **Filter Type**（看什么）、**Filter Condition**（怎么比较）和 **Value**。

### 可用的 Filter Type

| Filter Type           | 检查内容                                        | 说明                                                                        |
| --------------------- | ----------------------------------------------- | --------------------------------------------------------------------------- |
| Incoming Request      | 是否在某个时间窗口内收到过请求                  | 唯一一个在什么都没收到时也能触发的检查                                      |
| Request Body          | 请求体                                          | 子串匹配。对象形式的请求体按紧凑 JSON 比较                                  |
| Request Header        | 请求头的名称                                    | 与小写化后的请求头名称精确匹配                                              |
| Request Header Value  | 请求头的值                                      | 与小写化后的请求头值精确匹配                                                |
| JavaScript Expression | 针对 `requestBody` 和 `requestHeaders` 的表达式 | 最灵活的选项——参见 [JavaScript 表达式](/docs/monitor/javascript-expression) |

### Filter Condition

每种 Filter Type 提供各自的一组条件。

对于 **Incoming Request**（此处按仪表板中的拼写照录）：

- **Recieved In Minutes** —— 在指定分钟数内收到过请求
- **Not Recieved In Minutes** —— 在指定分钟数内没有收到请求

对于 **Request Body**、**Request Header** 和 **Request Header Value**：**Contains** 和 **Not Contains**。

对于 **JavaScript Expression**：**Evaluates To True**。

> **Note:** 请求头名称和请求头值在比较前都会转为小写，并且比较的是整个名称或值，而不是子串。请写 `content-type` 而不是 `Content-Type`，写 `application/json` 而不是 `application/JSON`。只有 **Request Body** 做的是真正的子串匹配。

对象形式的请求体按不含空格的紧凑 JSON 比较，因此 **Request Body** / **Contains** 过滤器必须写成 `"status":"firing"`——从格式化后的负载里复制 `"status": "firing"` 永远不会匹配。

### 示例条件

#### 10 分钟内没有心跳则标记为离线

- **Filter Type**：Incoming Request
- **Filter Condition**：Not Recieved In Minutes
- **Value**：10

#### 根据请求体内容标记为降级

- **Filter Type**：Request Body
- **Filter Condition**：Contains
- **Value**：`"status":"degraded"`

> **Warning:** 只有当监控器至少有一个条件检查 **Incoming Request** 时，它才会在后台被重新评估。条件只检查 Request Body、Request Header 或 JavaScript Expression 的监控器，仅在请求到达时才被评估，其他时候都不会——因此它永远不会自行变为离线。如果你想要心跳缺失告警，就必须有一个 **Incoming Request** 条件。

另请注意，从未收到过请求的监控器会被当作它的创建时间就是最后一次请求。刚创建的监控器上的 "Not Recieved In Minutes: 10" 条件会在创建 10 分钟后触发，即使发送方从未接上。

## 接收来自其他系统的告警

Alertmanager、Grafana 等工具会 POST 一份描述一条或多条告警的 JSON 文档。默认情况下一个条件只开 **一个** 事件，所以带有五条告警的负载也只会产生一个事件。事件分组改变了这一点：它从负载中提取一个值，并 **按不同的值分别创建事件**，这些事件可以同时处于打开状态。

### 启用事件分组

打开该条件，展开 **Settings**，启用 **Group incidents and alerts by a payload field**。会出现四个字段：

| 字段                               | 示例                                     | 作用                                     |
| ---------------------------------- | ---------------------------------------- | ---------------------------------------- |
| Open a separate incident for each… | `requestBody.alerts[*].labels.alertname` | 用其不同取值来拆分事件的路径             |
| Field that signals recovery        | `requestBody.alerts[*].status`           | 用于判断某条告警已恢复的路径             |
| Value that means recovered         | `resolved`                               | 表示恢复的精确取值                       |
| Max incidents per request          | `100`（默认）                            | 安全上限，避免高基数字段无限制地创建事件 |

### 路径语法

路径必须以字面前缀 `requestBody.` 开头。缺少它的路径——`alerts[*].labels.alertname`——什么也匹配不到，而且是静默失败。`{{ }}` 包裹是可选的：`requestBody.status` 和 `{{requestBody.status}}` 行为完全一致。

- `[*]` 会在数组上展开——每个 **不同的** 值对应一个事件。产生相同值的两个元素会合并为一个事件，该事件的 firing/resolved 状态取自 **第一个** 匹配的元素。**路径中只有第一个 `[*]` 是通配符**；`requestBody.groups[*].alerts[*].name` 什么也匹配不到。
- `[0]` 和 `[last]` 选择单个元素，并且可以跟在 `[*]` 之后。
- 对象和数组值、空字符串以及 null 会被跳过。`0` 和 `false` 是有效的键。

### 解决是事件驱动的

webhook 只描述该次负载中的内容，因此 OneUptime 绝不会因为某个键不再出现就解决一个事件。只有当某次负载明确说明该键已恢复时，事件才会被解决。以下两点必须同时成立：

1. **Field that signals recovery** 和 **Value that means recovered** 已设置，并且与负载相符。比较是精确且区分大小写的——`Resolved` 不匹配 `resolved`。
2. 该条件的事件在事件表单的 **Advanced Options** 下启用了 **Auto Resolve Incident**。否则匹配到的恢复事件会被忽略，事件会一直开着。（告警和 **Auto Resolve Alert** 同理。）

**Max incidents per request** 限制的是提取，而不仅是创建。超出上限的键对恢复同样不可见，因此在包含的不同键数量超过上限的负载中，超出部分中报告 `resolved` 的告警不会关闭它的事件。

> **Warning:** 如果 **Field that signals recovery** 含有 `[*]` 而 **Open a separate incident for each…** 没有，就永远不会有任何东西被解决。要么两者都用 `[*]`，要么都不用。不含 `[*]` 的恢复路径是针对整个负载求值的，因此负载层面的 `status: resolved` 会解决该负载中的每一个键——包括那些自身状态仍为 firing 的告警。

### 为事件命名

分组键会以 **路径最后一段** 命名的变量形式提供给事件与告警模板：

| 路径                                     | 变量              |
| ---------------------------------------- | ----------------- |
| `requestBody.alerts[*].labels.alertname` | `{{alertname}}`   |
| `requestBody.alerts[*].fingerprint`      | `{{fingerprint}}` |
| `requestBody.commonLabels.severity`      | `{{severity}}`    |

完整负载依然可以一并使用，因此事件标题用 `{{alertname}}`、描述中引用 `{{requestBody.commonAnnotations.summary}}` 都能正常工作。参见 [事件与告警动态模板](/docs/monitor/incident-alert-templating)。

> **Warning:** 变量名是 OneUptime 用来把恢复事件与已打开事件对应起来的标识的一部分。把分组路径改成最后一段不同的路径，会让当前在旧路径下打开的所有事件成为孤儿——它们无法再自动解决，只能手动关闭。

另请注意，`[*]` **只在**两个分组路径字段中有效。在其他地方它不会被解析，而未解析的占位符会 **原样** 输出而不是被清空——标题写成 `{{requestBody.alerts[*].labels.alertname}}` 时会连同花括号一起显示。标题 `{{requestBody.alerts[0].annotations.summary}}` 可以解析，但始终读取负载中的第一条告警，而不是该事件所对应的那一条。建议改用分组变量，配合负载中共享的 `commonAnnotations` 字段。

### 完整示例

完整的 Alertmanager 配置见 [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager)。Grafana 见 [Grafana](/docs/integrations/grafana)。

## 最佳实践

1. **合理设置时间窗口** —— 如果你的 cron 作业每 5 分钟运行一次，把 "Not Recieved In Minutes" 阈值设为 10–15 分钟，以容忍偶尔的延迟
2. **包含有意义的数据** —— 在请求体中发送状态信息，以便设置更细粒度的条件
3. **使用 POST 并带上 `Content-Type: application/json`** —— 所有读取请求体内部内容的功能都依赖它
4. **不要在同一个监控器上混用两种职责** —— 接收事件驱动告警的监控器没有固定节奏，在它上面设置 "Not Recieved In Minutes" 条件会来回抖动。请为死人开关使用单独的监控器
5. **监控这个监控器** —— 确保发送请求的服务有妥善的错误处理，避免失败的请求被忽视

## 接下来读什么

- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) —— 一套完整的入站告警配置
- [Grafana](/docs/integrations/grafana) —— 同样的做法，用于 Grafana 告警
- [事件与告警动态模板](/docs/monitor/incident-alert-templating) —— 标题和描述中可用的全部变量
- [JavaScript 表达式](/docs/monitor/javascript-expression) —— 表达式语法与引号规则
