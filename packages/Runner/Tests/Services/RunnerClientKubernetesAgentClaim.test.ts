/*
 * ---------------------------------------------------------------------------
 * Claim time on the kubernetes-agent Runner.
 *
 * Execution-time refusal (RunbookExecutorKubernetesAgentMode.test.ts) is the
 * last line; this is the first. The agent Runner asks the server for Kubectl
 * steps only (`stepTypes` on the claim body), and when a server that
 * predates the filter hands it something else anyway, the job is failed
 * right there with the reason — never handed to an executor, and never left
 * to sit until its lease lapses and be re-claimed in a loop.
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

import AgentClient, { ClaimedJob } from "../../Services/RunnerClient";
import KubernetesAgentMode from "../../Utils/KubernetesAgentMode";
import RunnerIdentity from "../../Utils/RunnerIdentity";

function claimedJob(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    jobId: "job-9",
    origin: "AiRemediation",
    stepId: "step-1",
    stepType: "Bash",
    script: "kubectl delete pods --all -n web",
    timeoutInMs: 30000,
    ...overrides,
  };
}

function postedUrl(index: number): string {
  return String((post.mock.calls[index] as Array<unknown>)[0]);
}

function postedBody(index: number): JSONObject {
  return (post.mock.calls[index] as Array<unknown>)[1] as JSONObject;
}

beforeEach(() => {
  post.mockReset();
  jest.spyOn(KubernetesAgentMode, "isActive").mockReturnValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what the kubernetes-agent Runner asks for", () => {
  test("the claim body asks for Kubectl steps only, alongside the Runner's credentials", async () => {
    post.mockResolvedValue({ status: 200, data: { job: null } });

    await AgentClient.claimNextJob();

    expect(postedUrl(0)).toBe("/claim-next-job");
    const body: JSONObject = postedBody(0);
    expect(body["stepTypes"]).toEqual(["Kubectl"]);
    expect(body["agentId"]).toBe(RunnerIdentity.getRunnerId().toString());
    expect(body["agentKey"]).toBe(RunnerIdentity.getRunnerKey());
  });

  test("an ordinary Runner sends no step-type filter at all", async () => {
    (KubernetesAgentMode.isActive as jest.Mock).mockReturnValue(false);
    post.mockResolvedValue({ status: 200, data: { job: null } });

    await AgentClient.claimNextJob();

    expect(Object.keys(postedBody(0))).not.toContain("stepTypes");
  });
});

describe("what the kubernetes-agent Runner does with what it is handed", () => {
  test("a Kubectl job is returned as-is", async () => {
    const job: ClaimedJob = claimedJob({
      stepType: "Kubectl",
      script: "",
      payload: { args: ["get", "pods"] },
    });
    post.mockResolvedValue({ status: 200, data: { job } });

    const claimed: ClaimedJob | null = await AgentClient.claimNextJob();

    expect(claimed).toEqual(job);
    expect(post).toHaveBeenCalledTimes(1);
  });

  test("no job is no job", async () => {
    post.mockResolvedValue({ status: 200, data: { job: null } });

    expect(await AgentClient.claimNextJob()).toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
  });

  /*
   * The scenario from the review: an older server (or one whose filter was
   * bypassed) hands the agent Runner an AI-composed Bash command. It is
   * failed at claim time with the reason and never returned to the caller.
   */
  test.each(["Bash", "SSH", "JavaScript", "Kubernetes"])(
    "a %s job from a server that ignores the filter is failed at claim time and never returned",
    async (stepType: string) => {
      const job: ClaimedJob = claimedJob({
        stepType: stepType as ClaimedJob["stepType"],
      });
      post
        .mockResolvedValueOnce({ status: 200, data: { job } })
        .mockResolvedValueOnce({ status: 200, data: { accepted: true } });

      const claimed: ClaimedJob | null = await AgentClient.claimNextJob();

      expect(claimed).toBeNull();
      expect(post).toHaveBeenCalledTimes(2);
      expect(postedUrl(1)).toBe("/job/job-9/result");

      const result: JSONObject = postedBody(1);
      expect(result["success"]).toBe(false);
      expect(String(result["errorMessage"])).toContain(
        "only runs policy-tiered kubectl",
      );
      expect(String(result["errorMessage"])).toContain(
        `never ${stepType} steps`,
      );
      expect(result["agentId"]).toBe(RunnerIdentity.getRunnerId().toString());
    },
  );

  test("a refused job whose result the server will not take is still not returned", async () => {
    post
      .mockResolvedValueOnce({ status: 200, data: { job: claimedJob() } })
      .mockResolvedValueOnce({ status: 500, data: {} });

    await expect(AgentClient.claimNextJob()).resolves.toBeNull();
  });

  test("a rejected claim is no job", async () => {
    post.mockResolvedValue({ status: 401, data: { message: "bad key" } });

    expect(await AgentClient.claimNextJob()).toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe("an ordinary Runner is unaffected", () => {
  beforeEach(() => {
    (KubernetesAgentMode.isActive as jest.Mock).mockReturnValue(false);
  });

  test.each(["Bash", "SSH", "JavaScript", "Kubernetes", "Kubectl"])(
    "a %s job is returned to the caller",
    async (stepType: string) => {
      const job: ClaimedJob = claimedJob({
        stepType: stepType as ClaimedJob["stepType"],
      });
      post.mockResolvedValue({ status: 200, data: { job } });

      expect(await AgentClient.claimNextJob()).toEqual(job);
      expect(post).toHaveBeenCalledTimes(1);
    },
  );
});
