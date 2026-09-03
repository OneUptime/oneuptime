import NetworkDeviceAlertPackUtil, {
  NetworkDeviceAlertPackItem,
} from "../../../Types/Monitor/SnmpMonitor/NetworkDeviceAlertPack";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import ObjectID from "../../../Types/ObjectID";

function packItem(name: string): NetworkDeviceAlertPackItem {
  const item: NetworkDeviceAlertPackItem | undefined =
    NetworkDeviceAlertPackUtil.getPackItems().find(
      (candidate: NetworkDeviceAlertPackItem) => {
        return candidate.name === name;
      },
    );

  expect(item).toBeDefined();

  return item!;
}

describe("NetworkDeviceAlertPackUtil.getPackItems", () => {
  test("every pack item has a name, a description and at least one filter", () => {
    const items: Array<NetworkDeviceAlertPackItem> =
      NetworkDeviceAlertPackUtil.getPackItems();

    expect(items.length).toBeGreaterThan(0);

    for (const item of items) {
      expect(item.name).toBeTruthy();
      expect(item.description).toBeTruthy();
      expect(item.filters.length).toBeGreaterThan(0);
    }
  });

  /*
   * Ping-first polling. "Device unreachable" is about the DEVICE (ping or
   * SNMP, the top-level isOnline); the walk failing on a device that still
   * answers ping is a separate, lesser condition with its own item.
   */
  describe("ping-first polling", () => {
    test("the unreachable item is about ping AND SNMP, raises an incident, and reads device reachability", () => {
      const item: NetworkDeviceAlertPackItem = packItem("Device unreachable");

      expect(item.description).toContain("ping and SNMP");
      expect(item.filters).toEqual([
        {
          checkOn: CheckOn.SnmpIsOnline,
          filterType: FilterType.False,
          value: undefined,
        },
      ]);
      expect(item.createIncidents).toBe(true);
      expect(item.createAlerts).toBe(false);
    });

    test("an 'SNMP walk failing' item alerts (never incidents) on the walk CheckOn", () => {
      const item: NetworkDeviceAlertPackItem = packItem("SNMP walk failing");

      expect(item.filters).toEqual([
        {
          checkOn: CheckOn.SnmpWalkIsSucceeding,
          filterType: FilterType.False,
          value: undefined,
        },
      ]);
      expect(item.createAlerts).toBe(true);
      expect(item.createIncidents).toBe(false);
    });

    test("no other item reads the walk verdict as if it were reachability", () => {
      for (const item of NetworkDeviceAlertPackUtil.getPackItems()) {
        for (const filter of item.filters) {
          if (filter.checkOn === CheckOn.SnmpWalkIsSucceeding) {
            expect(item.name).toBe("SNMP walk failing");
          }
        }
      }
    });
  });
});

describe("NetworkDeviceAlertPackUtil.buildCriteriaInstances", () => {
  test("builds one enabled instance per pack item with unique ids", () => {
    const instances: Array<MonitorCriteriaInstance> =
      NetworkDeviceAlertPackUtil.buildCriteriaInstances();

    expect(instances.length).toBe(
      NetworkDeviceAlertPackUtil.getPackItems().length,
    );

    const ids: Set<string> = new Set<string>();
    for (const instance of instances) {
      expect(instance.data?.isEnabled).toBe(true);
      expect(instance.data?.id).toBeTruthy();
      ids.add(instance.data!.id);
    }
    expect(ids.size).toBe(instances.length);
  });

  test("with a downMonitorStatusId context, incident-creating criteria carry that status id", () => {
    const downStatusId: ObjectID = ObjectID.generate();

    const instances: Array<MonitorCriteriaInstance> =
      NetworkDeviceAlertPackUtil.buildCriteriaInstances({
        downMonitorStatusId: downStatusId,
      });

    for (const instance of instances) {
      expect(instance.data?.monitorStatusId?.toString()).toBe(
        downStatusId.toString(),
      );

      /*
       * changeMonitorStatus must never be true while the target status id
       * is missing — that combination produces a criteria that "changes"
       * the monitor to no status at all.
       */
      if (instance.data?.changeMonitorStatus) {
        expect(instance.data?.monitorStatusId).toBeTruthy();
      }
    }
  });

  test("without context, no instance claims to change monitor status to an undefined id", () => {
    const instances: Array<MonitorCriteriaInstance> =
      NetworkDeviceAlertPackUtil.buildCriteriaInstances();

    for (const instance of instances) {
      expect(instance.data?.monitorStatusId).toBeUndefined();
      /*
       * Legacy call sites (no context) still exist in principle; the pack
       * must not produce a status change pointing at nothing.
       */
      expect(instance.data?.changeMonitorStatus).toBe(false);
    }
  });

  test("only incident-creating pack items request a monitor status change", () => {
    const downStatusId: ObjectID = ObjectID.generate();
    const items: Array<NetworkDeviceAlertPackItem> =
      NetworkDeviceAlertPackUtil.getPackItems();
    const instances: Array<MonitorCriteriaInstance> =
      NetworkDeviceAlertPackUtil.buildCriteriaInstances({
        downMonitorStatusId: downStatusId,
      });

    for (let i: number = 0; i < items.length; i++) {
      expect(instances[i]!.data?.createIncidents).toBe(
        items[i]!.createIncidents,
      );
      expect(instances[i]!.data?.createAlerts).toBe(items[i]!.createAlerts);
      expect(instances[i]!.data?.changeMonitorStatus).toBe(
        items[i]!.createIncidents,
      );
    }
  });
});
