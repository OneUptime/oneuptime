import { RUNNER_KEY } from "../Config";
import RunnerIdentity from "./RunnerIdentity";
import { JSONObject } from "Common/Types/JSON";
import { RequestOptions } from "Common/Utils/API";
import RunnerCodeFixCapability, {
  RUNNER_CODE_FIX_CAPABILITIES_FIELD,
} from "Common/Types/Runner/RunnerCodeFixCapability";

/*
 * What this Runner build can do in a code fix, declared on every code-fix
 * request (RUNNER_CODE_FIX_CAPABILITIES_FIELD), as a probe declares its
 * probeCapabilities: the server hands a Runner only what it understands, and
 * one older than a capability, which declares none, what it always did.
 *
 * "serverOpensPullRequests": this Runner asks OneUptime to open a fix's pull
 * (or merge) request (BackendAPI.openPullRequest) whenever the token's answer
 * says OneUptime opens it, so it can be handed a token that pushes the fix's
 * branch and does nothing more - on GitLab, one OneUptime makes for the run
 * alone, instead of the connection's own token.
 *
 * Add to this list only when the code that honours the new capability ships
 * in the same build.
 */
export const RUNNER_CODE_FIX_CAPABILITIES: Array<RunnerCodeFixCapability> = [
  RunnerCodeFixCapability.ServerOpensPullRequests,
];

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
      [RUNNER_CODE_FIX_CAPABILITIES_FIELD]: [...RUNNER_CODE_FIX_CAPABILITIES],
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
