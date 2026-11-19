import {
  CodeAgentBenchmarkModel,
  CodeAgentBenchmarkModelReply,
  CodeAgentBenchmarkModelRequest,
} from "./CodeAgentBenchmarkServer";
import PinnedModel, {
  PinnedModelOptions,
} from "Common/Server/Utils/AI/Eval/PinnedModel";
import LLMService, {
  LLMCompletionResponse,
  LLMProviderConfig,
} from "Common/Server/Utils/LLM/LLMService";
import LlmType from "Common/Types/LLM/LlmType";

/*
 * The model under test, called straight through LLMService with the key
 * from the environment (Common's AI evals pin a model the same way:
 * PinnedModel) - so a score measures the agent and the model named, never
 * a project's default.
 */

// The providers a key is not needed for: a model you run yourself.
export const KEYLESS_LLM_TYPES: ReadonlyArray<LlmType> = [
  LlmType.Ollama,
  LlmType.OpenAICompatible,
];

export function needsApiKey(llmType: LlmType): boolean {
  return !KEYLESS_LLM_TYPES.includes(llmType);
}

export function createProviderModel(
  options: PinnedModelOptions,
): CodeAgentBenchmarkModel {
  const config: LLMProviderConfig = PinnedModel.getProviderConfig(options);

  return {
    llmType: options.llmType,
    modelName: options.modelName,
    call: async (
      request: CodeAgentBenchmarkModelRequest,
    ): Promise<CodeAgentBenchmarkModelReply> => {
      const response: LLMCompletionResponse = await LLMService.getCompletion({
        llmProviderConfig: config,
        messages: request.messages,
        tools: request.tools,
        maxTokens: request.maxTokens,
        ...(request.timeoutInMs
          ? { requestTimeoutInMs: request.timeoutInMs }
          : {}),
        // The prompt holds the task's code: no provider error echoes it.
        includeProviderErrorDetails: false,
      });

      return {
        content: response.content || "",
        toolCalls: response.toolCalls || [],
        promptTokens: response.usage?.promptTokens,
        completionTokens: response.usage?.completionTokens,
        totalTokens: response.usage?.totalTokens,
        modelName: response.modelName || options.modelName,
      };
    },
  };
}
