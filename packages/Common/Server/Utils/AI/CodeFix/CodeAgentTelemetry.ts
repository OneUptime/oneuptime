import AIRunService from "../../../Services/AIRunService";
import LlmLogService from "../../../Services/LlmLogService";
import { LLMToolDefinition } from "../../LLM/LLMService";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import CodeAgentTelemetryScope, {
  CodeAgentScopedService,
  CodeAgentTelemetryOffer,
  CodeAgentTelemetryRun,
} from "./CodeAgentTelemetryScope";
import CodeAgentTelemetryTools, {
  CodeAgentTelemetryTool,
  CodeAgentTelemetryToolOutput,
  PreparedTelemetryRead,
} from "./CodeAgentTelemetryTools";
import { CodeFixAgentIdentity } from "./CodeFixAgentAuth";
import CodeFixAgentCompletion, {
  AgentCompletionLoopBudget,
  CodeAgentServerUsage,
} from "./CodeFixAgentCompletion";
import AIRunLimitsReader from "../AIRunLimitsReader";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIAgentRunLimitsHelper, {
  AIAgentRunLimits,
  AIRunStopReason,
} from "../../../../Types/AI/AIAgentRunLimits";
import CodeAgentRunLimitsUtil, {
  CodeAgentRunLimits,
} from "../../../../Types/AI/CodeAgentRunLimits";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * PRODUCTION TELEMETRY FOR THE CODE AGENT, SERVED BY THE SERVER.
 *
 * The Runner's in-house code agent asks for its production telemetry tools
 * (listTools) when a recipe wants them - a review of a pull request, a fix
 * of an exception, a slow trace or an incident - and runs each call here
 * (runTool), through /ai-agent-data/get-telemetry-tools and
 * /ai-agent-data/run-telemetry-tool. The Runner holds no credential that
 * reads telemetry, and the worker names only its run: the project, the
 * repository and the services the tools may read follow from the run
 * (CodeAgentTelemetryScope), and every tool holds its reads to them
 * (CodeAgentTelemetryTools).
 *
 * Calls are counted by the server, on the run's toolCallCount, by one
 * conditional UPDATE (AIRunService.reserveCodeAgentToolCall), so neither a
 * restarted worker nor two calls at once get past a limit. How many a run
 * makes is up to its work (issue #6440): it is held only to the run's own
 * limits (Types/AI/AIAgentRunLimits) -
 *
 *   - the project's tool calls per run, when it set that limit (the agent
 *     counts its file and command tools against it too; the server, the
 *     calls it runs);
 *   - the run's time limit, and the project's model calls and tokens per
 *     run: once the run may make no more model calls, nothing would read
 *     what a query returns, so it is refused;
 *   - a call whose arguments are refused reads nothing and is not counted.
 *
 * What a call returns is capped at MAX_TELEMETRY_TOOL_OUTPUT_CHARS: it
 * goes into every later completion of the run.
 */

// The longest a call's result runs.
export const MAX_TELEMETRY_TOOL_OUTPUT_CHARS: number = 12_000;

// How long one call may read before it is answered with a timeout.
export const TELEMETRY_TOOL_TIMEOUT_MS: number = 45_000;

export interface CodeAgentTelemetryToolList {
  // Empty when the run is offered none (reason says why).
  tools: Array<LLMToolDefinition>;
  // "acme/checkout": the repository the tools read for.
  repository: string | null;
  services: Array<{
    id: string;
    name: string;
    pathInRepository: string | null;
  }>;
  reason: string | null;
  // The run's limits and what it has used (Types/AI/CodeAgentRunLimits).
  limits: CodeAgentRunLimits;
  // The same for a Runner from before #6440.
  budget: AgentCompletionLoopBudget;
}

export interface CodeAgentTelemetryCallResult {
  output: string;
  rowCount: number;
  citationLabel: string;
  isTruncated: boolean;
  // After this call.
  limits: CodeAgentRunLimits;
  budget: AgentCompletionLoopBudget;
}

export interface TelemetryToolCallDecision {
  allowed: boolean;
  // Set when not allowed: why, naming the setting, for the model.
  reason: string | null;
}

// What the server knows of a run, for the limits it tells the worker.
interface TelemetryRunState {
  limits: AIAgentRunLimits;
  usage: {
    completionCalls: number;
    outputTokens: number;
    totalTokens: number;
  };
  deadlineAtMs: number | null;
}

function describeLimits(data: {
  state: TelemetryRunState;
  startedAt: Date | undefined;
  toolCalls: number;
}): { limits: CodeAgentRunLimits; budget: AgentCompletionLoopBudget } {
  return {
    limits: CodeAgentRunLimitsUtil.build({
      limits: data.state.limits,
      startedAt: data.startedAt,
      modelCallsUsed: data.state.usage.completionCalls,
      toolCallsUsed: data.toolCalls,
      tokensUsed: data.state.usage.totalTokens || 0,
    }),
    budget: CodeFixAgentCompletion.buildLegacyBudget({
      limits: data.state.limits,
      completionCalls: data.state.usage.completionCalls,
      outputTokens: data.state.usage.outputTokens,
      toolCalls: data.toolCalls,
    }),
  };
}

export default class CodeAgentTelemetry {
  /*
   * Whether the run may make one more production telemetry tool call -
   * pure, so it is directly testable, like CodeFixAgentCompletion
   * .evaluateRunLimits. Only a limit the run really has refuses one: the
   * project's tool calls per run, or - since nothing would read what the
   * call returns - a run that may make no more model calls (its time is up,
   * or the project's model calls or tokens per run are reached).
   */
  public static evaluateToolCall(data: {
    limits: AIAgentRunLimits;
    usage: CodeAgentServerUsage;
    toolCalls: number;
    nowMs: number;
    deadlineAtMs: number | null;
  }): TelemetryToolCallDecision {
    const refuse: (reason: AIRunStopReason) => TelemetryToolCallDecision = (
      reason: AIRunStopReason,
    ): TelemetryToolCallDecision => {
      return {
        allowed: false,
        reason: `${AIAgentRunLimitsHelper.getRefusal(reason, data.limits)} Finish with what you have.`,
      };
    };

    if (
      data.limits.maxToolCalls !== undefined &&
      data.toolCalls >= data.limits.maxToolCalls
    ) {
      return refuse(AIRunStopReason.ToolCalls);
    }

    if (data.deadlineAtMs !== null && data.nowMs >= data.deadlineAtMs) {
      return refuse(AIRunStopReason.TimeLimit);
    }

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

    return { allowed: true, reason: null };
  }

  /*
   * The tools a run is offered, the repository and services they read, and
   * the run's limits - or no tools, and why.
   */
  @CaptureSpan()
  public static async listTools(data: {
    aiAgent: CodeFixAgentIdentity;
    aiRunId: ObjectID;
  }): Promise<CodeAgentTelemetryToolList> {
    const telemetryRun: CodeAgentTelemetryRun =
      await CodeAgentTelemetryScope.readRun(data);

    const offer: CodeAgentTelemetryOffer =
      await CodeAgentTelemetryScope.getOffer(telemetryRun);

    const state: TelemetryRunState = await CodeAgentTelemetry.readRunState(
      telemetryRun,
      data.aiRunId,
    );

    const { limits, budget } = describeLimits({
      state,
      startedAt: telemetryRun.run.startedAt,
      toolCalls: telemetryRun.run.toolCallCount || 0,
    });

    if (!offer.scope) {
      return {
        tools: [],
        repository: null,
        services: [],
        reason: offer.reason,
        limits,
        budget,
      };
    }

    return {
      tools: CodeAgentTelemetryTools.getTools().map(
        (tool: CodeAgentTelemetryTool): LLMToolDefinition => {
          return {
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          };
        },
      ),
      repository: offer.scope.repositoryFullName,
      services: offer.scope.services.map(
        (
          service: CodeAgentScopedService,
        ): { id: string; name: string; pathInRepository: string | null } => {
          return {
            id: service.id,
            name: service.name,
            pathInRepository: service.pathInRepository,
          };
        },
      ),
      reason: null,
      limits,
      budget,
    };
  }

  /*
   * One production telemetry tool call of a run. Every refusal - a run the
   * agent may not read for, a tool that does not exist, arguments outside
   * the run's scope, a limit the run reached - throws a BadDataException whose
   * message the worker hands the model; a read that fails once counted is
   * answered as an error result.
   */
  @CaptureSpan()
  public static async runTool(data: {
    aiAgent: CodeFixAgentIdentity;
    aiRunId: ObjectID;
    toolName: string;
    args: JSONObject;
  }): Promise<CodeAgentTelemetryCallResult> {
    const telemetryRun: CodeAgentTelemetryRun =
      await CodeAgentTelemetryScope.readRun(data);

    const offer: CodeAgentTelemetryOffer =
      await CodeAgentTelemetryScope.getOffer(telemetryRun);

    if (!offer.scope) {
      throw new BadDataException(offer.reason);
    }

    const tool: CodeAgentTelemetryTool | undefined =
      CodeAgentTelemetryTools.getTool(data.toolName);

    if (!tool) {
      throw new BadDataException(
        `"${data.toolName.substring(0, 100)}" is not a production telemetry tool. The tools are: ${CodeAgentTelemetryTools.getTools()
          .map((available: CodeAgentTelemetryTool): string => {
            return available.name;
          })
          .join(", ")}.`,
      );
    }

    if (
      !data.args ||
      typeof data.args !== "object" ||
      Array.isArray(data.args)
    ) {
      throw new BadDataException(
        `The arguments of ${tool.name} must be a JSON object.`,
      );
    }

    // Arguments first: a call they refuse reads nothing and costs nothing.
    const read: PreparedTelemetryRead = tool.prepare(data.args, offer.scope);

    const state: TelemetryRunState = await CodeAgentTelemetry.readRunState(
      telemetryRun,
      data.aiRunId,
    );
    const toolCalls: number = telemetryRun.run.toolCallCount || 0;

    const decision: TelemetryToolCallDecision = this.evaluateToolCall({
      limits: state.limits,
      usage: {
        modelCalls: state.usage.completionCalls,
        tokens: state.usage.totalTokens || 0,
      },
      toolCalls: toolCalls,
      nowMs: OneUptimeDate.getCurrentDate().getTime(),
      deadlineAtMs: state.deadlineAtMs,
    });

    if (!decision.allowed) {
      throw new BadDataException(decision.reason as string);
    }

    const isCounted: boolean = await AIRunService.reserveCodeAgentToolCall({
      aiRunId: data.aiRunId,
      aiAgentId: data.aiAgent.id,
      maxToolCalls: state.limits.maxToolCalls ?? null,
    });

    if (!isCounted) {
      throw new BadDataException(
        state.limits.maxToolCalls !== undefined
          ? `This run may make no more production telemetry calls: it has reached this project's limit of ${state.limits.maxToolCalls.toLocaleString("en-US")} tool calls per run, or it is no longer running. Finish with what you have.`
          : "This run is no longer running, so it may make no more production telemetry calls.",
      );
    }

    const output: CodeAgentTelemetryToolOutput =
      await CodeAgentTelemetry.readWithTimeout({
        toolName: tool.name,
        read,
      });

    // A call proves the worker is alive, as a completion does.
    await AIRunService.updateOneBy({
      query: {
        _id: data.aiRunId.toString(),
        status: AIRunStatus.Running,
      },
      data: {
        lastHeartbeatAt: OneUptimeDate.getCurrentDate(),
      } as never,
      props: { isRoot: true },
    });

    const isClipped: boolean =
      output.text.length > MAX_TELEMETRY_TOOL_OUTPUT_CHARS;

    return {
      output: isClipped
        ? `${output.text.substring(0, MAX_TELEMETRY_TOOL_OUTPUT_CHARS)}\n… [truncated: narrow the query - a shorter window, one service, fewer paths]`
        : output.text,
      rowCount: output.rowCount,
      citationLabel: output.citationLabel,
      isTruncated: output.isTruncated || isClipped,
      ...describeLimits({
        state,
        startedAt: telemetryRun.run.startedAt,
        toolCalls: toolCalls + 1,
      }),
    };
  }

  /*
   * The run's limits (its project's), what it has used so far - counted
   * from its own LlmLog rows - and when its time is up: from when this
   * attempt was claimed, or never for a run whose start is not recorded.
   */
  private static async readRunState(
    telemetryRun: CodeAgentTelemetryRun,
    aiRunId: ObjectID,
  ): Promise<TelemetryRunState> {
    const limits: AIAgentRunLimits = await AIRunLimitsReader.read({
      projectId: telemetryRun.projectId,
    });

    const usage: {
      completionCalls: number;
      outputTokens: number;
      totalTokens: number;
    } = await LlmLogService.getRunCompletionUsage({ aiRunId });

    const startedAtMs: number | null = telemetryRun.run.startedAt
      ? new Date(telemetryRun.run.startedAt).getTime()
      : null;

    return {
      limits,
      usage,
      deadlineAtMs:
        startedAtMs !== null && Number.isFinite(startedAtMs)
          ? AIAgentRunLimitsHelper.getDeadlineAtMs(limits, startedAtMs)
          : null,
    };
  }

  // The read, answered as an error result when it fails or takes too long.
  private static async readWithTimeout(data: {
    toolName: string;
    read: PreparedTelemetryRead;
  }): Promise<CodeAgentTelemetryToolOutput> {
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;

    try {
      return await Promise.race([
        data.read(),
        new Promise<never>(
          (_resolve: unknown, reject: (error: Error) => void): void => {
            timer = setTimeout(() => {
              reject(new Error("the read timed out"));
            }, TELEMETRY_TOOL_TIMEOUT_MS);
          },
        ),
      ]);
    } catch (error) {
      const message: string =
        error instanceof Error ? error.message : String(error);

      logger.error(
        `Code agent telemetry tool ${data.toolName} failed: ${message}`,
      );

      return {
        text: `Error: ${data.toolName} could not read production telemetry (${message}). Continue with what you have.`,
        rowCount: 0,
        citationLabel: data.toolName,
        isTruncated: false,
      };
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
