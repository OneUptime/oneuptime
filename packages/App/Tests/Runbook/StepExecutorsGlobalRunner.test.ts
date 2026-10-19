import ObjectID from "Common/Types/ObjectID";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import RunnerJobStatus from "Common/Types/Runbook/RunnerJobStatus";
import RunnerJobService from "Common/Server/Services/RunnerJobService";
import RunnerService from "Common/Server/Services/RunnerService";
import ProjectService from "Common/Server/Services/ProjectService";
import RunnerJob from "Common/Models/DatabaseModels/RunnerJob";
import Runner from "Common/Models/DatabaseModels/Runner";
import Project from "Common/Models/DatabaseModels/Project";
import logger from "Common/Server/Utils/Logger";
import {
  BashStepConfig,
  JavaScriptStepConfig,
  RunbookStep,
} from "Common/Types/Runbook/RunbookStep";
import { GLOBAL_RUNNER_MAX_EXECUTION_TIMEOUT_IN_MS } from "Common/Types/Runner/GlobalRunnerWork";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  StepExecutionContext,
  StepRunResult,
  runBashStep,
  runJavaScriptStep,
} from "../../FeatureSet/Runbook/Services/StepExecutors";

/*
 * ---------------------------------------------------------------------------
 * Contract under test - the Worker sends a step to the global Runners by the
 * one "global by default" rule (GlobalRunnerChoice, run for real here, with
 * the facts it reads stubbed):
 *
 *   - a JavaScript step that picked no Runner, in a project that uses global
 *     Runners, on a server that has one, is queued for ANY global Runner
 *     (runsOnGlobalRunner, no target) with its execution timeout held to the
 *     global most - and the Worker waits on that same window;
 *   - a custom pick always wins: the job targets that Runner alone;
 *   - a project that turned global Runners off, a server with none, a Bash
 *     step with none, a deleted Runner: the step fails at once in plain
 *     words, and nothing is queued;
 *   - a decision that cannot be read fails the step rather than guessing;
 *   - a step that already has a job (the Worker restarted mid-step) adopts
 *     or waits on that job whatever the rule would say now, and is never
 *     sent a second time.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "a1000000-0000-4000-8000-000000000001",
);
const OWN_RUNNER_ID: string = "a1000000-0000-4000-8000-0000000000a1";
const GLOBAL_RUNNER_ID: string = "a1000000-0000-4000-8000-0000000000b1";
const DELETED_RUNNER_ID: string = "a1000000-0000-4000-8000-0000000000c1";

let usesGlobalRunners: boolean;
let hasGlobalRunner: boolean;
let projectReadFails: boolean;

let enqueueSpy: jest.SpyInstance;
let pollSpy: jest.SpyInstance;
let findLatestSpy: jest.SpyInstance;
let projectReadSpy: jest.SpyInstance;

function makeCtx(): StepExecutionContext {
  return {
    projectId: PROJECT_ID,
    runbookExecutionId: new ObjectID("a1000000-0000-4000-8000-0000000000e1"),
  };
}

function jsStep(config: Partial<JavaScriptStepConfig> = {}): RunbookStep {
  return {
    id: "js-step",
    order: 0,
    type: RunbookStepType.JavaScript,
    title: "Call the status API",
    config: {
      script: "return 'ok';",
      agentId: "",
      ...config,
    } as JavaScriptStepConfig,
  };
}

function bashStep(config: Partial<BashStepConfig> = {}): RunbookStep {
  return {
    id: "bash-step",
    order: 0,
    type: RunbookStepType.Bash,
    title: "Restart",
    config: {
      script: "systemctl restart web",
      agentId: "",
      ...config,
    } as BashStepConfig,
  };
}

function terminal(): RunnerJob {
  return {
    _id: "a1000000-0000-4000-8000-0000000000f1",
    status: RunnerJobStatus.Succeeded,
    output: "ok",
  } as unknown as RunnerJob;
}

function enqueued(): Record<string, unknown> {
  expect(enqueueSpy).toHaveBeenCalledTimes(1);
  return enqueueSpy.mock.calls[0]![0] as Record<string, unknown>;
}

function polled(): Record<string, unknown> {
  expect(pollSpy).toHaveBeenCalledTimes(1);
  return pollSpy.mock.calls[0]![0] as Record<string, unknown>;
}

beforeEach(() => {
  usesGlobalRunners = true;
  hasGlobalRunner = true;
  projectReadFails = false;

  for (const level of ["error", "info"] as const) {
    jest.spyOn(logger, level).mockImplementation((): void => {
      return undefined;
    });
  }

  jest
    .spyOn(RunnerService, "findOneById")
    .mockImplementation(
      async (args: { id: ObjectID }): Promise<Runner | null> => {
        const id: string = args.id.toString();

        if (id === OWN_RUNNER_ID || id === GLOBAL_RUNNER_ID) {
          const runner: Runner = new Runner();
          runner._id = id;
          if (id === OWN_RUNNER_ID) {
            runner.projectId = PROJECT_ID;
          }
          runner.isGlobalRunner = id === GLOBAL_RUNNER_ID;
          return runner;
        }

        return null;
      },
    );

  projectReadSpy = jest
    .spyOn(ProjectService, "findOneById")
    .mockImplementation(async (): Promise<Project> => {
      if (projectReadFails) {
        throw new Error("The database could not be reached.");
      }

      const project: Project = new Project();
      project.useGlobalRunners = usesGlobalRunners;
      return project;
    });

  jest
    .spyOn(RunnerService, "hasGlobalRunnerForRunbooks")
    .mockImplementation(async (): Promise<boolean> => {
      return hasGlobalRunner;
    });

  findLatestSpy = jest
    .spyOn(RunnerJobService, "findLatestJobForStep")
    .mockResolvedValue(null);
  enqueueSpy = jest
    .spyOn(RunnerJobService, "enqueue")
    .mockResolvedValue(terminal());
  pollSpy = jest
    .spyOn(RunnerJobService, "pollUntilTerminal")
    .mockResolvedValue(terminal());
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a JavaScript step that picked no Runner", () => {
  test("is queued for any global Runner, aimed at none", async () => {
    const result: StepRunResult = await runJavaScriptStep(jsStep(), makeCtx());

    expect(result).toEqual({ success: true, output: "ok" });
    expect(enqueued()["runsOnGlobalRunner"]).toBe(true);
    expect(enqueued()).not.toHaveProperty("targetAgentId");
    expect((enqueued()["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(enqueued()["stepType"]).toBe(RunbookStepType.JavaScript);
  });

  test("runs for five minutes at most there, and the Worker waits on that same window", async () => {
    await runJavaScriptStep(jsStep({ timeoutInMs: 60 * 60 * 1000 }), makeCtx());

    expect(enqueued()["timeoutInMs"]).toBe(
      GLOBAL_RUNNER_MAX_EXECUTION_TIMEOUT_IN_MS,
    );
    expect(polled()["executionTimeoutInMs"]).toBe(
      GLOBAL_RUNNER_MAX_EXECUTION_TIMEOUT_IN_MS,
    );
  });

  test("keeps a shorter timeout, and its claim timeout, as the step set them", async () => {
    await runJavaScriptStep(
      jsStep({ timeoutInMs: 20_000, claimTimeoutInMs: 90_000 }),
      makeCtx(),
    );

    expect(enqueued()["timeoutInMs"]).toBe(20_000);
    expect(enqueued()["claimTimeoutInMs"]).toBe(90_000);
    expect(polled()["executionTimeoutInMs"]).toBe(20_000);
    expect(polled()["claimTimeoutInMs"]).toBe(90_000);
  });

  test("fails at once, queuing nothing, when the project turned global Runners off", async () => {
    usesGlobalRunners = false;

    const result: StepRunResult = await runJavaScriptStep(jsStep(), makeCtx());

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe(
      "This JavaScript step has no Runner of its own, and this project does not use global Runners. Pick one of your Runners for the step, or turn global Runners on under Runbooks → Runners.",
    );
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  test("fails at once, queuing nothing, when there is no global Runner", async () => {
    hasGlobalRunner = false;

    const result: StepRunResult = await runJavaScriptStep(jsStep(), makeCtx());

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain(
      "there is no global Runner to run it",
    );
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  test("fails, queuing nothing, when what decides it cannot be read", async () => {
    projectReadFails = true;

    const result: StepRunResult = await runJavaScriptStep(jsStep(), makeCtx());

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe("The database could not be reached.");
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  test("with nothing to run succeeds without queuing a job", async () => {
    const result: StepRunResult = await runJavaScriptStep(
      jsStep({ script: "" }),
      makeCtx(),
    );

    expect(result).toEqual({ success: true, output: "" });
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  test("re-attaches to the global job it already queued after a Worker restart, never queuing a second", async () => {
    const existing: RunnerJob = {
      _id: "a1000000-0000-4000-8000-0000000000d1",
      status: RunnerJobStatus.Claimed,
      createdAt: new Date(Date.now() - 30_000),
    } as unknown as RunnerJob;
    findLatestSpy.mockResolvedValue(existing);

    await runJavaScriptStep(jsStep(), makeCtx());

    expect(enqueueSpy).not.toHaveBeenCalled();
    expect((polled()["jobId"] as ObjectID).toString()).toBe(
      "a1000000-0000-4000-8000-0000000000d1",
    );
    // The global window, from the job's own start.
    expect(polled()["executionTimeoutInMs"]).toBe(30_000);
    expect(polled()["waitStartedAt"]).toEqual(existing.createdAt);
  });

  test("re-attaching to a global job keeps the global window, never the longer one the step asks for", async () => {
    findLatestSpy.mockResolvedValue({
      _id: "a1000000-0000-4000-8000-0000000000d2",
      status: RunnerJobStatus.Running,
      runsOnGlobalRunner: true,
      createdAt: new Date(Date.now() - 10_000),
    } as unknown as RunnerJob);

    await runJavaScriptStep(jsStep({ timeoutInMs: 60 * 60 * 1000 }), makeCtx());

    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(polled()["executionTimeoutInMs"]).toBe(
      GLOBAL_RUNNER_MAX_EXECUTION_TIMEOUT_IN_MS,
    );
  });

  test("re-attaching to a job of the project's own Runner keeps the step's own window", async () => {
    findLatestSpy.mockResolvedValue({
      _id: "a1000000-0000-4000-8000-0000000000d3",
      status: RunnerJobStatus.Running,
      runsOnGlobalRunner: false,
      createdAt: new Date(Date.now() - 10_000),
    } as unknown as RunnerJob);

    await runJavaScriptStep(
      jsStep({ agentId: OWN_RUNNER_ID, timeoutInMs: 60 * 60 * 1000 }),
      makeCtx(),
    );

    expect(polled()["executionTimeoutInMs"]).toBe(60 * 60 * 1000);
  });

  test("a global job that finished keeps its result after the project turned global Runners off", async () => {
    usesGlobalRunners = false;
    findLatestSpy.mockResolvedValue({
      _id: "a1000000-0000-4000-8000-0000000000d4",
      status: RunnerJobStatus.Succeeded,
      runsOnGlobalRunner: true,
      output: "done before the switch moved",
    } as unknown as RunnerJob);

    const result: StepRunResult = await runJavaScriptStep(jsStep(), makeCtx());

    expect(result).toEqual({
      success: true,
      output: "done before the switch moved",
    });
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(pollSpy).not.toHaveBeenCalled();
    // The rule decides a new dispatch only: it is never asked here.
    expect(projectReadSpy).not.toHaveBeenCalled();
  });

  test("a global job still running is waited on after the project turned global Runners off, not failed under it", async () => {
    usesGlobalRunners = false;
    hasGlobalRunner = false;
    findLatestSpy.mockResolvedValue({
      _id: "a1000000-0000-4000-8000-0000000000d5",
      status: RunnerJobStatus.Running,
      runsOnGlobalRunner: true,
      createdAt: new Date(Date.now() - 5_000),
    } as unknown as RunnerJob);

    const result: StepRunResult = await runJavaScriptStep(jsStep(), makeCtx());

    expect(result).toEqual({ success: true, output: "ok" });
    expect((polled()["jobId"] as ObjectID).toString()).toBe(
      "a1000000-0000-4000-8000-0000000000d5",
    );
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(projectReadSpy).not.toHaveBeenCalled();
  });

  test("a step with nothing to run never looks for a job, and still says when it cannot run anywhere", async () => {
    hasGlobalRunner = false;

    const result: StepRunResult = await runJavaScriptStep(
      jsStep({ script: "" }),
      makeCtx(),
    );

    expect(findLatestSpy).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain(
      "there is no global Runner to run it",
    );
  });

  test("a job lookup that fails fails the step, queuing nothing", async () => {
    findLatestSpy.mockRejectedValue(new Error("The job table is locked."));

    const result: StepRunResult = await runJavaScriptStep(jsStep(), makeCtx());

    expect(result).toEqual({
      success: false,
      output: "",
      errorMessage: "The job table is locked.",
    });
    expect(enqueueSpy).not.toHaveBeenCalled();
  });
});

describe("a step that picked a Runner", () => {
  test("a custom pick wins: the job targets that Runner alone, for as long as the step says", async () => {
    await runJavaScriptStep(
      jsStep({ agentId: OWN_RUNNER_ID, timeoutInMs: 60 * 60 * 1000 }),
      makeCtx(),
    );

    expect((enqueued()["targetAgentId"] as ObjectID).toString()).toBe(
      OWN_RUNNER_ID,
    );
    expect(enqueued()).not.toHaveProperty("runsOnGlobalRunner");
    expect(enqueued()["timeoutInMs"]).toBe(60 * 60 * 1000);
    // The project's switch and the global Runners do not decide a custom pick.
    expect(projectReadSpy).not.toHaveBeenCalled();
  });

  test("a custom pick wins even when the project turned global Runners off", async () => {
    usesGlobalRunners = false;
    hasGlobalRunner = false;

    await runBashStep(bashStep({ agentId: OWN_RUNNER_ID }), makeCtx());

    expect((enqueued()["targetAgentId"] as ObjectID).toString()).toBe(
      OWN_RUNNER_ID,
    );
  });

  test("naming a global Runner is the global Runners: the job waits for any of them", async () => {
    await runJavaScriptStep(jsStep({ agentId: GLOBAL_RUNNER_ID }), makeCtx());

    expect(enqueued()["runsOnGlobalRunner"]).toBe(true);
    expect(enqueued()).not.toHaveProperty("targetAgentId");
  });

  test("a deleted Runner fails the step at once instead of waiting out the claim timeout", async () => {
    const result: StepRunResult = await runJavaScriptStep(
      jsStep({ agentId: DELETED_RUNNER_ID }),
      makeCtx(),
    );

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe(
      "This JavaScript step picked a Runner that is not one of this project's Runners any more. It may have been deleted. Open the step and pick another Runner.",
    );
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(pollSpy).not.toHaveBeenCalled();
  });
});

describe("a Bash step that picked no Runner", () => {
  test("never goes to a global Runner, even when there is one: it fails, saying it needs one of the project's own", async () => {
    const result: StepRunResult = await runBashStep(bashStep(), makeCtx());

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain(
      "Bash steps run on a Runner of your own, inside your network: global Runners run JavaScript steps only.",
    );
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(projectReadSpy).not.toHaveBeenCalled();
  });
});
