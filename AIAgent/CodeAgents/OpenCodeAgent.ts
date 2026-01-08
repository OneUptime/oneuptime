import {
  CodeAgent,
  CodeAgentLLMConfig,
  CodeAgentTask,
  CodeAgentResult,
  CodeAgentProgressCallback,
  CodeAgentProgressEvent,
} from "./CodeAgentInterface";
import TaskLogger from "../Utils/TaskLogger";
import Execute from "Common/Server/Utils/Execute";
import LocalFile from "Common/Server/Utils/LocalFile";
import LlmType from "Common/Types/LLM/LlmType";
import logger from "Common/Server/Utils/Logger";
import path from "path";
import { ChildProcess, spawn } from "child_process";
import BadDataException from "Common/Types/Exception/BadDataException";

// OpenCode configuration file structure
interface OpenCodeConfig {
  provider?: Record<string, unknown>;
  model?: string;
  small_model?: string;
  disabled_providers?: Array<string>;
  enabled_providers?: Array<string>;
}

export default class OpenCodeAgent implements CodeAgent {
  public readonly name: string = "OpenCode";

  private config: CodeAgentLLMConfig | null = null;
  private taskLogger: TaskLogger | null = null;
  private progressCallback: CodeAgentProgressCallback | null = null;
  private currentProcess: ChildProcess | null = null;
  private aborted: boolean = false;

  // Default timeout: 30 minutes
  private static readonly DEFAULT_TIMEOUT_MS: number = 30 * 60 * 1000;

  public async initialize(
    config: CodeAgentLLMConfig,
    taskLogger?: TaskLogger,
  ): Promise<void> {
    this.config = config;

    if (taskLogger) {
      this.taskLogger = taskLogger;
    }

    await this.log(`Initializing ${this.name} with ${config.llmType} provider`);
  }

  public async executeTask(task: CodeAgentTask): Promise<CodeAgentResult> {
    if (!this.config) {
      return this.createErrorResult(
        "Agent not initialized. Call initialize() first.",
      );
    }

    this.aborted = false;
    const logs: Array<string> = [];
    const timeoutMs: number =
      task.timeoutMs || OpenCodeAgent.DEFAULT_TIMEOUT_MS;

    try {
      await this.log(`Executing task in directory: ${task.workingDirectory}`);

      // Create OpenCode config file in the working directory
      await this.createOpenCodeConfig(task.workingDirectory);

      // Build the prompt
      const fullPrompt: string = this.buildFullPrompt(task);

      await this.log("Starting OpenCode execution...");
      logs.push(`Prompt: ${fullPrompt.substring(0, 500)}...`);

      // Execute OpenCode
      const output: string = await this.runOpenCode(
        task.workingDirectory,
        fullPrompt,
        timeoutMs,
        (event: CodeAgentProgressEvent) => {
          logs.push(`[${event.type}] ${event.message}`);
          if (this.progressCallback) {
            this.progressCallback(event);
          }
        },
      );

      logs.push(
        `Output: ${output.substring(0, 1000)}${output.length > 1000 ? "..." : ""}`,
      );

      if (this.aborted) {
        return this.createErrorResult("Task was aborted", logs);
      }

      // Check for modified files
      const modifiedFiles: Array<string> = await this.getModifiedFiles(
        task.workingDirectory,
      );

      await this.log(
        `OpenCode completed. ${modifiedFiles.length} files modified.`,
      );

      return {
        success: true,
        filesModified: modifiedFiles,
        summary: this.extractSummary(output),
        logs,
        exitCode: 0,
      };
    } catch (error) {
      const errorMessage: string =
        error instanceof Error ? error.message : String(error);

      await this.log(`OpenCode execution failed: ${errorMessage}`);
      logs.push(`Error: ${errorMessage}`);

      return this.createErrorResult(errorMessage, logs);
    }
  }

  public onProgress(callback: CodeAgentProgressCallback): void {
    this.progressCallback = callback;
  }

  public async isAvailable(): Promise<boolean> {
    try {
      const result: string = await Execute.executeCommandFile({
        command: "opencode",
        args: ["--version"],
        cwd: process.cwd(),
      });

      logger.debug(`OpenCode version check: ${result}`);
      return true;
    } catch (error) {
      logger.debug("OpenCode is not available:");
      logger.debug(error);
      return false;
    }
  }

  public async abort(): Promise<void> {
    this.aborted = true;

    if (this.currentProcess) {
      this.currentProcess.kill("SIGTERM");
      this.currentProcess = null;
    }

    await this.log("OpenCode execution aborted");
  }

  public async cleanup(): Promise<void> {
    if (this.currentProcess) {
      this.currentProcess.kill("SIGTERM");
      this.currentProcess = null;
    }

    this.config = null;
    this.progressCallback = null;
  }

  // Create OpenCode configuration file in the workspace
  private async createOpenCodeConfig(workingDirectory: string): Promise<void> {
    if (!this.config) {
      throw new Error("Config not initialized");
    }

    const configPath: string = path.join(workingDirectory, "opencode.json");

    const openCodeConfig: OpenCodeConfig = {
      model: this.getModelString(),
      small_model: this.getSmallModelString(),
    };

    // Set enabled providers based on LLM type
    if (this.config.llmType === LlmType.Anthropic) {
      openCodeConfig.enabled_providers = ["anthropic"];
    } else if (this.config.llmType === LlmType.OpenAI) {
      openCodeConfig.enabled_providers = ["openai"];
    }

    await LocalFile.write(configPath, JSON.stringify(openCodeConfig, null, 2));

    await this.log(`Created OpenCode config at ${configPath}`);
  }

  // Get the model string in OpenCode format (provider/model)
  private getModelString(): string {
    if (!this.config) {
      throw new Error("Config not initialized");
    }

    const provider: string = this.getProviderName();
    const model: string = this.config.modelName || this.getDefaultModel();

    return `${provider}/${model}`;
  }

  // Get the small model string for quick operations
  private getSmallModelString(): string {
    if (!this.config) {
      throw new Error("Config not initialized");
    }

    const provider: string = this.getProviderName();
    const smallModel: string = this.getDefaultSmallModel();

    return `${provider}/${smallModel}`;
  }

  // Get provider name for OpenCode config
  private getProviderName(): string {
    if (!this.config) {
      return "anthropic";
    }

    switch (this.config.llmType) {
      case LlmType.Anthropic:
        return "anthropic";
      case LlmType.OpenAI:
        return "openai";
      case LlmType.Ollama:
        return "ollama";
      default:
        throw new BadDataException("Unsupported LLM type for OpenCode agent");
    }
  }

  // Get default model based on provider
  private getDefaultModel(): string {
    if (!this.config) {
      return "claude-sonnet-4-20250514";
    }

    switch (this.config.llmType) {
      case LlmType.Anthropic:
        return "claude-sonnet-4-20250514";
      case LlmType.OpenAI:
        return "gpt-4o";
      case LlmType.Ollama:
        return "llama2";
      default:
        throw new BadDataException("Unsupported LLM type for OpenCode agent");
    }
  }

  // Get default small model for quick operations
  private getDefaultSmallModel(): string {
    if (!this.config) {
      return "claude-haiku-4-20250514";
    }

    switch (this.config.llmType) {
      case LlmType.Anthropic:
        return "claude-haiku-4-20250514";
      case LlmType.OpenAI:
        return "gpt-4o-mini";
      case LlmType.Ollama:
        return "llama2";
      default:
        throw new BadDataException("Unsupported LLM type for OpenCode agent");
    }
  }

  // Build the full prompt including context
  private buildFullPrompt(task: CodeAgentTask): string {
    let prompt: string = task.prompt;

    if (task.context) {
      prompt = `${task.context}\n\n${prompt}`;
    }

    if (task.servicePath) {
      prompt = `The service code is located at: ${task.servicePath}\n\n${prompt}`;
    }

    return prompt;
  }

  // Run OpenCode in non-interactive mode
  private async runOpenCode(
    workingDirectory: string,
    prompt: string,
    timeoutMs: number,
    onOutput: (event: CodeAgentProgressEvent) => void,
  ): Promise<string> {
    return new Promise(
      (resolve: (value: string) => void, reject: (reason: Error) => void) => {
        if (!this.config) {
          reject(new Error("Config not initialized"));
          return;
        }

        // Set environment variables for API key
        const env: NodeJS.ProcessEnv = { ...process.env };

        if (this.config.apiKey) {
          switch (this.config.llmType) {
            case LlmType.Anthropic:
              env["ANTHROPIC_API_KEY"] = this.config.apiKey;
              break;
            case LlmType.OpenAI:
              env["OPENAI_API_KEY"] = this.config.apiKey;
              break;
            case LlmType.Ollama:
              if (this.config.baseUrl) {
                env["OLLAMA_HOST"] = this.config.baseUrl;
              }
              break;
          }
        }

        // Use CLI mode flags to ensure output goes to stdout/stderr instead of TUI
        const args: Array<string> = [
          "run",
          "--print-logs",
          "--log-level",
          "DEBUG",
          "--format",
          "default",
          prompt,
        ];

        logger.debug(
          `Running: opencode ${args
            .map((a: string) => {
              return a.includes(" ") ? `"${a.substring(0, 50)}..."` : a;
            })
            .join(" ")}`,
        );

        const child: ChildProcess = spawn("opencode", args, {
          cwd: workingDirectory,
          env,
          stdio: ["pipe", "pipe", "pipe"],
        });

        this.currentProcess = child;

        let stdout: string = "";
        let stderr: string = "";

        // Set timeout
        const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
          if (child.pid) {
            child.kill("SIGTERM");
            reject(
              new Error(
                `OpenCode execution timed out after ${timeoutMs / 1000} seconds`,
              ),
            );
          }
        }, timeoutMs);

        child.stdout?.on("data", (data: Buffer) => {
          const text: string = data.toString();
          stdout += text;

          // Stream to console immediately
          const trimmedText: string = text.trim();
          if (trimmedText) {
            logger.info(`[OpenCode stdout] ${trimmedText}`);

            // Stream to task logger for server-side logging
            if (this.taskLogger) {
              this.taskLogger
                .info(`[OpenCode] ${trimmedText}`)
                .catch((err: Error) => {
                  logger.error(`Failed to log OpenCode output: ${err.message}`);
                });
            }
          }

          onOutput({
            type: "stdout",
            message: trimmedText,
            timestamp: new Date(),
          });
        });

        child.stderr?.on("data", (data: Buffer) => {
          const text: string = data.toString();
          stderr += text;

          // Stream to console immediately
          const trimmedText: string = text.trim();
          if (trimmedText) {
            logger.warn(`[OpenCode stderr] ${trimmedText}`);

            // Stream to task logger for server-side logging
            if (this.taskLogger) {
              this.taskLogger
                .warning(`[OpenCode stderr] ${trimmedText}`)
                .catch((err: Error) => {
                  logger.error(`Failed to log OpenCode stderr: ${err.message}`);
                });
            }
          }

          onOutput({
            type: "stderr",
            message: trimmedText,
            timestamp: new Date(),
          });
        });

        child.on("close", (code: number | null) => {
          clearTimeout(timeout);
          this.currentProcess = null;

          if (this.aborted) {
            reject(new Error("Execution aborted"));
            return;
          }

          if (code === 0 || code === null) {
            resolve(stdout);
          } else {
            reject(
              new Error(
                `OpenCode exited with code ${code}. stderr: ${stderr.substring(0, 500)}`,
              ),
            );
          }
        });

        child.on("error", (error: Error) => {
          clearTimeout(timeout);
          this.currentProcess = null;
          reject(error);
        });
      },
    );
  }

  // Get list of modified files using git
  private async getModifiedFiles(
    workingDirectory: string,
  ): Promise<Array<string>> {
    try {
      const result: string = await Execute.executeCommandFile({
        command: "git",
        args: ["status", "--porcelain"],
        cwd: workingDirectory,
      });

      if (!result.trim()) {
        return [];
      }

      return result
        .split("\n")
        .filter((line: string) => {
          return line.trim().length > 0;
        })
        .map((line: string) => {
          // Git status format: "XY filename"
          return line.substring(3).trim();
        });
    } catch (error) {
      logger.error("Error getting modified files:");
      logger.error(error);
      return [];
    }
  }

  // Extract summary from OpenCode output
  private extractSummary(output: string): string {
    // Try to extract a meaningful summary from the output
    const lines: Array<string> = output.split("\n").filter((line: string) => {
      return line.trim().length > 0;
    });

    // Return last few meaningful lines as summary
    const summaryLines: Array<string> = lines.slice(-5);

    return summaryLines.join("\n") || "No summary available";
  }

  // Create error result helper
  private createErrorResult(
    errorMessage: string,
    logs: Array<string> = [],
  ): CodeAgentResult {
    return {
      success: false,
      filesModified: [],
      summary: "",
      logs,
      error: errorMessage,
      exitCode: 1,
    };
  }

  // Logging helper
  private async log(message: string): Promise<void> {
    if (this.taskLogger) {
      await this.taskLogger.info(`[${this.name}] ${message}`);
    } else {
      logger.debug(`[${this.name}] ${message}`);
    }
  }
}
