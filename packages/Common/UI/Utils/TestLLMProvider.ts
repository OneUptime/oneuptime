import URL from "../../Types/API/URL";
import Dictionary from "../../Types/Dictionary";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import { JSONObject } from "../../Types/JSON";
import LlmProvider from "../../Models/DatabaseModels/LlmProvider";
import { APP_API_URL } from "../Config";
import API from "./API/API";
import { LLM_PROVIDER_TEST_REFUSED_SENTENCE } from "./LlmProviderTestCopy";
import PermissionGate, { PermissionGateResult } from "./PermissionGate";

export interface LLMProviderTestResult {
  success: boolean;
  message: string;
  /*
   * Whether the provider actually used the tool offered by the connection
   * test. Reachability alone is not enough for Ask AI or investigations —
   * they read the user's data exclusively through tools — so a provider can
   * connect successfully and still be unusable for every AI feature.
   * Undefined for an older server that does not report it.
   */
  supportsToolCalling?: boolean | undefined;
  /*
   * A failure the provider's settings can fix: the server asked the provider
   * and it failed - refused the key, had no such model, was not reached - or
   * the settings are incomplete, said as LlmProviderTestFailure says it (an
   * HTTP 400). Not one when the test was refused - who may test, the plan -
   * or the request failed on its way: the message says why, and changing
   * the provider would not help.
   */
  isProviderFailure?: boolean | undefined;
}

// The status the test route answers a provider's failure with (BadData).
const PROVIDER_FAILURE_STATUS: number = 400;

export default class TestLLMProvider {
  /*
   * Whether the signed-in user may test a project's LLM provider: whoever
   * may change it - the provider's update list, a team's block counted - as
   * the server asks it (LlmProviderTestAccess). Refused, the reason is the
   * server's refusal, translated: the sentence, then who may. Nothing to say
   * until the permission snapshot has landed (hide the button then).
   */
  public static getTestGate(): PermissionGateResult {
    return PermissionGate.checkPermissions(
      new LlmProvider().getUpdatePermissions(),
      {
        sentence: LLM_PROVIDER_TEST_REFUSED_SENTENCE,
      },
    );
  }

  /*
   * Sends a small test prompt to an LLM provider (by id) via the
   * /llm-provider/test endpoint and returns a friendly success/failure result.
   * Callers pass the appropriate common headers (project tenant header for
   * project providers, or none for admin/global providers).
   */
  public static async test(data: {
    llmProviderId: string;
    headers?: Dictionary<string> | undefined;
  }): Promise<LLMProviderTestResult> {
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/llm-provider/test",
          ),
          data: {
            llmProviderId: data.llmProviderId,
          },
          ...(data.headers ? { headers: data.headers } : {}),
        });

      if (response.isFailure()) {
        return {
          success: false,
          message: API.getFriendlyMessage(response),
          isProviderFailure: response.statusCode === PROVIDER_FAILURE_STATUS,
        };
      }

      const responseData: JSONObject = response.data as JSONObject;

      return {
        success: true,
        message:
          (responseData["message"] as string) ||
          "Connection successful. The LLM provider responded to a test prompt.",
        ...(typeof responseData["supportsToolCalling"] === "boolean"
          ? { supportsToolCalling: responseData["supportsToolCalling"] }
          : {}),
      };
    } catch (err) {
      return {
        success: false,
        message: API.getFriendlyMessage(err),
        isProviderFailure: false,
      };
    }
  }
}
