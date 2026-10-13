import { JSONObject } from "../../Types/JSON";

/*
 * The request Test LLM Provider sends, as the Dashboard sends it
 * (Common/UI/Utils/TestLLMProvider): a POST to /llm-provider/test whose body
 * names the provider, with the project in the tenant header the Dashboard
 * adds to every request (ModelAPI.getCommonHeaders) - none from the Admin
 * Dashboard, which tests the global providers.
 *
 * Shared by the server suite that runs the route as each kind of caller
 * (LlmProviderTestAsMember) and the Dashboard's component suite, which holds
 * what leaves the page to the same body.
 */

export const DASHBOARD_TEST_ROUTE: string = "/llm-provider/test";

export function dashboardTestBody(llmProviderId: unknown): JSONObject {
  return {
    llmProviderId: llmProviderId as string,
  };
}
