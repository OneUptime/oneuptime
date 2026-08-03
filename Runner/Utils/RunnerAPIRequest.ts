import { RUNNER_KEY } from "../Config";
import RunnerIdentity from "./RunnerIdentity";
import { JSONObject } from "Common/Types/JSON";

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
}
