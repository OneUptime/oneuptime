# LLM 提供商

OneUptime 支持与各种大型语言模型（LLM）提供商集成，以在整个平台中启用 AI 功能。本指南将帮助您配置自己的 LLM 提供商。

## LLM 提供商能做什么？

OneUptime 中的 LLM 提供商可帮助您自动化并增强事件管理工作流：

- **事件备注**：自动生成详细的事件备注和更新
- **告警备注**：创建有意义的告警描述和上下文信息
- **计划维护备注**：自动生成维护事件备注
- **事件事后分析**：自动起草全面的事件事后分析报告
- **代码改进**：如果您将代码仓库连接到 OneUptime，我们将使用您的 LLM 提供商分析遥测数据（日志、追踪、指标、异常）并提出代码改进建议

## OneUptime SaaS 用户

如果您使用 **OneUptime SaaS**（云托管版本），默认情况下无需任何额外配置即可使用**全局 LLM 提供商**。全局 LLM 提供商已预先配置好，可用于所有 AI 功能。

如果您希望使用自己的 API 密钥或特定提供商，仍可按照以下说明配置自定义 LLM 提供商。

## 支持的提供商

OneUptime 目前支持以下 LLM 提供商：

| 提供商                | 描述                                                              | 是否需要 API 密钥 | 是否需要基础 URL |
| --------------------- | ----------------------------------------------------------------- | ----------------- | ---------------- |
| **OpenAI**            | GPT-4、GPT-4o、GPT-3.5 Turbo 及其他 OpenAI 模型                   | 是                | 否（使用默认值） |
| **Azure OpenAI**      | 部署在您的 Azure 环境中的 OpenAI 模型                             | 是                | 是               |
| **Anthropic**         | Claude 3 Opus、Claude 3 Sonnet、Claude 3 Haiku 及其他 Claude 模型 | 是                | 否（使用默认值） |
| **Groq**              | 针对 Llama、Mixtral 等开源模型的高速推理服务                      | 是                | 否（使用默认值） |
| **Mistral**           | Mistral 托管的模型                                                | 是                | 否（使用默认值） |
| **Ollama**            | 自托管开源模型，如 Llama 2、Mistral、CodeLlama 等                 | 否                | 是               |
| **OpenAI Compatible** | 任何兼容 OpenAI 的服务器（vLLM、LocalAI、LM Studio 等）           | 否（可选）        | 是               |

## 设置 LLM 提供商

### 第一步：导航至 LLM 提供商设置

1. 登录您的 OneUptime 控制台
2. 前往 **AI 智能体** > **LLM 提供商**
3. 点击 **创建 LLM 提供商** 以添加新提供商

### 第二步：配置您的提供商

填写以下字段：

- **名称**：此 LLM 配置的友好名称（例如"生产 OpenAI"、"本地 Ollama"）
- **描述**（可选）：帮助标识此提供商用途的描述
- **LLM 类型**：选择提供商类型（OpenAI、Azure OpenAI、Anthropic、Groq、Mistral、Ollama 或 OpenAI Compatible）
- **API 密钥**：您的 API 密钥（OpenAI、Azure OpenAI、Anthropic、Groq 和 Mistral 必填；Ollama 和兼容 OpenAI 的服务器可选）
- **模型名称**：要使用的具体模型（例如 `gpt-4o`、`claude-3-opus-20240229`、`llama2`）
- **基础 URL**（可选）：自定义 API 端点 URL（Azure OpenAI、Ollama 和 OpenAI Compatible 必填，其他可选）

## 各提供商的具体配置

### OpenAI

1. 从 [OpenAI Platform](https://platform.openai.com/api-keys) 获取您的 API 密钥
2. 选择 **OpenAI** 作为 LLM 类型
3. 输入您的 API 密钥
4. 选择模型名称：
   - `gpt-4o` - 能力最强的模型，适合复杂任务
   - `gpt-4o-mini` - 更快且更具成本效益
   - `gpt-4-turbo` - 能力与速度的良好平衡
   - `gpt-3.5-turbo` - 快速且经济实惠

**示例配置：**

```
Name: Production OpenAI
LLM Type: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-4o
```

### Anthropic

1. 从 [Anthropic Console](https://console.anthropic.com/) 获取您的 API 密钥
2. 选择 **Anthropic** 作为 LLM 类型
3. 输入您的 API 密钥
4. 选择模型名称：
   - `claude-3-opus-20240229` - 能力最强的模型
   - `claude-3-sonnet-20240229` - 智能与速度的良好平衡
   - `claude-3-haiku-20240307` - 最快且最紧凑
   - `claude-3-5-sonnet-20241022` - 最新的 Sonnet 模型

**示例配置：**

```
Name: Production Anthropic
LLM Type: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-3-5-sonnet-20241022
```

### Ollama（自托管）

Ollama 允许您在本地或自己的基础设施上运行开源 LLM。

1. 从 [ollama.ai](https://ollama.ai) 安装 Ollama
2. 拉取所需的模型：`ollama pull llama2`
3. 确保 Ollama 正在运行且可访问
4. 选择 **Ollama** 作为 LLM 类型
5. 输入基础 URL（例如 `http://localhost:11434`）
6. 输入您拉取的模型名称

**示例配置：**

```
Name: Local Ollama
LLM Type: Ollama
Base URL: http://localhost:11434
Model Name: llama2
```

**常用 Ollama 模型：**

- `llama2` - Meta 的 Llama 2 模型
- `llama3` - Meta 的 Llama 3 模型
- `mistral` - Mistral AI 的模型
- `codellama` - 专注于代码的 Llama 模型
- `mixtral` - Mistral 的混合专家模型

### OpenAI Compatible（vLLM、LocalAI、LM Studio 等）

对于任何实现了 OpenAI `/chat/completions` API 但并非 OpenAI 本身的服务器，请使用 **OpenAI Compatible** 提供商——例如 [vLLM](https://docs.vllm.ai)、[LocalAI](https://localai.io)、[LM Studio](https://lmstudio.ai) 或 text-generation-webui。这些服务器通常自托管在您自己的 URL 上，且往往无需身份验证即可运行。

1. 启动您的兼容 OpenAI 的服务器，并记下其基础 URL（通常以 `/v1` 结尾）
2. 选择 **OpenAI Compatible** 作为 LLM 类型
3. 输入**基础 URL**（必填），例如 `http://your-server:8000/v1`
4. 输入**模型名称**（必填）——必须与您服务器上提供的模型匹配
5. 仅当您的服务器需要身份验证时才输入 **API 密钥**；无需密钥的服务器可留空

**示例配置（无需密钥的 vLLM）：**

```
Name: Self-Hosted vLLM
LLM Type: OpenAI Compatible
Base URL: http://vllm.internal:8000/v1
Model Name: meta-llama/Llama-3.1-8B-Instruct
API Key: (leave blank)
```

> 提示：保存后，请使用提供商上的**测试**按钮，确认连接、模型名称和基础 URL 均正确无误。

### 在 Kubernetes 上自托管 vLLM（Helm）

如果您使用 Helm chart 自托管 OneUptime，可以在集群内运行 [vLLM](https://docs.vllm.ai)——一个兼容 OpenAI 的推理服务器，并在您自己的 GPU 上提供本地模型服务。数据不会离开您的基础设施。

1. 在 Helm values 中启用它（需要 NVIDIA GPU 节点）：

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. 运行 `helm upgrade`，等待 vLLM Pod 变为 Ready 状态（首次启动会下载模型）
3. 完成——vLLM 会在启动时自动注册为全局 LLM 提供商（`vllm.globalProvider.enabled`，默认值为 `true`），因此所有项目均可使用 AI 功能。注意：项目范围内的 AI 智能体无法使用全局提供商，仍需要项目专属的 LLM 提供商。

如果您禁用了自动注册（`vllm.globalProvider.enabled: false`），请手动创建提供商：

1. 选择 **OpenAI Compatible** 作为 LLM 类型（vLLM 使用 OpenAI API）
2. 输入集群内基础 URL：`http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1`
3. 输入模型名称：完整的 HuggingFace 模型 id（如果您设置了 `vllm.servedModelName`，则使用该值）
4. 仅当您设置了 `vllm.apiKey` 时才输入 API 密钥；无密钥的 vLLM 可留空

**示例配置：**

```
Name: In-Cluster vLLM
LLM Type: OpenAI Compatible
Base URL: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Model Name: Qwen/Qwen2.5-1.5B-Instruct
API Key: (leave blank unless vllm.apiKey is set)
```

有关 GPU 调度、受限模型和调优选项，请参阅 [Helm chart README](https://github.com/OneUptime/oneuptime/tree/master/HelmChart/Public/oneuptime#local-models-with-vllm)。

## 使用自定义基础 URL

对于企业部署或使用代理服务时，您可以指定自定义基础 URL：

- **Azure OpenAI**：使用您的 Azure 端点 URL
- **兼容 OpenAI 的 API**：任何遵循 OpenAI API 规范的 API
- **私有 Ollama 实例**：您的内部 Ollama 服务器 URL

## 最佳实践

1. **使用描述性名称**：清晰地命名您的提供商（例如"生产 GPT-4"、"开发 Ollama"）
2. **保护您的 API 密钥**：API 密钥在静态存储时已加密，但避免共享它们
3. **测试您的配置**：设置完成后，验证提供商是否能正常用于 AI 功能
4. **监控使用情况**：跟踪 API 使用情况以管理成本

## 故障排查

### 连接问题

- **OpenAI/Anthropic**：验证您的 API 密钥有效且有足够的额度
- **Ollama**：确保 Ollama 服务器正在运行且基础 URL 正确
- **OpenAI Compatible**：确保基础 URL 以 `/v1` 结尾（或与您的服务器匹配）、模型名称与您服务器提供的模型一致，并且仅在服务器需要时才设置 API 密钥
- **防火墙**：检查您的网络是否允许出站连接到提供商的 API

### 找不到模型

- 验证模型名称拼写是否正确
- 对于 Ollama，确保已使用 `ollama pull <model-name>` 拉取该模型
- 检查该模型是否在您的地区可用（某些模型有地区限制）

## 需要帮助？

如果您在设置 LLM 提供商时遇到问题，请：

1. 查看 [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) 了解已知问题
2. 如果您是企业计划用户，请联系支持团队
