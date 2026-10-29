# LLM Providers

An LLM provider is the model behind every AI feature in OneUptime: investigations, Ask AI, drafts and fix pull requests. This page shows which provider a feature uses, how to add your own (OpenAI, Azure OpenAI and Microsoft Foundry, Anthropic, Groq, Mistral, Ollama or any OpenAI-compatible server) and how to point OneUptime at a model you run yourself.

:::cards
- [Which provider AI uses](#which-provider-ai-uses): The project's default provider, else the global one.
- [Self-Hosted: Zero-Config via Environment Variables](#self-hosted-zero-config-via-environment-variables): One provider for every project, from the server's settings.
- [Setting Up an LLM Provider](#setting-up-an-llm-provider): Add a provider to a project, and test it.
- [Choosing a Base URL for a Self-Hosted Model](#choosing-a-base-url-for-a-self-hosted-model): An address the OneUptime server can reach.
:::

## What a provider powers

- **Investigations**: OneUptime AI investigates new incidents and alerts and posts a cited root cause analysis to the timeline. See [AI SRE](/docs/ai/ai-sre).
- **Questions**: **Ask AI** answers from your project's data, with a citation on every claim. See [Ask AI](/docs/ai/ask-ai).
- **Drafts**: **Draft with AI** in the notes of incidents, alerts and scheduled maintenance, and postmortems, drafted on request or when an incident resolves.
- **Code**: pull requests that fix exceptions, slow traces and the causes investigations find, from OneUptime or from GitHub. See [Code](/docs/ai/ai-agent).
- **Everything else**: AI Insights triage, the AI steps of workflows and runbooks, and answers in Slack and Microsoft Teams.

## Which provider AI uses

AI features use the project's default provider. A project with no default provider uses the global provider, when there is one. Ask AI can also switch a conversation to another of the project's providers, or a global one.

```mermaid title="Which provider an AI feature uses"
flowchart TB
    F["An AI feature<br/>needs a model"] --> D{"Does the project<br/>have a default<br/>provider?"}
    D -->|"yes"| P["The project's<br/>default provider"]
    D -->|"no"| G{"Is there a global<br/>provider?"}
    G -->|"yes"| GP["The global provider:<br/>AI credits on<br/>OneUptime Cloud"]
    G -->|"no"| N["Nothing runs, and<br/>the AI pages say<br/>a provider is missing"]
```

A provider is a project's default when **Set as Default** is on, which it is for every new provider. A project whose providers are all switched off as the default falls back to the global provider, as if it had none.

Every OneUptime AI rule — AI rules and postmortem rules — can pick a provider of its own instead, under its **More fields**: one of the project's providers or a global one, used for everything the rule starts. A rule that picks none uses the default provider, and a picked provider that can no longer be used falls back to it. See [Which LLM provider a rule uses](/docs/ai/ai-sre#which-llm-provider-a-rule-uses).

## OneUptime Cloud

On **OneUptime Cloud**, every project can use the global provider with no setup. It is ready for every AI feature, and is paid from the project's AI credits.

To use your own API keys or a particular model instead, add a provider of your own, as below: you are not charged for AI that runs on your own provider.

The Global LLM Provider is paid from the project's AI credits. To cap what AI may spend each day, set a **Daily AI Spend Limit (USD)** under **Project Settings → AI → AI Features → More settings**; a **Daily AI Token Limit** there caps tokens on any provider, your own included. See [the project's own daily limits](/docs/ai/ai-sre#the-projects-own-daily-limits).

OneUptime Cloud can only reach LLM endpoints on the public internet. It cannot connect to a model on your private network, such as a self-hosted Ollama or vLLM server. To use a model you run yourself, self-host OneUptime on a network that can reach it, or expose the model at a public endpoint: see [Choosing a Base URL for a Self-Hosted Model](#choosing-a-base-url-for-a-self-hosted-model).

## Self-Hosted: Zero-Config via Environment Variables

On a self-hosted instance, the fastest way to turn AI on for **every project at once** is to set the `GLOBAL_LLM_PROVIDER_*` environment variables on your OneUptime server: in `config.env` for Docker Compose, or through Helm values. At startup, OneUptime registers a Global LLM Provider from them and keeps it in step; no project has to set anything up, and AI fix tasks use it too when a project has no provider of its own.

| Variable | Description |
| --- | --- |
| `GLOBAL_LLM_PROVIDER_TYPE` | Required to turn it on. One of `OpenAI`, `AzureOpenAI`, `Anthropic`, `Groq`, `Mistral`, `Ollama`, `OpenAICompatible` |
| `GLOBAL_LLM_PROVIDER_API_KEY` | The API key: required for OpenAI, Azure OpenAI, Anthropic, Groq and Mistral; not needed for Ollama or a keyless OpenAI-compatible server |
| `GLOBAL_LLM_PROVIDER_BASE_URL` | The endpoint: required for Azure OpenAI, Ollama and OpenAI-compatible servers |
| `GLOBAL_LLM_PROVIDER_MODEL_NAME` | The model to use. Optional: left unset, OneUptime uses the provider's default model, and on an OpenAI-compatible server the first model the server lists |
| `GLOBAL_LLM_PROVIDER_NAME` | An optional friendly name, shown in the dashboard |

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

The sync is declarative: change a variable and the provider follows at the next restart; unset `GLOBAL_LLM_PROVIDER_TYPE` and the provider is removed. Global providers created by hand in the Admin Dashboard are never touched. A project can still add a provider of its own under **Project Settings → AI → LLM Providers**, and a provider the project owns always comes first.

## Supported Providers

| Provider | What it is for | API Key Required | Base URL Required |
| --- | --- | --- | --- |
| **OpenAI** | GPT-5.1 and the other OpenAI models | Yes | No (uses the default) |
| **Azure OpenAI / Microsoft Foundry** | Models you deploy in Microsoft Foundry or Azure OpenAI: OpenAI models, Foundry Models and Claude | Yes | Yes |
| **Anthropic** | Claude Sonnet 5.5, Claude Opus 5.5, Claude Haiku 5.5 and the other Claude models | Yes | No (uses the default) |
| **Groq** | Fast inference for Llama, Mixtral and other open models | Yes | No (uses the default) |
| **Mistral** | Mistral's hosted models | Yes | No (uses the default) |
| **Ollama** | Open-source models you run yourself, such as Llama 3.1, Mistral or Qwen | No | Yes |
| **OpenAI Compatible** | Any OpenAI-compatible server: vLLM, LocalAI, LM Studio and others | No (optional) | Yes |

## Setting Up an LLM Provider

:::steps
### Open LLM Providers

Go to **Project Settings → AI → LLM Providers** (the **AI** section of the side menu starts folded) and click **Create LLM Provider**.

### Pick the provider

On **Provider**, pick your **LLM Provider**: a card each for OpenAI, Anthropic, Azure OpenAI / Microsoft Foundry, Groq, Mistral, Ollama and any OpenAI-compatible server, each saying what it is in a line.

### Connect it

On **Connection**, the form asks only for what that provider uses, with its own help under each field:

- **API Key**: your API key, required for OpenAI, Azure OpenAI, Anthropic, Groq and Mistral and optional for an OpenAI-compatible server; Ollama is not asked for one
- **Base URL**: the endpoint, required for Azure OpenAI, Ollama and OpenAI Compatible; for the others, only to go through a proxy or a gateway
- **Model Name**: the model to use, such as `gpt-5.1`, `claude-sonnet-5-5` or `llama3.1`. Left empty, OneUptime uses the provider's default model; an OpenAI-compatible server has none, so OneUptime asks it which models it serves and uses the first one it lists
- **Name**: the provider's name until you type your own, such as "Production OpenAI" or "Local Ollama"
- **More fields**, folded under the fields above: a **Description**, **Set as Default**, which is on for a new provider because AI features only use the project's default provider, and **Additional Parameters**, an optional JSON object of extra parameters sent to the provider with every request (for example `{"temperature": 0.2}`)

**Who can see a provider.** A project's LLM providers are read only by its members who may read the project's settings: **Project Owner**, **Project Admin**, **Project Member**, **Viewer**, **Settings Admin**, **Settings Member**, **Settings Viewer** and **Read LLM**. A provider's **API Key** and **Additional Parameters** are read by the project's owners and admins alone, because the parameters are sent to the provider with every request and can carry a token or a header just like the key. The other members see whether any parameters are saved, not what they are. Members who may edit a provider can still replace its API Key or its parameters without reading them: in the edit form those fields start empty, and leaving one blank keeps what is stored. To remove the parameters, save `{}`. Only project owners and admins can change a provider's **Base URL**, because its API Key and Additional Parameters are sent to that address; the other members who may edit a provider can change everything else. Everyone who can read a provider can read its **Base URL**, so never put a key, a token or a password in it: use the **API Key**. The **Global LLM Providers** list on the same page - the shared providers a project falls back to - shows their name, description and price to anyone signed in, and nothing else about them.

### Test it

**Testing a provider.** **Test**, on the provider's page or in its row's menu, sends the provider a short prompt with its **API Key**, **Model Name**, **Base URL** and **Additional Parameters**, and says whether it answered and called a tool, which OneUptime's AI features need. A failed test says what to check first, then what the provider answered. Whoever may change a provider can test it: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member** and **Edit LLM**. Everyone else who can see the provider finds **Test** locked. A Global LLM Provider is tested by a server administrator, in the Admin Dashboard under **Settings → Global LLM Providers**.
:::

## Provider-Specific Configuration

### OpenAI

1. Get your API key from [OpenAI Platform](https://platform.openai.com/api-keys)
2. Select **OpenAI** as the LLM Provider
3. Enter your API key
4. Choose a model name:
   - `gpt-5.1` - Recommended default, strong at tool-calling and complex investigations
   - `gpt-5.1-mini` - Faster and more cost-effective

```text title="Example configuration"
Name: Production OpenAI
LLM Provider: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-5.1
```

OpenAI caches a prompt it has seen before on its own, and charges less for the part it reads back. OneUptime tells it which calls belong together: one prompt cache for each project and kind of AI work, sent as `prompt_cache_key`, so no project's prompts share a cache with another's and each call of an investigation reads back what the calls before it sent. If the server at the provider's **Base URL** refuses the field, OneUptime sends the request again without it and remembers that for the provider. [How tokens are counted](/docs/ai/ai-sre#how-tokens-are-counted) says how cached tokens count toward your limits.

### Anthropic

1. Get your API key from [Anthropic Console](https://console.anthropic.com/)
2. Select **Anthropic** as the LLM Provider
3. Enter your API key
4. Choose a model name:
   - `claude-sonnet-5-5` - Recommended default, best balance of intelligence, speed, and cost
   - `claude-opus-5-5` - More capable, for the hardest investigations
   - `claude-haiku-5-5` - Fastest and most cost-effective

```text title="Example configuration"
Name: Production Anthropic
LLM Provider: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-sonnet-5-5
```

Claude Opus 4.7 and every later Claude model choose their own sampling, and refuse a request that sets `temperature`, `top_p` or `top_k`. OneUptime leaves those settings out for these models. If a model refuses one anyway, OneUptime sends the request again without it and remembers that for the provider.

Claude 5 models think before they answer, and the thinking counts toward the reply's token limit, so OneUptime leaves room for it. To make them think less, and answer faster and for less, set `{"output_config": {"effort": "low"}}` in the provider's **Additional Parameters**. OneUptime sends the settings you add there to Anthropic with each request, except `model`, `messages`, `system`, `tools`, `tool_choice` and `stream`, which it sets itself.

OneUptime uses Anthropic's prompt caching. Each call of an investigation or an Ask AI answer sends the system prompt, the tools and the conversation so far again, and OneUptime marks them for the cache: a call pays a tenth of the price or less for what the calls before it sent, and a quarter more than the price for what is new, which it writes to the cache. If a gateway in front of Claude refuses the cache markers, OneUptime sends the request again without them and remembers that for the provider. [How tokens are counted](/docs/ai/ai-sre#how-tokens-are-counted) says how cached tokens count toward your limits.

### Azure OpenAI and Microsoft Foundry

Use **Azure OpenAI / Microsoft Foundry** for the models you deploy in Microsoft Foundry or Azure OpenAI: OpenAI models, other Foundry Models and Claude. Enter one of the resource's keys as the **API Key**, the deployment's name as the **Model Name**, and the resource's endpoint as the **Base URL**, such as `https://contoso-ai.openai.azure.com/openai/v1`. [Microsoft Foundry and Azure OpenAI](/docs/ai/microsoft-foundry) walks through the Azure side: the resource, permissions, the model deployment, network requirements and troubleshooting.

### Ollama (Self-Hosted)

Ollama runs open-source models on your own machines.

1. Install Ollama from [ollama.ai](https://ollama.ai)
2. Pull a model: `ollama pull llama3.1`
3. Make sure Ollama runs and the OneUptime server can reach it. A native install listens on `127.0.0.1` only, so start it with `OLLAMA_HOST=0.0.0.0:11434` to accept connections from other machines and containers (the official `ollama/ollama` Docker image already does this)
4. Select **Ollama** as the LLM Provider
5. Enter the Base URL: the Ollama server's address as the OneUptime server reaches it, such as `http://ollama:11434` (OneUptime adds `/api/chat` itself). `localhost` does not work: see [Choosing a Base URL for a Self-Hosted Model](#choosing-a-base-url-for-a-self-hosted-model)
6. Enter the model name you pulled

```text title="Ollama as a service named ollama on OneUptime's Docker Compose network"
Name: Self-Hosted Ollama
LLM Provider: Ollama
Base URL: http://ollama:11434
Model Name: llama3.1
```

**Raise the context window.** Unless told otherwise, Ollama sizes a model's context window by the GPU memory it finds: 4k tokens below 24 GiB, 32k up to 48 GiB and 256k above that (older releases use 2,048 or 4,096 tokens). OneUptime's AI features are agents. Every request carries their system prompt and tool definitions, more than 10,000 tokens before any question, and an AI investigation adds each query result to the conversation as it goes. When a request no longer fits, Ollama drops the oldest messages, and the question goes with them. Depending on the model and the Ollama release, the model then answers without the question or without its tools, or the request fails with "no user query found in messages" (Qwen 3.8 and later) or "the prompt is longer than the context length currently available to the model". OneUptime reports those failures as "…the request is larger than the model's context window" and does not run the investigation again. Set a larger `num_ctx` in the provider's **Additional Parameters**:

```json
{ "options": { "num_ctx": 65536 } }
```

OneUptime merges this `options` object into the options it sends to Ollama, so list only the settings you want to change. 65,536 tokens is what Ollama recommends for agents, and it covers most investigations. A long investigation can use more, because OneUptime only starts shortening old query results once the conversation passes roughly 75,000 tokens: use 131,072 if the model supports it and your GPU can hold it. A larger context window needs more memory, and `ollama ps` shows the context each loaded model got. To raise the default for every client instead, set `OLLAMA_CONTEXT_LENGTH` on the Ollama server. That is the only way when OneUptime reaches Ollama through its OpenAI-compatible `/v1` API (the **OpenAI Compatible** provider), which ignores `num_ctx`. For a global provider registered from `GLOBAL_LLM_PROVIDER_*` variables, set **Additional Parameters** in the Admin Dashboard under **Settings → Global LLM Providers**; the startup sync leaves that field alone.

**Popular Ollama models:**

- `llama3.1` - Meta's Llama 3.1 model, the oldest Llama with tool-calling support
- `llama3.3` - Meta's Llama 3.3 model
- `qwen2.5` - Alibaba's Qwen 2.5 model
- `mistral-nemo` - Mistral AI's Nemo model

> [!NOTE]
> OneUptime's AI features are agents: they lean heavily on tool calling. Use `llama3.1` or newer, or another model that calls tools. A small model, or one without tool calling (such as `llama2` or the original `llama3`), answers poorly: it cannot query your monitors, incidents or telemetry, so investigations come back empty or made up.

### Choosing a Base URL for a Self-Hosted Model

The Base URL of a self-hosted model, whether Ollama, vLLM, LM Studio or any other OpenAI-compatible server, must be an address the **OneUptime server** can reach. Your browser never connects to it.

**Loopback addresses are always refused.** Before connecting, OneUptime checks every address the Base URL's host name resolves to. `localhost`, `127.0.0.1`, `[::1]` and `0.0.0.0`, as well as link-local and cloud metadata addresses such as `169.254.169.254`, are refused in every deployment, self-hosted included. This is by design: a provider's Base URL must not be usable to reach services on the OneUptime server itself. Inside Docker Compose or Kubernetes, `localhost` would be the OneUptime container anyway, not the machine that runs your model.

Use a private address or an internal host name instead:

| Where the model server runs | Base URL |
| --- | --- |
| A service on OneUptime's Docker Compose network (`oneuptime`) | The service name, e.g. `http://ollama:11434` |
| The same Kubernetes cluster as OneUptime | The Service DNS name, e.g. `http://ollama.<namespace>.svc.cluster.local:11434`, the same pattern as the [bundled vLLM](#self-hosted-vllm-on-kubernetes-helm) |
| The host machine itself, outside any container | The host's LAN IP, e.g. `http://192.168.1.20:11434`, or `http://host.docker.internal:11434` on Docker Desktop |
| Another machine on your network | Its private IP or internal host name, e.g. `http://10.0.0.12:11434` |

OpenAI-compatible servers follow the same rules with their own port and `/v1` path, e.g. `http://vllm:8000/v1`, or `http://192.168.1.20:1234/v1` for LM Studio. Like a native Ollama install, LM Studio listens on `127.0.0.1` only until you turn on **Serve on Local Network** in its server settings.

**Private addresses work on self-hosted installs.** A self-hosted OneUptime can reach private network addresses, such as `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10` and IPv6 `fc00::/7`, unless you set `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`, which refuses them the way OneUptime Cloud does. That setting does not apply to a Global LLM Provider, which an administrator configures (with the `GLOBAL_LLM_PROVIDER_*` variables or in the Admin Dashboard) rather than a project: it can still reach private addresses. Loopback and link-local addresses stay refused for every provider.

**OneUptime Cloud (SaaS) cannot reach private networks.** It refuses private network addresses, and host names that resolve to them, for every LLM provider. To use a model that runs on your own infrastructure, either self-host OneUptime on a network that can reach it, or expose the model at a publicly reachable endpoint. Protect a public endpoint with an API key: the **Ollama** provider sends no credentials, while **OpenAI Compatible** sends the API Key as a bearer token (Ollama also serves an OpenAI-compatible API under `/v1`, so it can sit behind a reverse proxy that checks the key).

### OpenAI Compatible (vLLM, LocalAI, LM Studio, etc.)

Use the **OpenAI Compatible** provider for any server that implements the OpenAI `/chat/completions` API but is not OpenAI itself, for example [vLLM](https://docs.vllm.ai), [LocalAI](https://localai.io), [LM Studio](https://lmstudio.ai) or text-generation-webui. These usually run at your own address, often without authentication.

1. Start your OpenAI-compatible server and note its base URL (it usually ends in `/v1`)
2. Select **OpenAI Compatible** as the LLM Provider
3. Enter the **Base URL** (required), e.g. `http://your-server:8000/v1`. The OneUptime server must reach it, so not `localhost`: see [Choosing a Base URL for a Self-Hosted Model](#choosing-a-base-url-for-a-self-hosted-model)
4. Enter the **Model Name**, or leave it empty: OneUptime then asks your server which models it serves and uses the first one it lists, which on vLLM is the model it serves. A name you enter must match a model your server serves
5. Enter the **API Key** only if your server asks for one; leave it blank for a keyless server

```text title="A keyless vLLM"
Name: Self-Hosted vLLM
LLM Provider: OpenAI Compatible
Base URL: http://vllm.internal:8000/v1
Model Name: meta-llama/Llama-3.1-8B-Instruct
API Key: (leave blank)
```

> [!TIP]
> After saving, use the provider's **Test** to check the connection, the model name and the Base URL.

### Self-Hosted vLLM on Kubernetes (Helm)

If you self-host OneUptime with the Helm chart, you can run [vLLM](https://docs.vllm.ai), an OpenAI-compatible inference server, inside your cluster and serve local models on your own GPUs. No data leaves your infrastructure.

1. Turn it on in your Helm values (it needs NVIDIA GPU nodes):

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. Run `helm upgrade` and wait for the vLLM pod to be Ready (the first start downloads the model)
3. That's it — vLLM is registered automatically as a Global LLM Provider at startup (`vllm.globalProvider.enabled`, default `true`), so AI features work for all projects, including AI fix tasks. (Everywhere — Cloud and self-hosted — agent fix tasks use the global provider when the project owns no provider of its own; on Cloud that usage is billed as metered AI tokens. A project-owned provider always takes precedence.)

If you turned automatic registration off (`vllm.globalProvider.enabled: false`), create the provider by hand:

1. Select **OpenAI Compatible** as the LLM Provider (vLLM speaks the OpenAI API)
2. Enter the in-cluster Base URL: `http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1` (replace `cluster.local` if you changed `global.clusterDomain`)
3. Enter the Model Name: the full Hugging Face model id (or `vllm.servedModelName` if you set one), or leave it empty to use the model vLLM serves
4. Enter the API Key only if you set `vllm.apiKey`; leave it blank for a keyless vLLM

```text title="The in-cluster vLLM"
Name: In-Cluster vLLM
LLM Provider: OpenAI Compatible
Base URL: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Model Name: Qwen/Qwen2.5-1.5B-Instruct
API Key: (leave blank unless vllm.apiKey is set)
```

With billing on, or with `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true` (`outboundConnections.blockPrivateNetwork: true` in the Helm values), a project's own provider cannot reach this in-cluster address, which resolves to a private cluster IP. Create the provider in the Admin Dashboard under **Settings → Global LLM Providers** instead, with the same fields: a Global LLM Provider can reach that address.

See the [Helm chart's vLLM guide](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/ai-vllm.md) for GPU scheduling, gated models and tuning options.

## Good practice

- **Name providers clearly**, such as "Production OpenAI" or "Development Ollama", so a teammate knows which is which.
- **Keep keys in the API Key field.** API keys are encrypted at rest, and only project owners and admins read them.
- **Test after every change**, with the provider's **Test**.
- **Watch what AI costs.** Every call is listed with its tokens and cost under **Project Settings → AI → AI Logs**.

## Troubleshooting

:::details The provider cannot be reached
- **OpenAI or Anthropic**: check that your API key is valid and has credits
- **Azure OpenAI / Microsoft Foundry**: the error starts with what to change. [Microsoft Foundry and Azure OpenAI](/docs/ai/microsoft-foundry) explains each error Azure answers with
- **Ollama**: check that the Ollama server runs, listens on an address the OneUptime server can reach (`OLLAMA_HOST=0.0.0.0:11434` for a native install), and that the Base URL points at that address
- **OpenAI Compatible**: check that the Base URL ends in `/v1` (or matches your server), that the Model Name, if you entered one, matches a model your server serves, and that you set an API Key only if your server asks for one. If the Model Name is empty and the server lists no models at its `/models` endpoint, enter one
- **"…points to an address OneUptime is not allowed to connect to"**: the Base URL resolves to a refused address: `localhost` or another loopback address, or, on OneUptime Cloud, a private network address. (OneUptime Cloud reports a refused host name as "…could not be reached" instead.) See [Choosing a Base URL for a Self-Hosted Model](#choosing-a-base-url-for-a-self-hosted-model)
- **A firewall**: check that your network allows connections out to the provider's API
:::

:::details The model is not found
Check the model name's spelling. For Ollama, pull the model first with `ollama pull <model-name>`. Some models are only available in some regions.
:::

:::details The context window is too small
- **"…the request is larger than the model's context window"**: the request did not fit in the model's context window, usually because an AI investigation has collected a lot of evidence. Raise `num_ctx` in the provider's **Additional Parameters**, or `OLLAMA_CONTEXT_LENGTH` on the Ollama server; see [Ollama (Self-Hosted)](#ollama-self-hosted)
- **"no user query found in messages"**: the same problem, as Qwen reports it. OneUptime always sends the question; Ollama dropped it to make the rest of the request fit
:::

Still stuck? Look for your error in [OneUptime's GitHub issues](https://github.com/OneUptime/oneuptime/issues), or contact support if your plan includes it.

## Next steps

:::cards
- [Code](/docs/ai/ai-agent): Pull requests your provider writes, and where they start.
- [AI SRE](/docs/ai/ai-sre): What OneUptime AI does with the provider once it has one.
- [Ask AI](/docs/ai/ask-ai): Ask your project a question, and switch a conversation's provider.
:::
