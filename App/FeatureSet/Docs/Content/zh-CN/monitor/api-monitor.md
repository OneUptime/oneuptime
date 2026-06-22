# API 监控器

API 监控允许您监控 HTTP/REST API 的可用性、性能和正确性。OneUptime 定期向您的 API 端点发送 HTTP 请求，并根据您配置的标准评估响应。

## 概述

API 监控器向您的端点发出 HTTP 请求并检查响应。这使您能够：

- 监控 API 正常运行时间和可用性
- 跟踪响应时间和性能
- 验证 HTTP 状态码和响应体
- 验证响应头
- 测试不同的 HTTP 方法（GET、POST、PUT、DELETE 等）
- 发送自定义请求头和请求体

## 创建 API 监控器

1. 在 OneUptime 控制台中转到 **监控器**
2. 点击 **创建监控器**
3. 选择 **API** 作为监控器类型
4. 输入 API URL 并配置请求设置
5. 根据需要配置监控标准

## 配置选项

### API URL

输入您要监控的 API 端点的完整 URL（例如 `https://api.example.com/v1/health`）。

### 动态 URL 占位符

在监控位于 CDN 或缓存代理后面的 API 时，监控器可能会收到缓存的响应，而不是直接访问源服务器。要在每次检查时绕过缓存，您可以使用动态 URL 占位符，这些占位符在每次监控请求时会被替换为唯一值。

#### 支持的占位符

| 占位符          | 描述                         | 示例值                             |
| --------------- | ---------------------------- | ---------------------------------- |
| `{{timestamp}}` | 替换为当前 Unix 时间戳（秒） | `1719500000`                       |
| `{{random}}`    | 替换为随机唯一字符串         | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

#### 示例

使用占位符配置您的监控器 URL：

```
https://api.example.com/health?cb={{timestamp}}
```

每次监控检查时，URL 变为：

```
https://api.example.com/health?cb=1719500000
https://api.example.com/health?cb=1719500005
...
```

您也可以使用 `{{random}}` 在每次请求时生成唯一字符串：

```
https://api.example.com/health?nocache={{random}}
```

### API 请求类型

选择请求的 HTTP 方法：

- **GET**（默认）
- **POST**
- **PUT**
- **DELETE**
- **PATCH**
- **HEAD**

### 高级选项

#### 请求头

向请求添加自定义 HTTP 头。这对于认证令牌、内容类型规范和其他 API 特定头非常有用。

您可以在头的值中使用[监控器密钥](/docs/monitor/monitor-secrets)来安全地存储 API 密钥等敏感数据。

#### 请求体（JSON）

对于 POST、PUT 和 PATCH 请求，您可以指定 JSON 请求体。您也可以在请求体中使用[监控器密钥](/docs/monitor/monitor-secrets)。

#### 不跟随重定向

默认情况下，OneUptime 跟随 HTTP 重定向（301、302 等）。如果您想监控重定向响应本身而非最终目标，请启用此选项。

#### Allow Self-Signed Certificates

Enable this option to skip TLS certificate validation. Useful when the target server uses a self-signed or otherwise untrusted TLS certificate (for example, an internal staging environment).

#### Client Certificate (mTLS)

If your endpoint requires mutual TLS authentication, enable **Use client certificate (mTLS)** and provide:

- **Client Certificate (PEM)** — the PEM-encoded client certificate to present.
- **Client Private Key (PEM)** — the matching PEM-encoded private key.
- **Client Private Key Passphrase** _(optional)_ — required only if the private key is encrypted.

This is the OneUptime equivalent of the `--cert` and `--key` flags in curl:

```bash
curl --cert client.crt --key client.key https://api.example.com/health
```

For sensitive values, store the certificate and key as [Monitor Secrets](/docs/monitor/monitor-secrets) and reference them with `{{monitorSecrets.name}}`. Monitor Secrets are resolved server-side and the rendered values never appear in the dashboard.

## 监控标准

您可以配置标准来判断 API 何时处于在线、降级或离线状态，基于以下条件：

- **响应状态码** - 检查 HTTP 状态码是否与预期值匹配（例如 200、201）
- **响应时间** - 监控响应时间是否超过阈值
- **响应体** - 检查响应体是否包含或匹配特定内容
- **响应头** - 验证特定响应头是否存在或匹配预期值
- **JavaScript 表达式** - 编写自定义表达式来评估响应。详情参见 [JavaScript 表达式](/docs/monitor/javascript-expression)
