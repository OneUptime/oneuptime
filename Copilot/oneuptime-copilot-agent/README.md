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
  --model-name Meta-Llama-3-8B-Instruct \
  --workspace-path /path/to/oneuptime
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

The agent intentionally mirrors Copilot’s workflow: it iteratively plans, reads files, edits them through patches or full rewrites, and executes commands/tests via the terminal tool. Logs stream to stdout so you can follow each tool invocation in real time.
