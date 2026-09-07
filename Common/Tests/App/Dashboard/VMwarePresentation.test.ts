import { describe, expect, test } from "@jest/globals";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import VMwareSource from "../../../Models/DatabaseModels/VMwareSource";
import VMwareResource from "../../../Models/DatabaseModels/VMwareResource";
import {
  isFresh,
  metricValue,
  sourceStatus,
  resourceStatus,
  metricQuery,
  VMWARE_STALE_MS,
  SOURCE_ATTRIBUTE,
  RESOURCE_ATTRIBUTE,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils";

const now: number = new Date("2026-09-07T12:00:00Z").getTime();
const source: VMwareSource = {
  lastSeenAt: new Date(now),
  lastCollectionAt: new Date(now),
  lastSuccessfulCollectionAt: new Date(now),
  metrics: {
    "oneuptime.vmware.source.up": 1,
    "oneuptime.vmware.source.inventory.complete": 1,
  },
} as VMwareSource;
const resource: VMwareResource = {
  resourceType: "vm",
  lastSeenAt: new Date(now),
  metadata: {
    "oneuptime.vmware.resource.observed": true,
    "oneuptime.vmware.resource.power_state": "poweredOn",
  },
  metrics: { "oneuptime.vmware.vm.cpu.utilization": 0 },
} as VMwareResource;

describe("VMware current state presentation", () => {
  test("performance telemetry cannot keep a stopped inventory companion healthy", () => {
    expect(
      sourceStatus(
        {
          ...source,
          lastSeenAt: new Date(now),
          lastCollectionAt: new Date(now - VMWARE_STALE_MS - 1),
        } as VMwareSource,
        now,
      ),
    ).toBe("Collection stale");
    expect(sourceStatus({ ...source, metrics: {} } as VMwareSource, now)).toBe(
      "Waiting for collection status",
    );
  });
  test("freshness follows the configured collection interval", () => {
    const lastCollectionAt: Date = new Date(now - 120000);
    expect(
      sourceStatus(
        {
          ...source,
          lastCollectionAt,
          collectionIntervalSeconds: 10,
        } as VMwareSource,
        now,
      ),
    ).toBe("Collection stale");
    expect(
      sourceStatus(
        {
          ...source,
          lastCollectionAt,
          collectionIntervalSeconds: 600,
        } as VMwareSource,
        now,
      ),
    ).toBe("Connected");
  });
  test("requires a recent successful collection, independently of heartbeat", () => {
    expect(sourceStatus(source, now)).toBe("Connected");
    expect(
      sourceStatus(
        { ...source, lastSuccessfulCollectionAt: undefined } as VMwareSource,
        now,
      ),
    ).toBe("Waiting for successful collection");
    expect(
      sourceStatus(
        {
          ...source,
          metrics: { "oneuptime.vmware.source.up": 0 },
        } as VMwareSource,
        now,
      ),
    ).toBe("Collection failed");
    expect(
      sourceStatus(
        {
          ...source,
          metrics: { "oneuptime.vmware.source.inventory.complete": 0 },
        } as VMwareSource,
        now,
      ),
    ).toBe("Partial inventory");
  });
  test("rejects missing, invalid, old, and excessively future observations", () => {
    expect(isFresh(undefined, now)).toBe(false);
    expect(isFresh(new Date("invalid"), now)).toBe(false);
    expect(isFresh(new Date(now - VMWARE_STALE_MS - 1), now)).toBe(false);
    expect(isFresh(new Date(now + 120000), now)).toBe(false);
    expect(isFresh(new Date(now - VMWARE_STALE_MS), now)).toBe(true);
  });
  test("source silence makes even a previously running VM unknown", () => {
    const stale: VMwareSource = {
      ...source,
      lastCollectionAt: new Date(now - VMWARE_STALE_MS - 1),
    } as VMwareSource;
    expect(resourceStatus(resource, stale, now)).toBe("Unknown · stale data");
    expect(
      metricValue(resource, "oneuptime.vmware.vm.cpu.utilization", stale, now),
    ).toBeNull();
  });
  test("keeps zero measurements distinct from missing or nonnumeric values", () => {
    expect(
      metricValue(resource, "oneuptime.vmware.vm.cpu.utilization", source, now),
    ).toBe(0);
    expect(metricValue(resource, "missing", source, now)).toBeNull();
    expect(
      metricValue(
        { ...resource, metrics: { value: "0" } } as VMwareResource,
        "value",
        source,
        now,
      ),
    ).toBeNull();
    expect(
      metricValue(
        { ...resource, metrics: { value: NaN } } as VMwareResource,
        "value",
        source,
        now,
      ),
    ).toBeNull();
  });
  test("power-off only violates an explicit or inherited expected-running policy", () => {
    const off: VMwareResource = {
      ...resource,
      metadata: {
        "oneuptime.vmware.resource.power_state": "poweredOff",
        "oneuptime.vmware.vm.expected_running": true,
      },
    } as VMwareResource;
    expect(resourceStatus(off, source, now)).toBe(
      "Expected running · powered off",
    );
    expect(
      resourceStatus(
        { ...off, expectedRunning: false } as VMwareResource,
        source,
        now,
      ),
    ).toBe("Powered off");
    expect(
      resourceStatus(
        { ...off, expectedRunning: true } as VMwareResource,
        source,
        now,
      ),
    ).toBe("Expected running · powered off");
  });
  test("maintenance can inherit the collector and false overrides inherited maintenance", () => {
    const maintained: VMwareResource = {
      ...resource,
      metadata: {
        ...resource.metadata,
        "oneuptime.vmware.host.maintenance": true,
      },
    } as VMwareResource;
    expect(resourceStatus(maintained, source, now)).toBe("Maintenance");
    expect(
      resourceStatus(
        { ...maintained, maintenanceMode: false } as VMwareResource,
        source,
        now,
      ),
    ).toBe("Running");
    expect(
      resourceStatus(
        { ...resource, maintenanceMode: true } as VMwareResource,
        source,
        now,
      ),
    ).toBe("Maintenance");
  });
  test("explicit absence and retirement never show a healthy or zero-utilization resource", () => {
    const absent: VMwareResource = {
      ...resource,
      lastSeenAt: new Date(now - VMWARE_STALE_MS - 1),
      metadata: { "oneuptime.vmware.resource.observed": false },
    } as VMwareResource;
    expect(resourceStatus(absent, source, now)).toBe("Not observed");
    expect(
      metricValue(absent, "oneuptime.vmware.vm.cpu.utilization", source, now),
    ).toBeNull();
    expect(
      resourceStatus(
        {
          ...absent,
          metadata: { "oneuptime.vmware.resource.retired": true },
        } as VMwareResource,
        source,
        now,
      ),
    ).toBe("Retired");
  });
  test("critical reported health remains visible for a running VM", () => {
    expect(
      resourceStatus(
        {
          ...resource,
          metadata: {
            ...resource.metadata,
            "oneuptime.vmware.resource.state": "critical",
          },
        } as VMwareResource,
        source,
        now,
      ),
    ).toBe("Critical health");
  });
});

describe("VMware chart scope", () => {
  test("scopes resource history by stable source and resource identity", () => {
    const query: MetricQueryConfigData = metricQuery(
      "east / production",
      "oneuptime.vmware.vm.cpu.utilization",
      "CPU",
      "vm-42",
    );
    expect(query.metricQueryData.filterData.attributes).toEqual({
      [SOURCE_ATTRIBUTE]: "east / production",
      [RESOURCE_ATTRIBUTE]: "vm-42",
    });
    expect(query.metricQueryData.groupByAttributeKeys).toBeUndefined();
    expect(query.metricAliasData?.legendUnit).toBe("%");
  });
  test("source comparisons split resources instead of averaging the entire fleet", () => {
    const query: MetricQueryConfigData = metricQuery(
      "east",
      "oneuptime.vmware.host.cpu.utilization",
      "Host CPU",
    );
    expect(query.metricQueryData.groupByAttributeKeys).toEqual([
      RESOURCE_ATTRIBUTE,
    ]);
    expect(query.metricQueryData.topN).toBe(10);
  });
});
