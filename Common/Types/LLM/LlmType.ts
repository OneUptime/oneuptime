enum LlmType {
  OpenAI = "OpenAI",
  AzureOpenAI = "AzureOpenAI",
  Anthropic = "Anthropic",
  Groq = "Groq",
  Mistral = "Mistral",
  Ollama = "Ollama",
  /*
   * Generic OpenAI-compatible servers (vLLM, LocalAI, LM Studio, text-gen-webui,
   * etc.) that speak the OpenAI /chat/completions wire format but are typically
   * self-hosted at a custom base URL and often require no API key.
   */
  OpenAICompatible = "OpenAICompatible",
}

export default LlmType;
