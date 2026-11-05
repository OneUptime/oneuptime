/*
 * What the worker would keep on a cloud, from an estate's rows, by the code it runs. A recording's
 * rows carry real Placement numbers, and made-up estates carry whatever hypervisor() gives them,
 * so a walk reads the page on what the scan really wrote.
 *
 * ?capacity=short is made up in the snapshot's own shape, for what no recording holds: a fragmented
 * estate, a zone that can't lose a host, a forecast, an orphaned allocation and a probe's answer.
 */
import {
  buildOpenStackCapacitySnapshot,
  readOpenStackCapacityExternalNetwork,
  readOpenStackCapacityFlavor,
  readOpenStackCapacityHost,
  readOpenStackCapacityStoragePool,
} from "../../../Common/Types/OpenStack/OpenStackCapacitySnapshot";
import { getOpenStackCapacitySeriesRows } from "../../../Common/Types/OpenStack/OpenStackCapacitySeries";

const HOUR = 60 * 60 * 1000;

function forecastsOf(snapshot) {
  return getOpenStackCapacitySeriesRows(snapshot).map((row) => {
    return {
      scope: row.scope,
      name: row.name,
      id: row.id,
      regionName: row.regionName,
      resourceClass: row.resourceClass,
      forecast: { state: "not-enough-history" },
    };
  });
}

function shortSnapshot(loadedAt) {
  const inventory = (total, reserved, allocationRatio, used) => {
    return { total, reserved, allocationRatio, used };
  };
  const host = (name, zone, used, extra = {}) => {
    return {
      name,
      regionName: "RegionOne",
      zone,
      aggregates: zone === "zone-a" ? ["rack-1"] : [],
      state: "up",
      instanceCount: 12,
      inventories: {
        VCPU: inventory(64, 0, 4, 200),
        MEMORY_MB: inventory(262144, 2048, 1, used),
        DISK_GB: inventory(2000, 0, 1, 900),
      },
      ...extra,
    };
  };
  const flavor = (name, resources, extra = {}) => {
    return {
      id: name,
      name,
      regionName: "RegionOne",
      request: { resources, requiredTraits: [], forbiddenTraits: [] },
      isPublic: true,
      isDisabled: false,
      instanceCount: 0,
      placementAnswer: null,
      ...extra,
    };
  };

  const snapshot = buildOpenStackCapacitySnapshot({
    hosts: [
      host("cmp-a1.acme.example", "zone-a", 230000),
      host("cmp-a2.acme.example", "zone-a", 230000),
      host("cmp-a3.acme.example", "zone-a", 230000),
      host("cmp-b1.acme.example", "zone-b", 100000),
      host("cmp-b2.acme.example", "zone-b", 100000),
      host("cmp-b3.acme.example", "zone-b", 0, {
        state: "lost",
        instanceCount: 42,
      }),
    ],
    flavors: [
      flavor(
        "m1.small",
        { VCPU: 1, MEMORY_MB: 2048, DISK_GB: 20 },
        {
          instanceCount: 340,
          placementAnswer: {
            askedAt: new Date(loadedAt - 8 * 60 * 1000).toISOString(),
            fits: 340,
            hostsWithRoom: 5,
            isCapped: false,
            byZone: { "zone-a": 44, "zone-b": 296 },
            byAggregate: { "rack-1": 44 },
          },
        },
      ),
      // 30 GB free on each of zone-a's hosts, and 160 on zone-b's two, with none of this size.
      flavor("m1.xlarge", { VCPU: 8, MEMORY_MB: 200000, DISK_GB: 160 }, {
        instanceCount: 8,
      }),
      flavor("ou.impossible", { VCPU: 1, MEMORY_MB: 1048576 }),
      flavor(
        "gold.large",
        { VCPU: 4, MEMORY_MB: 8192, DISK_GB: 80 },
        {
          request: {
            resources: { VCPU: 4, MEMORY_MB: 8192, DISK_GB: 80 },
            requiredTraits: ["CUSTOM_GOLD"],
            forbiddenTraits: [],
          },
          isPublic: false,
          instanceCount: 3,
        },
      ),
    ],
    pools: [
      {
        kind: "external-ip-pool",
        id: "public-net",
        name: "public",
        regionName: "RegionOne",
        used: 200,
        capacity: 253,
        percent: (200 / 253) * 100,
      },
    ],
    mismatches: [
      {
        regionName: "RegionOne",
        hypervisorName: "cmp-a2.acme.example",
        vcpuExcess: 8,
        memoryMbExcess: 16384,
        instanceCount: 11,
        since: new Date(loadedAt - 6 * HOUR).toISOString(),
      },
    ],
    now: new Date(loadedAt - 60 * 1000),
  });

  return {
    ...snapshot,
    forecasts: [
      {
        scope: "zone",
        name: "zone-a",
        id: "",
        regionName: "RegionOne",
        resourceClass: "MEMORY_MB",
        forecast: { state: "days", days: 9.2 },
      },
      {
        scope: "external-ip-pool",
        name: "public",
        id: "public-net",
        regionName: "RegionOne",
        resourceClass: "IPV4_ADDRESS",
        forecast: { state: "days", days: 41 },
      },
      {
        scope: "zone",
        name: "zone-b",
        id: "",
        regionName: "RegionOne",
        resourceClass: "VCPU",
        forecast: { state: "not-growing" },
      },
    ],
    forecastsReadAt: new Date(loadedAt - 10 * 60 * 1000).toISOString(),
    zones: snapshot.zones.map((zone) => {
      return zone.name === "zone-a"
        ? {
            ...zone,
            overcommit: [
              {
                resourceClass: "VCPU",
                allocationRatio: 4,
                allocatedRatio: 3.1,
                realPercent: 31,
                busiestPercent: 44,
                hostsWithReading: 3,
                hostCount: 3,
                ratioAtLine: 9,
                linePercent: 90,
              },
            ],
          }
        : zone;
    }),
  };
}

export function buildCapacitySnapshotOf(rows, options) {
  if (options.scenario === "short") {
    return shortSnapshot(options.loadedAt);
  }

  const ofKind = (kind) => {
    return rows.filter((row) => {
      return row.kind === kind;
    });
  };

  const pools = [
    ...ofKind("StoragePool").map(readOpenStackCapacityStoragePool),
    ...ofKind("Network").map(readOpenStackCapacityExternalNetwork),
  ].filter((pool) => {
    return Boolean(pool);
  });

  const snapshot = buildOpenStackCapacitySnapshot({
    hosts: ofKind("Hypervisor").map(readOpenStackCapacityHost),
    flavors: ofKind("Flavor").map((row) => {
      return readOpenStackCapacityFlavor({ row, instanceCount: 0 });
    }),
    pools,
    now: new Date(options.loadedAt - 60 * 1000),
  });

  // A walk's cloud has no metric store's history behind it, so it reads as a new one.
  return { ...snapshot, forecasts: forecastsOf(snapshot) };
}
