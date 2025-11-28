import path from "node:path";
import LocalFile from "Common/Server/Utils/LocalFile";
import logger from "Common/Server/Utils/Logger";
import { LMStudioClient } from "../llm/LMStudioClient";
import { buildSystemPrompt } from "./SystemPrompt";
import { WorkspaceContextBuilder } from "./WorkspaceContext";
import { ToolRegistry } from "../tools/ToolRegistry";
import { ChatMessage, ToolExecutionResult } from "../types";

export interface CopilotAgentOptions {
  prompt: string;
  modelUrl: string;
  modelName: string;
  workspacePath: string;
  temperature: number;
  maxIterations: number;
  requestTimeoutMs: number;
  apiKey?: string | undefined;
}

export class CopilotAgent {
  private readonly options: CopilotAgentOptions;
  private readonly workspaceRoot: string;
  private readonly client: LMStudioClient;
  private readonly registry: ToolRegistry;

  public constructor(options: CopilotAgentOptions) {
    this.options = options;
    this.workspaceRoot = path.resolve(options.workspacePath);
    this.client = new LMStudioClient({
      endpoint: options.modelUrl,
      model: options.modelName,
      temperature: options.temperature,
      timeoutMs: options.requestTimeoutMs,
      apiKey: options.apiKey,
    });

    this.registry = new ToolRegistry(this.workspaceRoot);
  }

  public async run(): Promise<void> {
    await this.ensureWorkspace();
    const contextSnapshot: string = await WorkspaceContextBuilder.buildSnapshot(
      this.workspaceRoot,
    );

    const messages: Array<ChatMessage> = [
      { role: "system", content: buildSystemPrompt() },
      {
        role: "user",
        content: this.composeUserPrompt(this.options.prompt, contextSnapshot),
      },
    ];

    for (let iteration = 0; iteration < this.options.maxIterations; iteration++) {
      logger.info(`Starting iteration ${iteration + 1}`);
      const response: ChatMessage = await this.client.createChatCompletion({
        messages,
        tools: this.registry.getToolDefinitions(),
      });

      if (response.tool_calls?.length) {
        logger.info(
          `Model requested tools: ${response.tool_calls
            .map((call) => {
              return call.function.name;
            })
            .join(", ")}`,
        );
        messages.push(response);
        await this.handleToolCalls(response.tool_calls, messages);
        continue;
      }

      const finalMessage: string = response.content?.trim() ||
        "Model ended the conversation without a reply.";
      // eslint-disable-next-line no-console
      console.log(`\n${finalMessage}`);
      return;
    }

    throw new Error(
      `Reached the iteration limit (${this.options.maxIterations}) without a final response.`,
    );
  }

  private async handleToolCalls(
    calls: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }>,
    messages: Array<ChatMessage>,
  ): Promise<void> {
    for (const call of calls) {
      const result: ToolExecutionResult = await this.registry.execute(call);
      // eslint-disable-next-line no-console
      console.log(`\n# Tool: ${call.function.name}\n${result.output}\n`);
      messages.push({
        role: "tool",
        content: result.output,
        tool_call_id: result.toolCallId,
      });
    }
  }

  private async ensureWorkspace(): Promise<void> {
    if (!(await LocalFile.doesDirectoryExist(this.workspaceRoot))) {
      throw new Error(
        `Workspace path ${this.workspaceRoot} does not exist or is not a directory.`,
      );
    }
  }

  private composeUserPrompt(task: string, snapshot: string): string {
    return `# Task\n${task.trim()}\n\n# Workspace snapshot\n${snapshot}\n\nPlease reason step-by-step, gather any missing context with the tools, and keep iterating until the task is complete.`;
  }
}
