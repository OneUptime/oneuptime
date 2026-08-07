import ObjectID from "../../../Types/ObjectID";

/*
 * Active-monitoring boundaries share the same per-monitor mutex as ordinary
 * status writes. These tests replace database and semaphore I/O with spies so
 * they can pin the race-sensitive contract directly:
 *
 * - pause/resume timestamps are clamped instead of producing inverted or
 *   overlapping intervals,
 * - reconciliation reads the live monitor state while holding the mutex and
 *   rejects stale rapid-toggle hooks,
 * - an in-flight ordinary status create cannot reopen a disabled interval,
 * - same-value retries still repair a boundary, and only the IDs actually
 *   updated by DatabaseService are reconciled, and
 * - acquired locks are released on every database failure path.
 */

const lockMock: jest.Mock = jest.fn();
const releaseMock: jest.Mock = jest.fn();

jest.mock("../../../Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: {
      lock: (...args: Array<unknown>) => {
        return lockMock(...args);
      },
      release: (...args: Array<unknown>) => {
        return releaseMock(...args);
      },
    },
  };
});

import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import DatabaseService from "../../../Server/Services/DatabaseService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusTimelineService, {
  ActiveMonitoringTimelineReconciliationResult,
  MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE,
} from "../../../Server/Services/MonitorStatusTimelineService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import UpdateOneBy from "../../../Server/Types/Database/UpdateOneBy";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import ServerException from "../../../Types/Exception/ServerException";

const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_MONITOR_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const STATUS_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const OTHER_TIMELINE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

const STARTED_AT: Date = new Date("2026-07-30T08:00:00.000Z");
const CLOSED_AT: Date = new Date("2026-07-30T11:00:00.000Z");
const PAUSED_AT: Date = new Date("2026-07-30T12:00:00.000Z");
const FUTURE_START_AT: Date = new Date("2026-07-30T13:00:00.000Z");
const RESUMED_AT: Date = new Date("2026-07-30T16:00:00.000Z");
const FUTURE_END_AT: Date = new Date("2026-07-30T18:00:00.000Z");
const TRANSITION_AT: Date = new Date("2026-07-31T09:30:00.000Z");
const FLIPPED_AT: Date = new Date("2026-07-31T09:30:01.000Z");
const PRIOR_STATE_AT: Date = new Date("2026-07-31T09:00:00.000Z");

const fakeMutex: { id: string } = { id: "active-monitoring-mutex" };

interface MakeTimelineOptions {
  endsAt?: Date | null;
  id?: ObjectID;
  monitorId?: ObjectID;
  omitId?: boolean;
  omitMonitorId?: boolean;
  omitStartsAt?: boolean;
  startsAt?: Date;
}

const makeTimeline: (options?: MakeTimelineOptions) => MonitorStatusTimeline = (
  options?: MakeTimelineOptions,
): MonitorStatusTimeline => {
  const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();

  if (!options?.omitId) {
    timeline.id = options?.id || TIMELINE_ID;
  }
  if (!options?.omitMonitorId) {
    timeline.monitorId = options?.monitorId || MONITOR_ID;
  }

  timeline.projectId = PROJECT_ID;
  timeline.monitorStatusId = STATUS_ID;

  if (!options?.omitStartsAt) {
    timeline.startsAt = options?.startsAt || STARTED_AT;
  }

  if (options?.endsAt instanceof Date) {
    timeline.endsAt = options.endsAt;
  } else if (options?.endsAt === null) {
    Reflect.set(timeline, "endsAt", null);
  }

  return timeline;
};

interface MakeMonitorOptions {
  disabled?: boolean;
  monitorId?: ObjectID;
  omitProjectId?: boolean;
  omitStatusId?: boolean;
  updatedAt?: Date;
}

const makeMonitor: (options?: MakeMonitorOptions) => Monitor = (
  options?: MakeMonitorOptions,
): Monitor => {
  const monitor: Monitor = new Monitor();

  monitor.id = options?.monitorId || MONITOR_ID;
  if (!options?.omitProjectId) {
    monitor.projectId = PROJECT_ID;
  }
  if (!options?.omitStatusId) {
    monitor.currentMonitorStatusId = STATUS_ID;
  }
  monitor.disableActiveMonitoring = options?.disabled === true;
  if (options?.updatedAt) {
    monitor.updatedAt = options.updatedAt;
  }

  return monitor;
};

const makeMonitorUpdate: (
  disableActiveMonitoring?: boolean,
) => UpdateBy<Monitor> = (
  disableActiveMonitoring?: boolean,
): UpdateBy<Monitor> => {
  const data: Monitor = new Monitor();

  if (typeof disableActiveMonitoring === "boolean") {
    data.disableActiveMonitoring = disableActiveMonitoring;
  } else {
    data.name = "Renamed monitor";
  }

  return {
    query: {
      _id: MONITOR_ID.toString(),
    },
    data: data,
    limit: 1,
    skip: 0,
    props: {
      tenantId: PROJECT_ID,
      isRoot: true,
    },
  } as unknown as UpdateBy<Monitor>;
};

const makeMonitorUpdateOne: (
  disableActiveMonitoring?: boolean,
) => UpdateOneBy<Monitor> = (
  disableActiveMonitoring?: boolean,
): UpdateOneBy<Monitor> => {
  const updateBy: UpdateBy<Monitor> = makeMonitorUpdate(
    disableActiveMonitoring,
  );

  return {
    query: updateBy.query,
    data: updateBy.data,
    props: updateBy.props,
  };
};

interface MonitorPreviousActiveState {
  currentMonitorStatusId?: ObjectID | undefined;
  projectId?: ObjectID | undefined;
  stateUpdatedAt: Date;
  wasDisabled: boolean;
}

interface MonitorUpdateCarryForward {
  activeMonitoringTimelineTransitionAt: Date;
  activeMonitoringPreviousStateByMonitorId: Record<
    string,
    MonitorPreviousActiveState
  >;
}

interface MonitorActiveMonitoringHookAccess {
  onBeforeUpdate(updateBy: UpdateBy<Monitor>): Promise<OnUpdate<Monitor>>;
  updateActiveMonitoringTimeline(
    onUpdate: OnUpdate<Monitor>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<void>;
  onUpdateSuccess(
    onUpdate: OnUpdate<Monitor>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Monitor>>;
}

const monitorHookAccess: MonitorActiveMonitoringHookAccess =
  MonitorService as unknown as MonitorActiveMonitoringHookAccess;

const makeOnUpdate: (data: {
  disableActiveMonitoring?: boolean;
  previousStateByMonitorId?: Record<string, MonitorPreviousActiveState>;
  transitionAt?: Date;
}) => OnUpdate<Monitor> = (data: {
  disableActiveMonitoring?: boolean;
  previousStateByMonitorId?: Record<string, MonitorPreviousActiveState>;
  transitionAt?: Date;
}): OnUpdate<Monitor> => {
  return {
    updateBy: makeMonitorUpdate(data.disableActiveMonitoring),
    carryForward: data.transitionAt
      ? ({
          activeMonitoringTimelineTransitionAt: data.transitionAt,
          activeMonitoringPreviousStateByMonitorId:
            data.previousStateByMonitorId || {},
        } satisfies MonitorUpdateCarryForward)
      : null,
  };
};

const makeTimelineCreateBy: () => CreateBy<MonitorStatusTimeline> =
  (): CreateBy<MonitorStatusTimeline> => {
    const timeline: MonitorStatusTimeline = makeTimeline({
      omitId: true,
      startsAt: STARTED_AT,
    });

    return {
      data: timeline,
      props: {
        isRoot: true,
      },
    };
  };

const expectSharedMutex: () => void = (): void => {
  expect(lockMock).toHaveBeenCalledWith({
    key: MONITOR_ID.toString(),
    namespace: "MonitorStatusTimeline.create",
  });
};

describe("MonitorStatusTimelineService pause and resume boundaries", () => {
  let findTimelineSpy: jest.SpyInstance;
  let updateTimelineSpy: jest.SpyInstance;
  let superCreateSpy: jest.SpyInstance;
  let createdTimeline: MonitorStatusTimeline;

  beforeEach(() => {
    lockMock.mockReset();
    releaseMock.mockReset();
    lockMock.mockResolvedValue(fakeMutex);
    releaseMock.mockResolvedValue(undefined);

    findTimelineSpy = jest
      .spyOn(MonitorStatusTimelineService, "findOneBy")
      .mockResolvedValue(null);
    updateTimelineSpy = jest
      .spyOn(MonitorStatusTimelineService, "updateOneBy")
      .mockResolvedValue(1);
    createdTimeline = makeTimeline({ startsAt: RESUMED_AT });
    superCreateSpy = jest
      .spyOn(DatabaseService.prototype, "create")
      .mockResolvedValue(createdTimeline);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("pauses an open interval under the shared mutex", async () => {
    findTimelineSpy
      .mockResolvedValueOnce(makeTimeline())
      .mockResolvedValueOnce(null);

    await expect(
      MonitorStatusTimelineService.pauseActiveMonitoring({
        monitorId: MONITOR_ID,
        pausedAt: PAUSED_AT,
      }),
    ).resolves.toBe(true);

    expectSharedMutex();
    const findRequest: FindOneBy<MonitorStatusTimeline> = findTimelineSpy.mock
      .calls[0]![0] as FindOneBy<MonitorStatusTimeline>;
    expect(findRequest).toMatchObject({
      query: { monitorId: MONITOR_ID },
      select: { _id: true, startsAt: true, endsAt: true },
      sort: { startsAt: SortOrder.Descending },
      props: { isRoot: true },
    });
    expect(findRequest.query.startsAt).toBeDefined();
    expect(findRequest.query.endsAt).toBeDefined();

    const updateRequest: UpdateOneBy<MonitorStatusTimeline> = updateTimelineSpy
      .mock.calls[0]![0] as UpdateOneBy<MonitorStatusTimeline>;
    expect(updateRequest.query).toMatchObject({
      _id: TIMELINE_ID.toString(),
    });
    expect(updateRequest.query.endsAt).toBeDefined();
    expect(updateRequest.query.startsAt).toBeDefined();
    expect(updateRequest.data).toEqual({ endsAt: PAUSED_AT });
    expect(updateRequest.props).toEqual({ isRoot: true });
    expect(lockMock.mock.invocationCallOrder[0]!).toBeLessThan(
      findTimelineSpy.mock.invocationCallOrder[0]!,
    );
    expect(updateTimelineSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      releaseMock.mock.invocationCallOrder[0]!,
    );
    expect(findTimelineSpy).toHaveBeenCalledTimes(2);
  });

  it("shortens the boundary interval and closes a newer open row from a late status write", async () => {
    const closedPredecessor: MonitorStatusTimeline = makeTimeline({
      endsAt: FUTURE_START_AT,
    });
    const newerOpenTimeline: MonitorStatusTimeline = makeTimeline({
      id: OTHER_TIMELINE_ID,
      startsAt: FUTURE_START_AT,
    });

    findTimelineSpy
      .mockResolvedValueOnce(closedPredecessor)
      .mockResolvedValueOnce(newerOpenTimeline);

    await expect(
      MonitorStatusTimelineService.pauseActiveMonitoring({
        monitorId: MONITOR_ID,
        pausedAt: PAUSED_AT,
      }),
    ).resolves.toBe(true);

    expect(findTimelineSpy).toHaveBeenCalledTimes(2);
    expect(updateTimelineSpy).toHaveBeenCalledTimes(2);

    const boundaryUpdate: UpdateOneBy<MonitorStatusTimeline> = updateTimelineSpy
      .mock.calls[0]![0] as UpdateOneBy<MonitorStatusTimeline>;
    const lateOpenUpdate: UpdateOneBy<MonitorStatusTimeline> = updateTimelineSpy
      .mock.calls[1]![0] as UpdateOneBy<MonitorStatusTimeline>;

    expect(boundaryUpdate.query).toMatchObject({
      _id: TIMELINE_ID.toString(),
    });
    expect(boundaryUpdate.data).toEqual({ endsAt: PAUSED_AT });
    expect(lateOpenUpdate.query).toMatchObject({
      _id: OTHER_TIMELINE_ID.toString(),
    });
    expect(lateOpenUpdate.data).toEqual({ endsAt: FUTURE_START_AT });
  });

  it("clamps a future start to a zero-duration interval", async () => {
    findTimelineSpy
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeTimeline({ startsAt: FUTURE_START_AT }));

    await expect(
      MonitorStatusTimelineService.pauseActiveMonitoring({
        monitorId: MONITOR_ID,
        pausedAt: PAUSED_AT,
      }),
    ).resolves.toBe(true);

    const updateRequest: UpdateOneBy<MonitorStatusTimeline> = updateTimelineSpy
      .mock.calls[0]![0] as UpdateOneBy<MonitorStatusTimeline>;
    expect(updateRequest.data).toEqual({ endsAt: FUTURE_START_AT });
    expect(updateRequest.query.startsAt).toBeDefined();
    expect(findTimelineSpy).toHaveBeenCalledTimes(2);
    const boundaryRequest: FindOneBy<MonitorStatusTimeline> = findTimelineSpy
      .mock.calls[0]![0] as FindOneBy<MonitorStatusTimeline>;
    const openRequest: FindOneBy<MonitorStatusTimeline> = findTimelineSpy.mock
      .calls[1]![0] as FindOneBy<MonitorStatusTimeline>;
    expect(boundaryRequest.query.startsAt).toBeDefined();
    expect(openRequest.query.startsAt).toBeDefined();
    expect(openRequest.query.endsAt).toBeDefined();
    expect(releaseMock).toHaveBeenCalledWith(fakeMutex);
  });

  it("shortens a boundary interval that ends later in the same second", async () => {
    const pausedAt: Date = new Date("2026-07-30T12:00:00.100Z");
    const endsAt: Date = new Date("2026-07-30T12:00:00.500Z");

    findTimelineSpy
      .mockResolvedValueOnce(makeTimeline({ endsAt: endsAt }))
      .mockResolvedValueOnce(null);

    await expect(
      MonitorStatusTimelineService.pauseActiveMonitoring({
        monitorId: MONITOR_ID,
        pausedAt: pausedAt,
      }),
    ).resolves.toBe(true);

    expect(updateTimelineSpy).toHaveBeenCalledTimes(1);
    const updateRequest: UpdateOneBy<MonitorStatusTimeline> = updateTimelineSpy
      .mock.calls[0]![0] as UpdateOneBy<MonitorStatusTimeline>;
    expect(updateRequest.data).toEqual({ endsAt: pausedAt });
  });

  it("treats an exact endsAt boundary as half-open and still closes a future open row", async () => {
    findTimelineSpy
      .mockResolvedValueOnce(makeTimeline({ endsAt: PAUSED_AT }))
      .mockResolvedValueOnce(makeTimeline({ startsAt: FUTURE_START_AT }));

    await expect(
      MonitorStatusTimelineService.pauseActiveMonitoring({
        monitorId: MONITOR_ID,
        pausedAt: PAUSED_AT,
      }),
    ).resolves.toBe(true);

    expect(findTimelineSpy).toHaveBeenCalledTimes(2);
    expect(updateTimelineSpy).toHaveBeenCalledTimes(1);
    const updateRequest: UpdateOneBy<MonitorStatusTimeline> = updateTimelineSpy
      .mock.calls[0]![0] as UpdateOneBy<MonitorStatusTimeline>;
    expect(updateRequest.data).toEqual({ endsAt: FUTURE_START_AT });
  });

  it.each([
    ["there is no timeline", null],
    ["the latest interval has no id", makeTimeline({ omitId: true })],
    ["the latest interval has no start", makeTimeline({ omitStartsAt: true })],
  ])(
    "does not write when %s",
    async (_label: string, latest: MonitorStatusTimeline | null) => {
      findTimelineSpy.mockResolvedValue(latest);

      await expect(
        MonitorStatusTimelineService.pauseActiveMonitoring({
          monitorId: MONITOR_ID,
          pausedAt: PAUSED_AT,
        }),
      ).resolves.toBe(false);

      expect(updateTimelineSpy).not.toHaveBeenCalled();
      expect(releaseMock).toHaveBeenCalledWith(fakeMutex);
    },
  );

  it("returns false when no interval covers the boundary and no open row remains", async () => {
    findTimelineSpy.mockResolvedValue(null);

    await expect(
      MonitorStatusTimelineService.pauseActiveMonitoring({
        monitorId: MONITOR_ID,
        pausedAt: PAUSED_AT,
      }),
    ).resolves.toBe(false);

    expect(findTimelineSpy).toHaveBeenCalledTimes(2);
    expect(updateTimelineSpy).not.toHaveBeenCalled();
    expect(releaseMock).toHaveBeenCalledWith(fakeMutex);
  });

  it("shortens an already-closed predecessor when a late zero-duration row left no open interval", async () => {
    const closedPredecessor: MonitorStatusTimeline = makeTimeline({
      endsAt: FUTURE_START_AT,
    });
    const lateZeroDurationRow: MonitorStatusTimeline = makeTimeline({
      startsAt: FUTURE_START_AT,
      endsAt: FUTURE_START_AT,
    });

    expect(lateZeroDurationRow.startsAt).toEqual(lateZeroDurationRow.endsAt);
    findTimelineSpy
      .mockResolvedValueOnce(closedPredecessor)
      // This row is closed, so the open-row fallback must never select it.
      .mockResolvedValueOnce(lateZeroDurationRow);

    await expect(
      MonitorStatusTimelineService.pauseActiveMonitoring({
        monitorId: MONITOR_ID,
        pausedAt: PAUSED_AT,
      }),
    ).resolves.toBe(true);

    expect(findTimelineSpy).toHaveBeenCalledTimes(2);
    const boundaryRequest: FindOneBy<MonitorStatusTimeline> = findTimelineSpy
      .mock.calls[0]![0] as FindOneBy<MonitorStatusTimeline>;
    expect(boundaryRequest.query.startsAt).toBeDefined();
    expect(boundaryRequest.query.endsAt).toBeDefined();
    const updateRequest: UpdateOneBy<MonitorStatusTimeline> = updateTimelineSpy
      .mock.calls[0]![0] as UpdateOneBy<MonitorStatusTimeline>;
    expect(updateRequest.query).toMatchObject({
      _id: TIMELINE_ID.toString(),
    });
    expect(updateRequest.query.startsAt).toBeDefined();
    expect(updateRequest.query.endsAt).toBeDefined();
    expect(updateRequest.data).toEqual({ endsAt: PAUSED_AT });
    expect(releaseMock).toHaveBeenCalledWith(fakeMutex);
  });

  it("does not stretch an older orphan open row to the disable boundary", async () => {
    const boundaryTimeline: MonitorStatusTimeline = makeTimeline({
      startsAt: new Date("2026-07-30T10:00:00.000Z"),
    });
    const olderOrphan: MonitorStatusTimeline = makeTimeline({
      id: OTHER_TIMELINE_ID,
      startsAt: STARTED_AT,
    });

    findTimelineSpy
      .mockResolvedValueOnce(boundaryTimeline)
      // Defensive return: the real query excludes starts before pausedAt.
      .mockResolvedValueOnce(olderOrphan);

    await expect(
      MonitorStatusTimelineService.pauseActiveMonitoring({
        monitorId: MONITOR_ID,
        pausedAt: PAUSED_AT,
      }),
    ).resolves.toBe(true);

    expect(updateTimelineSpy).toHaveBeenCalledTimes(1);
    expect(updateTimelineSpy.mock.calls[0]![0]).toMatchObject({
      query: { _id: TIMELINE_ID.toString() },
      data: { endsAt: PAUSED_AT },
    });
    const openRequest: FindOneBy<MonitorStatusTimeline> = findTimelineSpy.mock
      .calls[1]![0] as FindOneBy<MonitorStatusTimeline>;
    expect(openRequest.query.startsAt).toBeDefined();
  });

  it("reports a lost compare-and-update race without leaving the lock held", async () => {
    findTimelineSpy
      .mockResolvedValueOnce(makeTimeline())
      .mockResolvedValueOnce(null);
    updateTimelineSpy.mockResolvedValue(0);

    await expect(
      MonitorStatusTimelineService.pauseActiveMonitoring({
        monitorId: MONITOR_ID,
        pausedAt: PAUSED_AT,
      }),
    ).resolves.toBe(false);

    expect(updateTimelineSpy).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledWith(fakeMutex);
  });

  it("resumes the current status directly after a closed gap", async () => {
    findTimelineSpy.mockResolvedValue(makeTimeline({ endsAt: CLOSED_AT }));

    await expect(
      MonitorStatusTimelineService.resumeActiveMonitoring({
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
        monitorStatusId: STATUS_ID,
        resumedAt: RESUMED_AT,
      }),
    ).resolves.toBe(createdTimeline);

    expectSharedMutex();
    const createRequest: CreateBy<MonitorStatusTimeline> = superCreateSpy.mock
      .calls[0]![0] as CreateBy<MonitorStatusTimeline>;
    expect(createRequest.data).toMatchObject({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      monitorStatusId: STATUS_ID,
      startsAt: RESUMED_AT,
      isOwnerNotified: true,
    });
    expect(createRequest.data.endsAt).toBeUndefined();
    expect(createRequest.props).toEqual({ isRoot: true, ignoreHooks: true });
    expect(lockMock).toHaveBeenCalledTimes(1);
    expect(superCreateSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      releaseMock.mock.invocationCallOrder[0]!,
    );
  });

  it("creates the first observed interval when no predecessor exists", async () => {
    findTimelineSpy.mockResolvedValue(null);

    await expect(
      MonitorStatusTimelineService.resumeActiveMonitoring({
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
        monitorStatusId: STATUS_ID,
        resumedAt: RESUMED_AT,
      }),
    ).resolves.toBe(createdTimeline);

    expect(superCreateSpy).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledWith(fakeMutex);
  });

  it("does not resume when the latest interval is already open", async () => {
    findTimelineSpy.mockResolvedValue(makeTimeline());

    await expect(
      MonitorStatusTimelineService.resumeActiveMonitoring({
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
        monitorStatusId: STATUS_ID,
        resumedAt: RESUMED_AT,
      }),
    ).resolves.toBeNull();

    expect(superCreateSpy).not.toHaveBeenCalled();
    expect(releaseMock).toHaveBeenCalledWith(fakeMutex);
  });

  it.each([
    {
      label: "overlapping predecessor end",
      startsAt: new Date("2026-07-30T15:00:00.000Z"),
      endsAt: new Date("2026-07-30T17:00:00.000Z"),
      expectedStart: new Date("2026-07-30T17:00:00.000Z"),
    },
    {
      label: "future closed predecessor",
      startsAt: new Date("2026-07-30T17:00:00.000Z"),
      endsAt: FUTURE_END_AT,
      expectedStart: FUTURE_END_AT,
    },
    {
      label: "equal-start zero-duration predecessor",
      startsAt: RESUMED_AT,
      endsAt: RESUMED_AT,
      expectedStart: new Date("2026-07-30T16:00:00.001Z"),
    },
  ])(
    "clamps resume beyond $label",
    async (data: { startsAt: Date; endsAt: Date; expectedStart: Date }) => {
      findTimelineSpy.mockResolvedValue(
        makeTimeline({ startsAt: data.startsAt, endsAt: data.endsAt }),
      );

      await MonitorStatusTimelineService.resumeActiveMonitoring({
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
        monitorStatusId: STATUS_ID,
        resumedAt: RESUMED_AT,
      });

      const createRequest: CreateBy<MonitorStatusTimeline> = superCreateSpy.mock
        .calls[0]![0] as CreateBy<MonitorStatusTimeline>;
      expect(createRequest.data.startsAt).toEqual(data.expectedStart);
      expect(releaseMock).toHaveBeenCalledWith(fakeMutex);
    },
  );

  it("never moves a resume boundary backward within the same second", async () => {
    const resumedAt: Date = new Date("2026-07-30T16:00:00.900Z");
    findTimelineSpy.mockResolvedValue(
      makeTimeline({
        startsAt: new Date("2026-07-30T16:00:00.500Z"),
        endsAt: new Date("2026-07-30T16:00:00.700Z"),
      }),
    );

    await expect(
      MonitorStatusTimelineService.resumeActiveMonitoring({
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
        monitorStatusId: STATUS_ID,
        resumedAt: resumedAt,
      }),
    ).resolves.toBe(createdTimeline);

    const createRequest: CreateBy<MonitorStatusTimeline> = superCreateSpy.mock
      .calls[0]![0] as CreateBy<MonitorStatusTimeline>;
    expect(createRequest.data.startsAt).toEqual(resumedAt);
  });

  it("fails closed when the mutex cannot be acquired", async () => {
    lockMock.mockRejectedValue(new Error("redis unavailable"));

    const request: Promise<boolean> =
      MonitorStatusTimelineService.pauseActiveMonitoring({
        monitorId: MONITOR_ID,
        pausedAt: PAUSED_AT,
      });

    await expect(request).rejects.toBeInstanceOf(ServerException);
    await expect(request).rejects.toThrow(
      MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE,
    );
    expect(findTimelineSpy).not.toHaveBeenCalled();
    expect(updateTimelineSpy).not.toHaveBeenCalled();
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it("releases and propagates a pause read failure", async () => {
    findTimelineSpy.mockRejectedValue(new Error("timeline read failed"));

    await expect(
      MonitorStatusTimelineService.pauseActiveMonitoring({
        monitorId: MONITOR_ID,
        pausedAt: PAUSED_AT,
      }),
    ).rejects.toThrow("timeline read failed");

    expect(releaseMock).toHaveBeenCalledWith(fakeMutex);
  });

  it("releases and propagates a pause write failure", async () => {
    findTimelineSpy.mockResolvedValue(makeTimeline());
    updateTimelineSpy.mockRejectedValue(new Error("timeline update failed"));

    await expect(
      MonitorStatusTimelineService.pauseActiveMonitoring({
        monitorId: MONITOR_ID,
        pausedAt: PAUSED_AT,
      }),
    ).rejects.toThrow("timeline update failed");

    expect(releaseMock).toHaveBeenCalledWith(fakeMutex);
  });

  it("releases and propagates a resume insert failure", async () => {
    findTimelineSpy.mockResolvedValue(makeTimeline({ endsAt: CLOSED_AT }));
    superCreateSpy.mockRejectedValue(new Error("timeline insert failed"));

    await expect(
      MonitorStatusTimelineService.resumeActiveMonitoring({
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
        monitorStatusId: STATUS_ID,
        resumedAt: RESUMED_AT,
      }),
    ).rejects.toThrow("timeline insert failed");

    expect(releaseMock).toHaveBeenCalledWith(fakeMutex);
  });

  it("does not mask a successful write when releasing the mutex fails", async () => {
    findTimelineSpy.mockResolvedValue(makeTimeline());
    releaseMock.mockRejectedValue(new Error("release failed"));

    await expect(
      MonitorStatusTimelineService.pauseActiveMonitoring({
        monitorId: MONITOR_ID,
        pausedAt: PAUSED_AT,
      }),
    ).resolves.toBe(true);
  });
});

describe("MonitorStatusTimelineService live-state reconciliation", () => {
  let findMonitorSpy: jest.SpyInstance;
  let findTimelineSpy: jest.SpyInstance;
  let updateTimelineSpy: jest.SpyInstance;
  let superCreateSpy: jest.SpyInstance;

  beforeEach(() => {
    lockMock.mockReset();
    releaseMock.mockReset();
    lockMock.mockResolvedValue(fakeMutex);
    releaseMock.mockResolvedValue(undefined);

    findMonitorSpy = jest
      .spyOn(MonitorService, "findOneBy")
      .mockResolvedValue(null);
    findTimelineSpy = jest
      .spyOn(MonitorStatusTimelineService, "findOneBy")
      .mockResolvedValue(null);
    updateTimelineSpy = jest
      .spyOn(MonitorStatusTimelineService, "updateOneBy")
      .mockResolvedValue(1);
    superCreateSpy = jest
      .spyOn(DatabaseService.prototype, "create")
      .mockResolvedValue(makeTimeline({ startsAt: FLIPPED_AT }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads live disabled state under the shared lock and closes the interval", async () => {
    findMonitorSpy.mockResolvedValue(makeMonitor({ disabled: true }));
    findTimelineSpy.mockResolvedValue(makeTimeline());

    const result: ActiveMonitoringTimelineReconciliationResult =
      await MonitorStatusTimelineService.reconcileActiveMonitoring({
        monitorId: MONITOR_ID,
        expectedDisableActiveMonitoring: true,
        reconciledAt: TRANSITION_AT,
      });

    expect(result).toEqual({
      didPause: true,
      didResume: false,
      monitorWasFound: true,
      stateMatchedExpectation: true,
    });
    expectSharedMutex();
    expect(findMonitorSpy).toHaveBeenCalledTimes(2);
    expect(findMonitorSpy.mock.calls[0]![0]).toEqual({
      query: { _id: MONITOR_ID.toString() },
      select: {
        _id: true,
        projectId: true,
        currentMonitorStatusId: true,
        disableActiveMonitoring: true,
        updatedAt: true,
      },
      props: { isRoot: true, ignoreHooks: true },
    });
    expect(lockMock.mock.invocationCallOrder[0]!).toBeLessThan(
      findMonitorSpy.mock.invocationCallOrder[0]!,
    );
    expect(findMonitorSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      findTimelineSpy.mock.invocationCallOrder[0]!,
    );
    expect(updateTimelineSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      findMonitorSpy.mock.invocationCallOrder[1]!,
    );
    expect(findMonitorSpy.mock.invocationCallOrder[1]!).toBeLessThan(
      releaseMock.mock.invocationCallOrder[0]!,
    );
  });

  it("uses the monitor's persisted save time for each bulk-update boundary", async () => {
    findMonitorSpy.mockResolvedValue(
      makeMonitor({ disabled: true, updatedAt: FLIPPED_AT }),
    );
    findTimelineSpy.mockResolvedValue(makeTimeline());

    await MonitorStatusTimelineService.reconcileActiveMonitoring({
      monitorId: MONITOR_ID,
      expectedDisableActiveMonitoring: true,
      reconciledAt: TRANSITION_AT,
    });

    expect(updateTimelineSpy).toHaveBeenCalledTimes(1);
    expect(updateTimelineSpy.mock.calls[0]![0].data).toEqual({
      endsAt: FLIPPED_AT,
    });
  });

  it("reconstructs an observed disable before a newer live enable from an old pod", async () => {
    findMonitorSpy.mockResolvedValue(
      makeMonitor({ disabled: false, updatedAt: FLIPPED_AT }),
    );
    findTimelineSpy
      .mockResolvedValueOnce(makeTimeline())
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeTimeline({ endsAt: TRANSITION_AT }));

    await expect(
      MonitorStatusTimelineService.reconcileActiveMonitoring({
        monitorId: MONITOR_ID,
        expectedDisableActiveMonitoring: true,
        reconciledAt: TRANSITION_AT,
      }),
    ).resolves.toEqual({
      didPause: true,
      didResume: true,
      monitorWasFound: true,
      stateMatchedExpectation: false,
    });

    expect(findMonitorSpy).toHaveBeenCalledTimes(2);
    expect(updateTimelineSpy).toHaveBeenCalledTimes(1);
    expect(updateTimelineSpy.mock.calls[0]![0].data).toEqual({
      endsAt: TRANSITION_AT,
    });
    expect(superCreateSpy).toHaveBeenCalledTimes(1);
    const createRequest: CreateBy<MonitorStatusTimeline> = superCreateSpy.mock
      .calls[0]![0] as CreateBy<MonitorStatusTimeline>;
    expect(createRequest.data.startsAt).toEqual(FLIPPED_AT);
    expect(lockMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledWith(fakeMutex);
  });

  it("reconstructs an observed enable before a newer live disable from an old pod", async () => {
    findMonitorSpy.mockResolvedValue(
      makeMonitor({ disabled: true, updatedAt: FLIPPED_AT }),
    );
    findTimelineSpy
      .mockResolvedValueOnce(makeTimeline({ endsAt: PRIOR_STATE_AT }))
      .mockResolvedValueOnce(makeTimeline({ startsAt: TRANSITION_AT }))
      .mockResolvedValueOnce(null);

    await expect(
      MonitorStatusTimelineService.reconcileActiveMonitoring({
        monitorId: MONITOR_ID,
        expectedDisableActiveMonitoring: false,
        reconciledAt: TRANSITION_AT,
      }),
    ).resolves.toEqual({
      didPause: true,
      didResume: true,
      monitorWasFound: true,
      stateMatchedExpectation: false,
    });

    expect(superCreateSpy).toHaveBeenCalledTimes(1);
    const createRequest: CreateBy<MonitorStatusTimeline> = superCreateSpy.mock
      .calls[0]![0] as CreateBy<MonitorStatusTimeline>;
    expect(createRequest.data.startsAt).toEqual(TRANSITION_AT);
    expect(updateTimelineSpy).toHaveBeenCalledTimes(1);
    expect(updateTimelineSpy.mock.calls[0]![0].data).toEqual({
      endsAt: FLIPPED_AT,
    });
    expect(lockMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledWith(fakeMutex);
  });

  it("returns a no-monitor result without touching timeline storage", async () => {
    findMonitorSpy.mockResolvedValue(null);

    await expect(
      MonitorStatusTimelineService.reconcileActiveMonitoring({
        monitorId: MONITOR_ID,
        reconciledAt: TRANSITION_AT,
      }),
    ).resolves.toEqual({
      didPause: false,
      didResume: false,
      monitorWasFound: false,
      stateMatchedExpectation: true,
    });

    expect(findTimelineSpy).not.toHaveBeenCalled();
    expect(releaseMock).toHaveBeenCalledWith(fakeMutex);
  });

  it("closes then resumes when live state flips during reconciliation", async () => {
    findMonitorSpy
      .mockResolvedValueOnce(makeMonitor({ disabled: true }))
      .mockResolvedValueOnce(
        makeMonitor({ disabled: false, updatedAt: FLIPPED_AT }),
      )
      .mockResolvedValueOnce(
        makeMonitor({ disabled: false, updatedAt: FLIPPED_AT }),
      )
      .mockResolvedValueOnce(
        makeMonitor({ disabled: false, updatedAt: FLIPPED_AT }),
      );
    findTimelineSpy
      .mockResolvedValueOnce(makeTimeline())
      .mockResolvedValueOnce(makeTimeline({ endsAt: TRANSITION_AT }));

    const result: ActiveMonitoringTimelineReconciliationResult =
      await MonitorStatusTimelineService.reconcileActiveMonitoring({
        monitorId: MONITOR_ID,
        expectedDisableActiveMonitoring: true,
        reconciledAt: TRANSITION_AT,
      });

    expect(result).toEqual({
      didPause: true,
      didResume: true,
      monitorWasFound: true,
      stateMatchedExpectation: true,
    });
    expect(updateTimelineSpy).toHaveBeenCalledTimes(1);
    expect(updateTimelineSpy.mock.calls[0]![0].data).toEqual({
      endsAt: TRANSITION_AT,
    });
    expect(superCreateSpy).toHaveBeenCalledTimes(1);
    const createRequest: CreateBy<MonitorStatusTimeline> = superCreateSpy.mock
      .calls[0]![0] as CreateBy<MonitorStatusTimeline>;
    expect(createRequest.data.startsAt).toEqual(FLIPPED_AT);
    expect(lockMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(superCreateSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      releaseMock.mock.invocationCallOrder[0]!,
    );
  });

  it("does not synthesize a resumed row when the live enabled monitor lacks status context", async () => {
    findMonitorSpy.mockResolvedValue(
      makeMonitor({ disabled: false, omitProjectId: true, omitStatusId: true }),
    );

    await expect(
      MonitorStatusTimelineService.reconcileActiveMonitoring({
        monitorId: MONITOR_ID,
        expectedDisableActiveMonitoring: false,
        reconciledAt: TRANSITION_AT,
      }),
    ).resolves.toMatchObject({ didPause: false, didResume: false });

    expect(findTimelineSpy).not.toHaveBeenCalled();
    expect(superCreateSpy).not.toHaveBeenCalled();
    expect(releaseMock).toHaveBeenCalledWith(fakeMutex);
  });

  it("releases and propagates a live monitor read failure", async () => {
    findMonitorSpy.mockRejectedValue(new Error("monitor read failed"));

    await expect(
      MonitorStatusTimelineService.reconcileActiveMonitoring({
        monitorId: MONITOR_ID,
        reconciledAt: TRANSITION_AT,
      }),
    ).rejects.toThrow("monitor read failed");

    expect(releaseMock).toHaveBeenCalledWith(fakeMutex);
  });

  it("releases and propagates a reconciliation write failure", async () => {
    findMonitorSpy.mockResolvedValue(makeMonitor({ disabled: true }));
    findTimelineSpy.mockResolvedValue(makeTimeline());
    updateTimelineSpy.mockRejectedValue(new Error("reconcile write failed"));

    await expect(
      MonitorStatusTimelineService.reconcileActiveMonitoring({
        monitorId: MONITOR_ID,
        expectedDisableActiveMonitoring: true,
        reconciledAt: TRANSITION_AT,
      }),
    ).rejects.toThrow("reconcile write failed");

    expect(releaseMock).toHaveBeenCalledWith(fakeMutex);
  });
});

describe("ordinary timeline creates during active-monitoring transitions", () => {
  let superCreateSpy: jest.SpyInstance;
  let feedItemSpy: jest.SpyInstance;
  let findMonitorSpy: jest.SpyInstance;
  let updateTimelineSpy: jest.SpyInstance;
  let createdTimeline: MonitorStatusTimeline;

  beforeEach(() => {
    lockMock.mockReset();
    releaseMock.mockReset();
    lockMock.mockResolvedValue(fakeMutex);
    releaseMock.mockResolvedValue(undefined);

    createdTimeline = makeTimeline({ startsAt: STARTED_AT });
    superCreateSpy = jest
      .spyOn(DatabaseService.prototype, "create")
      .mockResolvedValue(createdTimeline);
    feedItemSpy = jest
      .spyOn(
        MonitorStatusTimelineService as unknown as {
          createStatusChangeFeedItem: () => Promise<void>;
        },
        "createStatusChangeFeedItem",
      )
      .mockResolvedValue(undefined);
    findMonitorSpy = jest
      .spyOn(MonitorService, "findOneBy")
      .mockResolvedValue(makeMonitor({ disabled: false }));
    updateTimelineSpy = jest
      .spyOn(MonitorStatusTimelineService, "updateOneBy")
      .mockResolvedValue(1);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("closes a newly created row at startsAt when the monitor is directly disabled", async () => {
    findMonitorSpy.mockResolvedValue(makeMonitor({ disabled: true }));

    const result: MonitorStatusTimeline =
      await MonitorStatusTimelineService.create(makeTimelineCreateBy());

    expect(result).toBe(createdTimeline);
    expect(result.endsAt).toEqual(STARTED_AT);
    expectSharedMutex();
    expect(findMonitorSpy).toHaveBeenCalledWith({
      query: { _id: MONITOR_ID.toString() },
      select: { _id: true, disableActiveMonitoring: true },
      props: { isRoot: true, ignoreHooks: true },
    });
    const updateRequest: UpdateOneBy<MonitorStatusTimeline> = updateTimelineSpy
      .mock.calls[0]![0] as UpdateOneBy<MonitorStatusTimeline>;
    expect(updateRequest.query).toMatchObject({ _id: TIMELINE_ID.toString() });
    expect(updateRequest.query.endsAt).toBeDefined();
    expect(updateRequest.data).toEqual({ endsAt: STARTED_AT });
    expect(superCreateSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      findMonitorSpy.mock.invocationCallOrder[0]!,
    );
    expect(updateTimelineSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      releaseMock.mock.invocationCallOrder[0]!,
    );
    expect(releaseMock.mock.invocationCallOrder[0]!).toBeLessThan(
      feedItemSpy.mock.invocationCallOrder[0]!,
    );
  });

  it("leaves a newly created row open when the monitor is enabled", async () => {
    findMonitorSpy.mockResolvedValue(makeMonitor({ disabled: false }));

    const result: MonitorStatusTimeline =
      await MonitorStatusTimelineService.create(makeTimelineCreateBy());

    expect(result.endsAt).toBeUndefined();
    expect(updateTimelineSpy).not.toHaveBeenCalled();
    expect(findMonitorSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      releaseMock.mock.invocationCallOrder[0]!,
    );
    expect(feedItemSpy).toHaveBeenCalledTimes(1);
  });

  it("leaves the row open when the monitor disappeared before the live check", async () => {
    findMonitorSpy.mockResolvedValue(null);

    await MonitorStatusTimelineService.create(makeTimelineCreateBy());

    expect(updateTimelineSpy).not.toHaveBeenCalled();
    expect(releaseMock).toHaveBeenCalledWith(fakeMutex);
    expect(feedItemSpy).toHaveBeenCalledTimes(1);
  });

  it("does not mutate the returned row when the conditional close loses a race", async () => {
    findMonitorSpy.mockResolvedValue(makeMonitor({ disabled: true }));
    updateTimelineSpy.mockResolvedValue(0);

    const result: MonitorStatusTimeline =
      await MonitorStatusTimelineService.create(makeTimelineCreateBy());

    expect(result.endsAt).toBeUndefined();
    expect(releaseMock).toHaveBeenCalledWith(fakeMutex);
  });

  it("releases and propagates a disabled-state read failure", async () => {
    findMonitorSpy.mockRejectedValue(new Error("monitor lookup failed"));

    await expect(
      MonitorStatusTimelineService.create(makeTimelineCreateBy()),
    ).rejects.toThrow("monitor lookup failed");

    expect(releaseMock).toHaveBeenCalledWith(fakeMutex);
    expect(feedItemSpy).not.toHaveBeenCalled();
  });

  it("releases and propagates a disabled-row close failure", async () => {
    findMonitorSpy.mockResolvedValue(makeMonitor({ disabled: true }));
    updateTimelineSpy.mockRejectedValue(new Error("close failed"));

    await expect(
      MonitorStatusTimelineService.create(makeTimelineCreateBy()),
    ).rejects.toThrow("close failed");

    expect(releaseMock).toHaveBeenCalledWith(fakeMutex);
    expect(feedItemSpy).not.toHaveBeenCalled();
  });

  it("releases and propagates an ordinary create failure", async () => {
    superCreateSpy.mockRejectedValue(new Error("insert failed"));

    await expect(
      MonitorStatusTimelineService.create(makeTimelineCreateBy()),
    ).rejects.toThrow("insert failed");

    expect(findMonitorSpy).not.toHaveBeenCalled();
    expect(releaseMock).toHaveBeenCalledWith(fakeMutex);
    expect(feedItemSpy).not.toHaveBeenCalled();
  });

  it("fails closed before an ordinary create when locking fails", async () => {
    lockMock.mockRejectedValue(new Error("redis unavailable"));

    await expect(
      MonitorStatusTimelineService.create(makeTimelineCreateBy()),
    ).rejects.toThrow(MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE);

    expect(superCreateSpy).not.toHaveBeenCalled();
    expect(findMonitorSpy).not.toHaveBeenCalled();
    expect(releaseMock).not.toHaveBeenCalled();
  });
});

describe("MonitorService direct active-monitoring update dispatch", () => {
  let currentDateSpy: jest.SpyInstance;
  let findBySpy: jest.SpyInstance;
  let pauseSpy: jest.SpyInstance;
  let reconcileSpy: jest.SpyInstance;
  let resumeSpy: jest.SpyInstance;

  beforeEach(() => {
    currentDateSpy = jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(TRANSITION_AT);
    findBySpy = jest.spyOn(MonitorService, "findBy").mockResolvedValue([]);
    pauseSpy = jest
      .spyOn(MonitorStatusTimelineService, "pauseActiveMonitoring")
      .mockResolvedValue(false);
    resumeSpy = jest
      .spyOn(MonitorStatusTimelineService, "resumeActiveMonitoring")
      .mockResolvedValue(null);
    reconcileSpy = jest
      .spyOn(MonitorStatusTimelineService, "reconcileActiveMonitoring")
      .mockResolvedValue({
        didPause: false,
        didResume: false,
        monitorWasFound: true,
        stateMatchedExpectation: true,
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("captures each scoped monitor's prior flag, status, project, and persisted timestamp", async () => {
    const updateBy: UpdateBy<Monitor> = makeMonitorUpdate(true);
    findBySpy.mockResolvedValue([
      makeMonitor({ disabled: true, updatedAt: PRIOR_STATE_AT }),
      makeMonitor({
        disabled: false,
        monitorId: OTHER_MONITOR_ID,
        updatedAt: FLIPPED_AT,
      }),
    ]);

    const result: OnUpdate<Monitor> =
      await monitorHookAccess.onBeforeUpdate(updateBy);

    expect(result).toEqual({
      updateBy: updateBy,
      carryForward: {
        activeMonitoringTimelineTransitionAt: TRANSITION_AT,
        activeMonitoringPreviousStateByMonitorId: {
          [MONITOR_ID.toString()]: {
            currentMonitorStatusId: STATUS_ID,
            projectId: PROJECT_ID,
            stateUpdatedAt: PRIOR_STATE_AT,
            wasDisabled: true,
          },
          [OTHER_MONITOR_ID.toString()]: {
            currentMonitorStatusId: STATUS_ID,
            projectId: PROJECT_ID,
            stateUpdatedAt: FLIPPED_AT,
            wasDisabled: false,
          },
        },
      },
    });
    expect(currentDateSpy).toHaveBeenCalledTimes(1);
    expect(findBySpy).toHaveBeenCalledTimes(1);
    expect(findBySpy).toHaveBeenCalledWith({
      query: updateBy.query,
      select: {
        _id: true,
        projectId: true,
        currentMonitorStatusId: true,
        disableActiveMonitoring: true,
        updatedAt: true,
      },
      limit: updateBy.limit,
      skip: updateBy.skip,
      props: {
        ...updateBy.props,
        ignoreHooks: true,
      },
    });
  });

  it("does not capture a boundary for an unrelated update", async () => {
    const updateBy: UpdateBy<Monitor> = makeMonitorUpdate();

    await expect(monitorHookAccess.onBeforeUpdate(updateBy)).resolves.toEqual({
      updateBy: updateBy,
      carryForward: null,
    });

    expect(currentDateSpy).not.toHaveBeenCalled();
    expect(findBySpy).not.toHaveBeenCalled();
  });

  it("repairs the original boundary before reconciling a same-value disabled retry", async () => {
    await monitorHookAccess.updateActiveMonitoringTimeline(
      makeOnUpdate({
        disableActiveMonitoring: true,
        previousStateByMonitorId: {
          [MONITOR_ID.toString()]: {
            currentMonitorStatusId: STATUS_ID,
            projectId: PROJECT_ID,
            stateUpdatedAt: PRIOR_STATE_AT,
            wasDisabled: true,
          },
        },
        transitionAt: TRANSITION_AT,
      }),
      [MONITOR_ID],
    );

    expect(pauseSpy).toHaveBeenCalledWith({
      monitorId: MONITOR_ID,
      pausedAt: PRIOR_STATE_AT,
    });
    expect(reconcileSpy).toHaveBeenCalledWith({
      monitorId: MONITOR_ID,
      expectedDisableActiveMonitoring: true,
      reconciledAt: TRANSITION_AT,
    });
    expect(pauseSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      reconcileSpy.mock.invocationCallOrder[0]!,
    );
    expect(resumeSpy).not.toHaveBeenCalled();
    expect(findBySpy).not.toHaveBeenCalled();
  });

  it("recreates the prior interval before reconciling a same-value enabled retry", async () => {
    await monitorHookAccess.updateActiveMonitoringTimeline(
      makeOnUpdate({
        disableActiveMonitoring: false,
        previousStateByMonitorId: {
          [MONITOR_ID.toString()]: {
            currentMonitorStatusId: STATUS_ID,
            projectId: PROJECT_ID,
            stateUpdatedAt: PRIOR_STATE_AT,
            wasDisabled: false,
          },
        },
        transitionAt: TRANSITION_AT,
      }),
      [MONITOR_ID],
    );

    expect(resumeSpy).toHaveBeenCalledWith({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      monitorStatusId: STATUS_ID,
      resumedAt: PRIOR_STATE_AT,
    });
    expect(reconcileSpy).toHaveBeenCalledWith({
      monitorId: MONITOR_ID,
      expectedDisableActiveMonitoring: false,
      reconciledAt: TRANSITION_AT,
    });
    expect(resumeSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      reconcileSpy.mock.invocationCallOrder[0]!,
    );
    expect(pauseSpy).not.toHaveBeenCalled();
  });

  it("reconstructs the original gap when enable follows a disable whose hook failed", async () => {
    await monitorHookAccess.updateActiveMonitoringTimeline(
      makeOnUpdate({
        disableActiveMonitoring: false,
        previousStateByMonitorId: {
          [MONITOR_ID.toString()]: {
            currentMonitorStatusId: STATUS_ID,
            projectId: PROJECT_ID,
            stateUpdatedAt: PRIOR_STATE_AT,
            wasDisabled: true,
          },
        },
        transitionAt: TRANSITION_AT,
      }),
      [MONITOR_ID],
    );

    expect(pauseSpy).toHaveBeenCalledWith({
      monitorId: MONITOR_ID,
      pausedAt: PRIOR_STATE_AT,
    });
    expect(reconcileSpy).toHaveBeenCalledWith({
      monitorId: MONITOR_ID,
      expectedDisableActiveMonitoring: false,
      reconciledAt: TRANSITION_AT,
    });
    expect(pauseSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      reconcileSpy.mock.invocationCallOrder[0]!,
    );
  });

  it("reconstructs the prior enabled interval when disable follows an enable whose hook failed", async () => {
    await monitorHookAccess.updateActiveMonitoringTimeline(
      makeOnUpdate({
        disableActiveMonitoring: true,
        previousStateByMonitorId: {
          [MONITOR_ID.toString()]: {
            currentMonitorStatusId: STATUS_ID,
            projectId: PROJECT_ID,
            stateUpdatedAt: PRIOR_STATE_AT,
            wasDisabled: false,
          },
        },
        transitionAt: TRANSITION_AT,
      }),
      [MONITOR_ID],
    );

    expect(resumeSpy).toHaveBeenCalledWith({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      monitorStatusId: STATUS_ID,
      resumedAt: PRIOR_STATE_AT,
    });
    expect(reconcileSpy).toHaveBeenCalledWith({
      monitorId: MONITOR_ID,
      expectedDisableActiveMonitoring: true,
      reconciledAt: TRANSITION_AT,
    });
    expect(resumeSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      reconcileSpy.mock.invocationCallOrder[0]!,
    );
  });

  it("uses exactly the updated IDs and never re-runs the pre-update query", async () => {
    await monitorHookAccess.updateActiveMonitoringTimeline(
      makeOnUpdate({
        disableActiveMonitoring: true,
        transitionAt: TRANSITION_AT,
      }),
      [OTHER_MONITOR_ID, MONITOR_ID],
    );

    expect(reconcileSpy).toHaveBeenCalledTimes(2);
    expect(
      reconcileSpy.mock.calls.map((call: Array<unknown>) => {
        return call[0];
      }),
    ).toEqual([
      {
        monitorId: OTHER_MONITOR_ID,
        expectedDisableActiveMonitoring: true,
        reconciledAt: TRANSITION_AT,
      },
      {
        monitorId: MONITOR_ID,
        expectedDisableActiveMonitoring: true,
        reconciledAt: TRANSITION_AT,
      },
    ]);
    expect(pauseSpy).not.toHaveBeenCalled();
    expect(resumeSpy).not.toHaveBeenCalled();
    expect(findBySpy).not.toHaveBeenCalled();
  });

  it("does nothing when DatabaseService reports no updated IDs", async () => {
    await monitorHookAccess.updateActiveMonitoringTimeline(
      makeOnUpdate({
        disableActiveMonitoring: true,
        transitionAt: TRANSITION_AT,
      }),
      [],
    );

    expect(reconcileSpy).not.toHaveBeenCalled();
  });

  it("does nothing without a captured transition boundary", async () => {
    await monitorHookAccess.updateActiveMonitoringTimeline(
      makeOnUpdate({ disableActiveMonitoring: true }),
      [MONITOR_ID],
    );

    expect(reconcileSpy).not.toHaveBeenCalled();
  });

  it("ignores indirect incident suppression flag updates", async () => {
    const updateBy: UpdateBy<Monitor> = makeMonitorUpdate();
    updateBy.data.disableActiveMonitoringBecauseOfManualIncident = true;

    await monitorHookAccess.updateActiveMonitoringTimeline(
      {
        updateBy: updateBy,
        carryForward: {
          activeMonitoringTimelineTransitionAt: TRANSITION_AT,
          activeMonitoringPreviousStateByMonitorId: {},
        },
      },
      [MONITOR_ID],
    );

    expect(reconcileSpy).not.toHaveBeenCalled();
  });

  it("propagates reconciliation failures so a committed boundary is not silently lost", async () => {
    reconcileSpy.mockRejectedValue(new Error("reconciliation failed"));

    await expect(
      monitorHookAccess.updateActiveMonitoringTimeline(
        makeOnUpdate({
          disableActiveMonitoring: true,
          transitionAt: TRANSITION_AT,
        }),
        [MONITOR_ID],
      ),
    ).rejects.toThrow("reconciliation failed");
  });

  it("stops before requested-state reconciliation when prior-state restoration fails", async () => {
    pauseSpy.mockRejectedValue(new Error("prior boundary repair failed"));

    await expect(
      monitorHookAccess.updateActiveMonitoringTimeline(
        makeOnUpdate({
          disableActiveMonitoring: false,
          previousStateByMonitorId: {
            [MONITOR_ID.toString()]: {
              currentMonitorStatusId: STATUS_ID,
              projectId: PROJECT_ID,
              stateUpdatedAt: PRIOR_STATE_AT,
              wasDisabled: true,
            },
          },
          transitionAt: TRANSITION_AT,
        }),
        [MONITOR_ID],
      ),
    ).rejects.toThrow("prior boundary repair failed");

    expect(reconcileSpy).not.toHaveBeenCalled();
  });

  it("runs an explicit status change before reconciliation when enabling", async () => {
    const updateBy: UpdateBy<Monitor> = makeMonitorUpdate(false);
    updateBy.data.currentMonitorStatusId = STATUS_ID;
    const dispatchSpy: jest.SpyInstance = jest
      .spyOn(monitorHookAccess, "updateActiveMonitoringTimeline")
      .mockResolvedValue(undefined);
    const changeStatusSpy: jest.SpyInstance = jest
      .spyOn(MonitorService, "changeMonitorStatus")
      .mockResolvedValue(undefined);
    const onUpdate: OnUpdate<Monitor> = {
      updateBy: updateBy,
      carryForward: null,
    };

    await monitorHookAccess.onUpdateSuccess(onUpdate, []);

    expect(changeStatusSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(changeStatusSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      dispatchSpy.mock.invocationCallOrder[0]!,
    );
  });

  it("reconciles disablement before applying a combined explicit status change", async () => {
    const updateBy: UpdateBy<Monitor> = makeMonitorUpdate(true);
    updateBy.data.currentMonitorStatusId = STATUS_ID;
    const dispatchSpy: jest.SpyInstance = jest
      .spyOn(monitorHookAccess, "updateActiveMonitoringTimeline")
      .mockResolvedValue(undefined);
    const changeStatusSpy: jest.SpyInstance = jest
      .spyOn(MonitorService, "changeMonitorStatus")
      .mockResolvedValue(undefined);
    const onUpdate: OnUpdate<Monitor> = {
      updateBy: updateBy,
      carryForward: null,
    };

    await monitorHookAccess.onUpdateSuccess(onUpdate, []);

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(changeStatusSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      changeStatusSpy.mock.invocationCallOrder[0]!,
    );
  });
});

describe("MonitorService active-monitoring transition write lock", () => {
  const firstMonitorMutex: { id: string } = { id: "first-monitor-mutex" };
  const secondMonitorMutex: { id: string } = { id: "second-monitor-mutex" };

  let findBySpy: jest.SpyInstance;
  let superUpdateBySpy: jest.SpyInstance;
  let superUpdateOneBySpy: jest.SpyInstance;

  const getNarrowedMonitorIds: (queryValue: unknown) => Array<string> = (
    queryValue: unknown,
  ): Array<string> => {
    const parameters: Record<string, Array<string>> = (
      queryValue as {
        _objectLiteralParameters: Record<string, Array<string>>;
      }
    )._objectLiteralParameters;

    return Object.values(parameters)[0] || [];
  };

  beforeEach(() => {
    lockMock.mockReset();
    releaseMock.mockReset();
    lockMock.mockResolvedValue(fakeMutex);
    releaseMock.mockResolvedValue(undefined);

    findBySpy = jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([makeMonitor()]);
    superUpdateBySpy = jest
      .spyOn(DatabaseService.prototype, "updateBy")
      .mockResolvedValue(2);
    superUpdateOneBySpy = jest
      .spyOn(DatabaseService.prototype, "updateOneBy")
      .mockResolvedValue(1);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("prefetches exact IDs, locks them in sorted order, narrows the bulk query, and releases in reverse", async () => {
    const updateBy: UpdateBy<Monitor> = makeMonitorUpdate(true);
    updateBy.limit = 10;
    findBySpy.mockResolvedValue([
      makeMonitor({ monitorId: OTHER_MONITOR_ID }),
      makeMonitor({ monitorId: MONITOR_ID }),
      makeMonitor({ monitorId: OTHER_MONITOR_ID }),
    ]);
    lockMock
      .mockReset()
      .mockResolvedValueOnce(firstMonitorMutex)
      .mockResolvedValueOnce(secondMonitorMutex);

    await expect(MonitorService.updateBy(updateBy)).resolves.toBe(2);

    expect(findBySpy).toHaveBeenCalledWith({
      query: updateBy.query,
      select: { _id: true },
      limit: 10,
      skip: 0,
      props: { ...updateBy.props, ignoreHooks: true },
    });
    expect(lockMock.mock.calls).toEqual([
      [
        {
          key: MONITOR_ID.toString(),
          namespace: "Monitor.update",
        },
      ],
      [
        {
          key: OTHER_MONITOR_ID.toString(),
          namespace: "Monitor.update",
        },
      ],
    ]);
    expect(releaseMock.mock.calls).toEqual([
      [secondMonitorMutex],
      [firstMonitorMutex],
    ]);

    const scopedUpdateBy: UpdateBy<Monitor> = superUpdateBySpy.mock
      .calls[0]![0] as UpdateBy<Monitor>;
    expect(scopedUpdateBy.data).toBe(updateBy.data);
    expect(scopedUpdateBy.props).toBe(updateBy.props);
    expect(scopedUpdateBy.limit).toBe(2);
    expect(scopedUpdateBy.skip).toBe(0);
    expect(getNarrowedMonitorIds(scopedUpdateBy.query._id)).toEqual([
      MONITOR_ID.toString(),
      OTHER_MONITOR_ID.toString(),
    ]);

    expect(findBySpy.mock.invocationCallOrder[0]!).toBeLessThan(
      lockMock.mock.invocationCallOrder[0]!,
    );
    expect(lockMock.mock.invocationCallOrder[1]!).toBeLessThan(
      superUpdateBySpy.mock.invocationCallOrder[0]!,
    );
    expect(superUpdateBySpy.mock.invocationCallOrder[0]!).toBeLessThan(
      releaseMock.mock.invocationCallOrder[0]!,
    );
    expect(superUpdateOneBySpy).not.toHaveBeenCalled();
  });

  it("prefetches and narrows a single-row flag write before taking its monitor lock", async () => {
    const updateOneBy: UpdateOneBy<Monitor> = makeMonitorUpdateOne(false);

    await expect(MonitorService.updateOneBy(updateOneBy)).resolves.toBe(1);

    expect(findBySpy).toHaveBeenCalledWith({
      query: updateOneBy.query,
      select: { _id: true },
      limit: 1,
      skip: 0,
      props: { ...updateOneBy.props, ignoreHooks: true },
    });
    expect(lockMock).toHaveBeenCalledWith({
      key: MONITOR_ID.toString(),
      namespace: "Monitor.update",
    });
    const scopedUpdateOneBy: UpdateBy<Monitor> = superUpdateOneBySpy.mock
      .calls[0]![0] as UpdateBy<Monitor>;
    expect(scopedUpdateOneBy.data).toBe(updateOneBy.data);
    expect(scopedUpdateOneBy.limit).toBe(1);
    expect(scopedUpdateOneBy.skip).toBe(0);
    expect(getNarrowedMonitorIds(scopedUpdateOneBy.query._id)).toEqual([
      MONITOR_ID.toString(),
    ]);
    expect(lockMock.mock.invocationCallOrder[0]!).toBeLessThan(
      superUpdateOneBySpy.mock.invocationCallOrder[0]!,
    );
    expect(superUpdateOneBySpy.mock.invocationCallOrder[0]!).toBeLessThan(
      releaseMock.mock.invocationCallOrder[0]!,
    );
    expect(superUpdateBySpy).not.toHaveBeenCalled();
  });

  it("returns zero without locking or writing when the prefetch finds no monitor", async () => {
    findBySpy.mockResolvedValue([]);

    await expect(
      MonitorService.updateBy(makeMonitorUpdate(true)),
    ).resolves.toBe(0);

    expect(findBySpy).toHaveBeenCalledTimes(1);
    expect(lockMock).not.toHaveBeenCalled();
    expect(superUpdateBySpy).not.toHaveBeenCalled();
    expect(superUpdateOneBySpy).not.toHaveBeenCalled();
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it("releases every acquired monitor lock in reverse when the bulk write fails", async () => {
    findBySpy.mockResolvedValue([
      makeMonitor({ monitorId: OTHER_MONITOR_ID }),
      makeMonitor({ monitorId: MONITOR_ID }),
    ]);
    lockMock
      .mockReset()
      .mockResolvedValueOnce(firstMonitorMutex)
      .mockResolvedValueOnce(secondMonitorMutex);
    superUpdateBySpy.mockRejectedValue(new Error("monitor update failed"));

    await expect(
      MonitorService.updateBy(makeMonitorUpdate(true)),
    ).rejects.toThrow("monitor update failed");

    expect(releaseMock.mock.calls).toEqual([
      [secondMonitorMutex],
      [firstMonitorMutex],
    ]);
    expect(superUpdateBySpy.mock.invocationCallOrder[0]!).toBeLessThan(
      releaseMock.mock.invocationCallOrder[0]!,
    );
  });

  it("releases a partial lock set and never writes when later acquisition fails", async () => {
    findBySpy.mockResolvedValue([
      makeMonitor({ monitorId: MONITOR_ID }),
      makeMonitor({ monitorId: OTHER_MONITOR_ID }),
    ]);
    lockMock
      .mockReset()
      .mockResolvedValueOnce(firstMonitorMutex)
      .mockRejectedValueOnce(new Error("transition lock unavailable"));

    await expect(
      MonitorService.updateBy(makeMonitorUpdate(true)),
    ).rejects.toThrow("transition lock unavailable");

    expect(superUpdateOneBySpy).not.toHaveBeenCalled();
    expect(superUpdateBySpy).not.toHaveBeenCalled();
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledWith(firstMonitorMutex);
  });

  it("bypasses transition locking for unrelated bulk and single-row updates", async () => {
    const unrelatedBulk: UpdateBy<Monitor> = makeMonitorUpdate();
    const unrelatedSingle: UpdateOneBy<Monitor> = makeMonitorUpdateOne();

    await expect(MonitorService.updateBy(unrelatedBulk)).resolves.toBe(2);
    await expect(MonitorService.updateOneBy(unrelatedSingle)).resolves.toBe(1);

    expect(superUpdateBySpy).toHaveBeenCalledWith(unrelatedBulk);
    expect(superUpdateOneBySpy).toHaveBeenCalledWith(unrelatedSingle);
    expect(findBySpy).not.toHaveBeenCalled();
    expect(lockMock).not.toHaveBeenCalled();
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it("does not fail a committed monitor write when releasing the transition lock fails", async () => {
    releaseMock.mockRejectedValue(new Error("transition release failed"));

    await expect(
      MonitorService.updateBy(makeMonitorUpdate(true)),
    ).resolves.toBe(2);

    expect(superUpdateBySpy).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledWith(fakeMutex);
  });
});
