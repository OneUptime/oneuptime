# LLM Providers

OneUptime supports integrating with various Large Language Model (LLM) providers to enable AI-powered features throughout the platform. This guide will help you configure your own LLM provider.

## What Can LLM Providers Do?

LLM Providers in OneUptime help you automate and enhance your incident management workflow:

- **Autonomous Investigations**: Automatically investigate new incidents and alerts and post a cited root cause analysis to the timeline — see [AI SRE](/docs/ai/ai-sre)
- **Incident Notes**: Automatically generate detailed incident notes and updates
- **Alert Notes**: Create meaningful alert descriptions and context
- **Scheduled Maintenance Notes**: Generate maintenance event notes automatically
- **Incident Postmortems**: Automatically draft comprehensive incident postmortem reports
- **Code Improvements**: If you connect your code repository to OneUptime, we will use your LLM Provider to analyze telemetry data (logs, traces, metrics, exceptions) and suggest code improvements

## OneUptime SaaS Users

If you are using **OneUptime SaaS** (cloud-hosted version), you can use the **Global LLM Provider** by default without any additional configuration. The Global LLM Provider is pre-configured and ready to use for all AI features.

If you prefer to use your own API keys or a specific provider, you can still configure a custom LLM Provider following the instructions below.

The Global LLM Provider is paid from the project's AI credits. To cap what AI may spend each day, set a **Daily AI Spend Limit (USD)** under **Project Settings → AI Features → More settings**; a **Daily AI Token Limit** there caps tokens on any provider, your own included. See [the project's own daily limits](/docs/ai/ai-sre#the-projects-own-daily-limits).

OneUptime SaaS can only reach LLM endpoints on the public internet. It cannot connect to a model on your private network, such as a self-hosted Ollama or vLLM server. To use a model you run yourself, self-host OneUptime on a network that can reach it, or expose the model at a public endpoint — see [Choosing a Base URL for a Self-Hosted Model](#choosing-a-base-url-for-a-self-hosted-model).

## Self-Hosted: Zero-Config via Environment Variables

On a self-hosted instance, the fastest way to enable AI features for **every project at once** is to set the `GLOBAL_LLM_PROVIDER_*` environment variables on your OneUptime server — in `config.env` for Docker Compose, or through Helm values. At startup, OneUptime registers (and keeps in sync) a Global LLM Provider from them; no per-project dashboard setup is needed, and AI fix tasks use it too when a project has no provider of its own.

| Variable                         | Description                                                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GLOBAL_LLM_PROVIDER_TYPE`       | Required to enable. One of: `OpenAI`, `AzureOpenAI`, `Anthropic`, `Groq`, `Mistral`, `Ollama`, `OpenAICompatible` |
| `GLOBAL_LLM_PROVIDER_API_KEY`    | API key — required for OpenAI, Azure OpenAI, Anthropic, Groq, and Mistral; not needed for Ollama or keyless OpenAI-compatible servers |
| `GLOBAL_LLM_PROVIDER_BASE_URL`   | API endpoint — required for Azure OpenAI, Ollama, and OpenAI-compatible servers                                    |
| `GLOBAL_LLM_PROVIDER_MODEL_NAME` | Model to use (required for OpenAI-compatible servers, recommended elsewhere)                                       |
| `GLOBAL_LLM_PROVIDER_NAME`       | Optional friendly name shown in the dashboard                                                                      |

**Example: self-hosted Ollama**

```bash
GLOBAL_LLM_PROVIDER_TYPE=Ollama
# An address the OneUptime server can reach. Never localhost: see
# "Choosing a Base URL for a Self-Hosted Model" below.
GLOBAL_LLM_PROVIDER_BASE_URL=http://ollama:11434
GLOBAL_LLM_PROVIDER_MODEL_NAME=llama3.1
# No API key needed — Ollama is keyless.
```

**Example: OpenAI**

```bash
GLOBAL_LLM_PROVIDER_TYPE=OpenAI
GLOBAL_LLM_PROVIDER_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
GLOBAL_LLM_PROVIDER_MODEL_NAME=gpt-5.1
```

The sync is declarative: changing the variables updates the provider on the next restart, and unsetting `GLOBAL_LLM_PROVIDER_TYPE` removes it. Global providers created manually in the Admin Dashboard are never touched. Projects can still add their own provider under **Project Settings** > **AI** > **LLM Providers** — a project-owned provider always takes precedence over the global one.

## Supported Providers

OneUptime currently supports the following LLM providers:

| Provider              | Description                                                                   | API Key Required | Base URL Required |
| --------------------- | ----------------------------------------------------------------------------- | ---------------- | ----------------- |
| **OpenAI**            | GPT-5.1 and other OpenAI models                                               | Yes              | No (uses default) |
| **Azure OpenAI**      | OpenAI models hosted on your Azure deployment                                 | Yes              | Yes               |
| **Anthropic**         | Claude Sonnet 5.5, Claude Opus 5.5, Claude Haiku 5.5, and other Claude models | Yes              | No (uses default) |
| **Groq**              | Fast inference for Llama, Mixtral, and other open models                      | Yes              | No (uses default) |
| **Mistral**           | Mistral's hosted models                                                       | Yes              | No (uses default) |
| **Ollama**            | Self-hosted open-source models like Llama 3.1, Mistral, Qwen, etc.            | No               | Yes               |
| **OpenAI Compatible** | Any OpenAI-compatible server (vLLM, LocalAI, LM Studio, etc.)                 | No (optional)    | Yes               |

## Setting Up an LLM Provider

### Step 1: Navigate to LLM Providers Settings

1. Log in to your OneUptime dashboard
2. Go to **Project Settings** > **AI** > **LLM Providers**
3. Click **Create LLM Provider** to add a new provider

### Step 2: Configure Your Provider

Fill in the following fields:

- **Name**: A friendly name for this LLM configuration (e.g., "Production OpenAI", "Local Ollama")
- **Description** (optional): A description to help identify the purpose of this provider
- **LLM Provider**: Select the provider type (OpenAI, Azure OpenAI, Anthropic, Groq, Mistral, Ollama, or OpenAI Compatible)
- **API Key**: Your API key (required for OpenAI, Azure OpenAI, Anthropic, Groq, and Mistral; optional for Ollama and OpenAI-compatible servers)
- **Model Name**: The specific model to use (e.g., `gpt-5.1`, `claude-sonnet-5-5`, `llama3.1`)
- **Base URL** (optional): Custom API endpoint URL (required for Azure OpenAI, Ollama, and OpenAI Compatible; optional for others)
- **More fields**, folded under the fields above: **Set as Default**, which is on for a new provider because AI features only use the project's default provider, and **Additional Parameters**, an optional JSON object of extra parameters sent to the provider with every request (for example `{"temperature": 0.2}`)

**Who can see a provider.** A project's LLM providers are read only by its members who may read the project's settings: **Project Owner**, **Project Admin**, **Project Member**, **Viewer**, **Settings Admin**, **Settings Member**, **Settings Viewer** and **Read LLM**. A provider's **API Key** and **Additional Parameters** are read by the project's owners and admins alone, because the parameters are sent to the provider with every request and can carry a token or a header just like the key. The other members see whether any parameters are saved, not what they are. Members who may edit a provider can still replace its API Key or its parameters without reading them: in the edit form those fields start empty, and leaving one blank keeps what is stored. Everyone who can read a provider can read its **Base URL**, so never put a key, a token or a password in it: use the **API Key**. The **Global LLM Providers** list on the same page - the shared providers a project falls back to - shows their name, description and price to anyone signed in, and nothing else about them.

## Provider-Specific Configuration

### OpenAI

1. Get your API key from [OpenAI Platform](https://platform.openai.com/api-keys)
2. Select **OpenAI** as the LLM Provider
3. Enter your API key
4. Choose a model name:
   - `gpt-5.1` - Recommended default, strong at tool-calling and complex investigations
   - `gpt-5.1-mini` - Faster and more cost-effective

**Example Configuration:**

```
Name: Production OpenAI
LLM Provider: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-5.1
```

### Anthropic

1. Get your API key from [Anthropic Console](https://console.anthropic.com/)
2. Select **Anthropic** as the LLM Provider
3. Enter your API key
4. Choose a model name:
   - `claude-sonnet-5-5` - Recommended default, best balance of intelligence, speed, and cost
   - `claude-opus-5-5` - More capable, for the hardest investigations
   - `claude-haiku-5-5` - Fastest and most cost-effective

**Example Configuration:**

```
Name: Production Anthropic
LLM Provider: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-sonnet-5-5
```

Claude Opus 4.7 and every later Claude model choose their own sampling, and refuse a request that sets `temperature`, `top_p` or `top_k`. OneUptime leaves those settings out for these models. If a model refuses one anyway, OneUptime sends the request again without it and remembers that for the provider.

Claude 5 models think before they answer, and the thinking counts toward the reply's token limit, so OneUptime leaves room for it. To make them think less, and answer faster and for less, set `{"output_config": {"effort": "low"}}` in the provider's **Additional Parameters**. OneUptime sends the settings you add there to Anthropic with each request, except `model`, `messages`, `system`, `tools`, `tool_choice` and `stream`, which it sets itself.

### Ollama (Self-Hosted)

Ollama allows you to run open-source LLMs locally or on your own infrastructure.

1. Install Ollama from [ollama.ai](https://ollama.ai)
2. Pull your desired model: `ollama pull llama3.1`
3. Ensure Ollama is running and reachable from the OneUptime server. A native install listens on `127.0.0.1` only, so start it with `OLLAMA_HOST=0.0.0.0:11434` to accept connections from other machines and containers (the official `ollama/ollama` Docker image already does this)
4. Select **Ollama** as the LLM Provider
5. Enter the Base URL: the Ollama server's address as the OneUptime server reaches it, such as `http://ollama:11434` (OneUptime adds `/api/chat` itself). `localhost` does not work — see [Choosing a Base URL for a Self-Hosted Model](#choosing-a-base-url-for-a-self-hosted-model)
6. Enter the model name you pulled

**Example Configuration (Ollama as a service named `ollama` on OneUptime's Docker Compose network):**

```
Name: Self-Hosted Ollama
LLM Provider: Ollama
Base URL: http://ollama:11434
Model Name: llama3.1
```

**Raise the context window.** Unless told otherwise, Ollama sizes a model's context window by the GPU memory it finds: 4k tokens below 24 GiB, 32k up to 48 GiB and 256k above that (older releases use 2,048 or 4,096 tokens). OneUptime's AI features are agents. Every request carries their system prompt and tool definitions, more than 10,000 tokens before any question, and an AI investigation adds each query result to the conversation as it goes. When a request no longer fits, Ollama drops the oldest messages, and the question goes with them. Depending on the model and the Ollama release, the model then answers without the question or without its tools, or the request fails with "no user query found in messages" (Qwen 3.8 and later) or "the prompt is longer than the context length currently available to the model". OneUptime reports those failures as "…the request is larger than the model's context window" and does not run the investigation again. Set a larger `num_ctx` in the provider's **Additional Parameters**:

```json
{ "options": { "num_ctx": 65536 } }
```

OneUptime merges this `options` object into the options it sends to Ollama, so list only the settings you want to change. 65,536 tokens is what Ollama recommends for agents, and it covers most investigations. A long investigation can use more, because OneUptime only starts shortening old query results once the conversation passes roughly 75,000 tokens: use 131,072 if the model supports it and your GPU can hold it. A larger context window needs more memory, and `ollama ps` shows the context each loaded model got. To raise the default for every client instead, set `OLLAMA_CONTEXT_LENGTH` on the Ollama server. That is the only way when OneUptime reaches Ollama through its OpenAI-compatible `/v1` API (the **OpenAI Compatible** provider), which ignores `num_ctx`. For a global provider registered from `GLOBAL_LLM_PROVIDER_*` variables, set **Additional Parameters** in the Admin Dashboard under **Settings** > **Global LLM Providers**; the startup sync leaves that field alone.

**Popular Ollama Models:**

- `llama3.1` - Meta's Llama 3.1 model, the oldest Llama with tool-calling support
- `llama3.3` - Meta's Llama 3.3 model
- `qwen2.5` - Alibaba's Qwen 2.5 model
- `mistral-nemo` - Mistral AI's Nemo model

> Note: OneUptime's AI features are agentic — they rely heavily on tool calling. Use `llama3.1` or newer (or another tool-calling-capable model). Small models or models without tool-calling support (e.g. `llama2`, the original `llama3`) produce poor results: they cannot query your monitors, incidents, or telemetry, so investigations come back empty or hallucinated.

### Choosing a Base URL for a Self-Hosted Model

The Base URL of a self-hosted model — Ollama, vLLM, LM Studio, or any other OpenAI-compatible server — must be an address the **OneUptime server** can reach. Your browser never connects to it.

**Loopback addresses are always refused.** Before connecting, OneUptime checks every address the Base URL's host name resolves to. `localhost`, `127.0.0.1`, `[::1]` and `0.0.0.0`, as well as link-local and cloud metadata addresses such as `169.254.169.254`, are refused in every deployment, self-hosted included. This is by design: a provider's Base URL must not be usable to reach services on the OneUptime server itself. Inside Docker Compose or Kubernetes, `localhost` would be the OneUptime container anyway, not the machine that runs your model.

Use a private address or an internal host name instead:

| Where the model server runs                                          | Base URL                                                                                                                                                   |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A service on OneUptime's Docker Compose network (`oneuptime`)        | The service name, e.g. `http://ollama:11434`                                                                                                               |
| The same Kubernetes cluster as OneUptime                             | The Service DNS name, e.g. `http://ollama.<namespace>.svc.cluster.local:11434` — the same pattern as the [bundled vLLM](#self-hosted-vllm-on-kubernetes-helm) |
| The host machine itself, outside any container                       | The host's LAN IP, e.g. `http://192.168.1.20:11434`, or `http://host.docker.internal:11434` on Docker Desktop                                              |
| Another machine on your network                                      | Its private IP or internal host name, e.g. `http://10.0.0.12:11434`                                                                                        |

OpenAI-compatible servers follow the same rules with their own port and `/v1` path, e.g. `http://vllm:8000/v1`, or `http://192.168.1.20:1234/v1` for LM Studio. Like a native Ollama install, LM Studio listens on `127.0.0.1` only until you turn on **Serve on Local Network** in its server settings.

**Private addresses work on self-hosted installs.** A self-hosted OneUptime can reach private network addresses, such as `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10` and IPv6 `fc00::/7`, unless you set `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`, which refuses them the way OneUptime Cloud does. That setting does not apply to a Global LLM Provider, which an administrator configures (with the `GLOBAL_LLM_PROVIDER_*` variables or in the Admin Dashboard) rather than a project: it can still reach private addresses. Loopback and link-local addresses stay refused for every provider.

**OneUptime Cloud (SaaS) cannot reach private networks.** It refuses private network addresses, and host names that resolve to them, for every LLM provider. To use a model that runs on your own infrastructure, either self-host OneUptime on a network that can reach it, or expose the model at a publicly reachable endpoint. Protect a public endpoint with an API key: the **Ollama** provider sends no credentials, while **OpenAI Compatible** sends the API Key as a bearer token (Ollama also serves an OpenAI-compatible API under `/v1`, so it can sit behind a reverse proxy that checks the key).

### OpenAI Compatible (vLLM, LocalAI, LM Studio, etc.)

Use the **OpenAI Compatible** provider for any server that implements the OpenAI `/chat/completions` API but is not OpenAI itself — for example [vLLM](https://docs.vllm.ai), [LocalAI](https://localai.io), [LM Studio](https://lmstudio.ai), or text-generation-webui. These are typically self-hosted at your own URL and often run without authentication.

1. Start your OpenAI-compatible server and note its base URL (it usually ends in `/v1`)
2. Select **OpenAI Compatible** as the LLM Provider
3. Enter the **Base URL** (required), e.g. `http://your-server:8000/v1`. It must be reachable from the OneUptime server, so not `localhost` — see [Choosing a Base URL for a Self-Hosted Model](#choosing-a-base-url-for-a-self-hosted-model)
4. Enter the **Model Name** (required) — it must match a model your server exposes
5. Enter the **API Key** only if your server requires one; leave it blank for keyless servers

**Example Configuration (keyless vLLM):**

```
Name: Self-Hosted vLLM
LLM Provider: OpenAI Compatible
Base URL: http://vllm.internal:8000/v1
Model Name: meta-llama/Llama-3.1-8B-Instruct
API Key: (leave blank)
```

> Tip: After saving, use the **Test** button on the provider to confirm the connection, model name, and base URL are correct.

### Self-Hosted vLLM on Kubernetes (Helm)

If you self-host OneUptime with the Helm chart, you can run [vLLM](https://docs.vllm.ai) — an OpenAI-compatible inference server — inside your cluster and serve local models on your own GPUs. No data leaves your infrastructure.

1. Enable it in your Helm values (requires NVIDIA GPU nodes):

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. Run `helm upgrade` and wait for the vLLM pod to become Ready (the first start downloads the model)
3. That's it — vLLM is registered automatically as a Global LLM Provider at startup (`vllm.globalProvider.enabled`, default `true`), so AI features work for all projects, including AI fix tasks. (Everywhere — Cloud and self-hosted — agent fix tasks use the global provider when the project owns no provider of its own; on Cloud that usage is billed as metered AI tokens. A project-owned provider always takes precedence.)

If you disabled auto-registration (`vllm.globalProvider.enabled: false`), create the provider manually:

1. Select **OpenAI Compatible** as the LLM Provider (vLLM speaks the OpenAI API)
2. Enter the in-cluster Base URL: `http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1` (replace `cluster.local` if you changed `global.clusterDomain`)
3. Enter the Model Name: the full HuggingFace model id (or `vllm.servedModelName` if you set one)
4. Enter the API Key only if you set `vllm.apiKey`; leave it blank for a keyless vLLM

**Example Configuration:**

```
Name: In-Cluster vLLM
LLM Provider: OpenAI Compatible
Base URL: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Model Name: Qwen/Qwen2.5-1.5B-Instruct
API Key: (leave blank unless vllm.apiKey is set)
```

With billing enabled, or with `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true` (`outboundConnections.blockPrivateNetwork: true` in the Helm values), a project's own provider cannot reach this in-cluster address, which resolves to a private cluster IP. Create the provider in the Admin Dashboard under **Settings** > **Global LLM Providers** instead, with the same fields: a Global LLM Provider can reach that address.

See the [Helm chart's vLLM guide](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/ai-vllm.md) for GPU scheduling, gated models and tuning options.

## Using Custom Base URLs

For enterprise deployments or when using proxy services, you can specify a custom Base URL:

- **Azure OpenAI**: Use your Azure endpoint URL
- **OpenAI-compatible APIs**: Any API that follows OpenAI's API specification
- **Private Ollama instances**: Your internal Ollama server URL

## Best Practices

1. **Use descriptive names**: Name your providers clearly (e.g., "Production OpenAI", "Development Ollama")
2. **Secure your API keys**: API keys are encrypted at rest, but avoid sharing them
3. **Test your configuration**: After setting up, verify the provider works with AI features
4. **Monitor usage**: Keep track of API usage to manage costs

## Troubleshooting

### Connection Issues

- **OpenAI/Anthropic**: Verify your API key is valid and has sufficient credits
- **Ollama**: Ensure the Ollama server is running, listens on an address the OneUptime server can reach (`OLLAMA_HOST=0.0.0.0:11434` for a native install), and the Base URL points to that address
- **OpenAI Compatible**: Ensure the Base URL ends in `/v1` (or matches your server), the Model Name matches a model your server exposes, and only set an API Key if your server requires one
- **"…points to an address OneUptime is not allowed to connect to"**: the Base URL resolves to a refused address — `localhost` or another loopback address, or, on OneUptime Cloud, a private network address. (OneUptime Cloud reports a refused host name as "…could not be reached" instead.) See [Choosing a Base URL for a Self-Hosted Model](#choosing-a-base-url-for-a-self-hosted-model)
- **Firewall**: Check that your network allows outbound connections to the provider's API

### Model Not Found

- Verify the model name is spelled correctly
- For Ollama, ensure you've pulled the model with `ollama pull <model-name>`
- Check if the model is available in your region (some models have regional restrictions)

### Context Window Too Small

- **"…the request is larger than the model's context window"**: the request did not fit in the model's context window, usually because an AI investigation has collected a lot of evidence. Raise `num_ctx` in the provider's **Additional Parameters**, or `OLLAMA_CONTEXT_LENGTH` on the Ollama server; see [Ollama (Self-Hosted)](#ollama-self-hosted)
- **"no user query found in messages"**: the same problem, as Qwen reports it. OneUptime always sends the question; Ollama dropped it to make the rest of the request fit

## Need Help?

If you encounter issues setting up your LLM provider, please:

1. Check the [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) for known problems
2. Contact support if you're on an enterprise plan
