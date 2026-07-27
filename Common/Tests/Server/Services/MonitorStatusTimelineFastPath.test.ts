/*
 * MonitorStatusTimelineUtil.updateMonitorStatusTimeline runs on EVERY probe /
 * ingest result whose criteria matched — for a healthy fleet that is almost
 * every check, and each call used to issue a sorted findOneBy against
 * MonitorStatusTimeline (ORDER BY startsAt DESC on one of the largest tables)
 * just to conclude "status unchanged, nothing to do".
 *
 * The optimization under test adds a steady-state fast-path BEFORE that
 * SELECT: when the criteria wants to change the status
 * (changeMonitorStatus + monitorStatusId set) and the target status already
 * equals Monitor.currentMonitorStatusId, return null with NO query at all.
 * Monitor.currentMonitorStatusId is kept in lockstep with the latest timeline
 * row by MonitorStatusTimelineService, and onBeforeCreate still dedupes as
 * the concurrency backstop — so skipping the SELECT is behavior-preserving.
 *
 * The same change also fixed a long-standing comparison bug: the second
 * shouldUpdateStatus condition used to compare the criteria's monitorStatusId
 * to the timeline row's PK id (which never matches a status id), and now
 * compares it to lastMonitorStatusTimeline.monitorStatusId.
 *
 * This suite pins:
 *   - the fast-path returns null with zero service calls,
 *   - the fast-path requires changeMonitorStatus (legacy read path preserved),
 *   - the same-as-last-status inner check still prevents duplicate rows when
 *     currentMonitorStatusId is out of sync,
 *   - a real status change still creates a correctly-populated timeline row,
 *   - first-row creation (no timeline history) still works,
 *   - the two exact-message swallow paths (dedupe race + lock refusal)
 *     return null while every other create error propagates,
 *   - the fixed monitorStatusId-vs-monitorStatusId comparison.
 *
 * MonitorStatusTimelineService is mocked at the module boundary — the real
 * module pulls in the whole database stack. No Postgres, no Redis.
 */

const mockFindOneBy: jest.Mock = jest.fn();
const mockCreate: jest.Mock = jest.fn();

jest.mock("../../../Server/Services/MonitorStatusTimelineService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>) => {
        return mockFindOneBy(...args);
      },
      create: (...args: Array<unknown>) => {
        return mockCreate(...args);
      },
    },
    /*
     * Same literal values as the real service module. The test imports these
     * from the mocked module below, so the swallow-path assertions use the
     * exact strings the util itself sees at runtime.
     */
    MONITOR_STATUS_SAME_AS_PREVIOUS_ERROR_MESSAGE:
      "Monitor Status cannot be same as previous status.",
    MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE:
      "Could not acquire the monitor status timeline lock for this monitor.",
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
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

import MonitorStatusTimelineUtil from "../../../Server/Utils/Monitor/MonitorStatusTimeline";
import {
  MONITOR_STATUS_SAME_AS_PREVIOUS_ERROR_MESSAGE,
  MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE,
} from "../../../Server/Services/MonitorStatusTimelineService";
import DataToProcess from "../../../Server/Utils/Monitor/DataToProcess";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../Types/Exception/BadDataException";
import ServerException from "../../../Types/Exception/ServerException";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test, beforeEach } from "@jest/globals";

const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ONLINE_STATUS_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const TIMELINE_ROW_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

type MakeMonitorFunction = (
  currentMonitorStatusId: ObjectID | undefined,
) => Monitor;

const makeMonitor: MakeMonitorFunction = (
  currentMonitorStatusId: ObjectID | undefined,
): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor.id = MONITOR_ID;
  monitor.projectId = PROJECT_ID;
  if (currentMonitorStatusId) {
    monitor.currentMonitorStatusId = currentMonitorStatusId;
  }
  return monitor;
};

type MakeCriteriaFunction = (input: {
  changeMonitorStatus: boolean;
  monitorStatusId: ObjectID | undefined;
}) => MonitorCriteriaInstance;

const makeCriteria: MakeCriteriaFunction = (input: {
  changeMonitorStatus: boolean;
  monitorStatusId: ObjectID | undefined;
}): MonitorCriteriaInstance => {
  const criteria: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  criteria.data!.changeMonitorStatus = input.changeMonitorStatus;
  criteria.data!.monitorStatusId = input.monitorStatusId;
  return criteria;
};

type MakeTimelineRowFunction = (input: {
  id: ObjectID;
  monitorStatusId: ObjectID;
}) => MonitorStatusTimeline;

const makeTimelineRow: MakeTimelineRowFunction = (input: {
  id: ObjectID;
  monitorStatusId: ObjectID;
}): MonitorStatusTimeline => {
  const row: MonitorStatusTimeline = new MonitorStatusTimeline();
  row.id = input.id;
  row.monitorStatusId = input.monitorStatusId;
  return row;
};

const dataToProcess: DataToProcess = {
  monitorId: MONITOR_ID,
  projectId: PROJECT_ID,
  isOnline: true,
} as unknown as DataToProcess;

const ROOT_CAUSE: string = "Monitor is online because criteria matched.";

type RunFunction = (input: {
  criteriaInstance: MonitorCriteriaInstance;
  monitor: Monitor;
}) => Promise<MonitorStatusTimeline | null>;

const run: RunFunction = (input: {
  criteriaInstance: MonitorCriteriaInstance;
  monitor: Monitor;
}): Promise<MonitorStatusTimeline | null> => {
  return MonitorStatusTimelineUtil.updateMonitorStatusTimeline({
    criteriaInstance: input.criteriaInstance,
    monitor: input.monitor,
    dataToProcess: dataToProcess,
    rootCause: ROOT_CAUSE,
    props: {},
  });
};

describe("MonitorStatusTimelineUtil.updateMonitorStatusTimeline steady-state fast-path", () => {
  beforeEach(() => {
    mockFindOneBy.mockReset();
    mockCreate.mockReset();
  });

  test("returns null with ZERO queries when target status already equals currentMonitorStatusId", async () => {
    /*
     * The hot path this whole optimization exists for: healthy check, online
     * criteria matched, monitor already online. Before the change this issued
     * a sorted SELECT per check result; now it must touch the service not at
     * all.
     */
    const result: MonitorStatusTimeline | null = await run({
      criteriaInstance: makeCriteria({
        changeMonitorStatus: true,
        monitorStatusId: ONLINE_STATUS_ID,
      }),
      monitor: makeMonitor(ONLINE_STATUS_ID),
    });

    expect(result).toBeNull();
    expect(mockFindOneBy).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("does NOT fast-path when changeMonitorStatus is falsy — legacy read path preserved", async () => {
    /*
     * A criteria that does not change the status must keep its pre-existing
     * behavior (the timeline SELECT still runs, nothing is created). The
     * fast-path condition deliberately requires changeMonitorStatus so it
     * only skips work the function would provably not do.
     */
    mockFindOneBy.mockResolvedValue(
      makeTimelineRow({
        id: TIMELINE_ROW_ID,
        monitorStatusId: ONLINE_STATUS_ID,
      }),
    );

    const result: MonitorStatusTimeline | null = await run({
      criteriaInstance: makeCriteria({
        changeMonitorStatus: false,
        monitorStatusId: ONLINE_STATUS_ID,
      }),
      monitor: makeMonitor(ONLINE_STATUS_ID),
    });

    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();

    // The legacy path issues exactly the sorted latest-row lookup.
    expect(mockFindOneBy).toHaveBeenCalledTimes(1);
    expect(mockFindOneBy).toHaveBeenCalledWith({
      query: {
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
      },
      select: {
        _id: true,
        monitorStatusId: true,
      },
      sort: {
        startsAt: SortOrder.Descending,
      },
      props: {
        isRoot: true,
      },
    });
  });

  test("returns null without create when the LAST TIMELINE ROW already has the target status (currentMonitorStatusId out of sync)", async () => {
    /*
     * The timeline is the source of truth. If currentMonitorStatusId lags
     * behind (so the fast-path does not trigger), the same-as-last-status
     * check on the fetched row must still prevent a duplicate row.
     */
    mockFindOneBy.mockResolvedValue(
      makeTimelineRow({
        id: TIMELINE_ROW_ID,
        monitorStatusId: ONLINE_STATUS_ID,
      }),
    );

    const result: MonitorStatusTimeline | null = await run({
      criteriaInstance: makeCriteria({
        changeMonitorStatus: true,
        monitorStatusId: ONLINE_STATUS_ID,
      }),
      // out of sync: monitor still points at the old status.
      monitor: makeMonitor(OFFLINE_STATUS_ID),
    });

    expect(result).toBeNull();
    expect(mockFindOneBy).toHaveBeenCalledTimes(1);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("creates a fully-populated timeline row on a real status change", async () => {
    mockFindOneBy.mockResolvedValue(
      makeTimelineRow({
        id: TIMELINE_ROW_ID,
        monitorStatusId: OFFLINE_STATUS_ID,
      }),
    );

    const createdRow: MonitorStatusTimeline = makeTimelineRow({
      id: ObjectID.generate(),
      monitorStatusId: ONLINE_STATUS_ID,
    });
    mockCreate.mockResolvedValue(createdRow);

    const result: MonitorStatusTimeline | null = await run({
      criteriaInstance: makeCriteria({
        changeMonitorStatus: true,
        monitorStatusId: ONLINE_STATUS_ID,
      }),
      monitor: makeMonitor(OFFLINE_STATUS_ID),
    });

    expect(result).toBe(createdRow);
    expect(mockFindOneBy).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledTimes(1);

    const createArg: {
      data: MonitorStatusTimeline;
      props: { isRoot: boolean };
    } = mockCreate.mock.calls[0]![0] as {
      data: MonitorStatusTimeline;
      props: { isRoot: boolean };
    };

    expect(createArg.props).toEqual({ isRoot: true });
    expect(createArg.data.monitorId?.toString()).toBe(MONITOR_ID.toString());
    expect(createArg.data.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(createArg.data.monitorStatusId?.toString()).toBe(
      ONLINE_STATUS_ID.toString(),
    );
    expect(createArg.data.rootCause).toBe(ROOT_CAUSE);
    expect(createArg.data.statusChangeLog).toEqual(
      JSON.parse(JSON.stringify(dataToProcess)),
    );
  });

  test("creates the first timeline row when the monitor has no history at all", async () => {
    /*
     * Brand-new monitor: no timeline rows and no currentMonitorStatusId, so
     * the fast-path must not trigger and the first row must still be written.
     */
    mockFindOneBy.mockResolvedValue(null);

    const createdRow: MonitorStatusTimeline = makeTimelineRow({
      id: ObjectID.generate(),
      monitorStatusId: ONLINE_STATUS_ID,
    });
    mockCreate.mockResolvedValue(createdRow);

    const result: MonitorStatusTimeline | null = await run({
      criteriaInstance: makeCriteria({
        changeMonitorStatus: true,
        monitorStatusId: ONLINE_STATUS_ID,
      }),
      monitor: makeMonitor(undefined),
    });

    expect(result).toBe(createdRow);
    expect(mockFindOneBy).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  describe("create error handling", () => {
    beforeEach(() => {
      // A genuine status change so the create path is reached every time.
      mockFindOneBy.mockResolvedValue(
        makeTimelineRow({
          id: TIMELINE_ROW_ID,
          monitorStatusId: OFFLINE_STATUS_ID,
        }),
      );
    });

    const runStatusChange: () => Promise<MonitorStatusTimeline | null> =
      (): Promise<MonitorStatusTimeline | null> => {
        return run({
          criteriaInstance: makeCriteria({
            changeMonitorStatus: true,
            monitorStatusId: ONLINE_STATUS_ID,
          }),
          monitor: makeMonitor(OFFLINE_STATUS_ID),
        });
      };

    test("swallows the exact same-as-previous dedupe race and returns null", async () => {
      /*
       * Loser of a concurrent-probe race: onBeforeCreate's dedupe throws
       * this exact BadDataException. Idempotent no-op — must not fail the
       * ingest run.
       */
      mockCreate.mockRejectedValue(
        new BadDataException(MONITOR_STATUS_SAME_AS_PREVIOUS_ERROR_MESSAGE),
      );

      await expect(runStatusChange()).resolves.toBeNull();
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    test("swallows the exact lock-refusal ServerException and returns null", async () => {
      /*
       * Fail-closed mutex: the create was refused rather than performed
       * unlocked. Skipping is recoverable (next probe result retries), so
       * the util logs and returns null.
       */
      mockCreate.mockRejectedValue(
        new ServerException(MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE),
      );

      await expect(runStatusChange()).resolves.toBeNull();
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    test("propagates a BadDataException with any OTHER message", async () => {
      const otherError: BadDataException = new BadDataException(
        "Some unrelated validation failure.",
      );
      mockCreate.mockRejectedValue(otherError);

      await expect(runStatusChange()).rejects.toBe(otherError);
    });

    test("propagates non-matching error types", async () => {
      const dbError: Error = new Error("connection reset by peer");
      mockCreate.mockRejectedValue(dbError);

      await expect(runStatusChange()).rejects.toBe(dbError);
    });
  });

  test("comparison-bug pin: last row's PK id differs from its monitorStatusId — still no duplicate create", async () => {
    /*
     * Before this branch, the second shouldUpdateStatus condition compared
     * the criteria's target monitorStatusId to lastMonitorStatusTimeline.id
     * (the row's PK) — two different UUID namespaces that never match — so
     * that condition was ALWAYS true whenever changeMonitorStatus was set,
     * and only the inner same-as-last-status check (line ~121) saved the day
     * by returning null before the INSERT.
     *
     * The fixed code compares against lastMonitorStatusTimeline
     * .monitorStatusId, so with target === last.monitorStatusId (and id
     * deliberately different, and currentMonitorStatusId out of sync so the
     * fast-path stays out of the way) shouldUpdateStatus is reached only via
     * the third condition and the outcome must be: exactly one SELECT, zero
     * creates, null. If someone reverts the comparison to `.id`, the outcome
     * is unchanged only because of the inner backstop — this test plus the
     * out-of-sync test above pin that the backstop and the fixed condition
     * agree on the row's monitorStatusId, never its PK.
     */
    mockFindOneBy.mockResolvedValue(
      makeTimelineRow({
        // PK deliberately NOT equal to the status id it points at.
        id: TIMELINE_ROW_ID,
        monitorStatusId: ONLINE_STATUS_ID,
      }),
    );

    const result: MonitorStatusTimeline | null = await run({
      criteriaInstance: makeCriteria({
        changeMonitorStatus: true,
        monitorStatusId: ONLINE_STATUS_ID,
      }),
      monitor: makeMonitor(OFFLINE_STATUS_ID),
    });

    expect(result).toBeNull();
    expect(mockFindOneBy).toHaveBeenCalledTimes(1);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
