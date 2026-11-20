import { CodeAgentServer } from "../CodeAgents/InHouseCodeAgent";
import {
  LlmCompletionResult,
  TelemetryToolCallResult,
  TelemetryTools,
} from "../Utils/BackendAPI";
import LlmCompletionError from "../Utils/LlmCompletionError";
import {
  CODE_AGENT_ANSWER_GRACE_MS,
  MAX_TOKENS_PER_COMPLETION_CALL,
} from "Common/Server/Utils/AI/CodeFix/CodeFixAgentCompletion";
import LLMContextWindow from "Common/Server/Utils/LLM/LLMContextWindow";
import {
  LLMMessage,
  LLMToolCall,
  LLMToolDefinition,
} from "Common/Server/Utils/LLM/LLMService";
import AIAgentRunLimitsHelper, {
  AIAgentRunLimits,
} from "Common/Types/AI/AIAgentRunLimits";
import CodeAgentRunLimitsUtil, {
  CodeAgentRunLimits,
} from "Common/Types/AI/CodeAgentRunLimits";
import { JSONObject } from "Common/Types/JSON";
import LlmType from "Common/Types/LLM/LlmType";

/*
 * The OneUptime server, as the code agent sees it, for the benchmark (issue
 * #6531): every model call goes straight to the model under test, and the
 * run is held to what the server holds a real one to - its time limit, the
 * answer it may still give after it, the time limit per command and the
 * model's context window, all sent with every answer as the server sends
 * them. It counts what the run used: its model calls, the tool calls the
 * model asked for, its tokens. No project, no database, nothing billed.
 */

// What a model call is asked: the conversation, the tools, the most it may write.
export interface CodeAgentBenchmarkModelRequest {
  messages: Array<LLMMessage>;
  tools: Array<LLMToolDefinition> | undefined;
  maxTokens: number;
  timeoutInMs: number | undefined;
}

export interface CodeAgentBenchmarkModelReply {
  content: string;
  toolCalls: Array<LLMToolCall>;
  promptTokens?: number | undefined;
  completionTokens?: number | undefined;
  totalTokens?: number | undefined;
  // The model that answered, when the provider says.
  modelName?: string | undefined;
}

export interface CodeAgentBenchmarkModel {
  llmType: LlmType;
  modelName?: string | undefined;
  // The provider's Additional Parameters: an Ollama model's num_ctx.
  additionalParams?: JSONObject | undefined;
  call: (
    request: CodeAgentBenchmarkModelRequest,
  ) => Promise<CodeAgentBenchmarkModelReply>;
}

// What a run used, as the server counts it.
export interface CodeAgentBenchmarkUsage {
  modelCalls: number;
  // The tool calls the model asked for, by tool.
  toolCalls: Record<string, number>;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  // The run's last call came after its time limit: it could only answer.
  answeredAfterTimeLimit: boolean;
}

export default class CodeAgentBenchmarkServer implements CodeAgentServer {
  public readonly usage: CodeAgentBenchmarkUsage = {
    modelCalls: 0,
    toolCalls: {},
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    answeredAfterTimeLimit: false,
  };

  // The limits it said with its last answer.
  public lastLimits: CodeAgentRunLimits | null = null;

  private readonly model: CodeAgentBenchmarkModel;
  private readonly limits: AIAgentRunLimits;
  private readonly startedAt: Date;
  private readonly now: () => number;

  public constructor(data: {
    model: CodeAgentBenchmarkModel;
    timeLimitInMinutes: number;
    // Ten minutes, as a project that set none, when left out.
    commandTimeLimitInMinutes?: number | undefined;
    now?: (() => number) | undefined;
  }) {
    this.model = data.model;
    this.limits = AIAgentRunLimitsHelper.fromSettings({
      timeLimitInMinutes: data.timeLimitInMinutes,
      commandTimeLimitInMinutes: data.commandTimeLimitInMinutes,
    });
    this.now =
      data.now ||
      ((): number => {
        return Date.now();
      });
    this.startedAt = new Date(this.now());
  }

  // The run's limits, as an agent loop holds them (for its stop notes).
  public getAgentRunLimits(): AIAgentRunLimits {
    return this.limits;
  }

  /*
   * One model call, as the server serves it: refused once the run's time
   * and the grace for its answer are up, and without tools - so it can only
   * be the answer - once its time is up.
   */
  public async llmCompletion(data: {
    taskId: string;
    messages: Array<LLMMessage>;
    tools?: Array<LLMToolDefinition> | undefined;
    maxTokens?: number | undefined;
    timeoutInMs?: number | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<LlmCompletionResult> {
    const nowMs: number = this.now();
    const deadlineAtMs: number = AIAgentRunLimitsHelper.getDeadlineAtMs(
      this.limits,
      this.startedAt.getTime(),
    );

    if (nowMs >= deadlineAtMs + CODE_AGENT_ANSWER_GRACE_MS) {
      throw new LlmCompletionError({
        message: `This run reached its time limit of ${AIAgentRunLimitsHelper.getTimeLimitInMinutes(this.limits)} minutes.`,
        statusCode: 400,
      });
    }

    const withoutTools: boolean = nowMs >= deadlineAtMs;
    const reply: CodeAgentBenchmarkModelReply = await this.model.call({
      messages: data.messages,
      tools: withoutTools ? undefined : data.tools,
      maxTokens: Math.min(
        data.maxTokens && data.maxTokens > 0
          ? data.maxTokens
          : MAX_TOKENS_PER_COMPLETION_CALL,
        MAX_TOKENS_PER_COMPLETION_CALL,
      ),
      timeoutInMs: data.timeoutInMs,
    });
    const toolCalls: Array<LLMToolCall> = withoutTools ? [] : reply.toolCalls;
    const callTokens: number =
      reply.totalTokens ??
      (reply.promptTokens ?? 0) + (reply.completionTokens ?? 0);

    this.usage.modelCalls++;
    this.usage.promptTokens += reply.promptTokens ?? 0;
    this.usage.completionTokens += reply.completionTokens ?? 0;
    this.usage.totalTokens += callTokens;
    this.usage.answeredAfterTimeLimit = withoutTools;

    for (const toolCall of toolCalls) {
      this.usage.toolCalls[toolCall.name] =
        (this.usage.toolCalls[toolCall.name] || 0) + 1;
    }

    this.lastLimits = CodeAgentRunLimitsUtil.build({
      limits: this.limits,
      startedAt: this.startedAt,
      modelCallsUsed: this.usage.modelCalls,
      toolCallsUsed: 0,
      tokensUsed: this.usage.totalTokens,
      lastCallTokens: callTokens,
      nowMs: this.now(),
    });

    return {
      content: reply.content || "",
      toolCalls,
      stopReason: toolCalls.length > 0 ? "tool_use" : "stop",
      // Through the wire's own reading, as a Runner reads the server's.
      limits: CodeAgentRunLimitsUtil.fromJSON(
        JSON.parse(JSON.stringify(this.lastLimits)),
      ),
      budget: {
        completionCallsUsed: this.usage.modelCalls,
        maxCompletionCalls: Number.MAX_SAFE_INTEGER,
        outputTokensUsed: this.usage.completionTokens,
        maxOutputTokens: Number.MAX_SAFE_INTEGER,
      },
      contextWindowTokens: LLMContextWindow.getContextWindowTokens({
        llmType: this.model.llmType,
        modelName: reply.modelName || this.model.modelName,
        additionalParams: this.model.additionalParams,
      }),
    };
  }

  // A command's keep-alive: nothing to keep alive.
  public async updateTaskStatus(): Promise<void> {
    return undefined;
  }

  // The benchmark's tasks read no production telemetry.
  public async getTelemetryTools(): Promise<TelemetryTools> {
    throw new Error("The benchmark offers no production telemetry.");
  }

  public async runTelemetryTool(): Promise<TelemetryToolCallResult> {
    throw new Error("The benchmark offers no production telemetry.");
  }
}
