import ObjectID from "../../../Types/ObjectID";

/*
 * These tests pin the ownership of the per-monitor mutex in
 * MonitorStatusTimelineService - the prevention layer that stops new orphaned
 * (endsAt = NULL) timeline rows at the source. The mutex is the create hooks'
 * (as every state timeline's is): taken in onBeforeCreate, given back in
 * onCreateSuccess once the predecessor is closed and the monitor's status
 * written, or in onCreateError for a create refused or failed after the hook
 * - DatabaseService.create hands that hook what onBeforeCreate handed back.
 *
 *   - fail-closed: a lock that cannot be acquired refuses the write with the
 *     exact MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE callers match on,
 *     instead of falling through and reading/inserting unlocked (the
 *     original bug),
 *   - release-on-every-path: the mutex is given back whether the create
 *     succeeds, is refused by onBeforeCreate itself, or fails after it (a
 *     leaked redis-semaphore mutex refreshes its own key for the life of the
 *     process, refusing every later status change for the monitor),
 *   - the feed/workspace-notification side effects run only AFTER the create
 *     (and so after the release), so third-party HTTP latency (Slack/Teams)
 *     can never extend the critical section,
 *   - the network-site bridge (device stamps + site rollups, which can open
 *     alerts and post their own notifications) ALSO runs only after it, and
 *     before the feed item so a device stamp never waits on Slack; it is
 *     skipped for a row that is already closed (endsAt set),
 *   - the ignoreHooks and missing-monitorId paths take no lock at all.
 *
 * Semaphore is mocked at the module boundary. The whole create pipeline, with
 * a refusal at each step after the hook, is run in
 * StateTimelineLockAndFollowOn.test.ts.
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

import MonitorStatusTimelineService, {
  MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE,
} from "../../../Server/Services/MonitorStatusTimelineService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ServerException from "../../../Types/Exception/ServerException";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const STATUS_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

// The create hooks, which DatabaseService.create runs.
interface MonitorStatusTimelineHooks {
  onBeforeCreate: (
    createBy: CreateBy<MonitorStatusTimeline>,
  ) => Promise<OnCreate<MonitorStatusTimeline>>;
  onCreateSuccess: (
    onCreate: OnCreate<MonitorStatusTimeline>,
    createdItem: MonitorStatusTimeline,
  ) => Promise<MonitorStatusTimeline>;
  onCreateError: (
    error: Exception,
    onCreate?: OnCreate<MonitorStatusTimeline> | undefined,
  ) => Promise<Exception>;
}

const hooks: MonitorStatusTimelineHooks =
  MonitorStatusTimelineService as unknown as MonitorStatusTimelineHooks;

type MakeCreateByFunction = (data?: {
  ignoreHooks?: boolean;
  omitMonitorId?: boolean;
}) => CreateBy<MonitorStatusTimeline>;

const makeCreateBy: MakeCreateByFunction = (data?: {
  ignoreHooks?: boolean;
  omitMonitorId?: boolean;
}): CreateBy<MonitorStatusTimeline> => {
  const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();

  if (!data?.omitMonitorId) {
    timeline.monitorId = MONITOR_ID;
  }

  timeline.projectId = PROJECT_ID;
  timeline.monitorStatusId = STATUS_ID;

  return {
    data: timeline,
    props: {
      isRoot: true,
      ignoreHooks: data?.ignoreHooks || false,
    },
  };
};

describe("MonitorStatusTimelineService's per-monitor mutex", () => {
  let buildOnCreateSpy: jest.SpyInstance;

  // a unique object standing in for the redis-semaphore mutex.
  const fakeMutex: { id: string } = { id: "fake-mutex" };

  beforeEach(() => {
    lockMock.mockReset();
    releaseMock.mockReset();

    lockMock.mockResolvedValue(fakeMutex);
    releaseMock.mockResolvedValue(undefined);

    // The records the change names are the project's.
    stubProjectDirectory({});

    /*
     * The predecessor reads - what the lock serializes - stubbed: the reads
     * themselves are not under test here.
     */
    buildOnCreateSpy = jest
      .spyOn(
        MonitorStatusTimelineService as unknown as {
          buildOnCreate: (
            createBy: CreateBy<MonitorStatusTimeline>,
          ) => Promise<OnCreate<MonitorStatusTimeline>>;
        },
        "buildOnCreate",
      )
      .mockImplementation(
        async (
          createBy: CreateBy<MonitorStatusTimeline>,
        ): Promise<OnCreate<MonitorStatusTimeline>> => {
          return {
            createBy,
            carryForward: {
              statusTimelineBeforeThisStatus: null,
              statusTimelineAfterThisStatus: null,
            },
          };
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("onBeforeCreate takes it", () => {
    it("for the monitor, before it reads the predecessor, and carries it forward", async () => {
      const onCreate: OnCreate<MonitorStatusTimeline> =
        await hooks.onBeforeCreate(makeCreateBy());

      expect(lockMock).toHaveBeenCalledTimes(1);
      expect(lockMock).toHaveBeenCalledWith({
        key: MONITOR_ID.toString(),
        namespace: "MonitorStatusTimeline.create",
      });
      expect(lockMock.mock.invocationCallOrder[0]!).toBeLessThan(
        buildOnCreateSpy.mock.invocationCallOrder[0]!,
      );
      expect(onCreate.carryForward.mutex).toBe(fakeMutex);
      expect(releaseMock).not.toHaveBeenCalled();
    });

    it("fails closed with the exact lock error message and never reads unlocked", async () => {
      lockMock.mockRejectedValue(new Error("redis unavailable"));

      const error: unknown = await hooks
        .onBeforeCreate(makeCreateBy())
        .catch((caught: unknown) => {
          return caught;
        });

      /*
       * The whole point of fail-closed: the write must NOT happen without the
       * lock. The pre-fix code logged and fell through unlocked, which is what
       * produced permanently orphaned endsAt = NULL rows.
       */
      expect(error).toBeInstanceOf(ServerException);
      expect((error as Error).message).toBe(
        MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE,
      );
      expect(buildOnCreateSpy).not.toHaveBeenCalled();
      expect(releaseMock).not.toHaveBeenCalled();
    });

    it("gives it back when the hook itself refuses the change, once the lock is taken", async () => {
      buildOnCreateSpy.mockRejectedValue(
        new BadDataException("Monitor Status cannot be same as next status."),
      );

      await expect(hooks.onBeforeCreate(makeCreateBy())).rejects.toThrow(
        "Monitor Status cannot be same as next status.",
      );

      expect(releaseMock).toHaveBeenCalledTimes(1);
      expect(releaseMock).toHaveBeenCalledWith(fakeMutex);
    });

    it("takes no lock when no monitor is named, and refuses the change", async () => {
      await expect(
        hooks.onBeforeCreate(makeCreateBy({ omitMonitorId: true })),
      ).rejects.toThrow("monitorId is null");

      expect(lockMock).not.toHaveBeenCalled();
    });

    it("takes no lock for a status that is not the project's, and refuses the change", async () => {
      // The project has no monitor status by that id.
      stubProjectDirectory({
        projectId: PROJECT_ID,
        records: { MonitorStatus: [] },
      });

      await expect(hooks.onBeforeCreate(makeCreateBy())).rejects.toThrow(
        "Monitor Status",
      );

      /*
       * Refused before the lock: a bad id holds up none of the monitor's
       * other status changes.
       */
      expect(lockMock).not.toHaveBeenCalled();
      expect(buildOnCreateSpy).not.toHaveBeenCalled();
    });
  });

  describe("onCreateSuccess gives it back", () => {
    let updateMonitor: jest.SpyInstance;

    beforeEach(() => {
      updateMonitor = jest
        .spyOn(MonitorService, "updateOneBy")
        .mockResolvedValue(1 as never);
    });

    it("once the monitor's status is written, and only once", async () => {
      const onCreate: OnCreate<MonitorStatusTimeline> =
        await hooks.onBeforeCreate(makeCreateBy());

      const createdItem: MonitorStatusTimeline = new MonitorStatusTimeline();
      createdItem.monitorId = MONITOR_ID;
      createdItem.projectId = PROJECT_ID;
      createdItem.monitorStatusId = STATUS_ID;

      await hooks.onCreateSuccess(onCreate, createdItem);

      expect(updateMonitor).toHaveBeenCalledTimes(1);
      expect(releaseMock).toHaveBeenCalledTimes(1);
      expect(releaseMock).toHaveBeenCalledWith(fakeMutex);
      expect(updateMonitor.mock.invocationCallOrder[0]!).toBeLessThan(
        releaseMock.mock.invocationCallOrder[0]!,
      );
    });

    it("does not fail a saved change when the release itself fails", async () => {
      releaseMock.mockRejectedValue(new Error("redis blip on release"));

      const onCreate: OnCreate<MonitorStatusTimeline> =
        await hooks.onBeforeCreate(makeCreateBy());

      const createdItem: MonitorStatusTimeline = new MonitorStatusTimeline();
      createdItem.monitorId = MONITOR_ID;
      createdItem.projectId = PROJECT_ID;
      createdItem.monitorStatusId = STATUS_ID;

      await expect(hooks.onCreateSuccess(onCreate, createdItem)).resolves.toBe(
        createdItem,
      );
    });
  });

  describe("onCreateError gives it back", () => {
    it("for a create refused or failed after the hook", async () => {
      const onCreate: OnCreate<MonitorStatusTimeline> =
        await hooks.onBeforeCreate(makeCreateBy());
      const error: Exception = new BadDataException("insert failed");

      await expect(hooks.onCreateError(error, onCreate)).resolves.toBe(error);

      expect(releaseMock).toHaveBeenCalledTimes(1);
      expect(releaseMock).toHaveBeenCalledWith(fakeMutex);
    });

    it("and gives back nothing for a create that failed before the hook took it", async () => {
      const error: Exception = new BadDataException("refused before hooks");

      await expect(hooks.onCreateError(error, undefined)).resolves.toBe(error);

      expect(releaseMock).not.toHaveBeenCalled();
    });
  });
});

describe("MonitorStatusTimelineService.create runs what follows a status change after it", () => {
  let superCreateSpy: jest.SpyInstance;
  let feedItemSpy: jest.SpyInstance;
  let bridgeSpy: jest.SpyInstance;
  let createdItem: MonitorStatusTimeline;

  beforeEach(() => {
    createdItem = new MonitorStatusTimeline();
    createdItem.monitorId = MONITOR_ID;
    createdItem.projectId = PROJECT_ID;
    createdItem.monitorStatusId = STATUS_ID;

    /*
     * super.create - the checks, the hooks (lock, predecessor close, the
     * monitor's status, release) and the INSERT - is DatabaseService.create's
     * and is not under test here.
     */
    superCreateSpy = jest
      .spyOn(DatabaseService.prototype, "create")
      .mockResolvedValue(createdItem);

    /*
     * The feed side effect does DB lookups and third-party HTTP; stub it and
     * assert WHEN it runs.
     */
    feedItemSpy = jest
      .spyOn(
        MonitorStatusTimelineService as unknown as {
          createStatusChangeFeedItem: () => Promise<void>;
        },
        "createStatusChangeFeedItem",
      )
      .mockResolvedValue(undefined);

    /*
     * The network-site bridge stamps devices and recomputes site rollups
     * through NetworkSiteService (database + possibly workspace HTTP); stub
     * it and assert WHEN it runs relative to the create and the feed item.
     */
    bridgeSpy = jest
      .spyOn(
        MonitorStatusTimelineService as unknown as {
          bridgeCurrentStatusToNetworkSites: () => Promise<void>;
        },
        "bridgeCurrentStatusToNetworkSites",
      )
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("creates, then bridges the new current status, then records it in the feed", async () => {
    const result: MonitorStatusTimeline =
      await MonitorStatusTimelineService.create(makeCreateBy());

    expect(result).toBe(createdItem);
    expect(superCreateSpy).toHaveBeenCalledTimes(1);
    expect(bridgeSpy).toHaveBeenCalledTimes(1);
    expect(feedItemSpy).toHaveBeenCalledTimes(1);

    const bridgeArgs: {
      projectId: ObjectID | undefined;
      monitorId: ObjectID;
      monitorStatusId: ObjectID;
    } = bridgeSpy.mock.calls[0]![0];

    // It bridges the created row's own ids, not something re-read later.
    expect(bridgeArgs.monitorId.toString()).toBe(MONITOR_ID.toString());
    expect(bridgeArgs.monitorStatusId.toString()).toBe(STATUS_ID.toString());
    expect(bridgeArgs.projectId?.toString()).toBe(PROJECT_ID.toString());

    /*
     * create -> bridge -> feed item. Neither holds the lock (a slow rollup
     * would refuse concurrent status writes for this monitor), and the
     * bridge does not queue behind the feed item's Slack / Teams round trip.
     */
    expect(superCreateSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      bridgeSpy.mock.invocationCallOrder[0]!,
    );
    expect(bridgeSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      feedItemSpy.mock.invocationCallOrder[0]!,
    );
  });

  it("does not bridge a row that is already closed (endsAt set)", async () => {
    // A backfilled historical row: onBeforeCreate closed it at the next row's startsAt.
    createdItem.endsAt = new Date("2026-08-01T01:00:00.000Z");

    await MonitorStatusTimelineService.create(makeCreateBy());

    // Not the current status, so no device moves...
    expect(bridgeSpy).not.toHaveBeenCalled();
    // ...but the status change is still recorded in the feed.
    expect(feedItemSpy).toHaveBeenCalledTimes(1);
  });

  it("runs neither for a create that fails", async () => {
    superCreateSpy.mockRejectedValue(new Error("insert failed"));

    await expect(
      MonitorStatusTimelineService.create(makeCreateBy()),
    ).rejects.toThrow("insert failed");

    expect(feedItemSpy).not.toHaveBeenCalled();
    expect(bridgeSpy).not.toHaveBeenCalled();
  });

  it("runs neither when ignoreHooks is set: no current status was moved", async () => {
    const result: MonitorStatusTimeline =
      await MonitorStatusTimelineService.create(
        makeCreateBy({ ignoreHooks: true }),
      );

    expect(result).toBe(createdItem);
    expect(lockMock).not.toHaveBeenCalled();
    expect(feedItemSpy).not.toHaveBeenCalled();
    expect(bridgeSpy).not.toHaveBeenCalled();
  });
});
