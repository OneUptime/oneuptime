import {
  CodeAgent,
  CodeAgentLLMConfig,
  CodeAgentTask,
  CodeAgentResult,
  CodeAgentProgressCallback,
  CodeAgentProgressEvent,
} from "./CodeAgentInterface";
import TaskLogger from "../Utils/TaskLogger";
import BackendAPI, { LlmCompletionResult } from "../Utils/BackendAPI";
import CodeAgentWorkspaceGuard from "Common/Server/Utils/AI/CodeFix/CodeAgentWorkspaceGuard";
import {
  LLMMessage,
  LLMToolCall,
  LLMToolDefinition,
} from "Common/Server/Utils/LLM/LLMService";
import Execute from "Common/Server/Utils/Execute";
import LocalFile from "Common/Server/Utils/LocalFile";
import logger, { LogAttributes } from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import path from "path";
import { ChildProcess, spawn } from "child_process";

/*
 * One tool execution: the one-line narration for the activity feed, and the
 * verbatim output the model saw. Both are shipped to the run's trail — the
 * narration as the event message, the output onto the transcript the Logs
 * page reads — so a bad run can be debugged from what the model was actually
 * told, not just from a summary of it.
 */
interface ToolExecution {
  narration: string;
  output: string;
}

/*
 * The in-house code agent (B4 Tier 0, Internal/Roadmap/
 * CodeFixSandboxDesign.md): a tool loop whose every LLM completion is
 * server-mediated via POST /ai-agent-data/llm-completion — metered, logged
 * to LlmLog against the run, inside the G4 daily budget, and under per-run
 * loop budgets enforced server-side. The worker never holds a provider
 * secret; this replaced the OpenCode CLI shell-out (removed after its one
 * grace release).
 *
 * Tool surface: read_file / write_file / list_directory / search_files
 * (all path-guarded to the workspace) and run_command (workspace cwd,
 * 120s timeout, output truncated). Every tool call is narrated to the run's
 * glass-box trail as a ToolCallCompleted event via the TaskLogger, carrying
 * the verbatim arguments and output for the Logs page.
 */
export default class InHouseCodeAgent implements CodeAgent {
  public readonly name: string = "InHouse";

  private config: CodeAgentLLMConfig | null = null;
  private taskLogger: TaskLogger | null = null;
  private progressCallback: CodeAgentProgressCallback | null = null;
  private backendAPI: BackendAPI | null = null;
  private currentProcess: ChildProcess | null = null;
  private aborted: boolean = false;

  // Default wall-clock timeout: 30 minutes.
  private static readonly DEFAULT_TIMEOUT_MS: number = 30 * 60 * 1000;

  /*
   * Worker-side mirror of the server's per-run completion-call budget. The
   * server's count is authoritative (and includes calls from earlier
   * attempts of the run); this local cap only bounds a single loop.
   */
  private static readonly MAX_COMPLETION_CALLS: number = 40;

  // run_command hard timeout.
  private static readonly RUN_COMMAND_TIMEOUT_MS: number = 120 * 1000;

  /*
   * When the server-reported remaining output-token budget drops below
   * this, the next call is forced to be the final (no-tools) answer.
   */
  private static readonly MIN_OUTPUT_TOKENS_FOR_TOOL_TURN: number = 4096;

  public async initialize(
    config: CodeAgentLLMConfig,
    taskLogger?: TaskLogger,
  ): Promise<void> {
    if (!config.taskId) {
      throw new Error(
        "InHouseCodeAgent requires config.taskId — completions are validated against the claimed run",
      );
    }

    this.config = config;
    this.backendAPI = new BackendAPI();

    if (taskLogger) {
      this.taskLogger = taskLogger;
    }

    await this.log(
      "Initializing in-house code agent (server-mediated, metered LLM completions — no provider key on this worker)",
    );
  }

  public async executeTask(task: CodeAgentTask): Promise<CodeAgentResult> {
    if (!this.config || !this.config.taskId || !this.backendAPI) {
      return this.createErrorResult(
        "Agent not initialized. Call initialize() first.",
      );
    }

    this.aborted = false;
    const taskId: string = this.config.taskId;
    const workspaceRoot: string = path.resolve(task.workingDirectory);
    const timeoutMs: number =
      task.timeoutMs || InHouseCodeAgent.DEFAULT_TIMEOUT_MS;
    const startedAtMs: number = Date.now();
    const logs: Array<string> = [];

    const messages: Array<LLMMessage> = [
      {
        role: "system",
        content: this.buildSystemPrompt(task),
      },
      {
        role: "user",
        content:
          "Begin now. Investigate the repository and make the required changes. " +
          "When you are done — or cannot proceed — stop calling tools and reply " +
          "with a plain-text summary of what you changed and why.",
      },
    ];

    let summary: string = "";
    let completionCalls: number = 0;

    try {
      await this.log(`Starting tool loop in ${workspaceRoot}`);
      logs.push(`Prompt: ${messages[0]!.content.substring(0, 500)}...`);

      let forceFinalAnswer: boolean = false;

      while (true) {
        if (this.aborted) {
          return this.createErrorResult("Task was aborted", logs);
        }

        if (Date.now() - startedAtMs > timeoutMs) {
          return this.createErrorResult(
            `Code agent timed out after ${Math.round(timeoutMs / 1000)} seconds`,
            logs,
          );
        }

        /*
         * Local guard: the LAST allowed call must produce an answer, not
         * more tool calls — nudge the model and withhold the tools.
         */
        if (
          !forceFinalAnswer &&
          completionCalls >= InHouseCodeAgent.MAX_COMPLETION_CALLS - 1
        ) {
          forceFinalAnswer = true;
        }

        if (forceFinalAnswer) {
          messages.push({
            role: "user",
            content:
              "The tool budget for this run is exhausted. Do not request any " +
              "more tools. Reply now with a plain-text summary of the changes " +
              "you made and anything left undone.",
          });
        }

        const completion: LlmCompletionResult =
          await this.backendAPI.llmCompletion({
            taskId,
            messages,
            ...(forceFinalAnswer ? {} : { tools: this.getToolDefinitions() }),
          });

        completionCalls++;

        if (completion.content) {
          logs.push(
            `Assistant: ${completion.content.substring(0, 1000)}${completion.content.length > 1000 ? "..." : ""}`,
          );
        }

        if (forceFinalAnswer || completion.toolCalls.length === 0) {
          summary = completion.content || summary;
          break;
        }

        messages.push({
          role: "assistant",
          content: completion.content,
          toolCalls: completion.toolCalls,
        });

        for (const toolCall of completion.toolCalls) {
          if (this.aborted) {
            return this.createErrorResult("Task was aborted", logs);
          }

          const toolResult: string = await this.executeToolCall(
            workspaceRoot,
            toolCall,
          );

          logs.push(
            `[${toolCall.name}] ${toolResult.substring(0, 300)}${toolResult.length > 300 ? "..." : ""}`,
          );

          messages.push({
            role: "tool",
            content: toolResult,
            toolCallId: toolCall.id,
          });
        }

        /*
         * Server-reported budget: wind down BEFORE the server refuses the
         * next call, so the run always ends with an honest summary.
         */
        const callsRemaining: number =
          completion.budget.maxCompletionCalls -
          completion.budget.completionCallsUsed;
        const outputTokensRemaining: number =
          completion.budget.maxOutputTokens -
          completion.budget.outputTokensUsed;

        if (
          callsRemaining <= 1 ||
          outputTokensRemaining <=
            InHouseCodeAgent.MIN_OUTPUT_TOKENS_FOR_TOOL_TURN
        ) {
          forceFinalAnswer = true;
        }
      }

      const modifiedFiles: Array<string> =
        await this.getModifiedFiles(workspaceRoot);

      await this.log(
        `Tool loop finished after ${completionCalls} completion call(s). ${modifiedFiles.length} file(s) modified.`,
      );

      return {
        success: true,
        filesModified: modifiedFiles,
        summary: summary || "No summary available",
        logs,
        exitCode: 0,
      };
    } catch (error) {
      const errorMessage: string =
        error instanceof Error ? error.message : String(error);

      await this.log(`In-house code agent failed: ${errorMessage}`);
      logs.push(`Error: ${errorMessage}`);

      return this.createErrorResult(errorMessage, logs);
    }
  }

  public onProgress(callback: CodeAgentProgressCallback): void {
    this.progressCallback = callback;
  }

  // No external binary is required — the agent is always available.
  public async isAvailable(): Promise<boolean> {
    return true;
  }

  public async abort(): Promise<void> {
    this.aborted = true;

    if (this.currentProcess) {
      this.currentProcess.kill("SIGTERM");
      this.currentProcess = null;
    }

    await this.log("In-house code agent aborted");
  }

  public async cleanup(): Promise<void> {
    if (this.currentProcess) {
      this.currentProcess.kill("SIGTERM");
      this.currentProcess = null;
    }

    this.config = null;
    this.backendAPI = null;
    this.progressCallback = null;
  }

  /*
   * System prompt = the recipe prompt (built by the task handler) + the
   * tool-use contract.
   */
  private buildSystemPrompt(task: CodeAgentTask): string {
    let recipePrompt: string = task.prompt;

    if (task.context) {
      recipePrompt = `${task.context}\n\n${recipePrompt}`;
    }

    if (task.servicePath) {
      recipePrompt = `The service code is located at: ${task.servicePath}\n\n${recipePrompt}`;
    }

    const toolInstructions: string = [
      "You are working inside a cloned git repository. Use the provided tools to",
      "explore and modify it:",
      "- read_file / write_file / list_directory / search_files operate on paths",
      "  relative to the repository root and cannot leave it.",
      "- run_command runs a shell command in the repository root (120 second",
      "  timeout). Use it to build or run tests when helpful.",
      "- Tool outputs are truncated; read specific files rather than dumping",
      "  large ones.",
      "Make focused, minimal changes. Do NOT run git commands to commit, branch",
      "or push — the surrounding pipeline commits your changes and opens the",
      "pull request. When you are done, stop calling tools and reply with a",
      "plain-text summary of what you changed and why.",
    ].join("\n");

    return `${recipePrompt}\n\n${toolInstructions}`;
  }

  // The workspace tool surface offered to the model.
  private getToolDefinitions(): Array<LLMToolDefinition> {
    return [
      {
        name: "read_file",
        description:
          "Read a file from the repository. Returns its content (truncated when very large).",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "File path relative to the repository root",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "write_file",
        description:
          "Write a file in the repository, creating it (and parent directories) if needed. Overwrites existing content entirely.",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "File path relative to the repository root",
            },
            content: {
              type: "string",
              description: "The full new content of the file",
            },
          },
          required: ["path", "content"],
        },
      },
      {
        name: "list_directory",
        description:
          "List the entries of a directory in the repository. Directories are suffixed with '/'.",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "Directory path relative to the repository root (defaults to the root)",
            },
          },
        },
      },
      {
        name: "search_files",
        description:
          "Search tracked file contents for a pattern (git grep, line numbers included). Optionally restrict to a path.",
        inputSchema: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "The text or regular expression to search for",
            },
            path: {
              type: "string",
              description:
                "Optional file or directory (relative to the repository root) to restrict the search to",
            },
          },
          required: ["pattern"],
        },
      },
      {
        name: "run_command",
        description:
          "Run a shell command in the repository root (120 second timeout). Returns the exit code and combined output (truncated).",
        inputSchema: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The shell command to run",
            },
          },
          required: ["command"],
        },
      },
    ];
  }

  /*
   * Execute one tool call. Failures are returned as text (never thrown) so
   * the model can adapt; every call is narrated to the run's ProgressLog
   * trail.
   */
  private async executeToolCall(
    workspaceRoot: string,
    toolCall: LLMToolCall,
  ): Promise<string> {
    const args: JSONObject = toolCall.arguments || {};

    const execution: ToolExecution = await this.runTool(
      workspaceRoot,
      toolCall,
      args,
    );

    /*
     * Narrate once, centrally, with the verbatim arguments and output
     * attached — so every tool is recorded the same way and no branch can
     * quietly skip the trail.
     */
    await this.reportToolCall(toolCall.name, args, execution);

    return execution.output;
  }

  private async runTool(
    workspaceRoot: string,
    toolCall: LLMToolCall,
    args: JSONObject,
  ): Promise<ToolExecution> {
    /*
     * Malformed argument JSON must never execute a tool with empty
     * arguments — surface the parse error so the model retries.
     */
    if (toolCall.argumentsParseError) {
      return {
        narration: `refused ${toolCall.name}: malformed tool arguments`,
        output: `Error: ${toolCall.argumentsParseError} Retry the tool call with valid JSON arguments.`,
      };
    }

    try {
      switch (toolCall.name) {
        case "read_file":
          return await this.toolReadFile(workspaceRoot, args);
        case "write_file":
          return await this.toolWriteFile(workspaceRoot, args);
        case "list_directory":
          return await this.toolListDirectory(workspaceRoot, args);
        case "search_files":
          return await this.toolSearchFiles(workspaceRoot, args);
        case "run_command":
          return await this.toolRunCommand(workspaceRoot, args);
        default:
          return {
            narration: `refused unknown tool ${toolCall.name}`,
            output: `Error: unknown tool "${toolCall.name}".`,
          };
      }
    } catch (error) {
      const errorMessage: string =
        error instanceof Error ? error.message : String(error);
      return {
        narration: `${toolCall.name} failed: ${errorMessage}`,
        output: `Error: ${errorMessage}`,
      };
    }
  }

  private async toolReadFile(
    workspaceRoot: string,
    args: JSONObject,
  ): Promise<ToolExecution> {
    const requestedPath: string = (args["path"] as string) || "";
    const absolutePath: string = CodeAgentWorkspaceGuard.resolveWorkspacePath(
      workspaceRoot,
      requestedPath,
    );
    const relativePath: string =
      CodeAgentWorkspaceGuard.toWorkspaceRelativePath(
        workspaceRoot,
        absolutePath,
      );

    const content: string = await LocalFile.read(absolutePath);

    return {
      narration: `read ${relativePath}`,
      output: CodeAgentWorkspaceGuard.truncateToolOutput(content),
    };
  }

  private async toolWriteFile(
    workspaceRoot: string,
    args: JSONObject,
  ): Promise<ToolExecution> {
    const requestedPath: string = (args["path"] as string) || "";
    const content: string = (args["content"] as string) ?? "";
    const absolutePath: string = CodeAgentWorkspaceGuard.resolveWorkspacePath(
      workspaceRoot,
      requestedPath,
    );
    const relativePath: string =
      CodeAgentWorkspaceGuard.toWorkspaceRelativePath(
        workspaceRoot,
        absolutePath,
      );

    await LocalFile.makeDirectory(path.dirname(absolutePath));
    await LocalFile.write(absolutePath, content);

    return {
      narration: `wrote ${relativePath} (${content.length} chars)`,
      output: `Wrote ${content.length} characters to ${relativePath}.`,
    };
  }

  private async toolListDirectory(
    workspaceRoot: string,
    args: JSONObject,
  ): Promise<ToolExecution> {
    const requestedPath: string = (args["path"] as string) || ".";
    const absolutePath: string = CodeAgentWorkspaceGuard.resolveWorkspacePath(
      workspaceRoot,
      requestedPath,
    );
    const relativePath: string =
      CodeAgentWorkspaceGuard.toWorkspaceRelativePath(
        workspaceRoot,
        absolutePath,
      );

    const entries: Array<{ name: string; isDirectory(): boolean }> =
      await LocalFile.readDirectory(absolutePath);

    if (entries.length === 0) {
      return {
        narration: `listed ${relativePath}`,
        output: "(empty directory)",
      };
    }

    return {
      narration: `listed ${relativePath}`,
      output: CodeAgentWorkspaceGuard.truncateToolOutput(
        entries
          .map((entry: { name: string; isDirectory(): boolean }) => {
            return entry.isDirectory() ? `${entry.name}/` : entry.name;
          })
          .sort()
          .join("\n"),
      ),
    };
  }

  private async toolSearchFiles(
    workspaceRoot: string,
    args: JSONObject,
  ): Promise<ToolExecution> {
    const pattern: string = (args["pattern"] as string) || "";

    if (!pattern) {
      return {
        narration: "refused search_files: no pattern given",
        output: "Error: a search pattern is required.",
      };
    }

    /*
     * Restrict-to-path goes through the same escape guard, then back to a
     * workspace-relative pathspec for git grep.
     */
    const gitArgs: Array<string> = ["grep", "-I", "-n", "-e", pattern];

    if (args["path"]) {
      const absolutePath: string = CodeAgentWorkspaceGuard.resolveWorkspacePath(
        workspaceRoot,
        args["path"] as string,
      );
      gitArgs.push(
        "--",
        CodeAgentWorkspaceGuard.toWorkspaceRelativePath(
          workspaceRoot,
          absolutePath,
        ),
      );
    }

    const narration: string = `searched files for "${pattern}"`;

    try {
      const output: string = await Execute.executeCommandFile({
        command: "git",
        args: gitArgs,
        cwd: workspaceRoot,
        maxBuffer: 10 * 1024 * 1024,
        timeoutInMS: 30 * 1000,
      });

      return {
        narration,
        output: CodeAgentWorkspaceGuard.truncateToolOutput(
          output.trim() || "No matches found.",
        ),
      };
    } catch {
      // git grep exits non-zero on no matches (and on invalid patterns).
      return {
        narration,
        output: "No matches found (or the pattern was invalid).",
      };
    }
  }

  private async toolRunCommand(
    workspaceRoot: string,
    args: JSONObject,
  ): Promise<ToolExecution> {
    const command: string = (args["command"] as string) || "";

    if (!command) {
      return {
        narration: "refused run_command: no command given",
        output: "Error: a command is required.",
      };
    }

    const result: {
      exitCode: number | null;
      output: string;
      timedOut: boolean;
    } = await this.runShellCommand(workspaceRoot, command);

    const header: string = result.timedOut
      ? `Command timed out after ${InHouseCodeAgent.RUN_COMMAND_TIMEOUT_MS / 1000} seconds.`
      : `Exit code: ${result.exitCode ?? "unknown"}`;

    return {
      narration: `ran ${command.substring(0, 200)} (${
        result.timedOut ? "timed out" : `exit ${result.exitCode ?? "unknown"}`
      })`,
      output: CodeAgentWorkspaceGuard.truncateToolOutput(
        `${header}\n${result.output}`.trim(),
      ),
    };
  }

  /*
   * Run a shell command in the workspace with a hard timeout, capturing
   * combined stdout+stderr regardless of exit code (a failing test run's
   * output is exactly what the model needs to see).
   */
  private runShellCommand(
    workspaceRoot: string,
    command: string,
  ): Promise<{ exitCode: number | null; output: string; timedOut: boolean }> {
    return new Promise(
      (
        resolve: (result: {
          exitCode: number | null;
          output: string;
          timedOut: boolean;
        }) => void,
      ) => {
        const child: ChildProcess = spawn("bash", ["-c", command], {
          cwd: workspaceRoot,
          stdio: ["ignore", "pipe", "pipe"],
        });

        this.currentProcess = child;

        let output: string = "";
        let timedOut: boolean = false;
        let settled: boolean = false;

        const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, InHouseCodeAgent.RUN_COMMAND_TIMEOUT_MS);

        const appendOutput: (data: Buffer) => void = (data: Buffer): void => {
          // Cap in-memory growth well above the tool-output truncation.
          if (output.length < 1024 * 1024) {
            output += data.toString();
          }
        };

        child.stdout?.on("data", appendOutput);
        child.stderr?.on("data", appendOutput);

        const settle: (exitCode: number | null) => void = (
          exitCode: number | null,
        ): void => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          this.currentProcess = null;
          resolve({ exitCode, output, timedOut });
        };

        child.on("close", (code: number | null) => {
          settle(code);
        });

        child.on("error", (error: Error) => {
          output += `\n${error.message}`;
          settle(null);
        });
      },
    );
  }

  // Get list of modified files using git.
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
      logger.error("Error getting modified files:", {
        agentName: this.name,
      } as LogAttributes);
      logger.error(error, { agentName: this.name } as LogAttributes);
      return [];
    }
  }

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

  /*
   * Narrate one tool step AND record the verbatim detail behind it: the
   * arguments as executed and the full output the model saw. The server
   * stores the detail on the run's transcript, where the Logs page reads it.
   * Without this the trail says "read Index.ts" but never what the model was
   * shown — which is exactly what you need when a fix goes wrong.
   */
  private async reportToolCall(
    toolName: string,
    args: JSONObject,
    execution: ToolExecution,
  ): Promise<void> {
    if (this.taskLogger) {
      await this.taskLogger.toolCall({
        toolName,
        message: `[${this.name}] ${execution.narration}`,
        toolArguments: args,
        toolResult: execution.output,
      });
    } else {
      logger.debug(`[${this.name}] ${execution.narration}`);
    }

    if (this.progressCallback) {
      const event: CodeAgentProgressEvent = {
        type: "status",
        message: execution.narration,
        timestamp: new Date(),
      };

      await this.progressCallback(event);
    }
  }

  private async log(message: string): Promise<void> {
    if (this.taskLogger) {
      await this.taskLogger.info(`[${this.name}] ${message}`);
    } else {
      logger.debug(`[${this.name}] ${message}`);
    }
  }
}
