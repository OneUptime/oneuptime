import { IsBillingEnabled } from "../EnvironmentConfig";
import BaseService from "./BaseService";
import LlmProviderService from "./LlmProviderService";
import LlmLogService from "./LlmLogService";
import ProjectService from "./ProjectService";
import AIBillingService from "./AIBillingService";
import LLMService, {
  LLMProviderConfig,
  LLMCompletionResponse,
  LLMMessage,
} from "../Utils/LLM/LLMService";
import LlmProvider from "../../Models/DatabaseModels/LlmProvider";
import LlmLog from "../../Models/DatabaseModels/LlmLog";
import LlmLogStatus from "../../Types/LlmLogStatus";
import ObjectID from "../../Types/ObjectID";
import BadDataException from "../../Types/Exception/BadDataException";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";

export interface AILogRequest {
  projectId: ObjectID;
  userId?: ObjectID;
  feature: string; // e.g., "IncidentPostmortem", "IncidentNote"
  incidentId?: ObjectID;
  alertId?: ObjectID;
  scheduledMaintenanceId?: ObjectID;
  messages: Array<LLMMessage>;
  maxTokens?: number;
  temperature?: number;
}

export interface AILogResponse {
  content: string;
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

    // Get LLM provider for the project
    const llmProvider: LlmProvider | null =
      await LlmProviderService.getLLMProviderForProject(request.projectId);

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
    logEntry.requestPrompt = request.messages
      .map((m: LLMMessage) => {
        return m.content;
      })
      .join("\n")
      .substring(0, 5000); // Store first 5000 chars
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

    // Check if billing should apply
    const shouldBill: boolean =
      IsBillingEnabled && (llmProvider.isGlobalLlm || false);

    // Check balance if billing enabled and using global provider
    if (shouldBill) {
      const project = await ProjectService.findOneById({
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
          "Insufficient AI balance. Please recharge your AI balance in Project Settings > Billing.",
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
        maxTokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7,
      });

      const endTime: Date = new Date();

      // Update log with success info
      logEntry.status = LlmLogStatus.Success;
      logEntry.inputTokens = response.usage?.promptTokens || 0;
      logEntry.outputTokens = response.usage?.completionTokens || 0;
      logEntry.totalTokens = response.usage?.totalTokens || 0;
      logEntry.responsePreview = response.content.substring(0, 2000); // Store first 2000 chars
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
          const project = await ProjectService.findOneById({
            id: request.projectId,
            select: { aiCurrentBalanceInUSDCents: true },
            props: { isRoot: true },
          });

          if (project) {
            const newBalance: number = Math.max(
              0,
              (project.aiCurrentBalanceInUSDCents || 0) - totalCost,
            );

            await ProjectService.updateOneById({
              id: request.projectId,
              data: {
                aiCurrentBalanceInUSDCents: newBalance,
              },
              props: { isRoot: true },
            });
          }

          // Check if auto-recharge is needed (do this async, don't wait)
          AIBillingService.rechargeIfBalanceIsLow(request.projectId).catch(
            (err: Error) => {
              logger.error("Error during AI balance auto-recharge check:");
              logger.error(err);
            },
          );
        }
      }

      // Save log entry
      const savedLog = await LlmLogService.create({
        data: logEntry,
        props: { isRoot: true },
      });

      return {
        content: response.content,
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
