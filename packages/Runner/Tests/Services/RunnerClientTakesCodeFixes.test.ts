/*
 * ---------------------------------------------------------------------------
 * The Runner half of the takesCodeFixes wire contract.
 *
 * The server reads `takesCodeFixes` off POST /heartbeat (App's
 * Tests/Runbook/RunnerHeartbeatTakesCodeFixes pins that half): a boolean is
 * the Runner's word, anything else - no key at all - is a Runner saying
 * nothing. So the client sends the key only when it has a boolean to send,
 * never undefined or null, and never under another name.
 * ---------------------------------------------------------------------------
 */

import { JSONObject } from "Common/Types/JSON";
import fs from "fs";
import path from "path";

type PostMock = jest.Mock;

const post: PostMock = jest.fn();

// RunnerClient builds its axios instance at module load.
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

describe("RunnerClient.heartbeat says whether the Runner takes AI code fixes", () => {
  beforeEach(() => {
    post.mockReset();
    post.mockResolvedValue({ status: 200, data: {} });
  });

  test.each([true, false])(
    "sends %s under the takesCodeFixes key",
    async (takesCodeFixes: boolean) => {
      await AgentClient.heartbeat({ agentVersion: "14.0.102", takesCodeFixes });

      expect(post.mock.calls[0]![0]).toBe("/heartbeat");
      expect(lastPostBody()["takesCodeFixes"]).toBe(takesCodeFixes);
      expect(lastPostBody()["agentVersion"]).toBe("14.0.102");
    },
  );

  test("sends no key at all when it has no answer to give", async () => {
    await AgentClient.heartbeat({ agentVersion: "14.0.102" });

    expect(Object.keys(lastPostBody())).not.toContain("takesCodeFixes");
  });

  test("never under a near-miss name the server ignores", async () => {
    await AgentClient.heartbeat({ takesCodeFixes: false });

    const keys: Array<string> = Object.keys(lastPostBody());

    for (const nearMiss of [
      "canRunCodeFixTasks",
      "codeFixes",
      "takesCodeFix",
    ]) {
      expect(keys).not.toContain(nearMiss);
    }
  });
});

describe("the Runner says it from its first contact on", () => {
  /*
   * startHeartbeat schedules an interval at import and registration retries
   * forever, so their wiring is read as source here; the heartbeat loop and
   * the registration request are driven for real in
   * Jobs/HeartbeatTakesCodeFixes and Services/RegisterRunner.
   */
  test("the heartbeat job and the registration both send RunnerCapabilities.takesCodeFixes()", () => {
    expect(readRunnerSource("Jobs", "Heartbeat.ts")).toContain(
      "takesCodeFixes: RunnerCapabilities.takesCodeFixes(),",
    );
    expect(readRunnerSource("Services", "RegisterRunner.ts")).toContain(
      "takesCodeFixes: RunnerCapabilities.takesCodeFixes(),",
    );
  });
});
