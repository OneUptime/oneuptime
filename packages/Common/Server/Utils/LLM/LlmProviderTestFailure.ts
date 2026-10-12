import LLMProviderHTTPException from "./LLMProviderHTTPException";
import APIException from "../../../Types/Exception/ApiException";
import EgressGuardException from "../../../Types/Exception/EgressGuardException";
import Exception from "../../../Types/Exception/Exception";
import LlmType from "../../../Types/LLM/LlmType";

/*
 * WHAT TEST LLM PROVIDER SAYS WHEN THE PROVIDER DID NOT ANSWER.
 *
 * The Test button is where the person setting a provider up learns whether
 * its key, model and Base URL work, so a failure says, in this order: what
 * went wrong and what to check, in OneUptime's words; then what the provider
 * answered, in its own. It used to show the provider's error body as JSON -
 * "LLM Provider test failed: OpenAI API error: {"error":{"message":"Incorrect
 * API key provided: ...","type":"invalid_request_error","param":null,"code":
 * "invalid_api_key"}}" - with the one sentence that mattered in the middle.
 *
 *  - An answer with an HTTP error (LLMProviderHTTPException): OneUptime's
 *    hint when LLMService has one for the provider (Azure's), otherwise a
 *    sentence for the status - the key (401), the key's access (403), the
 *    model or the address (404), limits and credits (429), the provider's own
 *    trouble (5xx), the request (anything else) - with the status, so it can
 *    be looked up; then "<Provider> answered: <its message>", when it said
 *    one and its details may be shown.
 *  - No answer at all: OneUptime could not reach the provider, why (never
 *    where: LLMService leaves the address out), and to check the Base URL.
 *  - Anything else LLMService says in words already (a key that is required,
 *    a refusal): as it is.
 */

// How each provider is named in a sentence, at its start and inside it.
const PROVIDER_NAMES: Record<LlmType, { subject: string; object: string }> = {
  [LlmType.OpenAI]: { subject: "OpenAI", object: "OpenAI" },
  [LlmType.AzureOpenAI]: { subject: "Azure", object: "Azure" },
  [LlmType.Anthropic]: { subject: "Anthropic", object: "Anthropic" },
  [LlmType.Groq]: { subject: "Groq", object: "Groq" },
  [LlmType.Mistral]: { subject: "Mistral", object: "Mistral" },
  [LlmType.Ollama]: { subject: "Ollama", object: "Ollama" },
  [LlmType.OpenAICompatible]: {
    subject: "The OpenAI-compatible server",
    object: "the OpenAI-compatible server",
  },
};

/*
 * LLMService's words for a request that got no answer: "<Provider> API
 * request failed: <why>." - the why is kept, the rest is said again here.
 */
const UNANSWERED_REQUEST: string = " API request failed: ";

// The longest a failure says, as the route has always cut it.
export const LLM_PROVIDER_TEST_FAILURE_MAX_LENGTH: number = 1000;

export const LLM_PROVIDER_TEST_UNKNOWN_FAILURE: string =
  "Failed to connect to the LLM provider. Please verify the API key, model name, and base URL.";

export default class LlmProviderTestFailure {
  public static describe(error: unknown, llmType: LlmType): string {
    const names: { subject: string; object: string } = PROVIDER_NAMES[
      llmType
    ] || { subject: "The LLM provider", object: "the LLM provider" };

    let text: string;

    if (error instanceof LLMProviderHTTPException) {
      text = LlmProviderTestFailure.describeAnswer(error, names.subject);
    } else if (
      error instanceof EgressGuardException ||
      error instanceof APIException
    ) {
      text = LlmProviderTestFailure.describeNoAnswer(error, names.object);
    } else if (error instanceof Exception && error.message) {
      text = error.message;
    } else {
      text = LLM_PROVIDER_TEST_UNKNOWN_FAILURE;
    }

    return text.length > LLM_PROVIDER_TEST_FAILURE_MAX_LENGTH
      ? `${text.substring(0, LLM_PROVIDER_TEST_FAILURE_MAX_LENGTH - 1)}…`
      : text;
  }

  /*
   * What a status says, and what to check for it, of the provider named
   * `subject`. With the status, so the person can look it up.
   */
  public static describeStatus(statusCode: number, subject: string): string {
    const status: string = `(HTTP ${statusCode})`;

    if (statusCode === 401) {
      return `${subject} did not accept the API key ${status}. Check the provider's API Key.`;
    }

    if (statusCode === 403) {
      return `${subject} refused this API key ${status}. Check that the key may use this model, and any network rules on the account.`;
    }

    if (statusCode === 404) {
      return `${subject} found no such model, or nothing at the Base URL ${status}. Check the Model Name and the Base URL.`;
    }

    if (statusCode === 429) {
      return `${subject} is limiting requests from this API key, or its quota or credits ran out ${status}. Check the account's limits and billing, then test again.`;
    }

    if (statusCode === 408 || statusCode === 504) {
      return `${subject} did not answer in time ${status}. Test again in a minute.`;
    }

    if (statusCode >= 500) {
      return `${subject} could not answer the request ${status}. Test again in a few minutes.`;
    }

    return `${subject} refused the test request ${status}. Check the Model Name and the Additional Parameters.`;
  }

  private static describeAnswer(
    error: LLMProviderHTTPException,
    subject: string,
  ): string {
    const lead: string =
      error.hint ||
      LlmProviderTestFailure.describeStatus(error.statusCode, subject);

    const answer: string = error.providerMessage.trim();

    return answer ? `${lead} ${subject} answered: ${answer}` : lead;
  }

  private static describeNoAnswer(error: Exception, object: string): string {
    const at: number = error.message.indexOf(UNANSWERED_REQUEST);
    const rest: string =
      at === -1 ? "" : error.message.slice(at + UNANSWERED_REQUEST.length);
    const why: string = (rest.endsWith(".") ? rest.slice(0, -1) : rest).trim();

    const lead: string = why
      ? `OneUptime could not reach ${object}: ${why}.`
      : error.message;

    return `${lead} Check the Base URL, and that the OneUptime server can reach it.`;
  }
}
