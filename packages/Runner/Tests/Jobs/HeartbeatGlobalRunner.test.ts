/*
 * ---------------------------------------------------------------------------
 * A Runner learns it is global from the server, on every heartbeat.
 *
 * A global Runner is started like any Runner, with its id and key; only the
 * server's answer says it serves every project. The heartbeat adopts that
 * answer each time - and an answer that does not say (an older server)
 * leaves the Runner as it was.
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

const heartbeat: jest.Mock = AgentClient.heartbeat as jest.Mock;

beforeEach(() => {
  heartbeat.mockReset();
  jest.spyOn(KubernetesAgentMode, "isActive").mockReturnValue(false);
});

afterEach(() => {
  GlobalRunnerMode.reset();
  jest.restoreAllMocks();
});

describe("the heartbeat and global Runners", () => {
  test("a heartbeat saying the Runner is global makes it one, taking its code fixes, with AI commands off", async () => {
    heartbeat.mockResolvedValue({
      ok: true,
      statusCode: 200,
      isGlobalRunner: true,
      capabilities: {
        canRunRunbooks: true,
        canRunCodeFixTasks: true,
        canRunAiCommands: true,
      },
    });

    await new HeartbeatLoop().tick();

    expect(GlobalRunnerMode.isActive()).toBe(true);
    expect(RunnerCapabilities.resolve()).toEqual({
      canRunRunbooks: true,
      canRunCodeFixTasks: true,
      canRunAiCommands: false,
    });
  });

  test("a heartbeat saying the Runner is global with no code fixes leaves them off", async () => {
    heartbeat.mockResolvedValue({
      ok: true,
      statusCode: 200,
      isGlobalRunner: true,
      capabilities: {
        canRunRunbooks: true,
        canRunCodeFixTasks: false,
        canRunAiCommands: false,
      },
    });

    await new HeartbeatLoop().tick();

    expect(GlobalRunnerMode.isActive()).toBe(true);
    expect(RunnerCapabilities.resolve().canRunCodeFixTasks).toBe(false);
  });

  test("a heartbeat that does not say leaves the Runner as it was", async () => {
    GlobalRunnerMode.setFromServer(true);
    heartbeat.mockResolvedValue({
      ok: true,
      statusCode: 200,
      capabilities: {
        canRunRunbooks: true,
        canRunCodeFixTasks: false,
        canRunAiCommands: false,
      },
    });

    await new HeartbeatLoop().tick();

    expect(GlobalRunnerMode.isActive()).toBe(true);
  });

  test("a rejected heartbeat changes nothing", async () => {
    GlobalRunnerMode.setFromServer(true);
    heartbeat.mockResolvedValue({ ok: false, statusCode: 500 });

    await new HeartbeatLoop().tick();

    expect(GlobalRunnerMode.isActive()).toBe(true);
  });

  test("negative control: a heartbeat saying the Runner is not global keeps it a project's own", async () => {
    heartbeat.mockResolvedValue({
      ok: true,
      statusCode: 200,
      isGlobalRunner: false,
    });

    await new HeartbeatLoop().tick();

    expect(GlobalRunnerMode.isActive()).toBe(false);
  });
});
