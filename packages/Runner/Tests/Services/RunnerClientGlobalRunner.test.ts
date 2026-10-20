/*
 * ---------------------------------------------------------------------------
 * The global Runner's side of the wire.
 *
 *   - it learns it is global from the server's heartbeat answer
 *     (isGlobalRunner), never from its own environment;
 *   - it asks for what global Runners run (JavaScript) on every claim;
 *   - a job a server hands it anyway that a global Runner never runs is
 *     failed at claim time with the reason, never handed to an executor.
 *
 * axios is mocked at module load (RunnerClient builds its instance then), so
 * every request the client makes is captured from the one `post` mock.
 * ---------------------------------------------------------------------------
 */

import { JSONObject } from "Common/Types/JSON";

type PostMock = jest.Mock;

const post: PostMock = jest.fn();

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

import AgentClient, {
  ClaimedJob,
  HeartbeatResult,
} from "../../Services/RunnerClient";
import GlobalRunnerMode from "../../Utils/GlobalRunnerMode";
import KubernetesAgentMode from "../../Utils/KubernetesAgentMode";

function postedUrl(index: number): string {
  return String((post.mock.calls[index] as Array<unknown>)[0]);
}

function postedBody(index: number): JSONObject {
  return (post.mock.calls[index] as Array<unknown>)[1] as JSONObject;
}

beforeEach(() => {
  post.mockReset();
  jest.spyOn(KubernetesAgentMode, "isActive").mockReturnValue(false);
});

afterEach(() => {
  GlobalRunnerMode.reset();
  jest.restoreAllMocks();
});

describe("the heartbeat answer", () => {
  test("carries whether the server says this Runner is global", async () => {
    post.mockResolvedValue({
      status: 200,
      data: {
        status: "ok",
        isGlobalRunner: true,
        capabilities: {
          canRunRunbooks: true,
          canRunCodeFixTasks: false,
          canRunAiCommands: false,
        },
      },
    });

    const result: HeartbeatResult = await AgentClient.heartbeat({});

    expect(result.ok).toBe(true);
    expect(result.isGlobalRunner).toBe(true);
  });

  test("a server that does not say leaves it unsaid", async () => {
    post.mockResolvedValue({
      status: 200,
      data: { status: "ok", capabilities: { canRunRunbooks: true } },
    });

    const result: HeartbeatResult = await AgentClient.heartbeat({});

    expect(result).not.toHaveProperty("isGlobalRunner");
  });

  test("an answer that is not a yes or no is not taken as one", async () => {
    post.mockResolvedValue({
      status: 200,
      data: { status: "ok", isGlobalRunner: "true" },
    });

    expect(await AgentClient.heartbeat({})).not.toHaveProperty(
      "isGlobalRunner",
    );
  });
});

describe("what a global Runner asks for", () => {
  test("JavaScript steps only, alongside its credentials", async () => {
    GlobalRunnerMode.setFromServer(true);
    post.mockResolvedValue({ status: 200, data: { job: null } });

    await AgentClient.claimNextJob();

    expect(postedUrl(0)).toBe("/claim-next-job");
    expect(postedBody(0)["stepTypes"]).toEqual(["JavaScript"]);
    expect(postedBody(0)["agentId"]).toBeDefined();
    expect(postedBody(0)["agentKey"]).toBeDefined();
  });

  test("negative control: a project's own Runner sends no step-type filter", async () => {
    GlobalRunnerMode.setFromServer(false);
    post.mockResolvedValue({ status: 200, data: { job: null } });

    await AgentClient.claimNextJob();

    expect(Object.keys(postedBody(0))).not.toContain("stepTypes");
  });
});

describe("what a global Runner does with what it is handed", () => {
  beforeEach(() => {
    GlobalRunnerMode.setFromServer(true);
  });

  test("a runbook's JavaScript step is returned as-is", async () => {
    const job: ClaimedJob = {
      jobId: "job-1",
      origin: "Runbook",
      stepId: "step-1",
      stepType: "JavaScript",
      script: "return 1;",
      timeoutInMs: 30000,
    };
    post.mockResolvedValue({ status: 200, data: { job } });

    expect(await AgentClient.claimNextJob()).toEqual(job);
    expect(post).toHaveBeenCalledTimes(1);
  });

  test("a Bash step is failed at claim time with the reason, and not returned", async () => {
    post
      .mockResolvedValueOnce({
        status: 200,
        data: {
          job: {
            jobId: "job-2",
            origin: "Runbook",
            stepId: "step-1",
            stepType: "Bash",
            script: "cat /proc/1/environ",
            timeoutInMs: 30000,
          },
        },
      })
      .mockResolvedValueOnce({ status: 200, data: { accepted: true } });

    expect(await AgentClient.claimNextJob()).toBeNull();

    expect(postedUrl(1)).toBe("/job/job-2/result");
    expect(postedBody(1)["success"]).toBe(false);
    expect(String(postedBody(1)["errorMessage"])).toContain(
      "This is a global Runner",
    );
  });

  test("a job carrying a credential is failed at claim time", async () => {
    post
      .mockResolvedValueOnce({
        status: 200,
        data: {
          job: {
            jobId: "job-3",
            origin: "Runbook",
            stepId: "step-1",
            stepType: "JavaScript",
            script: "return 1;",
            timeoutInMs: 30000,
            credential: { token: "t" },
          },
        },
      })
      .mockResolvedValueOnce({ status: 200, data: { accepted: true } });

    expect(await AgentClient.claimNextJob()).toBeNull();
    expect(String(postedBody(1)["errorMessage"])).toContain(
      "never handed a credential",
    );
  });
});
