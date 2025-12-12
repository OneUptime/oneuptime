# LLM Providers

OneUptime supports integrating with various Large Language Model (LLM) providers to enable AI-powered features throughout the platform. This guide will help you configure your own LLM provider.

## What Can LLM Providers Do?

LLM Providers in OneUptime help you automate and enhance your incident management workflow:

- **Incident Notes**: Automatically generate detailed incident notes and updates
- **Alert Notes**: Create meaningful alert descriptions and context
- **Scheduled Maintenance Notes**: Generate maintenance event notes automatically
- **Incident Postmortems**: Automatically draft comprehensive incident postmortem reports
- **Code Improvements**: If you connect your code repository to OneUptime, we will use your LLM Provider to analyze telemetry data (logs, traces, metrics, exceptions) and suggest code improvements

## OneUptime SaaS Users

If you are using **OneUptime SaaS** (cloud-hosted version), you can use the **Global LLM Provider** by default without any additional configuration. The Global LLM Provider is pre-configured and ready to use for all AI features.

If you prefer to use your own API keys or a specific provider, you can still configure a custom LLM Provider following the instructions below.

## Supported Providers

OneUptime currently supports the following LLM providers:

| Provider | Description | API Key Required | Base URL Required |
|----------|-------------|------------------|-------------------|
| **OpenAI** | GPT-4, GPT-4o, GPT-3.5 Turbo, and other OpenAI models | Yes | No (uses default) |
| **Anthropic** | Claude 3 Opus, Claude 3 Sonnet, Claude 3 Haiku, and other Claude models | Yes | No (uses default) |
| **Ollama** | Self-hosted open-source models like Llama 2, Mistral, CodeLlama, etc. | No | Yes |

## Setting Up an LLM Provider

### Step 1: Navigate to LLM Providers Settings

1. Log in to your OneUptime dashboard
2. Go to **Project Settings** > **AI** > **LLM Providers**
3. Click **Create LLM Provider** to add a new provider

### Step 2: Configure Your Provider

Fill in the following fields:

- **Name**: A friendly name for this LLM configuration (e.g., "Production OpenAI", "Local Ollama")
- **Description** (optional): A description to help identify the purpose of this provider
- **LLM Type**: Select the provider type (OpenAI, Anthropic, or Ollama)
- **API Key**: Your API key (required for OpenAI and Anthropic)
- **Model Name**: The specific model to use (e.g., `gpt-4o`, `claude-3-opus-20240229`, `llama2`)
- **Base URL** (optional): Custom API endpoint URL (required for Ollama, optional for others)

## Provider-Specific Configuration

### OpenAI

1. Get your API key from [OpenAI Platform](https://platform.openai.com/api-keys)
2. Select **OpenAI** as the LLM Type
3. Enter your API key
4. Choose a model name:
   - `gpt-4o` - Most capable model, best for complex tasks
   - `gpt-4o-mini` - Faster and more cost-effective
   - `gpt-4-turbo` - Good balance of capability and speed
   - `gpt-3.5-turbo` - Fast and economical

**Example Configuration:**
```
Name: Production OpenAI
LLM Type: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-4o
```

### Anthropic

1. Get your API key from [Anthropic Console](https://console.anthropic.com/)
2. Select **Anthropic** as the LLM Type
3. Enter your API key
4. Choose a model name:
   - `claude-3-opus-20240229` - Most capable model
   - `claude-3-sonnet-20240229` - Good balance of intelligence and speed
   - `claude-3-haiku-20240307` - Fastest and most compact
   - `claude-3-5-sonnet-20241022` - Latest Sonnet model

**Example Configuration:**
```
Name: Production Anthropic
LLM Type: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-3-5-sonnet-20241022
```

### Ollama (Self-Hosted)

Ollama allows you to run open-source LLMs locally or on your own infrastructure.

1. Install Ollama from [ollama.ai](https://ollama.ai)
2. Pull your desired model: `ollama pull llama2`
3. Ensure Ollama is running and accessible
4. Select **Ollama** as the LLM Type
5. Enter the Base URL (e.g., `http://localhost:11434`)
6. Enter the model name you pulled

**Example Configuration:**
```
Name: Local Ollama
LLM Type: Ollama
Base URL: http://localhost:11434
Model Name: llama2
```

**Popular Ollama Models:**
- `llama2` - Meta's Llama 2 model
- `llama3` - Meta's Llama 3 model
- `mistral` - Mistral AI's model
- `codellama` - Code-specialized Llama model
- `mixtral` - Mistral's mixture of experts model

## Using Custom Base URLs

For enterprise deployments or when using proxy services, you can specify a custom Base URL:

- **Azure OpenAI**: Use your Azure endpoint URL
- **OpenAI-compatible APIs**: Any API that follows OpenAI's API specification
- **Private Ollama instances**: Your internal Ollama server URL

## Best Practices

1. **Use descriptive names**: Name your providers clearly (e.g., "Production GPT-4", "Development Ollama")
2. **Secure your API keys**: API keys are encrypted at rest, but avoid sharing them
3. **Test your configuration**: After setting up, verify the provider works with AI features
4. **Monitor usage**: Keep track of API usage to manage costs

## Troubleshooting

### Connection Issues

- **OpenAI/Anthropic**: Verify your API key is valid and has sufficient credits
- **Ollama**: Ensure the Ollama server is running and the Base URL is correct
- **Firewall**: Check that your network allows outbound connections to the provider's API

### Model Not Found

- Verify the model name is spelled correctly
- For Ollama, ensure you've pulled the model with `ollama pull <model-name>`
- Check if the model is available in your region (some models have regional restrictions)

## Need Help?

If you encounter issues setting up your LLM provider, please:

1. Check the [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) for known problems
2. Contact support if you're on an enterprise plan
