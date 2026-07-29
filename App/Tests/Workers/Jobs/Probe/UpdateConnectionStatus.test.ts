import Probe, {
  ProbeConnectionStatus,
} from "Common/Models/DatabaseModels/Probe";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { EVERY_MINUTE } from "Common/Utils/CronTime";

/*
 * Regression tests for the Probe:UpdateConnectionStatus cron rewrite. The job
 * runs EVERY MINUTE and used to call ProbeService.findAllBy({}) - a full-table
 * scan that hauled EVERY probe row in the system into JS on every tick, just
 * to compare two columns (lastAlive vs connectionStatus) per row and decide
 * whether to flip the status. On a large deployment that scan competed with
 * the /probe-ingest hot path for the same table and connections. The rewrite
 * pushes the comparison into SQL: two targeted findBy queries fetch ONLY the
 * probes whose stored status disagrees with what their lastAlive implies, so
 * a steady-state tick costs two indexed-predicate SELECTs and nothing else.
 * These tests pin:
 *   1. the query fan-in: exactly two findBy calls per tick, ZERO findAllBy /
 *      findOneBy / findOneById calls, select limited to {_id, projectId},
 *   2. the predicate shapes (lessThanEqualToOrNull / greaterThan / notInOrNull
 *      over ONE shared 3-minute cutoff) and their exact-parity semantics with
 *      the old in-process check,
 *   3. the flip writes: full-pipeline updateOneById per candidate carrying
 *      ONLY connectionStatus, with per-probe failure isolation.
 *
 * The job registers itself via RunCron at import time and exports nothing, so
 * the Cron util is mocked to CAPTURE the handler and options (the same
 * recorder the other App/Tests/Workers/Jobs suites use) and each test drives
 * one full tick.
 */

type CronHandler = () => Promise<void>;

interface CronOptions {
  schedule: string;
  runOnStartup: boolean;
}

interface CapturedJob {
  options: CronOptions;
  handler: CronHandler;
}

/*
 * Captured cron registrations, keyed by job name. Must be declared before the
 * job import below so the mock factory closure can see it.
 */
const mockCapturedJobs: Record<string, CapturedJob> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (
        jobName: string,
        options: CronOptions,
        runFunction: CronHandler,
      ): void => {
        mockCapturedJobs[jobName] = { options, handler: runFunction };
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

/*
 * findAllBy / findOneBy / findOneById are mocked ALONGSIDE the targeted findBy
 * precisely so the suite can prove they are never called: if the job regressed
 * back to the all-rows findAllBy({}) scan (or per-probe point reads), the
 * assertions would flag it instead of the mock throwing "not a function".
 */
jest.mock("Common/Server/Services/ProbeService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      findAllBy: jest.fn(),
      updateOneById: jest.fn(),
      findOneBy: jest.fn(),
      findOneById: jest.fn(),
    },
  };
});

/*
 * QueryHelper is mocked with sentinel-returning fns so the tests can assert
 * BOTH which predicate factory each query field came from AND the exact
 * argument it was built with (the real helpers return opaque typeorm Raw
 * FindOperators keyed by random parameter names, which are awkward to
 * introspect). Each sentinel captures the factory args, so asserting the
 * query field deep-equals the sentinel pins the whole predicate.
 */
jest.mock("Common/Server/Types/Database/QueryHelper", () => {
  return {
    __esModule: true,
    default: {
      lessThanEqualToOrNull: jest.fn((value: Date) => {
        return { op: "lessThanEqualToOrNull", value };
      }),
      greaterThan: jest.fn((value: Date) => {
        return { op: "greaterThan", value };
      }),
      notInOrNull: jest.fn((values: Array<string>) => {
        return { op: "notInOrNull", values };
      }),
    },
  };
});

import ProbeService from "Common/Server/Services/ProbeService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import logger from "Common/Server/Utils/Logger";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/Probe/UpdateConnectionStatus";

interface ProbeServiceMock {
  findBy: jest.Mock;
  findAllBy: jest.Mock;
  updateOneById: jest.Mock;
  findOneBy: jest.Mock;
  findOneById: jest.Mock;
}

interface QueryHelperMock {
  lessThanEqualToOrNull: jest.Mock;
  greaterThan: jest.Mock;
  notInOrNull: jest.Mock;
}

const probeService: ProbeServiceMock =
  ProbeService as unknown as ProbeServiceMock;
const queryHelper: QueryHelperMock = QueryHelper as unknown as QueryHelperMock;
const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

const JOB_NAME: string = "Probe:UpdateConnectionStatus";

const PROJECT_1_ID: ObjectID = new ObjectID("project-1");
const PROJECT_2_ID: ObjectID = new ObjectID("project-2");

// The staleness cutoff: 3 whole minutes, see the parity test below for why.
const STALE_CUTOFF_IN_MS: number = 3 * 60 * 1000;

function makeProbe(data: { id?: ObjectID; projectId?: ObjectID }): Probe {
  const probe: Probe = new Probe(data.id);

  if (data.projectId) {
    probe.projectId = data.projectId;
  }

  return probe;
}

interface FindByArgs {
  query: Record<string, unknown>;
  select: Record<string, boolean>;
  skip: number;
  limit: number;
  props: Record<string, unknown>;
}

// The two findBy calls are issued sequentially: disconnect first, connect second.
function disconnectQueryArgs(): FindByArgs {
  return probeService.findBy.mock.calls[0]![0] as FindByArgs;
}

function connectQueryArgs(): FindByArgs {
  return probeService.findBy.mock.calls[1]![0] as FindByArgs;
}

interface UpdateCallArgs {
  id: ObjectID;
  data: Record<string, unknown>;
  props: Record<string, unknown>;
}

function updateCalls(): Array<UpdateCallArgs> {
  return probeService.updateOneById.mock.calls.map((args: Array<unknown>) => {
    return args[0] as UpdateCallArgs;
  });
}

async function runWorkerTick(): Promise<void> {
  const captured: CapturedJob | undefined = mockCapturedJobs[JOB_NAME];

  if (!captured) {
    throw new Error(
      "Probe:UpdateConnectionStatus did not register a cron handler - the RunCron mock never saw it.",
    );
  }

  await captured.handler();
}

describe("Probe:UpdateConnectionStatus worker", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    probeService.findBy.mockResolvedValue([]);
    probeService.updateOneById.mockResolvedValue(undefined);
  });

  test("registers on EVERY_MINUTE without running on startup", () => {
    const captured: CapturedJob | undefined = mockCapturedJobs[JOB_NAME];

    expect(captured).toBeDefined();
    expect(captured!.options).toEqual({
      schedule: EVERY_MINUTE,
      runOnStartup: false,
    });
  });

  test("one tick issues exactly two targeted findBy queries - never the all-rows scan", async () => {
    await runWorkerTick();

    /*
     * THE regression this rewrite removed: findAllBy({}) fetched every Probe
     * row in the system every minute - a full-table scan whose rows were all
     * hauled into JS just to compare two columns per row. The status
     * disagreement now lives in the SQL predicates, so the tick issues
     * exactly two SELECTs (stale-but-not-Disconnected, fresh-but-not-
     * Connected) and touches nothing else.
     */
    expect(probeService.findBy).toHaveBeenCalledTimes(2);
    expect(probeService.findAllBy).not.toHaveBeenCalled();
    expect(probeService.findOneBy).not.toHaveBeenCalled();
    expect(probeService.findOneById).not.toHaveBeenCalled();
  });

  test("disconnect query: stale-or-never-alive AND not-already-Disconnected, id+projectId only, root, LIMIT_MAX", async () => {
    await runWorkerTick();

    const args: FindByArgs = disconnectQueryArgs();

    /*
     * lessThanEqualToOrNull (not plain lessThanEqualTo): a probe that has
     * NEVER stamped lastAlive must also count as stale, mirroring the old
     * in-process branch that treated a missing lastAlive as disconnected.
     */
    expect(args.query["lastAlive"]).toEqual({
      op: "lessThanEqualToOrNull",
      value: expect.any(Date),
    });

    /*
     * notInOrNull (not notEquals): a NULL connectionStatus (probe that never
     * had one stamped) must still be flipped, matching the old comparison
     * `probe.connectionStatus !== computedStatus`.
     */
    expect(args.query["connectionStatus"]).toEqual({
      op: "notInOrNull",
      values: [ProbeConnectionStatus.Disconnected],
    });

    /*
     * Only the columns the flip loop needs - selecting more (probe keys,
     * icon blobs) would re-inflate the rows this rewrite stopped hauling.
     */
    expect(args.select).toEqual({
      _id: true,
      projectId: true,
    });
    expect(args.skip).toBe(0);
    expect(args.limit).toBe(LIMIT_MAX);
    expect(args.props).toEqual({ isRoot: true });
  });

  test("connect query: alive-within-cutoff AND not-already-Connected, same shape", async () => {
    await runWorkerTick();

    const args: FindByArgs = connectQueryArgs();

    /*
     * Strict greaterThan (no OrNull): a NULL lastAlive can never count as
     * "recently alive", so it must not qualify a probe for the Connected
     * flip.
     */
    expect(args.query["lastAlive"]).toEqual({
      op: "greaterThan",
      value: expect.any(Date),
    });
    expect(args.query["connectionStatus"]).toEqual({
      op: "notInOrNull",
      values: [ProbeConnectionStatus.Connected],
    });

    expect(args.select).toEqual({
      _id: true,
      projectId: true,
    });
    expect(args.skip).toBe(0);
    expect(args.limit).toBe(LIMIT_MAX);
    expect(args.props).toEqual({ isRoot: true });
  });

  test("both queries share ONE now-minus-3-minutes cutoff - exact parity with the old moment-truncated check", async () => {
    const tickStart: number = Date.now();

    await runWorkerTick();

    expect(queryHelper.lessThanEqualToOrNull).toHaveBeenCalledTimes(1);
    expect(queryHelper.greaterThan).toHaveBeenCalledTimes(1);

    const staleCutoff: Date = queryHelper.lessThanEqualToOrNull.mock
      .calls[0]![0] as Date;

    /*
     * 3 minutes, NOT the 2 minutes the old code appears to say: the historical
     * in-process check was `OneUptimeDate.getDifferenceInMinutes(now,
     * lastAlive) > 2`, and moment's diff-in-minutes TRUNCATES - "difference
     * > 2 minutes" was only true once a probe was >= 3 whole minutes stale.
     * The SQL predicate `lastAlive <= now - 3 minutes` flips at exactly the
     * same instant. Shrinking this to 2 minutes would flag probes
     * Disconnected a full minute earlier than the job ever did.
     */
    expect(
      Math.abs(staleCutoff.getTime() - (tickStart - STALE_CUTOFF_IN_MS)),
    ).toBeLessThanOrEqual(2000);

    /*
     * The SAME cutoff instant feeds both predicates: computing "now" twice
     * would open a sliver between the two queries where a probe matches
     * neither (or both) directions.
     */
    expect(queryHelper.greaterThan.mock.calls[0]![0] as Date).toBe(staleCutoff);
  });

  test("a steady-state tick with zero candidates writes nothing", async () => {
    await runWorkerTick();

    // The common case: two SELECTs, no updates, no hooks fired.
    expect(probeService.updateOneById).not.toHaveBeenCalled();
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("flips disconnect candidates to Disconnected and connect candidates to Connected - connectionStatus is the ONLY column written", async () => {
    const staleProbeId: ObjectID = new ObjectID("probe-stale");
    const freshProbeId: ObjectID = new ObjectID("probe-fresh");

    probeService.findBy
      .mockResolvedValueOnce([
        makeProbe({ id: staleProbeId, projectId: PROJECT_1_ID }),
      ])
      .mockResolvedValueOnce([
        makeProbe({ id: freshProbeId, projectId: PROJECT_2_ID }),
      ]);

    await runWorkerTick();

    const updates: Array<UpdateCallArgs> = updateCalls();

    expect(updates).toHaveLength(2);

    expect(updates[0]!.id.toString()).toBe(staleProbeId.toString());
    expect(updates[0]!.data["connectionStatus"]).toBe(
      ProbeConnectionStatus.Disconnected,
    );
    expect(updates[0]!.props).toEqual({ isRoot: true });

    expect(updates[1]!.id.toString()).toBe(freshProbeId.toString());
    expect(updates[1]!.data["connectionStatus"]).toBe(
      ProbeConnectionStatus.Connected,
    );
    expect(updates[1]!.props).toEqual({ isRoot: true });

    /*
     * The full-pipeline updateOneById is what fires ProbeService's hooks
     * (owner notifications, monitor status refresh) - the write must carry
     * ONLY the status flip, so no other column rides along into those hooks.
     */
    for (const update of updates) {
      expect(Object.keys(update.data)).toEqual(["connectionStatus"]);
    }
  });

  test("one probe's flip failure does not prevent the remaining flips", async () => {
    const failingProbeId: ObjectID = new ObjectID("probe-failing");
    const survivingProbeId: ObjectID = new ObjectID("probe-surviving");
    const freshProbeId: ObjectID = new ObjectID("probe-fresh");

    probeService.findBy
      .mockResolvedValueOnce([
        makeProbe({ id: failingProbeId, projectId: PROJECT_1_ID }),
        makeProbe({ id: survivingProbeId, projectId: PROJECT_1_ID }),
      ])
      .mockResolvedValueOnce([
        makeProbe({ id: freshProbeId, projectId: PROJECT_2_ID }),
      ]);

    const flipError: Error = new Error("db connection reset");

    probeService.updateOneById.mockImplementation(
      (args: UpdateCallArgs): Promise<void> => {
        if (args.id.toString() === failingProbeId.toString()) {
          return Promise.reject(flipError);
        }
        return Promise.resolve(undefined);
      },
    );

    // The tick itself must not reject (per-probe try/catch).
    await expect(runWorkerTick()).resolves.toBeUndefined();

    // ALL flips were attempted; the failure only logged, tagged with its project.
    const updates: Array<UpdateCallArgs> = updateCalls();

    expect(updates).toHaveLength(3);
    expect(
      updates.map((update: UpdateCallArgs) => {
        return update.id.toString();
      }),
    ).toEqual([
      failingProbeId.toString(),
      survivingProbeId.toString(),
      freshProbeId.toString(),
    ]);
    expect(mockedLogger.error).toHaveBeenCalledWith(flipError, {
      service: "workers",
      projectId: PROJECT_1_ID.toString(),
    });
  });

  test("a candidate row without an id is skipped without a write or an error", async () => {
    const validProbeId: ObjectID = new ObjectID("probe-valid");

    probeService.findBy
      .mockResolvedValueOnce([
        // Defensive: a row that somehow came back id-less must not crash the loop.
        makeProbe({ projectId: PROJECT_1_ID }),
        makeProbe({ id: validProbeId, projectId: PROJECT_1_ID }),
      ])
      .mockResolvedValueOnce([]);

    await runWorkerTick();

    const updates: Array<UpdateCallArgs> = updateCalls();

    expect(updates).toHaveLength(1);
    expect(updates[0]!.id.toString()).toBe(validProbeId.toString());
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  /*
   * The two SELECTs run sequentially, so one probe can appear in BOTH
   * result sets in exactly one case: its connectionStatus is NULL (matches
   * neither notInOrNull filter) and a heartbeat lands between the queries,
   * moving it from stale to fresh. Writing both flips would stamp
   * Disconnected and then Connected in one tick; the connect query ran
   * later, so only its (fresher) verdict may be written.
   */
  test("a probe listed by both queries gets exactly one flip — to Connected", async () => {
    const doubleListedProbeId: ObjectID = new ObjectID("probe-double-listed");
    const staleOnlyProbeId: ObjectID = new ObjectID("probe-stale-only");

    probeService.findBy
      .mockResolvedValueOnce([
        makeProbe({ id: doubleListedProbeId, projectId: PROJECT_1_ID }),
        makeProbe({ id: staleOnlyProbeId, projectId: PROJECT_1_ID }),
      ])
      .mockResolvedValueOnce([
        makeProbe({ id: doubleListedProbeId, projectId: PROJECT_1_ID }),
      ]);

    await runWorkerTick();

    const updates: Array<UpdateCallArgs> = updateCalls();
    expect(updates).toHaveLength(2);

    const doubleListedUpdates: Array<UpdateCallArgs> = updates.filter(
      (update: UpdateCallArgs) => {
        return update.id.toString() === doubleListedProbeId.toString();
      },
    );
    expect(doubleListedUpdates).toHaveLength(1);
    expect(doubleListedUpdates[0]!.data).toEqual({
      connectionStatus: ProbeConnectionStatus.Connected,
    });

    // The genuinely stale probe still gets its Disconnected flip.
    const staleUpdates: Array<UpdateCallArgs> = updates.filter(
      (update: UpdateCallArgs) => {
        return update.id.toString() === staleOnlyProbeId.toString();
      },
    );
    expect(staleUpdates).toHaveLength(1);
    expect(staleUpdates[0]!.data).toEqual({
      connectionStatus: ProbeConnectionStatus.Disconnected,
    });
  });
});
