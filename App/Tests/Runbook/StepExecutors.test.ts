import axios from "axios";
import ObjectID from "Common/Types/ObjectID";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import RunnerJobStatus from "Common/Types/Runbook/RunnerJobStatus";
import RunnerJobService from "Common/Server/Services/RunnerJobService";
import RunnerJob from "Common/Models/DatabaseModels/RunnerJob";
import logger from "Common/Server/Utils/Logger";
import {
  BashStepConfig,
  HttpRequestStepConfig,
  JavaScriptStepConfig,
  RunbookStep,
} from "Common/Types/Runbook/RunbookStep";
import {
  DEFAULT_AGENT_CLAIM_TIMEOUT_IN_MS,
  DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS,
  MAX_AGENT_CLAIM_TIMEOUT_IN_MS,
  MAX_STEP_EXECUTION_TIMEOUT_IN_MS,
  MIN_AGENT_CLAIM_TIMEOUT_IN_MS,
  MIN_STEP_EXECUTION_TIMEOUT_IN_MS,
} from "Common/Types/Runbook/RunbookStepTimeout";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import {
  runBashStep,
  runHttpStep,
  runJavaScriptStep,
  truncate,
  StepExecutionContext,
  StepRunResult,
} from "../../FeatureSet/Runbook/Services/StepExecutors";

function makeCtx(): StepExecutionContext {
  return {
    projectId: new ObjectID("proj1"),
    runbookExecutionId: new ObjectID("exec1"),
  };
}

function makeHttpStep(
  config: Partial<HttpRequestStepConfig> = {},
): RunbookStep {
  return {
    id: "s1",
    order: 0,
    type: RunbookStepType.HttpRequest,
    title: "Call API",
    config: {
      url: "https://api.example.com/health",
      method: "GET",
      ...config,
    } as HttpRequestStepConfig,
  };
}

function makeBashStep(config: Partial<BashStepConfig> = {}): RunbookStep {
  return {
    id: "s2",
    order: 0,
    type: RunbookStepType.Bash,
    title: "Run script",
    config: {
      script: "echo hi",
      agentId: new ObjectID("agent1").toString(),
      ...config,
    } as BashStepConfig,
  };
}

function makeJsStep(config: Partial<JavaScriptStepConfig> = {}): RunbookStep {
  return {
    id: "s3",
    order: 0,
    type: RunbookStepType.JavaScript,
    title: "Run JS",
    config: {
      script: "return 1;",
      agentId: new ObjectID("agent1").toString(),
      ...config,
    } as JavaScriptStepConfig,
  };
}

function makeTerminalJob(
  overrides: Partial<Record<string, unknown>> = {},
): RunnerJob {
  return {
    _id: "job1",
    status: RunnerJobStatus.Succeeded,
    output: "job output",
    ...overrides,
  } as unknown as RunnerJob;
}

describe("truncate", () => {
  test("passes short output through untouched", () => {
    expect(truncate("hello")).toBe("hello");
  });

  test("caps output at 50 KB and marks the cut", () => {
    const result: string = truncate("a".repeat(60_000));
    expect(result.length).toBeLessThan(60_000);
    expect(result.endsWith("... [output truncated]")).toBe(true);
  });
});

describe("runHttpStep", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("2xx responses succeed and capture status, headers and body", async () => {
    jest.spyOn(axios, "request").mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json" },
      data: { ok: true },
    } as never);

    const result: StepRunResult = await runHttpStep(makeHttpStep());

    expect(result.success).toBe(true);
    expect(result.output).toContain("Status: 200 OK");
    expect(result.output).toContain("content-type");
    expect(result.output).toContain('"ok": true');
  });

  test("3xx responses still count as success", async () => {
    jest.spyOn(axios, "request").mockResolvedValue({
      status: 302,
      statusText: "Found",
      headers: {},
      data: "",
    } as never);

    const result: StepRunResult = await runHttpStep(makeHttpStep());

    expect(result.success).toBe(true);
  });

  test("4xx/5xx responses fail with the status code but keep the output", async () => {
    jest.spyOn(axios, "request").mockResolvedValue({
      status: 503,
      statusText: "Service Unavailable",
      headers: {},
      data: "backend down",
    } as never);

    const result: StepRunResult = await runHttpStep(makeHttpStep());

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe("HTTP 503");
    expect(result.output).toContain("backend down");
  });

  test("invalid headers JSON fails before any request is made", async () => {
    const requestSpy: jest.SpyInstance = jest.spyOn(axios, "request");

    const result: StepRunResult = await runHttpStep(
      makeHttpStep({ headersJson: "{not json" }),
    );

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("Invalid headers JSON");
    expect(requestSpy).not.toHaveBeenCalled();
  });

  test("JSON bodies are parsed; non-JSON bodies pass through as raw strings", async () => {
    const requestSpy: jest.SpyInstance = jest
      .spyOn(axios, "request")
      .mockResolvedValue({
        status: 200,
        statusText: "OK",
        headers: {},
        data: "",
      } as never);

    await runHttpStep(makeHttpStep({ method: "POST", body: '{"a": 1}' }));
    expect(requestSpy.mock.calls[0]![0]).toMatchObject({ data: { a: 1 } });

    await runHttpStep(
      makeHttpStep({ method: "POST", body: "plain text body" }),
    );
    expect(requestSpy.mock.calls[1]![0]).toMatchObject({
      data: "plain text body",
    });
  });

  test("network errors fail the step with the error message", async () => {
    jest.spyOn(axios, "request").mockRejectedValue(new Error("ECONNREFUSED"));

    const result: StepRunResult = await runHttpStep(makeHttpStep());

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("ECONNREFUSED");
  });

  test("giant response bodies are truncated to the output cap", async () => {
    jest.spyOn(axios, "request").mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: {},
      data: "x".repeat(200_000),
    } as never);

    const result: StepRunResult = await runHttpStep(makeHttpStep());

    expect(result.success).toBe(true);
    expect(result.output.length).toBeLessThan(60_000);
    expect(result.output).toContain("[output truncated]");
  });
});

describe("agent-dispatched steps (Bash / JavaScript)", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "info").mockImplementation((): void => {
      return undefined;
    });
    /*
     * No job exists for the step yet — the ordinary first dispatch, and the
     * baseline for every test in here. Redelivery, where a row already
     * exists, has its own describe block below.
     */
    jest
      .spyOn(RunnerJobService, "findLatestJobForStep")
      .mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("Bash without an agent fails with a pointer to the Agents page", async () => {
    const result: StepRunResult = await runBashStep(
      makeBashStep({ agentId: "  " }),
      makeCtx(),
    );

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("missing a Runbook Agent");
  });

  test("JavaScript without an agent fails with a pointer to the Agents page", async () => {
    const result: StepRunResult = await runJavaScriptStep(
      makeJsStep({ agentId: "" }),
      makeCtx(),
    );

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("missing a Runbook Agent");
  });

  test("agent IDs are passed through verbatim to the job targeting", async () => {
    /*
     * ObjectID accepts arbitrary strings, so targeting resolution happens at
     * the job layer (only the selected agent may claim). The executor's job
     * is to forward the configured ID untouched.
     */
    const enqueueSpy: jest.SpyInstance = jest
      .spyOn(RunnerJobService, "enqueue")
      .mockResolvedValue(makeTerminalJob());
    jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockResolvedValue(makeTerminalJob());

    const agentId: string = new ObjectID("agent-xyz").toString();
    await runBashStep(makeBashStep({ agentId: ` ${agentId} ` }), makeCtx());

    const enqueueArgs: Record<string, unknown> = enqueueSpy.mock
      .calls[0]![0] as Record<string, unknown>;
    expect((enqueueArgs["targetAgentId"] as ObjectID).toString()).toBe(agentId);
  });

  test("an empty script succeeds without dispatching a job", async () => {
    const enqueueSpy: jest.SpyInstance = jest.spyOn(
      RunnerJobService,
      "enqueue",
    );

    const result: StepRunResult = await runBashStep(
      makeBashStep({ script: "" }),
      makeCtx(),
    );

    expect(result.success).toBe(true);
    expect(result.output).toBe("");
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  test("polls the job that was just enqueued, with that job's timeouts", async () => {
    /*
     * The enqueued job's id is what the poll must follow. Polling anything
     * else (the execution id, say) would make every agent step fail in
     * production while every output assertion here still passed.
     */
    jest
      .spyOn(RunnerJobService, "enqueue")
      .mockResolvedValue(makeTerminalJob({ _id: "job-42" }));
    const pollSpy: jest.SpyInstance = jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockResolvedValue(makeTerminalJob());

    await runBashStep(
      makeBashStep({ timeoutInMs: 5_000, claimTimeoutInMs: 9_000 }),
      makeCtx(),
    );

    const pollArgs: Record<string, unknown> = pollSpy.mock
      .calls[0]![0] as Record<string, unknown>;
    expect((pollArgs["jobId"] as ObjectID).toString()).toBe("job-42");
    expect(pollArgs["executionTimeoutInMs"]).toBe(5_000);
    expect(pollArgs["claimTimeoutInMs"]).toBe(9_000);
  });

  test("Bash success: enqueues for the configured agent and returns the job output", async () => {
    const enqueueSpy: jest.SpyInstance = jest
      .spyOn(RunnerJobService, "enqueue")
      .mockResolvedValue(makeTerminalJob());
    jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockResolvedValue(makeTerminalJob({ output: "hi from agent" }));

    const step: RunbookStep = makeBashStep();
    const result: StepRunResult = await runBashStep(step, makeCtx());

    expect(result.success).toBe(true);
    expect(result.output).toBe("hi from agent");
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        stepType: RunbookStepType.Bash,
        script: "echo hi",
        stepId: step.id,
      }),
    );
  });

  test("JavaScript success dispatches with the JavaScript step type", async () => {
    const enqueueSpy: jest.SpyInstance = jest
      .spyOn(RunnerJobService, "enqueue")
      .mockResolvedValue(makeTerminalJob());
    jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockResolvedValue(makeTerminalJob({ output: "42" }));

    const result: StepRunResult = await runJavaScriptStep(
      makeJsStep(),
      makeCtx(),
    );

    expect(result.success).toBe(true);
    expect(result.output).toBe("42");
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({ stepType: RunbookStepType.JavaScript }),
    );
  });

  test("a failed job surfaces the agent's error message", async () => {
    jest
      .spyOn(RunnerJobService, "enqueue")
      .mockResolvedValue(makeTerminalJob());
    jest.spyOn(RunnerJobService, "pollUntilTerminal").mockResolvedValue(
      makeTerminalJob({
        status: RunnerJobStatus.Failed,
        output: "partial output",
        errorMessage: "command not found",
      }),
    );

    const result: StepRunResult = await runBashStep(makeBashStep(), makeCtx());

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe("command not found");
    expect(result.output).toBe("partial output");
  });

  test("a failed job without a message falls back to the exit code", async () => {
    jest
      .spyOn(RunnerJobService, "enqueue")
      .mockResolvedValue(makeTerminalJob());
    jest.spyOn(RunnerJobService, "pollUntilTerminal").mockResolvedValue(
      makeTerminalJob({
        status: RunnerJobStatus.Failed,
        output: "",
        errorMessage: undefined,
        exitCode: 127,
      }),
    );

    const result: StepRunResult = await runBashStep(makeBashStep(), makeCtx());

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe("Exit code 127");
  });

  test("a timed-out job falls back to the terminal status", async () => {
    jest
      .spyOn(RunnerJobService, "enqueue")
      .mockResolvedValue(makeTerminalJob());
    jest.spyOn(RunnerJobService, "pollUntilTerminal").mockResolvedValue(
      makeTerminalJob({
        status: RunnerJobStatus.TimedOut,
        output: "",
        errorMessage: undefined,
        exitCode: undefined,
      }),
    );

    const result: StepRunResult = await runBashStep(makeBashStep(), makeCtx());

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain(RunnerJobStatus.TimedOut);
  });

  test("an enqueue failure fails the step with the thrown message", async () => {
    jest
      .spyOn(RunnerJobService, "enqueue")
      .mockRejectedValue(new Error("queue unavailable"));

    const result: StepRunResult = await runBashStep(makeBashStep(), makeCtx());

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("queue unavailable");
  });
});

/*
 * An execution occupies one queue job for its whole run, so a Worker that dies
 * mid-step gets the execution redelivered and walks back to the same step —
 * which is still persisted as Running. Dispatching again would hand the agent
 * a second copy of the script; for the database restore the docs suggest as a
 * long-running step, that is the restore running twice.
 */
describe("redelivery after a Worker restart", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "info").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    RunnerJobStatus.Pending,
    RunnerJobStatus.Claimed,
    RunnerJobStatus.Running,
  ])(
    "an in-flight job (%s) is re-attached to instead of dispatched again",
    async (status: RunnerJobStatus) => {
      jest
        .spyOn(RunnerJobService, "findLatestJobForStep")
        .mockResolvedValue(
          makeTerminalJob({ _id: "existing-job", status, output: undefined }),
        );
      const enqueueSpy: jest.SpyInstance = jest.spyOn(
        RunnerJobService,
        "enqueue",
      );
      const pollSpy: jest.SpyInstance = jest
        .spyOn(RunnerJobService, "pollUntilTerminal")
        .mockResolvedValue(
          makeTerminalJob({ _id: "existing-job", output: "finished later" }),
        );

      const result: StepRunResult = await runBashStep(
        makeBashStep(),
        makeCtx(),
      );

      expect(enqueueSpy).not.toHaveBeenCalled();
      expect(
        (pollSpy.mock.calls[0]![0] as Record<string, unknown>)["jobId"],
      ).toEqual(new ObjectID("existing-job"));
      expect(result.success).toBe(true);
      expect(result.output).toBe("finished later");
    },
  );

  test("re-attaching keeps the original job's clock rather than starting a fresh window", async () => {
    /*
     * Otherwise every redelivery would buy the step another full claim +
     * execution window, and a step configured for an hour could occupy a
     * Worker slot for several.
     */
    const createdAt: Date = new Date("2026-07-30T10:00:00.000Z");
    jest.spyOn(RunnerJobService, "findLatestJobForStep").mockResolvedValue(
      makeTerminalJob({
        _id: "existing-job",
        status: RunnerJobStatus.Running,
        createdAt,
      }),
    );
    const pollSpy: jest.SpyInstance = jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockResolvedValue(makeTerminalJob());

    await runBashStep(makeBashStep(), makeCtx());

    expect(
      (pollSpy.mock.calls[0]![0] as Record<string, unknown>)["waitStartedAt"],
    ).toBe(createdAt);
  });

  test.each([
    RunnerJobStatus.Succeeded,
    RunnerJobStatus.Failed,
    RunnerJobStatus.TimedOut,
    RunnerJobStatus.Cancelled,
  ])(
    "a job that already finished (%s) has its result adopted, not re-run",
    async (status: RunnerJobStatus) => {
      jest.spyOn(RunnerJobService, "findLatestJobForStep").mockResolvedValue(
        makeTerminalJob({
          status,
          output: "ran once",
          errorMessage:
            status === RunnerJobStatus.Succeeded ? undefined : "it went wrong",
        }),
      );
      const enqueueSpy: jest.SpyInstance = jest.spyOn(
        RunnerJobService,
        "enqueue",
      );
      const pollSpy: jest.SpyInstance = jest.spyOn(
        RunnerJobService,
        "pollUntilTerminal",
      );

      const result: StepRunResult = await runBashStep(
        makeBashStep(),
        makeCtx(),
      );

      expect(enqueueSpy).not.toHaveBeenCalled();
      expect(pollSpy).not.toHaveBeenCalled();
      expect(result.output).toBe("ran once");
      expect(result.success).toBe(status === RunnerJobStatus.Succeeded);
    },
  );

  test("the lookup is scoped to this execution and this step", async () => {
    const findSpy: jest.SpyInstance = jest
      .spyOn(RunnerJobService, "findLatestJobForStep")
      .mockResolvedValue(null);
    jest
      .spyOn(RunnerJobService, "enqueue")
      .mockResolvedValue(makeTerminalJob());
    jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockResolvedValue(makeTerminalJob());

    await runBashStep(makeBashStep(), makeCtx());

    const args: Record<string, unknown> = findSpy.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect((args["runbookExecutionId"] as ObjectID).toString()).toBe(
      new ObjectID("exec1").toString(),
    );
    expect(args["stepId"]).toBe(makeBashStep().id);
  });

  test("JavaScript steps re-attach on the same terms as Bash", async () => {
    jest.spyOn(RunnerJobService, "findLatestJobForStep").mockResolvedValue(
      makeTerminalJob({
        _id: "existing-js-job",
        status: RunnerJobStatus.Claimed,
      }),
    );
    const enqueueSpy: jest.SpyInstance = jest.spyOn(
      RunnerJobService,
      "enqueue",
    );
    jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockResolvedValue(makeTerminalJob({ output: "js done" }));

    const result: StepRunResult = await runJavaScriptStep(
      makeJsStep(),
      makeCtx(),
    );

    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(result.output).toBe("js done");
  });
});

describe("per-step timeouts", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "info").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function stubAgentDispatch(): {
    enqueueSpy: jest.SpyInstance;
    pollSpy: jest.SpyInstance;
  } {
    /*
     * Part of the stub rather than a beforeEach: one test below restores all
     * mocks between iterations, so the "no prior job for this step" default
     * has to be re-established alongside enqueue and poll.
     */
    jest
      .spyOn(RunnerJobService, "findLatestJobForStep")
      .mockResolvedValue(null);

    return {
      enqueueSpy: jest
        .spyOn(RunnerJobService, "enqueue")
        .mockResolvedValue(makeTerminalJob()),
      pollSpy: jest
        .spyOn(RunnerJobService, "pollUntilTerminal")
        .mockResolvedValue(makeTerminalJob()),
    };
  }

  function firstCallArgs(spy: jest.SpyInstance): Record<string, unknown> {
    return spy.mock.calls[0]![0] as Record<string, unknown>;
  }

  describe("HTTP steps", () => {
    test("an unset timeout uses the documented 30 second default", async () => {
      const requestSpy: jest.SpyInstance = jest
        .spyOn(axios, "request")
        .mockResolvedValue({
          status: 200,
          statusText: "OK",
          headers: {},
          data: "",
        } as never);

      await runHttpStep(makeHttpStep());

      expect(firstCallArgs(requestSpy)["timeout"]).toBe(
        DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS,
      );
    });

    test("a configured timeout is handed to the HTTP client", async () => {
      const requestSpy: jest.SpyInstance = jest
        .spyOn(axios, "request")
        .mockResolvedValue({
          status: 200,
          statusText: "OK",
          headers: {},
          data: "",
        } as never);

      await runHttpStep(makeHttpStep({ timeoutInMs: 90_000 }));

      expect(firstCallArgs(requestSpy)["timeout"]).toBe(90_000);
    });

    test("a zero timeout falls back to the default instead of waiting forever", async () => {
      const requestSpy: jest.SpyInstance = jest
        .spyOn(axios, "request")
        .mockResolvedValue({
          status: 200,
          statusText: "OK",
          headers: {},
          data: "",
        } as never);

      await runHttpStep(makeHttpStep({ timeoutInMs: 0 }));

      expect(firstCallArgs(requestSpy)["timeout"]).toBe(
        DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS,
      );
    });

    test("an absurd timeout is capped at the maximum", async () => {
      const requestSpy: jest.SpyInstance = jest
        .spyOn(axios, "request")
        .mockResolvedValue({
          status: 200,
          statusText: "OK",
          headers: {},
          data: "",
        } as never);

      await runHttpStep(makeHttpStep({ timeoutInMs: Number.MAX_SAFE_INTEGER }));

      expect(firstCallArgs(requestSpy)["timeout"]).toBe(
        MAX_STEP_EXECUTION_TIMEOUT_IN_MS,
      );
    });

    test("a sub-second timeout is raised to the minimum", async () => {
      const requestSpy: jest.SpyInstance = jest
        .spyOn(axios, "request")
        .mockResolvedValue({
          status: 200,
          statusText: "OK",
          headers: {},
          data: "",
        } as never);

      await runHttpStep(makeHttpStep({ timeoutInMs: 5 }));

      expect(firstCallArgs(requestSpy)["timeout"]).toBe(
        MIN_STEP_EXECUTION_TIMEOUT_IN_MS,
      );
    });
  });

  describe("Bash steps", () => {
    test("unset timeouts dispatch with the documented defaults", async () => {
      const { enqueueSpy, pollSpy } = stubAgentDispatch();

      await runBashStep(makeBashStep(), makeCtx());

      expect(firstCallArgs(enqueueSpy)["timeoutInMs"]).toBe(
        DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS,
      );
      expect(firstCallArgs(enqueueSpy)["claimTimeoutInMs"]).toBe(
        DEFAULT_AGENT_CLAIM_TIMEOUT_IN_MS,
      );
      expect(firstCallArgs(pollSpy)["executionTimeoutInMs"]).toBe(
        DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS,
      );
      expect(firstCallArgs(pollSpy)["claimTimeoutInMs"]).toBe(
        DEFAULT_AGENT_CLAIM_TIMEOUT_IN_MS,
      );
    });

    test("configured timeouts reach both the enqueued job and the poll window", async () => {
      const { enqueueSpy, pollSpy } = stubAgentDispatch();

      await runBashStep(
        makeBashStep({ timeoutInMs: 600_000, claimTimeoutInMs: 900_000 }),
        makeCtx(),
      );

      /*
       * The job row carries the execution timeout to the agent; the poll
       * window has to cover both. If these ever diverge, a long step would be
       * abandoned by the Worker while the agent was still running it.
       */
      expect(firstCallArgs(enqueueSpy)["timeoutInMs"]).toBe(600_000);
      expect(firstCallArgs(enqueueSpy)["claimTimeoutInMs"]).toBe(900_000);
      expect(firstCallArgs(pollSpy)["executionTimeoutInMs"]).toBe(600_000);
      expect(firstCallArgs(pollSpy)["claimTimeoutInMs"]).toBe(900_000);
    });

    test("a long-running step keeps a timeout well past the default", async () => {
      /*
       * The reason this feature exists: a database restore or a log sweep
       * takes longer than 30 seconds and must not be killed at 30 seconds.
       */
      const { enqueueSpy } = stubAgentDispatch();

      await runBashStep(makeBashStep({ timeoutInMs: 45 * 60_000 }), makeCtx());

      expect(firstCallArgs(enqueueSpy)["timeoutInMs"]).toBe(2_700_000);
    });

    test("an out-of-range execution timeout is clamped, not passed through", async () => {
      const { enqueueSpy, pollSpy } = stubAgentDispatch();

      await runBashStep(
        makeBashStep({ timeoutInMs: 24 * 60 * 60_000 }),
        makeCtx(),
      );

      expect(firstCallArgs(enqueueSpy)["timeoutInMs"]).toBe(
        MAX_STEP_EXECUTION_TIMEOUT_IN_MS,
      );
      /*
       * The poll window has to be clamped too. If only the job row were, the
       * agent would give up at the cap while the Worker kept waiting out the
       * unclamped value — holding a Runbook queue slot for a day, which is the
       * exact harm the clamp exists to prevent.
       */
      expect(firstCallArgs(pollSpy)["executionTimeoutInMs"]).toBe(
        MAX_STEP_EXECUTION_TIMEOUT_IN_MS,
      );
    });

    test("an out-of-range claim timeout is clamped, not passed through", async () => {
      const { enqueueSpy, pollSpy } = stubAgentDispatch();

      await runBashStep(makeBashStep({ claimTimeoutInMs: 1 }), makeCtx());

      expect(firstCallArgs(enqueueSpy)["claimTimeoutInMs"]).toBe(
        MIN_AGENT_CLAIM_TIMEOUT_IN_MS,
      );
      expect(firstCallArgs(pollSpy)["claimTimeoutInMs"]).toBe(
        MIN_AGENT_CLAIM_TIMEOUT_IN_MS,
      );
    });

    test("a negative timeout falls back to the default rather than disabling the timeout", async () => {
      const { enqueueSpy, pollSpy } = stubAgentDispatch();

      await runBashStep(
        makeBashStep({ timeoutInMs: -1, claimTimeoutInMs: -1 }),
        makeCtx(),
      );

      expect(firstCallArgs(enqueueSpy)["timeoutInMs"]).toBe(
        DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS,
      );
      expect(firstCallArgs(enqueueSpy)["claimTimeoutInMs"]).toBe(
        DEFAULT_AGENT_CLAIM_TIMEOUT_IN_MS,
      );
      expect(firstCallArgs(pollSpy)["executionTimeoutInMs"]).toBe(
        DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS,
      );
      expect(firstCallArgs(pollSpy)["claimTimeoutInMs"]).toBe(
        DEFAULT_AGENT_CLAIM_TIMEOUT_IN_MS,
      );
    });

    test("a timeout stored as a string still resolves — step configs are untyped JSON at rest", async () => {
      const { enqueueSpy, pollSpy } = stubAgentDispatch();

      await runBashStep(
        makeBashStep({ timeoutInMs: "120000" as unknown as number }),
        makeCtx(),
      );

      expect(firstCallArgs(enqueueSpy)["timeoutInMs"]).toBe(120_000);
      expect(firstCallArgs(pollSpy)["executionTimeoutInMs"]).toBe(120_000);
    });

    test("the job row and the poll window always agree, whatever the input", async () => {
      /*
       * Stated as an invariant over the whole input space rather than one case
       * at a time: the Worker must never wait on a different number than the
       * one the agent was told to honour.
       */
      const inputs: Array<Partial<Record<string, unknown>>> = [
        {},
        { timeoutInMs: 5_000, claimTimeoutInMs: 9_000 },
        { timeoutInMs: 0, claimTimeoutInMs: 0 },
        { timeoutInMs: -1, claimTimeoutInMs: -1 },
        { timeoutInMs: 1, claimTimeoutInMs: 1 },
        { timeoutInMs: 24 * 60 * 60_000, claimTimeoutInMs: 24 * 60 * 60_000 },
        { timeoutInMs: "600000", claimTimeoutInMs: "600000" },
        { timeoutInMs: NaN, claimTimeoutInMs: NaN },
      ];

      for (const input of inputs) {
        jest.restoreAllMocks();
        jest.spyOn(logger, "error").mockImplementation((): void => {
          return undefined;
        });
        const { enqueueSpy, pollSpy } = stubAgentDispatch();

        await runBashStep(
          makeBashStep(input as Partial<BashStepConfig>),
          makeCtx(),
        );

        const enqueued: Record<string, unknown> = firstCallArgs(enqueueSpy);
        const polled: Record<string, unknown> = firstCallArgs(pollSpy);

        expect(polled["executionTimeoutInMs"]).toBe(enqueued["timeoutInMs"]);
        expect(polled["claimTimeoutInMs"]).toBe(enqueued["claimTimeoutInMs"]);
        // And both are always inside the documented bounds.
        expect(enqueued["timeoutInMs"]).toBeGreaterThanOrEqual(
          MIN_STEP_EXECUTION_TIMEOUT_IN_MS,
        );
        expect(enqueued["timeoutInMs"]).toBeLessThanOrEqual(
          MAX_STEP_EXECUTION_TIMEOUT_IN_MS,
        );
        expect(enqueued["claimTimeoutInMs"]).toBeGreaterThanOrEqual(
          MIN_AGENT_CLAIM_TIMEOUT_IN_MS,
        );
        expect(enqueued["claimTimeoutInMs"]).toBeLessThanOrEqual(
          MAX_AGENT_CLAIM_TIMEOUT_IN_MS,
        );
      }
    });

    test("the two timeouts stay independent of one another", async () => {
      const { enqueueSpy } = stubAgentDispatch();

      await runBashStep(
        makeBashStep({ timeoutInMs: 5_000, claimTimeoutInMs: 600_000 }),
        makeCtx(),
      );

      expect(firstCallArgs(enqueueSpy)["timeoutInMs"]).toBe(5_000);
      expect(firstCallArgs(enqueueSpy)["claimTimeoutInMs"]).toBe(600_000);
    });
  });

  describe("JavaScript steps", () => {
    test("unset timeouts dispatch with the documented defaults", async () => {
      const { enqueueSpy } = stubAgentDispatch();

      await runJavaScriptStep(makeJsStep(), makeCtx());

      expect(firstCallArgs(enqueueSpy)["timeoutInMs"]).toBe(
        DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS,
      );
      expect(firstCallArgs(enqueueSpy)["claimTimeoutInMs"]).toBe(
        DEFAULT_AGENT_CLAIM_TIMEOUT_IN_MS,
      );
    });

    test("configured timeouts reach the enqueued job", async () => {
      const { enqueueSpy, pollSpy } = stubAgentDispatch();

      await runJavaScriptStep(
        makeJsStep({ timeoutInMs: 180_000, claimTimeoutInMs: 300_000 }),
        makeCtx(),
      );

      expect(firstCallArgs(enqueueSpy)["timeoutInMs"]).toBe(180_000);
      expect(firstCallArgs(enqueueSpy)["claimTimeoutInMs"]).toBe(300_000);
      expect(firstCallArgs(pollSpy)["executionTimeoutInMs"]).toBe(180_000);
      expect(firstCallArgs(pollSpy)["claimTimeoutInMs"]).toBe(300_000);
    });

    test("out-of-range timeouts are clamped on both axes", async () => {
      const { enqueueSpy, pollSpy } = stubAgentDispatch();

      await runJavaScriptStep(
        makeJsStep({
          timeoutInMs: Number.MAX_SAFE_INTEGER,
          claimTimeoutInMs: Number.MAX_SAFE_INTEGER,
        }),
        makeCtx(),
      );

      expect(firstCallArgs(enqueueSpy)["timeoutInMs"]).toBe(
        MAX_STEP_EXECUTION_TIMEOUT_IN_MS,
      );
      expect(firstCallArgs(enqueueSpy)["claimTimeoutInMs"]).toBe(
        MAX_AGENT_CLAIM_TIMEOUT_IN_MS,
      );
      expect(firstCallArgs(pollSpy)["executionTimeoutInMs"]).toBe(
        MAX_STEP_EXECUTION_TIMEOUT_IN_MS,
      );
      expect(firstCallArgs(pollSpy)["claimTimeoutInMs"]).toBe(
        MAX_AGENT_CLAIM_TIMEOUT_IN_MS,
      );
    });
  });
});
