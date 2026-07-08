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
} from "../Utils/LLM/LLMService";
import LlmProvider from "../../Models/DatabaseModels/LlmProvider";
import LlmLog from "../../Models/DatabaseModels/LlmLog";
import LlmLogStatus from "../../Types/LlmLogStatus";
import ObjectID from "../../Types/ObjectID";
import BadDataException from "../../Types/Exception/BadDataException";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

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
      });

      const endTime: Date = new Date();

      // Update log with success info
      logEntry.status = LlmLogStatus.Success;
      logEntry.totalTokens = response.usage?.totalTokens || 0;
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
}

export default new Service();
