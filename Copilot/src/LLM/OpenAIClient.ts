import { LMStudioClient, LMStudioClientOptions } from "./LMStudioClient";

export interface OpenAIClientOptions
  extends Omit<LMStudioClientOptions, "endpoint"> {
  endpoint?: string;
}

/**
 * Thin wrapper that configures the OpenAI Chat Completions endpoint.
 */
export class OpenAIClient extends LMStudioClient {
  public constructor(options: OpenAIClientOptions) {
    if (!options.apiKey) {
      throw new Error("OpenAI API key is required for the OpenAI provider.");
    }

    super({
      ...options,
      endpoint:
        options.endpoint ?? "https://api.openai.com/v1/chat/completions",
    });
  }
}
