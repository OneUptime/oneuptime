# OneUptime Copilot Agent

A standalone CLI coding agent that mirrors the autonomous workflows we use inside VS Code Copilot Chat. It connects to an LM Studio–hosted OpenAI-compatible model, inspects a workspace, reasons about the task, and uses a toolbox (file/patch editing, search, terminal commands) to complete coding requests.

## Prerequisites

- Node.js 18+
- An LM Studio instance exposing a chat completions endpoint (for example `http://localhost:1234/v1/chat/completions`).
- The workspace you want the agent to modify must already exist locally.

## Installation

```bash
cd Copilot/oneuptime-copilot-agent
npm install
npm run build
npm link   # optional, provides the global oneuptime-copilot-agent command
```

## Usage

```bash
oneuptime-copilot-agent \
  --prompt "Refactor auth middleware and add unit tests" \
  --model http://localhost:1234/v1/chat/completions \
  --model-name openai/gpt-oss-20b \
  --workspace-path ./
```

### CLI options

| Flag | Description |
| ---- | ----------- |
| `--prompt` | Required. Natural language description of the task. |
| `--model` | Required. Full LM Studio chat completions endpoint URL. |
| `--workspace-path` | Required. Absolute or relative path to the repo the agent should use. |
| `--model-name` | Optional model identifier that LM Studio expects (default `lmstudio`). |
| `--temperature` | Sampling temperature (default `0.1`). |
| `--max-iterations` | Maximum agent/tool-call loops before stopping (default `12`). |
| `--timeout` | LLM HTTP timeout per request in milliseconds (default `120000`). |
| `--api-key` | Optional bearer token if the endpoint is secured. |
| `--log-level` | `debug`, `info`, `warn`, or `error` (default `info`). |
| `--log-file` | Optional file path. When provided, all logs are appended to this file in addition to stdout. |

### Debug logging

Pass `--log-file` when running the agent to persist verbose debugging output (including `debug` level messages) for later inspection:

```bash
oneuptime-copilot-agent \
  --prompt "Track flaky jest tests" \
  --model http://localhost:1234/v1/chat/completions \
  --workspace-path ./ \
  --log-file ./logs/copilot-agent-debug.log
```

The agent will create any missing parent directories and continuously append to the specified file while still streaming logs to stdout.

## Architecture snapshot

- `src/agent` – Orchestrates the conversation loop, builds the system prompt (inspired by the VS Code Copilot agent), snapshots the workspace, and streams messages to the LM Studio endpoint.
- `src/tools` – Implements the toolbelt (`list_directory`, `read_file`, `search_workspace`, `apply_patch`, `write_file`, `run_command`). These wrap `Common` utilities (`Execute`, `LocalFile`, `Logger`) to stay consistent with other OneUptime services.
- `src/llm` – Thin LM Studio/OpenAI-compatible client using `undici` with timeout + error handling.
- `src/@types/Common` – Lightweight shim typings so TypeScript consumers get the pieces of `Common` they need without re-compiling that entire package.

## Development scripts

```bash
npm run build   # Compile TypeScript -> build/dist
npm run dev     # Run with ts-node for quick experiments
```

For example: 

```
npm run dev -- --prompt "Write tests for this project. These tests should be in Jest and TypeScript." \
  --model http://localhost:1234/v1/chat/completions \
  --model-name deepseek/deepseek-r1-0528-qwen3-8b \
  --workspace-path ./ \
  --log-file ./copilot-agent-debug.log
```

The agent intentionally mirrors Copilot’s workflow: it iteratively plans, reads files, edits them through patches or full rewrites, and executes commands/tests via the terminal tool. Logs stream to stdout so you can follow each tool invocation in real time.
