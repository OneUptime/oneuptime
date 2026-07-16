import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import LlmProvider from "../../../../Models/DatabaseModels/LlmProvider";
import AIRunService from "../../../Services/AIRunService";
import AIRunEventService from "../../../Services/AIRunEventService";
import LlmLogService from "../../../Services/LlmLogService";
import LlmProviderService from "../../../Services/LlmProviderService";
import AIService, {
  AILogResponse,
  AI_CODE_FIX_FEATURE,
} from "../../../Services/AIService";
import {
  LLMMessage,
  LLMToolCall,
  LLMToolDefinition,
} from "../../LLM/LLMService";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * Server-mediated LLM completions for the in-house code-fix agent (B4 Tier
 * 0, Internal/Roadmap/CodeFixSandboxDesign.md). The worker never holds a
 * provider secret: every completion of its tool loop is executed HERE via
 * AIService.executeWithLogging — logged to LlmLog, linked to the run, billed
 * when the provider is the costed global one, and inside the G4 daily
 * autonomous token budget.
 *
 * Loop budgets are enforced server-side per run, not trusted to the worker:
 * a run gets at most MAX_COMPLETION_CALLS_PER_RUN completion calls and
 * MAX_OUTPUT_TOKENS_PER_RUN output tokens. Usage is counted from the run's
 * own LlmLog rows (one row per executeWithLogging call, success or error),
 * so the count survives worker restarts and cannot be reset from outside
 * the server.
 */

// Max LLM completion calls one code-fix run may make.
export const MAX_COMPLETION_CALLS_PER_RUN: number = 40;

// Max output (completion) tokens one code-fix run may generate in total.
export const MAX_OUTPUT_TOKENS_PER_RUN: number = 100_000;

// Per-call output cap — a single call can never exhaust the run budget.
export const MAX_TOKENS_PER_COMPLETION_CALL: number = 16_384;

export interface AgentCompletionLoopBudget {
  completionCallsUsed: number;
  maxCompletionCalls: number;
  outputTokensUsed: number;
  maxOutputTokens: number;
}

export interface LoopBudgetDecision {
  allowed: boolean;
  // Set when not allowed — a clear, human-readable rejection.
  reason: string | null;
}

export interface AgentCompletionRequest {
  // The AUTHENTICATED agent (validated against key by the API route).
  aiAgentId: ObjectID;
  // The claimed Running CodeFix run this completion belongs to.
  aiRunId: ObjectID;
  messages: Array<LLMMessage>;
  tools?: Array<LLMToolDefinition> | undefined;
  maxTokens?: number | undefined;
}

export interface AgentCompletionResult {
  content: string;
  toolCalls: Array<LLMToolCall>;
  stopReason: "stop" | "tool_use";
  // Post-call usage so the worker can wind down before hitting the wall.
  budget: AgentCompletionLoopBudget;
}

export default class CodeFixAgentCompletion {
  /*
   * The pure budget decision, separated from IO so it is directly testable
   * (the FixRunBudget idiom).
   */
  public static evaluateLoopBudget(data: {
    completionCalls: number;
    outputTokens: number;
  }): LoopBudgetDecision {
    if (data.completionCalls >= MAX_COMPLETION_CALLS_PER_RUN) {
      return {
        allowed: false,
        reason: `This fix run has reached its LLM call budget (${data.completionCalls} of ${MAX_COMPLETION_CALLS_PER_RUN} completion calls). The run must finish with the work done so far.`,
      };
    }

    if (data.outputTokens >= MAX_OUTPUT_TOKENS_PER_RUN) {
      return {
        allowed: false,
        reason: `This fix run has reached its output-token budget (${data.outputTokens.toLocaleString()} of ${MAX_OUTPUT_TOKENS_PER_RUN.toLocaleString()} output tokens). The run must finish with the work done so far.`,
      };
    }

    return { allowed: true, reason: null };
  }

  /*
   * Validate the run, enforce the loop budgets, resolve the provider on the
   * METERED path, and execute one completion. Throws BadDataException (4xx)
   * with a clear message on every guard failure. The API route only does
   * agent-key auth + body parsing around this.
   */
  @CaptureSpan()
  public static async execute(
    request: AgentCompletionRequest,
  ): Promise<AgentCompletionResult> {
    if (!request.messages || request.messages.length === 0) {
      throw new BadDataException("messages must be a non-empty array");
    }

    /*
     * The run must be a claimed, still-Running CodeFix run owned by THIS
     * agent — a completion for someone else's run (or a finished one) is
     * refused outright.
     */
    const run: AIRun | null = await AIRunService.findOneById({
      id: request.aiRunId,
      select: {
        _id: true,
        projectId: true,
        runType: true,
        status: true,
        aiAgentId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!run || !run.projectId) {
      throw new BadDataException("Task not found");
    }

    if (run.runType !== AIRunType.CodeFix) {
      throw new BadDataException(
        "LLM completions are only served for code-fix runs",
      );
    }

    if (run.status !== AIRunStatus.Running) {
      throw new BadDataException(
        `This task is not running (status: ${run.status}) — completions are only served for claimed, running tasks`,
      );
    }

    if (
      !run.aiAgentId ||
      run.aiAgentId.toString() !== request.aiAgentId.toString()
    ) {
      throw new BadDataException(
        "This task is claimed by a different agent — completions are only served to the agent that claimed the run",
      );
    }

    // Server-side loop budgets — counted from the run's own LlmLog rows.
    const usage: { completionCalls: number; outputTokens: number } =
      await LlmLogService.getRunCompletionUsage({ aiRunId: request.aiRunId });

    const budgetDecision: LoopBudgetDecision = this.evaluateLoopBudget({
      completionCalls: usage.completionCalls,
      outputTokens: usage.outputTokens,
    });

    if (!budgetDecision.allowed) {
      throw new BadDataException(budgetDecision.reason as string);
    }

    /*
     * Metered-path provider resolution: project-owned first, else the global
     * provider — on cloud too, because this call is executed through
     * AIService.executeWithLogging and therefore billed/logged/budgeted.
     * See getLlmProviderForMeteredAgentPath for the full rationale.
     */
    const llmProvider: LlmProvider | null =
      await LlmProviderService.getLlmProviderForMeteredAgentPath(run.projectId);

    if (!llmProvider || !llmProvider.id) {
      throw new BadDataException(
        "No LLM provider is available for this fix run. Add one in Project Settings > AI > LLM Providers. Self-hosted instances can alternatively set the GLOBAL_LLM_PROVIDER_* environment variables to register a global provider for every project.",
      );
    }

    const maxTokens: number =
      request.maxTokens && request.maxTokens > 0
        ? Math.min(request.maxTokens, MAX_TOKENS_PER_COMPLETION_CALL)
        : MAX_TOKENS_PER_COMPLETION_CALL;

    const response: AILogResponse = await AIService.executeWithLogging({
      projectId: run.projectId,
      feature: AI_CODE_FIX_FEATURE,
      aiRunId: request.aiRunId,
      llmProviderId: llmProvider.id,
      messages: request.messages,
      tools: request.tools,
      maxTokens: maxTokens,
      /*
       * Prompts embed customer source code, whose ACLs are narrower than
       * LlmLog's project-wide readability — never store previews.
       */
      storeContentPreviews: false,
    });

    /*
     * A completion call proves the worker is alive — refresh the heartbeat
     * so long-thinking loops are not swept as stale (the task-log route does
     * the same for progress logs).
     */
    await AIRunService.updateOneBy({
      query: {
        _id: request.aiRunId.toString(),
        status: AIRunStatus.Running,
      },
      data: {
        lastHeartbeatAt: OneUptimeDate.getCurrentDate(),
      } as never,
      props: {
        isRoot: true,
      },
    });

    const toolCalls: Array<LLMToolCall> = response.toolCalls || [];

    /*
     * Record this call on the run's transcript. This is the only place a
     * code-fix run's LLM content is persisted — LlmLog holds the metering and
     * deliberately redacts the content just above — so it is what the Logs
     * page reads to show what the model was actually asked and answered.
     */
    await AIRunEventService.appendEventToRun({
      projectId: run.projectId,
      aiRunId: request.aiRunId,
      eventType: AIRunEventType.LlmCallCompleted,
      resultSummary: {
        durationInMs: response.llmLog.durationMs,
        message: `LLM call ${usage.completionCalls + 1} of ${MAX_COMPLETION_CALLS_PER_RUN} — ${
          toolCalls.length > 0
            ? `requested ${toolCalls.length} tool call(s)`
            : "returned a final answer"
        }`,
      },
      contentPayload: {
        requestMessages: this.getNewMessagesForTranscript(request.messages),
        responseContent: response.content,
        responseToolCalls: toolCalls.map((toolCall: LLMToolCall) => {
          return {
            ...(toolCall.id ? { id: toolCall.id } : {}),
            name: toolCall.name,
            ...(toolCall.arguments ? { arguments: toolCall.arguments } : {}),
          };
        }),
        ...(llmProvider.modelName ? { modelName: llmProvider.modelName } : {}),
        stopReason: toolCalls.length > 0 ? "tool_use" : "stop",
        completionTokens: response.llmLog.completionTokens,
        totalTokens: response.llmLog.totalTokens,
      },
    });

    return {
      content: response.content,
      toolCalls: toolCalls,
      stopReason: toolCalls.length > 0 ? "tool_use" : "stop",
      budget: {
        completionCallsUsed: usage.completionCalls + 1,
        maxCompletionCalls: MAX_COMPLETION_CALLS_PER_RUN,
        outputTokensUsed:
          usage.outputTokens + (response.llmLog.completionTokens || 0),
        maxOutputTokens: MAX_OUTPUT_TOKENS_PER_RUN,
      },
    };
  }

  /*
   * The messages that are NEW on this call.
   *
   * The worker replays its whole conversation on every call, so recording
   * `request.messages` verbatim each time would store the history again and
   * again — quadratic in the turn count, on prompts that embed source files.
   *
   * Everything up to and including the last assistant message has already been
   * recorded: the earlier turns by earlier calls, and the trailing assistant
   * message as the previous event's `responseContent`. So the new content is
   * exactly the tail after the last assistant message — the tool results (and
   * any wind-down nudge) the worker appended since. On the first call there is
   * no assistant message yet and the tail is the whole array, which is what we
   * want: the system prompt and the opening instruction.
   *
   * Concatenating every event's requestMessages + responseContent in sequence
   * order therefore reproduces the entire session, each part stored once.
   */
  private static getNewMessagesForTranscript(
    messages: Array<LLMMessage>,
  ): Array<{ role: string; content: string }> {
    let lastAssistantIndex: number = -1;

    for (let i: number = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === "assistant") {
        lastAssistantIndex = i;
        break;
      }
    }

    return messages.slice(lastAssistantIndex + 1).map((message: LLMMessage) => {
      return {
        role: message.role,
        content: message.content || "",
      };
    });
  }
}
