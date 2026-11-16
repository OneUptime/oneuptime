import APIException from "../../../Types/Exception/ApiException";
import ResponseTooLarge from "../../../Utils/ResponseTooLarge";

/*
 * An LLM provider's answer was larger than LLMService reads (issue #8931):
 * LLM_PROVIDER_MAX_ANSWER_BYTES for a completion, the models list's own
 * limit for that. The answer was not read, and asking again only reads as
 * much of the same answer again, so it is not retried (API.isRetryableError).
 *
 * Its message is in the family every request that got no usable answer
 * throws - "<Provider> API request failed: the answer was larger than 16 MB,
 * so it was not read." - and, like those, names nothing of the address: AI
 * Logs, chat replies and the investigation panel show it to every project
 * member. Test LLM Provider words it for the person setting the provider up
 * (LlmProviderTestFailure, describe).
 */
export default class LLMProviderAnswerTooLargeException extends APIException {
  // The most of the answer the request read, in bytes.
  public readonly maxContentLength: number;

  public constructor(data: { providerName: string; maxContentLength: number }) {
    super(
      `${data.providerName} API request failed: ${ResponseTooLarge.getMessage(
        data.maxContentLength,
        "the answer",
      )}`,
    );
    this.maxContentLength = data.maxContentLength;
  }

  // "OpenAI's answer was larger than 16 MB, so it was not read."
  public describe(subject: string): string {
    return ResponseTooLarge.getMessage(
      this.maxContentLength,
      `${subject}'s answer`,
    );
  }
}
