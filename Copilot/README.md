# OneUptime Copilot Agent

A standalone CLI coding agent that mirrors the autonomous workflows we use inside VS Code Copilot Chat. It connects to LM Studio, Ollama, OpenAI, or Anthropic chat-completion models, inspects a workspace, reasons about the task, and uses a toolbox (file/patch editing, search, terminal commands) to complete coding requests.

## Prerequisites

- Node.js 18+
- At least one supported LLM provider:
  - LM Studio exposing a chat completions endpoint (for example `http://localhost:1234/v1/chat/completions`).
  - Ollama running locally with the OpenAI-compatible HTTP server (default `http://localhost:11434/v1/chat/completions`).
  - OpenAI API access and an API key with chat-completions enabled.
  - Anthropic API access and an API key with Messages API enabled.
- The workspace you want the agent to modify must already exist locally.

## Installation

```bash
cd Copilot/oneuptime-copilot-agent
npm install
npm run build
npm link   # optional, provides the global oneuptime-copilot-agent command
```

## Usage

### LM Studio (local HTTP endpoint)

```bash
oneuptime-copilot-agent \
  --prompt "Refactor auth middleware and add unit tests" \
  --provider lmstudio \
  --model http://localhost:1234/v1/chat/completions \
  --model-name openai/gpt-oss-20b \
  --workspace-path ./
```

### OpenAI (hosted)

```bash
oneuptime-copilot-agent \
  --prompt "Refactor auth middleware and add unit tests" \
  --provider openai \
  --model-name gpt-4o-mini \
  --api-key "$OPENAI_API_KEY" \
  --workspace-path ./
```

### Anthropic (hosted)

```bash
oneuptime-copilot-agent \
  --prompt "Refactor auth middleware and add unit tests" \
  --provider anthropic \
  --model-name claude-3-5-sonnet-latest \
  --api-key "$ANTHROPIC_API_KEY" \
  --workspace-path ./
```

### Ollama (local OpenAI-compatible endpoint)

```bash
oneuptime-copilot-agent \
  --prompt "Refactor auth middleware and add unit tests" \
  --provider ollama \
  --model-name mistral:7b-instruct \
  --workspace-path ./
```

### CLI options

| Flag | Description |
| ---- | ----------- |
| `--prompt` | Required. Natural language description of the task. |
| `--provider` | Selects the LLM backend: `lmstudio` (default), `ollama`, `openai`, or `anthropic`. |
| `--model` | Endpoint override. Required for `lmstudio`; optional for other providers (defaults to their hosted or local API). |
| `--workspace-path` | Required. Absolute or relative path to the repo the agent should use. |
| `--model-name` | Provider-specific model identifier (default `lmstudio`). |
| `--temperature` | Sampling temperature (default `0.1`). |
| `--max-iterations` | Maximum agent/tool-call loops before stopping (default `100`). |
| `--timeout` | LLM HTTP timeout per request in milliseconds (default `120000`). |
| `--api-key` | Required for OpenAI/Anthropic; optional bearer token for secured LM Studio/Ollama endpoints. |
| `--log-level` | `debug`, `info`, `warn`, or `error` (default `info`). |
| `--log-file` | Optional file path. When provided, all logs are appended to this file in addition to stdout. |

Provider cheatsheet:

- `lmstudio` – Always pass a full HTTP endpoint via `--model`. API keys are optional.
- `ollama` – Defaults to `http://localhost:11434/v1/chat/completions`; override with `--model` when remote tunneling. API keys are optional.
- `openai` – Provide `--api-key` and `--model-name` (for example `gpt-4o-mini`). `--model` is optional and defaults to `https://api.openai.com/v1/chat/completions`.
- `anthropic` – Provide `--api-key` and `--model-name` (for example `claude-3-5-sonnet-latest`). `--model` falls back to `https://api.anthropic.com/v1/messages` when omitted.

### Debug logging

Pass `--log-file` when running the agent to persist verbose debugging output (including `debug` level messages) for later inspection:

```bash
oneuptime-copilot-agent \
  --prompt "Track flaky jest tests" \
  --provider lmstudio \
  --model http://localhost:1234/v1/chat/completions \
  --workspace-path ./ \
  --log-file ./logs/copilot-agent-debug.log
```

The agent will create any missing parent directories and continuously append to the specified file while still streaming logs to stdout.

## Architecture snapshot

- `src/agent` – Orchestrates the conversation loop, builds the system prompt (inspired by the VS Code Copilot agent), snapshots the workspace, and streams messages to the configured provider.
- `src/tools` – Implements the toolbelt (`list_directory`, `read_file`, `search_workspace`, `apply_patch`, `write_file`, `run_command`). These wrap `Common` utilities (`Execute`, `LocalFile`, `Logger`) to stay consistent with other OneUptime services.
- `src/llm` – Contains the LM Studio/Ollama/OpenAI-compatible clients plus the native Anthropic adapter, all using `undici` with timeout + error handling.
- `src/@types/Common` – Lightweight shim typings so TypeScript consumers get the pieces of `Common` they need without re-compiling that entire package.

## Development scripts

```bash
npm run build   # Compile TypeScript -> build/dist
npm run dev     # Run with ts-node for quick experiments
```

For example: 

```
npm run dev -- --prompt "Write tests for this project. These tests should be in Jest and TypeScript." \
  --provider lmstudio \
  --model http://localhost:1234/v1/chat/completions \
  --model-name deepseek/deepseek-r1-0528-qwen3-8b \
  --workspace-path ./ \
  --log-file ./copilot-agent-debug.log
```

The agent intentionally mirrors Copilot’s workflow: it iteratively plans, reads files, edits them through patches or full rewrites, and executes commands/tests via the terminal tool. Logs stream to stdout so you can follow each tool invocation in real time.
