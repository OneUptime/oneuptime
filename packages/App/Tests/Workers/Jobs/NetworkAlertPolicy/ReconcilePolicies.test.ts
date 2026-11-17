import NetworkAlertPolicy from "Common/Models/DatabaseModels/NetworkAlertPolicy";
import Semaphore from "Common/Server/Infrastructure/Semaphore";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import NetworkAlertPolicyEngineService, {
  PolicyRunContext,
} from "Common/Server/Services/NetworkAlertPolicyEngineService";
import NetworkAlertPolicyService from "Common/Server/Services/NetworkAlertPolicyService";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";

/*
 * Contract under test — the five-minute sweep that converges Network Alert
 * Policies with the device estate.
 *
 * The inline path (a device write, a policy save) covers the common case, so
 * this job is the safety net for the three things it deliberately does NOT
 * cover: a bulk device write that was too large to reconcile inside the
 * request, a project whose reconciliation was capped mid-run, and a failure
 * that has since fixed itself (a plan upgraded, a template restored, a Redis
 * blip). Nothing re-fires those events, so without this sweep those fleets
 * would stay half-provisioned until somebody re-saved a policy by hand.
 *
 * What the tests pin is the bookkeeping that makes it safe to run every five
 * minutes across a many-replica worker fleet, because each piece fails
 * silently on its own:
 *
 *   - ONE SWEEP AT A TIME, STOPPED AT ITS DEADLINE. RunCron runs one copy
 *     of the job at a time (CronLock), so the job takes no lock of its own
 *     (issue #8103). A sweep that provisions hundreds of monitors can still
 *     outlive its schedule, so it stops between policies once the run's
 *     deadline has passed - its time limit, or its lease lost - and leaves
 *     the rest, still the stalest, to the next tick.
 *   - NEVER-SYNCED POLICIES GO FIRST. `lastSyncAt IS NULL` is the policy
 *     whose devices have NO monitors at all, and Postgres sorts NULLs LAST
 *     ascending — so a single ORDER BY would put the one policy that has
 *     never provisioned behind every policy that merely has a stale stamp.
 *   - ONE RUN CONTEXT PER PROJECT. The monitor budget and the plan verdict
 *     are per project, not per policy: three policies of one project must
 *     share five hundred monitor writes, and a project whose plan refuses
 *     another monitor must produce one message rather than one per policy.
 *   - ONE BROKEN POLICY MUST NOT STARVE THE SWEEP.
 *   - DISABLED AND TEMPLATE-LESS POLICIES ARE NOT SWEPT. Neither provisions
 *     anything, and a disabled policy's monitors are paused rather than
 *     removed, so there is no difference for a sweep to apply.
 */

/*
 * The job exports no handler: it registers one at module load. Capture that
 * callback so each test can exercise a complete sweep without creating a
 * BullMQ repeatable job.
 */
type CronHandler = (deadline?: JobDeadline) => Promise<void>;

const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, _options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: {
      lock: jest.fn(),
      release: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/NetworkAlertPolicyService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/NetworkAlertPolicyEngineService", () => {
  return {
    __esModule: true,
    MAX_MONITORS_PER_POLICY_SYNC: 500,
    default: {
      syncPolicy: jest.fn(),
      createRunContext: jest.fn(),
    },
  };
});

// Imported for its side effect: the RunCron mock above records the handler.
import "../../../../FeatureSet/Workers/Jobs/NetworkAlertPolicy/ReconcilePolicies";

const JOB_NAME: string = "NetworkAlertPolicy:ReconcilePolicies";

const policyService: { findBy: jest.Mock } =
  NetworkAlertPolicyService as unknown as { findBy: jest.Mock };
const engine: { syncPolicy: jest.Mock; createRunContext: jest.Mock } =
  NetworkAlertPolicyEngineService as unknown as {
    syncPolicy: jest.Mock;
    createRunContext: jest.Mock;
  };
const semaphore: { lock: jest.Mock; release: jest.Mock } =
  Semaphore as unknown as { lock: jest.Mock; release: jest.Mock };

const PROJECT_A_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROJECT_B_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

function makePolicy(data: {
  id: string;
  projectId: ObjectID;
  name?: string;
}): NetworkAlertPolicy {
  const policy: NetworkAlertPolicy = new NetworkAlertPolicy();
  policy.id = new ObjectID(data.id);
  policy.projectId = data.projectId;
  policy.name = data.name || "Warehouse switches";

  return policy;
}

function makeContext(projectId: ObjectID): PolicyRunContext {
  return {
    projectId: projectId,
    policies: null,
    templatesById: new Map(),
    planChecked: false,
    planException: null,
    isStopped: false,
    monitorBudget: 500,
    monitorsWritten: 0,
    monitorsCreated: 0,
    monitorsAdopted: 0,
    monitorsDeleted: 0,
    monitorsPaused: 0,
    isTruncated: false,
    failures: [],
  };
}

/*
 * The job asks two questions: never-synced policies first, then the stalest.
 * `answers` is [neverSynced, stalest].
 */
function policyPages(
  answers: [Array<NetworkAlertPolicy>, Array<NetworkAlertPolicy>],
): void {
  policyService.findBy
    .mockResolvedValueOnce(answers[0])
    .mockResolvedValueOnce(answers[1]);
}

async function runSweep(deadline?: JobDeadline): Promise<void> {
  await mockCapturedJobs[JOB_NAME]!(deadline);
}

beforeEach(() => {
  jest.clearAllMocks();
  engine.createRunContext.mockImplementation(
    (projectId: ObjectID): PolicyRunContext => {
      return makeContext(projectId);
    },
  );
  engine.syncPolicy.mockResolvedValue(null);
  policyService.findBy.mockResolvedValue([]);
});

describe("the job is registered", () => {
  it("registers under its own name", () => {
    expect(typeof mockCapturedJobs[JOB_NAME]).toBe("function");
  });
});

describe("one sweep at a time", () => {
  /*
   * RunCron runs one copy of the job at a time across every replica
   * (CronLock), so the job's own Redis mutex - from when RunCron had no
   * overlap guard - is gone: two sweeps could only repeat work, the engine's
   * per-device lock keeps them from corrupting each other's monitors.
   */
  it("takes no lock of its own: the run's lease covers it", async () => {
    policyPages([
      [
        makePolicy({
          id: "33333333-3333-4333-8333-333333333333",
          projectId: PROJECT_A_ID,
        }),
      ],
      [],
    ]);

    await runSweep(JobDeadline.none());

    expect(engine.syncPolicy).toHaveBeenCalledTimes(1);
    expect(semaphore.lock).not.toHaveBeenCalled();
    expect(semaphore.release).not.toHaveBeenCalled();
  });

  it("passes a failure to read the policies on, so the run is marked failed", async () => {
    policyService.findBy.mockRejectedValue(new Error("database is on fire"));

    await expect(runSweep()).rejects.toThrow("database is on fire");

    expect(engine.syncPolicy).not.toHaveBeenCalled();
  });
});

describe("a sweep stops at its deadline", () => {
  function threePolicies(): void {
    policyPages([
      [
        makePolicy({
          id: "33333333-3333-4333-8333-333333333333",
          projectId: PROJECT_A_ID,
        }),
        makePolicy({
          id: "44444444-4444-4444-8444-444444444444",
          projectId: PROJECT_A_ID,
        }),
      ],
      [
        makePolicy({
          id: "55555555-5555-4555-8555-555555555555",
          projectId: PROJECT_B_ID,
        }),
      ],
    ]);
  }

  function syncedPolicyIds(): Array<string> {
    return engine.syncPolicy.mock.calls.map((call: Array<unknown>) => {
      return (call[0] as { policyId: ObjectID }).policyId.toString();
    });
  }

  it("syncs every policy it selected while its deadline has not passed", async () => {
    threePolicies();

    await runSweep(new JobDeadline());

    expect(engine.syncPolicy).toHaveBeenCalledTimes(3);
  });

  /*
   * The time limit ran out after the first policy: the sweep stops before
   * the next one, and the policies it did not reach are still the stalest,
   * so they lead the next tick.
   */
  it("stops before the next policy once the deadline has passed, and leaves the rest", async () => {
    threePolicies();

    const deadline: JobDeadline = new JobDeadline();

    engine.syncPolicy.mockImplementationOnce(async (): Promise<null> => {
      deadline.end();
      return null;
    });

    await runSweep(deadline);

    expect(syncedPolicyIds()).toEqual(["33333333-3333-4333-8333-333333333333"]);
  });

  /*
   * A run whose lease was lost has its deadline ended (CronLock): another
   * run may hold the lock now, so this one stops at its next check.
   */
  it("stops the same way when the run's lease was lost", async () => {
    threePolicies();

    const deadline: JobDeadline = new JobDeadline();

    engine.syncPolicy.mockImplementationOnce(async (): Promise<null> => {
      deadline.end(
        new Error(
          "NetworkAlertPolicy:ReconcilePolicies stopped: its lock lapsed, so another run may have started.",
        ),
      );
      return null;
    });

    await runSweep(deadline);

    expect(engine.syncPolicy).toHaveBeenCalledTimes(1);
  });

  it("syncs nothing when its deadline passed before it started", async () => {
    threePolicies();

    const deadline: JobDeadline = new JobDeadline();
    deadline.end();

    await runSweep(deadline);

    expect(engine.syncPolicy).not.toHaveBeenCalled();
  });

  /*
   * The soft budget still applies: a sweep that has spent most of its time
   * limit stops between policies, leaving the policy in flight room to
   * finish before the limit.
   */
  it("stops once it has spent most of its time limit, even before the deadline", async () => {
    threePolicies();

    const start: number = Date.now();
    const now: jest.SpyInstance = jest.spyOn(Date, "now");

    now.mockReturnValue(start);

    engine.syncPolicy.mockImplementationOnce(async (): Promise<null> => {
      // Past four fifths of the four-minute time limit.
      now.mockReturnValue(start + 3.5 * 60 * 1000);
      return null;
    });

    try {
      await runSweep(new JobDeadline());
    } finally {
      now.mockRestore();
    }

    expect(engine.syncPolicy).toHaveBeenCalledTimes(1);
  });
});

describe("which policies a tick picks up", () => {
  it("asks for never-synced policies before the stalest ones", async () => {
    await runSweep();

    const [neverSyncedQuery, stalestQuery]: Array<{
      query: Record<string, unknown>;
      sort: Record<string, unknown>;
    }> = policyService.findBy.mock.calls.map((call: Array<unknown>) => {
      return call[0] as {
        query: Record<string, unknown>;
        sort: Record<string, unknown>;
      };
    });

    /*
     * Two queries rather than one ORDER BY: `lastSyncAt IS NULL` is a policy
     * that has never provisioned anything, and Postgres sorts NULLs LAST
     * ascending — so on an install with more policies than one tick can
     * cover, a brand-new policy would never reach the front of a single
     * ordered queue and would never provision at all.
     */
    expect(neverSyncedQuery!.query["lastSyncAt"]).toBeDefined();
    expect(neverSyncedQuery!.sort).toEqual({
      createdAt: SortOrder.Ascending,
    });
    expect(stalestQuery!.sort).toEqual({ lastSyncAt: SortOrder.Ascending });
  });

  /*
   * Neither a disabled policy nor a template-less one provisions anything,
   * and a disabled policy's monitors are PAUSED rather than removed — so
   * there is no difference for a sweep to apply, and sweeping them would be
   * two queries per policy per tick for nothing.
   */
  it("asks only for enabled policies that still have a template", async () => {
    await runSweep();

    for (const call of policyService.findBy.mock.calls) {
      const query: Record<string, unknown> = (
        call[0] as { query: Record<string, unknown> }
      ).query;

      expect(query["isEnabled"]).toBe(true);
      expect(query["monitorTemplateId"]).toBeDefined();
    }
  });

  it("syncs every policy it selected", async () => {
    policyPages([
      [
        makePolicy({
          id: "33333333-3333-4333-8333-333333333333",
          projectId: PROJECT_A_ID,
        }),
      ],
      [
        makePolicy({
          id: "44444444-4444-4444-8444-444444444444",
          projectId: PROJECT_B_ID,
        }),
      ],
    ]);

    await runSweep();

    expect(engine.syncPolicy).toHaveBeenCalledTimes(2);
  });

  /*
   * A sweep must not stamp "Template Synced" — it has re-synced nothing from
   * a template. Only a policy re-pointed at a different template, or a
   * template push, may claim that.
   */
  it("never asks the engine to stamp templateSyncedAt", async () => {
    policyPages([
      [
        makePolicy({
          id: "33333333-3333-4333-8333-333333333333",
          projectId: PROJECT_A_ID,
        }),
      ],
      [],
    ]);

    await runSweep();

    const syncArguments: Record<string, unknown> = engine.syncPolicy.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(Object.keys(syncArguments)).not.toContain(
      "stampTemplateSyncedOnCleanPass",
    );
  });
});

describe("one run context per project", () => {
  it("shares a context — and therefore a monitor budget — across a project's policies", async () => {
    policyPages([
      [
        makePolicy({
          id: "33333333-3333-4333-8333-333333333333",
          projectId: PROJECT_A_ID,
        }),
        makePolicy({
          id: "44444444-4444-4444-8444-444444444444",
          projectId: PROJECT_A_ID,
        }),
      ],
      [
        makePolicy({
          id: "55555555-5555-4555-8555-555555555555",
          projectId: PROJECT_B_ID,
        }),
      ],
    ]);

    await runSweep();

    /*
     * Two contexts for three policies. What is being protected is the
     * PROJECT's database and its bill: three policies each provisioning five
     * hundred monitors is fifteen hundred billable rows out of one tick.
     */
    expect(engine.createRunContext).toHaveBeenCalledTimes(2);

    const contexts: Array<PolicyRunContext> = engine.syncPolicy.mock.calls.map(
      (call: Array<unknown>) => {
        return (call[0] as { context: PolicyRunContext }).context;
      },
    );

    expect(contexts[0]).toBe(contexts[1]);
    expect(contexts[2]).not.toBe(contexts[0]);
  });

  /*
   * PREREQUISITE 5, at the sweep level. Once a project's plan has refused
   * another monitor, every remaining policy of that project would fail
   * identically — so the sweep stops asking, and the policies it already
   * reached carry the one message in lastSyncError.
   */
  it("skips the rest of a project's policies once its plan has refused", async () => {
    engine.syncPolicy.mockImplementation(
      async (data: { context: PolicyRunContext }): Promise<null> => {
        data.context.isStopped = true;
        data.context.planException = "free plan";

        return null;
      },
    );

    policyPages([
      [
        makePolicy({
          id: "33333333-3333-4333-8333-333333333333",
          projectId: PROJECT_A_ID,
        }),
        makePolicy({
          id: "44444444-4444-4444-8444-444444444444",
          projectId: PROJECT_A_ID,
        }),
        makePolicy({
          id: "55555555-5555-4555-8555-555555555555",
          projectId: PROJECT_B_ID,
        }),
      ],
      [],
    ]);

    await runSweep();

    // The second policy of project A is skipped; project B still runs.
    expect(engine.syncPolicy).toHaveBeenCalledTimes(2);
  });

  it("skips the rest of a project's policies once its budget is spent", async () => {
    engine.syncPolicy.mockImplementation(
      async (data: { context: PolicyRunContext }): Promise<null> => {
        data.context.isTruncated = true;

        return null;
      },
    );

    policyPages([
      [
        makePolicy({
          id: "33333333-3333-4333-8333-333333333333",
          projectId: PROJECT_A_ID,
        }),
        makePolicy({
          id: "44444444-4444-4444-8444-444444444444",
          projectId: PROJECT_A_ID,
        }),
      ],
      [],
    ]);

    await runSweep();

    /*
     * Capped, not failed: what the first policy wrote stays written, and the
     * next tick continues from the same recomputed difference.
     */
    expect(engine.syncPolicy).toHaveBeenCalledTimes(1);
  });
});

describe("resilience", () => {
  it("keeps sweeping after one policy throws", async () => {
    engine.syncPolicy
      .mockRejectedValueOnce(new Error("this policy is broken"))
      .mockResolvedValue(null);

    policyPages([
      [
        makePolicy({
          id: "33333333-3333-4333-8333-333333333333",
          projectId: PROJECT_A_ID,
        }),
        makePolicy({
          id: "44444444-4444-4444-8444-444444444444",
          projectId: PROJECT_B_ID,
        }),
      ],
      [],
    ]);

    await expect(runSweep()).resolves.toBeUndefined();

    expect(engine.syncPolicy).toHaveBeenCalledTimes(2);
  });

  it("does no work at all when there are no policies to sync", async () => {
    await runSweep();

    expect(engine.createRunContext).not.toHaveBeenCalled();
    expect(engine.syncPolicy).not.toHaveBeenCalled();
  });
});
