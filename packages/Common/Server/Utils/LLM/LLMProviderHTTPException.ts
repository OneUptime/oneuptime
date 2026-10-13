import BadDataException from "../../../Types/Exception/BadDataException";
import LlmType from "../../../Types/LLM/LlmType";

/*
 * An LLM provider answered a request with an HTTP error: a wrong key, a
 * model it does not have, a quota that ran out. Its message is the one
 * LLMService has always thrown - "<Provider> API error: ..." - so AI Logs,
 * chat replies and every caller read it as before; what it adds is the
 * answer in parts, for a caller that words it for a person (Test LLM
 * Provider, LlmProviderTestFailure):
 *
 *  - statusCode: the provider's HTTP status;
 *  - llmType: which provider it was, as the provider is configured;
 *  - providerMessage: what the provider said, in its own words ("Incorrect
 *    API key provided: sk-...abcd"), read from its error body whatever its
 *    shape - empty when the body said nothing readable, or when the request
 *    asked for the provider's error details to be left out;
 *  - hint: what to change, in OneUptime's own words, when LLMService knows
 *    (describeAzureOpenAIFailure).
 */
export default class LLMProviderHTTPException extends BadDataException {
  public readonly statusCode: number;
  public readonly llmType: LlmType;
  public readonly providerMessage: string;
  public readonly hint: string | undefined;

  public constructor(data: {
    message: string;
    statusCode: number;
    llmType: LlmType;
    providerMessage: string;
    hint?: string | undefined;
  }) {
    super(data.message);
    this.statusCode = data.statusCode;
    this.llmType = data.llmType;
    this.providerMessage = data.providerMessage;
    this.hint = data.hint;
  }
}
