# LLM 提供商

LLM 提供商是 OneUptime 中每项 AI 功能背后的模型：调查、询问 AI、草稿和修复拉取请求都依赖它。本页说明某项功能使用哪个提供商，如何添加你自己的提供商（OpenAI、Azure OpenAI 和 Microsoft Foundry、Anthropic、Groq、Mistral、Ollama，或任何兼容 OpenAI 的服务器），以及如何让 OneUptime 使用你自己运行的模型。

:::cards
- [AI 使用哪个提供商](#ai-使用哪个提供商): 项目的默认提供商，否则使用全局提供商。
- [自托管：通过环境变量零配置](#自托管通过环境变量零配置): 通过服务器的设置，为每个项目提供一个提供商。
- [设置 LLM 提供商](#设置-llm-提供商): 为项目添加提供商，并进行测试。
- [为自托管模型选择基础 URL](#为自托管模型选择基础-url): OneUptime 服务器能够访问的地址。
:::

## 提供商驱动的功能

- **调查**：OneUptime AI 调查新的事件和警报，并在时间线上发布带引用的根本原因分析。请参阅 [AI SRE](/docs/ai/ai-sre)。
- **问题**：**Ask AI** 根据你项目的数据作答，每个论断都附有引用。请参阅 [询问 AI](/docs/ai/ask-ai)。
- **草稿**：事件、警报和计划维护的备注中的 **Draft with AI**，以及按需或在事件解决时起草的事后复盘。
- **代码**：修复异常、慢追踪以及调查所发现原因的拉取请求，可从 OneUptime 或 GitHub 发起。请参阅 [代码](/docs/ai/ai-agent)。
- **其他一切**：AI Insights 的分诊、工作流和运行手册中的 AI 步骤，以及 Slack 和 Microsoft Teams 中的回答。

## AI 使用哪个提供商

AI 功能使用项目的默认提供商。没有默认提供商的项目会使用全局提供商（如果有的话）。询问 AI 还可以把会话切换到项目的另一个提供商，或某个全局提供商。

```mermaid title="AI 功能使用哪个提供商"
flowchart TB
    F["AI 功能<br/>需要一个模型"] --> D{"项目是否有<br/>默认提供商？"}
    D -->|"是"| P["项目的<br/>默认提供商"]
    D -->|"否"| G{"是否有<br/>全局提供商？"}
    G -->|"是"| GP["全局提供商：<br/>OneUptime Cloud<br/>上的 AI 额度"]
    G -->|"否"| N["什么都不运行，<br/>AI 页面提示<br/>缺少提供商"]
```

当 **设为默认** 开启时，提供商就是项目的默认提供商，每个新提供商都是如此。如果项目的所有提供商都关闭了这一项，项目就会回退到全局提供商，就像它没有任何提供商一样。

每条 OneUptime AI 规则——AI 规则和事后分析规则——都可以改为在 **更多字段** 中选择自己的提供商：项目的某个提供商或某个全局提供商，用于该规则启动的一切工作。不选择提供商的规则使用默认提供商，所选提供商不再能使用时也会回退到默认提供商。参见 [规则使用哪个 LLM 提供商](/docs/ai/ai-sre#规则使用哪个-llm-提供商)。

## OneUptime Cloud

在 **OneUptime Cloud** 上，每个项目都可以免配置使用全局提供商。它可用于每项 AI 功能，费用从项目的 AI 额度中支付。

如果想改用你自己的 API 密钥或某个特定模型，请按下文添加你自己的提供商：在你自己的提供商上运行的 AI 不会向你收费。

全局 LLM 提供商的费用从项目的 AI 额度中支付。要限制 AI 每天能花费的金额，请在 **项目设置 → 人工智能 → AI Features → 更多设置** 下设置 **每日 AI 支出限制 (USD)**；那里的 **每日 AI Token 限制** 会限制任何提供商上的令牌，包括你自己的提供商。请参阅 [项目自身的每日限制](/docs/ai/ai-sre#项目自身的每日限制)。

OneUptime Cloud 只能访问公共互联网上的 LLM 端点。它无法连接到你私有网络中的模型，例如自托管的 Ollama 或 vLLM 服务器。要使用你自己运行的模型，请在能够访问该模型的网络中自托管 OneUptime，或者把模型发布到公共端点：请参阅 [为自托管模型选择基础 URL](#为自托管模型选择基础-url)。

## 自托管：通过环境变量零配置

在自托管实例上，**一次为所有项目** 开启 AI 的最快方式，是在 OneUptime 服务器上设置 `GLOBAL_LLM_PROVIDER_*` 环境变量：Docker Compose 写在 `config.env` 中，Helm 则通过 values 设置。启动时，OneUptime 会据此注册一个全局 LLM 提供商并保持同步；任何项目都无需设置，没有自有提供商的项目，其 AI 修复任务也会使用它。

| 变量 | 说明 |
| --- | --- |
| `GLOBAL_LLM_PROVIDER_TYPE` | 开启时必需。取值为 `OpenAI`, `AzureOpenAI`, `Anthropic`, `Groq`, `Mistral`, `Ollama`, `OpenAICompatible` 之一 |
| `GLOBAL_LLM_PROVIDER_API_KEY` | API 密钥：OpenAI、Azure OpenAI、Anthropic、Groq 和 Mistral 必需；Ollama 或无密钥的 OpenAI 兼容服务器不需要 |
| `GLOBAL_LLM_PROVIDER_BASE_URL` | 端点：Azure OpenAI、Ollama 和 OpenAI 兼容服务器必需 |
| `GLOBAL_LLM_PROVIDER_MODEL_NAME` | 要使用的模型：OpenAI 兼容服务器必需，其他提供商建议设置 |
| `GLOBAL_LLM_PROVIDER_NAME` | 可选的友好名称，显示在仪表板中 |

:::tabs
@tab Ollama
```bash
GLOBAL_LLM_PROVIDER_TYPE=Ollama
# An address the OneUptime server can reach. Never localhost: see
# "Choosing a Base URL for a Self-Hosted Model" below.
GLOBAL_LLM_PROVIDER_BASE_URL=http://ollama:11434
GLOBAL_LLM_PROVIDER_MODEL_NAME=llama3.1
# No API key needed — Ollama is keyless.
```
@tab OpenAI
```bash
GLOBAL_LLM_PROVIDER_TYPE=OpenAI
GLOBAL_LLM_PROVIDER_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
GLOBAL_LLM_PROVIDER_MODEL_NAME=gpt-5.1
```
:::

同步是声明式的：修改变量后，提供商会在下次重启时随之更新；取消设置 `GLOBAL_LLM_PROVIDER_TYPE`，提供商就会被移除。在 Admin Dashboard 中手动创建的全局提供商永远不会被改动。项目仍然可以在 **项目设置 → 人工智能 → LLM 提供商** 下添加自己的提供商，并且项目拥有的提供商始终优先。

## 支持的提供商

| 提供商 | 用途 | 需要 API 密钥 | 需要基础 URL |
| --- | --- | --- | --- |
| **OpenAI** | GPT-5.1 以及其他 OpenAI 模型 | 是 | 否（使用默认值） |
| **Azure OpenAI / Microsoft Foundry** | 你在 Microsoft Foundry 或 Azure OpenAI 中部署的模型：OpenAI 模型、Foundry Models 和 Claude | 是 | 是 |
| **Anthropic** | Claude Sonnet 5.5、Claude Opus 5.5、Claude Haiku 5.5 以及其他 Claude 模型 | 是 | 否（使用默认值） |
| **Groq** | Llama、Mixtral 等开放模型的快速推理 | 是 | 否（使用默认值） |
| **Mistral** | Mistral 托管的模型 | 是 | 否（使用默认值） |
| **Ollama** | 你自己运行的开源模型，例如 Llama 3.1、Mistral 或 Qwen | 否 | 是 |
| **OpenAI Compatible** | 任何兼容 OpenAI 的服务器：vLLM、LocalAI、LM Studio 等 | 否（可选） | 是 |

## 设置 LLM 提供商

:::steps
### 打开 LLM 提供商

前往 **项目设置 → 人工智能 → LLM 提供商**（侧边菜单的 **人工智能** 部分默认是折叠的），然后点击 **创建LLM 提供商**。

### 选择提供商

在 **提供商** 中选择你的 **LLM 提供商**：OpenAI、Anthropic、Azure OpenAI / Microsoft Foundry、Groq、Mistral、Ollama 和任何 OpenAI 兼容服务器各有一张卡片，每张都用一行说明它是什么。

### 连接它

在 **连接** 中，表单只询问该提供商用到的内容，每个字段下方都有对应的帮助：

- **API 密钥**：你的 API 密钥，OpenAI、Azure OpenAI、Anthropic、Groq 和 Mistral 必需，OpenAI 兼容服务器可选；Ollama 不需要填写
- **基础 URL**：端点，Azure OpenAI、Ollama 和 OpenAI Compatible 必需；其他提供商仅在经由代理或网关时填写
- **模型名称**：要使用的模型，例如 `gpt-5.1`、`claude-sonnet-5-5` 或 `llama3.1`。留空时，OneUptime 使用提供商的默认模型；OpenAI 兼容服务器除外，它必须填写
- **名称**：在你输入自己的名称之前，沿用提供商的名称，例如 "Production OpenAI" 或 "Local Ollama"
- **更多字段**，折叠在上述字段下方：**描述**；**设为默认**，新提供商默认开启，因为 AI 功能只使用项目的默认提供商；以及 **附加参数**，一个可选的 JSON 对象，其中的额外参数会随每个请求发送给提供商（例如 `{"temperature": 0.2}`）

**谁可以看到提供商。** 项目的 LLM 提供商只有能读取项目设置的成员才能读取：**Project Owner**、**Project Admin**、**Project Member**、**Viewer**、**Settings Admin**、**Settings Member**、**Settings Viewer** 和 **Read LLM**。提供商的 **API 密钥** 和 **附加参数** 只有项目的所有者和管理员才能读取，因为参数会随每个请求发送给提供商，并且可能像密钥一样携带令牌或请求头。其他成员只能看到是否保存了参数，而看不到参数内容。可以编辑提供商的成员仍然可以在不读取的情况下替换其 API 密钥或参数：在编辑表单中这些字段一开始是空的，留空则保留已保存的值。要删除参数，请保存 `{}`。只有项目的所有者和管理员才能修改提供商的 **基础 URL**，因为它的 API 密钥和附加参数会被发送到该地址；其他可以编辑提供商的成员可以修改其余所有内容。任何能读取提供商的人都能读取它的 **基础 URL**，所以绝不要在其中放入密钥、令牌或密码：请使用 **API 密钥**。同一页面上的 **全局 LLM 提供商** 列表（项目回退使用的共享提供商）会向任何已登录的人显示它们的名称、描述和价格，此外不显示任何信息。

### 测试它

**测试提供商。** 提供商页面上或其所在行菜单中的 **测试**，会用提供商的 **API 密钥**、**模型名称**、**基础 URL** 和 **附加参数** 发送一个简短的提示，并告诉你它是否作出回应并调用了工具，这是 OneUptime 的 AI 功能所需要的。测试失败时，会先说明应检查什么，再说明提供商的回答。能修改提供商的人就能测试它：**Project Owner**、**Project Admin**、**Project Member**、**Settings Admin**、**Settings Member** 和 **Edit LLM**。其他能看到该提供商的人会发现 **测试** 处于锁定状态。全局 LLM 提供商由服务器管理员在 Admin Dashboard 的 **设置 → 全局 LLM 提供商** 下测试。
:::

## 各提供商的配置

### OpenAI

1. 从 [OpenAI Platform](https://platform.openai.com/api-keys) 获取 API 密钥
2. 选择 **OpenAI** 作为 LLM 提供商
3. 输入你的 API 密钥
4. 选择模型名称：
   - `gpt-5.1` - 推荐的默认值，擅长工具调用和复杂调查
   - `gpt-5.1-mini` - 更快、更经济

```text title="Example configuration"
Name: Production OpenAI
LLM Provider: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-5.1
```

### Anthropic

1. 从 [Anthropic Console](https://console.anthropic.com/) 获取 API 密钥
2. 选择 **Anthropic** 作为 LLM 提供商
3. 输入你的 API 密钥
4. 选择模型名称：
   - `claude-sonnet-5-5` - 推荐的默认值，在智能、速度和成本之间取得最佳平衡
   - `claude-opus-5-5` - 能力更强，适合最困难的调查
   - `claude-haiku-5-5` - 最快、最经济

```text title="Example configuration"
Name: Production Anthropic
LLM Provider: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-sonnet-5-5
```

Claude Opus 4.7 及之后的所有 Claude 模型会自行选择采样方式，并拒绝设置了 `temperature`、`top_p` 或 `top_k` 的请求。OneUptime 对这些模型不发送这些设置。如果某个模型仍然拒绝其中某项设置，OneUptime 会去掉它重新发送请求，并为该提供商记住这一点。

Claude 5 模型会先思考再回答，而思考会计入回复的令牌上限，所以 OneUptime 会为此留出空间。要让它们少思考、更快更省地回答，请在提供商的 **附加参数** 中设置 `{"output_config": {"effort": "low"}}`。OneUptime 会把你在那里添加的设置随每个请求发送给 Anthropic，但 `model`、`messages`、`system`、`tools`、`tool_choice` 和 `stream` 除外，这些由它自己设置。

OneUptime 使用 Anthropic 的提示缓存。调查或询问 AI 回答的每次调用都会重新发送系统提示、工具和到目前为止的对话，OneUptime 会将它们标记为可缓存：对于之前的调用已发送的内容，调用只需支付十分之一或更低的价格；对于新内容，调用会将其写入缓存，并支付比原价高四分之一的价格。 如果 Claude 前面的网关拒绝缓存标记，OneUptime 会不带标记重新发送请求，并为该提供商记住这一点。[如何计算 token](/docs/ai/ai-sre#如何计算-token) 说明了缓存的 token 如何计入你的限制。

### Azure OpenAI 和 Microsoft Foundry

对于你在 Microsoft Foundry 或 Azure OpenAI 中部署的模型（OpenAI 模型、其他 Foundry Models 和 Claude），请使用 **Azure OpenAI / Microsoft Foundry**。把资源的某个密钥填为 **API 密钥**，把部署名称填为 **模型名称**，把资源的端点填为 **基础 URL**，例如 `https://contoso-ai.openai.azure.com/openai/v1`。[Microsoft Foundry 和 Azure OpenAI](/docs/ai/microsoft-foundry) 介绍了 Azure 一侧的配置：资源、权限、模型部署、网络要求和故障排除。

### Ollama（自托管）

Ollama 在你自己的机器上运行开源模型。

1. 从 [ollama.ai](https://ollama.ai) 安装 Ollama
2. 拉取一个模型：`ollama pull llama3.1`
3. 确保 Ollama 正在运行，并且 OneUptime 服务器能访问到它。原生安装只监听 `127.0.0.1`，所以要用 `OLLAMA_HOST=0.0.0.0:11434` 启动它，以接受来自其他机器和容器的连接（官方的 `ollama/ollama` Docker 镜像已经这样做了）
4. 选择 **Ollama** 作为 LLM 提供商
5. 输入基础 URL：OneUptime 服务器访问 Ollama 服务器时使用的地址，例如 `http://ollama:11434`（OneUptime 会自行加上 `/api/chat`）。`localhost` 不可用：请参阅 [为自托管模型选择基础 URL](#为自托管模型选择基础-url)
6. 输入你拉取的模型名称

```text title="Ollama as a service named ollama on OneUptime's Docker Compose network"
Name: Self-Hosted Ollama
LLM Provider: Ollama
Base URL: http://ollama:11434
Model Name: llama3.1
```

**加大上下文窗口。** 除非另有设置，Ollama 会根据它找到的 GPU 内存来确定模型的上下文窗口大小：低于 24 GiB 时为 4k 令牌，48 GiB 以内为 32k，更高则为 256k（旧版本使用 2,048 或 4,096 个令牌）。OneUptime 的 AI 功能都是代理。每个请求都带有它们的系统提示和工具定义，在任何问题之前就超过 10,000 个令牌，而 AI 调查在进行过程中会把每个查询结果添加到会话中。当请求再也放不下时，Ollama 会丢弃最早的消息，问题也随之丢失。根据模型和 Ollama 版本的不同，模型随后会在没有问题或没有工具的情况下作答，或者请求会以 "no user query found in messages"（Qwen 3.8 及更高版本）或 "the prompt is longer than the context length currently available to the model" 失败。OneUptime 会把这些失败报告为 "…the request is larger than the model's context window"，并且不会再次运行调查。请在提供商的 **附加参数** 中设置更大的 `num_ctx`：

```json
{ "options": { "num_ctx": 65536 } }
```

OneUptime 会把这个 `options` 对象合并到它发送给 Ollama 的选项中，所以只需列出你想修改的设置。65,536 个令牌是 Ollama 为代理推荐的值，足以覆盖大多数调查。较长的调查可能会用得更多，因为 OneUptime 只有在会话超过大约 75,000 个令牌后才开始缩短旧的查询结果：如果模型支持且你的 GPU 容纳得下，请使用 131,072。更大的上下文窗口需要更多内存，`ollama ps` 会显示每个已加载模型获得的上下文。若要改为提高所有客户端的默认值，请在 Ollama 服务器上设置 `OLLAMA_CONTEXT_LENGTH`。当 OneUptime 通过 Ollama 兼容 OpenAI 的 `/v1` API（**OpenAI Compatible** 提供商）访问它时，这是唯一的办法，因为该 API 会忽略 `num_ctx`。对于通过 `GLOBAL_LLM_PROVIDER_*` 变量注册的全局提供商，请在 Admin Dashboard 的 **设置 → 全局 LLM 提供商** 下设置 **附加参数**；启动时的同步不会改动该字段。

**常用的 Ollama 模型：**

- `llama3.1` - Meta 的 Llama 3.1 模型，支持工具调用的最早的 Llama
- `llama3.3` - Meta 的 Llama 3.3 模型
- `qwen2.5` - Alibaba 的 Qwen 2.5 模型
- `mistral-nemo` - Mistral AI 的 Nemo 模型

> [!NOTE]
> OneUptime 的 AI 功能都是代理：它们高度依赖工具调用。请使用 `llama3.1` 或更新版本，或其他能调用工具的模型。小模型或不支持工具调用的模型（例如 `llama2` 或最初的 `llama3`）回答效果很差：它无法查询你的监视器、事件或遥测数据，因此调查结果会是空的或编造的。

### 为自托管模型选择基础 URL

自托管模型的基础 URL，无论是 Ollama、vLLM、LM Studio 还是其他任何兼容 OpenAI 的服务器，都必须是 **OneUptime 服务器** 能访问到的地址。你的浏览器从不连接它。

**回环地址总是被拒绝。** 在连接之前，OneUptime 会检查基础 URL 的主机名解析到的每一个地址。`localhost`、`127.0.0.1`、`[::1]` 和 `0.0.0.0`，以及 `169.254.169.254` 这样的链路本地地址和云元数据地址，在所有部署中都会被拒绝，自托管也不例外。这是有意为之：提供商的基础 URL 不能被用来访问 OneUptime 服务器自身上的服务。在 Docker Compose 或 Kubernetes 中，`localhost` 无论如何都会指向 OneUptime 容器，而不是运行你模型的机器。

请改用私有地址或内部主机名：

| 模型服务器运行的位置 | 基础 URL |
| --- | --- |
| OneUptime 的 Docker Compose 网络（`oneuptime`）中的服务 | 服务名称，例如 `http://ollama:11434` |
| 与 OneUptime 相同的 Kubernetes 集群 | Service 的 DNS 名称，例如 `http://ollama.<namespace>.svc.cluster.local:11434`，与 [内置的 vLLM](#在-kubernetes-上自托管-vllmhelm) 相同的模式 |
| 主机本身，在任何容器之外 | 主机的局域网 IP，例如 `http://192.168.1.20:11434`，在 Docker Desktop 上则为 `http://host.docker.internal:11434` |
| 你网络中的另一台机器 | 它的私有 IP 或内部主机名，例如 `http://10.0.0.12:11434` |

兼容 OpenAI 的服务器遵循相同的规则，使用各自的端口和 `/v1` 路径，例如 `http://vllm:8000/v1`，LM Studio 则为 `http://192.168.1.20:1234/v1`。与原生安装的 Ollama 一样，LM Studio 在你于其服务器设置中开启 **Serve on Local Network** 之前只监听 `127.0.0.1`。

**私有地址在自托管安装中可用。** 自托管的 OneUptime 可以访问私有网络地址，例如 `10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`、`100.64.0.0/10` 和 IPv6 `fc00::/7`，除非你设置了 `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`，它会像 OneUptime Cloud 一样拒绝这些地址。该设置不适用于全局 LLM 提供商，因为它由管理员（通过 `GLOBAL_LLM_PROVIDER_*` 变量或在 Admin Dashboard 中）而不是项目配置：它仍然可以访问私有地址。对每个提供商，回环地址和链路本地地址都始终被拒绝。

**OneUptime Cloud（SaaS）无法访问私有网络。** 对每个 LLM 提供商，它都会拒绝私有网络地址，以及解析到这些地址的主机名。要使用运行在你自己基础设施上的模型，要么在能访问该模型的网络中自托管 OneUptime，要么把模型发布到可公开访问的端点。请用 API 密钥保护公共端点：**Ollama** 提供商不发送任何凭据，而 **OpenAI Compatible** 会把 API 密钥作为 bearer 令牌发送（Ollama 也在 `/v1` 下提供兼容 OpenAI 的 API，所以它可以放在一个校验密钥的反向代理后面）。

### OpenAI Compatible（vLLM、LocalAI、LM Studio 等）

对于任何实现了 OpenAI `/chat/completions` API 但本身不是 OpenAI 的服务器，请使用 **OpenAI Compatible** 提供商，例如 [vLLM](https://docs.vllm.ai)、[LocalAI](https://localai.io)、[LM Studio](https://lmstudio.ai) 或 text-generation-webui。它们通常运行在你自己的地址上，而且往往没有身份验证。

1. 启动你的 OpenAI 兼容服务器，并记下它的基础 URL（通常以 `/v1` 结尾）
2. 选择 **OpenAI Compatible** 作为 LLM 提供商
3. 输入 **基础 URL**（必填），例如 `http://your-server:8000/v1`。OneUptime 服务器必须能访问到它，所以不能用 `localhost`：请参阅 [为自托管模型选择基础 URL](#为自托管模型选择基础-url)
4. 输入 **模型名称**（必填）：它必须与你的服务器提供的某个模型一致
5. 只有在你的服务器要求时才输入 **API 密钥**；对于无密钥的服务器请留空

```text title="A keyless vLLM"
Name: Self-Hosted vLLM
LLM Provider: OpenAI Compatible
Base URL: http://vllm.internal:8000/v1
Model Name: meta-llama/Llama-3.1-8B-Instruct
API Key: (leave blank)
```

> [!TIP]
> 保存后，使用提供商的 **测试** 检查连接、模型名称和基础 URL。

### 在 Kubernetes 上自托管 vLLM（Helm）

如果你用 Helm chart 自托管 OneUptime，就可以在集群内运行 [vLLM](https://docs.vllm.ai)（一个兼容 OpenAI 的推理服务器），在你自己的 GPU 上提供本地模型。任何数据都不会离开你的基础设施。

1. 在你的 Helm values 中开启它（需要 NVIDIA GPU 节点）：

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. 运行 `helm upgrade`，等待 vLLM 的 Pod 变为 Ready（首次启动会下载模型）
3. 就这样：vLLM 会在启动时自动注册为全局 LLM 提供商（`vllm.globalProvider.enabled`，默认 `true`），因此 AI 功能对所有项目都可用，包括 AI 修复任务。（在任何地方，无论云端还是自托管，当项目没有自有提供商时，代理的修复任务都会使用全局提供商；在云端，这部分用量按计量的 AI 令牌计费。项目拥有的提供商始终优先。）

如果你关闭了自动注册（`vllm.globalProvider.enabled: false`），请手动创建提供商：

1. 选择 **OpenAI Compatible** 作为 LLM 提供商（vLLM 使用 OpenAI API）
2. 输入集群内的基础 URL：`http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1`（如果你修改过 `global.clusterDomain`，请替换 `cluster.local`）
3. 输入模型名称：完整的 Hugging Face 模型 id（如果你设置了 `vllm.servedModelName`，则用它）
4. 只有在你设置了 `vllm.apiKey` 时才输入 API 密钥；对于无密钥的 vLLM 请留空

```text title="The in-cluster vLLM"
Name: In-Cluster vLLM
LLM Provider: OpenAI Compatible
Base URL: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Model Name: Qwen/Qwen2.5-1.5B-Instruct
API Key: (leave blank unless vllm.apiKey is set)
```

在开启计费的情况下，或设置了 `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`（Helm values 中的 `outboundConnections.blockPrivateNetwork: true`）时，项目自有的提供商无法访问这个集群内地址，因为它解析到一个私有的集群 IP。请改为在 Admin Dashboard 的 **设置 → 全局 LLM 提供商** 下用相同的字段创建提供商：全局 LLM 提供商可以访问该地址。

有关 GPU 调度、受限模型和调优选项，请参阅 [Helm chart 的 vLLM 指南](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/ai-vllm.md)。

## 最佳实践

- **为提供商起清晰的名称**，例如 "Production OpenAI" 或 "Development Ollama"，让队友知道哪个是哪个。
- **把密钥放在 API 密钥字段中。** API 密钥在存储时会被加密，只有项目的所有者和管理员能读取。
- **每次修改后都进行测试**，使用提供商的 **测试**。
- **留意 AI 的成本。** 每次调用及其令牌和成本都列在 **项目设置 → 人工智能 → AI 日志** 下。

## 故障排除

:::details 无法访问提供商
- **OpenAI 或 Anthropic**：检查你的 API 密钥是否有效并且有余额
- **Azure OpenAI / Microsoft Foundry**：错误信息会先说明需要修改什么。[Microsoft Foundry 和 Azure OpenAI](/docs/ai/microsoft-foundry) 解释了 Azure 返回的每种错误
- **Ollama**：检查 Ollama 服务器是否在运行，是否监听在 OneUptime 服务器能访问的地址上（原生安装使用 `OLLAMA_HOST=0.0.0.0:11434`），以及基础 URL 是否指向该地址
- **OpenAI Compatible**：检查基础 URL 是否以 `/v1` 结尾（或与你的服务器相符），模型名称是否与你的服务器提供的模型一致，以及是否只在服务器要求时才设置了 API 密钥
- **"…points to an address OneUptime is not allowed to connect to"**：基础 URL 解析到了被拒绝的地址：`localhost` 或其他回环地址，或者在 OneUptime Cloud 上是私有网络地址。（OneUptime Cloud 会把被拒绝的主机名报告为 "…could not be reached"。）请参阅 [为自托管模型选择基础 URL](#为自托管模型选择基础-url)
- **防火墙**：检查你的网络是否允许向提供商的 API 发起出站连接
:::

:::details 找不到模型
检查模型名称的拼写。对于 Ollama，请先用 `ollama pull <model-name>` 拉取模型。有些模型只在部分区域可用。
:::

:::details 上下文窗口太小
- **"…the request is larger than the model's context window"**：请求放不进模型的上下文窗口，通常是因为 AI 调查收集了大量证据。请在提供商的 **附加参数** 中提高 `num_ctx`，或在 Ollama 服务器上提高 `OLLAMA_CONTEXT_LENGTH`；请参阅 [Ollama（自托管）](#ollama自托管)
- **"no user query found in messages"**：同一个问题，这是 Qwen 的报告方式。OneUptime 总是会发送问题；是 Ollama 为了放下请求的其余部分而把它丢弃了
:::

还是没有解决？请在 [OneUptime 的 GitHub issues](https://github.com/OneUptime/oneuptime/issues) 中搜索你的错误，如果你的套餐包含支持服务，也可以联系支持。

## 后续步骤

:::cards
- [代码](/docs/ai/ai-agent): 你的提供商编写的拉取请求，以及它们从哪里开始。
- [AI SRE](/docs/ai/ai-sre): OneUptime AI 有了提供商之后会做什么。
- [询问 AI](/docs/ai/ask-ai): 向你的项目提问，并切换会话的提供商。
:::
