import MonitorService from "../../../Server/Services/MonitorService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import logger from "../../../Server/Utils/Logger";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import ObjectID from "../../../Types/ObjectID";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnDelete } from "../../../Server/Types/Database/Hooks";
import { FindOperator } from "typeorm";
import { afterEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test: deleting a Monitor re-derives the stamped status of
 * every NetworkDevice that was bound to it.
 *
 * NetworkDevice.monitorId is ON DELETE SET NULL, so the binding itself goes
 * away with the monitor - but the device's currentMonitorStatusId and
 * isReachable are plain columns that nothing else clears. Without this, a
 * monitor-backed device kept reporting its deleted monitor's last verdict
 * forever: "Up" on the device list, "Up" in the site rollup, off a monitor
 * that no longer exists.
 *
 * What is pinned here:
 *
 *   - onBeforeDelete reads the bound devices BEFORE the delete (afterwards
 *     the column that links them is already NULL), as root and selecting
 *     only _id, and carries their ids forward next to the monitors it
 *     already carries,
 *   - no device lookup at all when no monitor matched the delete,
 *   - a lookup failure is logged and does not block the delete,
 *   - onDeleteSuccess calls NetworkDeviceService.refreshStampedMonitorStatus
 *     once per carried device with clearWhenNotMonitorBacked: false (an
 *     SNMP device's stamp belongs to the Network Device monitor watching its
 *     walk, not to this column),
 *   - a refresh failure is logged, never propagated, and does not stop the
 *     remaining devices from being refreshed.
 *
 * Everything below the service boundary is spied - no database.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MONITOR_A_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_B_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const DEVICE_A_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const DEVICE_B_ID: ObjectID = new ObjectID(
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
);

function fakeMonitor(id: ObjectID): Monitor {
  return {
    id: id,
    _id: id.toString(),
    projectId: PROJECT_ID,
  } as unknown as Monitor;
}

function fakeDevice(id: ObjectID): NetworkDevice {
  return {
    id: id,
    _id: id.toString(),
  } as unknown as NetworkDevice;
}

function deleteBy(): DeleteBy<Monitor> {
  return {
    query: {
      projectId: PROJECT_ID,
    },
    props: {
      isRoot: true,
    },
  } as DeleteBy<Monitor>;
}

/*
 * The other side effects onBeforeDelete already performs, stubbed so the
 * hook can run end to end without a database or a workspace.
 */
function mockExistingDeleteSideEffects(monitors: Array<Monitor>): void {
  jest.spyOn(MonitorService, "findBy").mockResolvedValue(monitors);
  jest
    .spyOn(StatusPageResourceService, "deleteBy")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(WorkspaceNotificationRuleService, "archiveWorkspaceChannels")
    .mockResolvedValue(undefined as never);
}

function runOnBeforeDelete(): Promise<OnDelete<Monitor>> {
  return (MonitorService as any).onBeforeDelete(deleteBy());
}

function runOnDeleteSuccess(carryForward: unknown): Promise<OnDelete<Monitor>> {
  const onDelete: OnDelete<Monitor> = {
    deleteBy: deleteBy(),
    carryForward: carryForward,
  };

  return (MonitorService as any).onDeleteSuccess(onDelete, [
    MONITOR_A_ID,
    MONITOR_B_ID,
  ]);
}

function idsOf(ids: Array<ObjectID>): Array<string> {
  return ids
    .map((id: ObjectID) => {
      return id.toString();
    })
    .sort();
}

describe("MonitorService.onBeforeDelete - collecting bound network devices", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads devices bound to any monitor in the deleted set, as root, selecting only _id", async () => {
    mockExistingDeleteSideEffects([
      fakeMonitor(MONITOR_A_ID),
      fakeMonitor(MONITOR_B_ID),
    ]);
    const findDevices: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValue([fakeDevice(DEVICE_A_ID), fakeDevice(DEVICE_B_ID)]);

    const onDelete: OnDelete<Monitor> = await runOnBeforeDelete();

    expect(findDevices).toHaveBeenCalledTimes(1);
    const args: any = findDevices.mock.calls[0]![0];

    /*
     * monitorId IN (every monitor about to be deleted). QueryHelper.any
     * builds a Raw operator: the SQL comes from getSql and the id list
     * rides in objectLiteralParameters under a random parameter name.
     */
    expect(args.query.monitorId).toBeInstanceOf(FindOperator);
    const operator: FindOperator<any> = args.query.monitorId;
    expect(String(operator.getSql!("monitorId"))).toContain("monitorId IN (");
    const boundTo: Array<string> = Object.values(
      operator.objectLiteralParameters as Record<string, Array<string>>,
    )[0]!;
    expect([...boundTo].sort()).toEqual(idsOf([MONITOR_A_ID, MONITOR_B_ID]));

    expect(args.select).toEqual({ _id: true });
    expect(args.props).toEqual({ isRoot: true });

    // ...and their ids ride the carryForward next to the monitors.
    expect(idsOf(onDelete.carryForward.networkDeviceIdsToRefresh)).toEqual(
      idsOf([DEVICE_A_ID, DEVICE_B_ID]),
    );
    expect(onDelete.carryForward.monitors).toHaveLength(2);
  });

  it("does not look up devices when no monitor matched the delete", async () => {
    mockExistingDeleteSideEffects([]);
    const findDevices: jest.SpyInstance = jest.spyOn(
      NetworkDeviceService,
      "findBy",
    );

    const onDelete: OnDelete<Monitor> = await runOnBeforeDelete();

    expect(findDevices).not.toHaveBeenCalled();
    expect(onDelete.carryForward.networkDeviceIdsToRefresh).toEqual([]);
    expect(onDelete.carryForward.monitors).toEqual([]);
  });

  it("carries an empty list when no device is bound to the deleted monitors", async () => {
    mockExistingDeleteSideEffects([fakeMonitor(MONITOR_A_ID)]);
    jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([]);

    const onDelete: OnDelete<Monitor> = await runOnBeforeDelete();

    expect(onDelete.carryForward.networkDeviceIdsToRefresh).toEqual([]);
  });

  it("a device lookup failure is logged and does not block the delete", async () => {
    mockExistingDeleteSideEffects([fakeMonitor(MONITOR_A_ID)]);
    jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockRejectedValue(new Error("database is down"));
    const error: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {
        return undefined;
      });

    const onDelete: OnDelete<Monitor> = await runOnBeforeDelete();

    // A stale stamp is a cosmetic bug; a monitor that cannot be deleted is not.
    expect(onDelete.carryForward.networkDeviceIdsToRefresh).toEqual([]);
    expect(onDelete.carryForward.monitors).toHaveLength(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![0])).toContain("database is down");
  });
});

describe("MonitorService.onDeleteSuccess - re-deriving the carried devices", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("refreshes each carried device once with clearWhenNotMonitorBacked: false", async () => {
    const refresh: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "refreshStampedMonitorStatus")
      .mockResolvedValue(undefined as never);

    await runOnDeleteSuccess({
      monitors: [fakeMonitor(MONITOR_A_ID)],
      networkDeviceIdsToRefresh: [DEVICE_A_ID, DEVICE_B_ID],
    });

    expect(refresh).toHaveBeenCalledTimes(2);

    const refreshed: Array<string> = refresh.mock.calls
      .map((call: Array<any>) => {
        return call[0].deviceId.toString();
      })
      .sort();
    expect(refreshed).toEqual(idsOf([DEVICE_A_ID, DEVICE_B_ID]));

    for (const call of refresh.mock.calls) {
      expect((call[0] as any).clearWhenNotMonitorBacked).toBe(false);
    }
  });

  it("a refresh failure is logged, does not propagate, and does not stop the rest", async () => {
    const refresh: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "refreshStampedMonitorStatus")
      .mockRejectedValueOnce(new Error("rollup exploded") as never)
      .mockResolvedValueOnce(undefined as never);
    const error: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {
        return undefined;
      });

    /*
     * The monitor is already gone from the database by the time this hook
     * runs, so anything thrown here would surface as a failed delete for
     * something that has in fact been deleted.
     */
    await expect(
      runOnDeleteSuccess({
        monitors: [],
        networkDeviceIdsToRefresh: [DEVICE_A_ID, DEVICE_B_ID],
      }),
    ).resolves.toBeDefined();

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![0])).toContain(DEVICE_A_ID.toString());
    expect(String(error.mock.calls[0]![0])).toContain("rollup exploded");
  });

  it("refreshes nothing when no device was carried", async () => {
    const refresh: jest.SpyInstance = jest.spyOn(
      NetworkDeviceService,
      "refreshStampedMonitorStatus",
    );

    await runOnDeleteSuccess({
      monitors: [fakeMonitor(MONITOR_A_ID)],
      networkDeviceIdsToRefresh: [],
    });

    expect(refresh).not.toHaveBeenCalled();
  });

  it("tolerates a carryForward without the device list", async () => {
    const refresh: jest.SpyInstance = jest.spyOn(
      NetworkDeviceService,
      "refreshStampedMonitorStatus",
    );

    await expect(
      runOnDeleteSuccess({ monitors: [fakeMonitor(MONITOR_A_ID)] }),
    ).resolves.toBeDefined();
    await expect(runOnDeleteSuccess(null)).resolves.toBeDefined();

    expect(refresh).not.toHaveBeenCalled();
  });
});
