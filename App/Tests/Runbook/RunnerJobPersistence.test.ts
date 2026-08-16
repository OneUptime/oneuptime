import ObjectID from "Common/Types/ObjectID";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "Common/Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "Common/Types/Runbook/RunnerJobStatus";
import RunnerJobService from "Common/Server/Services/RunnerJobService";
import RunnerJob from "Common/Models/DatabaseModels/RunnerJob";
import logger from "Common/Server/Utils/Logger";
import PositiveNumber from "Common/Types/PositiveNumber";
import {
  KubernetesAction,
  KubernetesWorkloadKind,
  RunbookStep,
} from "Common/Types/Runbook/RunbookStep";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import {
  runBashStep,
  runJavaScriptStep,
  runKubernetesStep,
  runSshStep,
  StepExecutionContext,
  StepRunResult,
} from "../../FeatureSet/Runbook/Services/StepExecutors";

/*
 * ---------------------------------------------------------------------------
 * Regression suite for #3209 — "SSH Runbook step fails with 'script is
 * required'".
 *
 * Every other runbook test stubs RunnerJobService.enqueue, which is exactly
 * why this shipped: the step executors were correct, the payload was correct,
 * and thirty green tests said SSH worked. What none of them touched was the
 * one thing between the dispatcher and the database — the model's own
 * required-column validation. RunnerJob.script was declared `required: true`,
 * DatabaseService.checkRequiredFields rejects any falsy value, and an SSH job
 * carries an empty script by design. So every SSH and Kubernetes step failed
 * at create() with "script is required", before a Runner ever saw the job.
 *
 * These tests therefore stub one layer LOWER — at `create`, the last call
 * before Postgres — and run the real enqueue and the real validator on the row
 * that comes out. A step type whose job row cannot be persisted is a step type
 * that does not work, however well its payload is assembled.
 * ---------------------------------------------------------------------------
 */

const AGENT_ID: string = ObjectID.generate().toString();
const CREDENTIAL_ID: string = ObjectID.generate().toString();
const CREATED_JOB_ID: string = ObjectID.generate().toString();

function makeCtx(): StepExecutionContext {
  return {
    projectId: new ObjectID("proj1"),
    runbookExecutionId: new ObjectID("exec1"),
  };
}

function makeStep(
  type: RunbookStepType,
  config: Record<string, unknown>,
): RunbookStep {
  return {
    id: `${type}-step-1`,
    order: 0,
    type,
    title: `${type} step`,
    config: config as unknown as RunbookStep["config"],
  };
}

function sshStep(overrides: Record<string, unknown> = {}): RunbookStep {
  return makeStep(RunbookStepType.SSH, {
    credentialId: CREDENTIAL_ID,
    command: "systemctl restart nginx",
    agentId: AGENT_ID,
    ...overrides,
  });
}

function kubernetesStep(overrides: Record<string, unknown> = {}): RunbookStep {
  return makeStep(RunbookStepType.Kubernetes, {
    credentialId: CREDENTIAL_ID,
    action: KubernetesAction.RestartWorkload,
    workloadKind: KubernetesWorkloadKind.Deployment,
    namespace: "production",
    workloadName: "api",
    agentId: AGENT_ID,
    ...overrides,
  });
}

function bashStep(overrides: Record<string, unknown> = {}): RunbookStep {
  return makeStep(RunbookStepType.Bash, {
    script: "uptime",
    agentId: AGENT_ID,
    ...overrides,
  });
}

function javaScriptStep(overrides: Record<string, unknown> = {}): RunbookStep {
  return makeStep(RunbookStepType.JavaScript, {
    script: "return 1 + 1;",
    agentId: AGENT_ID,
    ...overrides,
  });
}

/*
 * The production validator, not a re-implementation of it. Bound off the live
 * service so that flipping `required` back on RunnerJob.script — the exact
 * change that caused #3209 — fails these tests rather than silently passing
 * them.
 *
 * create() runs generateDefaultValues immediately before checkRequiredFields
 * (a column carrying a default is exempt from the check), so the simulation
 * runs both, in that order.
 */
type CreatePathInternals = {
  generateDefaultValues: (model: RunnerJob) => RunnerJob;
  checkRequiredFields: (model: RunnerJob) => RunnerJob;
};

function runRealCreateValidation(row: RunnerJob): RunnerJob {
  const internals: CreatePathInternals =
    RunnerJobService as unknown as CreatePathInternals;

  return internals.checkRequiredFields.call(
    RunnerJobService,
    internals.generateDefaultValues.call(RunnerJobService, row),
  );
}

interface Harness {
  createSpy: jest.SpyInstance;
  pollSpy: jest.SpyInstance;
  findSpy: jest.SpyInstance;
}

/*
 * Stub the database boundary only. `enqueue` — including its step-type
 * invariants and the row it builds — is the real implementation, and `create`
 * runs the real required-field validation on what it is handed before
 * answering the way Postgres would.
 */
function stubDatabase(): Harness {
  const createSpy: jest.SpyInstance = jest
    .spyOn(RunnerJobService, "create")
    .mockImplementation((args: { data: RunnerJob }): Promise<RunnerJob> => {
      const validated: RunnerJob = runRealCreateValidation(args.data);
      validated._id = CREATED_JOB_ID;
      return Promise.resolve(validated);
    });

  const pollSpy: jest.SpyInstance = jest
    .spyOn(RunnerJobService, "pollUntilTerminal")
    .mockResolvedValue({
      _id: CREATED_JOB_ID,
      status: RunnerJobStatus.Succeeded,
      output: "ok",
    } as unknown as RunnerJob);

  const findSpy: jest.SpyInstance = jest
    .spyOn(RunnerJobService, "findLatestJobForStep")
    .mockResolvedValue(null);

  return { createSpy, pollSpy, findSpy };
}

function persistedRow(createSpy: jest.SpyInstance): RunnerJob {
  expect(createSpy).toHaveBeenCalledTimes(1);
  return (createSpy.mock.calls[0]![0] as { data: RunnerJob }).data;
}

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

describe("#3209 — a dispatched step's job row can actually be persisted", () => {
  test("an SSH step reaches the Runner instead of failing with 'script is required'", async () => {
    const { createSpy, pollSpy }: Harness = stubDatabase();

    const result: StepRunResult = await runSshStep(sshStep(), makeCtx());

    /*
     * The reported symptom, asserted directly: the step must not fail, and
     * must not fail with THAT message. dispatchToAgent swallows a create()
     * throw into a failed step result, so without the fix this reads
     * success=false / "script is required" rather than raising.
     */
    expect(result.errorMessage).toBeUndefined();
    expect(result.success).toBe(true);
    expect(createSpy).toHaveBeenCalledTimes(1);
    // The job was not merely created — it was waited on, so the step really ran.
    expect(pollSpy).toHaveBeenCalledTimes(1);
  });

  test("a Kubernetes step, which has the same empty-script shape, is persisted too", async () => {
    const { createSpy }: Harness = stubDatabase();

    const result: StepRunResult = await runKubernetesStep(
      kubernetesStep(),
      makeCtx(),
    );

    expect(result.errorMessage).toBeUndefined();
    expect(result.success).toBe(true);
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["SSH", runSshStep, sshStep],
    ["Kubernetes", runKubernetesStep, kubernetesStep],
  ])(
    "the persisted %s row passes the model's real required-field validation",
    async (
      _label: string,
      run: (
        step: RunbookStep,
        ctx: StepExecutionContext,
      ) => Promise<StepRunResult>,
      makeStepFn: () => RunbookStep,
    ) => {
      const { createSpy }: Harness = stubDatabase();

      await run(makeStepFn(), makeCtx());

      const row: RunnerJob = persistedRow(createSpy);

      expect(() => {
        return runRealCreateValidation(row);
      }).not.toThrow();
    },
  );

  test.each([
    ["Bash", runBashStep, bashStep],
    ["JavaScript", runJavaScriptStep, javaScriptStep],
  ])(
    "the script-carrying %s step still persists and still passes validation",
    async (
      _label: string,
      run: (
        step: RunbookStep,
        ctx: StepExecutionContext,
      ) => Promise<StepRunResult>,
      makeStepFn: () => RunbookStep,
    ) => {
      const { createSpy }: Harness = stubDatabase();

      const result: StepRunResult = await run(makeStepFn(), makeCtx());

      expect(result.success).toBe(true);

      const row: RunnerJob = persistedRow(createSpy);
      expect(row.script).toBeTruthy();
      expect(row.payload).toBeUndefined();
      expect(() => {
        return runRealCreateValidation(row);
      }).not.toThrow();
    },
  );

  test("an SSH job row is stored with an empty script string, never null or undefined", async () => {
    /*
     * The column is NOT NULL in Postgres. `required: false` only relaxes the
     * application-level check — writing undefined would still be rejected by
     * the database, one layer further down and with a far worse message.
     */
    const { createSpy }: Harness = stubDatabase();

    await runSshStep(sshStep(), makeCtx());

    const row: RunnerJob = persistedRow(createSpy);

    expect(row.script).toBe("");
    expect(row.script).not.toBeNull();
    expect(row.script).not.toBeUndefined();
    expect(typeof row.script).toBe("string");
  });

  test("an SSH job row carries the full shape the claim path reads back", async () => {
    const { createSpy }: Harness = stubDatabase();
    const ctx: StepExecutionContext = makeCtx();
    const step: RunbookStep = sshStep();

    await runSshStep(step, ctx);

    const row: RunnerJob = persistedRow(createSpy);

    expect(row.stepType).toBe(RunbookStepType.SSH);
    expect(row.stepId).toBe(step.id);
    expect(row.status).toBe(RunnerJobStatus.Pending);
    expect(row.origin).toBe(RunnerJobOrigin.Runbook);
    expect(row.projectId?.toString()).toBe(ctx.projectId.toString());
    expect(row.runbookExecutionId?.toString()).toBe(
      ctx.runbookExecutionId.toString(),
    );
    expect(row.targetAgentId?.toString()).toBe(AGENT_ID);
    expect(row.payload).toEqual({
      credentialId: CREDENTIAL_ID,
      command: "systemctl restart nginx",
    });
    // The credential is resolved at claim time; the row references it by id only.
    expect(JSON.stringify(row)).not.toContain("privateKey");
  });

  test("a create failure still surfaces on the step rather than escaping the execution", async () => {
    /*
     * The failure mode that produced the bug report: whatever create() throws
     * has to arrive as the step's error message. That is what made #3209
     * diagnosable at all, and it must keep working for the next unexpected
     * database error.
     */
    const { createSpy, pollSpy }: Harness = stubDatabase();
    createSpy.mockRejectedValue(new Error("duplicate key value"));

    const result: StepRunResult = await runSshStep(sshStep(), makeCtx());

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("duplicate key value");
    expect(pollSpy).not.toHaveBeenCalled();
  });
});

describe("#3209 — the AI remediation lane has the same empty-script shape", () => {
  let countBySpy: jest.SpyInstance;

  beforeEach(() => {
    countBySpy = jest
      .spyOn(RunnerJobService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
  });

  test("an AI-composed SSH command is persisted and passes required-field validation", async () => {
    /*
     * enqueueAiCommand writes the same empty script + payload layout the
     * runbook executors do, so it was broken by the same declaration — an
     * approved remediation plan would have failed at the last step, after a
     * human had already approved it.
     */
    const { createSpy }: Harness = stubDatabase();

    await RunnerJobService.enqueueAiCommand({
      projectId: new ObjectID("proj1"),
      aiRunId: new ObjectID("run1"),
      autoRemediationSuggestionId: new ObjectID("sugg1"),
      stepId: "cmd-1",
      stepType: RunbookStepType.SSH,
      targetAgentId: new ObjectID(AGENT_ID),
      command: "systemctl restart nginx",
      credentialId: CREDENTIAL_ID,
      timeoutInMs: 60_000,
    });

    expect(countBySpy).toHaveBeenCalled();

    const row: RunnerJob = persistedRow(createSpy);

    expect(row.script).toBe("");
    expect(row.origin).toBe(RunnerJobOrigin.AiRemediation);
    expect(row.payload).toEqual({
      credentialId: CREDENTIAL_ID,
      command: "systemctl restart nginx",
    });
    expect(() => {
      return runRealCreateValidation(row);
    }).not.toThrow();
  });

  test("an AI-composed Bash command still persists with the command as its script", async () => {
    const { createSpy }: Harness = stubDatabase();

    await RunnerJobService.enqueueAiCommand({
      projectId: new ObjectID("proj1"),
      aiRunId: new ObjectID("run1"),
      autoRemediationSuggestionId: new ObjectID("sugg1"),
      stepId: "cmd-1",
      stepType: RunbookStepType.Bash,
      targetAgentId: new ObjectID(AGENT_ID),
      command: "systemctl restart nginx",
      timeoutInMs: 60_000,
    });

    const row: RunnerJob = persistedRow(createSpy);

    expect(row.script).toBe("systemctl restart nginx");
    expect(row.payload).toBeUndefined();
    expect(() => {
      return runRealCreateValidation(row);
    }).not.toThrow();
  });
});
