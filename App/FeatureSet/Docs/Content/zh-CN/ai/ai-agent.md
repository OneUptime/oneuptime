# AI 智能体

OneUptime 中的 AI 智能体可自动修复您代码中的错误、性能问题和数据库查询。基于 OpenTelemetry 可观测性数据，AI 智能体会创建包含修复方案的 Pull Request，而不仅仅是发送告警。

## AI 智能体能做什么？

AI 智能体分析您的可观测性数据（追踪、日志和指标），以检测并自动修复代码库中的问题：

- **自动修复错误**：当 AI 智能体在追踪或日志中发现异常时，会自动修复问题并创建 Pull Request。
- **修复性能问题**：分析执行时间最长的追踪，并创建包含性能优化的 Pull Request。
- **修复数据库查询**：识别慢速或低效的数据库查询，并通过适当的索引和查询重写进行优化。
- **修复前端问题**：自动处理前端特有的性能问题、渲染问题和 JavaScript 错误。
- **自动添加遥测数据**：只需单击即可向代码库添加追踪、指标和日志。无需手动埋点。
- **GitHub 和 GitLab 集成**：与您现有的代码仓库无缝集成。Pull Request 直接在您的工作流中创建。
- **CI/CD 集成**：与您现有的 CI/CD 流水线集成。修复在创建 PR 之前会经过测试和验证。
- **Terraform 支持**：自动修复基础设施问题。支持 Terraform 和 OpenTofu 进行基础设施即代码管理。
- **问题跟踪器集成**：与 Jira、Linear 等问题跟踪器连接。自动将修复关联到相关问题。

## 工作原理

1. **收集数据**：OpenTelemetry 从您的应用程序收集追踪、日志和指标
2. **检测问题**：AI 识别错误、性能瓶颈和慢速查询
3. **生成修复**：AI 分析您的代码库并自动创建修复方案
4. **创建 PR**：包含修复和详细报告的 Pull Request 准备好供审查

## LLM 提供商灵活性

OneUptime 支持任意 LLM 提供商。您可以使用：

- **OpenAI GPT** 模型
- **Anthropic Claude** 模型
- **Meta Llama**（通过 Ollama 或其他提供商）
- **自定义自托管**模型

自托管您的 AI 模型，让您的代码完全保持私密。

## 隐私

无论您使用哪种方案，OneUptime 都不会查看、存储或用您的代码进行训练：

- **不访问代码**：您的代码保留在您的基础设施上
- **不存储数据**：零数据保留策略
- **不用于训练**：您的代码永远不会用于 AI 训练

## 全局 AI 智能体与自托管 AI 智能体

### 全局 AI 智能体

如果您使用 **OneUptime SaaS**（云托管版本），全局 AI 智能体由 OneUptime 提供，已预先配置并可直接使用。这些智能体由 OneUptime 管理，无需额外设置。

全局 AI 智能体默认对所有项目可用，除非在项目设置中禁用。

### 自托管 AI 智能体

对于需要在自己基础设施内运行 AI 智能体的组织（例如出于安全、合规或网络访问要求），OneUptime 支持自托管 AI 智能体。

自托管 AI 智能体：

- 在您的私有网络内运行
- 可访问内部资源和系统
- 让您完全控制智能体的环境
- 可根据您的特定需求进行定制

## 设置自托管 AI 智能体

### 第一步：在 OneUptime 中创建 AI 智能体

1. 登录您的 OneUptime 控制台
2. 前往 **项目设置** > **AI 智能体**
3. 点击 **创建 AI 智能体** 以添加新智能体
4. 填写必填字段：
   - **名称**：您的 AI 智能体的友好名称
   - **描述**（可选）：智能体用途的描述
5. 创建后，您将获得 `AI_AGENT_ID` 和 `AI_AGENT_KEY`

**重要提示**：请妥善保存您的 `AI_AGENT_KEY`。它只会显示一次，之后无法找回。

### 第二步：部署 AI 智能体

#### Docker

要运行 AI 智能体，请确保已安装 Docker。使用以下命令运行智能体：

```bash
docker run --name oneuptime-ai-agent --network host \
  -e AI_AGENT_KEY=<ai-agent-key> \
  -e AI_AGENT_ID=<ai-agent-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -d oneuptime/ai-agent:release
```

如果您是自托管 OneUptime，请将 `ONEUPTIME_URL` 更改为您自定义的自托管实例 URL。

#### Docker Compose

您也可以使用 docker-compose 运行 AI 智能体。创建一个 `docker-compose.yml` 文件：

```yaml
version: "3"

services:
  oneuptime-ai-agent:
    image: oneuptime/ai-agent:release
    container_name: oneuptime-ai-agent
    environment:
      - AI_AGENT_KEY=<ai-agent-key>
      - AI_AGENT_ID=<ai-agent-id>
      - ONEUPTIME_URL=https://oneuptime.com
    network_mode: host
    restart: always
```

然后运行：

```bash
docker compose up -d
```

#### Kubernetes

创建一个 `oneuptime-ai-agent.yaml` 文件：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-ai-agent
spec:
  selector:
    matchLabels:
      app: oneuptime-ai-agent
  template:
    metadata:
      labels:
        app: oneuptime-ai-agent
    spec:
      containers:
        - name: oneuptime-ai-agent
          image: oneuptime/ai-agent:release
          env:
            - name: AI_AGENT_KEY
              value: "<ai-agent-key>"
            - name: AI_AGENT_ID
              value: "<ai-agent-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
```

应用配置：

```bash
kubectl apply -f oneuptime-ai-agent.yaml
```

### 环境变量

AI 智能体支持以下环境变量：

#### 必填变量

| 变量            | 描述                                                   |
| --------------- | ------------------------------------------------------ |
| `AI_AGENT_KEY`  | 来自您 OneUptime 控制台的 AI 智能体密钥                |
| `AI_AGENT_ID`   | 来自您 OneUptime 控制台的 AI 智能体 ID                 |
| `ONEUPTIME_URL` | 您的 OneUptime 实例 URL（默认：https://oneuptime.com） |

## 验证您的 AI 智能体

部署 AI 智能体后：

1. 在您的 OneUptime 控制台中，前往 **项目设置** > **AI 智能体**
2. 您的智能体应在几分钟内显示为 **已连接**
3. 如果状态显示为 **已断开连接**，请检查容器日志以获取错误信息

查看容器日志：

```bash
# Docker
docker logs oneuptime-ai-agent

# Kubernetes
kubectl logs deployment/oneuptime-ai-agent
```

## 故障排查

### 智能体无法连接

1. **验证凭据**：确保 `AI_AGENT_KEY` 和 `AI_AGENT_ID` 正确
2. **检查网络**：确保智能体能够访问您的 OneUptime 实例
3. **查看日志**：检查容器日志中的错误信息
4. **防火墙规则**：确保允许出站 HTTPS（端口 443）流量

### 智能体持续断开连接

1. **检查资源限制**：确保容器有足够的内存和 CPU
2. **网络稳定性**：验证网络连接是否稳定
3. **查看日志**：在日志中查找超时或连接错误

## 需要帮助？

如果您在使用 AI 智能体时遇到问题：

1. 查看 [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) 了解已知问题
2. 如果您的问题尚未被报告，请创建新 Issue
3. 如果您是企业计划用户，请联系[支持团队](https://oneuptime.com/support)
