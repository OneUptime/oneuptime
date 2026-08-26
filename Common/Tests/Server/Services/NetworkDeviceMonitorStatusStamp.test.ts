import MonitorService from "../../../Server/Services/MonitorService";
import NetworkDeviceLabelRuleEngineService from "../../../Server/Services/NetworkDeviceLabelRuleEngineService";
import NetworkDeviceOwnerRuleEngineService from "../../../Server/Services/NetworkDeviceOwnerRuleEngineService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import NetworkSiteService from "../../../Server/Services/NetworkSiteService";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceMonitoringMethod from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "../../../Types/ObjectID";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import { afterEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — OneUptime/oneuptime#3392, "a correctly bound
 * ping-only device is stuck on Pending".
 *
 * A monitor-backed NetworkDevice is never polled: no probe, no
 * credentials, no walk. Its ONLY source of health is the Monitor bound to
 * it, stamped onto `currentMonitorStatusId`, which the device list pill,
 * the site rollup and the topology node all read.
 *
 * Before this fix the only writer of that column was
 * `NetworkSiteService.onMonitorStatusChanged`, which runs when a monitor's
 * status CHANGES. So the documented workflow — create a Ping monitor, set
 * Monitoring Method to Monitor, bind the monitor — produced a device with
 * an empty stamp, and it stayed empty until the monitor happened to go
 * down. On a healthy device that is never, which is why the reporter's
 * phone stayed on "Pending" while it answered every ping.
 *
 * What is pinned here:
 *
 *   - binding stamps the monitor's CURRENT status immediately, on create
 *     and on update, rather than waiting for its next change,
 *   - the site chain is recomputed when the stamp moves, and only then,
 *   - unbinding (or switching the device back to SNMP) clears the stamp,
 *     so a ping monitor's verdict cannot outlive the binding,
 *   - an SNMP device's stamp — which comes from the Network Device monitor
 *     watching its walk, not from this column — is never touched,
 *   - the monitor lookup is scoped to the device's own project,
 *   - and a failure in any of it never escapes into the device update.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const SECOND_DEVICE_ID: ObjectID = new ObjectID(
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
);
const SITE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const MONITOR_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const OPERATIONAL_STATUS_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

function fakeDevice(overrides: Record<string, unknown>): NetworkDevice {
  return {
    id: DEVICE_ID,
    _id: DEVICE_ID.toString(),
    projectId: PROJECT_ID,
    ...overrides,
  } as unknown as NetworkDevice;
}

function fakeMonitor(currentMonitorStatusId: ObjectID | undefined): Monitor {
  return {
    id: MONITOR_ID,
    _id: MONITOR_ID.toString(),
    currentMonitorStatusId: currentMonitorStatusId,
  } as unknown as Monitor;
}

/*
 * The whole write path this method owns, mocked at the three seams it
 * touches: read the device, read its monitor, write the stamp (plus the
 * rollup it triggers).
 */
function mockDeviceAndMonitor(data: {
  device: NetworkDevice | null;
  monitor?: Monitor | null;
}): {
  update: jest.SpyInstance;
  rollup: jest.SpyInstance;
  findMonitor: jest.SpyInstance;
} {
  jest
    .spyOn(NetworkDeviceService, "findOneById")
    .mockResolvedValue(data.device);

  const findMonitor: jest.SpyInstance = jest
    .spyOn(MonitorService, "findOneBy")
    .mockResolvedValue(data.monitor === undefined ? null : data.monitor);

  const update: jest.SpyInstance = jest
    .spyOn(NetworkDeviceService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);

  const rollup: jest.SpyInstance = jest
    .spyOn(NetworkSiteService, "recomputeRollupForSiteAndAncestors")
    .mockResolvedValue(undefined as never);

  return { update, rollup, findMonitor };
}

describe("NetworkDeviceService.refreshStampedMonitorStatus", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The fix, stated once: the device in the issue, bound to a Ping monitor
   * that is Operational and has been for weeks.
   */
  it("stamps the bound monitor's current status onto a monitor-backed device", async () => {
    const { update } = mockDeviceAndMonitor({
      device: fakeDevice({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitorId: MONITOR_ID,
        currentMonitorStatusId: undefined,
      }),
      monitor: fakeMonitor(OPERATIONAL_STATUS_ID),
    });

    await NetworkDeviceService.refreshStampedMonitorStatus({
      deviceId: DEVICE_ID,
      clearWhenNotMonitorBacked: false,
    });

    expect(update).toHaveBeenCalledTimes(1);
    const args: any = update.mock.calls[0]![0];
    expect(args.id.toString()).toBe(DEVICE_ID.toString());
    expect(args.data.currentMonitorStatusId.toString()).toBe(
      OPERATIONAL_STATUS_ID.toString(),
    );
  });

  it("stamps an offline monitor just the same, so the device reads Down", async () => {
    const { update } = mockDeviceAndMonitor({
      device: fakeDevice({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitorId: MONITOR_ID,
        currentMonitorStatusId: OPERATIONAL_STATUS_ID,
      }),
      monitor: fakeMonitor(OFFLINE_STATUS_ID),
    });

    await NetworkDeviceService.refreshStampedMonitorStatus({
      deviceId: DEVICE_ID,
      clearWhenNotMonitorBacked: false,
    });

    expect(
      update.mock.calls[0]![0].data.currentMonitorStatusId.toString(),
    ).toBe(OFFLINE_STATUS_ID.toString());
  });

  /*
   * The site card above the device shows a worst-of rollup over its
   * devices' stamps, so a stamp that moves without recomputing it leaves
   * the site and the device contradicting each other on screen.
   */
  it("refreshes the device's site chain when the stamp moves", async () => {
    const { rollup } = mockDeviceAndMonitor({
      device: fakeDevice({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitorId: MONITOR_ID,
        siteId: SITE_ID,
      }),
      monitor: fakeMonitor(OPERATIONAL_STATUS_ID),
    });

    await NetworkDeviceService.refreshStampedMonitorStatus({
      deviceId: DEVICE_ID,
      clearWhenNotMonitorBacked: false,
    });

    expect(rollup).toHaveBeenCalledTimes(1);
    expect(rollup.mock.calls[0]![0].toString()).toBe(SITE_ID.toString());
  });

  it("skips the rollup for a device that belongs to no site", async () => {
    const { update, rollup } = mockDeviceAndMonitor({
      device: fakeDevice({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitorId: MONITOR_ID,
      }),
      monitor: fakeMonitor(OPERATIONAL_STATUS_ID),
    });

    await NetworkDeviceService.refreshStampedMonitorStatus({
      deviceId: DEVICE_ID,
      clearWhenNotMonitorBacked: false,
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(rollup).not.toHaveBeenCalled();
  });

  /*
   * Idempotence is what makes this safe to call from every save and from
   * the upgrade backfill: re-deriving a stamp that already agrees must
   * cost nothing and, more importantly, must not churn the site rollups of
   * a whole estate on every unrelated device edit.
   */
  it("writes nothing when the stamp already agrees", async () => {
    const { update, rollup } = mockDeviceAndMonitor({
      device: fakeDevice({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitorId: MONITOR_ID,
        siteId: SITE_ID,
        currentMonitorStatusId: OPERATIONAL_STATUS_ID,
      }),
      monitor: fakeMonitor(OPERATIONAL_STATUS_ID),
    });

    await NetworkDeviceService.refreshStampedMonitorStatus({
      deviceId: DEVICE_ID,
      clearWhenNotMonitorBacked: false,
    });

    expect(update).not.toHaveBeenCalled();
    expect(rollup).not.toHaveBeenCalled();
  });

  /*
   * Discovery import creates ping-only hosts with no monitor on purpose —
   * a subnet sweep has nothing to bind them to yet. "Pending" is the true
   * answer for those, so nothing is invented for them.
   */
  it("leaves an already-empty stamp alone when no monitor is bound", async () => {
    const { update, findMonitor } = mockDeviceAndMonitor({
      device: fakeDevice({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitorId: undefined,
      }),
    });

    await NetworkDeviceService.refreshStampedMonitorStatus({
      deviceId: DEVICE_ID,
      clearWhenNotMonitorBacked: false,
    });

    expect(findMonitor).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  /*
   * ...and the same device once its monitor is unbound. The old verdict
   * must not survive the binding that produced it.
   */
  it("clears the stamp when the monitor is unbound", async () => {
    const { update } = mockDeviceAndMonitor({
      device: fakeDevice({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitorId: undefined,
        currentMonitorStatusId: OPERATIONAL_STATUS_ID,
      }),
    });

    await NetworkDeviceService.refreshStampedMonitorStatus({
      deviceId: DEVICE_ID,
      clearWhenNotMonitorBacked: false,
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]![0].data.currentMonitorStatusId).toBeNull();
  });

  /*
   * A bound monitor that has somehow never had a status is the same case:
   * there is nothing to adopt, and a stale stamp is worse than none.
   */
  it("clears the stamp when the bound monitor has no status of its own", async () => {
    const { update } = mockDeviceAndMonitor({
      device: fakeDevice({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitorId: MONITOR_ID,
        currentMonitorStatusId: OPERATIONAL_STATUS_ID,
      }),
      monitor: fakeMonitor(undefined),
    });

    await NetworkDeviceService.refreshStampedMonitorStatus({
      deviceId: DEVICE_ID,
      clearWhenNotMonitorBacked: false,
    });

    expect(update.mock.calls[0]![0].data.currentMonitorStatusId).toBeNull();
  });

  it("clears the stamp when the bound monitor is gone", async () => {
    const { update } = mockDeviceAndMonitor({
      device: fakeDevice({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitorId: MONITOR_ID,
        currentMonitorStatusId: OPERATIONAL_STATUS_ID,
      }),
      monitor: null,
    });

    await NetworkDeviceService.refreshStampedMonitorStatus({
      deviceId: DEVICE_ID,
      clearWhenNotMonitorBacked: false,
    });

    expect(update.mock.calls[0]![0].data.currentMonitorStatusId).toBeNull();
  });

  /*
   * The monitorId FK only requires the Monitor row to exist, not that it
   * belongs to the device's project — the same hole the create/update
   * guards close. Reading it back through a project-scoped query is what
   * stops another tenant's status being stamped here.
   */
  it("looks the monitor up inside the device's own project", async () => {
    const { findMonitor } = mockDeviceAndMonitor({
      device: fakeDevice({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitorId: MONITOR_ID,
      }),
      monitor: fakeMonitor(OPERATIONAL_STATUS_ID),
    });

    await NetworkDeviceService.refreshStampedMonitorStatus({
      deviceId: DEVICE_ID,
      clearWhenNotMonitorBacked: false,
    });

    const query: any = findMonitor.mock.calls[0]![0].query;
    expect(query._id.toString()).toBe(MONITOR_ID.toString());
    expect(query.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(query.projectId.toString()).not.toBe(OTHER_PROJECT_ID.toString());
  });

  /*
   * An SNMP device's stamp comes from the Network Device monitor watching
   * its walk, and that binding lives in the monitor's step data rather
   * than in this column. Re-deriving it from `monitorId` would wipe a
   * legitimate status the walk pipeline put there.
   */
  it("does not touch an SNMP device by default", async () => {
    const { update, findMonitor } = mockDeviceAndMonitor({
      device: fakeDevice({
        monitoringMethod: NetworkDeviceMonitoringMethod.Snmp,
        monitorId: MONITOR_ID,
        currentMonitorStatusId: OPERATIONAL_STATUS_ID,
      }),
      monitor: fakeMonitor(OFFLINE_STATUS_ID),
    });

    await NetworkDeviceService.refreshStampedMonitorStatus({
      deviceId: DEVICE_ID,
      clearWhenNotMonitorBacked: false,
    });

    expect(findMonitor).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  /*
   * A device created before the column existed holds NULL, which reads as
   * SNMP — and must behave as one.
   */
  it("treats a device with no monitoring method as SNMP", async () => {
    const { update } = mockDeviceAndMonitor({
      device: fakeDevice({
        monitoringMethod: undefined,
        monitorId: MONITOR_ID,
        currentMonitorStatusId: OPERATIONAL_STATUS_ID,
      }),
      monitor: fakeMonitor(OFFLINE_STATUS_ID),
    });

    await NetworkDeviceService.refreshStampedMonitorStatus({
      deviceId: DEVICE_ID,
      clearWhenNotMonitorBacked: false,
    });

    expect(update).not.toHaveBeenCalled();
  });

  /*
   * The one write that DOES clear an SNMP device: the one that just moved
   * it off monitor-backed. The ping monitor's verdict outliving the
   * binding matters because a stamped status beats reachability in
   * DeviceHealthStateUtil — it would keep deciding the site rollup of a
   * device that is now being walked.
   */
  it("clears the stamp when a device is switched back to SNMP", async () => {
    const { update, rollup } = mockDeviceAndMonitor({
      device: fakeDevice({
        monitoringMethod: NetworkDeviceMonitoringMethod.Snmp,
        monitorId: MONITOR_ID,
        siteId: SITE_ID,
        currentMonitorStatusId: OPERATIONAL_STATUS_ID,
      }),
      monitor: fakeMonitor(OPERATIONAL_STATUS_ID),
    });

    await NetworkDeviceService.refreshStampedMonitorStatus({
      deviceId: DEVICE_ID,
      clearWhenNotMonitorBacked: true,
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]![0].data.currentMonitorStatusId).toBeNull();
    expect(rollup).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a device the update never actually matched", async () => {
    const { update } = mockDeviceAndMonitor({ device: null });

    await NetworkDeviceService.refreshStampedMonitorStatus({
      deviceId: DEVICE_ID,
      clearWhenNotMonitorBacked: true,
    });

    expect(update).not.toHaveBeenCalled();
  });

  it("does nothing for a device row carrying no project", async () => {
    const { update } = mockDeviceAndMonitor({
      device: {
        id: DEVICE_ID,
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitorId: MONITOR_ID,
      } as unknown as NetworkDevice,
    });

    await NetworkDeviceService.refreshStampedMonitorStatus({
      deviceId: DEVICE_ID,
      clearWhenNotMonitorBacked: true,
    });

    expect(update).not.toHaveBeenCalled();
  });

  /*
   * The columns the method reads. A select that drops one of them makes
   * this silently wrong rather than loudly broken — a missing
   * `monitoringMethod` reads as SNMP and skips every monitor-backed
   * device, which is the bug all over again.
   */
  it("selects every column its decision depends on", async () => {
    const findDevice: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "findOneById")
      .mockResolvedValue(null);

    await NetworkDeviceService.refreshStampedMonitorStatus({
      deviceId: DEVICE_ID,
      clearWhenNotMonitorBacked: false,
    });

    const select: any = findDevice.mock.calls[0]![0].select;
    expect(select.monitoringMethod).toBe(true);
    expect(select.monitorId).toBe(true);
    expect(select.currentMonitorStatusId).toBe(true);
    expect(select.projectId).toBe(true);
    expect(select.siteId).toBe(true);
  });
});

/*
 * The hook that turns "the operator pressed Save" into a re-stamp. The
 * dashboard's Device Details card posts `monitoringMethod` and the
 * `monitor` RELATION together; server-side callers write the `monitorId`
 * COLUMN. Both spellings have to fire, or the fix reaches only half the
 * writes (OneUptime/oneuptime#2940 is the same lesson for sites).
 */
describe("NetworkDeviceService.onUpdateSuccess re-stamps a changed binding", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function runOnUpdateSuccess(
    data: Record<string, unknown>,
    updatedItemIds: Array<ObjectID> = [DEVICE_ID],
  ): Promise<OnUpdate<NetworkDevice>> {
    const onUpdate: OnUpdate<NetworkDevice> = {
      updateBy: {
        query: {},
        data: data,
        props: { isRoot: true },
      } as unknown as UpdateBy<NetworkDevice>,
      carryForward: null,
    };

    return (NetworkDeviceService as any).onUpdateSuccess(
      onUpdate,
      updatedItemIds,
    );
  }

  it("re-stamps when the monitoring method is written", async () => {
    const refresh: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "refreshStampedMonitorStatus")
      .mockResolvedValue(undefined as never);

    await runOnUpdateSuccess({
      monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh.mock.calls[0]![0].deviceId.toString()).toBe(
      DEVICE_ID.toString(),
    );
  });

  it("re-stamps when the monitor RELATION is written, as the dashboard posts it", async () => {
    const refresh: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "refreshStampedMonitorStatus")
      .mockResolvedValue(undefined as never);

    await runOnUpdateSuccess({ monitor: { _id: MONITOR_ID.toString() } });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("re-stamps when the monitorId COLUMN is written", async () => {
    const refresh: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "refreshStampedMonitorStatus")
      .mockResolvedValue(undefined as never);

    await runOnUpdateSuccess({ monitorId: MONITOR_ID });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  /*
   * The exact save from the issue: Monitoring Method and Monitor set in one
   * submit, which is how the Device Details card posts them.
   */
  it("re-stamps the reported save, which writes both at once", async () => {
    const refresh: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "refreshStampedMonitorStatus")
      .mockResolvedValue(undefined as never);

    await runOnUpdateSuccess({
      monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
      monitor: { _id: MONITOR_ID.toString() },
      deviceRole: "IP phone",
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh.mock.calls[0]![0].clearWhenNotMonitorBacked).toBe(true);
  });

  /*
   * A method write is the only thing allowed to clear an SNMP device's
   * stamp, because it is the only write that can have just moved the
   * device off monitor-backed. Binding alone must not.
   */
  it("only asks to clear on a method write", async () => {
    const refresh: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "refreshStampedMonitorStatus")
      .mockResolvedValue(undefined as never);

    await runOnUpdateSuccess({ monitorId: MONITOR_ID });

    expect(refresh.mock.calls[0]![0].clearWhenNotMonitorBacked).toBe(false);
  });

  it("re-stamps every device a bulk update touched", async () => {
    const refresh: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "refreshStampedMonitorStatus")
      .mockResolvedValue(undefined as never);

    await runOnUpdateSuccess(
      { monitoringMethod: NetworkDeviceMonitoringMethod.Monitor },
      [DEVICE_ID, SECOND_DEVICE_ID],
    );

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(
      refresh.mock.calls.map((call: Array<any>) => {
        return call[0].deviceId.toString();
      }),
    ).toEqual([DEVICE_ID.toString(), SECOND_DEVICE_ID.toString()]);
  });

  /*
   * onUpdateSuccess runs even when the permission-scoped UPDATE matched
   * nothing, and a re-stamp of a device the caller could not touch would
   * be a write they were not allowed to make.
   */
  it("re-stamps nothing when the update matched no rows", async () => {
    const refresh: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "refreshStampedMonitorStatus")
      .mockResolvedValue(undefined as never);

    await runOnUpdateSuccess(
      { monitoringMethod: NetworkDeviceMonitoringMethod.Monitor },
      [],
    );

    expect(refresh).not.toHaveBeenCalled();
  });

  /*
   * The SNMP walk rewrites sysName, lastSeenAt and the interface counts on
   * every single poll of every single device. Re-deriving a stamp on those
   * would put a device read and a monitor read into the hot ingest path
   * for an entire fleet.
   */
  it("does not re-stamp on a write that leaves the binding alone", async () => {
    const refresh: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "refreshStampedMonitorStatus")
      .mockResolvedValue(undefined as never);

    await runOnUpdateSuccess({ sysName: "un0661voipcp01", interfacesDown: 2 });

    expect(refresh).not.toHaveBeenCalled();
  });

  /*
   * Status maintenance is best-effort, exactly like the site maintenance
   * beside it: the device update has already committed, and failing the
   * caller's request over a stamp would turn a cosmetic problem into a
   * failed save.
   */
  it("never lets a re-stamp failure escape into the update", async () => {
    jest
      .spyOn(NetworkDeviceService, "refreshStampedMonitorStatus")
      .mockRejectedValue(new Error("monitor lookup exploded") as never);

    await expect(
      runOnUpdateSuccess({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
      }),
    ).resolves.toBeDefined();
  });

  /*
   * ...and the two halves are independent. A rollup failure in the site
   * maintenance below must not cost the device its stamp, which is why
   * they sit in separate try blocks.
   */
  it("still re-stamps when the site maintenance beside it fails", async () => {
    const refresh: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "refreshStampedMonitorStatus")
      .mockResolvedValue(undefined as never);

    jest
      .spyOn(NetworkSiteService, "recomputeRollupForSiteAndAncestors")
      .mockRejectedValue(new Error("rollup exploded") as never);

    await expect(
      runOnUpdateSuccess({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        siteId: SITE_ID,
      }),
    ).resolves.toBeDefined();

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

/*
 * The create side. A device can arrive monitor-backed and already bound —
 * the "Add Device" form asks for the monitor in the same submit, and the
 * discovery review screen imports ping-only hosts in bulk — so waiting for
 * a later edit to stamp it would leave a freshly created device on
 * "Pending" for exactly the same reason the reported one was.
 *
 * The chain is detached from the create response on purpose (a rule
 * failure must never fail the device write), so these drain the microtask
 * queue the way the rule-chain suite does.
 */
describe("NetworkDeviceService.onCreateSuccess stamps a device created bound", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockRuleChain(): void {
    jest
      .spyOn(NetworkDeviceLabelRuleEngineService, "applyRulesToNetworkDevice")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(NetworkDeviceOwnerRuleEngineService, "applyRulesToNetworkDevice")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(NetworkDeviceService, "applySiteAssignmentRulesToDevice")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(NetworkSiteService, "recomputeRollupForSiteAndAncestors")
      .mockResolvedValue(undefined as never);
  }

  async function runOnCreateSuccess(createdItem: NetworkDevice): Promise<void> {
    await (NetworkDeviceService as any).onCreateSuccess(
      { createBy: { data: {}, props: {} }, carryForward: null },
      createdItem,
    );

    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });
  }

  it("stamps a device created monitor-backed", async () => {
    mockRuleChain();
    const refresh: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "refreshStampedMonitorStatus")
      .mockResolvedValue(undefined as never);

    await runOnCreateSuccess(
      fakeDevice({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitorId: MONITOR_ID,
      }),
    );

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh.mock.calls[0]![0].deviceId.toString()).toBe(
      DEVICE_ID.toString(),
    );
    // Nothing to clear on a row that has only just been written.
    expect(refresh.mock.calls[0]![0].clearWhenNotMonitorBacked).toBe(false);
  });

  /*
   * Discovery import creates ping-only hosts with no monitor bound. Those
   * still go through, and the method itself decides there is nothing to
   * stamp — which keeps the "did we call it" decision in one place.
   */
  it("stamps a monitor-backed device created with nothing bound", async () => {
    mockRuleChain();
    const refresh: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "refreshStampedMonitorStatus")
      .mockResolvedValue(undefined as never);

    await runOnCreateSuccess(
      fakeDevice({ monitoringMethod: NetworkDeviceMonitoringMethod.Monitor }),
    );

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  /*
   * Every SNMP device ever created goes through this hook, including a
   * whole subnet at a time on discovery import. None of them has anything
   * to stamp, so none of them pays for a device read and a monitor read.
   */
  it("does not touch an SNMP device", async () => {
    mockRuleChain();
    const refresh: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "refreshStampedMonitorStatus")
      .mockResolvedValue(undefined as never);

    await runOnCreateSuccess(
      fakeDevice({ monitoringMethod: NetworkDeviceMonitoringMethod.Snmp }),
    );

    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not touch a device created with no monitoring method", async () => {
    mockRuleChain();
    const refresh: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "refreshStampedMonitorStatus")
      .mockResolvedValue(undefined as never);

    await runOnCreateSuccess(fakeDevice({}));

    expect(refresh).not.toHaveBeenCalled();
  });

  /*
   * Detached, and it has to stay that way: the device row is already
   * committed and its id already returned to the caller by the time this
   * runs, so a monitor lookup that throws must not surface as a failed
   * create.
   */
  it("never lets a stamp failure escape the create", async () => {
    mockRuleChain();
    jest
      .spyOn(NetworkDeviceService, "refreshStampedMonitorStatus")
      .mockRejectedValue(new Error("monitor lookup exploded") as never);

    await expect(
      runOnCreateSuccess(
        fakeDevice({
          monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
          monitorId: MONITOR_ID,
        }),
      ),
    ).resolves.toBeUndefined();
  });
});
