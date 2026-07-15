import axios from "axios";
import ObjectID from "Common/Types/ObjectID";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import RunbookAgentJobStatus from "Common/Types/Runbook/RunbookAgentJobStatus";
import RunbookAgentJobService from "Common/Server/Services/RunbookAgentJobService";
import RunbookAgentJob from "Common/Models/DatabaseModels/RunbookAgentJob";
import logger from "Common/Server/Utils/Logger";
import {
  BashStepConfig,
  HttpRequestStepConfig,
  JavaScriptStepConfig,
  RunbookStep,
} from "Common/Types/Runbook/RunbookStep";
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
): RunbookAgentJob {
  return {
    _id: "job1",
    status: RunbookAgentJobStatus.Succeeded,
    output: "job output",
    ...overrides,
  } as unknown as RunbookAgentJob;
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
      .spyOn(RunbookAgentJobService, "enqueue")
      .mockResolvedValue(makeTerminalJob());
    jest
      .spyOn(RunbookAgentJobService, "pollUntilTerminal")
      .mockResolvedValue(makeTerminalJob());

    const agentId: string = new ObjectID("agent-xyz").toString();
    await runBashStep(makeBashStep({ agentId: ` ${agentId} ` }), makeCtx());

    const enqueueArgs: Record<string, unknown> = enqueueSpy.mock
      .calls[0]![0] as Record<string, unknown>;
    expect((enqueueArgs["targetAgentId"] as ObjectID).toString()).toBe(agentId);
  });

  test("an empty script succeeds without dispatching a job", async () => {
    const enqueueSpy: jest.SpyInstance = jest.spyOn(
      RunbookAgentJobService,
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
      .spyOn(RunbookAgentJobService, "enqueue")
      .mockResolvedValue(makeTerminalJob({ _id: "job-42" }));
    const pollSpy: jest.SpyInstance = jest
      .spyOn(RunbookAgentJobService, "pollUntilTerminal")
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
      .spyOn(RunbookAgentJobService, "enqueue")
      .mockResolvedValue(makeTerminalJob());
    jest
      .spyOn(RunbookAgentJobService, "pollUntilTerminal")
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
      .spyOn(RunbookAgentJobService, "enqueue")
      .mockResolvedValue(makeTerminalJob());
    jest
      .spyOn(RunbookAgentJobService, "pollUntilTerminal")
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
      .spyOn(RunbookAgentJobService, "enqueue")
      .mockResolvedValue(makeTerminalJob());
    jest.spyOn(RunbookAgentJobService, "pollUntilTerminal").mockResolvedValue(
      makeTerminalJob({
        status: RunbookAgentJobStatus.Failed,
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
      .spyOn(RunbookAgentJobService, "enqueue")
      .mockResolvedValue(makeTerminalJob());
    jest.spyOn(RunbookAgentJobService, "pollUntilTerminal").mockResolvedValue(
      makeTerminalJob({
        status: RunbookAgentJobStatus.Failed,
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
      .spyOn(RunbookAgentJobService, "enqueue")
      .mockResolvedValue(makeTerminalJob());
    jest.spyOn(RunbookAgentJobService, "pollUntilTerminal").mockResolvedValue(
      makeTerminalJob({
        status: RunbookAgentJobStatus.TimedOut,
        output: "",
        errorMessage: undefined,
        exitCode: undefined,
      }),
    );

    const result: StepRunResult = await runBashStep(makeBashStep(), makeCtx());

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain(RunbookAgentJobStatus.TimedOut);
  });

  test("an enqueue failure fails the step with the thrown message", async () => {
    jest
      .spyOn(RunbookAgentJobService, "enqueue")
      .mockRejectedValue(new Error("queue unavailable"));

    const result: StepRunResult = await runBashStep(makeBashStep(), makeCtx());

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("queue unavailable");
  });
});
