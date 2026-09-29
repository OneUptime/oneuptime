/*
 * ---------------------------------------------------------------------------
 * What AgentClient makes of the server's answers to a job heartbeat and a
 * job result, which is what the executor's retry decisions rest on:
 *
 *  - true: the server did it (renewed the lease / stored the result);
 *  - false: the server answered and will not (the job is no longer this
 *    Runner's, the result already exists, the request was refused): final;
 *  - a rejection: the request may not have reached the server (no answer,
 *    or a 5xx, 408 or 429): what it carried may still be unrecorded, and
 *    sending it again is safe.
 *
 * The server answers a result with 200 whether or not it stored it, and says
 * which in `accepted`; reading that is what tells a lapsed lease from a
 * stored result.
 *
 * axios is mocked at module load (RunnerClient builds its instance then), so
 * every request is captured from the one `post` mock.
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
  RunnerIngestUnavailableError,
  isRetryableIngestStatus,
} from "../../Services/RunnerClient";
import KubernetesAgentMode from "../../Utils/KubernetesAgentMode";
import RunnerIdentity from "../../Utils/RunnerIdentity";
import logger from "Common/Server/Utils/Logger";

const RETRYABLE_STATUSES: Array<number> = [500, 502, 503, 504, 408, 429];
const FINAL_STATUSES: Array<number> = [400, 401, 403, 404, 409, 410, 413, 422];

function postedUrl(index: number): string {
  return String((post.mock.calls[index] as Array<unknown>)[0]);
}

function postedBody(index: number): JSONObject {
  return (post.mock.calls[index] as Array<unknown>)[1] as JSONObject;
}

function postedConfig(index: number): unknown {
  return (post.mock.calls[index] as Array<unknown>)[2];
}

function networkError(): Error {
  return Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:443"), {
    code: "ECONNREFUSED",
  });
}

beforeEach(() => {
  post.mockReset();
  (logger.error as jest.Mock).mockClear();
  (logger.warn as jest.Mock).mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("isRetryableIngestStatus", () => {
  test.each(RETRYABLE_STATUSES)("%s is worth sending again", (s: number) => {
    expect(isRetryableIngestStatus(s)).toBe(true);
  });

  test.each(FINAL_STATUSES)(
    "%s is the server's answer, not retried",
    (s: number) => {
      expect(isRetryableIngestStatus(s)).toBe(false);
    },
  );
});

describe("AgentClient.submitJobResult", () => {
  test("posts only the fields it was given, with the Runner's credentials, to the job's result route", async () => {
    post.mockResolvedValue({ status: 200, data: { accepted: true } });

    await AgentClient.submitJobResult({
      jobId: "job/1",
      success: false,
      output: "Error from server (Forbidden)",
      exitCode: 1,
    });

    expect(postedUrl(0)).toBe("/job/job%2F1/result");
    expect(postedBody(0)).toEqual({
      agentId: RunnerIdentity.getRunnerId().toString(),
      agentKey: RunnerIdentity.getRunnerKey(),
      success: false,
      output: "Error from server (Forbidden)",
      exitCode: 1,
    });
  });

  test("accepted: true is stored", async () => {
    post.mockResolvedValue({ status: 200, data: { accepted: true } });

    await expect(
      AgentClient.submitJobResult({ jobId: "job-1", success: true }),
    ).resolves.toBe(true);
  });

  /*
   * The server's answer when the lease has lapsed (the job was timed out)
   * or the job already has a result. Read as stored before, so the Runner
   * never learned its result was dropped.
   */
  test("accepted: false is NOT stored, although the status is 200", async () => {
    post.mockResolvedValue({ status: 200, data: { accepted: false } });

    await expect(
      AgentClient.submitJobResult({ jobId: "job-1", success: true }),
    ).resolves.toBe(false);
  });

  const BODIES_WITHOUT_ACCEPTED: Array<[string, unknown]> = [
    ["an empty object", {}],
    ["an empty string", ""],
    ["nothing", undefined],
  ];

  test.each(BODIES_WITHOUT_ACCEPTED)(
    "a 2xx with %s (no `accepted`) is read as stored",
    async (_label: string, data: unknown) => {
      post.mockResolvedValue({ status: 200, data });

      await expect(
        AgentClient.submitJobResult({ jobId: "job-1", success: true }),
      ).resolves.toBe(true);
    },
  );

  test.each(FINAL_STATUSES)(
    "a %s is a final refusal: resolves false and logs the server's answer",
    async (status: number) => {
      post.mockResolvedValue({ status, data: { message: "nope" } });

      await expect(
        AgentClient.submitJobResult({ jobId: "job-1", success: true }),
      ).resolves.toBe(false);
      expect(String((logger.error as jest.Mock).mock.calls[0]![0])).toContain(
        `submit-job-result rejected (${status})`,
      );
    },
  );

  test.each(RETRYABLE_STATUSES)(
    "a %s rejects, so the caller can send the result again",
    async (status: number) => {
      post.mockResolvedValue({ status, data: { message: "Bad Gateway" } });

      const attempt: Promise<boolean> = AgentClient.submitJobResult({
        jobId: "job-1",
        success: true,
      });

      await expect(attempt).rejects.toBeInstanceOf(
        RunnerIngestUnavailableError,
      );
      await expect(attempt).rejects.toMatchObject({ statusCode: status });
      await expect(attempt).rejects.toThrow(`HTTP ${status}`);
    },
  );

  test("no answer at all rejects with the network error", async () => {
    const error: Error = networkError();
    post.mockRejectedValue(error);

    await expect(
      AgentClient.submitJobResult({ jobId: "job-1", success: true }),
    ).rejects.toBe(error);
  });

  test("a proxy's long error page is cut short in the error message", async () => {
    const page: string = `<html><body>${"x".repeat(5_000)}</body></html>`;
    post.mockResolvedValue({ status: 502, data: page });

    let caught: unknown = null;
    try {
      await AgentClient.submitJobResult({ jobId: "job-1", success: true });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RunnerIngestUnavailableError);
    const message: string = (caught as Error).message;
    expect(
      message.startsWith("Result for job job-1 failed with HTTP 502: "),
    ).toBe(true);
    expect(message.endsWith("…")).toBe(true);
    expect(message.length).toBeLessThan(
      RunnerIngestUnavailableError.MAX_BODY_CHARS + 100,
    );
  });
});

describe("AgentClient.jobHeartbeat", () => {
  test("a 2xx renews the lease", async () => {
    post.mockResolvedValue({ status: 200, data: { status: "ok" } });

    await expect(AgentClient.jobHeartbeat("job-1")).resolves.toBe(true);
    expect(postedUrl(0)).toBe("/job/job-1/heartbeat");
    expect(postedBody(0)).toEqual({
      agentId: RunnerIdentity.getRunnerId().toString(),
      agentKey: RunnerIdentity.getRunnerKey(),
    });
  });

  test("a 404 says the job is no longer this Runner's: false", async () => {
    post.mockResolvedValue({
      status: 404,
      data: {
        message:
          "Job is no longer owned by this agent (lease expired or job terminated).",
      },
    });

    await expect(AgentClient.jobHeartbeat("job-1")).resolves.toBe(false);
  });

  test.each(FINAL_STATUSES)("a %s is final: false", async (status: number) => {
    post.mockResolvedValue({ status, data: {} });

    await expect(AgentClient.jobHeartbeat("job-1")).resolves.toBe(false);
  });

  /*
   * Before, every non-2xx resolved false, so "the server is down" read the
   * same as "the job is gone", and a caller that stops a step on the second
   * could not run it best effort through the first.
   */
  test.each(RETRYABLE_STATUSES)(
    "a %s rejects: whether the lease was renewed is unknown",
    async (status: number) => {
      post.mockResolvedValue({ status, data: {} });

      await expect(AgentClient.jobHeartbeat("job-1")).rejects.toMatchObject({
        name: "RunnerIngestUnavailableError",
        statusCode: status,
      });
    },
  );

  test("no answer at all rejects", async () => {
    const error: Error = networkError();
    post.mockRejectedValue(error);

    await expect(AgentClient.jobHeartbeat("job-1")).rejects.toBe(error);
  });

  test("a caller's timeout bounds that one request", async () => {
    post.mockResolvedValue({ status: 200, data: {} });

    await AgentClient.jobHeartbeat("job-1", { timeoutInMs: 5_000 });

    expect(postedConfig(0)).toEqual({ timeout: 5_000 });
  });

  test("without one, the client's default applies", async () => {
    post.mockResolvedValue({ status: 200, data: {} });

    await AgentClient.jobHeartbeat("job-1");

    expect(postedConfig(0)).toBeUndefined();
  });
});

describe("the claim-time refusal is still best effort", () => {
  beforeEach(() => {
    jest.spyOn(KubernetesAgentMode, "isActive").mockReturnValue(true);
  });

  function bashJob(): ClaimedJob {
    return {
      jobId: "job-9",
      origin: "AiRemediation",
      stepId: "step-1",
      stepType: "Bash",
      script: "kubectl delete pods --all -n web",
      timeoutInMs: 30000,
    };
  }

  const REFUSAL_FAILURES: Array<[string, string]> = [
    ["no answer", "network"],
    ["a 503", "503"],
  ];

  test.each(REFUSAL_FAILURES)(
    "a refused job whose refusal gets %s is still not returned, and claiming does not throw",
    async (_label: string, failure: string) => {
      post.mockResolvedValueOnce({ status: 200, data: { job: bashJob() } });

      if (failure === "network") {
        post.mockRejectedValueOnce(networkError());
      } else {
        post.mockResolvedValueOnce({ status: 503, data: {} });
      }

      await expect(AgentClient.claimNextJob()).resolves.toBeNull();
      expect(post).toHaveBeenCalledTimes(2);
      expect(postedUrl(1)).toBe("/job/job-9/result");
      expect(String((logger.warn as jest.Mock).mock.calls[1]![0])).toContain(
        "Could not report the claim-time refusal of job job-9",
      );
    },
  );
});
