# LLM 提供商

OneUptime 支持与各种大型语言模型（LLM）提供商集成，以在整个平台中启用 AI 功能。本指南将帮助您配置自己的 LLM 提供商。

## LLM 提供商能做什么？

OneUptime 中的 LLM 提供商可帮助您自动化并增强事件管理工作流：

- **自主调查**：自动调查新的事件和告警，并在时间线上发布附带引用的根本原因分析——请参阅[AI SRE](/docs/ai/ai-sre)
- **事件备注**：自动生成详细的事件备注和更新
- **告警备注**：创建有意义的告警描述和上下文信息
- **计划维护备注**：自动生成维护事件备注
- **事件事后分析**：自动起草全面的事件事后分析报告
- **代码改进**：如果您将代码仓库连接到 OneUptime，我们将使用您的 LLM 提供商分析遥测数据（日志、追踪、指标、异常）并提出代码改进建议

## OneUptime SaaS 用户

如果您使用 **OneUptime SaaS**（云托管版本），默认情况下无需任何额外配置即可使用**全局 LLM 提供商**。全局 LLM 提供商已预先配置好，可用于所有 AI 功能。

如果您希望使用自己的 API 密钥或特定提供商，仍可按照以下说明配置自定义 LLM 提供商。

OneUptime SaaS 只能访问公共互联网上的 LLM 端点，无法连接您私有网络中的模型，例如自托管的 Ollama 或 vLLM 服务器。要使用您自己运行的模型，请在能访问该模型的网络中自托管 OneUptime，或将模型发布到公共端点——请参阅[为自托管模型选择基础 URL](#为自托管模型选择基础-url)。

## 自托管：仅用环境变量完成配置

在自托管实例上，**一次性为所有项目**启用 AI 功能的最快方式，是在 OneUptime 服务器上设置 `GLOBAL_LLM_PROVIDER_*` 环境变量——Docker Compose 写在 `config.env` 中，Helm 则通过 values 设置。启动时，OneUptime 会据此注册一个全局 LLM 提供商（并保持同步）；无需在控制台中逐个项目进行配置，项目没有自己的提供商时，AI 修复任务也会使用它。

| 变量 | 描述 |
| --- | --- |
| `GLOBAL_LLM_PROVIDER_TYPE` | 启用时必填。取值之一：`OpenAI`、`AzureOpenAI`、`Anthropic`、`Groq`、`Mistral`、`Ollama`、`OpenAICompatible` |
| `GLOBAL_LLM_PROVIDER_API_KEY` | API 密钥——OpenAI、Azure OpenAI、Anthropic、Groq 和 Mistral 必填；Ollama 或无需密钥的 OpenAI 兼容服务器不需要 |
| `GLOBAL_LLM_PROVIDER_BASE_URL` | API 端点——Azure OpenAI、Ollama 和 OpenAI 兼容服务器必填 |
| `GLOBAL_LLM_PROVIDER_MODEL_NAME` | 要使用的模型（OpenAI 兼容服务器必填，其他情况建议填写） |
| `GLOBAL_LLM_PROVIDER_NAME` | 可选的友好名称，显示在控制台中 |

**示例：自托管 Ollama**

```bash
GLOBAL_LLM_PROVIDER_TYPE=Ollama
# OneUptime 服务器能够访问的地址。绝不能用 localhost：
# 参见下文 "为自托管模型选择基础 URL"。
GLOBAL_LLM_PROVIDER_BASE_URL=http://ollama:11434
GLOBAL_LLM_PROVIDER_MODEL_NAME=llama3.1
# 无需 API 密钥——Ollama 不使用密钥。
```

**示例：OpenAI**

```bash
GLOBAL_LLM_PROVIDER_TYPE=OpenAI
GLOBAL_LLM_PROVIDER_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
GLOBAL_LLM_PROVIDER_MODEL_NAME=gpt-5.1
```

同步是声明式的：修改变量后，提供商会在下次重启时更新；移除 `GLOBAL_LLM_PROVIDER_TYPE` 则会将其删除。在管理仪表板中手动创建的全局提供商永远不会被改动。项目仍可在 **项目设置** > **人工智能** > **LLM 提供商** 下添加自己的提供商——项目自有的提供商始终优先于全局提供商。

## 支持的提供商

OneUptime 目前支持以下 LLM 提供商：

| 提供商                | 描述                                                                | 是否需要 API 密钥 | 是否需要基础 URL |
| --------------------- | ------------------------------------------------------------------- | ----------------- | ---------------- |
| **OpenAI**            | GPT-5.1 及其他 OpenAI 模型                                          | 是                | 否（使用默认值） |
| **Azure OpenAI**      | 部署在您的 Azure 环境中的 OpenAI 模型                               | 是                | 是               |
| **Anthropic**         | Claude Sonnet 5、Claude Opus 5、Claude Haiku 4.5 及其他 Claude 模型 | 是                | 否（使用默认值） |
| **Groq**              | 针对 Llama、Mixtral 等开源模型的高速推理服务                        | 是                | 否（使用默认值） |
| **Mistral**           | Mistral 托管的模型                                                  | 是                | 否（使用默认值） |
| **Ollama**            | 自托管开源模型，如 Llama 3.1、Mistral、Qwen 等                      | 否                | 是               |
| **OpenAI Compatible** | 任何兼容 OpenAI 的服务器（vLLM、LocalAI、LM Studio 等）             | 否（可选）        | 是               |

## 设置 LLM 提供商

### 第一步：导航至 LLM 提供商设置

1. 登录您的 OneUptime 控制台
2. 前往 **项目设置** > **人工智能** > **LLM 提供商**
3. 点击 **创建LLM 提供商** 以添加新提供商

### 第二步：配置您的提供商

填写以下字段：

- **名称**：此 LLM 配置的友好名称（例如"生产 OpenAI"、"本地 Ollama"）
- **描述**（可选）：帮助标识此提供商用途的描述
- **LLM 提供商**：选择提供商类型（OpenAI、Azure OpenAI、Anthropic、Groq、Mistral、Ollama 或 OpenAI Compatible）
- **API 密钥**：您的 API 密钥（OpenAI、Azure OpenAI、Anthropic、Groq 和 Mistral 必填；Ollama 和兼容 OpenAI 的服务器可选）
- **模型名称**：要使用的具体模型（例如 `gpt-5.1`、`claude-sonnet-5`、`llama3.1`）
- **基础 URL**（可选）：自定义 API 端点 URL（Azure OpenAI、Ollama 和 OpenAI Compatible 必填，其他可选）
- **更多字段**：收起在上方字段之下，包括 **设为默认**（新提供商默认开启，因为 AI 功能只使用项目的默认提供商）和 **附加参数**（可选的 JSON 对象，其中的额外参数会随每个请求发送给提供商，例如 `{"temperature": 0.2}`）

### 谁能看到提供商

项目的 LLM 提供商只有能读取项目设置的成员才能读取：**Project Owner**、**Project Admin**、**Project Member**、**Viewer**、**Settings Admin**、**Settings Member**、**Settings Viewer** 和 **Read LLM**。提供商的 **API 密钥** 只有项目所有者和管理员才能读取。同一页面上的 **全局 LLM 提供商** 列表（项目在没有自己的提供商时使用的共享提供商）向任何已登录的人显示其名称、描述和价格，此外不显示任何内容。

## 各提供商的具体配置

### OpenAI

1. 从 [OpenAI Platform](https://platform.openai.com/api-keys) 获取您的 API 密钥
2. 选择 **OpenAI** 作为 LLM 提供商
3. 输入您的 API 密钥
4. 选择模型名称：
   - `gpt-5.1` - 推荐的默认模型，擅长工具调用和复杂调查
   - `gpt-5.1-mini` - 更快且更具成本效益

**示例配置：**

```
Name: Production OpenAI
LLM Provider: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-5.1
```

### Anthropic

1. 从 [Anthropic Console](https://console.anthropic.com/) 获取您的 API 密钥
2. 选择 **Anthropic** 作为 LLM 提供商
3. 输入您的 API 密钥
4. 选择模型名称：
   - `claude-sonnet-5` - 推荐的默认模型，智能、速度与成本的最佳平衡
   - `claude-opus-5` - 能力最强的模型，适合最棘手的调查
   - `claude-haiku-4-5` - 最快且最具成本效益

**示例配置：**

```
Name: Production Anthropic
LLM Provider: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-sonnet-5
```

### Ollama（自托管）

Ollama 允许您在本地或自己的基础设施上运行开源 LLM。

1. 从 [ollama.ai](https://ollama.ai) 安装 Ollama
2. 拉取所需的模型：`ollama pull llama3.1`
3. 确保 Ollama 正在运行，并且 OneUptime 服务器可以访问它。原生安装只监听 `127.0.0.1`，因此请使用 `OLLAMA_HOST=0.0.0.0:11434` 启动它，以接受来自其他机器和容器的连接（官方 Docker 镜像 `ollama/ollama` 已经这样设置）
4. 选择 **Ollama** 作为 LLM 提供商
5. 输入基础 URL：OneUptime 服务器访问 Ollama 服务器时使用的地址，例如 `http://ollama:11434`（`/api/chat` 由 OneUptime 自动添加）。`localhost` 无法使用——请参阅[为自托管模型选择基础 URL](#为自托管模型选择基础-url)
6. 输入您拉取的模型名称

**示例配置（Ollama 作为名为 `ollama` 的服务运行在 OneUptime 的 Docker Compose 网络上）：**

```
Name: Self-Hosted Ollama
LLM Provider: Ollama
Base URL: http://ollama:11434
Model Name: llama3.1
```

**增大上下文窗口。** 除非另行设置，Ollama 会根据检测到的 GPU 显存来确定模型的上下文窗口大小：低于 24 GiB 时为 4k 个 token，不超过 48 GiB 时为 32k，超过 48 GiB 时为 256k（旧版本使用 2048 或 4096 个 token）。OneUptime 的 AI 功能都是智能体。每个请求都带有它们的系统提示词和工具定义，在提出任何问题之前就已超过 10,000 个 token，而 AI 调查还会在进行过程中把每次查询的结果加入对话。当请求再也放不下时，Ollama 会丢弃最早的消息，问题也随之被丢弃。视模型和 Ollama 版本而定，模型随后会在没有问题或没有工具的情况下作答，或者请求失败并报错 "no user query found in messages"（Qwen 3.8 及更高版本）或 "the prompt is longer than the context length currently available to the model"。OneUptime 会将这些失败报告为 "…the request is larger than the model's context window"，并且不会重新运行调查。请在提供商的**附加参数**中设置更大的 `num_ctx`：

```json
{ "options": { "num_ctx": 65536 } }
```

OneUptime 会把这个 `options` 对象合并到它发送给 Ollama 的选项中，因此只需列出您要更改的设置。65,536 个 token 是 Ollama 为智能体推荐的大小，足以应对大多数调查。较长的调查可能会用到更多，因为 OneUptime 要等对话超过约 75,000 个 token 后才开始缩短旧的查询结果：如果模型支持且您的 GPU 能够容纳，请使用 131,072。上下文窗口越大，占用的内存越多；`ollama ps` 会显示每个已加载模型实际获得的上下文大小。如果想改为提高所有客户端的默认值，请在 Ollama 服务器上设置 `OLLAMA_CONTEXT_LENGTH`。当 OneUptime 通过 Ollama 兼容 OpenAI 的 `/v1` API（即 **OpenAI Compatible** 提供商）访问 Ollama 时，这是唯一的办法，因为该 API 会忽略 `num_ctx`。对于通过 `GLOBAL_LLM_PROVIDER_*` 变量注册的全局提供商，请在管理仪表板的 **设置** > **全局 LLM 提供商** 中设置**附加参数**；启动时的同步不会改动该字段。

**常用 Ollama 模型：**

- `llama3.1` - Meta 的 Llama 3.1 模型，最早支持工具调用的 Llama
- `llama3.3` - Meta 的 Llama 3.3 模型
- `qwen2.5` - 阿里巴巴的 Qwen 2.5 模型
- `mistral-nemo` - Mistral AI 的 Nemo 模型

> 注意：OneUptime 的 AI 功能是智能体式的——高度依赖工具调用。请使用 `llama3.1` 或更新版本（或其他支持工具调用的模型）。小模型或不支持工具调用的模型（例如 `llama2`、最初的 `llama3`）效果很差：它们无法查询您的监控、事件或遥测数据，因此调查结果会是空的或凭空编造的。

### 为自托管模型选择基础 URL

自托管模型（Ollama、vLLM、LM Studio 或任何其他兼容 OpenAI 的服务器）的基础 URL 必须是 **OneUptime 服务器** 能够访问的地址。您的浏览器从不连接它。

**回环地址始终会被拒绝。** 连接之前，OneUptime 会检查基础 URL 的主机名解析到的每个地址。`localhost`、`127.0.0.1`、`[::1]` 和 `0.0.0.0`，以及链路本地地址和 `169.254.169.254` 这样的云元数据地址，在所有部署中都会被拒绝，自托管部署也不例外。这是有意为之：提供商的基础 URL 不能被用来访问 OneUptime 服务器自身的服务。而且在 Docker Compose 或 Kubernetes 中，`localhost` 指的是 OneUptime 容器，而不是运行模型的机器。

请改用私有地址或内部主机名：

| 模型服务器的运行位置 | 基础 URL |
| --- | --- |
| OneUptime 的 Docker Compose 网络（`oneuptime`）上的服务 | 服务名，例如 `http://ollama:11434` |
| 与 OneUptime 相同的 Kubernetes 集群 | Service 的 DNS 名称，例如 `http://ollama.<namespace>.svc.cluster.local:11434`——与[内置 vLLM](#在-kubernetes-上自托管-vllmhelm) 的模式相同 |
| 宿主机本身，不在任何容器中 | 宿主机的局域网 IP，例如 `http://192.168.1.20:11434`；在 Docker Desktop 上也可以用 `http://host.docker.internal:11434` |
| 您网络中的另一台机器 | 它的私有 IP 或内部主机名，例如 `http://10.0.0.12:11434` |

兼容 OpenAI 的服务器遵循同样的规则，使用各自的端口和 `/v1` 路径，例如 `http://vllm:8000/v1`，或 LM Studio 的 `http://192.168.1.20:1234/v1`。与原生安装的 Ollama 一样，LM Studio 在您于其服务器设置中打开 **Serve on Local Network** 之前只监听 `127.0.0.1`。

**自托管部署可以使用私有地址。** 自托管的 OneUptime 可以访问私有网络地址，例如 `10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`、`100.64.0.0/10` 和 IPv6 `fc00::/7`，除非您设置了 `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`，这样它们会像在 OneUptime Cloud 上一样被拒绝。该设置不适用于全局 LLM 提供商：全局 LLM 提供商由管理员（通过 `GLOBAL_LLM_PROVIDER_*` 变量或在管理仪表板中）配置，而不是由项目配置，因此仍可访问私有地址。无论哪个提供商，回环地址和链路本地地址都仍会被拒绝。

**OneUptime Cloud（SaaS）无法访问私有网络。** 对于所有 LLM 提供商，它都会拒绝私有网络地址以及解析到这些地址的主机名。要使用运行在您自己基础设施上的模型，请在能访问该模型的网络中自托管 OneUptime，或将模型发布到可公开访问的端点。请用 API 密钥保护公共端点：**Ollama** 提供商不发送任何凭据，而 **OpenAI Compatible** 会把 API 密钥作为 Bearer 令牌发送（Ollama 也在 `/v1` 下提供兼容 OpenAI 的 API，因此可以放在校验密钥的反向代理之后）。

### OpenAI Compatible（vLLM、LocalAI、LM Studio 等）

对于任何实现了 OpenAI `/chat/completions` API 但并非 OpenAI 本身的服务器，请使用 **OpenAI Compatible** 提供商——例如 [vLLM](https://docs.vllm.ai)、[LocalAI](https://localai.io)、[LM Studio](https://lmstudio.ai) 或 text-generation-webui。这些服务器通常自托管在您自己的 URL 上，且往往无需身份验证即可运行。

1. 启动您的兼容 OpenAI 的服务器，并记下其基础 URL（通常以 `/v1` 结尾）
2. 选择 **OpenAI Compatible** 作为 LLM 提供商
3. 输入**基础 URL**（必填），例如 `http://your-server:8000/v1`。它必须能被 OneUptime 服务器访问，因此不能用 `localhost`——请参阅[为自托管模型选择基础 URL](#为自托管模型选择基础-url)
4. 输入**模型名称**（必填）——必须与您服务器上提供的模型匹配
5. 仅当您的服务器需要身份验证时才输入 **API 密钥**；无需密钥的服务器可留空

**示例配置（无需密钥的 vLLM）：**

```
Name: Self-Hosted vLLM
LLM Provider: OpenAI Compatible
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
3. 完成——vLLM 会在启动时自动注册为全局 LLM 提供商（`vllm.globalProvider.enabled`，默认值为 `true`），因此所有项目均可使用 AI 功能，包括 AI 修复任务。（无论是云端还是自托管，项目没有自己的提供商时，智能体的修复任务都会使用全局提供商；在云端，这部分用量按计量的 AI token 计费。项目自有的提供商始终优先。）

如果您禁用了自动注册（`vllm.globalProvider.enabled: false`），请手动创建提供商：

1. 选择 **OpenAI Compatible** 作为 LLM 提供商（vLLM 使用 OpenAI API）
2. 输入集群内基础 URL：`http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1`（如果您更改了 `global.clusterDomain`，请替换 `cluster.local`）
3. 输入模型名称：完整的 HuggingFace 模型 id（如果您设置了 `vllm.servedModelName`，则使用该值）
4. 仅当您设置了 `vllm.apiKey` 时才输入 API 密钥；无密钥的 vLLM 可留空

**示例配置：**

```
Name: In-Cluster vLLM
LLM Provider: OpenAI Compatible
Base URL: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Model Name: Qwen/Qwen2.5-1.5B-Instruct
API Key: (leave blank unless vllm.apiKey is set)
```

如果启用了计费，或设置了 `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`（在 Helm values 中为 `outboundConnections.blockPrivateNetwork: true`），项目自有的提供商就无法访问这个集群内地址，因为它会解析到集群的私有 IP。请改为在管理仪表板的 **设置** > **全局 LLM 提供商** 中，用相同的字段创建该提供商：全局 LLM 提供商可以访问这个地址。

有关 GPU 调度、受限模型和调优选项，请参阅 [Helm chart 的 vLLM 指南](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/ai-vllm.md)。

## 使用自定义基础 URL

对于企业部署或使用代理服务时，您可以指定自定义基础 URL：

- **Azure OpenAI**：使用您的 Azure 端点 URL
- **兼容 OpenAI 的 API**：任何遵循 OpenAI API 规范的 API
- **私有 Ollama 实例**：您的内部 Ollama 服务器 URL

## 最佳实践

1. **使用描述性名称**：清晰地命名您的提供商（例如"生产 OpenAI"、"开发 Ollama"）
2. **保护您的 API 密钥**：API 密钥在静态存储时已加密，但避免共享它们
3. **测试您的配置**：设置完成后，验证提供商是否能正常用于 AI 功能
4. **监控使用情况**：跟踪 API 使用情况以管理成本

## 故障排查

### 连接问题

- **OpenAI/Anthropic**：验证您的 API 密钥有效且有足够的额度
- **Ollama**：确保 Ollama 服务器正在运行、监听 OneUptime 服务器能访问的地址（原生安装请使用 `OLLAMA_HOST=0.0.0.0:11434`），并且基础 URL 指向该地址
- **OpenAI Compatible**：确保基础 URL 以 `/v1` 结尾（或与您的服务器匹配）、模型名称与您服务器提供的模型一致，并且仅在服务器需要时才设置 API 密钥
- **"…points to an address OneUptime is not allowed to connect to"**：基础 URL 解析到了被拒绝的地址——`localhost` 或其他回环地址，或者在 OneUptime Cloud 上是私有网络地址。（OneUptime Cloud 会把被拒绝的主机名报告为 "…could not be reached"。）请参阅[为自托管模型选择基础 URL](#为自托管模型选择基础-url)
- **防火墙**：检查您的网络是否允许出站连接到提供商的 API

### 找不到模型

- 验证模型名称拼写是否正确
- 对于 Ollama，确保已使用 `ollama pull <model-name>` 拉取该模型
- 检查该模型是否在您的地区可用（某些模型有地区限制）

### 上下文窗口过小

- **"…the request is larger than the model's context window"**：请求放不进模型的上下文窗口，通常是因为 AI 调查收集了大量证据。请在提供商的**附加参数**中增大 `num_ctx`，或在 Ollama 服务器上增大 `OLLAMA_CONTEXT_LENGTH`；请参阅[Ollama（自托管）](#ollama自托管)
- **"no user query found in messages"**：同一个问题，只是 Qwen 的报告方式。OneUptime 始终会发送问题；是 Ollama 为了让请求的其余部分放得下而丢弃了它

## 需要帮助？

如果您在设置 LLM 提供商时遇到问题，请：

1. 查看 [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) 了解已知问题
2. 如果您是企业计划用户，请联系支持团队
