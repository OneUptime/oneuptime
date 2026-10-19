import RunnerJobService, {
  GLOBAL_RUNNER_CLAIM_LOCK_KEY,
  describeRunnerJobTimeout,
} from "../../../Server/Services/RunnerJobService";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import ProjectLimitLock from "../../../Server/Utils/Database/ProjectLimitLock";
import logger from "../../../Server/Utils/Logger";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../Types/Runbook/RunnerJobStatus";
import {
  GLOBAL_RUNNER_MAX_EXECUTION_TIMEOUT_IN_MS,
  MAX_GLOBAL_RUNNER_JOBS_PER_PROJECT,
} from "../../../Types/Runner/GlobalRunnerWork";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * Contract under test - the global Runners' lane of RunnerJobService.
 *
 * A step that picked no Runner of its own, in a project that uses global
 * Runners, waits for ANY global Runner (RunnerJob.runsOnGlobalRunner) instead
 * of one Runner. What keeps one project's steps apart from another's:
 *
 *   - enqueue writes a global job only for a type global Runners run
 *     (JavaScript), never with a target Runner beside it, and holds its
 *     execution timeout to the global most;
 *   - claimNextGlobalJob serves only global jobs (never one aimed at a
 *     project's own Runner), only a runbook's own step of a type global
 *     Runners run, never of a project that turned global Runners off, and at
 *     most MAX_GLOBAL_RUNNER_JOBS_PER_PROJECT of one project's at once;
 *   - a global job that timed out says so in its own words.
 *
 * The claim's SQL is read as written here (what it filters on and what it is
 * handed); GlobalRunnerClaimPostgres runs it against a migrated Postgres.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const EXECUTION_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const GLOBAL_RUNNER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

type EnqueueArgs = Parameters<typeof RunnerJobService.enqueue>[0];

function globalArgs(overrides: Partial<EnqueueArgs> = {}): EnqueueArgs {
  return {
    projectId: PROJECT_ID,
    runbookExecutionId: EXECUTION_ID,
    stepId: "step-1",
    stepType: RunbookStepType.JavaScript,
    runsOnGlobalRunner: true,
    script: "return 1;",
    timeoutInMs: 30_000,
    ...overrides,
  } as EnqueueArgs;
}

let createSpy: jest.SpyInstance;

function createdRow(): RunnerJob {
  expect(createSpy).toHaveBeenCalledTimes(1);
  return (createSpy.mock.calls[0]![0] as { data: RunnerJob }).data;
}

beforeEach(() => {
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

describe("enqueue, for the global Runners", () => {
  test("writes a JavaScript job that waits for any global Runner, aimed at none", async () => {
    await RunnerJobService.enqueue(globalArgs());

    const row: RunnerJob = createdRow();

    expect(row.runsOnGlobalRunner).toBe(true);
    expect(row.targetAgentId).toBeUndefined();
    expect(row.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(row.origin).toBe(RunnerJobOrigin.Runbook);
    expect(row.status).toBe(RunnerJobStatus.Pending);
    expect(row.stepType).toBe(RunbookStepType.JavaScript);
    expect(row.script).toBe("return 1;");
  });

  test("holds the execution timeout to what global Runners allow", async () => {
    await RunnerJobService.enqueue(globalArgs({ timeoutInMs: 60 * 60 * 1000 }));

    expect(createdRow().timeoutInMs).toBe(
      GLOBAL_RUNNER_MAX_EXECUTION_TIMEOUT_IN_MS,
    );
  });

  test("keeps a shorter execution timeout as the step set it", async () => {
    await RunnerJobService.enqueue(globalArgs({ timeoutInMs: 12_000 }));

    expect(createdRow().timeoutInMs).toBe(12_000);
  });

  test.each([
    RunbookStepType.Bash,
    RunbookStepType.SSH,
    RunbookStepType.Kubernetes,
    RunbookStepType.Kubectl,
  ])(
    "never writes a %s job for the global Runners, whatever decided to send it",
    async (stepType: RunbookStepType) => {
      await expect(
        RunnerJobService.enqueue(
          globalArgs({
            stepType,
            script: stepType === RunbookStepType.Bash ? "id" : "",
            payload: { command: "id" },
          }),
        ),
      ).rejects.toThrow(
        `Global Runners do not run ${stepType} steps. They run JavaScript steps only.`,
      );

      expect(createSpy).not.toHaveBeenCalled();
    },
  );

  test("never writes a job for one Runner and the global Runners at once", async () => {
    await expect(
      RunnerJobService.enqueue(globalArgs({ targetAgentId: RUNNER_ID })),
    ).rejects.toBeInstanceOf(BadDataException);

    expect(createSpy).not.toHaveBeenCalled();
  });

  test("negative control: a step that picked a Runner is written for that Runner alone", async () => {
    await RunnerJobService.enqueue(
      globalArgs({
        runsOnGlobalRunner: undefined,
        targetAgentId: RUNNER_ID,
        stepType: RunbookStepType.Bash,
        script: "uptime",
        timeoutInMs: 60 * 60 * 1000,
      }),
    );

    const row: RunnerJob = createdRow();

    expect(row.targetAgentId?.toString()).toBe(RUNNER_ID.toString());
    expect(row.runsOnGlobalRunner).toBeUndefined();
    // A project's own Runner runs it as long as the step says.
    expect(row.timeoutInMs).toBe(60 * 60 * 1000);
  });

  test("negative control: a job with neither a Runner nor the global Runners is refused as before", async () => {
    await expect(
      RunnerJobService.enqueue(globalArgs({ runsOnGlobalRunner: false })),
    ).rejects.toThrow(
      "targetAgentId is required to dispatch a step to a Runner.",
    );
  });
});

interface CapturedQuery {
  sql: string;
  params: Array<unknown>;
}

describe("claimNextGlobalJob", () => {
  // Every statement, in order, and whether it ran in the claim's transaction.
  let queries: Array<CapturedQuery & { inTransaction: boolean }>;
  let answer: Array<Record<string, unknown>>;

  beforeEach(() => {
    queries = [];
    answer = [];

    const record: (
      inTransaction: boolean,
    ) => (sql: string, params: Array<unknown>) => Promise<unknown> = (
      inTransaction: boolean,
    ): ((sql: string, params: Array<unknown>) => Promise<unknown>) => {
      return async (sql: string, params: Array<unknown>): Promise<unknown> => {
        queries.push({ sql, params, inTransaction });
        if (sql === ProjectLimitLock.LOCK_STATEMENT) {
          return [];
        }
        // UPDATE ... RETURNING comes back as [rows, count].
        return [answer, answer.length];
      };
    };

    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue({
      query: jest.fn().mockImplementation(record(false)),
      transaction: jest
        .fn()
        .mockImplementation(
          async (
            run: (manager: { query: unknown }) => Promise<unknown>,
          ): Promise<unknown> => {
            return await run({
              query: jest.fn().mockImplementation(record(true)),
            });
          },
        ),
    } as never);
  });

  // The claim itself: every statement but the lock.
  function claimQuery(): CapturedQuery {
    const claims: Array<CapturedQuery> = queries.filter(
      (query: CapturedQuery): boolean => {
        return query.sql !== ProjectLimitLock.LOCK_STATEMENT;
      },
    );
    expect(claims).toHaveLength(1);
    return claims[0]!;
  }

  test("takes its turn: the claim lock first, then the claim, in one transaction", async () => {
    await RunnerJobService.claimNextGlobalJob({ agentId: GLOBAL_RUNNER_ID });

    expect(
      queries.map((query: CapturedQuery & { inTransaction: boolean }) => {
        return {
          isLock: query.sql === ProjectLimitLock.LOCK_STATEMENT,
          inTransaction: query.inTransaction,
        };
      }),
    ).toEqual([
      { isLock: true, inTransaction: true },
      { isLock: false, inTransaction: true },
    ]);
    expect(queries[0]!.params).toEqual([GLOBAL_RUNNER_CLAIM_LOCK_KEY]);
  });

  test("asks for nothing at all when every requested type is one global Runners never run", async () => {
    await expect(
      RunnerJobService.claimNextGlobalJob({
        agentId: GLOBAL_RUNNER_ID,
        allowedStepTypes: [RunbookStepType.Bash, RunbookStepType.SSH],
      }),
    ).resolves.toBeNull();

    expect(queries).toHaveLength(0);
  });

  test("serves global jobs only, never one aimed at a project's own Runner", async () => {
    await RunnerJobService.claimNextGlobalJob({ agentId: GLOBAL_RUNNER_ID });

    const sql: string = claimQuery().sql;

    expect(sql).toContain(`j."runsOnGlobalRunner" = true`);
    expect(sql).toContain(`j."targetAgentId" IS NULL`);
    // No project filter of the Runner's own: a global Runner belongs to none.
    expect(sql).not.toContain(`"projectId" = $1`);
  });

  test("serves a runbook's own JavaScript steps only, narrowing what the Runner asked for", async () => {
    await RunnerJobService.claimNextGlobalJob({
      agentId: GLOBAL_RUNNER_ID,
      allowedStepTypes: [
        RunbookStepType.Bash,
        RunbookStepType.JavaScript,
        RunbookStepType.Kubectl,
      ],
    });

    const query: CapturedQuery = claimQuery();

    expect(query.sql).toContain(`j."origin" = $2`);
    expect(query.params[1]).toBe(RunnerJobOrigin.Runbook);
    expect(query.sql).toContain(`j."stepType" = ANY($3::text[])`);
    expect(query.params[2]).toEqual([RunbookStepType.JavaScript]);
  });

  test("serves what global Runners run when the Runner asks for nothing in particular", async () => {
    await RunnerJobService.claimNextGlobalJob({ agentId: GLOBAL_RUNNER_ID });

    expect(claimQuery().params[2]).toEqual([RunbookStepType.JavaScript]);
  });

  test("never serves a job of a project that turned global Runners off, read on the claim", async () => {
    await RunnerJobService.claimNextGlobalJob({ agentId: GLOBAL_RUNNER_ID });

    const sql: string = claimQuery().sql;

    expect(sql).toContain(`FROM "Project" p`);
    expect(sql).toContain(`p."_id" = j."projectId"`);
    expect(sql).toContain(`p."useGlobalRunners" = true`);
    expect(sql).toContain(`p."deletedAt" IS NULL`);
  });

  test("never more than three of one project's jobs at once", async () => {
    await RunnerJobService.claimNextGlobalJob({ agentId: GLOBAL_RUNNER_ID });

    const query: CapturedQuery = claimQuery();

    expect(query.sql).toContain(`r."projectId" = j."projectId"`);
    expect(query.sql).toContain(`r."runsOnGlobalRunner" = true`);
    expect(query.sql).toContain(`r."status" IN ($4, $5)`);
    expect(query.params[3]).toBe(RunnerJobStatus.Claimed);
    expect(query.params[4]).toBe(RunnerJobStatus.Running);
    expect(query.params[5]).toBe(MAX_GLOBAL_RUNNER_JOBS_PER_PROJECT);
  });

  test("claims the oldest pending job within its claim window, once, without waiting on a locked row", async () => {
    await RunnerJobService.claimNextGlobalJob({ agentId: GLOBAL_RUNNER_ID });

    const query: CapturedQuery = claimQuery();

    expect(query.sql).toContain(`j."status" = $1`);
    expect(query.params[0]).toBe(RunnerJobStatus.Pending);
    expect(query.sql).toContain(`j."claimDeadlineAt" > NOW()`);
    expect(query.sql).toContain(`j."deletedAt" IS NULL`);
    expect(query.sql).toContain(`ORDER BY j."createdAt" ASC`);
    expect(query.sql).toContain("FOR UPDATE OF j SKIP LOCKED");
  });

  test("writes the claiming global Runner's own id, and a lease", async () => {
    await RunnerJobService.claimNextGlobalJob({
      agentId: GLOBAL_RUNNER_ID,
      leaseMs: 45_000,
    });

    const query: CapturedQuery = claimQuery();

    expect(query.sql).toContain(`"assignedAgentId" = $7::uuid`);
    expect(query.params[6]).toBe(GLOBAL_RUNNER_ID.toString());
    expect(query.params[7]).toBe("45000");
  });

  test("hands back the job with its OWN project, the one secrets and inputs are read from", async () => {
    const otherProject: string = "77777777-7777-4777-8777-777777777777";

    answer = [
      {
        _id: "88888888-8888-4888-8888-888888888888",
        projectId: otherProject,
        runbookExecutionId: EXECUTION_ID.toString(),
        origin: RunnerJobOrigin.Runbook,
        stepId: "step-1",
        stepType: RunbookStepType.JavaScript,
        script: "return 'ok';",
        payload: null,
        timeoutInMs: 30_000,
        status: RunnerJobStatus.Claimed,
        claimedAt: new Date().toISOString(),
        leaseExpiresAt: new Date().toISOString(),
      },
    ];

    const job: RunnerJob | null = await RunnerJobService.claimNextGlobalJob({
      agentId: GLOBAL_RUNNER_ID,
    });

    expect(job).not.toBeNull();
    expect(job!.projectId!.toString()).toBe(otherProject);
    expect(job!.runsOnGlobalRunner).toBe(true);
    expect(job!.assignedAgentId!.toString()).toBe(GLOBAL_RUNNER_ID.toString());
    expect(job!.script).toBe("return 'ok';");
    expect(job!.payload).toBeUndefined();
    expect(job!.targetAgentId).toBeUndefined();
  });

  test("answers nothing when no global job is waiting", async () => {
    await expect(
      RunnerJobService.claimNextGlobalJob({ agentId: GLOBAL_RUNNER_ID }),
    ).resolves.toBeNull();
  });
});

describe("a global job that timed out says so in its own words", () => {
  const base: Parameters<typeof describeRunnerJobTimeout>[0] = {
    kind: "unclaimed",
    origin: RunnerJobOrigin.Runbook,
    stepType: RunbookStepType.JavaScript,
    claimTimeoutInMs: 120_000,
    executionTimeoutInMs: 30_000,
    runsOnGlobalRunner: true,
  };

  test("not picked up: the global Runners, and what to do", () => {
    expect(describeRunnerJobTimeout(base)).toBe(
      "No global Runner picked up this step before the wait window expired. The global Runners may be busy with other steps or offline. Run the runbook again, raise the step's claim timeout, or pick one of your own Runners for the step.",
    );
  });

  test("an overall timeout of a job never claimed reads as not picked up", () => {
    expect(
      describeRunnerJobTimeout({
        ...base,
        kind: "overall",
        wasClaimed: false,
      }),
    ).toContain("No global Runner picked up this step");
  });

  test("went silent mid-step", () => {
    expect(describeRunnerJobTimeout({ ...base, kind: "lease_expired" })).toBe(
      "The global Runner running this step stopped responding. It may have restarted. Check what the step was doing before you run the runbook again, or pick one of your own Runners for the step.",
    );
  });

  test("ran out its execution timeout, which a global Runner holds to five minutes", () => {
    expect(
      describeRunnerJobTimeout({
        ...base,
        kind: "overall",
        wasClaimed: true,
      }),
    ).toBe(
      "This step did not finish within its execution timeout (30s) on a global Runner, which runs a step for 5 minutes at most. Make the script finish sooner, raise the step's timeout, or pick one of your own Runners for the step.",
    );
  });

  test("negative control: a job for a project's own Runner keeps the Runner wording", () => {
    expect(
      describeRunnerJobTimeout({ ...base, runsOnGlobalRunner: false }),
    ).toBe(
      "No runbook agent picked up this step before the wait window expired. The agent may be offline — check that it is running and reachable, then try again.",
    );
  });
});
