/*
 * ---------------------------------------------------------------------------
 * Unit tests for RunnerAPIRequest.getDefaultRequestBody().
 *
 * Every code-fix protocol request carries the Runner's credentials in the body.
 * The Runbook/AI-agent merge unified the *deployable*, but deliberately kept
 * the wire field names aiAgentId/aiAgentKey so the unchanged server-side task
 * protocol and AIAgent table keep working. This test pins those exact field
 * names — a rename here would silently break authentication against an
 * un-migrated server — and that the values come from the Runner's key and id.
 * ---------------------------------------------------------------------------
 */

import RunnerAPIRequest from "../../Utils/RunnerAPIRequest";
import RunnerIdentity from "../../Utils/RunnerIdentity";
import { RUNNER_KEY } from "../../Config";
import { JSONObject } from "Common/Types/JSON";

describe("RunnerAPIRequest.getDefaultRequestBody", () => {
  test("carries the credentials under the legacy aiAgent* wire field names", () => {
    const body: JSONObject = RunnerAPIRequest.getDefaultRequestBody();

    expect(Object.keys(body).sort()).toEqual(["aiAgentId", "aiAgentKey"]);
  });

  test("sends the Runner key as aiAgentKey", () => {
    const body: JSONObject = RunnerAPIRequest.getDefaultRequestBody();

    expect(body["aiAgentKey"]).toBe(RUNNER_KEY);
  });

  test("sends the resolved Runner id (as a string) as aiAgentId", () => {
    const body: JSONObject = RunnerAPIRequest.getDefaultRequestBody();

    expect(body["aiAgentId"]).toBe(RunnerIdentity.getRunnerId().toString());
    expect(typeof body["aiAgentId"]).toBe("string");
  });
});
