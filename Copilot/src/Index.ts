#!/usr/bin/env node

import path from "node:path";
import { Command } from "commander";
import {
  CopilotAgent,
  CopilotAgentOptions,
  LLMProvider,
} from "./Agent/CopilotAgent";
import AgentLogger from "./Utils/AgentLogger";

/** CLI harness for configuring and launching the Copilot agent. */
const program: Command = new Command();

program
  .name("oneuptime-copilot")
  .description(
    "Autonomous OneUptime coding agent for LM Studio, Ollama, OpenAI, and Anthropic models",
  )
  .requiredOption(
    "--prompt <text>",
    "Problem statement or set of tasks for the agent",
  )
  .option(
    "--model <value>",
    "Provider-specific model endpoint override. Required for lmstudio, optional for other providers.",
  )
  .option(
    "--provider <name>",
    "llm provider: lmstudio | ollama | openai | anthropic (default lmstudio)",
    "lmstudio",
  )
  .requiredOption(
    "--workspace-path <path>",
    "Path to the repository or folder the agent should work inside",
  )
  .option(
    "--model-name <name>",
    "Model identifier expected by the selected provider",
    "lmstudio",
  )
  .option(
    "--temperature <value>",
    "Sampling temperature passed to the model (default 0.1)",
    "0.1",
  )
  .option(
    "--max-iterations <count>",
    "Maximum number of tool-calling rounds (default 100)",
    "100",
  )
  .option(
    "--timeout <ms>",
    "HTTP timeout for each LLM request in milliseconds (default 120000)",
    "120000",
  )
  .option(
    "--api-key <token>",
    "API key for OpenAI/Anthropic or secured LM Studio/Ollama endpoints",
  )
  .option(
    "--log-level <level>",
    "debug | info | warn | error (default info)",
    process.env["LOG_LEVEL"] ?? "info",
  )
  .option(
    "--log-file <path>",
    "Optional file path to append all agent logs for auditing",
  )
  .parse(process.argv);

const PROVIDERS: Array<LLMProvider> = [
  "lmstudio",
  "ollama",
  "openai",
  "anthropic",
];

function normalizeProvider(value: string | undefined): LLMProvider {
  const normalized: string = (value ?? "lmstudio").toLowerCase();
  if (PROVIDERS.includes(normalized as LLMProvider)) {
    return normalized as LLMProvider;
  }

  throw new Error(
    `Unsupported provider ${value}. Expected one of: ${PROVIDERS.join(", ")}.`,
  );
}

function resolveModelUrl(
  provider: LLMProvider,
  explicit: string | undefined,
  modelName: string | undefined,
): string | undefined {
  if (explicit) {
    return explicit;
  }

  if (provider === "ollama") {
    return "http://localhost:11434/v1/chat/completions";
  }

  if (provider === "openai") {
    return requiresOpenAIResponsesEndpoint(modelName)
      ? "https://api.openai.com/v1/responses"
      : "https://api.openai.com/v1/chat/completions";
  }

  if (provider === "anthropic") {
    return "https://api.anthropic.com/v1/messages";
  }

  return undefined;
}

function requiresOpenAIResponsesEndpoint(modelName: string | undefined): boolean {
  if (!modelName) {
    return false;
  }

  const normalized: string = modelName.toLowerCase();
  return (
    normalized.includes("gpt-5") ||
    normalized.includes("gpt-4.1") ||
    normalized.includes("codex")
  );
}

/** Entry point that parses CLI args, configures logging, and runs the agent. */
(async () => {
  const opts: {
    prompt: string;
    model?: string;
    provider?: string;
    workspacePath: string;
    modelName?: string;
    temperature: string;
    maxIterations: string;
    timeout: string;
    apiKey?: string;
    logLevel?: string;
    logFile?: string;
  } = program.opts<{
    prompt: string;
    model?: string;
    provider?: string;
    workspacePath: string;
    modelName?: string;
    temperature: string;
    maxIterations: string;
    timeout: string;
    apiKey?: string;
    logLevel?: string;
    logFile?: string;
  }>();

  const provider: LLMProvider = normalizeProvider(opts.provider);
  const requestedModelName: string = opts.modelName || "lmstudio";
  const modelUrl: string | undefined = resolveModelUrl(
    provider,
    opts.model,
    requestedModelName,
  );

  process.env["LOG_LEVEL"] = opts.logLevel?.toUpperCase() ?? "INFO";
  await AgentLogger.configure({ logFilePath: opts.logFile });
  AgentLogger.debug("CLI options parsed", {
    workspacePath: opts.workspacePath,
    provider,
    modelUrl,
    modelName: requestedModelName,
    temperature: opts.temperature,
    maxIterations: opts.maxIterations,
    timeout: opts.timeout,
    hasApiKey: Boolean(opts.apiKey),
    logLevel: process.env["LOG_LEVEL"],
    logFile: opts.logFile,
  });

  const config: CopilotAgentOptions = {
    prompt: opts.prompt,
    provider,
    modelName: requestedModelName,
    workspacePath: path.resolve(opts.workspacePath),
    temperature: Number(opts.temperature) || 0.1,
    maxIterations: Number(opts.maxIterations) || 100,
    requestTimeoutMs: Number(opts.timeout) || 120000,
    ...(modelUrl ? { modelUrl } : {}),
    ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
  };

  try {
    const agent: CopilotAgent = new CopilotAgent(config);
    await agent.run();
  } catch (error) {
    AgentLogger.error("Agent run failed", error as Error);
    // eslint-disable-next-line no-console
    console.error("Agent failed", error);
    process.exit(1);
  }
})();
