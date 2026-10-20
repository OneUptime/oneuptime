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
import {
  AgentCompletionLoopBudget,
  LoopBudgetDecision,
  MAX_COMPLETION_CALLS_PER_RUN,
  MAX_OUTPUT_TOKENS_PER_RUN,
  MAX_TELEMETRY_TOOL_CALLS_PER_RUN,
} from "./CodeFixAgentCompletion";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
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
 * Calls are budgeted by the server, on the run:
 *
 *   - at most MAX_TELEMETRY_TOOL_CALLS_PER_RUN, counted on the run's
 *     toolCallCount by one conditional UPDATE (AIRunService
 *     .reserveCodeAgentToolCall), so neither a restarted worker nor two
 *     calls at once get more;
 *   - each one counts against the run's MAX_COMPLETION_CALLS_PER_RUN with
 *     its LLM calls (CodeFixAgentCompletion), and a call that would leave
 *     the run no call for its final answer, or comes after its output
 *     tokens are spent, is refused - so a run that queries production ends
 *     inside the budgets it always had;
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
  budget: AgentCompletionLoopBudget;
}

export interface CodeAgentTelemetryCallResult {
  output: string;
  rowCount: number;
  citationLabel: string;
  isTruncated: boolean;
  // After this call.
  budget: AgentCompletionLoopBudget;
}

function buildBudget(data: {
  completionCalls: number;
  outputTokens: number;
  toolCalls: number;
}): AgentCompletionLoopBudget {
  return {
    completionCallsUsed: data.completionCalls + data.toolCalls,
    maxCompletionCalls: MAX_COMPLETION_CALLS_PER_RUN,
    outputTokensUsed: data.outputTokens,
    maxOutputTokens: MAX_OUTPUT_TOKENS_PER_RUN,
    toolCallsUsed: data.toolCalls,
    maxToolCalls: MAX_TELEMETRY_TOOL_CALLS_PER_RUN,
  };
}

export default class CodeAgentTelemetry {
  /*
   * Whether the run may make one more production telemetry tool call - pure,
   * so it is directly testable, like CodeFixAgentCompletion's loop budget.
   */
  public static evaluateToolCallBudget(data: {
    completionCalls: number;
    outputTokens: number;
    toolCalls: number;
  }): LoopBudgetDecision {
    if (data.toolCalls >= MAX_TELEMETRY_TOOL_CALLS_PER_RUN) {
      return {
        allowed: false,
        reason: `This run has made all ${MAX_TELEMETRY_TOOL_CALLS_PER_RUN} of its production telemetry queries. Finish with what they showed.`,
      };
    }

    // The call itself, and one left for the run's final answer.
    if (
      data.completionCalls + data.toolCalls + 2 >
      MAX_COMPLETION_CALLS_PER_RUN
    ) {
      return {
        allowed: false,
        reason: `Another production telemetry query would leave this run no call for its final answer (${data.completionCalls} completion calls and ${data.toolCalls} queries, of ${MAX_COMPLETION_CALLS_PER_RUN} calls). Finish with what you have.`,
      };
    }

    if (data.outputTokens >= MAX_OUTPUT_TOKENS_PER_RUN) {
      return {
        allowed: false,
        reason: `This run has spent its output-token budget (${data.outputTokens.toLocaleString()} of ${MAX_OUTPUT_TOKENS_PER_RUN.toLocaleString()}), so it may not query production any more. Finish with what you have.`,
      };
    }

    return { allowed: true, reason: null };
  }

  /*
   * The tools a run is offered, the repository and services they read, and
   * the run's budget - or no tools, and why.
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

    const usage: { completionCalls: number; outputTokens: number } =
      await LlmLogService.getRunCompletionUsage({ aiRunId: data.aiRunId });

    const budget: AgentCompletionLoopBudget = buildBudget({
      completionCalls: usage.completionCalls,
      outputTokens: usage.outputTokens,
      toolCalls: telemetryRun.run.toolCallCount || 0,
    });

    if (!offer.scope) {
      return {
        tools: [],
        repository: null,
        services: [],
        reason: offer.reason,
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
      budget,
    };
  }

  /*
   * One production telemetry tool call of a run. Every refusal - a run the
   * agent may not read for, a tool that does not exist, arguments outside
   * the run's scope, a spent budget - throws a BadDataException whose
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

    const usage: { completionCalls: number; outputTokens: number } =
      await LlmLogService.getRunCompletionUsage({ aiRunId: data.aiRunId });
    const toolCalls: number = telemetryRun.run.toolCallCount || 0;

    const decision: LoopBudgetDecision = this.evaluateToolCallBudget({
      completionCalls: usage.completionCalls,
      outputTokens: usage.outputTokens,
      toolCalls: toolCalls,
    });

    if (!decision.allowed) {
      throw new BadDataException(decision.reason as string);
    }

    const isCounted: boolean = await AIRunService.reserveCodeAgentToolCall({
      aiRunId: data.aiRunId,
      aiAgentId: data.aiAgent.id,
      maxToolCalls: MAX_TELEMETRY_TOOL_CALLS_PER_RUN,
    });

    if (!isCounted) {
      throw new BadDataException(
        `This run has made all ${MAX_TELEMETRY_TOOL_CALLS_PER_RUN} of its production telemetry queries, or is no longer running. Finish with what they showed.`,
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
      budget: buildBudget({
        completionCalls: usage.completionCalls,
        outputTokens: usage.outputTokens,
        toolCalls: toolCalls + 1,
      }),
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
