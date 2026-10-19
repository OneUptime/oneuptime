import { RUNNER_KEY } from "../Config";
import RunnerIdentity from "./RunnerIdentity";
import { JSONObject } from "Common/Types/JSON";
import { RequestOptions } from "Common/Utils/API";

/*
 * Credentials on every code-fix protocol request. The wire field names stay
 * aiAgentId/aiAgentKey — the server-side task protocol and the AIAgent table
 * are unchanged by the Runner merge; only the deployable and its env vars
 * were unified.
 */
export default class RunnerAPIRequest {
  public static getDefaultRequestBody(): JSONObject {
    return {
      aiAgentKey: RUNNER_KEY,
      aiAgentId: RunnerIdentity.getRunnerId().toString(),
    };
  }

  /*
   * The options of every request this Runner sends to OneUptime, with the
   * caller's own (retries, a deadline) added. Each of those requests
   * carries a key - this Runner's, the installation's cluster key, or the
   * project's ingestion key - so a redirect is followed only while it stays
   * on the server it was sent to (sameServerRedirectsOnly): an HTTP client
   * hands a redirected request's headers, and a 307 or 308's body, to
   * wherever the redirect points.
   */
  public static getDefaultRequestOptions(
    options: RequestOptions = {},
  ): RequestOptions {
    return {
      ...options,
      sameServerRedirectsOnly: true,
    };
  }
}
