import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import API from "../../../Utils/API";
import LlmType from "../../../Types/LLM/LlmType";
import BadDataException from "../../../Types/Exception/BadDataException";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMCompletionRequest {
  messages: Array<LLMMessage>;
  temperature?: number;
  llmProviderConfig: LLMProviderConfig;
}

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMCompletionResponse {
  content: string;
  usage: LLMUsage | undefined;
}

export interface LLMProviderConfig {
  llmType: LlmType;
  apiKey?: string;
  baseUrl?: string;
  modelName?: string;
}

export default class LLMService {
  @CaptureSpan()
  public static async getCompletion(
    request: LLMCompletionRequest,
  ): Promise<LLMCompletionResponse> {
    const config: LLMProviderConfig = request.llmProviderConfig;

    switch (config.llmType) {
      case LlmType.OpenAI:
      case LlmType.Groq:
      case LlmType.Mistral:
        return await this.getOpenAICompatibleCompletion(config, request);
      case LlmType.AzureOpenAI:
        return await this.getAzureOpenAICompletion(config, request);
      case LlmType.Anthropic:
        return await this.getAnthropicCompletion(config, request);
      case LlmType.Ollama:
        return await this.getOllamaCompletion(config, request);
      default:
        throw new BadDataException(`Unsupported LLM type: ${config.llmType}`);
    }
  }

  @CaptureSpan()
  private static async getOpenAICompatibleCompletion(
    config: LLMProviderConfig,
    request: LLMCompletionRequest,
  ): Promise<LLMCompletionResponse> {
    if (!config.apiKey) {
      throw new BadDataException(`${config.llmType} API key is required`);
    }

    const defaultBaseUrls: Record<string, string> = {
      [LlmType.OpenAI]: "https://api.openai.com/v1",
      [LlmType.Groq]: "https://api.groq.com/openai/v1",
      [LlmType.Mistral]: "https://api.mistral.ai/v1",
    };

    const defaultModels: Record<string, string> = {
      [LlmType.OpenAI]: "gpt-4o",
      [LlmType.Groq]: "llama-3.3-70b-versatile",
      [LlmType.Mistral]: "mistral-large-latest",
    };

    const baseUrl: string =
      config.baseUrl ||
      defaultBaseUrls[config.llmType] ||
      "https://api.openai.com/v1";
    const modelName: string =
      config.modelName || defaultModels[config.llmType] || "gpt-4o";
    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post<JSONObject>({
        url: URL.fromString(`${baseUrl}/chat/completions`),
        data: {
          model: modelName,
          messages: request.messages.map((msg: LLMMessage) => {
            return {
              role: msg.role,
              content: msg.content,
            };
          }),
          temperature: request.temperature ?? 0.7,
        },
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        options: {
          retries: 2,
          exponentialBackoff: true,
          timeout: 120000,
        },
      });

    const logAttributes: LogAttributes = {
      llmType: config.llmType,
      modelName: modelName,
    };

    if (response instanceof HTTPErrorResponse) {
      logger.error(`Error from ${config.llmType} API:`, logAttributes);
      logger.error(response, logAttributes);
      throw new BadDataException(
        `${config.llmType} API error: ${JSON.stringify(response.jsonData)}`,
      );
    }

    const jsonData: JSONObject = response.jsonData as JSONObject;
    const choices: Array<JSONObject> = jsonData["choices"] as Array<JSONObject>;

    if (!choices || choices.length === 0) {
      throw new BadDataException(`No response from ${config.llmType}`);
    }

    const message: JSONObject = choices[0]!["message"] as JSONObject;
    const usage: JSONObject = jsonData["usage"] as JSONObject;

    return {
      content: message["content"] as string,
      usage: usage
        ? {
            promptTokens: usage["prompt_tokens"] as number,
            completionTokens: usage["completion_tokens"] as number,
            totalTokens: usage["total_tokens"] as number,
          }
        : undefined,
    };
  }

  @CaptureSpan()
  private static async getAzureOpenAICompletion(
    config: LLMProviderConfig,
    request: LLMCompletionRequest,
  ): Promise<LLMCompletionResponse> {
    if (!config.apiKey) {
      throw new BadDataException("Azure OpenAI API key is required");
    }

    if (!config.baseUrl) {
      throw new BadDataException(
        "Azure OpenAI Base URL is required (e.g. https://<resource>.openai.azure.com/openai/deployments/<deployment>/)",
      );
    }

    const modelName: string = config.modelName || "gpt-4o";

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post<JSONObject>({
        url: URL.fromString(`${config.baseUrl}/chat/completions`),
        data: {
          model: modelName,
          messages: request.messages.map((msg: LLMMessage) => {
            return {
              role: msg.role,
              content: msg.content,
            };
          }),
          temperature: request.temperature ?? 0.7,
        },
        headers: {
          "api-key": config.apiKey,
          "Content-Type": "application/json",
        },
        options: {
          retries: 2,
          exponentialBackoff: true,
          timeout: 120000,
        },
      });

    const logAttributes: LogAttributes = {
      llmType: config.llmType,
      modelName: modelName,
    };

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error from Azure OpenAI API:", logAttributes);
      logger.error(response, logAttributes);
      throw new BadDataException(
        `Azure OpenAI API error: ${JSON.stringify(response.jsonData)}`,
      );
    }

    const jsonData: JSONObject = response.jsonData as JSONObject;
    const choices: Array<JSONObject> = jsonData["choices"] as Array<JSONObject>;

    if (!choices || choices.length === 0) {
      throw new BadDataException("No response from Azure OpenAI");
    }

    const message: JSONObject = choices[0]!["message"] as JSONObject;
    const usage: JSONObject = jsonData["usage"] as JSONObject;

    return {
      content: message["content"] as string,
      usage: usage
        ? {
            promptTokens: usage["prompt_tokens"] as number,
            completionTokens: usage["completion_tokens"] as number,
            totalTokens: usage["total_tokens"] as number,
          }
        : undefined,
    };
  }

  @CaptureSpan()
  private static async getAnthropicCompletion(
    config: LLMProviderConfig,
    request: LLMCompletionRequest,
  ): Promise<LLMCompletionResponse> {
    if (!config.apiKey) {
      throw new BadDataException("Anthropic API key is required");
    }

    const baseUrl: string = config.baseUrl || "https://api.anthropic.com/v1";
    const modelName: string = config.modelName || "claude-sonnet-4-20250514";

    // Anthropic requires system message to be separate
    let systemMessage: string = "";
    const userMessages: Array<{ role: string; content: string }> = [];

    for (const msg of request.messages) {
      if (msg.role === "system") {
        systemMessage = msg.content;
      } else {
        userMessages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    const requestData: JSONObject = {
      model: modelName,
      messages: userMessages,
      temperature: request.temperature ?? 0.7,
    };

    if (systemMessage) {
      requestData["system"] = systemMessage;
    }

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post<JSONObject>({
        url: URL.fromString(`${baseUrl}/messages`),
        data: requestData,
        headers: {
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        options: {
          retries: 2,
          exponentialBackoff: true,
          timeout: 120000,
        },
      });

    const anthropicLogAttributes: LogAttributes = {
      llmType: config.llmType,
      modelName: modelName,
    };

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error from Anthropic API:", anthropicLogAttributes);
      logger.error(response, anthropicLogAttributes);
      throw new BadDataException(
        `Anthropic API error: ${JSON.stringify(response.jsonData)}`,
      );
    }

    const jsonData: JSONObject = response.jsonData as JSONObject;
    const content: Array<JSONObject> = jsonData["content"] as Array<JSONObject>;

    if (!content || content.length === 0) {
      throw new BadDataException("No response from Anthropic");
    }

    const textContent: JSONObject | undefined = content.find(
      (c: JSONObject) => {
        return c["type"] === "text";
      },
    );

    if (!textContent) {
      throw new BadDataException("No text content in Anthropic response");
    }

    const usage: JSONObject = jsonData["usage"] as JSONObject;

    return {
      content: textContent["text"] as string,
      usage: usage
        ? {
            promptTokens: usage["input_tokens"] as number,
            completionTokens: usage["output_tokens"] as number,
            totalTokens:
              ((usage["input_tokens"] as number) || 0) +
              ((usage["output_tokens"] as number) || 0),
          }
        : undefined,
    };
  }

  @CaptureSpan()
  private static async getOllamaCompletion(
    config: LLMProviderConfig,
    request: LLMCompletionRequest,
  ): Promise<LLMCompletionResponse> {
    if (!config.baseUrl) {
      throw new BadDataException("Ollama base URL is required");
    }

    const modelName: string = config.modelName || "llama2";

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post<JSONObject>({
        url: URL.fromString(`${config.baseUrl}/api/chat`),
        data: {
          model: modelName,
          messages: request.messages.map((msg: LLMMessage) => {
            return {
              role: msg.role,
              content: msg.content,
            };
          }),
          stream: false,
          options: {
            temperature: request.temperature ?? 0.7,
          },
        },
        headers: {
          "Content-Type": "application/json",
        },
        options: {
          retries: 2,
          exponentialBackoff: true,
          timeout: 300000, // 5 minutes for Ollama as it may be slower
        },
      });

    const ollamaLogAttributes: LogAttributes = {
      llmType: config.llmType,
      modelName: modelName,
    };

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error from Ollama API:", ollamaLogAttributes);
      logger.error(response, ollamaLogAttributes);
      throw new BadDataException(
        `Ollama API error: ${JSON.stringify(response.jsonData)}`,
      );
    }

    const jsonData: JSONObject = response.jsonData as JSONObject;
    const message: JSONObject = jsonData["message"] as JSONObject;

    if (!message) {
      throw new BadDataException("No response from Ollama");
    }

    return {
      content: message["content"] as string,
      usage: undefined, // Ollama doesn't provide token usage in the same way
    };
  }
}
