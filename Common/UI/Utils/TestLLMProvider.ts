import URL from "../../Types/API/URL";
import Dictionary from "../../Types/Dictionary";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import { JSONObject } from "../../Types/JSON";
import { APP_API_URL } from "../Config";
import API from "./API/API";

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
}

export default class TestLLMProvider {
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
      };
    }
  }
}
