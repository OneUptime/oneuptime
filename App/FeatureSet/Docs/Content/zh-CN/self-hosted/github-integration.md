# GitHub 集成

要将 GitHub 与您的自托管 OneUptime 实例集成，您需要创建一个 GitHub App 并配置所需的环境变量。这允许 OneUptime 连接到您的 GitHub 代码仓库进行代码库管理。

## 前提条件

- 具有组织管理员访问权限的 GitHub 账号（用于组织代码仓库）或个人账号访问权限
- 访问您的 OneUptime 服务器配置

## 设置说明

### 第一步：创建 GitHub App

1. 前往 GitHub 并导航到您的组织或个人设置：

   - **对于组织：** 前往 `https://github.com/organizations/YOUR_ORG/settings/apps`
   - **对于个人账号：** 前往 `https://github.com/settings/apps`

2. 点击 **"New GitHub App"**

3. 填写注册表单：
   - **GitHub App 名称：** OneUptime（或任何唯一名称） - **保存此名称，您将需要它作为 `GITHUB_APP_NAME` 环境变量**
   - **主页 URL：** `https://your-oneuptime-domain.com`
   - **回调 URL：** `https://your-oneuptime-domain.com/api/github/auth/callback`
   - **设置 URL：** `https://your-oneuptime-domain.com/api/github/auth/callback` - **重要提示：这是 GitHub 在用户安装应用后重定向用户的 URL。必须设置此 URL，重定向才能正常工作。**
   - **更新时重定向：** 选中此选项，以在用户更新应用安装后重定向用户
   - **Webhook URL：** `https://your-oneuptime-domain.com/api/github/webhook`
   - **Webhook 密钥：** 生成一个安全的随机字符串（稍后保存）

### 第二步：配置应用权限

在"权限与事件"部分，配置以下权限：

**代码仓库权限：**

| 权限            | 访问级别 | 用途                                    |
| --------------- | -------- | --------------------------------------- |
| Contents        | 读写     | 读取仓库文件，推送分支（AI Agent 必需） |
| Pull requests   | 读写     | 创建和管理 Pull Request                 |
| Issues          | 读写     | 读取 Issue 并发表评论                   |
| Commit statuses | 读取     | 检查构建/CI 状态                        |
| Actions         | 读取     | 读取 GitHub Actions 工作流运行和日志    |
| Metadata        | 读取     | 基本仓库元数据（必需）                  |

**组织权限（与组织一起使用时）：**

| 权限    | 访问级别 | 用途         |
| ------- | -------- | ------------ |
| Members | 读取     | 列出组织成员 |

**账号权限：**

| 权限            | 访问级别 | 用途                       |
| --------------- | -------- | -------------------------- |
| Email addresses | 读取     | 读取用户电子邮件以发送通知 |

### 第三步：订阅 Webhook 事件

OneUptime 接收实时更新的事件，订阅以下 Webhook 事件：

- **Pull request** - 当 PR 被打开、关闭或合并时接收通知
- **Push** - 当代码被推送时接收通知
- **Workflow run** - 接收 CI/CD 状态更新

### 第四步：设置安装访问权限

在"此 GitHub App 可以安装在哪里？"下，选择：

- **仅限此账号** - 用于私有/内部使用
- **任何账号** - 如果您希望其他人安装您的应用

### 第五步：创建 GitHub App

1. 点击 **"Create GitHub App"**
2. 您将被重定向到应用的设置页面
3. 记录以下值：
   - **App ID** - 在应用设置页面顶部找到
   - **Client ID** - 在"关于"部分找到

### 第六步：生成客户端密钥

1. 在您的 GitHub App 设置中，滚动到"Client secrets"
2. 点击 **"Generate a new client secret"**
3. 立即复制密钥——之后将无法再次查看

### 第七步：生成私钥

1. 向下滚动到"Private keys"部分
2. 点击 **"Generate a private key"**
3. 将自动下载一个 `.pem` 文件
4. 安全保存此文件——它用于以 GitHub App 身份进行认证

### 第八步：配置 OneUptime 环境变量

#### Docker Compose

如果您使用 Docker Compose，请将这些环境变量添加到您的 `config.env` 文件中：

```bash
# GitHub App 配置
GITHUB_APP_ID=YOUR_APP_ID
GITHUB_APP_NAME=YOUR_APP_NAME  # 您的 GitHub App 的确切名称（例如"OneUptime"）
GITHUB_APP_CLIENT_ID=YOUR_CLIENT_ID
GITHUB_APP_CLIENT_SECRET=YOUR_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY="<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
GITHUB_APP_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET
```

**注意：** 对于私钥，如果您的环境不支持多行字符串，请将其编码为 base64 并粘贴时不带换行符。

#### Kubernetes with Helm

如果您使用 Kubernetes with Helm，请将这些添加到您的 `values.yaml` 文件中：

```yaml
gitHubApp:
  id: "YOUR_APP_ID"
  name: "YOUR_APP_NAME" # 您的 GitHub App 的确切名称
  clientId: "YOUR_CLIENT_ID"
  clientSecret: "YOUR_CLIENT_SECRET"
  privateKey: "<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
  webhookSecret: "YOUR_WEBHOOK_SECRET"
```

**重要提示：** 添加这些环境变量后重启您的 OneUptime 服务器以使其生效。

### 第九步：安装 GitHub App

1. 前往您的 GitHub App 公共页面：`https://github.com/apps/YOUR_APP_NAME`
2. 点击 **"Install"** 或 **"Configure"**
3. 选择您要安装应用的组织或账号
4. 选择应用可以访问哪些代码仓库：
   - **所有代码仓库** - 访问所有当前和未来的代码仓库
   - **仅选定的代码仓库** - 选择特定的代码仓库
5. 点击 **"Install"**

### 第十步：在 OneUptime 中连接代码仓库

1. 登录您的 OneUptime 控制台
2. 导航至 **更多** > **代码仓库**
3. 点击 **"创建代码仓库"** 或使用 GitHub App 安装流程
4. 如果从 GitHub 重定向，安装 ID 将自动捕获
5. 从列表中选择您要连接的代码仓库
6. 点击 **"连接"** 将代码仓库链接到您的 OneUptime 项目

## 环境变量参考

| 变量                        | 描述                                       | 是否必填     |
| --------------------------- | ------------------------------------------ | ------------ |
| `GITHUB_APP_ID`             | 来自您 GitHub App 设置的 App ID            | 是           |
| `GITHUB_APP_NAME`           | 您的 GitHub App 的确切名称（用于安装 URL） | 是           |
| `GITHUB_APP_CLIENT_ID`      | 来自您 GitHub App 设置的 Client ID         | 是           |
| `GITHUB_APP_CLIENT_SECRET`  | 您生成的客户端密钥                         | 是           |
| `GITHUB_APP_PRIVATE_KEY`    | 私钥（.pem 文件）的内容                    | 是           |
| `GITHUB_APP_WEBHOOK_SECRET` | 用于验证 Webhook 负载的 Webhook 密钥       | 否（但推荐） |

## 故障排查

### 常见问题

**安装 GitHub App 后未重定向回 OneUptime：**

- 确保在 GitHub App 设置中将 **Setup URL** 配置为：`https://your-oneuptime-domain.com/api/github/auth/callback`
- 前往您的 GitHub App 设置 > "安装后"部分，验证 Setup URL 是否正确设置
- 还应勾选"更新时重定向"选项
- 注意：Setup URL 与 Callback URL 不同——两者都应指向相同的 `/api/github/auth/callback` 端点

**"GitHub App is not configured"错误：**

- 确保设置了 `GITHUB_APP_CLIENT_ID` 环境变量
- 设置环境变量后重启 OneUptime 服务器

**"Invalid webhook signature"错误：**

- 验证您的 `GITHUB_APP_WEBHOOK_SECRET` 与 GitHub 中配置的密钥是否匹配
- 确保 Webhook URL 正确且可从互联网访问

**"Failed to get installation access token"错误：**

- 验证您的 `GITHUB_APP_PRIVATE_KEY` 格式是否正确
- 检查私钥是否包含 BEGIN/END 标记
- 确保 App ID 正确

**安装后看不到代码仓库：**

- 验证 GitHub App 是否有权访问您要连接的代码仓库
- 检查 GitHub 中的安装权限（设置 > 应用程序 > 已安装的 GitHub 应用）

**未收到 Webhook 事件：**

- 确保您的 Webhook URL 可公开访问
- 在应用设置中检查 GitHub App Webhook 传送日志
- 验证 Webhook 密钥是否正确配置

### 检查 Webhook 传送记录

1. 前往您的 GitHub App 设置
2. 点击侧边栏中的"Advanced"
3. 查看"Recent Deliveries"以查看 Webhook 尝试和响应

## 安全最佳实践

1. **定期轮换密钥** - 定期生成新的客户端密钥和私钥
2. **使用 Webhook 密钥** - 始终配置 Webhook 密钥以验证负载真实性
3. **限制代码仓库访问** - 仅授予需要连接的代码仓库的访问权限
4. **监控 Webhook 传送** - 定期检查失败的传送或可疑活动
5. **安全保存私钥** - 切勿将私钥提交到版本控制系统

## 支持

如果您在 GitHub 集成方面遇到问题，请：

1. 查看上方的故障排查部分
2. 查看 OneUptime 日志以获取详细错误消息
3. 通过 [hello@oneuptime.com](mailto:hello@oneuptime.com) 联系我们

我们欢迎您的反馈以改进此集成！
