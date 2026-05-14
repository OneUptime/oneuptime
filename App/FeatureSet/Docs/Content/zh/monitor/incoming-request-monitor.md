# 传入请求监控器

传入请求监控（也称为心跳监控）允许您通过让服务定期向 OneUptime 发送 HTTP 请求来监控服务。不是由 OneUptime 主动访问您的服务，而是您的服务向 OneUptime 发送 Ping 以确认其正在运行。

## 概述

传入请求监控器提供一个唯一的 Webhook URL，您的服务定期调用它。这使您能够：

- 监控 Cron 作业和计划任务
- 验证后台 Worker 是否正在运行
- 监控防火墙后面无法从外部访问的服务
- 与第三方监控工具集成
- 跟踪来自任何具有 HTTP 能力系统的心跳信号

## 创建传入请求监控器

1. 在 OneUptime 控制台中转到 **监控器**
2. 点击 **创建监控器**
3. 选择 **传入请求** 作为监控器类型
4. 将为此监控器生成一个 **密钥** 和心跳 URL
5. 配置您的服务向心跳 URL 发送请求
6. 根据需要配置监控标准

## 心跳 URL

创建后，您的监控器将有一个格式如下的唯一心跳 URL：

```
https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
```

您的服务应定期向此 URL 发送 HTTP **GET** 或 **POST** 请求。

### 发送心跳

#### 使用 curl

```bash
# 简单 GET 请求
curl https://oneuptime.com/heartbeat/YOUR_SECRET_KEY

# 带自定义正文的 POST 请求
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'
```

#### 从 Cron 作业

```bash
# 添加到 crontab 以每 5 分钟发送一次心跳
*/5 * * * * curl -s https://oneuptime.com/heartbeat/YOUR_SECRET_KEY > /dev/null
```

#### 从应用程序代码

```javascript
// Node.js 示例
const https = require('https');
https.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY');
```

```python
# Python 示例
import requests
requests.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY')
```

如果是自托管，请将 `https://oneuptime.com` 替换为您的 OneUptime 实例 URL。

## 监控标准

您可以配置标准来判断服务何时处于在线、降级或离线状态，基于以下条件：

### 可用检查类型

| 检查类型 | 描述 |
|---------|------|
| 传入请求 | 是否在时间窗口内收到心跳 |
| 请求体 | 与心跳一起发送的请求体内容 |
| 请求头名称 | 特定请求头的名称 |
| 请求头值 | 特定请求头的值 |

### 过滤类型

对于 **传入请求**：

- **在 X 分钟内收到** — 在指定分钟数内收到了心跳
- **X 分钟内未收到** — 在指定分钟数内未收到心跳

对于 **请求体**、**请求头名称** 和 **请求头值**：

- **包含** — 值包含指定文本
- **不包含** — 值不包含指定文本

### 示例标准

#### 如果 10 分钟内无心跳则标记为离线

- **检查项**：传入请求
- **过滤类型**：X 分钟内未收到
- **值**：10

#### 根据请求体内容标记为降级

- **检查项**：请求体
- **过滤类型**：包含
- **值**：`"status": "degraded"`

## 最佳实践

1. **适当设置时间窗口** — 如果您的 Cron 作业每 5 分钟运行一次，将"X 分钟内未收到"阈值设置为 10-15 分钟，以允许偶尔的延迟
2. **包含有意义的数据** — 在请求体中发送状态信息，以便您可以设置细粒度标准
3. **使用 POST 传输丰富数据** — 当您需要发送详细状态信息时，使用带有 JSON 正文的 POST 请求
4. **监控监控器本身** — 确保发送心跳的服务有适当的错误处理，以便失败的心跳请求不会被忽视
