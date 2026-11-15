import { describe, expect, test } from "@jest/globals";
import ObjectID from "../../../Types/ObjectID";
import MonitorNotCheckedReason, {
  isMonitorNotCheckedReason,
  MONITOR_NOT_CHECKED_REASONS,
} from "../../../Types/Monitor/MonitorNotCheckedReason";
import MonitoringOff, {
  MonitoredFlags,
} from "../../../Utils/Monitor/MonitoringOff";
import { getBoundMonitorNotCheckedReason } from "../../../Utils/NetworkDevice/BoundMonitorNotChecked";
import NetworkTopologyUtil, {
  TopologyBuildResult,
} from "../../../Utils/Monitor/NetworkTopologyUtil";
import { NetworkTopologyNode } from "../../../Types/Monitor/SnmpMonitor/NetworkTopology";
import { NetworkDeviceMonitoringMethod } from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";

/*
 * WHY NOTHING CHECKS A MONITOR-BACKED DEVICE'S BOUND MONITOR (issue #7346).
 *
 * A monitor-backed device takes its status from the monitor bound to it, and
 * only while that monitor is checked. Turned off or archived, the device
 * reads "unknown" - and every surface that shows it says why, in the same
 * words: the device pages' "Monitoring off" / "Monitor archived", and the
 * Network Map's drawer and node tooltip. These are the rules they read.
 */

describe("MonitoringOff.getNotCheckedReason", () => {
  test("a monitor whose monitoring is turned off: monitoring off", () => {
    expect(
      MonitoringOff.getNotCheckedReason({
        isArchived: false,
        disableActiveMonitoring: true,
      }),
    ).toBe(MonitorNotCheckedReason.MonitoringOff);
  });

  test("an archived monitor: monitor archived", () => {
    expect(
      MonitoringOff.getNotCheckedReason({
        isArchived: true,
        disableActiveMonitoring: false,
      }),
    ).toBe(MonitorNotCheckedReason.MonitorArchived);
  });

  // Unarchiving is what puts it back; its switch only matters after that.
  test("archived wins over turned off", () => {
    expect(
      MonitoringOff.getNotCheckedReason({
        isArchived: true,
        disableActiveMonitoring: true,
      }),
    ).toBe(MonitorNotCheckedReason.MonitorArchived);
  });

  test("a checked monitor has no reason", () => {
    expect(
      MonitoringOff.getNotCheckedReason({
        isArchived: false,
        disableActiveMonitoring: false,
      }),
    ).toBeNull();
  });

  // As isMonitored: only an explicit true sets either switch.
  test.each([
    { label: "read without its switches", monitor: {} },
    {
      label: "with both switches null",
      monitor: { isArchived: null, disableActiveMonitoring: null },
    },
    { label: "missing", monitor: null },
    { label: "undefined", monitor: undefined },
  ])(
    "a monitor $label counts as checked",
    ({ monitor }: { monitor: MonitoredFlags | null | undefined }) => {
      expect(MonitoringOff.getNotCheckedReason(monitor)).toBeNull();
    },
  );

  test("has a reason exactly when isMonitored says the monitor is not checked", () => {
    const values: Array<boolean | null | undefined> = [
      true,
      false,
      null,
      undefined,
    ];

    for (const isArchived of values) {
      for (const disableActiveMonitoring of values) {
        const monitor: MonitoredFlags = { isArchived, disableActiveMonitoring };
        expect(MonitoringOff.getNotCheckedReason(monitor) !== null).toBe(
          !MonitoringOff.isMonitored(monitor),
        );
      }
    }
  });
});

describe("MonitorNotCheckedReason", () => {
  // They travel in JSON, on the map's device nodes: words that never change.
  test("its values are the words a payload carries", () => {
    expect(MonitorNotCheckedReason.MonitoringOff).toBe("monitoringOff");
    expect(MonitorNotCheckedReason.MonitorArchived).toBe("monitorArchived");
  });

  test("lists every reason", () => {
    expect([...MONITOR_NOT_CHECKED_REASONS].sort()).toEqual(
      Object.values(MonitorNotCheckedReason).sort(),
    );
  });

  test("a reader accepts the reasons and nothing else", () => {
    expect(isMonitorNotCheckedReason("monitoringOff")).toBe(true);
    expect(isMonitorNotCheckedReason("monitorArchived")).toBe(true);

    for (const value of [
      "MonitoringOff",
      "archived",
      "",
      undefined,
      null,
      1,
      {},
      ["monitoringOff"],
    ]) {
      expect(isMonitorNotCheckedReason(value)).toBe(false);
    }
  });
});

describe("getBoundMonitorNotCheckedReason", () => {
  const monitorId: ObjectID = ObjectID.generate();

  test.each([
    {
      label: "turned off",
      monitor: { isArchived: false, disableActiveMonitoring: true },
      reason: MonitorNotCheckedReason.MonitoringOff,
    },
    {
      label: "archived",
      monitor: { isArchived: true, disableActiveMonitoring: false },
      reason: MonitorNotCheckedReason.MonitorArchived,
    },
    {
      label: "archived and turned off",
      monitor: { isArchived: true, disableActiveMonitoring: true },
      reason: MonitorNotCheckedReason.MonitorArchived,
    },
  ])(
    "a monitor-backed device whose bound monitor is $label",
    ({
      monitor,
      reason,
    }: {
      monitor: MonitoredFlags;
      reason: MonitorNotCheckedReason;
    }) => {
      expect(
        getBoundMonitorNotCheckedReason({
          monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
          monitorId,
          monitor,
        }),
      ).toBe(reason);
    },
  );

  test("takes the monitor's id as a string too, as a JSON row carries it", () => {
    expect(
      getBoundMonitorNotCheckedReason({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitorId: monitorId.toString(),
        monitor: { isArchived: false, disableActiveMonitoring: true },
      }),
    ).toBe(MonitorNotCheckedReason.MonitoringOff);
  });

  test("a monitor-backed device whose monitor is checked has none", () => {
    expect(
      getBoundMonitorNotCheckedReason({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitorId,
        monitor: { isArchived: false, disableActiveMonitoring: false },
      }),
    ).toBeNull();
  });

  /*
   * A probe-polled device judges itself by its poll: a monitor watching it
   * is not why it reads what it reads. Legacy rows ("SNMP", or no method at
   * all) are probe-polled.
   */
  test.each([
    {
      label: "a probe-polled device",
      method: NetworkDeviceMonitoringMethod.Probe,
    },
    { label: "a legacy SNMP row", method: "SNMP" },
    { label: "a row with no method", method: undefined },
    { label: "a row with a null method", method: null },
  ])(
    "$label has none, whatever its monitor",
    ({ method }: { method: string | null | undefined }) => {
      expect(
        getBoundMonitorNotCheckedReason({
          monitoringMethod: method,
          monitorId,
          monitor: { isArchived: true, disableActiveMonitoring: true },
        }),
      ).toBeNull();
    },
  );

  // Nothing bound is the "No monitor" case, not this one.
  test.each([
    { label: "no monitor id", monitorId: undefined },
    { label: "a null monitor id", monitorId: null },
    { label: "an empty monitor id", monitorId: "" },
  ])(
    "a monitor-backed device with $label has none",
    ({ monitorId: boundId }: { monitorId: string | null | undefined }) => {
      expect(
        getBoundMonitorNotCheckedReason({
          monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
          monitorId: boundId,
          monitor: { isArchived: true, disableActiveMonitoring: true },
        }),
      ).toBeNull();
    },
  );

  test("a monitor read without its switches counts as checked", () => {
    expect(
      getBoundMonitorNotCheckedReason({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitorId,
      }),
    ).toBeNull();
  });
});

describe("NetworkTopologyUtil.buildTopology - a device node's monitor nothing checks", () => {
  const now: Date = new Date("2026-11-13T12:00:00Z");

  function nodeById(
    result: TopologyBuildResult,
    id: string,
  ): NetworkTopologyNode {
    const node: NetworkTopologyNode | undefined = result.nodes.find(
      (candidate: NetworkTopologyNode): boolean => {
        return candidate.id === id;
      },
    );
    expect(node).toBeDefined();
    return node!;
  }

  test("copies the caller's reason and monitor onto the device's node", () => {
    const monitorId: string = ObjectID.generate().toString();
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [
        {
          id: "d1",
          name: "branch-ap",
          monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
          monitorNotChecked: {
            monitorId,
            reason: MonitorNotCheckedReason.MonitorArchived,
          },
        },
      ],
      now,
    );

    const node: NetworkTopologyNode = nodeById(result, "d1");
    expect(node.monitorNotChecked).toEqual({
      monitorId,
      reason: MonitorNotCheckedReason.MonitorArchived,
    });
    // It decides nothing: an empty stamp is what makes the node unknown.
    expect(node.status).toBe("unknown");
  });

  test("a node of a device without one carries no such field at all", () => {
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [{ id: "d1", name: "branch-ap" }],
      now,
    );

    expect(Object.keys(nodeById(result, "d1"))).not.toContain(
      "monitorNotChecked",
    );
  });

  test("the node's copy is its own: changing the input after the build changes nothing", () => {
    const monitorNotChecked: {
      monitorId: string;
      reason: MonitorNotCheckedReason;
    } = {
      monitorId: ObjectID.generate().toString(),
      reason: MonitorNotCheckedReason.MonitoringOff,
    };
    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [
        {
          id: "d1",
          name: "branch-ap",
          monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
          monitorNotChecked,
        },
      ],
      now,
    );

    monitorNotChecked.reason = MonitorNotCheckedReason.MonitorArchived;

    expect(nodeById(result, "d1").monitorNotChecked?.reason).toBe(
      MonitorNotCheckedReason.MonitoringOff,
    );
  });
});
