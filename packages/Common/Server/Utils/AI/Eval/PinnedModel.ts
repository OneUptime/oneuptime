import AiTokenCount from "../../../../Types/AI/AiTokenCount";
import LlmType from "../../../../Types/LLM/LlmType";
import LLMService, {
  LLMCompletionResponse,
  LLMProviderConfig,
} from "../../LLM/LLMService";
import {
  ObservabilityAssistantModelCall,
  ObservabilityAssistantModelReply,
} from "../Chat/ObservabilityAssistant";

/*
 * The model an eval runs: one provider and model, named outright, so a
 * score measures the change under test and not whatever a project's
 * default happens to be that day (Eval/ReplayInvestigation,
 * Eval/InvestigationBenchmark). Called straight through LLMService - no
 * project is billed, no AI Log written: an eval is the operator's, run with
 * their own key from the command line.
 */
export type PinnedModelCall = (
  call: ObservabilityAssistantModelCall,
) => Promise<ObservabilityAssistantModelReply>;

export interface PinnedModelOptions {
  llmType: LlmType;
  modelName?: string | undefined;
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  requestTimeoutInSeconds?: number | undefined;
}

export default class PinnedModel {
  public static isLlmType(value: string): value is LlmType {
    return (Object.values(LlmType) as Array<string>).includes(value);
  }

  public static getProviderConfig(
    options: PinnedModelOptions,
  ): LLMProviderConfig {
    const config: LLMProviderConfig = { llmType: options.llmType };

    if (options.apiKey) {
      config.apiKey = options.apiKey;
    }

    if (options.baseUrl) {
      config.baseUrl = options.baseUrl;
    }

    if (options.modelName) {
      config.modelName = options.modelName;
    }

    if (options.requestTimeoutInSeconds) {
      config.requestTimeoutInSeconds = options.requestTimeoutInSeconds;
    }

    return config;
  }

  public static create(options: PinnedModelOptions): PinnedModelCall {
    const config: LLMProviderConfig = this.getProviderConfig(options);

    return async (
      call: ObservabilityAssistantModelCall,
    ): Promise<ObservabilityAssistantModelReply> => {
      const response: LLMCompletionResponse = await LLMService.getCompletion({
        llmProviderConfig: config,
        messages: call.messages,
        tools: call.tools,
        maxTokens: call.maxTokens,
        /*
         * The loop's own (as a live run's), and 0 for a grade: the model is
         * what changes between two evals, never how it is sampled.
         */
        temperature: call.temperature,
        // The prompt holds a project's telemetry: no provider error echoes it.
        includeProviderErrorDetails: false,
      });

      const modelName: string | undefined =
        response.modelName || config.modelName;

      return {
        content: response.content || "",
        toolCalls: response.toolCalls,
        stopReason: response.stopReason,
        tokenCount: AiTokenCount.count({
          totalTokens: response.usage?.totalTokens,
          cachedInputTokens: response.usage?.cachedInputTokens,
          cacheCreationTokens: response.usage?.cacheCreationTokens,
          modelName: modelName,
        }),
        providerName: config.llmType,
        modelName: modelName,
      };
    };
  }
}
