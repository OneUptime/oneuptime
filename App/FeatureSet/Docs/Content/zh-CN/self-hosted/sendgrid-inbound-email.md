# SendGrid 入站邮件集成

OneUptime 的**传入邮件监控器**允许您根据发送到唯一监控器特定邮件地址的邮件来创建和解决告警。这对于与旧系统、告警工具或任何可以发送邮件的服务集成非常有用。

本指南介绍如何设置 SendGrid Inbound Parse 将传入邮件转发到您的自托管 OneUptime 实例。

## 前提条件

- SendGrid 账号（免费套餐可用）
- 您控制的域名，可以访问 DNS 设置
- 您的 OneUptime 实例必须可公开访问（供 SendGrid 发送 Webhook）

## 工作原理

1. 您在 OneUptime 中创建一个**传入邮件监控器**
2. OneUptime 为该监控器生成唯一的邮件地址（例如 `monitor-abc123@inbound.yourdomain.com`）
3. 当邮件发送到该地址时，SendGrid 接收并通过 Webhook 将其转发到 OneUptime
4. OneUptime 根据您配置的标准评估邮件，以创建或解决告警

## 设置说明

### 第一步：选择入站邮件域名

您需要一个专用于接收入站邮件的子域名。我们建议使用以下子域名：

- `inbound.yourdomain.com`
- `email.yourdomain.com`
- `monitor.yourdomain.com`

此子域名将专门用于 OneUptime 监控器邮件。

### 第二步：配置 DNS MX 记录

在 DNS 配置中添加 MX 记录，将入站子域名的邮件路由到 SendGrid。

| 类型 | 主机/名称 | 优先级 | 值 |
|------|---------|--------|-----|
| MX | inbound | 10 | mx.sendgrid.net |

**示例：** 如果您的域名是 `example.com` 且您使用 `inbound.example.com`：

```
inbound.example.com.  IN  MX  10  mx.sendgrid.net.
```

**注意：** DNS 更改最长可能需要 48 小时才能生效，但通常在几个小时内完成。

### 第三步：在 SendGrid 中验证域名（可选但推荐）

为提高传送率并避免邮件被标记为垃圾邮件：

1. 登录您的 [SendGrid 控制台](https://app.sendgrid.com)
2. 前往 **设置** > **发件人认证**
3. 点击 **认证您的域名**
4. 按照提示添加所需的 DNS 记录（用于 DKIM 的 CNAME 记录）

### 第四步：配置 SendGrid Inbound Parse

1. 登录您的 [SendGrid 控制台](https://app.sendgrid.com)
2. 导航至 **设置** > **Inbound Parse**
3. 点击 **添加主机和 URL**
4. 配置以下内容：

| 字段 | 值 |
|------|-----|
| **接收域名** | 您的入站子域名（例如 `inbound.yourdomain.com`） |
| **目标 URL** | `https://your-oneuptime-domain.com/incoming-email/sendgrid/YOUR_SECRET` |
| **检查传入邮件是否为垃圾邮件** | 可选 - 如需要可启用 |
| **发送原始的完整 MIME 消息** | 保持未选中（不需要） |
| **POST 原始的完整 MIME 消息** | 保持未选中（不需要） |

5. 点击 **添加**

### 第五步：配置 OneUptime 环境变量

#### Docker Compose

将这些环境变量添加到您的 `config.env` 文件中：

```bash
# 入站邮件配置
INBOUND_EMAIL_PROVIDER=SendGrid
INBOUND_EMAIL_DOMAIN=inbound.yourdomain.com
# INBOUND_EMAIL_WEBHOOK_SECRET=your-optional-secret  # 可选：用于额外安全
```

#### Kubernetes with Helm

将这些添加到您的 `values.yaml` 文件中：

```yaml
inboundEmail:
  provider: "SendGrid"
  domain: "inbound.yourdomain.com"
  # webhookSecret: "your-optional-secret"  # 可选
```

**重要提示：** 添加这些环境变量后重启您的 OneUptime 服务器。

### 第六步：创建传入邮件监控器

1. 登录您的 OneUptime 控制台
2. 导航至 **监控器** > **创建监控器**
3. 选择 **传入邮件** 作为监控器类型
4. 配置您的监控器：
   - **名称：** 为监控器提供描述性名称
   - **描述：** 描述此监控器的用途
5. 配置 **告警创建标准**（何时创建告警）：
   - 示例：邮件主题包含"ALERT"或"CRITICAL"
6. 配置 **告警解决标准**（何时解决告警）：
   - 示例：邮件主题包含"RESOLVED"或"OK"
7. 点击 **创建**

创建后，您将看到此监控器的唯一邮件地址（例如 `monitor-abc123def456@inbound.yourdomain.com`）。

### 第七步：测试集成

1. 从 OneUptime 控制台复制监控器的邮件地址
2. 向该地址发送一封主题符合您告警标准的测试邮件
3. 检查 OneUptime 控制台以验证：
   - 邮件已收到（在监控器摘要中可见）
   - 创建了告警（如果标准匹配）

## 环境变量参考

| 变量 | 描述 | 是否必填 | 默认值 |
|------|------|---------|--------|
| `INBOUND_EMAIL_PROVIDER` | 要使用的入站邮件提供商 | 是 | - |
| `INBOUND_EMAIL_DOMAIN` | 配置用于入站邮件的子域名 | 是 | - |
| `INBOUND_EMAIL_WEBHOOK_SECRET` | 用于验证 Webhook 请求的密钥。设置后，将此密钥附加到 Webhook URL：`/incoming-email/sendgrid/YOUR_SECRET` | 否 | - |

## 支持的邮件标准

配置传入邮件监控器时，您可以根据以下条件创建标准：

| 字段 | 描述 | 可用过滤器 |
|------|------|----------|
| **邮件主题** | 邮件的主题行 | 包含、不包含、等于、不等于、以...开头、以...结尾、为空、不为空 |
| **邮件发件人** | 发件人的邮件地址 | 包含、不包含、等于、不等于、以...开头、以...结尾、为空、不为空 |
| **邮件正文** | 邮件的纯文本正文 | 包含、不包含、等于、不等于、以...开头、以...结尾、为空、不为空 |
| **邮件收件人** | 收件人邮件地址 | 包含、不包含、等于、不等于、以...开头、以...结尾、为空、不为空 |
| **邮件接收** | 自上次收到邮件以来的时间 | 在 X 分钟内收到、X 分钟内未收到 |

## 示例使用场景

### 旧系统告警

许多旧系统只能发送邮件告警。创建传入邮件监控器以：
- 当旧系统发送 `[CRITICAL]` 邮件时创建 OneUptime 告警
- 收到 `[RESOLVED]` 邮件时解决告警

### 第三方服务集成

与发送邮件通知的服务集成：
- 没有 API 集成的监控工具
- 云提供商通知
- 安全扫描工具

### 通过邮件心跳监控

使用"邮件接收"标准确保您定期收到邮件：
- 如果 60 分钟内未收到邮件则创建告警
- 适用于监控应发送完成邮件的批处理作业或计划任务

## 故障排查

### 未收到邮件

1. **检查 DNS 传播：**
   ```bash
   dig MX inbound.yourdomain.com
   ```
   应该返回 `mx.sendgrid.net`

2. **验证 SendGrid Inbound Parse 设置：**
   - 登录 SendGrid 控制台
   - 前往 设置 > Inbound Parse
   - 验证您的域名和 Webhook URL 是否正确

3. **检查 OneUptime 日志：**
   - 在 ProbeIngest 服务日志中查找 Webhook 请求
   - 检查是否有任何错误消息

### Webhook 失败

1. **确保 OneUptime 可公开访问：**
   - Webhook URL 必须可从互联网访问
   - 测试：`curl -X POST https://your-oneuptime-domain.com/incoming-email/sendgrid`

2. **检查防火墙规则：**
   - 允许来自 SendGrid IP 范围的入站 HTTPS 流量

3. **验证 SSL 证书：**
   - SendGrid 需要有效的 SSL 证书
   - 自签名证书可能会导致问题

### 监控器未创建告警

1. **验证标准配置：**
   - 检查您的告警创建标准是否与邮件内容匹配
   - 在使用模式匹配之前，先用精确字符串进行测试

2. **检查监控器状态：**
   - 确保监控器未被禁用
   - 验证监控器类型是否为"传入邮件"

3. **查看监控器摘要：**
   - 检查邮件是否已收到并处理
   - 查看标准匹配详情的评估日志

### SendGrid Webhook 传送日志

检查 SendGrid 是否成功发送 Webhook：

1. 遗憾的是，SendGrid 不为 Inbound Parse 提供详细日志
2. 检查您的 OneUptime 服务器日志中的入站 Webhook 请求
3. 临时使用 [RequestBin](https://requestbin.com) 等工具测试 Webhook 传送

## 安全最佳实践

1. **使用 HTTPS：** 始终为 Webhook 端点使用 HTTPS
2. **Webhook 密钥：** 配置 `INBOUND_EMAIL_WEBHOOK_SECRET` 并将其包含在 Webhook URL 中（例如 `/incoming-email/sendgrid/your-secret`）以进行额外验证
3. **域名验证：** 在 SendGrid 中验证您的域名以提高邮件安全性
4. **限制访问：** 仅为可信邮件来源创建监控器
5. **监控日志：** 定期查看传入邮件日志以发现可疑活动

## 替代提供商

OneUptime 设计为支持多个入站邮件提供商。目前支持：

| 提供商 | 状态 |
|--------|------|
| SendGrid | 已支持 |
| Haraka（自托管） | 计划中 |

如果您需要支持不同的提供商，请联系我们或提交功能请求。

## 支持

如果您在 SendGrid 入站邮件集成方面遇到问题：

1. 查看上方的故障排查部分
2. 查看 OneUptime 日志以获取详细错误消息
3. 通过 [hello@oneuptime.com](mailto:hello@oneuptime.com) 联系我们

我们欢迎您的反馈以改进此集成！
