import path from "node:path";
import LocalFile from "Common/Server/Utils/LocalFile";
import { AnthropicClient } from "../LLM/AnthropicClient";
import { LLMClient } from "../LLM/LLMClient";
import { LMStudioClient } from "../LLM/LMStudioClient";
import { OpenAIClient } from "../LLM/OpenAIClient";
import { buildSystemPrompt } from "./SystemPrompt";
import { WorkspaceContextBuilder } from "./WorkspaceContext";
import { ToolRegistry } from "../Tools/ToolRegistry";
import { ChatMessage, OpenAIToolCall, ToolExecutionResult } from "../Types";
import AgentLogger from "../Utils/AgentLogger";

/**
 * Configuration values that control how the Copilot agent connects to the
 * model, how many iterations it may run, and which workspace it operates on.
 */
export type LLMProvider = "lmstudio" | "openai" | "anthropic";

export interface CopilotAgentOptions {
  prompt: string;
  provider: LLMProvider;
  modelUrl?: string;
  modelName: string;
  workspacePath: string;
  temperature: number;
  maxIterations: number;
  requestTimeoutMs: number;
  apiKey?: string | undefined;
}

/**
 * Coordinates the overall tool-using conversation loop with the target LLM,
 * including prompt preparation, workspace validation, and tool execution.
 */
export class CopilotAgent {
  private readonly options: CopilotAgentOptions;
  private readonly workspaceRoot: string;
  private readonly client: LLMClient;
  private readonly registry: ToolRegistry;

  /**
   * Creates a new agent instance, wiring up the selected LLM client and tool
   * registry for the provided workspace.
   */
  public constructor(options: CopilotAgentOptions) {
    this.options = options;
    this.workspaceRoot = path.resolve(options.workspacePath);
    this.client = this.createClient(options);

    this.registry = new ToolRegistry(this.workspaceRoot);
    AgentLogger.debug("CopilotAgent initialized", {
      workspaceRoot: this.workspaceRoot,
      provider: options.provider,
      modelUrl: options.modelUrl,
      modelName: options.modelName,
      temperature: options.temperature,
      maxIterations: options.maxIterations,
      timeoutMs: options.requestTimeoutMs,
      hasApiKey: Boolean(options.apiKey),
    });
  }

  private createClient(options: CopilotAgentOptions): LLMClient {
    switch (options.provider) {
      case "lmstudio": {
        if (!options.modelUrl) {
          throw new Error(
            "--model must be provided when using the lmstudio provider.",
          );
        }

        return new LMStudioClient({
          endpoint: options.modelUrl,
          model: options.modelName,
          temperature: options.temperature,
          timeoutMs: options.requestTimeoutMs,
          apiKey: options.apiKey,
        });
      }
      case "openai": {
        return new OpenAIClient({
          endpoint: options.modelUrl,
          model: options.modelName,
          temperature: options.temperature,
          timeoutMs: options.requestTimeoutMs,
          apiKey: this.requireApiKey("OpenAI"),
        });
      }
      case "anthropic": {
        return new AnthropicClient({
          endpoint: options.modelUrl,
          model: options.modelName,
          temperature: options.temperature,
          timeoutMs: options.requestTimeoutMs,
          apiKey: this.requireApiKey("Anthropic"),
        });
      }
      default: {
        const exhaustiveCheck: never = options.provider;
        throw new Error(`Unsupported provider ${exhaustiveCheck}`);
      }
    }
  }

  private requireApiKey(providerName: string): string {
    if (!this.options.apiKey) {
      throw new Error(
        `${providerName} provider requires --api-key to be specified.`,
      );
    }

    return this.options.apiKey;
  }

  /**
   * Executes the multi-iteration conversation loop until the model responds
   * without tool calls or the iteration budget is exhausted.
   */
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
    AgentLogger.debug(`Workspace snapshot built:\n${contextSnapshot}`, {
      snapshotLength: contextSnapshot.length,
      snapshotContents: contextSnapshot,
    });

    const messages: Array<ChatMessage> = [
      { role: "system", content: buildSystemPrompt() },
      {
        role: "user",
        content: this.composeUserPrompt(this.options.prompt, contextSnapshot),
      },
    ];
    AgentLogger.debug(
      `Initial conversation seeded:\n${this.describeMessages(messages)}`,
      {
        messageCount: messages.length,
        seedMessages: messages,
      },
    );

    for (
      let iteration: number = 0;
      iteration < this.options.maxIterations;
      iteration += 1
    ) {
      AgentLogger.info(`Starting iteration ${iteration + 1}`);
      AgentLogger.debug(
        `Sending messages to LLM (iteration ${iteration + 1}):\n${this.describeMessages(messages)}`,
        {
          iteration: iteration + 1,
          messageCount: messages.length,
          outgoingMessages: messages,
        },
      );
      const response: ChatMessage = await this.client.createChatCompletion({
        messages,
        tools: this.registry.getToolDefinitions(),
      });

      AgentLogger.debug(
        `LLM response received (iteration ${iteration + 1}):\n${this.describeMessages([response])}`,
        {
          iteration: iteration + 1,
          hasToolCalls: Boolean(response.tool_calls?.length),
          responseContent: response.content ?? null,
          responseObject: response,
          responseToolCalls: response.tool_calls ?? null,
        },
      );

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
      AgentLogger.debug(
        `Conversation completed after ${iteration + 1} iterations:\n${finalMessage}`,
        {
          iterationsUsed: iteration + 1,
          finalMessageLength: finalMessage.length,
          finalMessage,
        },
      );
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

  /**
   * Executes every tool call requested by the model and appends the results to
   * the running conversation so the LLM can observe tool outputs.
   */
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
      AgentLogger.debug(
        `Tool execution completed (${call.function.name}/${call.id}):\n${result.output}`,
        {
          toolName: call.function.name,
          callId: call.id,
          isError: result.output.startsWith("ERROR"),
          outputLength: result.output.length,
          outputContents: result.output,
        },
      );
      messages.push({
        role: "tool",
        content: result.output,
        tool_call_id: result.toolCallId,
      });
      AgentLogger.debug(
        `Tool result appended to conversation (total ${messages.length} messages):\n${this.describeMessages(messages)}`,
        {
          totalMessages: messages.length,
          updatedConversation: messages,
        },
      );
    }
  }

  /**
   * Verifies that the configured workspace root directory exists before any
   * commands or tool calls attempt to touch the file system.
   */
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

  /**
   * Builds the user-facing portion of the chat prompt by combining the task
   * description with a structured workspace snapshot.
   */
  private composeUserPrompt(task: string, snapshot: string): string {
    const prompt: string = `# Task\n${task.trim()}\n\n# Workspace snapshot\n${snapshot}\n\nPlease reason step-by-step, gather any missing context with the tools, and keep iterating until the task is complete.`;
    AgentLogger.debug(`Composed user prompt:\n${prompt}`, {
      taskLength: task.length,
      snapshotLength: snapshot.length,
      promptLength: prompt.length,
      taskContents: task,
      snapshotContents: snapshot,
      promptContents: prompt,
    });
    return prompt;
  }

  private describeMessages(messages: Array<ChatMessage>): string {
    return messages
      .map((message: ChatMessage, index: number) => {
        const headerParts: Array<string> = [
          `Message ${index + 1}`,
          `role=${message.role}`,
        ];

        if (message.tool_call_id) {
          headerParts.push(`tool_call_id=${message.tool_call_id}`);
        }

        const content: unknown = message.content;
        const normalizedContent: string =
          typeof content === "string"
            ? content
            : content
              ? JSON.stringify(content, null, 2)
              : "<no content>";

        const toolCalls: string =
          Array.isArray(message.tool_calls) && message.tool_calls.length
            ? `\nTool calls:\n${JSON.stringify(message.tool_calls, null, 2)}`
            : "";

        return `${headerParts.join(" | ")}\n${normalizedContent}${toolCalls}`;
      })
      .join("\n\n");
  }
}
