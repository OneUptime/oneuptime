import RunnerJobService from "../../../Server/Services/RunnerJobService";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import RunbookStepType, {
  RUNNER_EXECUTED_STEP_TYPES,
  isPayloadCarryingStepType,
} from "../../../Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../Types/Runbook/RunnerJobStatus";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import logger from "../../../Server/Utils/Logger";
import { JSONObject } from "../../../Types/JSON";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * Contract under test — RunnerJobService.enqueue, and the RunnerJob column
 * declarations it has to satisfy.
 *
 * Background (issue #3209): RunnerJob.script was declared `required: true`.
 * DatabaseService.checkRequiredFields rejects any falsy value on a required
 * column, and an empty string is falsy — so every SSH and Kubernetes job,
 * which carries its instruction in `payload` and an empty script BY DESIGN,
 * died at create() with "script is required". Two whole step types were
 * unusable, and nothing caught it because every test stubbed enqueue.
 *
 * Two things are pinned here, and they are deliberately different in kind:
 *
 *   1. the column declaration itself — `script` must not be a required
 *      column. This is the direct tripwire on the change that caused the bug.
 *
 *   2. the rule that `required: true` was standing in for, now enforced
 *      per-type where it can actually be expressed: a script-carrying type
 *      must bring a script, a payload-carrying type must bring a payload, and
 *      the row that comes out passes the real validator either way.
 *
 * No database: create is stubbed at the boundary, and everything above it is
 * the real implementation.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const EXECUTION_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const AGENT_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

const SSH_PAYLOAD: JSONObject = {
  credentialId: "55555555-5555-4555-8555-555555555555",
  command: "systemctl restart nginx",
};

/*
 * The production validator, bound off the live service rather than
 * reimplemented — the point is to fail if the model's declarations change,
 * not if a copy of the rule drifts.
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

type EnqueueArgs = Parameters<typeof RunnerJobService.enqueue>[0];

function enqueueArgs(overrides: Partial<EnqueueArgs> = {}): EnqueueArgs {
  return {
    projectId: PROJECT_ID,
    runbookExecutionId: EXECUTION_ID,
    stepId: "step-1",
    stepType: RunbookStepType.Bash,
    targetAgentId: AGENT_ID,
    script: "uptime",
    timeoutInMs: 30_000,
    ...overrides,
  } as EnqueueArgs;
}

/*
 * Arguments that are valid for the given step type — a script for the script
 * types, a payload and an empty script for the payload types. Used by the
 * table-driven tests so every runner-executed type is exercised through the
 * same assertions.
 */
function validArgsFor(stepType: RunbookStepType): EnqueueArgs {
  if (isPayloadCarryingStepType(stepType)) {
    return enqueueArgs({ stepType, script: "", payload: SSH_PAYLOAD });
  }
  return enqueueArgs({ stepType, script: "echo hello" });
}

let createSpy: jest.SpyInstance;

function createdRow(): RunnerJob {
  expect(createSpy).toHaveBeenCalledTimes(1);
  return (createSpy.mock.calls[0]![0] as { data: RunnerJob }).data;
}

beforeEach(() => {
  /*
   * enqueue is wrapped in @CaptureSpan, which records a thrown exception at
   * error level. The rejection tests expect those throws, so keep the output
   * readable.
   */
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });

  createSpy = jest
    .spyOn(RunnerJobService, "create")
    .mockImplementation((args: { data: RunnerJob }): Promise<RunnerJob> => {
      const row: RunnerJob = args.data;
      row._id = "66666666-6666-4666-8666-666666666666";
      return Promise.resolve(row);
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("RunnerJob column declarations", () => {
  test("script is NOT a required column — the declaration that caused #3209", () => {
    /*
     * The single assertion that would have caught the bug. Flipping this back
     * to `required: true` makes every SSH and Kubernetes job unpersistable,
     * because their script is legitimately an empty string.
     */
    const requiredColumns: Array<string> = new RunnerJob().getRequiredColumns()
      .columns;

    expect(requiredColumns).not.toContain("script");
  });

  test("the columns that genuinely cannot be empty are still required", () => {
    /*
     * The fix must not have relaxed anything else. Each of these is written by
     * enqueue on every job and has no meaningful empty value, so a missing one
     * should still be refused before it reaches Postgres.
     */
    const requiredColumns: Array<string> = new RunnerJob().getRequiredColumns()
      .columns;

    for (const column of [
      "projectId",
      "origin",
      "stepId",
      "stepType",
      "status",
      "timeoutInMs",
      "claimDeadlineAt",
    ]) {
      expect(requiredColumns).toContain(column);
    }
  });

  test("payload is optional, since script-carrying jobs have none", () => {
    expect(new RunnerJob().getRequiredColumns().columns).not.toContain(
      "payload",
    );
  });

  test("an empty script is rejected by the required-column check, which is why script is not required", () => {
    /*
     * Documents the mechanism rather than assuming it: checkRequiredFields
     * tests truthiness, so "" fails exactly like undefined. Any future column
     * that can legitimately hold an empty string has the same constraint.
     */
    const row: RunnerJob = new RunnerJob();
    row.projectId = PROJECT_ID;
    row.origin = RunnerJobOrigin.Runbook;
    row.stepId = "step-1";
    row.stepType = RunbookStepType.SSH;
    row.status = RunnerJobStatus.Pending;
    row.timeoutInMs = 30_000;
    row.claimDeadlineAt = new Date();
    row.script = "";
    row.payload = SSH_PAYLOAD;

    // Passes only because `script` is not in the required set.
    expect(() => {
      return runRealCreateValidation(row);
    }).not.toThrow();

    const stillRequired: RunnerJob = Object.assign(new RunnerJob(), row);
    stillRequired.stepId = "";

    // Same falsy value on a column that IS required — still refused.
    expect(() => {
      return runRealCreateValidation(stillRequired);
    }).toThrow(/stepId is required/);
  });
});

describe("RunnerJobService.enqueue — what may be dispatched", () => {
  test.each([
    RunbookStepType.Manual,
    RunbookStepType.HttpRequest,
    RunbookStepType.AI,
  ])(
    "refuses %s, which no Runner can execute",
    async (type: RunbookStepType) => {
      await expect(
        RunnerJobService.enqueue(enqueueArgs({ stepType: type })),
      ).rejects.toThrow(BadDataException);

      expect(createSpy).not.toHaveBeenCalled();
    },
  );

  test("refuses a job with no target Runner", async () => {
    await expect(
      RunnerJobService.enqueue(
        enqueueArgs({ targetAgentId: undefined as unknown as ObjectID }),
      ),
    ).rejects.toThrow(/targetAgentId is required/);

    expect(createSpy).not.toHaveBeenCalled();
  });

  test.each([RunbookStepType.SSH, RunbookStepType.Kubernetes])(
    "refuses a %s job that arrives without structured instructions",
    async (type: RunbookStepType) => {
      /*
       * The invariant that replaced the required column. A payload-carrying
       * job with neither script nor payload would reach a Runner with nothing
       * to do; the Runner's own guard would fail it, but only after a claim,
       * a lease and a round trip. Refuse it at the source, with a message that
       * names what is missing.
       */
      await expect(
        RunnerJobService.enqueue(enqueueArgs({ stepType: type, script: "" })),
      ).rejects.toThrow(/structured instructions/);

      expect(createSpy).not.toHaveBeenCalled();
    },
  );

  test.each([RunbookStepType.Bash, RunbookStepType.JavaScript])(
    "refuses a %s job with an empty script",
    async (type: RunbookStepType) => {
      /*
       * The mirror image. The step executors already short-circuit an empty
       * script as a no-op before dispatching, so this is a backstop for any
       * other caller — and it is the check that used to be (accidentally)
       * provided by the required column.
       */
      await expect(
        RunnerJobService.enqueue(enqueueArgs({ stepType: type, script: "" })),
      ).rejects.toThrow(/needs a script/);

      expect(createSpy).not.toHaveBeenCalled();
    },
  );

  test("a payload alone does not satisfy a script-carrying step type", async () => {
    await expect(
      RunnerJobService.enqueue(
        enqueueArgs({
          stepType: RunbookStepType.Bash,
          script: "",
          payload: SSH_PAYLOAD,
        }),
      ),
    ).rejects.toThrow(/needs a script/);

    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe("RunnerJobService.enqueue — the row that is written", () => {
  test.each(RUNNER_EXECUTED_STEP_TYPES)(
    "a %s job passes the model's real required-field validation",
    async (type: RunbookStepType) => {
      /*
       * The regression test for #3209, run across every type a Runner can be
       * handed. With `script` required again, the two payload-carrying types
       * fail here exactly as they failed in production.
       */
      await RunnerJobService.enqueue(validArgsFor(type));

      const row: RunnerJob = createdRow();

      expect(() => {
        return runRealCreateValidation(row);
      }).not.toThrow();
    },
  );

  test.each([RunbookStepType.SSH, RunbookStepType.Kubernetes])(
    "a %s job is written with an empty script and its payload",
    async (type: RunbookStepType) => {
      await RunnerJobService.enqueue(validArgsFor(type));

      const row: RunnerJob = createdRow();

      expect(row.script).toBe("");
      expect(row.payload).toEqual(SSH_PAYLOAD);
      expect(row.stepType).toBe(type);
    },
  );

  test("an undefined script becomes an empty string, never undefined", async () => {
    /*
     * The column is NOT NULL in Postgres. Relaxing the application-level check
     * must not let an undefined value through to the database, where it would
     * surface as a driver error instead of a readable one.
     */
    await RunnerJobService.enqueue(
      enqueueArgs({
        stepType: RunbookStepType.SSH,
        script: undefined as unknown as string,
        payload: SSH_PAYLOAD,
      }),
    );

    const row: RunnerJob = createdRow();

    expect(row.script).toBe("");
    expect(typeof row.script).toBe("string");
  });

  test("a script-carrying job keeps its script verbatim and gets no payload key", async () => {
    const script: string = "pg_dump -Fc app | gzip > /backup/$(date +%F).gz";

    await RunnerJobService.enqueue(
      enqueueArgs({ stepType: RunbookStepType.Bash, script }),
    );

    const row: RunnerJob = createdRow();

    expect(row.script).toBe(script);
    expect(row.payload).toBeUndefined();
  });

  test("a runbook job carries Runbook provenance and starts Pending", async () => {
    await RunnerJobService.enqueue(validArgsFor(RunbookStepType.SSH));

    const row: RunnerJob = createdRow();

    expect(row.origin).toBe(RunnerJobOrigin.Runbook);
    expect(row.status).toBe(RunnerJobStatus.Pending);
    expect(row.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(row.runbookExecutionId?.toString()).toBe(EXECUTION_ID.toString());
    expect(row.targetAgentId?.toString()).toBe(AGENT_ID.toString());
    expect(row.stepId).toBe("step-1");
    expect(row.timeoutInMs).toBe(30_000);
    // Never pre-assigned: a job belongs to whoever wins the claim.
    expect(row.assignedAgentId).toBeUndefined();
  });

  test("the claim deadline honours the configured claim timeout", async () => {
    const before: number = Date.now();

    await RunnerJobService.enqueue(
      enqueueArgs({
        stepType: RunbookStepType.SSH,
        script: "",
        payload: SSH_PAYLOAD,
        claimTimeoutInMs: 300_000,
      }),
    );

    const after: number = Date.now();
    const deadlineMs: number = createdRow().claimDeadlineAt!.getTime();

    expect(deadlineMs).toBeGreaterThanOrEqual(before + 300_000);
    expect(deadlineMs).toBeLessThanOrEqual(after + 300_000);
  });

  test("an SSH job row never carries credential material", async () => {
    /*
     * The reason the payload exists at all: the row is readable by anyone who
     * can read the execution, so it references a credential by id and the
     * secret is resolved at claim time, scoped to the claiming Runner.
     */
    await RunnerJobService.enqueue(validArgsFor(RunbookStepType.SSH));

    const serialized: string = JSON.stringify(createdRow());

    for (const marker of [
      "privateKey",
      "passphrase",
      "password",
      "hostname",
      "username",
      "BEGIN OPENSSH PRIVATE KEY",
    ]) {
      expect(serialized).not.toContain(marker);
    }
  });

  test("the create is performed as root, since no user owns a dispatched job", async () => {
    await RunnerJobService.enqueue(validArgsFor(RunbookStepType.SSH));

    const args: { props: Record<string, unknown> } = createSpy.mock
      .calls[0]![0] as { props: Record<string, unknown> };

    expect(args.props).toEqual(expect.objectContaining({ isRoot: true }));
  });
});
