# 使用 OneUptime 实现 AI / LLM 可观测性

阅读 AI 进行过的每一段对话，按当时的节奏重新播放，并在 AI 回答不佳时收到通知。一切都基于标准 OpenTelemetry，无需专有 SDK：只要应用发出的 span 遵循 OpenTelemetry **GenAI 语义约定**（`gen_ai.*`），OneUptime 就会把它们变成对话、警报、用量和成本。

## 你将获得什么

在导航栏的“可观测性”下打开 **AI / LLM**：

- **对话** — AI 进行过的每一段对话：人们问了什么、AI 答了什么、用了哪些工具、哪里出了问题。列表上方有五个数字：对话数、AI 回答数、需要关注的数量、成本，以及一次回答通常需要多长时间。打开一段对话即可阅读或重新播放。
- **调用** — 每一次 LLM、嵌入、代理和工具调用，可按服务、提供商、模型、操作、人员和团队筛选。点击某次调用即可在追踪查看器中打开它。
- **用量** — 某个时间范围内的调用、token 和成本，以及谁花了多少：按支出排列的员工、团队、模型、提供商和应用。
- **警报** — 针对 AI 回答不佳的现成警报，以及你的 AI / LLM 监视器。
- **预算** — 每日成本上限，以指标形式发布，可在其上设置警报。
- **定价** — 你自己的按模型定价，用于内置目录不认识的模型。
- **设置** — 下面的五个步骤，以及你项目的端点。

在追踪查看器中，每次 AI 调用的 span 还有一个 **AI / LLM** 面板，显示模型、token 数、成本、请求参数，以及提示词和补全内容。

## 第 1 步 — 发送你的 AI 调用

创建一个遥测摄取密钥：打开 **项目设置 → 遥测与 APM → 摄取密钥**，然后点击 **创建摄取密钥**。你的应用会把该密钥作为 OTLP 请求头传递。（截图见 [OpenTelemetry 指南](/docs/telemetry/open-telemetry)。）

然后用任意 OpenTelemetry GenAI 库为应用添加埋点：

- **OpenLLMetry**（Traceloop）— OpenAI、Anthropic、Cohere、Bedrock、LangChain、LlamaIndex、CrewAI 等。
- **OpenInference**（Arize）— OpenAI、LangChain、LlamaIndex、DSPy 等。
- **Vercel AI SDK**，或适用于 OpenAI、Anthropic 和 Gemini 的 **OpenTelemetry 埋点库**。

你的 LLM 流量经过 **LiteLLM** 或 **Portkey** 之类的网关吗？从网关导出追踪即可，无需为每个应用埋点 — 参见 [观测 AI 网关](/docs/telemetry/ai-gateways)。在找工程师们使用的编程助手 — Claude Code、Cursor、Codex、Gemini CLI、Copilot？它们会导出自己的 OpenTelemetry，不需要你做任何事：参见 [AI 编程助手可观测性](/docs/telemetry/ai-coding-assistants)。

### Python (OpenLLMetry)

```bash
pip install traceloop-sdk opentelemetry-exporter-otlp
```

```python
from traceloop.sdk import Traceloop

Traceloop.init(
    app_name="my-ai-agent",
    api_endpoint="https://oneuptime.com/otlp",   # or your self-hosted host + /otlp
    headers={"x-oneuptime-token": "YOUR_INGESTION_TOKEN"},
)

# Your normal OpenAI / Anthropic / LangChain calls are now traced automatically.
```

### Node.js / TypeScript (OpenLLMetry)

```bash
npm install @traceloop/node-server-sdk
```

```ts
import * as traceloop from "@traceloop/node-server-sdk";

traceloop.initialize({
  appName: "my-ai-agent",
  baseUrl: "https://oneuptime.com/otlp", // or your self-hosted host + /otlp
  headers: { "x-oneuptime-token": "YOUR_INGESTION_TOKEN" },
});
```

### 纯 OpenTelemetry 环境变量

如果你使用原生 OpenTelemetry SDK 埋点，把 OTLP 导出器指向 OneUptime：

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_INGESTION_TOKEN"
export OTEL_SERVICE_NAME="my-ai-agent"
```

自托管 OneUptime？把 `https://oneuptime.com/otlp` 替换为 `https://YOUR-ONEUPTIME-HOST/otlp`。

## 第 2 步 — 记录说了什么

当你的埋点记录了内容时，对话会显示人们问了什么、AI 答了什么。OpenLLMetry 默认记录提示词和补全内容，除非你关闭它（`TRACELOOP_TRACE_CONTENT=false`）。OpenTelemetry 埋点库只在你要求时才记录：

```bash
export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true
```

没有这些内容时，对话仍会显示耗时、成本和问题，并说明内容未被记录。提示词可能包含敏感数据：要在存储前将其遮盖，请参见 [隐私与脱敏](#隐私与脱敏)。

## 第 3 步 — 把调用归入对话

聊天应用每一轮都会调用一次模型。在每次 AI 调用上把 `gen_ai.conversation.id`（或 `session.id`）设为你的聊天 ID，无论用了多少次调用和多少条追踪，每个聊天都会显示为一段对话。使用 OpenLLMetry 时，每个请求设置一次关联属性即可：

```python
from traceloop.sdk import Traceloop

Traceloop.set_association_properties({
    "session_id": chat.id,
    "user_email": user.email,
})
```

没有对话 ID 的调用也会显示，一次一个请求（一条追踪）。

## 第 4 步 — 说明是谁问的

设置 `user.id` 或 `user.email`（上面的关联属性会设置邮箱），就能看到每段对话的对象是谁、按人员搜索列表，并在“用量”标签页按员工对支出排序。[员工和团队归属](#员工和团队归属) 列出了 OneUptime 读取的每一个键。

## 第 5 步 — 标记不佳的回答

OneUptime 会在每个回答到达时检查它，并标出其中的问题：

| 问题     | 含义                                              | 判断依据                                                                                                                                       |
| -------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 失败     | 调用以错误结束，因此没有收到回答                  | span 状态为 Error、`error.type`，或结束原因为 `error`                                                                                          |
| 拒绝     | AI 拒绝了，或被安全过滤器拦截                     | 拒绝或安全类的结束原因（`content_filter`、`refusal`、`SAFETY` 等）、回答中的拒绝，或以常见英文拒绝语开头的回答                                 |
| 截断     | 回答在 token 上限处停止                           | 结束原因为 `length`、`max_tokens` 或 `MAX_TOKENS`                                                                                              |
| 空       | AI 的回答既没有文本也没有工具调用                 | 记录下来的内容为空，或输出 token 为 0                                                                                                          |
| 已标记   | 你的应用发送的评估认为该回答不佳                  | 一个 `gen_ai.evaluation.result` 事件                                                                                                           |

前四种无需你做任何事。要标记其余情况（被你的护栏、eval 或自有 LLM 评审拒绝的回答），请在该回答的 span 上添加一个 `gen_ai.evaluation.result` 事件，并把 `gen_ai.evaluation.score.label` 设为 `fail`：

```python
from opentelemetry import trace

trace.get_current_span().add_event(
    "gen_ai.evaluation.result",
    {
        "gen_ai.evaluation.name": "relevance",
        "gen_ai.evaluation.score.label": "fail",
        "gen_ai.evaluation.explanation": "The answer is about another product.",
    },
)
```

`incorrect`、`wrong`、`unhelpful`、`toxic`、`unsafe` 和 `hallucination` 等标签也算作不通过。该事件必须在所评判回答的 span 上，并且要在该 span 仍处于打开状态时添加。

OneUptime 从不把你的对话发送给另一个 AI 来评判：每项检查只读取调用本身携带的内容。

## 阅读和重新播放一段对话

对话会完整打开，就像聊天应用显示历史记录那样：对方说的话在右侧，AI 的回答在左侧并附有模型、时间、token 和成本，工具调用夹在中间，出错的地方在发生处标出。回答下方的 **详情** 会显示其结束原因和评估，并附有指向“追踪”中该次调用的链接。

底部的播放条会按对方经历的方式重新播放这段对话：

- **重新播放** 从第一条消息开始，按当时的节奏播放；当回答还在路上时，“AI 正在回答…”会持续计时。点击任意消息的时间即可从那里开始播放。
- **跳过等待** 默认开启，会缩短超过 3 秒的停顿。速度按钮可按 1×、2×、4× 或 8× 播放。
- **K** 播放或暂停，**J** 或 **←** 后退一条消息，**L** 或 **→** 前进一条。
- 地址会记住播放停在哪条消息（`?step=`），因此链接会在那一刻打开。

## AI 回答不佳时收到通知

**警报** 标签页提供了大多数 AI 应用需要的警报。选择其中一个会打开已填好的“创建监视器”，保存前你可以修改任何内容：

| 警报           | 何时通知你                                                                         |
| -------------- | ---------------------------------------------------------------------------------- |
| 回答出现问题   | 15 分钟内超过 5% 的回答失败、被拒绝、被截断、为空或被标记                          |
| AI 调用失败    | 5 分钟内超过 10% 的模型调用以错误结束                                              |
| AI 拒绝回答    | 30 分钟内超过 5% 的回答是拒绝                                                      |
| 回答被截断     | 30 分钟内有 3 个或更多回答停在 token 上限                                          |
| 回答被标记     | 有评估把某个回答标记为不佳                                                         |
| 回答变慢       | 15 分钟内超过 10% 的回答耗时超过 30 秒                                             |
| AI 停止回答    | AI 在 30 分钟内没有给出任何回答                                                    |

基于比例的警报还会等到至少有 3 个不佳回答，这样两个回答中有一个不佳时不会把人叫醒。

每个警报都是一个 **AI / LLM** 监视器。它的设置决定什么算作不佳回答（上面的问题、比你设定的上限更慢的回答，或两者兼有）、监视哪些应用和哪个模型，以及每次检查回看多久。设置下方的预览会显示监视器此刻会统计到什么。它的条件比较三个数字：**不佳回答的比例**（%）、**不佳回答的数量** 和 **回答的数量**。现成的警报会触发一个能自动解除的警报，并在回答不佳期间把监视器显示为“性能下降”；如果要呼叫某人，请改为开启它的事件。

支出由 [每日成本预算](#每日成本预算) 监视。

## OneUptime 识别的属性

OneUptime 优先读取 OpenTelemetry GenAI 约定，并回退到 OpenLLMetry 和 OpenInference 的变体，让常用库开箱即用。

| 内容                     | 主属性                       | 也接受                                                                                                                                                                                                                                                                    |
| ------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 提供商 / 系统            | `gen_ai.provider.name`       | `gen_ai.system`（约定中已弃用，但仍被广泛发送）、`llm.system`、`llm.provider`                                                                                                                                                                                            |
| 操作                     | `gen_ai.operation.name`      | `llm.request.type`、`openinference.span.kind`                                                                                                                                                                                                                             |
| 请求的模型               | `gen_ai.request.model`       | `llm.model_name`、`llm.request.model`                                                                                                                                                                                                                                     |
| 响应的模型               | `gen_ai.response.model`      | `llm.response.model`                                                                                                                                                                                                                                                      |
| 输入 token               | `gen_ai.usage.input_tokens`  | `gen_ai.usage.prompt_tokens`、`llm.token_count.prompt`、`llm.usage.prompt_tokens`                                                                                                                                                                                         |
| 输出 token               | `gen_ai.usage.output_tokens` | `gen_ai.usage.completion_tokens`、`llm.token_count.completion`、`llm.usage.completion_tokens`                                                                                                                                                                             |
| token 总数               | `gen_ai.usage.total_tokens`  | `llm.token_count.total`、`llm.usage.total_tokens`；都未上报时由输入 + 输出推算                                                                                                                                                                                           |
| 成本（USD）              | `gen_ai.usage.cost`          | `gen_ai.usage.cost_usd`、`gen_ai.usage.total_cost`、`llm.usage.total_cost`、`gen_ai.cost.total_cost`（LiteLLM）、`litellm.cost.total`                                                                                                                                     |
| 代理名称                 | `gen_ai.agent.name`          | `agent.name`                                                                                                                                                                                                                                                              |
| 工具名称                 | `gen_ai.tool.name`           | `tool.name`                                                                                                                                                                                                                                                               |
| 对话 / 会话 ID           | `gen_ai.conversation.id`     | `session.id`、`langfuse.session.id`、`traceloop.association.properties.session_id`                                                                                                                                                                                        |
| 员工（发起调用的人）     | `user.id`                    | `enduser.id`、`litellm.metadata.user_api_key_user_id` 和 `metadata.user_api_key_user_id`（LiteLLM OTel v2 和 v1 的写法，两者都会读取）、`traceloop.association.properties.user_id`、`langfuse.user.id`、`user.account_uuid`、`user.account_id`、`cursor.user.id` |
| 员工邮箱                 | `user.email`                 | `traceloop.association.properties.user_email`、`enduser.email`                                                                                                                                                                                                            |
| 团队 / 成本中心          | `team.id`                    | `team`、`cost_center`、`department`、`litellm.metadata.user_api_key_team_id` 和 `litellm.team.id`（LiteLLM OTel v2）、`metadata.user_api_key_team_id`（LiteLLM OTel v1）、`cursor.team.id`                                                                                |

`traceloop.association.properties.*` 下的子键 **由调用方提供**：Traceloop 定义前缀，你的代码提供其下的内容。`gen_ai.usage.total_tokens` 和 `gen_ai.usage.cost` 是 **事实标准** 的键，而不是 GenAI 语义约定 — 约定既没有定义 token 总数属性，也没有定义成本属性 — OneUptime 读取它们，是因为常见的埋点库会发送它们。`gen_ai.system` 是约定自身为 `gen_ai.provider.name` 设立的已弃用前身；两者都会读取。

**三行身份属性也会带 `resource.` 前缀进行匹配。** OTLP 摄取会把每个 _资源_ 属性以 `resource.` 前缀展开到 span 的属性映射中，因此 `OTEL_RESOURCE_ATTRIBUTES=team.id=platform` 到达时是 `resource.team.id`。OneUptime 先查找整个不带前缀的列表，再查找整个 `resource.` 列表，所以 span 属性（描述一次调用）优先于资源属性（描述整个进程）。其他行只按不带前缀的键匹配：它们是每次调用各自的值。

**提示词和补全内容** 从以下位置读取：`gen_ai.client.inference.operation.details` 事件；span 属性 `gen_ai.input.messages`、`gen_ai.output.messages` 和 `gen_ai.system_instructions`；旧版埋点库仍在发送的 **已弃用** 按角色事件（`gen_ai.system.message`、`gen_ai.user.message`、`gen_ai.tool.message`、`gen_ai.assistant.message`、`gen_ai.choice`）；带索引的属性（`gen_ai.prompt.N.content` 和 `gen_ai.completion.N.content`，以及 OpenInference 的 `llm.input_messages.N.message.content` 和 `llm.output_messages.N.message.content`）；以及 JSON 消息数组（`gen_ai.prompt`、`gen_ai.completion`、`input.value`、`output.value`）。

### 成本如何计算

如果你的埋点上报了成本（`gen_ai.usage.cost`），OneUptime 会原样使用：上报的值始终优先。没有上报成本时，OneUptime 会根据 span 的 token 数和内置的标价目录计算 **摄取时的估算成本**，该目录涵盖 OpenAI、Anthropic、Google Gemini、Mistral、DeepSeek、xAI、Cohere、Amazon Nova 和 Meta Llama 的常见模型。模型按名称前缀匹配，因此像 `gpt-4o-2024-08-06` 这样带日期的快照和像 `us.anthropic.claude-3-5-sonnet-20241022-v2:0` 这样带厂商修饰的 ID 都能正确识别。未知或自定义模型从不猜测 — 在你于 **定价** 标签页为其设置价格之前，它们的成本保持为 `0`。估算使用标价，不考虑缓存或批处理折扣。

自托管 OneUptime？目录位于 `packages/Common/Types/Telemetry/LlmCostCatalog.ts`。

## 员工和团队归属

“上个月是哪位工程师在 Opus 上花了 4000 美元？”是一个关于人的问题，除非 span 上有内容指明某个人，否则没有任何 LLM span 能回答它。OneUptime 在摄取时把发起操作的人复制到可查询的列中，所以你可以按列分组和筛选，而不用编写属性查找。

上表中的三行身份属性就是整个机制；按列出的顺序，第一个存在的键胜出。`user.id` 排在最前，因为它是 OpenTelemetry 中表示人类操作者的规范键，也是你自行设置身份时应统一采用的键。**有一个例外：Claude Code** 发送的 `user.id` 是保存在 `~/.claude.json` 中的随机匿名标识符，而不是某个人。在它的指标数据点上这无关紧要，因为那里的列表以邮箱优先；但如果你启用了 Claude Code 的追踪测试版，span 上匿名的 `user.id` 会排在 `user.email` 之前：请在该批设备的采集器处理器中删除或重新映射 `user.id`。`enduser.id` 仍是语义约定中的有效属性，作为同等别名被接受。`cursor.user.id` 排在最后，因为它是一个不透明的、限定于团队的整数，需要借助 Cursor 的管理 API 才能对应到具体的人。

身份只会在已被识别为 LLM 调用的 span 上读取：`user.id`、`user.email` 和 `team.id` 是通用键，浏览器和普通后端的 span 也会携带。**指标数据点** 携带一个更短、以邮箱优先的列表 — `user.email`、`user.id`、`user.account_uuid`、`user.account_id`、`cursor.user.id`，团队则来自 `team.id`、`team`、`cost_center`、`department` 和 `cursor.team.id`，每个也都会带 `resource.` 前缀匹配 — 因为只发送指标而不发送 span 的编程代理 CLI 会原生发送 `user.email`。目前没有任何功能从 **日志记录** 中读取身份。

### 设置团队和成本中心

没有任何埋点库会发送 `team.id`、`team`、`cost_center` 或 `department`：它们由你的组织设置，通常通过进程上的 `OTEL_RESOURCE_ATTRIBUTES` 设置：

```bash
export OTEL_RESOURCE_ATTRIBUTES="team.id=platform,team=Platform_Engineering,cost_center=eng-123,department=engineering"
```

它们以 `resource.team.id`、`resource.team`、`resource.cost_center` 和 `resource.department` 的形式到达 OneUptime；无论你的导出器把这些键留在 OTLP 资源块中，还是复制到每个 span 上（Claude Code 属于后者），这两个层级在 span 和指标数据点上都能被识别。直接设置在 span 上、不带前缀的 `team.id` 仍然优先。

网关的写法无需你做任何配置即可到达。LiteLLM 在两种 OpenTelemetry 模式下给属性起的名字不同 — 默认的 v1 `otel` 回调使用裸的 `metadata.` 前缀（`metadata.user_api_key_user_id`、`metadata.user_api_key_user_email`、`metadata.user_api_key_team_id`），可选启用的 v2 模式（`LITELLM_OTEL_V2=true`）使用 `litellm.` 命名空间 — **OneUptime 两者都会读取**。

### 有意排除客户相关的键

一个 LLM span 可能携带 **两个** 不同的人：发起调用的员工，以及这次调用所服务的下游 **客户**。以下键携带的是客户，OneUptime 有意 **一个都不** 读入身份列：

- `gen_ai.user` 和 `llm.user` — 埋点库对 OpenAI 请求参数 `user` 的回显，OpenAI 将其描述为“a stable identifier for your end-users”（现已弃用，改用 `safety_identifier` 和 `prompt_cache_key`）。
- `litellm.metadata.user_api_key_end_user_id`、`metadata.user_api_key_end_user_id` 和 `litellm.end_user.id` — LiteLLM 三种写法下的显式终端用户 ID，与密钥所有者 ID 不同；密钥所有者 ID **就是** 员工，**会被** 读取。

原因在于成本分摊的正确性：如果把客户 ID 读入员工列，一个服务 40000 名客户的客服机器人就会凭空造出 40000 名“员工”，而真正拥有这笔支出的工程师看起来却一分钱没花。这些属性保留在原始属性映射中，你可以直接查询它们。

### 身份列会被清理

员工邮箱列保存的是真实的个人数据。你在 **属性** 范围下的遥测 **清理规则** 对该列的作用与对其来源属性的作用完全相同，因此脱敏邮箱的规则同样适用于该列。请在 **追踪 → 设置** 下配置清理规则和丢弃过滤器。

## span 和指标是回退，而不是相加

**GenAI span 是权威来源。只有当 span 流什么都没有上报时才会参考指标流，两者从不相加。** 一个 span 在一行中携带模型、token 和成本，因此只要有 span，它就能回答任何问题。没有 span 的地方 — 编程代理 CLI 只发布 token 和成本的 _指标_，不发送 GenAI span — 由指标流顶上。之所以不相加，是因为很多埋点库会为同一次调用同时发送两种信号（OpenLLMetry 就是常见的例子），相加会把每一美元算两次。

需要提前考虑的后果：**一旦你的 GenAI span 上报了非零值，仅有指标的来源对该值的贡献就不会显示。** 回退是按数值、按细分进行的，而不是按发送方：

| 位置                                   | 回退到指标的内容                                     | 条件                                  |
| -------------------------------------- | ---------------------------------------------------- | ------------------------------------- |
| 用量 → 输入 token / 输出 token         | 输入和输出 token 的合计                              | span 的两项 token 合计都为 0          |
| 用量 → 成本（USD）                     | 成本，以 USD 和微 USD 计，换算后相加                 | span 的成本合计为 0                   |
| 用量 → LLM 调用                        | 无 — 仅 span                                         | —                                     |
| 用量 → 员工、团队、模型                | 仅成本。调用和 token 列显示为 `—`                    | 该细分没有返回任何 span 行            |
| 用量 → 提供商、应用 / 服务             | 无 — 仅 span                                         | —                                     |
| 对话                                   | 无 — 对话由 span 构建                                | —                                     |

“提供商”和“应用 / 服务”没有指标回退，因为编程代理的计数器不携带 GenAI 提供商属性，也不关联任何 OneUptime 遥测服务。凡是来自指标的数值，页面都会标注 **来自 GenAI 指标**，因为来自指标的数值在“调用”列表中没有对应的行。

**如果你需要单独查看某个仅有指标的工具的支出，请给它一个单独的项目**，这样它的 span 流才会真正为空，回退才会生效。预算也是如此：按服务分别设置预算，而不是把发送 span 的服务和仅发送指标的服务混在一起。

## 仪表盘和指标警报

GenAI 指标以普通 OpenTelemetry 指标的形式到达，因此你可以构建绘制 `gen_ai.client.token.usage`、`gen_ai.client.operation.duration` 等指标的 **仪表盘**，并在其上创建 **指标监视器** — 例如当 `gen_ai.client.operation.duration` 的 p95 按模型分组后超过阈值时。参见 [指标监控](/docs/monitor/metrics-monitor)。

## 每日成本预算

**预算** 标签页设置以 USD 计的每日上限，按 UTC 自然日评估。后台工作进程每 15 分钟汇总一次当天 LLM span 的成本（上报的或计算的），记录到预算上，并发布两个 gauge 指标：

| 指标                                | 含义                                   |
| ----------------------------------- | -------------------------------------- |
| `oneuptime.llm.budget.spend.usd`    | 当天到目前为止的支出，单位 USD         |
| `oneuptime.llm.budget.percent.used` | 支出占每日上限的百分比                 |

两者都带有 `oneuptime.llm.budget.id` 和 `oneuptime.llm.budget.name` 属性，若设置了预算的服务、提供商和模型范围，也会一并携带。请按稳定的 **`oneuptime.llm.budget.id`** 筛选监视器；重命名预算时名称会改变。

**警报通过针对这些指标的 [指标监控](/docs/monitor/metrics-monitor) 实现。** 对于经典的 80% / 100% 模式，在 `oneuptime.llm.budget.percent.used` 上创建一个监视器，按 `oneuptime.llm.budget.id` 筛选，并添加两个条件：`>= 80` 创建警告级警报，`>= 100` 创建严重级警报。**把监视器的滚动时间设为 30 分钟**：预算每 15 分钟才发布一个点，所以默认的 1 分钟窗口在两次汇总之间只会看到空序列。

预算可以限定到某个遥测服务、某个 LLM 提供商或某个确切的模型，也可以覆盖整个项目，并且可以同时存在多个。预算监视器还可以调用一个工作流来停止失控的代理 — 参见 [为失控的 AI 代理设置熔断](/docs/telemetry/ai-agent-circuit-breaker)。

## 隐私与脱敏

提示词和补全内容可能包含敏感数据。OneUptime 会像对待其他任何追踪一样，把你的遥测 **清理规则** 和 **丢弃过滤器** 应用到 LLM span 上，因此你可以在存储前遮盖属性或丢弃 span；请在 **追踪 → 设置** 下配置它们。员工邮箱列也受同样的规则约束 — 参见 [身份列会被清理](#身份列会被清理)。

读取对话需要与读取追踪相同的权限：能读取项目追踪的人就能读取它的对话，其他人则不能。

## 相关内容

- [AI 编程助手可观测性](/docs/telemetry/ai-coding-assistants) — Claude Code、Cursor、Codex、Gemini CLI、Copilot、Cline 等工具的支持矩阵，以及按员工统计的支出如何跨这些工具运作。
- [监控 Claude Code](/docs/telemetry/claude-code)
- [监控 Cursor](/docs/telemetry/cursor)
- [监控 OpenAI Codex CLI](/docs/telemetry/openai-codex)
- [监控 Gemini CLI 和 GitHub Copilot](/docs/telemetry/gemini-cli-and-copilot)
- [观测 AI 网关（LiteLLM 和 Portkey）](/docs/telemetry/ai-gateways)
- [为失控的 AI 代理设置熔断](/docs/telemetry/ai-agent-circuit-breaker)
