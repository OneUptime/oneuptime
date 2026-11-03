/*
 * ---------------------------------------------------------------------------
 * Every heartbeat says whether this Runner takes AI code fixes.
 *
 * The server counts a Runner as there to take a repository's fixes only
 * while it says so (Common/Types/Runner/RunnerCodeFixes), so the heartbeat
 * carries RunnerCapabilities.takesCodeFixes() each time - whatever the
 * server answered last, and from a Runner that is global or a project's.
 * ---------------------------------------------------------------------------
 */

jest.mock("../../Services/RunnerClient", () => {
  return {
    __esModule: true,
    default: { heartbeat: jest.fn(), disconnect: jest.fn() },
  };
});

jest.mock("../../Services/RegisterRunner", () => {
  return {
    __esModule: true,
    default: { registerRunner: jest.fn(), tryRegisterRunner: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  };
});

import { HeartbeatLoop } from "../../Jobs/Heartbeat";
import AgentClient from "../../Services/RunnerClient";
import GlobalRunnerMode from "../../Utils/GlobalRunnerMode";
import KubernetesAgentMode from "../../Utils/KubernetesAgentMode";
import RunnerCapabilities from "../../Utils/RunnerCapabilities";
import { RUNNER_VERSION } from "../../Config";
import { JSONObject } from "Common/Types/JSON";

const heartbeat: jest.Mock = AgentClient.heartbeat as jest.Mock;

interface HeartbeatBody {
  agentVersion?: string | undefined;
  hostInfo?: JSONObject | undefined;
  takesCodeFixes?: boolean | undefined;
}

function sentBodies(): Array<HeartbeatBody> {
  return heartbeat.mock.calls.map((call: Array<unknown>): HeartbeatBody => {
    return call[0] as HeartbeatBody;
  });
}

beforeEach(() => {
  heartbeat.mockReset();
  heartbeat.mockResolvedValue({
    ok: true,
    statusCode: 200,
    capabilities: {
      canRunRunbooks: true,
      canRunCodeFixTasks: true,
      canRunAiCommands: false,
    },
  });
  jest.spyOn(KubernetesAgentMode, "isActive").mockReturnValue(false);
});

afterEach(() => {
  GlobalRunnerMode.reset();
  jest.restoreAllMocks();
});

describe("the heartbeat says whether the Runner takes AI code fixes", () => {
  test.each([true, false])(
    "it sends what the Runner's host allows (%s), beside its version and host",
    async (takes: boolean) => {
      jest.spyOn(RunnerCapabilities, "takesCodeFixes").mockReturnValue(takes);

      await new HeartbeatLoop().tick();

      expect(sentBodies()).toHaveLength(1);
      expect(sentBodies()[0]!.takesCodeFixes).toBe(takes);
      expect(sentBodies()[0]!.agentVersion).toBe(RUNNER_VERSION);
      expect(sentBodies()[0]!.hostInfo).toBeDefined();
    },
  );

  test("on every heartbeat, as it is then", async () => {
    const takes: jest.SpyInstance = jest
      .spyOn(RunnerCapabilities, "takesCodeFixes")
      .mockReturnValue(true);
    const loop: HeartbeatLoop = new HeartbeatLoop();

    await loop.tick();
    takes.mockReturnValue(false);
    await loop.tick();

    expect(
      sentBodies().map((body: HeartbeatBody): boolean | undefined => {
        return body.takesCodeFixes;
      }),
    ).toEqual([true, false]);
  });

  test("a global Runner says it too", async () => {
    GlobalRunnerMode.setFromServer(true);
    jest.spyOn(RunnerCapabilities, "takesCodeFixes").mockReturnValue(false);

    await new HeartbeatLoop().tick();

    expect(sentBodies()[0]!.takesCodeFixes).toBe(false);
  });
});
