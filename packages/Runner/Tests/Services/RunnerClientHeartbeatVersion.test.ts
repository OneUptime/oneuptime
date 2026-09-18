/*
 * ---------------------------------------------------------------------------
 * The Runner half of the version wire contract.
 *
 * The dashboard now labels this value "Runner Version", but the key on the wire
 * is still `agentVersion`. App/Tests/Runbook/RunnerHeartbeatVersionWireField
 * pins the server side of that; this pins the client side, and the two together
 * are what make the contract testable at all — either end can be renamed on its
 * own and the pair silently stops agreeing.
 *
 * Skew here is asymmetric and both directions matter:
 *   - a NEW Runner posting a new key at an OLD self-hosted server, and
 *   - an OLD Runner posting the old key at a NEW server.
 * The server accepts a missing version without complaint (it only writes the
 * column when the body carries a non-empty string), so neither direction
 * produces an error — just a version that never advances again.
 *
 * Same reasoning as RunnerAPIRequest.test.ts, which pins aiAgentId/aiAgentKey
 * for exactly this reason.
 * ---------------------------------------------------------------------------
 */

import { JSONObject } from "Common/Types/JSON";
import fs from "fs";
import path from "path";

type PostMock = jest.Mock;

const post: PostMock = jest.fn();

/*
 * RunnerClient builds its axios instance at module load, so the mock has to be
 * in place before the import below (jest hoists jest.mock above imports).
 */
jest.mock("axios", () => {
  return {
    __esModule: true,
    default: {
      create: (): { post: PostMock } => {
        return { post };
      },
    },
  };
});

import AgentClient from "../../Services/RunnerClient";
import RunnerIdentity from "../../Utils/RunnerIdentity";
import { RUNNER_KEY, RUNNER_VERSION } from "../../Config";

function readRunnerSource(...parts: Array<string>): string {
  return fs
    .readFileSync(path.join(__dirname, "..", "..", ...parts), "utf8")
    .replace(/\s+/g, " ");
}

function lastPostBody(): JSONObject {
  expect(post).toHaveBeenCalled();

  const calls: Array<Array<unknown>> = post.mock.calls as Array<Array<unknown>>;

  return calls[calls.length - 1]![1] as JSONObject;
}

describe("RunnerClient.heartbeat wire body", () => {
  beforeEach(() => {
    post.mockReset();
    post.mockResolvedValue({ status: 200, data: {} });
  });

  test("sends the version under the `agentVersion` key", async () => {
    await AgentClient.heartbeat({ agentVersion: "7.4.1" });

    expect(lastPostBody()["agentVersion"]).toBe("7.4.1");
  });

  /*
   * The rename regression test. `runnerVersion` would match the new label but
   * would be ignored by every server, old and new.
   */
  test("does not send a `runnerVersion` key", async () => {
    await AgentClient.heartbeat({ agentVersion: "7.4.1" });

    expect(Object.keys(lastPostBody())).not.toContain("runnerVersion");
  });

  test("posts to /heartbeat with the Runner's credentials alongside it", async () => {
    await AgentClient.heartbeat({ agentVersion: "7.4.1" });

    expect(post.mock.calls[0]![0]).toBe("/heartbeat");

    const body: JSONObject = lastPostBody();

    expect(body["agentId"]).toBe(RunnerIdentity.getRunnerId().toString());
    expect(body["agentKey"]).toBe(RUNNER_KEY);
  });

  /*
   * The version is spread conditionally, so an unset one must drop the key
   * rather than send `undefined` — JSON.stringify would omit it anyway, but a
   * literal null would overwrite nothing and confuse the server-side guard.
   */
  test("omits the key entirely when no version is given", async () => {
    await AgentClient.heartbeat({});

    expect(Object.keys(lastPostBody())).not.toContain("agentVersion");
  });

  test("sends hostInfo alongside the version without disturbing it", async () => {
    await AgentClient.heartbeat({
      agentVersion: "7.4.1",
      hostInfo: { hostname: "runner-1" },
    });

    const body: JSONObject = lastPostBody();

    expect(body["agentVersion"]).toBe("7.4.1");
    expect(body["hostInfo"]).toEqual({ hostname: "runner-1" });
  });
});

describe("the heartbeat job feeds RUNNER_VERSION into that key", () => {
  /*
   * Config resolves RUNNER_VERSION from APP_VERSION with a "1.0.0" fallback —
   * which is why a Runner that has never been version-stamped shows 1.0.0 in
   * the dashboard rather than a blank field.
   */
  test("RUNNER_VERSION is a non-empty string", () => {
    expect(typeof RUNNER_VERSION).toBe("string");
    expect(RUNNER_VERSION.length).toBeGreaterThan(0);
  });

  /*
   * startHeartbeat schedules a setInterval at import time, so it is read as
   * source rather than invoked — importing it would leave a timer running for
   * the rest of the suite.
   */
  test("the heartbeat job passes it as agentVersion", () => {
    expect(readRunnerSource("Jobs", "Heartbeat.ts")).toContain(
      "agentVersion: RUNNER_VERSION,",
    );
  });

  test("registration reports the same key on first contact", () => {
    expect(readRunnerSource("Services", "RegisterRunner.ts")).toContain(
      "agentVersion: RUNNER_VERSION,",
    );
  });
});
