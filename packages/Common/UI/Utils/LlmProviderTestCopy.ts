import { translationKey } from "./TranslateTemplate";

/*
 * The words of Test LLM Provider that are not the server's verdict, kept
 * free of React and of the API client so the server's suites can hold its
 * refusal to the same sentence (LlmProviderTestAccess).
 *
 * Every one is an English key of the Dashboard's locales: look it up where
 * it is shown (translateText), never here.
 */

/*
 * What the locked Test button says to a member who may read providers but
 * not change one - the first sentence of the server's refusal, word for
 * word. The gate adds who may (TestLLMProvider.getTestGate).
 */
export const LLM_PROVIDER_TEST_REFUSED_SENTENCE: string = translationKey(
  "You do not have permission to test this LLM provider.",
);

// While a test runs: what is happening, then what it checks.
export const LLM_PROVIDER_TEST_SENDING: string = translationKey(
  "Sending a test prompt to your LLM provider…",
);

export const LLM_PROVIDER_TEST_CHECKS: string = translationKey(
  "This checks its API key, model and Base URL, and whether its model can call tools.",
);
