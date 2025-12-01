import path from "node:path";
import LocalFile from "Common/Server/Utils/LocalFile";
import { LMStudioClient } from "../llm/LMStudioClient";
import { buildSystemPrompt } from "./SystemPrompt";
import { WorkspaceContextBuilder } from "./WorkspaceContext";
import { ToolRegistry } from "../tools/ToolRegistry";
import { ChatMessage, OpenAIToolCall, ToolExecutionResult } from "../types";
import AgentLogger from "../utils/AgentLogger";

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
    AgentLogger.debug("CopilotAgent initialized", {
      workspaceRoot: this.workspaceRoot,
      modelUrl: options.modelUrl,
      modelName: options.modelName,
      temperature: options.temperature,
      maxIterations: options.maxIterations,
      timeoutMs: options.requestTimeoutMs,
      hasApiKey: Boolean(options.apiKey),
    });
  }

  public async run(): Promise<void> {
    AgentLogger.debug("Ensuring workspace exists", {
      workspaceRoot: this.workspaceRoot,
    });
    await this.ensureWorkspace();
    AgentLogger.debug("Workspace verified", {
      workspaceRoot: this.workspaceRoot,
    });
    const contextSnapshot: string = await WorkspaceContextBuilder.buildSnapshot(
      this.workspaceRoot,
    );
    AgentLogger.debug("Workspace snapshot built", {
      snapshotLength: contextSnapshot.length,
    });

    const messages: Array<ChatMessage> = [
      { role: "system", content: buildSystemPrompt() },
      {
        role: "user",
        content: this.composeUserPrompt(this.options.prompt, contextSnapshot),
      },
    ];
    AgentLogger.debug("Initial conversation seeded", {
      messageCount: messages.length,
    });

    for (
      let iteration: number = 0;
      iteration < this.options.maxIterations;
      iteration += 1
    ) {
      AgentLogger.info(`Starting iteration ${iteration + 1}`);
      AgentLogger.debug("Sending messages to LLM", {
        iteration: iteration + 1,
        messageCount: messages.length,
      });
      const response: ChatMessage = await this.client.createChatCompletion({
        messages,
        tools: this.registry.getToolDefinitions(),
      });

      AgentLogger.debug("LLM response received", {
        iteration: iteration + 1,
        hasToolCalls: Boolean(response.tool_calls?.length),
        contentPreview: response.content?.slice(0, 200) ?? null,
      });

      if (response.tool_calls?.length) {
        AgentLogger.info(
          `Model requested tools: ${response.tool_calls
            .map((call: OpenAIToolCall) => {
              return call.function.name;
            })
            .join(", ")}`,
        );
        messages.push(response);
        await this.handleToolCalls(response.tool_calls, messages);
        continue;
      }

      const finalMessage: string =
        response.content?.trim() ||
        "Model ended the conversation without a reply.";
      // eslint-disable-next-line no-console
      console.log(`\n${finalMessage}`);
      AgentLogger.debug("Conversation completed", {
        iterationsUsed: iteration + 1,
        finalMessagePreview: finalMessage.slice(0, 500),
      });
      return;
    }

    AgentLogger.error("Iteration limit reached", {
      maxIterations: this.options.maxIterations,
      prompt: this.options.prompt,
    });
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
    for (let index: number = 0; index < calls.length; index += 1) {
      const call:
        | {
            id: string;
            type: "function";
            function: { name: string; arguments: string };
          }
        | undefined = calls[index];
      if (call === undefined) {
        AgentLogger.warn("Missing tool call entry", {
          requestedIndex: index,
          totalCalls: calls.length,
        });
        continue;
      }
      AgentLogger.debug("Executing tool", {
        toolName: call.function.name,
        callId: call.id,
      });
      const result: ToolExecutionResult = await this.registry.execute(call);
      // eslint-disable-next-line no-console
      console.log(`\n# Tool: ${call.function.name}\n${result.output}\n`);
      AgentLogger.debug("Tool execution completed", {
        toolName: call.function.name,
        callId: call.id,
        isError: result.output.startsWith("ERROR"),
        outputLength: result.output.length,
      });
      messages.push({
        role: "tool",
        content: result.output,
        tool_call_id: result.toolCallId,
      });
      AgentLogger.debug("Tool result appended to conversation", {
        totalMessages: messages.length,
      });
    }
  }

  private async ensureWorkspace(): Promise<void> {
    AgentLogger.debug("Validating workspace directory", {
      workspaceRoot: this.workspaceRoot,
    });
    if (!(await LocalFile.doesDirectoryExist(this.workspaceRoot))) {
      throw new Error(
        `Workspace path ${this.workspaceRoot} does not exist or is not a directory.`,
      );
    }
    AgentLogger.debug("Workspace exists", {
      workspaceRoot: this.workspaceRoot,
    });
  }

  private composeUserPrompt(task: string, snapshot: string): string {
    const prompt: string = `# Task\n${task.trim()}\n\n# Workspace snapshot\n${snapshot}\n\nPlease reason step-by-step, gather any missing context with the tools, and keep iterating until the task is complete.`;
    AgentLogger.debug("Composed user prompt", {
      taskLength: task.length,
      snapshotLength: snapshot.length,
      promptLength: prompt.length,
    });
    return prompt;
  }
}
