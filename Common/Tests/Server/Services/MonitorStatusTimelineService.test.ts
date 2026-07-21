import ObjectID from "../../../Types/ObjectID";

/*
 * These tests pin the ownership of the per-monitor mutex in
 * MonitorStatusTimelineService.create() - the prevention layer that stops new
 * orphaned (endsAt = NULL) timeline rows at the source:
 *
 *   - fail-closed: a lock that cannot be acquired refuses the write with the
 *     exact MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE callers match on,
 *     instead of falling through and inserting unlocked (the original bug),
 *   - release-on-every-path: the mutex is released whether the create
 *     succeeds or throws (a leaked redis-semaphore mutex refreshes its own
 *     key for the life of the process, blocking every later create for the
 *     monitor until acquireTimeout),
 *   - the feed/workspace-notification side effects run only AFTER release,
 *     so third-party HTTP latency (Slack/Teams) can never extend the
 *     critical section,
 *   - the ignoreHooks and missing-monitorId paths skip locking entirely.
 *
 * Semaphore is mocked at the module boundary; DatabaseService.prototype.create
 * is spied so super.create() is observable without a database.
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
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import ServerException from "../../../Types/Exception/ServerException";

const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const STATUS_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

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

describe("MonitorStatusTimelineService.create mutex ownership", () => {
  let superCreateSpy: jest.SpyInstance;
  let feedItemSpy: jest.SpyInstance;
  let createdItem: MonitorStatusTimeline;

  // a unique object standing in for the redis-semaphore mutex.
  const fakeMutex: { id: string } = { id: "fake-mutex" };

  beforeEach(() => {
    lockMock.mockReset();
    releaseMock.mockReset();

    lockMock.mockResolvedValue(fakeMutex);
    releaseMock.mockResolvedValue(undefined);

    createdItem = new MonitorStatusTimeline();
    createdItem.monitorId = MONITOR_ID;
    createdItem.projectId = PROJECT_ID;
    createdItem.monitorStatusId = STATUS_ID;

    /*
     * super.create - everything between lock and release (hooks, validation,
     * the INSERT) is DatabaseService.create's responsibility and is not under
     * test here.
     */
    superCreateSpy = jest
      .spyOn(DatabaseService.prototype, "create")
      .mockResolvedValue(createdItem);

    /*
     * The feed side effect does DB lookups and third-party HTTP; stub it and
     * assert WHEN it runs relative to the release.
     */
    feedItemSpy = jest
      .spyOn(
        MonitorStatusTimelineService as unknown as {
          createStatusChangeFeedItem: () => Promise<void>;
        },
        "createStatusChangeFeedItem",
      )
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    superCreateSpy.mockRestore();
    feedItemSpy.mockRestore();
  });

  it("acquires the per-monitor lock, creates, then releases", async () => {
    const result: MonitorStatusTimeline =
      await MonitorStatusTimelineService.create(makeCreateBy());

    expect(result).toBe(createdItem);

    expect(lockMock).toHaveBeenCalledTimes(1);
    expect(lockMock).toHaveBeenCalledWith({
      key: MONITOR_ID.toString(),
      namespace: "MonitorStatusTimeline.create",
    });

    expect(superCreateSpy).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledWith(fakeMutex);

    // lock -> create -> release, in that order.
    expect(lockMock.mock.invocationCallOrder[0]!).toBeLessThan(
      superCreateSpy.mock.invocationCallOrder[0]!,
    );
    expect(superCreateSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      releaseMock.mock.invocationCallOrder[0]!,
    );
  });

  it("runs the feed side effect only after the mutex is released", async () => {
    await MonitorStatusTimelineService.create(makeCreateBy());

    expect(feedItemSpy).toHaveBeenCalledTimes(1);
    expect(releaseMock.mock.invocationCallOrder[0]!).toBeLessThan(
      feedItemSpy.mock.invocationCallOrder[0]!,
    );
  });

  it("fails closed with the exact lock error message and never inserts unlocked", async () => {
    lockMock.mockRejectedValue(new Error("redis unavailable"));

    await expect(
      MonitorStatusTimelineService.create(makeCreateBy()),
    ).rejects.toThrow(MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE);

    await expect(
      MonitorStatusTimelineService.create(makeCreateBy()),
    ).rejects.toBeInstanceOf(ServerException);

    /*
     * The whole point of fail-closed: the write must NOT happen without the
     * lock. The pre-fix code logged and fell through unlocked, which is what
     * produced permanently orphaned endsAt = NULL rows.
     */
    expect(superCreateSpy).not.toHaveBeenCalled();
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it("releases the mutex when the create itself throws", async () => {
    superCreateSpy.mockRejectedValue(new Error("insert failed"));

    await expect(
      MonitorStatusTimelineService.create(makeCreateBy()),
    ).rejects.toThrow("insert failed");

    // release must run on the throw path - a leaked mutex never expires.
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledWith(fakeMutex);

    // and the feed side effect must not run for a failed create.
    expect(feedItemSpy).not.toHaveBeenCalled();
  });

  it("does not fail a successful create when the release itself fails", async () => {
    releaseMock.mockRejectedValue(new Error("redis blip on release"));

    const result: MonitorStatusTimeline =
      await MonitorStatusTimelineService.create(makeCreateBy());

    expect(result).toBe(createdItem);
    expect(superCreateSpy).toHaveBeenCalledTimes(1);
  });

  it("skips locking entirely when ignoreHooks is set", async () => {
    const result: MonitorStatusTimeline =
      await MonitorStatusTimelineService.create(
        makeCreateBy({ ignoreHooks: true }),
      );

    expect(result).toBe(createdItem);
    expect(lockMock).not.toHaveBeenCalled();
    expect(releaseMock).not.toHaveBeenCalled();
    // no hooks -> no predecessor bookkeeping -> no feed side effect either.
    expect(feedItemSpy).not.toHaveBeenCalled();
  });

  it("skips locking when monitorId is missing and lets onBeforeCreate reject it", async () => {
    await MonitorStatusTimelineService.create(
      makeCreateBy({ omitMonitorId: true }),
    );

    // super.create's onBeforeCreate throws BadDataException for this case.
    expect(lockMock).not.toHaveBeenCalled();
    expect(superCreateSpy).toHaveBeenCalledTimes(1);
  });
});
