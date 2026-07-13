import { IsBillingEnabled } from "../EnvironmentConfig";
import BaseService from "./BaseService";
import LlmProviderService from "./LlmProviderService";
import LlmLogService from "./LlmLogService";
import ProjectService from "./ProjectService";
import Project from "../../Models/DatabaseModels/Project";
import AIBillingService from "./AIBillingService";
import LLMService, {
  LLMProviderConfig,
  LLMCompletionResponse,
  LLMMessage,
  LLMToolCall,
  LLMToolDefinition,
  LLMUsage,
} from "../Utils/LLM/LLMService";
import LlmType from "../../Types/LLM/LlmType";
import { Span, trace } from "@opentelemetry/api";
import LlmProvider from "../../Models/DatabaseModels/LlmProvider";
import LlmLog from "../../Models/DatabaseModels/LlmLog";
import LlmLogStatus from "../../Types/LlmLogStatus";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

/*
 * Features that run WITHOUT a human in the loop. The per-project daily token
 * budget (Project.aiDailyAutonomousTokenLimit, G4) applies only to these —
 * interactive chat and explicitly user-triggered AI are never budget-blocked.
 * Auto-postmortem is deliberately excluded for now: it is one call per
 * resolved incident, not storm-shaped; include it when it moves to the queue.
 */
export const AUTONOMOUS_AI_FEATURES: Array<string> = [
  "Sentinel Incident Investigation",
  "Sentinel Alert Investigation",
];

export interface AutonomousBudgetStatus {
  exhausted: boolean;
  // null when the project has no limit configured.
  limitInTokens: number | null;
  usedTokensToday: number;
}

export interface AILogRequest {
  projectId: ObjectID;
  userId?: ObjectID | undefined;
  feature: string; // e.g., "IncidentPostmortem", "IncidentNote"
  incidentId?: ObjectID;
  alertId?: ObjectID;
  scheduledMaintenanceId?: ObjectID;
  aiRunId?: ObjectID;
  /*
   * When set, use this specific provider (validated against the project) rather
   * than the project default. Powers the in-chat provider/model switcher.
   */
  llmProviderId?: ObjectID | undefined;
  messages: Array<LLMMessage>;
  tools?: Array<LLMToolDefinition> | undefined;
  maxTokens?: number | undefined;
  temperature?: number | undefined;
  /*
   * When false, prompt/response previews are NOT persisted to LlmLog.
   * Use for features whose content is private to a single user (e.g. AI
   * chat) — LlmLog is readable by all project members.
   */
  storeContentPreviews?: boolean | undefined;
}

export interface AILogResponse {
  content: string;
  toolCalls?: Array<LLMToolCall> | undefined;
  llmLog: LlmLog;
}

export class Service extends BaseService {
  public constructor() {
    super();
  }

  /*
   * G4 daily budget: has this project consumed its daily autonomous-token
   * allowance (UTC day)? Counts only AUTONOMOUS_AI_FEATURES tokens, so chat
   * usage neither eats the autonomous budget nor is blocked by it.
   */
  @CaptureSpan()
  public async getAutonomousDailyBudgetStatus(
    projectId: ObjectID,
  ): Promise<AutonomousBudgetStatus> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: { aiDailyAutonomousTokenLimit: true },
      props: { isRoot: true },
    });

    const limitInTokens: number | null =
      project?.aiDailyAutonomousTokenLimit ?? null;

    if (limitInTokens === null) {
      return { exhausted: false, limitInTokens: null, usedTokensToday: 0 };
    }

    /*
     * A limit of 0 (or negative) pauses autonomous runs entirely — the safe
     * reading of "0 tokens allowed", and doubles as a spend kill-switch.
     */
    if (limitInTokens <= 0) {
      return { exhausted: true, limitInTokens, usedTokensToday: 0 };
    }

    const usedTokensToday: number = await LlmLogService.getTotalTokensUsedSince(
      {
        projectId,
        since: OneUptimeDate.getStartOfDay(
          OneUptimeDate.getCurrentDate(),
          "UTC",
        ),
        features: AUTONOMOUS_AI_FEATURES,
      },
    );

    return {
      exhausted: usedTokensToday >= limitInTokens,
      limitInTokens,
      usedTokensToday,
    };
  }

  @CaptureSpan()
  public async executeWithLogging(
    request: AILogRequest,
  ): Promise<AILogResponse> {
    const startTime: Date = new Date();

    // Get LLM provider for the project (honoring an explicit per-chat choice).
    const llmProvider: LlmProvider | null =
      await LlmProviderService.getProviderForChat({
        projectId: request.projectId,
        llmProviderId: request.llmProviderId,
      });

    if (!llmProvider) {
      throw new BadDataException(
        "No LLM provider configured for this project. Please configure an LLM provider in Settings > AI > LLM Providers.",
      );
    }

    if (!llmProvider.llmType) {
      throw new BadDataException(
        "LLM provider type is not configured properly.",
      );
    }

    // Create log entry (will be updated after completion)
    const logEntry: LlmLog = new LlmLog();
    logEntry.projectId = request.projectId;
    logEntry.isGlobalProvider = llmProvider.isGlobalLlm || false;
    logEntry.feature = request.feature;

    const storeContentPreviews: boolean =
      request.storeContentPreviews !== false;

    logEntry.requestPrompt = storeContentPreviews
      ? request.messages
          .map((m: LLMMessage) => {
            return m.content;
          })
          .join("\n")
          .substring(0, 5000) // Store first 5000 chars
      : "[Redacted — this content is private to the requesting user]";
    logEntry.requestStartedAt = startTime;

    // Set optional fields only if they have values
    if (llmProvider.id) {
      logEntry.llmProviderId = llmProvider.id;
    }
    if (llmProvider.name) {
      logEntry.llmProviderName = llmProvider.name;
    }
    if (llmProvider.llmType) {
      logEntry.llmType = llmProvider.llmType;
    }
    if (llmProvider.modelName) {
      logEntry.modelName = llmProvider.modelName;
    }
    if (request.userId) {
      logEntry.userId = request.userId;
    }
    if (request.incidentId) {
      logEntry.incidentId = request.incidentId;
    }
    if (request.alertId) {
      logEntry.alertId = request.alertId;
    }
    if (request.scheduledMaintenanceId) {
      logEntry.scheduledMaintenanceId = request.scheduledMaintenanceId;
    }
    if (request.aiRunId) {
      logEntry.aiRunId = request.aiRunId;
    }

    /*
     * Check if billing should apply. Only bill for the global (OneUptime-hosted)
     * provider, and only when it actually has a per-token cost. A free global
     * provider (costPerMillionTokensInUSDCents = 0, the default) consumes no
     * balance, so it must not require or block on one either — otherwise a $0
     * provider would still fail with "Insufficient AI balance".
     */
    const shouldBill: boolean =
      IsBillingEnabled &&
      (llmProvider.isGlobalLlm || false) &&
      (llmProvider.costPerMillionTokensInUSDCents || 0) > 0;

    // Check balance if billing enabled and using global provider
    if (shouldBill) {
      const project: Project | null = await ProjectService.findOneById({
        id: request.projectId,
        select: { aiCurrentBalanceInUSDCents: true },
        props: { isRoot: true },
      });

      if (!project || (project.aiCurrentBalanceInUSDCents || 0) <= 0) {
        logEntry.status = LlmLogStatus.InsufficientBalance;
        logEntry.statusMessage = "Insufficient AI balance";
        logEntry.requestCompletedAt = new Date();
        logEntry.durationMs = new Date().getTime() - startTime.getTime();

        await LlmLogService.create({
          data: logEntry,
          props: { isRoot: true },
        });

        throw new BadDataException(
          "Insufficient AI balance. Please recharge your AI balance in Project Settings > AI Credits.",
        );
      }
    }

    /*
     * G4 daily budget enforcement — autonomous features only, mirroring the
     * InsufficientBalance path above. Autonomous runs fail closed on budget
     * (G9); interactive features are never blocked here. A run that crosses
     * the limit mid-flight errors on its next LLM call, which marks the AIRun
     * Error with this message — visible in the investigation panel.
     */
    if (AUTONOMOUS_AI_FEATURES.includes(request.feature)) {
      const budget: AutonomousBudgetStatus =
        await this.getAutonomousDailyBudgetStatus(request.projectId);

      if (budget.exhausted) {
        const budgetMessage: string = `Daily autonomous AI token budget exhausted (${budget.usedTokensToday.toLocaleString()} of ${budget.limitInTokens?.toLocaleString()} tokens used today). Autonomous investigations resume tomorrow (UTC) — raise or unset the limit in the AI settings pages.`;

        logEntry.status = LlmLogStatus.BudgetExceeded;
        logEntry.statusMessage = budgetMessage.substring(0, 490);
        logEntry.requestCompletedAt = new Date();
        logEntry.durationMs = new Date().getTime() - startTime.getTime();

        await LlmLogService.create({
          data: logEntry,
          props: { isRoot: true },
        });

        throw new BadDataException(budgetMessage);
      }
    }

    try {
      // Build LLM config
      const llmConfig: LLMProviderConfig = {
        llmType: llmProvider.llmType,
      };

      if (llmProvider.apiKey) {
        llmConfig.apiKey = llmProvider.apiKey;
      }

      if (llmProvider.baseUrl) {
        llmConfig.baseUrl = llmProvider.baseUrl.toString();
      }

      if (llmProvider.modelName) {
        llmConfig.modelName = llmProvider.modelName;
      }

      // Execute LLM call
      const response: LLMCompletionResponse = await LLMService.getCompletion({
        llmProviderConfig: llmConfig,
        messages: request.messages,
        temperature: request.temperature ?? 0.7,
        maxTokens: request.maxTokens,
        tools: request.tools,
        ...(llmProvider.additionalParams
          ? { additionalParams: llmProvider.additionalParams }
          : {}),
      });

      const endTime: Date = new Date();

      // Update log with success info
      logEntry.status = LlmLogStatus.Success;
      logEntry.totalTokens = response.usage?.totalTokens || 0;
      logEntry.cachedInputTokens = response.usage?.cachedInputTokens || 0;
      logEntry.cacheCreationTokens = response.usage?.cacheCreationTokens || 0;
      logEntry.responsePreview = storeContentPreviews
        ? response.content.substring(0, 2000) // Store first 2000 chars
        : "[Redacted — this content is private to the requesting user]";
      logEntry.requestCompletedAt = endTime;
      logEntry.durationMs = endTime.getTime() - startTime.getTime();

      // Calculate and apply costs if using global provider with billing enabled
      if (shouldBill && response.usage) {
        const totalCost: number = Math.ceil(
          (response.usage.totalTokens / 1_000_000) *
            (llmProvider.costPerMillionTokensInUSDCents || 0),
        );

        logEntry.costInUSDCents = totalCost;
        logEntry.wasBilled = true;

        // Deduct from project balance
        if (totalCost > 0) {
          /*
           * Atomic decrement — concurrent LLM calls within and across chat
           * turns must not lose each other's deductions (a read-modify-write
           * here silently forgave overlapping spend).
           */
          await ProjectService.deductAiBalanceInUSDCents({
            projectId: request.projectId,
            amountInUSDCents: totalCost,
          });

          // Check if auto-recharge is needed (do this async, don't wait)
          AIBillingService.rechargeIfBalanceIsLow(request.projectId).catch(
            (err: Error) => {
              logger.error("Error during AI balance auto-recharge check:", {
                projectId: request.projectId?.toString(),
                userId: request.userId?.toString(),
              } as LogAttributes);
              logger.error(err, {
                projectId: request.projectId?.toString(),
                userId: request.userId?.toString(),
              } as LogAttributes);
            },
          );
        }
      }

      /*
       * Emit gen_ai.* semantic-convention attributes on the active span so
       * OneUptime's own AI usage is a first-class LLM span in OneUptime's own
       * telemetry (dogfooding — LlmSpanUtil detects these). Never fails the call.
       */
      this.setGenAiSpanAttributes({
        llmType: llmProvider.llmType,
        modelName: llmConfig.modelName,
        usage: response.usage,
        costInUSDCents: logEntry.costInUSDCents,
      });

      // Save log entry
      const savedLog: LlmLog = await LlmLogService.create({
        data: logEntry,
        props: { isRoot: true },
      });

      return {
        content: response.content,
        toolCalls: response.toolCalls,
        llmLog: savedLog,
      };
    } catch (error) {
      // Log the error
      logEntry.status = LlmLogStatus.Error;
      logEntry.statusMessage =
        error instanceof Error ? error.message : String(error);
      logEntry.requestCompletedAt = new Date();
      logEntry.durationMs = new Date().getTime() - startTime.getTime();

      await LlmLogService.create({
        data: logEntry,
        props: { isRoot: true },
      });

      throw error;
    }
  }

  /*
   * Set gen_ai.* attributes (OpenTelemetry GenAI semantic conventions) on the
   * currently-active span. The @CaptureSpan()-wrapped caller owns that span, so
   * LlmSpanUtil recognizes these calls as first-class LLM spans.
   */
  private setGenAiSpanAttributes(data: {
    llmType: LlmType;
    modelName?: string | undefined;
    usage?: LLMUsage | undefined;
    costInUSDCents?: number | undefined;
  }): void {
    try {
      const span: Span | undefined = trace.getActiveSpan();
      if (!span) {
        return;
      }

      span.setAttribute("gen_ai.system", data.llmType.toString());
      span.setAttribute("gen_ai.provider.name", data.llmType.toString());
      span.setAttribute("gen_ai.operation.name", "chat");

      if (data.modelName) {
        span.setAttribute("gen_ai.request.model", data.modelName);
        span.setAttribute("gen_ai.response.model", data.modelName);
      }

      if (data.usage) {
        span.setAttribute(
          "gen_ai.usage.input_tokens",
          data.usage.promptTokens || 0,
        );
        span.setAttribute(
          "gen_ai.usage.output_tokens",
          data.usage.completionTokens || 0,
        );
        span.setAttribute(
          "gen_ai.usage.total_tokens",
          data.usage.totalTokens || 0,
        );
      }

      if (data.costInUSDCents) {
        span.setAttribute("gen_ai.usage.cost_usd", data.costInUSDCents / 100);
      }
    } catch {
      // Telemetry must never fail the LLM call.
    }
  }
}

export default new Service();
