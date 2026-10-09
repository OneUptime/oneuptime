import NetworkDeviceAlertPackUtil, {
  NetworkDeviceAlertPackItem,
} from "../../../Types/Monitor/SnmpMonitor/NetworkDeviceAlertPack";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import { SnmpTableDefinition } from "../../../Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpVendorTemplateUtil from "../../../Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, it } from "@jest/globals";

/*
 * The recommended alert pack grows with the device: every SNMP table that
 * declares what healthy looks like adds one per-row criteria, so applying the
 * pack to a Sophos firewall alerts on each tunnel and to a Fabric Engine
 * switch on each IS-IS neighbour - with nothing to configure.
 */

function itemsFor(packId: string): Array<NetworkDeviceAlertPackItem> {
  return NetworkDeviceAlertPackUtil.getTableHealthItems(
    SnmpVendorTemplateUtil.getById(packId)!.tables,
  );
}

describe("NetworkDeviceAlertPackUtil table health items", () => {
  it("adds an incident per tunnel for Sophos, and nothing for the CPU table", () => {
    const items: Array<NetworkDeviceAlertPackItem> = itemsFor("sophos-sfos");

    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe("IPsec Tunnels: row unhealthy");
    expect(items[0]!.createIncidents).toBe(true);
    expect(items[0]!.createAlerts).toBe(false);
    expect(items[0]!.filters).toEqual([
      {
        checkOn: CheckOn.SnmpTableRowIsUnhealthy,
        filterType: FilterType.True,
        value: undefined,
        snmpMonitorOptions: { tableKey: "ipsec_tunnels", tableRow: "*" },
      },
    ]);
  });

  it("pages for fabric adjacencies but only alerts for hardware", () => {
    const items: Array<NetworkDeviceAlertPackItem> = itemsFor(
      "extreme-fabric-engine",
    );

    const byName: Record<string, NetworkDeviceAlertPackItem> = {};
    for (const item of items) {
      byName[item.name] = item;
    }

    expect(
      byName["Fabric Adjacencies (IS-IS): row unhealthy"]!.createIncidents,
    ).toBe(true);
    expect(byName["Fans: row unhealthy"]!.createIncidents).toBe(false);
    expect(byName["Fans: row unhealthy"]!.createAlerts).toBe(true);
    // CPU and Memory declares no healthy values.
    expect(byName["CPU and Memory: row unhealthy"]).toBeUndefined();
  });

  it("adds nothing without tables", () => {
    expect(NetworkDeviceAlertPackUtil.getTableHealthItems(undefined)).toEqual(
      [],
    );
    expect(NetworkDeviceAlertPackUtil.getTableHealthItems([])).toEqual([]);
  });

  it("keeps the base pack unchanged when no tables are passed", () => {
    // Five device and interface items, three transceiver items.
    expect(NetworkDeviceAlertPackUtil.getPackItems()).toHaveLength(8);
    expect(NetworkDeviceAlertPackUtil.buildCriteriaInstances({})).toHaveLength(
      8,
    );
  });

  it("builds criteria instances for the table items too", () => {
    const downStatus: ObjectID = ObjectID.generate();
    const tables: Array<SnmpTableDefinition> =
      SnmpVendorTemplateUtil.getById("sophos-sfos")!.tables!;

    const instances: Array<MonitorCriteriaInstance> =
      NetworkDeviceAlertPackUtil.buildCriteriaInstances({
        downMonitorStatusId: downStatus,
        tables: tables,
      });

    expect(instances).toHaveLength(9);

    // Table items come after the base pack.
    const tunnelCriteria: MonitorCriteriaInstance = instances[8]!;
    expect(tunnelCriteria.data?.name).toBe("IPsec Tunnels: row unhealthy");
    expect(tunnelCriteria.data?.changeMonitorStatus).toBe(true);
    expect(tunnelCriteria.data?.monitorStatusId?.toString()).toBe(
      downStatus.toString(),
    );
  });
});
