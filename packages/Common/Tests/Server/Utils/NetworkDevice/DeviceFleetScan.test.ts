import { describe, expect, test } from "@jest/globals";
import {
  DEVICE_FLEET_SCAN_AGGREGATES,
  DEVICE_FLEET_SCAN_GROUP_COLUMNS,
  DEVICE_FLEET_SCAN_ORDER,
  DEVICE_HEALTH_GROUP_COLUMNS,
  DeviceFleetScan,
  DeviceFleetScanAlias,
  DeviceFleetSummary,
  DeviceHealthGroup,
  DeviceHealthGroupAlias,
  SNMP_FAILING_AGGREGATE,
  readDeviceFleetScan,
  sortDeviceHealthGroups,
} from "../../../../Server/Utils/NetworkDevice/DeviceHealthAggregation";
import { AggregateRow } from "../../../../Server/Types/Database/AggregateBy";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";

/*
 * THE FLEET, COUNTED ONCE (NetworkDeviceService.getFleetScan,
 * readDeviceFleetScan).
 *
 * One GROUP BY by the health facts and the vendor, read back into what the
 * four reads it replaces answered: the summary strip's numbers, the health
 * buckets, the vendor breakdown and the SNMP-failing count. Here each of
 * those is restated over the devices themselves, for many random fleets,
 * and held to what readDeviceFleetScan reads off the folded buckets - in the
 * order the database hands them over (by vendor). NetworkFleetScanPostgres
 * holds the SQL itself to the old reads on a real Postgres.
 */

// A device as the facts the scan groups and counts by.
interface Device {
  monitorStatusId: string | null;
  monitoringMethod: string | null;
  isReachable: boolean | null;
  hasBeenPolled: boolean;
  hasBeenSeen: boolean;
  isStale: boolean;
  interfacesDown: number;
  vendor: string;
  hasSite: boolean;
  isSnmpReachable: boolean | null;
}

// A seeded generator, so a failing fleet can be found again.
function generator(seed: number): () => number {
  let state: number = seed;
  return (): number => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function pick<T>(random: () => number, values: Array<T>): T {
  return values[Math.floor(random() * values.length)]!;
}

const STATUS_IDS: Array<string | null> = [
  "0b7a0e0c-8b1a-4f00-9c00-000000000001",
  "5f2c1d3e-8b1a-4f00-9c00-000000000002",
  "f0e1d2c3-8b1a-4f00-9c00-000000000003",
  null,
];

const VENDORS: Array<string> = [
  "Cisco",
  "Juniper",
  "Arista",
  "",
  "MikroTik",
  "HPE Aruba",
  "Zyxel",
  "Fortinet",
];

function randomFleet(seed: number): Array<Device> {
  const random: () => number = generator(seed);
  const size: number = Math.floor(random() * 300);
  const devices: Array<Device> = [];

  for (let index: number = 0; index < size; index++) {
    devices.push({
      monitorStatusId: pick(random, STATUS_IDS),
      monitoringMethod: pick(random, ["Probe", "Monitor", null]),
      isReachable: pick(random, [true, false, null]),
      hasBeenPolled: random() < 0.8,
      hasBeenSeen: random() < 0.7,
      isStale: random() < 0.1,
      interfacesDown: pick(random, [0, 0, 0, 1, 3]),
      vendor: pick(random, VENDORS),
      hasSite: random() < 0.6,
      isSnmpReachable: pick(random, [true, false, null]),
    });
  }

  return devices;
}

// The database's own order of vendor names, for ties (a fixed collation).
function collate(first: string, second: string): number {
  return first.localeCompare(second, "en");
}

function healthKey(device: Device): string {
  return JSON.stringify([
    device.monitorStatusId,
    device.monitoringMethod,
    device.isReachable,
    device.hasBeenPolled,
    device.hasBeenSeen,
    device.isStale,
    device.interfacesDown > 0,
  ]);
}

// What the four reads answered, restated over the devices.
function readSeparately(devices: Array<Device>): DeviceFleetScan {
  const summary: DeviceFleetSummary = {
    devicesUp: devices.filter((device: Device) => {
      return device.isReachable === true;
    }).length,
    devicesDown: devices.filter((device: Device) => {
      return device.isReachable === false;
    }).length,
    devicesPending: devices.filter((device: Device) => {
      return device.isReachable === null;
    }).length,
    interfacesDown: devices.reduce((total: number, device: Device) => {
      return total + device.interfacesDown;
    }, 0),
    totalDevices: devices.length,
    devicesWithoutSite: devices.filter((device: Device) => {
      return !device.hasSite;
    }).length,
  };

  const groups: Map<string, DeviceHealthGroup> = new Map();

  for (const device of devices) {
    const key: string = healthKey(device);
    const group: DeviceHealthGroup = groups.get(key) || {
      siteId: null,
      monitorStatusId: device.monitorStatusId,
      monitoringMethod: device.monitoringMethod,
      isReachable: device.isReachable,
      hasBeenPolled: device.hasBeenPolled,
      hasBeenSeen: device.hasBeenSeen,
      isStale: device.isStale,
      hasDownInterfaces: device.interfacesDown > 0,
      deviceCount: 0,
      interfacesDownTotal: 0,
    };
    group.deviceCount++;
    group.interfacesDownTotal += device.interfacesDown;
    groups.set(key, group);
  }

  const vendorCounts: Map<string, number> = new Map();

  for (const device of devices) {
    vendorCounts.set(device.vendor, (vendorCounts.get(device.vendor) || 0) + 1);
  }

  // ORDER BY "deviceCount" DESC, "vendor" ASC LIMIT 6.
  const vendors: Array<{ vendor: string; count: number }> = Array.from(
    vendorCounts.entries(),
  )
    .map(([vendor, count]: [string, number]) => {
      return { vendor, count };
    })
    .sort(
      (
        first: { vendor: string; count: number },
        second: { vendor: string; count: number },
      ): number => {
        return (
          second.count - first.count || collate(first.vendor, second.vendor)
        );
      },
    )
    .slice(0, 6);

  return {
    summary,
    healthGroups: sortDeviceHealthGroups(Array.from(groups.values())),
    vendors,
    snmpFailing: devices.filter((device: Device) => {
      return device.isReachable === true && device.isSnmpReachable === false;
    }).length,
  };
}

/*
 * The folded scan's rows, as Postgres hands them over: one per health
 * bucket and vendor, ordered by vendor, counts as the strings node-postgres
 * gives a bigint.
 */
function foldedRows(devices: Array<Device>): Array<AggregateRow> {
  const rows: Map<string, AggregateRow> = new Map();

  for (const device of devices) {
    const key: string = `${healthKey(device)}|${device.vendor}`;
    const row: AggregateRow = rows.get(key) || {
      [DeviceHealthGroupAlias.MonitorStatusId]: device.monitorStatusId,
      [DeviceHealthGroupAlias.MonitoringMethod]: device.monitoringMethod,
      [DeviceHealthGroupAlias.IsReachable]: device.isReachable,
      [DeviceHealthGroupAlias.HasBeenPolled]: device.hasBeenPolled,
      [DeviceHealthGroupAlias.HasBeenSeen]: device.hasBeenSeen,
      [DeviceHealthGroupAlias.IsStale]: device.isStale,
      [DeviceHealthGroupAlias.HasDownInterfaces]: device.interfacesDown > 0,
      [DeviceFleetScanAlias.Vendor]: device.vendor,
      [DeviceHealthGroupAlias.DeviceCount]: "0",
      [DeviceHealthGroupAlias.InterfacesDownTotal]: "0",
      [DeviceFleetScanAlias.DevicesWithoutSite]: "0",
      [DeviceFleetScanAlias.SnmpFailing]: "0",
    };

    const add: (alias: string, value: number) => void = (
      alias: string,
      value: number,
    ): void => {
      row[alias] = String(Number(row[alias]) + value);
    };

    add(DeviceHealthGroupAlias.DeviceCount, 1);
    add(DeviceHealthGroupAlias.InterfacesDownTotal, device.interfacesDown);
    add(DeviceFleetScanAlias.DevicesWithoutSite, device.hasSite ? 0 : 1);
    add(
      DeviceFleetScanAlias.SnmpFailing,
      device.isReachable === true && device.isSnmpReachable === false ? 1 : 0,
    );

    rows.set(key, row);
  }

  return Array.from(rows.values()).sort(
    (first: AggregateRow, second: AggregateRow): number => {
      return collate(
        String(first[DeviceFleetScanAlias.Vendor]),
        String(second[DeviceFleetScanAlias.Vendor]),
      );
    },
  );
}

// Buckets in a total order, for buckets the health order leaves tied.
function canonical(groups: Array<DeviceHealthGroup>): Array<string> {
  return groups
    .map((group: DeviceHealthGroup): string => {
      return JSON.stringify(group);
    })
    .sort();
}

// What the health order decides of the buckets' order.
function orderOf(
  groups: Array<DeviceHealthGroup>,
): Array<[string | null, number]> {
  return groups.map((group: DeviceHealthGroup): [string | null, number] => {
    return [group.monitorStatusId, group.deviceCount];
  });
}

describe("readDeviceFleetScan answers what the four reads answered", () => {
  test("for 300 random fleets: the same numbers, buckets in their order, and the breakdown's six", () => {
    for (let seed: number = 1; seed <= 300; seed++) {
      const devices: Array<Device> = randomFleet(seed);
      const separate: DeviceFleetScan = readSeparately(devices);
      const folded: DeviceFleetScan = readDeviceFleetScan(foldedRows(devices));

      expect({ seed, summary: folded.summary }).toEqual({
        seed,
        summary: separate.summary,
      });
      expect({ seed, snmpFailing: folded.snmpFailing }).toEqual({
        seed,
        snmpFailing: separate.snmpFailing,
      });
      // The same buckets...
      expect({ seed, groups: canonical(folded.healthGroups) }).toEqual({
        seed,
        groups: canonical(separate.healthGroups),
      });
      // ...in the health order wherever it decides one (status, then size).
      expect({ seed, order: orderOf(folded.healthGroups) }).toEqual({
        seed,
        order: orderOf(separate.healthGroups),
      });
      expect({ seed, vendors: folded.vendors.slice(0, 6) }).toEqual({
        seed,
        vendors: separate.vendors,
      });
    }
  });

  test("a tie of counts keeps the order the database gave the vendors", () => {
    const devices: Array<Device> = [
      "Zyxel",
      "Arista",
      "Cisco",
      "Arista",
      "Zyxel",
      "Cisco",
    ].map((vendor: string): Device => {
      return {
        monitorStatusId: null,
        monitoringMethod: "Probe",
        isReachable: true,
        hasBeenPolled: true,
        hasBeenSeen: true,
        isStale: false,
        interfacesDown: 0,
        vendor: vendor,
        hasSite: true,
        isSnmpReachable: true,
      };
    });

    expect(readDeviceFleetScan(foldedRows(devices)).vendors).toEqual([
      { vendor: "Arista", count: 2 },
      { vendor: "Cisco", count: 2 },
      { vendor: "Zyxel", count: 2 },
    ]);
  });

  test("no devices: every number zero, no bucket, no vendor", () => {
    expect(readDeviceFleetScan([])).toEqual({
      summary: {
        devicesUp: 0,
        devicesDown: 0,
        devicesPending: 0,
        interfacesDown: 0,
        totalDevices: 0,
        devicesWithoutSite: 0,
      },
      healthGroups: [],
      vendors: [],
      snmpFailing: 0,
    });
  });

  test("the three reachability states partition the fleet", () => {
    for (let seed: number = 1; seed <= 50; seed++) {
      const summary: DeviceFleetSummary = readDeviceFleetScan(
        foldedRows(randomFleet(seed)),
      ).summary;

      expect(
        summary.devicesUp + summary.devicesDown + summary.devicesPending,
      ).toBe(summary.totalDevices);
    }
  });
});

describe("the fleet scan's columns", () => {
  test("group by the health facts and the vendor, nothing else", () => {
    expect(
      DEVICE_FLEET_SCAN_GROUP_COLUMNS.map((column: { alias: string }) => {
        return column.alias;
      }),
    ).toEqual([
      ...DEVICE_HEALTH_GROUP_COLUMNS.map((column: { alias: string }) => {
        return column.alias;
      }),
      "vendor",
    ]);
  });

  test("count devices, dark ports, devices with no site and failing walks", () => {
    expect(
      DEVICE_FLEET_SCAN_AGGREGATES.map((column: { alias: string }) => {
        return column.alias;
      }),
    ).toEqual([
      "deviceCount",
      "interfacesDownTotal",
      "devicesWithoutSite",
      "snmpFailing",
    ]);
  });

  /*
   * The Overview's SNMP-failing attention read is the project's devices,
   * not archived, with isReachable = true and isSnmpReachable = false: the
   * count is the same filter, within the same project and archive filter
   * the scan reads by.
   */
  test("count a failing walk by the attention read's own filter", () => {
    expect(SNMP_FAILING_AGGREGATE.expression).toBe(
      `COUNT(*) FILTER (WHERE "NetworkDevice"."isReachable" = true AND "NetworkDevice"."isSnmpReachable" = false)`,
    );
  });

  test("order the buckets by vendor, as the breakdown broke a tie", () => {
    expect(DEVICE_FLEET_SCAN_ORDER).toEqual([
      { expression: `"vendor"`, sortOrder: SortOrder.Ascending },
    ]);
  });
});
