/*
 * Contract under test: WHERE a monitor status change is bridged to the
 * network-site rollup engine (NetworkSiteService.onMonitorStatusChanged),
 * which is what stamps a bound NetworkDevice's currentMonitorStatusId and
 * isReachable and refreshes its site chain.
 *
 * The pre-existing bug: the only call to that bridge lived inside
 * MonitorService.changeMonitorStatus. A PROBE result never goes through
 * changeMonitorStatus - it goes MonitorResource ->
 * MonitorStatusTimelineService.create -> onCreateSuccess ->
 * MonitorService.updateOneBy({ currentMonitorStatusId }) with ROOT props,
 * and MonitorService.onUpdateSuccess only calls changeMonitorStatus when
 * props.tenantId is set. So a ping monitor going down moved the monitor's
 * status and left every device bound to it exactly where it was; devices
 * only ever moved on manual, incident and maintenance status changes.
 *
 * What is pinned here:
 *
 *   - MonitorStatusTimelineService.create bridges a NEW CURRENT row (no
 *     endsAt) exactly once, with root props and no tenantId - the probe
 *     path's exact shape - and does not bridge a row that is already closed
 *     (an endsAt: a backfilled historical row that is not the current
 *     status). It bridges AFTER super.create has resolved and the
 *     per-monitor mutex has been released: the bridge stamps every bound
 *     device and recomputes each site chain (alerts, workspace
 *     notifications), and holding the lock across that would refuse
 *     concurrent status writes for the monitor past the semaphore's
 *     acquire timeout,
 *   - onCreateSuccess (which runs UNDER that mutex) writes the monitor's
 *     currentMonitorStatusId and does NOT call the bridge itself,
 *   - onDeleteSuccess bridges the SURVIVING latest status after a row is
 *     deleted,
 *   - MonitorService.refreshMonitorCurrentStatus bridges only when it
 *     actually moved the id,
 *   - changeMonitorStatus no longer calls the bridge itself: its timeline
 *     create reaches MonitorStatusTimelineService.create's bridge, so
 *     keeping both stamped every device twice,
 *   - a bridge that throws never fails the status write it follows.
 *
 * Everything below the service boundary is spied - no database. Semaphore is
 * mocked at the module boundary (as MonitorStatusTimelineService.test.ts
 * does) so create() can run its lock -> super.create -> release -> bridge
 * sequence without Redis.
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

import MonitorStatusTimelineService from "../../../Server/Services/MonitorStatusTimelineService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import MonitorService from "../../../Server/Services/MonitorService";
import NetworkSiteService from "../../../Server/Services/NetworkSiteService";
import logger from "../../../Server/Utils/Logger";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../../../Server/Types/Database/Hooks";
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const ROW_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OPERATIONAL_STATUS_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

// The probe path's props: root, and deliberately NO tenantId.
const ROOT_PROPS: DatabaseCommonInteractionProps = {
  isRoot: true,
};

function fakeTimelineRow(data: {
  monitorStatusId: ObjectID;
  projectId?: ObjectID | undefined;
  endsAt?: Date | undefined;
}): MonitorStatusTimeline {
  const row: MonitorStatusTimeline = new MonitorStatusTimeline();
  row.id = ROW_ID;
  row.monitorId = MONITOR_ID;
  row.monitorStatusId = data.monitorStatusId;
  row.startsAt = new Date("2026-08-01T00:00:00.000Z");
  if (data.projectId) {
    row.projectId = data.projectId;
  }
  if (data.endsAt) {
    row.endsAt = data.endsAt;
  }
  return row;
}

function mockBridge(): jest.SpyInstance {
  return jest
    .spyOn(NetworkSiteService, "onMonitorStatusChanged")
    .mockResolvedValue(undefined as never);
}

function mockMonitorStatusWrite(): jest.SpyInstance {
  return jest.spyOn(MonitorService, "updateOneBy").mockResolvedValue(1);
}

/*
 * Drives the hook exactly as DatabaseService.create does after the INSERT:
 * with the saved row and the createBy that produced it. A first-status
 * carryForward (no predecessor, no successor) keeps the predecessor
 * bookkeeping out of the way - it is not what is under test here.
 */
async function runOnCreateSuccess(data: {
  createdItem: MonitorStatusTimeline;
  createByData?: MonitorStatusTimeline | undefined;
  props?: DatabaseCommonInteractionProps | undefined;
}): Promise<MonitorStatusTimeline> {
  const onCreate: OnCreate<MonitorStatusTimeline> = {
    createBy: {
      data: data.createByData || data.createdItem,
      props: data.props || ROOT_PROPS,
    },
    carryForward: {
      statusTimelineBeforeThisStatus: null,
      statusTimelineAfterThisStatus: null,
    },
  };

  return await (MonitorStatusTimelineService as any).onCreateSuccess(
    onCreate,
    data.createdItem,
  );
}

/*
 * Drives create() exactly as the probe path does - root props, no tenantId -
 * with super.create (DatabaseService.prototype.create: hooks, validation, the
 * INSERT) stubbed to resolve the saved row, and the feed item (DB lookups +
 * Slack/Teams HTTP) stubbed. What is left running is exactly what create()
 * owns: lock -> super.create -> release -> bridge -> feed item.
 */
async function runCreate(data: {
  createdItem: MonitorStatusTimeline;
  createByData?: MonitorStatusTimeline | undefined;
  props?: DatabaseCommonInteractionProps | undefined;
}): Promise<MonitorStatusTimeline> {
  return await MonitorStatusTimelineService.create({
    data: data.createByData || data.createdItem,
    props: data.props || ROOT_PROPS,
  });
}

function expectBridgedOnceWith(
  bridgeSpy: jest.SpyInstance,
  expected: { projectId: ObjectID; monitorStatusId: ObjectID },
): void {
  expect(bridgeSpy).toHaveBeenCalledTimes(1);

  const args: any = bridgeSpy.mock.calls[0]![0];

  expect(args.projectId.toString()).toBe(expected.projectId.toString());
  expect(
    args.monitorIds.map((id: ObjectID) => {
      return id.toString();
    }),
  ).toEqual([MONITOR_ID.toString()]);
  expect(args.monitorStatusId.toString()).toBe(
    expected.monitorStatusId.toString(),
  );
}

describe("MonitorStatusTimelineService.create - the probe path bridge", () => {
  let superCreateSpy: jest.SpyInstance;
  let feedItemSpy: jest.SpyInstance;

  // a unique object standing in for the redis-semaphore mutex.
  const fakeMutex: { id: string } = { id: "fake-mutex" };

  beforeEach(() => {
    lockMock.mockReset();
    releaseMock.mockReset();

    lockMock.mockResolvedValue(fakeMutex);
    releaseMock.mockResolvedValue(undefined);

    superCreateSpy = jest.spyOn(DatabaseService.prototype, "create");

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
    jest.restoreAllMocks();
  });

  /*
   * super.create resolves the saved row. Its hooks (onBeforeCreate /
   * onCreateSuccess) do not run here - they are DatabaseService.create's
   * responsibility and are pinned separately below.
   */
  function stubSuperCreate(createdItem: MonitorStatusTimeline): void {
    superCreateSpy.mockResolvedValue(createdItem);
  }

  it("bridges a new current row exactly once with root props and no tenantId", async () => {
    const bridge: jest.SpyInstance = mockBridge();

    const createdItem: MonitorStatusTimeline = fakeTimelineRow({
      monitorStatusId: OFFLINE_STATUS_ID,
      projectId: PROJECT_ID,
    });
    stubSuperCreate(createdItem);

    const result: MonitorStatusTimeline = await runCreate({
      createdItem: createdItem,
    });

    expect(result).toBe(createdItem);

    /*
     * The probe path's exact shape: root, no tenantId. The create went
     * through the locked path (a monitorId is set), and the bridge fired
     * off the row that was written - not off anything tenant-gated.
     */
    const createArgs: any = superCreateSpy.mock.calls[0]![0];
    expect(createArgs.props.isRoot).toBe(true);
    expect(createArgs.props.tenantId).toBeUndefined();
    expect(lockMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledTimes(1);

    expectBridgedOnceWith(bridge, {
      projectId: PROJECT_ID,
      monitorStatusId: OFFLINE_STATUS_ID,
    });
  });

  it("bridges AFTER super.create has resolved and the mutex is released, and before the feed item", async () => {
    const bridge: jest.SpyInstance = mockBridge();

    stubSuperCreate(
      fakeTimelineRow({
        monitorStatusId: OFFLINE_STATUS_ID,
        projectId: PROJECT_ID,
      }),
    );

    await runCreate({
      createdItem: fakeTimelineRow({
        monitorStatusId: OFFLINE_STATUS_ID,
        projectId: PROJECT_ID,
      }),
    });

    /*
     * super.create -> release -> bridge -> feed item.
     *
     * After super.create: the timeline row and (in onCreateSuccess) the
     * monitor's currentMonitorStatusId are written, and
     * NetworkDeviceService.refreshStampedMonitorStatus (and anything else
     * the rollup reads) derives from Monitor.currentMonitorStatusId, so the
     * bridge must observe the new value, not the old one.
     *
     * After release: the bridge stamps every bound device and recomputes
     * each site chain (alerts, workspace notifications). Under the lock,
     * one slow rollup would make a concurrent status write for the same
     * monitor be REFUSED past the semaphore's acquire timeout.
     *
     * Before the feed item: a device stamp must not wait on Slack/Teams.
     */
    expect(superCreateSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      releaseMock.mock.invocationCallOrder[0]!,
    );
    expect(releaseMock.mock.invocationCallOrder[0]!).toBeLessThan(
      bridge.mock.invocationCallOrder[0]!,
    );
    expect(bridge.mock.invocationCallOrder[0]!).toBeLessThan(
      feedItemSpy.mock.invocationCallOrder[0]!,
    );
  });

  it("does not bridge a row that is already closed (endsAt set)", async () => {
    const bridge: jest.SpyInstance = mockBridge();

    const createdItem: MonitorStatusTimeline = fakeTimelineRow({
      monitorStatusId: OFFLINE_STATUS_ID,
      projectId: PROJECT_ID,
      endsAt: new Date("2026-08-01T01:00:00.000Z"),
    });
    stubSuperCreate(createdItem);

    await runCreate({ createdItem: createdItem });

    // A closed row is history, not the current status: nothing moves.
    expect(bridge).not.toHaveBeenCalled();
    // The lock was still taken and released around the write itself.
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it("does not bridge when super.create throws", async () => {
    const bridge: jest.SpyInstance = mockBridge();
    superCreateSpy.mockRejectedValue(new Error("insert failed"));

    await expect(
      runCreate({
        createdItem: fakeTimelineRow({
          monitorStatusId: OFFLINE_STATUS_ID,
          projectId: PROJECT_ID,
        }),
      }),
    ).rejects.toThrow("insert failed");

    // No row, no status change, nothing to stamp - but the lock is released.
    expect(bridge).not.toHaveBeenCalled();
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the createBy data when the saved row carries no projectId", async () => {
    const bridge: jest.SpyInstance = mockBridge();

    const createdItem: MonitorStatusTimeline = fakeTimelineRow({
      monitorStatusId: OFFLINE_STATUS_ID,
      projectId: undefined,
    });
    const createByData: MonitorStatusTimeline = fakeTimelineRow({
      monitorStatusId: OFFLINE_STATUS_ID,
      projectId: PROJECT_ID,
    });
    stubSuperCreate(createdItem);

    await runCreate({
      createdItem: createdItem,
      createByData: createByData,
    });

    expectBridgedOnceWith(bridge, {
      projectId: PROJECT_ID,
      monitorStatusId: OFFLINE_STATUS_ID,
    });
  });

  it("falls back to props.tenantId when neither the row nor the data has a projectId", async () => {
    const bridge: jest.SpyInstance = mockBridge();

    const createdItem: MonitorStatusTimeline = fakeTimelineRow({
      monitorStatusId: OFFLINE_STATUS_ID,
      projectId: undefined,
    });
    stubSuperCreate(createdItem);

    await runCreate({
      createdItem: createdItem,
      props: {
        isRoot: true,
        tenantId: PROJECT_ID,
      },
    });

    expectBridgedOnceWith(bridge, {
      projectId: PROJECT_ID,
      monitorStatusId: OFFLINE_STATUS_ID,
    });
  });

  it("skips the bridge, with a warning, when no projectId can be resolved at all", async () => {
    const bridge: jest.SpyInstance = mockBridge();
    const warn: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation(() => {
        return undefined;
      });

    const createdItem: MonitorStatusTimeline = fakeTimelineRow({
      monitorStatusId: OFFLINE_STATUS_ID,
      projectId: undefined,
    });
    stubSuperCreate(createdItem);

    const result: MonitorStatusTimeline = await runCreate({
      createdItem: createdItem,
    });

    expect(result).toBe(createdItem);
    expect(bridge).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a bridge that throws does not fail the timeline create", async () => {
    jest
      .spyOn(NetworkSiteService, "onMonitorStatusChanged")
      .mockRejectedValue(new Error("rollup exploded") as never);
    const error: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {
        return undefined;
      });

    const createdItem: MonitorStatusTimeline = fakeTimelineRow({
      monitorStatusId: OFFLINE_STATUS_ID,
      projectId: PROJECT_ID,
    });
    stubSuperCreate(createdItem);

    /*
     * The timeline row and the monitor's current status are already
     * written by the time the bridge runs; a rollup failure surfacing here
     * would turn a persisted status change into a failed probe ingest.
     */
    await expect(runCreate({ createdItem: createdItem })).resolves.toBe(
      createdItem,
    );

    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![0])).toContain("rollup exploded");

    // The failed bridge did not stop the feed item either.
    expect(feedItemSpy).toHaveBeenCalledTimes(1);
  });
});

describe("MonitorStatusTimelineService.onCreateSuccess - writes the monitor, never bridges", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("writes the monitor's current status with the caller's props and leaves the bridge to create()", async () => {
    const monitorWrite: jest.SpyInstance = mockMonitorStatusWrite();
    const bridge: jest.SpyInstance = mockBridge();

    const createdItem: MonitorStatusTimeline = fakeTimelineRow({
      monitorStatusId: OFFLINE_STATUS_ID,
      projectId: PROJECT_ID,
    });

    await expect(
      runOnCreateSuccess({ createdItem: createdItem }),
    ).resolves.toBe(createdItem);

    /*
     * The monitor's current status is written with the caller's props -
     * root, no tenantId - which is precisely the write that never reaches
     * MonitorService.onUpdateSuccess's tenant-gated changeMonitorStatus.
     */
    expect(monitorWrite).toHaveBeenCalledTimes(1);
    const writeArgs: any = monitorWrite.mock.calls[0]![0];
    expect(writeArgs.data.currentMonitorStatusId.toString()).toBe(
      OFFLINE_STATUS_ID.toString(),
    );
    expect(writeArgs.props.isRoot).toBe(true);
    expect(writeArgs.props.tenantId).toBeUndefined();

    /*
     * This hook runs while create() still holds the per-monitor mutex, so
     * the bridge (device stamps, site rollups, alerts, notifications) must
     * NOT run from here: create() runs it right after the release. A bridge
     * call from this hook would put it back under the lock.
     */
    expect(bridge).not.toHaveBeenCalled();
  });

  it("does not write the monitor for a row that is already closed (endsAt set)", async () => {
    const monitorWrite: jest.SpyInstance = mockMonitorStatusWrite();
    const bridge: jest.SpyInstance = mockBridge();

    await runOnCreateSuccess({
      createdItem: fakeTimelineRow({
        monitorStatusId: OFFLINE_STATUS_ID,
        projectId: PROJECT_ID,
        endsAt: new Date("2026-08-01T01:00:00.000Z"),
      }),
    });

    // A closed row is history, not the current status: nothing moves.
    expect(monitorWrite).not.toHaveBeenCalled();
    expect(bridge).not.toHaveBeenCalled();
  });
});

describe("MonitorStatusTimelineService.onDeleteSuccess - bridging the surviving status", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function runOnDeleteSuccess(
    carryForward: ObjectID | null,
  ): Promise<OnDelete<MonitorStatusTimeline>> {
    const onDelete: OnDelete<MonitorStatusTimeline> = {
      deleteBy: {
        query: {
          _id: ROW_ID.toString(),
        },
        props: ROOT_PROPS,
      } as DeleteBy<MonitorStatusTimeline>,
      carryForward: carryForward,
    };

    return (MonitorStatusTimelineService as any).onDeleteSuccess(onDelete, [
      ROW_ID,
    ]);
  }

  it("bridges to the surviving latest status, selecting its projectId to do so", async () => {
    const findLatest: jest.SpyInstance = jest
      .spyOn(MonitorStatusTimelineService, "findOneBy")
      .mockResolvedValue(
        fakeTimelineRow({
          monitorStatusId: OPERATIONAL_STATUS_ID,
          projectId: PROJECT_ID,
        }),
      );
    const monitorWrite: jest.SpyInstance = mockMonitorStatusWrite();
    const bridge: jest.SpyInstance = mockBridge();

    await runOnDeleteSuccess(MONITOR_ID);

    // The projectId for the bridge comes off the row already being read.
    expect(findLatest).toHaveBeenCalledTimes(1);
    const findArgs: any = findLatest.mock.calls[0]![0];
    expect(findArgs.select.projectId).toBe(true);
    expect(findArgs.select.monitorStatusId).toBe(true);

    expect(monitorWrite).toHaveBeenCalledTimes(1);
    expect(
      monitorWrite.mock.calls[0]![0].data.currentMonitorStatusId.toString(),
    ).toBe(OPERATIONAL_STATUS_ID.toString());

    expectBridgedOnceWith(bridge, {
      projectId: PROJECT_ID,
      monitorStatusId: OPERATIONAL_STATUS_ID,
    });
    expect(monitorWrite.mock.invocationCallOrder[0]!).toBeLessThan(
      bridge.mock.invocationCallOrder[0]!,
    );
  });

  it("does not bridge when no status survives for the monitor", async () => {
    jest
      .spyOn(MonitorStatusTimelineService, "findOneBy")
      .mockResolvedValue(null);
    const monitorWrite: jest.SpyInstance = mockMonitorStatusWrite();
    const bridge: jest.SpyInstance = mockBridge();

    await runOnDeleteSuccess(MONITOR_ID);

    expect(monitorWrite).not.toHaveBeenCalled();
    expect(bridge).not.toHaveBeenCalled();
  });

  it("does nothing without a monitorId carryForward", async () => {
    const findLatest: jest.SpyInstance = jest.spyOn(
      MonitorStatusTimelineService,
      "findOneBy",
    );
    const bridge: jest.SpyInstance = mockBridge();

    await runOnDeleteSuccess(null);

    expect(findLatest).not.toHaveBeenCalled();
    expect(bridge).not.toHaveBeenCalled();
  });

  it("a bridge that throws does not fail the delete", async () => {
    jest.spyOn(MonitorStatusTimelineService, "findOneBy").mockResolvedValue(
      fakeTimelineRow({
        monitorStatusId: OPERATIONAL_STATUS_ID,
        projectId: PROJECT_ID,
      }),
    );
    mockMonitorStatusWrite();
    jest
      .spyOn(NetworkSiteService, "onMonitorStatusChanged")
      .mockRejectedValue(new Error("rollup exploded") as never);
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined;
    });

    await expect(runOnDeleteSuccess(MONITOR_ID)).resolves.toBeDefined();
  });
});

describe("MonitorService.refreshMonitorCurrentStatus - bridging a repaired status", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function fakeMonitor(currentMonitorStatusId: ObjectID | undefined): Monitor {
    return {
      id: MONITOR_ID,
      _id: MONITOR_ID.toString(),
      projectId: PROJECT_ID,
      currentMonitorStatusId: currentMonitorStatusId,
    } as unknown as Monitor;
  }

  it("bridges when the current status id actually changed", async () => {
    const findMonitor: jest.SpyInstance = jest
      .spyOn(MonitorService, "findOneById")
      .mockResolvedValue(fakeMonitor(OPERATIONAL_STATUS_ID));
    jest.spyOn(MonitorStatusTimelineService, "findOneBy").mockResolvedValue(
      fakeTimelineRow({
        monitorStatusId: OFFLINE_STATUS_ID,
        projectId: PROJECT_ID,
      }),
    );
    const monitorWrite: jest.SpyInstance = jest
      .spyOn(MonitorService, "updateOneById")
      .mockResolvedValue(1);
    const bridge: jest.SpyInstance = mockBridge();

    await MonitorService.refreshMonitorCurrentStatus(MONITOR_ID);

    // The monitor read has to carry projectId or there is nothing to bridge with.
    expect(findMonitor.mock.calls[0]![0].select.projectId).toBe(true);

    expect(monitorWrite).toHaveBeenCalledTimes(1);
    expect(
      monitorWrite.mock.calls[0]![0].data.currentMonitorStatusId.toString(),
    ).toBe(OFFLINE_STATUS_ID.toString());

    expectBridgedOnceWith(bridge, {
      projectId: PROJECT_ID,
      monitorStatusId: OFFLINE_STATUS_ID,
    });
    expect(monitorWrite.mock.invocationCallOrder[0]!).toBeLessThan(
      bridge.mock.invocationCallOrder[0]!,
    );
  });

  it("neither writes nor bridges when the id is already in sync", async () => {
    jest
      .spyOn(MonitorService, "findOneById")
      .mockResolvedValue(fakeMonitor(OFFLINE_STATUS_ID));
    jest.spyOn(MonitorStatusTimelineService, "findOneBy").mockResolvedValue(
      fakeTimelineRow({
        monitorStatusId: OFFLINE_STATUS_ID,
        projectId: PROJECT_ID,
      }),
    );
    const monitorWrite: jest.SpyInstance = jest.spyOn(
      MonitorService,
      "updateOneById",
    );
    const bridge: jest.SpyInstance = mockBridge();

    await MonitorService.refreshMonitorCurrentStatus(MONITOR_ID);

    /*
     * An unchanged status must not churn every site rollup above the
     * device on each repair pass.
     */
    expect(monitorWrite).not.toHaveBeenCalled();
    expect(bridge).not.toHaveBeenCalled();
  });

  it("falls back to the timeline row's projectId when the monitor read has none", async () => {
    jest.spyOn(MonitorService, "findOneById").mockResolvedValue({
      id: MONITOR_ID,
      _id: MONITOR_ID.toString(),
      currentMonitorStatusId: OPERATIONAL_STATUS_ID,
    } as unknown as Monitor);
    jest.spyOn(MonitorStatusTimelineService, "findOneBy").mockResolvedValue(
      fakeTimelineRow({
        monitorStatusId: OFFLINE_STATUS_ID,
        projectId: PROJECT_ID,
      }),
    );
    jest.spyOn(MonitorService, "updateOneById").mockResolvedValue(1);
    const bridge: jest.SpyInstance = mockBridge();

    await MonitorService.refreshMonitorCurrentStatus(MONITOR_ID);

    expectBridgedOnceWith(bridge, {
      projectId: PROJECT_ID,
      monitorStatusId: OFFLINE_STATUS_ID,
    });
  });

  it("a bridge that throws does not fail the repair", async () => {
    jest
      .spyOn(MonitorService, "findOneById")
      .mockResolvedValue(fakeMonitor(OPERATIONAL_STATUS_ID));
    jest.spyOn(MonitorStatusTimelineService, "findOneBy").mockResolvedValue(
      fakeTimelineRow({
        monitorStatusId: OFFLINE_STATUS_ID,
        projectId: PROJECT_ID,
      }),
    );
    jest.spyOn(MonitorService, "updateOneById").mockResolvedValue(1);
    jest
      .spyOn(NetworkSiteService, "onMonitorStatusChanged")
      .mockRejectedValue(new Error("rollup exploded") as never);
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined;
    });

    await expect(
      MonitorService.refreshMonitorCurrentStatus(MONITOR_ID),
    ).resolves.toBeUndefined();
  });
});

describe("MonitorService.changeMonitorStatus - no longer bridges directly", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("creates the timeline row and leaves the bridge to MonitorStatusTimelineService.create", async () => {
    jest
      .spyOn(MonitorStatusTimelineService, "findOneBy")
      .mockResolvedValue(null);
    /*
     * The timeline create is stubbed, so MonitorStatusTimelineService.create
     * (the one place the bridge now lives on the create path, after its
     * mutex is released) does not run. If changeMonitorStatus still called
     * the bridge itself, it would show up here.
     */
    const createTimeline: jest.SpyInstance = jest
      .spyOn(MonitorStatusTimelineService, "create")
      .mockResolvedValue(
        fakeTimelineRow({
          monitorStatusId: OFFLINE_STATUS_ID,
          projectId: PROJECT_ID,
        }),
      );
    const bridge: jest.SpyInstance = mockBridge();

    await MonitorService.changeMonitorStatus(
      PROJECT_ID,
      [MONITOR_ID],
      OFFLINE_STATUS_ID,
      false,
      "manual change",
      undefined,
      ROOT_PROPS,
    );

    expect(createTimeline).toHaveBeenCalledTimes(1);
    expect(
      createTimeline.mock.calls[0]![0].data.monitorStatusId.toString(),
    ).toBe(OFFLINE_STATUS_ID.toString());
    expect(bridge).not.toHaveBeenCalled();
  });

  it("the bridge call is gone from the changeMonitorStatus source", () => {
    const source: string = fs.readFileSync(
      path.join(__dirname, "../../../Server/Services/MonitorService.ts"),
      "utf8",
    );

    const bodyStart: number = source.indexOf(
      "public async changeMonitorStatus(",
    );
    const bodyEnd: number = source.indexOf(
      "private async createStatusTimelineWithRetry(",
    );

    expect(bodyStart).toBeGreaterThan(-1);
    expect(bodyEnd).toBeGreaterThan(bodyStart);

    const changeMonitorStatusBody: string = source.slice(bodyStart, bodyEnd);

    expect(changeMonitorStatusBody).not.toContain(
      "NetworkSiteService.onMonitorStatusChanged",
    );

    /*
     * The ONLY direct call left in MonitorService is the one in
     * refreshMonitorCurrentStatus, whose updateOneById does not go through
     * a timeline create and so cannot be bridged from
     * MonitorStatusTimelineService.create.
     */
    const callSites: number = source.split(
      "NetworkSiteService.onMonitorStatusChanged(",
    ).length;

    expect(callSites - 1).toBe(1);
  });
});
