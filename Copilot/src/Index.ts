#!/usr/bin/env node

import path from "node:path";
import os from "node:os";
import { Command } from "commander";
import { CopilotAgent, CopilotAgentOptions } from "./Agent/CopilotAgent";
import AgentLogger from "./Utils/AgentLogger";

/** Resolves log file paths relative to the workspace when not absolute. */
const resolveLogFilePath = (
  logFile: string | undefined,
  workspacePath: string,
): string | undefined => {
  if (!logFile?.trim()) {
    return undefined;
  }

  const trimmed: string = logFile.trim();

  if (trimmed.startsWith("~")) {
    const homeDir: string = os.homedir();
    const withoutTilde: string = trimmed.slice(1);
    const relativeFromHome: string = withoutTilde.startsWith(path.sep)
      ? withoutTilde.slice(1)
      : withoutTilde;
    return path.resolve(homeDir, relativeFromHome);
  }

  return path.isAbsolute(trimmed)
    ? trimmed
    : path.resolve(workspacePath, trimmed);
};

/** CLI harness for configuring and launching the Copilot agent. */
const program: Command = new Command();

program
  .name("oneuptime-copilot-agent")
  .description("Autonomous OneUptime coding agent for LM Studio hosted models")
  .requiredOption(
    "--prompt <text>",
    "Problem statement or set of tasks for the agent",
  )
  .requiredOption(
    "--model <url>",
    "Full LM Studio chat-completions endpoint (for example http://localhost:1234/v1/chat/completions)",
  )
  .requiredOption(
    "--workspace-path <path>",
    "Path to the repository or folder the agent should work inside",
  )
  .option(
    "--model-name <name>",
    "Model identifier expected by the LM Studio endpoint",
    "lmstudio",
  )
  .option(
    "--temperature <value>",
    "Sampling temperature passed to the model (default 0.1)",
    "0.1",
  )
  .option(
    "--max-iterations <count>",
    "Maximum number of tool-calling rounds (default 12)",
    "12",
  )
  .option(
    "--timeout <ms>",
    "HTTP timeout for each LLM request in milliseconds (default 120000)",
    "120000",
  )
  .option(
    "--api-key <token>",
    "API key if the endpoint requires authentication",
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

/** Entry point that parses CLI args, configures logging, and runs the agent. */
(async () => {
  const opts: {
    prompt: string;
    model: string;
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
    model: string;
    workspacePath: string;
    modelName?: string;
    temperature: string;
    maxIterations: string;
    timeout: string;
    apiKey?: string;
    logLevel?: string;
    logFile?: string;
  }>();

  const workspacePath: string = path.resolve(opts.workspacePath);
  const logFilePath: string | undefined = resolveLogFilePath(
    opts.logFile,
    workspacePath,
  );

  process.env["LOG_LEVEL"] = opts.logLevel?.toUpperCase() ?? "INFO";
  await AgentLogger.configure({ logFilePath });
  AgentLogger.debug("CLI options parsed", {
    workspacePath,
    model: opts.model,
    modelName: opts.modelName,
    temperature: opts.temperature,
    maxIterations: opts.maxIterations,
    timeout: opts.timeout,
    hasApiKey: Boolean(opts.apiKey),
    logLevel: process.env["LOG_LEVEL"],
    logFile: logFilePath,
  });

  const config: CopilotAgentOptions = {
    prompt: opts.prompt,
    modelUrl: opts.model,
    modelName: opts.modelName || "lmstudio",
    workspacePath,
    temperature: Number(opts.temperature) || 0.1,
    maxIterations: Number(opts.maxIterations) || 12,
    requestTimeoutMs: Number(opts.timeout) || 120000,
    apiKey: opts.apiKey,
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
