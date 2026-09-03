import { Service as NetworkDeviceServiceType } from "../../../Server/Services/NetworkDeviceService";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceMonitoringMethod from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "../../../Types/ObjectID";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT THIS FILE IS DEFENDING
 *
 * A NetworkDevice's monitoring method can move in two directions, and each
 * direction has a consequence the payload alone cannot express:
 *
 *   SNMP -> Monitor  The device stops being polled. The last thing its
 *                    probe found — lastSeenAt, lastPolledAt, isReachable,
 *                    the interface counts — is now residue on a device
 *                    nothing polls, and left in place it keeps feeding the
 *                    legacy staleness rule (DeviceReachabilityUtil judges a
 *                    row with lastSeenAt and no isReachable by freshness)
 *                    and the network summary's "degraded" query
 *                    (isReachable true AND interfacesDown > 0).
 *
 *   Monitor -> SNMP  The ping monitor's stamped verdict must not outlive
 *                    the binding: DeviceHealthStateUtil lets a stamp beat
 *                    reachability, so a stale one would keep deciding the
 *                    site rollup of a device that is now walked.
 *
 * The trap is that "the payload writes monitoringMethod" is NOT "the
 * method changed". The Settings form re-sends the method on every save, so
 * before onBeforeUpdate started recording the OLD method, every save of an
 * SNMP device was treated as a Monitor -> SNMP transition and wiped the
 * stamp its Network Device monitor had put there. So what is pinned here:
 *
 *   1. onBeforeUpdate snapshots each matched device's previous method into
 *      carryForward, WITHOUT clobbering the previousDevices snapshot the
 *      site maintenance already relies on;
 *   2. onUpdateSuccess asks to clear the stamp ONLY for a device that was
 *      monitor-backed and no longer is;
 *   3. the SNMP -> Monitor transition clears the poll residue, as a root
 *      write, BEFORE the re-stamp — and NOT on the caller's own payload,
 *      because those columns are updatable by fewer roles than
 *      monitoringMethod is and the column-permission check runs on the
 *      payload after the hook. Only isPollingEnabled rides the payload,
 *      and its permissions match monitoringMethod's.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SNMP_DEVICE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MONITOR_BACKED_DEVICE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const UNRECORDED_DEVICE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const RESIDUE_COLUMNS: Array<string> = [
  "lastSeenAt",
  "lastPolledAt",
  "isReachable",
  "interfacesUp",
  "interfacesDown",
];

type DeviceServiceInternals = {
  onBeforeUpdate: (
    updateBy: UpdateBy<NetworkDevice>,
  ) => Promise<OnUpdate<NetworkDevice>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<NetworkDevice>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<NetworkDevice>>;
};

function buildDeviceService(): {
  service: NetworkDeviceServiceType;
  internals: DeviceServiceInternals;
} {
  const service: NetworkDeviceServiceType = new NetworkDeviceServiceType();
  return {
    service,
    internals: service as unknown as DeviceServiceInternals,
  };
}

function deviceWithMethod(
  deviceId: ObjectID,
  monitoringMethod: string | undefined,
): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice(deviceId);
  device.projectId = PROJECT_ID;
  if (monitoringMethod !== undefined) {
    device.monitoringMethod = monitoringMethod;
  }
  return device;
}

function methodUpdate(
  data: Record<string, unknown>,
  query: Record<string, unknown> = {},
): UpdateBy<NetworkDevice> {
  return {
    query: query,
    data: data,
    props: { isRoot: true },
  } as unknown as UpdateBy<NetworkDevice>;
}

describe("onBeforeUpdate on a monitoring method write", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test("switching to Monitor turns polling off on the same payload", async () => {
    const { service, internals } = buildDeviceService();

    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([
        deviceWithMethod(SNMP_DEVICE_ID, NetworkDeviceMonitoringMethod.Snmp),
      ] as never);

    const result: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate(
      methodUpdate({ monitoringMethod: NetworkDeviceMonitoringMethod.Monitor }),
    );

    expect(result.updateBy.data.isPollingEnabled).toBe(false);
  });

  /*
   * The residue columns are deliberately NOT put on the payload. Column
   * permissions are checked on the payload AFTER this hook, and a project
   * member may update monitoringMethod but not isReachable — so nulling
   * them here would turn that member's legitimate switch into a permission
   * failure. onUpdateSuccess clears them as root instead (below).
   */
  test("does not put the poll residue columns on the caller's payload", async () => {
    const { service, internals } = buildDeviceService();

    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([
        deviceWithMethod(SNMP_DEVICE_ID, NetworkDeviceMonitoringMethod.Snmp),
      ] as never);

    const result: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate(
      methodUpdate({ monitoringMethod: NetworkDeviceMonitoringMethod.Monitor }),
    );

    for (const column of RESIDUE_COLUMNS) {
      expect(column in result.updateBy.data).toBe(false);
    }
  });

  /*
   * The snapshot. Only the previous method can tell onUpdateSuccess whether
   * anything actually transitioned, so every matched device's old method is
   * recorded — including a NULL one, which reads as SNMP.
   */
  test("records which matched devices were monitor-backed before the write", async () => {
    const { service, internals } = buildDeviceService();

    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([
        deviceWithMethod(SNMP_DEVICE_ID, NetworkDeviceMonitoringMethod.Snmp),
        deviceWithMethod(
          MONITOR_BACKED_DEVICE_ID,
          NetworkDeviceMonitoringMethod.Monitor,
        ),
        deviceWithMethod(UNRECORDED_DEVICE_ID, undefined),
      ] as never);

    const result: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate(
      methodUpdate({ monitoringMethod: NetworkDeviceMonitoringMethod.Snmp }),
    );

    expect(result.carryForward.wasMonitorBackedByDeviceId).toEqual({
      [SNMP_DEVICE_ID.toString()]: false,
      [MONITOR_BACKED_DEVICE_ID.toString()]: true,
      [UNRECORDED_DEVICE_ID.toString()]: false,
    });
  });

  /*
   * The site maintenance reads carryForward.previousDevices; a method write
   * that also moves the site must hand over BOTH, not one at the expense
   * of the other.
   */
  test("keeps the previousDevices snapshot alongside the method snapshot", async () => {
    const { service, internals } = buildDeviceService();

    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([
        deviceWithMethod(SNMP_DEVICE_ID, NetworkDeviceMonitoringMethod.Snmp),
      ] as never);

    const result: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate(
      methodUpdate({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        name: "phone-01",
      }),
    );

    expect(result.carryForward.previousDevices).toHaveLength(1);
    expect(result.carryForward.wasMonitorBackedByDeviceId).toEqual({
      [SNMP_DEVICE_ID.toString()]: false,
    });
  });

  test("reads the old method with a single snapshot query", async () => {
    const { service, internals } = buildDeviceService();

    const findBySpy: jest.SpyInstance = jest
      .spyOn(service, "findBy")
      .mockResolvedValue([
        deviceWithMethod(SNMP_DEVICE_ID, NetworkDeviceMonitoringMethod.Snmp),
      ] as never);

    await internals.onBeforeUpdate(
      methodUpdate({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        name: "phone-01",
      }),
    );

    expect(findBySpy).toHaveBeenCalledTimes(1);
    const select: Record<string, unknown> = findBySpy.mock.calls[0]![0]
      .select as unknown as Record<string, unknown>;
    expect(select["monitoringMethod"]).toBe(true);
    expect(select["_id"]).toBe(true);
    expect(findBySpy.mock.calls[0]![0].props.isRoot).toBe(true);
  });

  /*
   * A write that does not carry the method cannot be a transition, and must
   * not pay for the snapshot on its account — the SNMP walk writes device
   * columns through this hook on every poll of every device.
   */
  test("records nothing about the method on a write that does not carry it", async () => {
    const { service, internals } = buildDeviceService();

    const findBySpy: jest.SpyInstance = jest.spyOn(service, "findBy");

    const result: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate(
      methodUpdate({ interfacesDown: 2, lastSeenAt: new Date() }),
    );

    expect(findBySpy).not.toHaveBeenCalled();
    expect(result.carryForward).toBeNull();
  });

  test("still snapshots when the payload re-sends the method with nothing else", async () => {
    const { service, internals } = buildDeviceService();

    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([
        deviceWithMethod(
          MONITOR_BACKED_DEVICE_ID,
          NetworkDeviceMonitoringMethod.Monitor,
        ),
      ] as never);

    const result: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate(
      methodUpdate({ monitoringMethod: NetworkDeviceMonitoringMethod.Snmp }),
    );

    expect(result.carryForward.wasMonitorBackedByDeviceId).toEqual({
      [MONITOR_BACKED_DEVICE_ID.toString()]: true,
    });
  });

  /*
   * The polling guard shares the snapshot now. It has to keep refusing
   * "turn polling on" for a monitor-backed device — and keep allowing it
   * when the same write moves the device back to SNMP.
   */
  test("still refuses turning polling on for a monitor-backed device", async () => {
    const { service, internals } = buildDeviceService();

    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([
        deviceWithMethod(
          MONITOR_BACKED_DEVICE_ID,
          NetworkDeviceMonitoringMethod.Monitor,
        ),
      ] as never);

    await expect(
      internals.onBeforeUpdate(methodUpdate({ isPollingEnabled: true })),
    ).rejects.toThrow(/nothing to poll/);
  });

  test("allows turning polling on in the write that moves the device back to SNMP", async () => {
    const { service, internals } = buildDeviceService();

    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([
        deviceWithMethod(
          MONITOR_BACKED_DEVICE_ID,
          NetworkDeviceMonitoringMethod.Monitor,
        ),
      ] as never);

    await expect(
      internals.onBeforeUpdate(
        methodUpdate({
          isPollingEnabled: true,
          monitoringMethod: NetworkDeviceMonitoringMethod.Snmp,
        }),
      ),
    ).resolves.toBeDefined();
  });
});

describe("onUpdateSuccess acts on the transition, not on the payload", () => {
  let refresh: jest.SpyInstance;
  let residueWrite: jest.SpyInstance;
  let internals: DeviceServiceInternals;

  beforeEach(() => {
    jest.restoreAllMocks();
    const built: {
      service: NetworkDeviceServiceType;
      internals: DeviceServiceInternals;
    } = buildDeviceService();
    internals = built.internals;
    refresh = jest
      .spyOn(built.service, "refreshStampedMonitorStatus")
      .mockResolvedValue(undefined as never);
    residueWrite = jest
      .spyOn(built.service, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);
  });

  function run(
    data: Record<string, unknown>,
    wasMonitorBackedByDeviceId: Record<string, boolean> | undefined,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<NetworkDevice>> {
    return internals.onUpdateSuccess(
      {
        updateBy: methodUpdate(data),
        carryForward: {
          previousDevices: [],
          wasMonitorBackedByDeviceId: wasMonitorBackedByDeviceId,
        },
      },
      updatedItemIds,
    );
  }

  function clearFlagFor(deviceId: ObjectID): boolean | undefined {
    const call: Array<unknown> | undefined = refresh.mock.calls.find(
      (callArgs: Array<unknown>) => {
        return (
          (callArgs[0] as { deviceId: ObjectID }).deviceId.toString() ===
          deviceId.toString()
        );
      },
    );

    return (call?.[0] as { clearWhenNotMonitorBacked: boolean } | undefined)
      ?.clearWhenNotMonitorBacked;
  }

  /*
   * One bulk write of "SNMP" over a mixed set: the device that WAS
   * monitor-backed gets its stamp cleared; the one that already was SNMP
   * — the Settings-form re-save — does not.
   */
  test("asks to clear only for the rows that actually left monitor-backed", async () => {
    await run(
      { monitoringMethod: NetworkDeviceMonitoringMethod.Snmp },
      {
        [SNMP_DEVICE_ID.toString()]: false,
        [MONITOR_BACKED_DEVICE_ID.toString()]: true,
      },
      [SNMP_DEVICE_ID, MONITOR_BACKED_DEVICE_ID],
    );

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(clearFlagFor(SNMP_DEVICE_ID)).toBe(false);
    expect(clearFlagFor(MONITOR_BACKED_DEVICE_ID)).toBe(true);
    expect(residueWrite).not.toHaveBeenCalled();
  });

  test("never asks to clear when the write arrives at Monitor", async () => {
    await run(
      { monitoringMethod: NetworkDeviceMonitoringMethod.Monitor },
      {
        [SNMP_DEVICE_ID.toString()]: false,
        [MONITOR_BACKED_DEVICE_ID.toString()]: true,
      },
      [SNMP_DEVICE_ID, MONITOR_BACKED_DEVICE_ID],
    );

    expect(clearFlagFor(SNMP_DEVICE_ID)).toBe(false);
    expect(clearFlagFor(MONITOR_BACKED_DEVICE_ID)).toBe(false);
  });

  /*
   * SNMP -> Monitor: the five residue columns go, as one root write, and
   * before the re-stamp — so a device bound in the same save ends up with
   * its monitor's verdict rather than the walk's last one.
   */
  test("clears the poll residue of a device arriving at Monitor, before re-stamping it", async () => {
    await run(
      { monitoringMethod: NetworkDeviceMonitoringMethod.Monitor },
      { [SNMP_DEVICE_ID.toString()]: false },
      [SNMP_DEVICE_ID],
    );

    expect(residueWrite).toHaveBeenCalledTimes(1);
    const write: { id: ObjectID; data: Record<string, unknown> } = residueWrite
      .mock.calls[0]![0] as unknown as {
      id: ObjectID;
      data: Record<string, unknown>;
    };
    expect(write.id.toString()).toBe(SNMP_DEVICE_ID.toString());
    expect(Object.keys(write.data).sort()).toEqual([...RESIDUE_COLUMNS].sort());
    for (const column of RESIDUE_COLUMNS) {
      expect(write.data[column]).toBeNull();
    }

    expect(residueWrite.mock.invocationCallOrder[0]).toBeLessThan(
      refresh.mock.invocationCallOrder[0]!,
    );
  });

  /*
   * A monitor-backed device re-saved as Monitor has no residue to clear —
   * the transition that made it monitor-backed already did — and must not
   * be rewritten on every save.
   */
  test("does not rewrite residue on a device that already was monitor-backed", async () => {
    await run(
      { monitoringMethod: NetworkDeviceMonitoringMethod.Monitor },
      { [MONITOR_BACKED_DEVICE_ID.toString()]: true },
      [MONITOR_BACKED_DEVICE_ID],
    );

    expect(residueWrite).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  /*
   * A device the snapshot did not record: "unknown" must err on the side of
   * clearing residue (the write is idempotent) and NOT on the side of
   * clearing a stamp (which needs evidence the device was monitor-backed).
   */
  test("treats a device missing from the snapshot as safe to reset but not to clear", async () => {
    await run({ monitoringMethod: NetworkDeviceMonitoringMethod.Monitor }, {}, [
      UNRECORDED_DEVICE_ID,
    ]);
    expect(residueWrite).toHaveBeenCalledTimes(1);

    residueWrite.mockClear();
    refresh.mockClear();

    await run({ monitoringMethod: NetworkDeviceMonitoringMethod.Snmp }, {}, [
      UNRECORDED_DEVICE_ID,
    ]);
    expect(clearFlagFor(UNRECORDED_DEVICE_ID)).toBe(false);
    expect(residueWrite).not.toHaveBeenCalled();
  });

  test("a binding-only write is never a transition", async () => {
    await internals.onUpdateSuccess(
      {
        updateBy: methodUpdate({ monitorId: ObjectID.generate() }),
        carryForward: null,
      },
      [MONITOR_BACKED_DEVICE_ID],
    );

    expect(clearFlagFor(MONITOR_BACKED_DEVICE_ID)).toBe(false);
    expect(residueWrite).not.toHaveBeenCalled();
  });

  /*
   * The residue reset is bookkeeping after a committed write; it must not
   * cost the device its re-stamp, nor the caller their save.
   */
  test("still re-stamps, and still resolves, when the residue reset fails", async () => {
    residueWrite.mockRejectedValue(new Error("reset exploded") as never);

    await expect(
      run(
        { monitoringMethod: NetworkDeviceMonitoringMethod.Monitor },
        { [SNMP_DEVICE_ID.toString()]: false },
        [SNMP_DEVICE_ID],
      ),
    ).resolves.toBeDefined();

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
