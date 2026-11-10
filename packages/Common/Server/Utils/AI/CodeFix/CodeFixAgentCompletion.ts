import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import AIAgentRunLimitsHelper, {
  AIAgentRunLimits,
  AIRunStopReason,
} from "../../../../Types/AI/AIAgentRunLimits";
import CodeAgentRunLimitsUtil, {
  CodeAgentRunLimits,
} from "../../../../Types/AI/CodeAgentRunLimits";
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
import AIRunLimitsReader from "../AIRunLimitsReader";
import LlmProviderChoice, { RuleLlmProviderChoice } from "../LlmProviderChoice";
import { LlmProviderActivity } from "../../../../Types/AI/LlmProviderChoice";
import AiTokenCount from "../../../../Types/AI/AiTokenCount";
import {
  LLMMessage,
  LLMToolCall,
  LLMToolDefinition,
} from "../../LLM/LLMService";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * Server-mediated LLM completions for the in-house code-fix agent (B4 Tier
 * 0, Docs/Internal/Roadmap/CodeFixSandboxDesign.md). The worker never holds a
 * provider secret: every completion of its tool loop is executed HERE via
 * AIService.executeWithLogging — logged to LlmLog, linked to the run, billed
 * when the provider is the costed global one, and inside the project's
 * daily limits.
 *
 * A run has the limits every OneUptime AI run has (issue #6440,
 * Types/AI/AIAgentRunLimits): no cap on its model calls or tokens unless the
 * project set one (Project Settings → AI → AI Features → More settings →
 * Limits per run), and a time limit - DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES
 * unless the project set its own - from when the run was claimed. The
 * server holds the ones it can count, not trusting the worker: model calls
 * and tokens from the run's own LlmLog rows (one row per executeWithLogging
 * call, success or error), so the count survives worker restarts and cannot
 * be reset from outside the server, and the time from the run's start. It
 * tells the worker the limits and what the run has used with every answer
 * (`limits`, Types/AI/CodeAgentRunLimits), so the worker winds down before
 * them and the run ends with an honest summary.
 */

/*
 * The most one call may write - what a single answer may run to, not a
 * limit on the run.
 */
export const MAX_TOKENS_PER_COMPLETION_CALL: number = 16_384;

/*
 * Once a run's time is up, a call is still served - without tools, so it
 * can only be the run's answer - for this long: the worker winds down at the
 * deadline, and needs that one call to write what it changed.
 */
export const CODE_AGENT_ANSWER_GRACE_MS: number = 5 * 60 * 1000;

/*
 * What a Runner from before #6440 reads: the `budget` it always wound down
 * on - 40 calls, 100,000 output tokens and 12 production telemetry calls,
 * or the project's cap when that is lower. Such a Runner stops itself at 40
 * calls whatever it is told, so these keep it working as it did; the server
 * holds no run to them. Upgrading the Runner lifts them.
 */
export const LEGACY_MAX_COMPLETION_CALLS: number = 40;
export const LEGACY_MAX_OUTPUT_TOKENS: number = 100_000;
export const LEGACY_MAX_TELEMETRY_TOOL_CALLS: number = 12;

/*
 * The usage a Runner from before #6440 winds down on (`budget` in the
 * answer). A current Runner reads `limits` instead.
 */
export interface AgentCompletionLoopBudget {
  /*
   * The run's calls so far: its LLM completions and its production
   * telemetry tool calls, which such a Runner counts together.
   */
  completionCallsUsed: number;
  maxCompletionCalls: number;
  outputTokensUsed: number;
  maxOutputTokens: number;
  // Of completionCallsUsed, the production telemetry tool calls.
  toolCallsUsed: number;
  maxToolCalls: number;
}

// What a run has used so far, as the server counts it.
export interface CodeAgentServerUsage {
  // Model calls: the run's LlmLog rows.
  modelCalls: number;
  // Tokens, as OneUptime counts them (AiTokenCount).
  tokens: number;
}

export interface CodeAgentLimitDecision {
  allowed: boolean;
  // Set when not allowed: why, naming the setting (AIAgentRunLimits.getRefusal).
  reason: string | null;
  /*
   * The call is served as the run's answer: without tools, since the run's
   * time is up.
   */
  withoutTools: boolean;
  // The limit reached, when one is.
  stopReason: AIRunStopReason | null;
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
  // The run's limits and its usage after this call, so the worker winds down before them.
  limits: CodeAgentRunLimits;
  // The same for a Runner from before #6440.
  budget: AgentCompletionLoopBudget;
}

export default class CodeFixAgentCompletion {
  /*
   * Whether a run may make one more model call - pure, separated from IO so
   * it is directly testable (the FixRunBudget idiom). Only the caps the
   * project set count, and the time limit: none is reached by a run that
   * does as much as its work needs. In order:
   *
   *   - its model calls reach the project's cap: refused;
   *   - its tokens reach the project's cap: refused;
   *   - its time is up for longer than CODE_AGENT_ANSWER_GRACE_MS: refused;
   *   - its time is up: served, without tools - the run's answer.
   */
  public static evaluateRunLimits(data: {
    limits: AIAgentRunLimits;
    usage: CodeAgentServerUsage;
    nowMs: number;
    // Null for a run whose start is not recorded: no time limit is held here.
    deadlineAtMs: number | null;
  }): CodeAgentLimitDecision {
    const refuse: (reason: AIRunStopReason) => CodeAgentLimitDecision = (
      reason: AIRunStopReason,
    ): CodeAgentLimitDecision => {
      return {
        allowed: false,
        reason: AIAgentRunLimitsHelper.getRefusal(reason, data.limits),
        withoutTools: false,
        stopReason: reason,
      };
    };

    if (
      data.limits.maxLlmCalls !== undefined &&
      data.usage.modelCalls >= data.limits.maxLlmCalls
    ) {
      return refuse(AIRunStopReason.ModelCalls);
    }

    if (
      data.limits.maxTokens !== undefined &&
      data.usage.tokens >= data.limits.maxTokens
    ) {
      return refuse(AIRunStopReason.Tokens);
    }

    if (data.deadlineAtMs !== null) {
      if (data.nowMs >= data.deadlineAtMs + CODE_AGENT_ANSWER_GRACE_MS) {
        return refuse(AIRunStopReason.TimeLimit);
      }

      if (data.nowMs >= data.deadlineAtMs) {
        return {
          allowed: true,
          reason: null,
          withoutTools: true,
          stopReason: AIRunStopReason.TimeLimit,
        };
      }
    }

    return {
      allowed: true,
      reason: null,
      withoutTools: false,
      stopReason: null,
    };
  }

  /*
   * What a Runner from before #6440 is told (`budget`): the numbers it
   * always wound down on, or the project's caps when they are lower.
   */
  public static buildLegacyBudget(data: {
    limits: AIAgentRunLimits;
    // LLM completions, this one included.
    completionCalls: number;
    outputTokens: number;
    toolCalls: number;
  }): AgentCompletionLoopBudget {
    return {
      completionCallsUsed: data.completionCalls + data.toolCalls,
      maxCompletionCalls: Math.min(
        LEGACY_MAX_COMPLETION_CALLS,
        data.limits.maxLlmCalls ?? LEGACY_MAX_COMPLETION_CALLS,
      ),
      outputTokensUsed: data.outputTokens,
      maxOutputTokens: LEGACY_MAX_OUTPUT_TOKENS,
      toolCallsUsed: data.toolCalls,
      maxToolCalls: Math.min(
        LEGACY_MAX_TELEMETRY_TOOL_CALLS,
        data.limits.maxToolCalls ?? LEGACY_MAX_TELEMETRY_TOOL_CALLS,
      ),
    };
  }

  /*
   * Validate the run, hold it to its limits, resolve the provider on the
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
        triggeredByIncidentId: true,
        triggeredByAlertId: true,
        toolCallCount: true,
        // When this attempt was claimed: its time limit runs from here.
        startedAt: true,
        // The LLM provider the rule behind the run picked, if any.
        llmProviderId: true,
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

    // The run's limits, and what it has used - counted from its own LlmLog rows.
    const limits: AIAgentRunLimits = await AIRunLimitsReader.read({
      projectId: run.projectId,
    });

    const usage: {
      completionCalls: number;
      outputTokens: number;
      totalTokens: number;
    } = await LlmLogService.getRunCompletionUsage({ aiRunId: request.aiRunId });

    // The production telemetry tool calls the server ran for the run.
    const telemetryToolCalls: number = run.toolCallCount || 0;

    const startedAtMs: number | null = run.startedAt
      ? new Date(run.startedAt).getTime()
      : null;
    const deadlineAtMs: number | null =
      startedAtMs !== null && Number.isFinite(startedAtMs)
        ? AIAgentRunLimitsHelper.getDeadlineAtMs(limits, startedAtMs)
        : null;

    const decision: CodeAgentLimitDecision = this.evaluateRunLimits({
      limits,
      usage: {
        modelCalls: usage.completionCalls,
        tokens: usage.totalTokens || 0,
      },
      nowMs: OneUptimeDate.getCurrentDate().getTime(),
      deadlineAtMs,
    });

    if (!decision.allowed) {
      throw new BadDataException(decision.reason as string);
    }

    /*
     * The project's AI kill switch, before the provider is resolved. This
     * route is reached by an authenticated agent worker rather than a
     * browser, so a throw is the correct delivery: /ai-agent-data/
     * llm-completion turns it into an error response the worker reads and
     * stops its loop on.
     */
    await AIService.assertProjectAIEnabled(run.projectId);

    /*
     * The LLM provider the rule behind the run picked (AIRun.llmProviderId),
     * when it can be used (Server/Utils/AI/LlmProviderChoice). Otherwise -
     * no rule picked one, or its pick cannot be used - metered-path
     * provider resolution: project-owned first, else the global provider —
     * on cloud too, because this call is executed through
     * AIService.executeWithLogging and therefore billed, logged and held to
     * the project's daily limits. See getLlmProviderForMeteredAgentPath for
     * the full rationale.
     */
    const llmProviderChoice: RuleLlmProviderChoice =
      await LlmProviderChoice.decideIfPicked({
        projectId: run.projectId,
        pickedProviderId: run.llmProviderId,
      });

    const llmProvider: LlmProvider | null =
      llmProviderChoice.llmProviderId && llmProviderChoice.providerRow
        ? llmProviderChoice.providerRow
        : await LlmProviderService.getLlmProviderForMeteredAgentPath(
            run.projectId,
          );

    /*
     * A run a rule picked a provider for says, on its first completion,
     * which provider it uses - or why it uses another - as a step of the
     * task (CodeTaskSteps draws the English message).
     */
    if (usage.completionCalls === 0) {
      const activity: LlmProviderActivity | null =
        LlmProviderChoice.getFallbackActivity({
          choice: llmProviderChoice,
          usedProvider: llmProvider,
        });

      if (activity) {
        await AIRunEventService.appendEventToRun({
          projectId: run.projectId,
          aiRunId: request.aiRunId,
          eventType: AIRunEventType.ProgressLog,
          resultSummary: LlmProviderChoice.getActivityEventSummary(activity),
        });
      }
    }

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
      incidentId: run.triggeredByIncidentId,
      alertId: run.triggeredByAlertId,
      llmProviderId: llmProvider.id,
      messages: request.messages,
      // A run whose time is up gets its answer, not more tools.
      tools: decision.withoutTools ? undefined : request.tools,
      maxTokens: maxTokens,
      /*
       * Prompts embed customer source code, whose ACLs are narrower than
       * LlmLog's project-wide readability — never store previews.
       */
      storeContentPreviews: false,
      /*
       * The agent reads source files and writes them back whole: a data:
       * URL in a stylesheet or a fixture is code, and a short note in its
       * place would be written into the pull request. The one call that
       * keeps embedded data.
       */
      keepEmbeddedData: true,
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

    const toolCalls: Array<LLMToolCall> = decision.withoutTools
      ? []
      : response.toolCalls || [];
    const callNumber: number = usage.completionCalls + 1;

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
        message: `LLM call ${callNumber}${
          limits.maxLlmCalls !== undefined ? ` of ${limits.maxLlmCalls}` : ""
        } — ${
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

    const callTokens: number = AiTokenCount.count(response.llmLog);

    return {
      content: response.content,
      toolCalls: toolCalls,
      stopReason: toolCalls.length > 0 ? "tool_use" : "stop",
      limits: CodeAgentRunLimitsUtil.build({
        limits,
        startedAt: run.startedAt,
        modelCallsUsed: callNumber,
        toolCallsUsed: telemetryToolCalls,
        tokensUsed: (usage.totalTokens || 0) + callTokens,
        lastCallTokens: callTokens,
      }),
      budget: this.buildLegacyBudget({
        limits,
        completionCalls: callNumber,
        outputTokens:
          usage.outputTokens + (response.llmLog.completionTokens || 0),
        toolCalls: telemetryToolCalls,
      }),
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
