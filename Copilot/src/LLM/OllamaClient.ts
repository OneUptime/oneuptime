import { LMStudioClient, LMStudioClientOptions } from "./LMStudioClient";

export interface OllamaClientOptions
  extends Omit<LMStudioClientOptions, "endpoint"> {
  endpoint?: string;
}

/**
 * Wrapper that targets the Ollama OpenAI-compatible chat completions endpoint.
 */
export class OllamaClient extends LMStudioClient {
  public constructor(options: OllamaClientOptions) {
    super({
      ...options,
      endpoint:
        options.endpoint ?? "http://localhost:11434/v1/chat/completions",
    });
  }
}
