import {
  VMWARE_SNAPSHOT_METRIC_NAMES,
  VMwareResourceBufferEntry,
  VMwareResourceIdentity,
  VMwareResourceLatestMetricSnapshot,
  VMwareVCenterSnapshotBufferEntry,
  VMwareVCenterSnapshotExtras,
  boundVMwareExternalId,
  bufferVMwareSnapshotMetric,
  computeVMwareIsPoweredOn,
  deriveVMwareResourceLatestMetric,
  deriveVMwareVCenterSnapshotExtras,
  getOrCreateVMwareVCenterSnapshot,
  resolveVMwareResourceIdentity,
  toVMwareResourceAttributeMap,
} from "../../../../Server/Utils/Telemetry/VMwareSnapshotScan";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import { VMwareResourceKind } from "../../../../Types/Monitor/MonitorStepVMwareMonitor";
import crypto from "crypto";

/*
 * The VMware snapshot scan, fed with synthetic OTLP datapoints in the
 * exact JSON shape the vcenter receiver emits through the OTLP decode
 * (asInt/asDouble + timeUnixNano + a key/value attribute array whose
 * values are stringValue / boolValue) plus the RESOURCE attribute map
 * the ingest service resolves per resource block. Locks in:
 *
 *   - the kind-resolution order and the externalId scheme for every
 *     kind (VMs, templates, vApp members, cluster and standalone-host
 *     resource pools),
 *   - identity first-non-null-wins / metric newest-observedAt-wins,
 *   - the summed-count fold across attribute fan-out (newer timestamp
 *     resets, equal adds, older ignored),
 *   - the unit conversions (MiBy → bytes, used + available, derived
 *     memory capacity fallbacks),
 *   - powered-on inference from the presence of vcenter.vm.cpu.*,
 *   - the never-zero-a-count-on-a-partial-batch contract for the
 *     vCenter extras,
 *   - the 100-char externalId bound (prefix + "~" + 16-hex sha1 of the
 *     full id) that keeps two long inventory paths from ever clamping
 *     to the same unique-index key downstream,
 *   - non-allow-listed / non-finite / kind-mismatched points never
 *     reaching the inventory fold.
 */

const VCENTER: string = "0a1b2c3d-0000-0000-0000-000000000001";

// 2023-11-14T22:13:20.000Z — an arbitrary fixed collection instant.
const BASE_MS: number = 1700000000000;

const MIB: number = 1024 * 1024;

type LabelMap = Record<string, string | boolean>;

function toNano(ms: number): string {
  return `${ms}000000`;
}

function datapoint(data: {
  value: number;
  atMs?: number;
  labels?: LabelMap;
  asDouble?: boolean;
}): JSONObject {
  const attributes: Array<JSONObject> = Object.entries(data.labels || {}).map(
    ([key, value]: [string, string | boolean]) => {
      return {
        key,
        value:
          typeof value === "boolean"
            ? { boolValue: value }
            : { stringValue: value },
      };
    },
  );
  return {
    ...(data.asDouble ? { asDouble: data.value } : { asInt: data.value }),
    timeUnixNano: toNano(data.atMs ?? BASE_MS),
    attributes,
  };
}

// The resource attribute shapes the vcenter receiver emits per object.
const DC: Record<string, string> = { "vcenter.datacenter.name": "DC1" };
const CLUSTER: Record<string, string> = {
  ...DC,
  "vcenter.cluster.name": "Prod-Cluster",
};
const HOST: Record<string, string> = {
  ...CLUSTER,
  "vcenter.host.name": "esx01.example.com",
};
const STANDALONE_HOST: Record<string, string> = {
  ...DC,
  "vcenter.host.name": "esx-edge.example.com",
};
const VM_ON: Record<string, string> = {
  ...HOST,
  "vcenter.vm.name": "web-01",
  "vcenter.vm.id": "5030a1b2-0000-4000-8000-000000000001",
  "vcenter.resource_pool.name": "Web",
  "vcenter.resource_pool.inventory_path":
    "/DC1/host/Prod-Cluster/Resources/Web",
};
const VM_OFF: Record<string, string> = {
  ...HOST,
  "vcenter.vm.name": "batch-02",
  "vcenter.vm.id": "5030a1b2-0000-4000-8000-000000000002",
  "vcenter.virtual_app.name": "Batch vApp",
  "vcenter.virtual_app.inventory_path":
    "/DC1/host/Prod-Cluster/Resources/Batch vApp",
};
const TEMPLATE: Record<string, string> = {
  ...HOST,
  "vcenter.vm_template.name": "ubuntu-22.04-template",
  "vcenter.vm_template.id": "5030a1b2-0000-4000-8000-0000000000aa",
};
const DATASTORE: Record<string, string> = {
  ...DC,
  "vcenter.datastore.name": "vsanDatastore",
};
const RESOURCE_POOL: Record<string, string> = {
  ...CLUSTER,
  "vcenter.resource_pool.name": "Web",
  "vcenter.resource_pool.inventory_path":
    "/DC1/host/Prod-Cluster/Resources/Web",
};
const STANDALONE_RESOURCE_POOL: Record<string, string> = {
  ...STANDALONE_HOST,
  "vcenter.resource_pool.name": "Resources",
  "vcenter.resource_pool.inventory_path":
    "/DC1/host/esx-edge.example.com/Resources",
};

interface Buffers {
  resourceBuffer: Map<string, Map<string, VMwareResourceBufferEntry>>;
  vcenterBuffer: Map<string, VMwareVCenterSnapshotBufferEntry>;
}

function buffers(): Buffers {
  return { resourceBuffer: new Map(), vcenterBuffer: new Map() };
}

function feed(
  b: Buffers,
  resourceAttributes: Record<string, unknown>,
  metricName: string,
  dp: JSONObject,
): void {
  bufferVMwareSnapshotMetric({
    vcenterIdStr: VCENTER,
    metricName,
    resourceAttributes,
    datapoint: dp,
    resourceBuffer: b.resourceBuffer,
    vcenterBuffer: b.vcenterBuffer,
  });
}

function entries(b: Buffers): Array<VMwareResourceBufferEntry> {
  return Array.from(b.resourceBuffer.get(VCENTER)?.values() || []);
}

function entry(
  b: Buffers,
  kind: string,
  externalId: string,
): VMwareResourceBufferEntry {
  const found: VMwareResourceBufferEntry | undefined = b.resourceBuffer
    .get(VCENTER)
    ?.get(`${kind}|${externalId}`);
  if (!found) {
    throw new Error(`expected buffered entry ${kind}|${externalId}`);
  }
  return found;
}

function extras(b: Buffers): VMwareVCenterSnapshotExtras {
  return deriveVMwareVCenterSnapshotExtras(
    entries(b),
    b.vcenterBuffer.get(VCENTER),
  );
}

// Feed the whole §3 column table: one resource of each kind.
function feedFullCollection(b: Buffers, atMs: number = BASE_MS): void {
  // Datacenter
  feed(
    b,
    DC,
    "vcenter.datacenter.cpu.limit",
    datapoint({ value: 96000, atMs }),
  );
  feed(
    b,
    DC,
    "vcenter.datacenter.memory.limit",
    datapoint({ value: 512 * 1024 * MIB, atMs }),
  );
  feed(
    b,
    DC,
    "vcenter.datacenter.disk.space",
    datapoint({ value: 30 * 1024 * MIB, atMs, labels: { disk_state: "used" } }),
  );
  feed(
    b,
    DC,
    "vcenter.datacenter.disk.space",
    datapoint({
      value: 70 * 1024 * MIB,
      atMs,
      labels: { disk_state: "available" },
    }),
  );
  feed(
    b,
    DC,
    "vcenter.datacenter.host.count",
    datapoint({
      value: 3,
      atMs,
      labels: { status: "green", power_state: "on" },
    }),
  );
  feed(
    b,
    DC,
    "vcenter.datacenter.host.count",
    datapoint({
      value: 1,
      atMs,
      labels: { status: "gray", power_state: "off" },
    }),
  );
  feed(
    b,
    DC,
    "vcenter.datacenter.vm.count",
    datapoint({
      value: 40,
      atMs,
      labels: { status: "green", power_state: "on" },
    }),
  );
  feed(
    b,
    DC,
    "vcenter.datacenter.vm.count",
    datapoint({
      value: 5,
      atMs,
      labels: { status: "green", power_state: "off" },
    }),
  );
  feed(
    b,
    DC,
    "vcenter.datacenter.cluster.count",
    datapoint({ value: 1, atMs, labels: { status: "green" } }),
  );
  feed(
    b,
    DC,
    "vcenter.datacenter.cluster.count",
    datapoint({ value: 1, atMs, labels: { status: "yellow" } }),
  );
  feed(
    b,
    DC,
    "vcenter.datacenter.datastore.count",
    datapoint({ value: 4, atMs }),
  );

  // Cluster
  feed(
    b,
    CLUSTER,
    "vcenter.cluster.cpu.limit",
    datapoint({ value: 64000, atMs }),
  );
  feed(
    b,
    CLUSTER,
    "vcenter.cluster.cpu.effective",
    datapoint({ value: 60000, atMs }),
  );
  feed(
    b,
    CLUSTER,
    "vcenter.cluster.memory.limit",
    datapoint({ value: 256 * 1024 * MIB, atMs }),
  );
  feed(
    b,
    CLUSTER,
    "vcenter.cluster.memory.effective",
    datapoint({ value: 240 * 1024 * MIB, atMs }),
  );
  feed(
    b,
    CLUSTER,
    "vcenter.cluster.host.count",
    datapoint({ value: 2, atMs, labels: { effective: true } }),
  );
  feed(
    b,
    CLUSTER,
    "vcenter.cluster.host.count",
    datapoint({ value: 1, atMs, labels: { effective: false } }),
  );
  feed(
    b,
    CLUSTER,
    "vcenter.cluster.vm.count",
    datapoint({ value: 30, atMs, labels: { power_state: "on" } }),
  );
  feed(
    b,
    CLUSTER,
    "vcenter.cluster.vm.count",
    datapoint({ value: 4, atMs, labels: { power_state: "off" } }),
  );
  feed(
    b,
    CLUSTER,
    "vcenter.cluster.vm.count",
    datapoint({ value: 1, atMs, labels: { power_state: "suspended" } }),
  );
  feed(
    b,
    CLUSTER,
    "vcenter.cluster.vm_template.count",
    datapoint({ value: 2, atMs }),
  );

  // Host
  feed(
    b,
    HOST,
    "vcenter.host.cpu.utilization",
    datapoint({ value: 42.5, atMs, asDouble: true }),
  );
  feed(b, HOST, "vcenter.host.cpu.usage", datapoint({ value: 13600, atMs }));
  feed(b, HOST, "vcenter.host.cpu.capacity", datapoint({ value: 32000, atMs }));
  feed(b, HOST, "vcenter.host.memory.usage", datapoint({ value: 65536, atMs }));
  feed(
    b,
    HOST,
    "vcenter.host.memory.capacity",
    datapoint({ value: 131072, atMs }),
  );
  feed(
    b,
    HOST,
    "vcenter.host.memory.utilization",
    datapoint({ value: 50, atMs, asDouble: true }),
  );

  // Powered-on VM
  feed(
    b,
    VM_ON,
    "vcenter.vm.cpu.utilization",
    datapoint({ value: 12.5, atMs, asDouble: true }),
  );
  feed(b, VM_ON, "vcenter.vm.cpu.usage", datapoint({ value: 800, atMs }));
  feed(
    b,
    VM_ON,
    "vcenter.vm.cpu.readiness",
    datapoint({ value: 1.5, atMs, asDouble: true }),
  );
  feed(b, VM_ON, "vcenter.vm.memory.usage", datapoint({ value: 2048, atMs }));
  feed(
    b,
    VM_ON,
    "vcenter.vm.memory.utilization",
    datapoint({ value: 25, atMs, asDouble: true }),
  );
  feed(b, VM_ON, "vcenter.vm.memory.ballooned", datapoint({ value: 0, atMs }));
  feed(b, VM_ON, "vcenter.vm.memory.swapped", datapoint({ value: 0, atMs }));
  feed(
    b,
    VM_ON,
    "vcenter.vm.disk.usage",
    datapoint({ value: 20 * 1024 * MIB, atMs, labels: { disk_state: "used" } }),
  );
  feed(
    b,
    VM_ON,
    "vcenter.vm.disk.usage",
    datapoint({
      value: 80 * 1024 * MIB,
      atMs,
      labels: { disk_state: "available" },
    }),
  );
  feed(
    b,
    VM_ON,
    "vcenter.vm.disk.utilization",
    datapoint({ value: 20, atMs, asDouble: true }),
  );

  // Powered-off VM (no vcenter.vm.cpu.* points)
  feed(b, VM_OFF, "vcenter.vm.memory.usage", datapoint({ value: 0, atMs }));
  feed(
    b,
    VM_OFF,
    "vcenter.vm.disk.usage",
    datapoint({ value: 10 * 1024 * MIB, atMs, labels: { disk_state: "used" } }),
  );
  feed(
    b,
    VM_OFF,
    "vcenter.vm.disk.usage",
    datapoint({
      value: 30 * 1024 * MIB,
      atMs,
      labels: { disk_state: "available" },
    }),
  );

  // Template (disk usage only)
  feed(
    b,
    TEMPLATE,
    "vcenter.vm.disk.usage",
    datapoint({ value: 5 * 1024 * MIB, atMs, labels: { disk_state: "used" } }),
  );

  // Datastore
  feed(
    b,
    DATASTORE,
    "vcenter.datastore.disk.usage",
    datapoint({
      value: 30 * 1024 * MIB,
      atMs,
      labels: { disk_state: "used" },
    }),
  );
  feed(
    b,
    DATASTORE,
    "vcenter.datastore.disk.usage",
    datapoint({
      value: 70 * 1024 * MIB,
      atMs,
      labels: { disk_state: "available" },
    }),
  );
  feed(
    b,
    DATASTORE,
    "vcenter.datastore.disk.utilization",
    datapoint({ value: 30, atMs, asDouble: true }),
  );

  // Resource pool
  feed(
    b,
    RESOURCE_POOL,
    "vcenter.resource_pool.cpu.usage",
    datapoint({ value: 1200, atMs }),
  );
  feed(
    b,
    RESOURCE_POOL,
    "vcenter.resource_pool.memory.usage",
    datapoint({ value: 4096, atMs, labels: { type: "guest" } }),
  );
  feed(
    b,
    RESOURCE_POOL,
    "vcenter.resource_pool.memory.usage",
    datapoint({ value: 999999, atMs, labels: { type: "host" } }),
  );
  feed(
    b,
    RESOURCE_POOL,
    "vcenter.resource_pool.memory.ballooned",
    datapoint({ value: 16, atMs }),
  );
  feed(
    b,
    RESOURCE_POOL,
    "vcenter.resource_pool.memory.swapped",
    datapoint({ value: 8, atMs }),
  );
}

describe("VMwareSnapshotScan - metric allow-list", () => {
  test("every §3 column source is allow-listed", () => {
    for (const name of [
      "vcenter.host.cpu.utilization",
      "vcenter.host.memory.capacity",
      "vcenter.vm.cpu.readiness",
      "vcenter.vm.disk.usage",
      "vcenter.datastore.disk.utilization",
      "vcenter.cluster.host.count",
      "vcenter.cluster.vm_template.count",
      "vcenter.datacenter.disk.space",
      "vcenter.datacenter.cluster.count",
      "vcenter.resource_pool.memory.swapped",
    ]) {
      expect(VMWARE_SNAPSHOT_METRIC_NAMES.has(name)).toBe(true);
    }
    expect(VMWARE_SNAPSHOT_METRIC_NAMES.size).toBe(35);
  });

  test("perf-only series are not allow-listed (the ingest gate)", () => {
    // Latency / throughput / packet / vSAN series go to ClickHouse only.
    for (const name of [
      "vcenter.host.disk.latency.max",
      "vcenter.host.network.packet.error.rate",
      "vcenter.vm.network.throughput",
      "vcenter.cluster.vsan.latency.avg",
      "vcenter.host.vsan.congestions",
      "vcenter.resource_pool.cpu.shares",
      "vcenter.vm.memory.granted",
    ]) {
      expect(VMWARE_SNAPSHOT_METRIC_NAMES.has(name)).toBe(false);
    }
  });

  test("a non-allow-listed metric name never creates an inventory row", () => {
    const b: Buffers = buffers();
    /*
     * Defense in depth: even if the Set gate were bypassed, the fold's
     * metric-name switch drops unknown names.
     */
    feed(b, HOST, "vcenter.host.network.usage", datapoint({ value: 1234 }));
    expect(entries(b)).toHaveLength(0);
    expect(b.vcenterBuffer.size).toBe(0);
  });

  test("a metric folded onto a resource of the wrong kind is dropped", () => {
    const b: Buffers = buffers();
    // A VM resource also carries vcenter.host.name — host series stay off it.
    feed(b, VM_ON, "vcenter.host.cpu.usage", datapoint({ value: 100 }));
    expect(entries(b)).toHaveLength(0);
  });
});

describe("VMwareSnapshotScan - identity resolution", () => {
  test("toVMwareResourceAttributeMap flattens scalars and drops nested values", () => {
    const attributes: JSONArray = [
      { key: "vcenter.datacenter.name", value: { stringValue: " DC1 " } },
      { key: "effective", value: { boolValue: true } },
      { key: "count", value: { intValue: "7" } },
      { key: "ratio", value: { doubleValue: 0.5 } },
      { key: "nested", value: { kvlistValue: { values: [] } } },
      { key: "", value: { stringValue: "ignored" } },
      { key: "blank", value: { stringValue: "   " } },
    ];
    expect(toVMwareResourceAttributeMap(attributes)).toEqual({
      "vcenter.datacenter.name": "DC1",
      effective: "true",
      count: "7",
      ratio: "0.5",
    });
    expect(toVMwareResourceAttributeMap(undefined)).toEqual({});
  });

  test("a VM resolves first, with the instance UUID as its externalId", () => {
    const identity: VMwareResourceIdentity | null =
      resolveVMwareResourceIdentity(VM_ON);
    expect(identity).toEqual({
      kind: "VirtualMachine",
      externalId: "vm/5030a1b2-0000-4000-8000-000000000001",
      name: "web-01",
      datacenterName: "DC1",
      clusterName: "Prod-Cluster",
      hostName: "esx01.example.com",
      resourcePoolName: "Web",
      resourcePoolPath: "/DC1/host/Prod-Cluster/Resources/Web",
      virtualAppName: null,
      vmInstanceUuid: "5030a1b2-0000-4000-8000-000000000001",
      isTemplate: false,
    });
  });

  test("a vApp member VM carries the vApp name and its inventory path", () => {
    const identity: VMwareResourceIdentity | null =
      resolveVMwareResourceIdentity(VM_OFF);
    expect(identity?.kind).toBe("VirtualMachine");
    expect(identity?.virtualAppName).toBe("Batch vApp");
    expect(identity?.resourcePoolPath).toBe(
      "/DC1/host/Prod-Cluster/Resources/Batch vApp",
    );
    expect(identity?.resourcePoolName).toBeNull();
  });

  test("a VM without an instance UUID falls back to vm/<dc>/<host>/<name>", () => {
    const identity: VMwareResourceIdentity | null =
      resolveVMwareResourceIdentity({
        ...HOST,
        "vcenter.vm.name": "legacy-vm",
      });
    expect(identity?.externalId).toBe("vm/DC1/esx01.example.com/legacy-vm");
    expect(identity?.vmInstanceUuid).toBeNull();
    expect(identity?.isTemplate).toBe(false);
  });

  test("a VM template resolves as a VirtualMachine row with isTemplate=true", () => {
    const identity: VMwareResourceIdentity | null =
      resolveVMwareResourceIdentity(TEMPLATE);
    expect(identity).toMatchObject({
      kind: "VirtualMachine",
      externalId: "vm/5030a1b2-0000-4000-8000-0000000000aa",
      name: "ubuntu-22.04-template",
      hostName: "esx01.example.com",
      vmInstanceUuid: "5030a1b2-0000-4000-8000-0000000000aa",
      isTemplate: true,
    });
  });

  test("a resource pool resolves before the host it lives on (cluster and standalone)", () => {
    const clusterPool: VMwareResourceIdentity | null =
      resolveVMwareResourceIdentity(RESOURCE_POOL);
    expect(clusterPool).toMatchObject({
      kind: "ResourcePool",
      externalId: "resourcepool//DC1/host/Prod-Cluster/Resources/Web",
      name: "Web",
      clusterName: "Prod-Cluster",
      hostName: null,
      resourcePoolPath: "/DC1/host/Prod-Cluster/Resources/Web",
      isTemplate: null,
    });

    const standalonePool: VMwareResourceIdentity | null =
      resolveVMwareResourceIdentity(STANDALONE_RESOURCE_POOL);
    expect(standalonePool).toMatchObject({
      kind: "ResourcePool",
      externalId: "resourcepool//DC1/host/esx-edge.example.com/Resources",
      clusterName: null,
      hostName: "esx-edge.example.com",
    });
  });

  test("hosts resolve in and out of a cluster", () => {
    expect(resolveVMwareResourceIdentity(HOST)).toMatchObject({
      kind: "Host",
      externalId: "host/DC1/esx01.example.com",
      name: "esx01.example.com",
      clusterName: "Prod-Cluster",
    });
    expect(resolveVMwareResourceIdentity(STANDALONE_HOST)).toMatchObject({
      kind: "Host",
      externalId: "host/DC1/esx-edge.example.com",
      clusterName: null,
    });
  });

  test("datastore, cluster and datacenter resolve by their own name", () => {
    expect(resolveVMwareResourceIdentity(DATASTORE)).toMatchObject({
      kind: "Datastore",
      externalId: "datastore/DC1/vsanDatastore",
      name: "vsanDatastore",
    });
    expect(resolveVMwareResourceIdentity(CLUSTER)).toMatchObject({
      kind: "Cluster",
      externalId: "cluster/DC1/Prod-Cluster",
      name: "Prod-Cluster",
    });
    expect(resolveVMwareResourceIdentity(DC)).toMatchObject({
      kind: "Datacenter",
      externalId: "datacenter/DC1",
      name: "DC1",
    });
  });

  test("a resource with no vcenter identity is not an inventory row", () => {
    expect(resolveVMwareResourceIdentity({})).toBeNull();
    expect(
      resolveVMwareResourceIdentity({ "vmware.vcenter.name": "vcsa-prod" }),
    ).toBeNull();
    expect(
      resolveVMwareResourceIdentity({ "vcenter.datacenter.name": "   " }),
    ).toBeNull();
  });

  test("the resource.-prefixed spelling resolves identically", () => {
    const prefixed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(VM_ON)) {
      prefixed[`resource.${key}`] = value;
    }
    expect(resolveVMwareResourceIdentity(prefixed)).toEqual(
      resolveVMwareResourceIdentity(VM_ON),
    );
  });

  test("a missing path component is dropped rather than left as an empty segment", () => {
    expect(
      resolveVMwareResourceIdentity({
        "vcenter.host.name": "esx-orphan",
      })?.externalId,
    ).toBe("host/esx-orphan");
  });

  test("externalIds are unique across every kind of one vCenter", () => {
    const ids: Array<string> = [
      DC,
      CLUSTER,
      HOST,
      STANDALONE_HOST,
      VM_ON,
      VM_OFF,
      TEMPLATE,
      DATASTORE,
      RESOURCE_POOL,
      STANDALONE_RESOURCE_POOL,
    ].map((attrs: Record<string, string>) => {
      const identity: VMwareResourceIdentity | null =
        resolveVMwareResourceIdentity(attrs);
      return `${identity?.kind}|${identity?.externalId}`;
    });
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("VMwareSnapshotScan - externalId length bound", () => {
  /*
   * vSphere allows 80-char datacenter / cluster / resource-pool names,
   * so a two-level nested pool path easily exceeds the 100-char
   * VMwareResource.externalId column. Two sibling sub-pools under such
   * a path share their first 100 chars — a plain clamp would merge them
   * into one row (or fail the INSERT chunk with Postgres 21000 when
   * both land in the same statement).
   */
  const LONG_DC: string = "Datacenter-Frankfurt-Production";
  const LONG_CLUSTER: string = "Production-Cluster-Tier1";
  const LONG_POOL_PARENT: string = `/${LONG_DC}/host/${LONG_CLUSTER}/Resources/Business-Critical-Workloads`;
  const SIBLING_A_PATH: string = `${LONG_POOL_PARENT}/SAP-HANA`;
  const SIBLING_B_PATH: string = `${LONG_POOL_PARENT}/SAP-APP`;

  const SIBLING_A: Record<string, string> = {
    "vcenter.datacenter.name": LONG_DC,
    "vcenter.cluster.name": LONG_CLUSTER,
    "vcenter.resource_pool.name": "SAP-HANA",
    "vcenter.resource_pool.inventory_path": SIBLING_A_PATH,
  };
  const SIBLING_B: Record<string, string> = {
    ...SIBLING_A,
    "vcenter.resource_pool.name": "SAP-APP",
    "vcenter.resource_pool.inventory_path": SIBLING_B_PATH,
  };

  function sha1Prefix(id: string): string {
    return crypto.createHash("sha1").update(id).digest("hex").substring(0, 16);
  }

  test("the fixture really is the failure case: raw ids exceed 100 chars and share their first 100", () => {
    const rawA: string = `resourcepool/${SIBLING_A_PATH}`;
    const rawB: string = `resourcepool/${SIBLING_B_PATH}`;
    expect(rawA.length).toBeGreaterThan(ColumnLength.ShortText);
    expect(rawB.length).toBeGreaterThan(ColumnLength.ShortText);
    expect(rawA.substring(0, ColumnLength.ShortText)).toBe(
      rawB.substring(0, ColumnLength.ShortText),
    );
  });

  test("boundVMwareExternalId leaves ids of <= 100 chars untouched", () => {
    expect(
      boundVMwareExternalId("vm/5030a1b2-0000-4000-8000-000000000001"),
    ).toBe("vm/5030a1b2-0000-4000-8000-000000000001");
    expect(
      boundVMwareExternalId(
        "resourcepool//DC1/host/Prod-Cluster/Resources/Web",
      ),
    ).toBe("resourcepool//DC1/host/Prod-Cluster/Resources/Web");
    expect(boundVMwareExternalId("")).toBe("");

    // Exactly at the bound is still "fits" — no hashing.
    const exactly100: string = "x".repeat(ColumnLength.ShortText);
    expect(boundVMwareExternalId(exactly100)).toBe(exactly100);
  });

  test("boundVMwareExternalId shortens a long id to <prefix>~<16-hex sha1 of the full id>, exactly 100 chars", () => {
    const raw: string = `resourcepool/${SIBLING_A_PATH}`;
    const bound: string = boundVMwareExternalId(raw);

    expect(bound).toHaveLength(ColumnLength.ShortText);
    expect(bound).toBe(
      `${raw.substring(0, ColumnLength.ShortText - 1 - 16)}~${sha1Prefix(raw)}`,
    );
    expect(bound).toMatch(/~[0-9a-f]{16}$/);
    // The readable prefix is preserved so the id still says what it is.
    expect(
      bound.startsWith("resourcepool//Datacenter-Frankfurt-Production/host/"),
    ).toBe(true);
    // The hash covers the FULL id, not the clamped prefix.
    expect(
      bound.endsWith(sha1Prefix(raw.substring(0, ColumnLength.ShortText))),
    ).toBe(false);
  });

  test("the bound id is stable across calls", () => {
    const raw: string = `resourcepool/${SIBLING_A_PATH}`;
    const first: string = boundVMwareExternalId(raw);
    for (let i: number = 0; i < 5; i++) {
      expect(boundVMwareExternalId(raw)).toBe(first);
    }
    // ...and the whole resolver is deterministic for the same attributes.
    expect(resolveVMwareResourceIdentity(SIBLING_A)?.externalId).toBe(first);
    expect(resolveVMwareResourceIdentity({ ...SIBLING_A })?.externalId).toBe(
      first,
    );
  });

  test("two sibling sub-pools sharing their first 100 chars resolve to distinct <= 100-char ids", () => {
    const a: VMwareResourceIdentity | null =
      resolveVMwareResourceIdentity(SIBLING_A);
    const b: VMwareResourceIdentity | null =
      resolveVMwareResourceIdentity(SIBLING_B);

    expect(a?.kind).toBe("ResourcePool");
    expect(b?.kind).toBe("ResourcePool");
    expect(a?.externalId.length).toBeLessThanOrEqual(ColumnLength.ShortText);
    expect(b?.externalId.length).toBeLessThanOrEqual(ColumnLength.ShortText);
    expect(a?.externalId).not.toBe(b?.externalId);
    // The same 83-char readable prefix, different hash suffixes.
    expect(a?.externalId.substring(0, 83)).toBe(b?.externalId.substring(0, 83));

    // The full path is still carried for display in the LongText column.
    expect(a?.resourcePoolPath).toBe(SIBLING_A_PATH);
    expect(b?.resourcePoolPath).toBe(SIBLING_B_PATH);
    expect(a?.name).toBe("SAP-HANA");
    expect(b?.name).toBe("SAP-APP");
  });

  test("every kind is bound, not just resource pools (host, datastore, cluster, datacenter, VM fallback)", () => {
    const dc: string = "D".repeat(80);
    const long: string = "N".repeat(80);
    const cases: Array<[Record<string, string>, string, string]> = [
      [{ "vcenter.datacenter.name": dc }, "Datacenter", `datacenter/${dc}`],
      [
        { "vcenter.datacenter.name": dc, "vcenter.cluster.name": long },
        "Cluster",
        `cluster/${dc}/${long}`,
      ],
      [
        { "vcenter.datacenter.name": dc, "vcenter.host.name": long },
        "Host",
        `host/${dc}/${long}`,
      ],
      [
        { "vcenter.datacenter.name": dc, "vcenter.datastore.name": long },
        "Datastore",
        `datastore/${dc}/${long}`,
      ],
      [
        {
          "vcenter.datacenter.name": dc,
          "vcenter.host.name": long,
          "vcenter.vm.name": "legacy-vm",
        },
        "VirtualMachine",
        `vm/${dc}/${long}/legacy-vm`,
      ],
      [
        {
          "vcenter.datacenter.name": dc,
          "vcenter.host.name": long,
          "vcenter.vm_template.name": "legacy-template",
        },
        "VirtualMachine",
        `vm/${dc}/${long}/legacy-template`,
      ],
    ];

    for (const [attrs, kind, raw] of cases) {
      const identity: VMwareResourceIdentity | null =
        resolveVMwareResourceIdentity(attrs);
      expect(identity?.kind).toBe(kind);
      if (raw.length <= ColumnLength.ShortText) {
        expect(identity?.externalId).toBe(raw);
      } else {
        expect(identity?.externalId).toBe(boundVMwareExternalId(raw));
        expect(identity?.externalId).toHaveLength(ColumnLength.ShortText);
      }
    }

    // A datacenter name alone (80 chars) fits: 11 + 80 = 91 — untouched.
    expect(
      resolveVMwareResourceIdentity({ "vcenter.datacenter.name": dc })
        ?.externalId,
    ).toBe(`datacenter/${dc}`);
  });

  test("a VM with an instance UUID is never hashed — the UUID form always fits", () => {
    const identity: VMwareResourceIdentity | null =
      resolveVMwareResourceIdentity({
        "vcenter.datacenter.name": "D".repeat(80),
        "vcenter.host.name": "H".repeat(80),
        "vcenter.vm.name": "V".repeat(80),
        "vcenter.vm.id": "5030a1b2-0000-4000-8000-000000000001",
      });
    expect(identity?.externalId).toBe(
      "vm/5030a1b2-0000-4000-8000-000000000001",
    );
  });

  test("two long sibling pools fold into two buffer rows, and the extras count matches the row count", () => {
    const b: Buffers = buffers();
    feed(
      b,
      SIBLING_A,
      "vcenter.resource_pool.cpu.usage",
      datapoint({ value: 1200 }),
    );
    feed(
      b,
      SIBLING_B,
      "vcenter.resource_pool.cpu.usage",
      datapoint({ value: 300 }),
    );
    // Feed A again so a second point lands on the SAME bound key.
    feed(
      b,
      SIBLING_A,
      "vcenter.resource_pool.memory.usage",
      datapoint({ value: 4096, labels: { type: "guest" } }),
    );

    const rows: Array<VMwareResourceBufferEntry> = entries(b);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.externalId.length).toBeLessThanOrEqual(ColumnLength.ShortText);
    }
    const ids: Set<string> = new Set(
      rows.map((row: VMwareResourceBufferEntry) => {
        return row.externalId;
      }),
    );
    expect(ids.size).toBe(2);

    // Each pool kept its own metrics — nothing flip-flopped between them.
    const a: VMwareResourceBufferEntry = entry(
      b,
      "ResourcePool",
      boundVMwareExternalId(`resourcepool/${SIBLING_A_PATH}`),
    );
    const bRow: VMwareResourceBufferEntry = entry(
      b,
      "ResourcePool",
      boundVMwareExternalId(`resourcepool/${SIBLING_B_PATH}`),
    );
    expect(a.latestCpuMhz).toBe(1200);
    expect(a.latestMemoryBytes).toBe(4096 * MIB);
    expect(a.resourcePoolPath).toBe(SIBLING_A_PATH);
    expect(bRow.latestCpuMhz).toBe(300);
    expect(bRow.latestMemoryBytes).toBeNull();
    expect(bRow.resourcePoolPath).toBe(SIBLING_B_PATH);

    // The vCenter tile and the inventory table now agree: 2 == 2.
    expect(extras(b)).toEqual({ resourcePoolCount: 2 });
  });
});

describe("VMwareSnapshotScan - full-collection fold", () => {
  test("one resource of every kind folds with identity, metrics and counts", () => {
    const b: Buffers = buffers();
    feedFullCollection(b);

    expect(entries(b)).toHaveLength(8);

    const dc: VMwareResourceBufferEntry = entry(
      b,
      "Datacenter",
      "datacenter/DC1",
    );
    expect(dc.cpuCapacityMhz).toBe(96000);
    expect(dc.maxMemoryBytes).toBe(512 * 1024 * MIB);
    expect(dc.diskUsedBytes).toBe(30 * 1024 * MIB);
    expect(dc.diskAvailableBytes).toBe(70 * 1024 * MIB);
    expect(dc.hostCount?.value).toBe(4);
    expect(dc.poweredOnHostCount?.value).toBe(3);
    expect(dc.vmCount?.value).toBe(45);
    expect(dc.poweredOnVmCount?.value).toBe(40);
    expect(dc.clusterCount?.value).toBe(2);
    expect(dc.datastoreCount?.value).toBe(4);

    const cluster: VMwareResourceBufferEntry = entry(
      b,
      "Cluster",
      "cluster/DC1/Prod-Cluster",
    );
    expect(cluster.cpuCapacityMhz).toBe(64000);
    expect(cluster.cpuEffectiveMhz).toBe(60000);
    expect(cluster.maxMemoryBytes).toBe(256 * 1024 * MIB);
    expect(cluster.memoryEffectiveBytes).toBe(240 * 1024 * MIB);
    expect(cluster.hostCount?.value).toBe(3);
    expect(cluster.effectiveHostCount?.value).toBe(2);
    expect(cluster.vmCount?.value).toBe(35);
    expect(cluster.poweredOnVmCount?.value).toBe(30);
    expect(cluster.vmTemplateCount?.value).toBe(2);

    const host: VMwareResourceBufferEntry = entry(
      b,
      "Host",
      "host/DC1/esx01.example.com",
    );
    expect(host.name).toBe("esx01.example.com");
    expect(host.clusterName).toBe("Prod-Cluster");
    expect(host.latestCpuPercent).toBe(42.5);
    expect(host.latestCpuMhz).toBe(13600);
    expect(host.cpuCapacityMhz).toBe(32000);
    expect(host.latestMemoryBytes).toBe(65536 * MIB);
    expect(host.maxMemoryBytes).toBe(131072 * MIB);
    expect(host.latestMemoryPercent).toBe(50);

    const vmOn: VMwareResourceBufferEntry = entry(
      b,
      "VirtualMachine",
      "vm/5030a1b2-0000-4000-8000-000000000001",
    );
    expect(vmOn.name).toBe("web-01");
    expect(vmOn.hostName).toBe("esx01.example.com");
    expect(vmOn.resourcePoolName).toBe("Web");
    expect(vmOn.latestCpuPercent).toBe(12.5);
    expect(vmOn.latestCpuMhz).toBe(800);
    expect(vmOn.cpuReadinessPercent).toBe(1.5);
    expect(vmOn.latestMemoryBytes).toBe(2048 * MIB);
    expect(vmOn.latestMemoryPercent).toBe(25);
    expect(vmOn.memoryBalloonedBytes).toBe(0);
    expect(vmOn.memorySwappedBytes).toBe(0);
    expect(vmOn.diskUsedBytes).toBe(20 * 1024 * MIB);
    expect(vmOn.diskAvailableBytes).toBe(80 * 1024 * MIB);
    expect(vmOn.latestDiskPercent).toBe(20);
    expect(vmOn.sawCpuMetric).toBe(true);
    expect(vmOn.sawNonCpuMetric).toBe(true);

    const vmOff: VMwareResourceBufferEntry = entry(
      b,
      "VirtualMachine",
      "vm/5030a1b2-0000-4000-8000-000000000002",
    );
    expect(vmOff.virtualAppName).toBe("Batch vApp");
    expect(vmOff.sawCpuMetric).toBe(false);
    expect(vmOff.sawNonCpuMetric).toBe(true);
    expect(vmOff.latestCpuPercent).toBeNull();

    const template: VMwareResourceBufferEntry = entry(
      b,
      "VirtualMachine",
      "vm/5030a1b2-0000-4000-8000-0000000000aa",
    );
    expect(template.isTemplate).toBe(true);
    expect(template.diskUsedBytes).toBe(5 * 1024 * MIB);
    expect(template.diskAvailableBytes).toBeNull();

    const datastore: VMwareResourceBufferEntry = entry(
      b,
      "Datastore",
      "datastore/DC1/vsanDatastore",
    );
    expect(datastore.diskUsedBytes).toBe(30 * 1024 * MIB);
    expect(datastore.diskAvailableBytes).toBe(70 * 1024 * MIB);
    expect(datastore.latestDiskPercent).toBe(30);

    const pool: VMwareResourceBufferEntry = entry(
      b,
      "ResourcePool",
      "resourcepool//DC1/host/Prod-Cluster/Resources/Web",
    );
    expect(pool.latestCpuMhz).toBe(1200);
    // type=host is not the pool's guest consumption — ignored.
    expect(pool.latestMemoryBytes).toBe(4096 * MIB);
    expect(pool.memoryBalloonedBytes).toBe(16 * MIB);
    expect(pool.memorySwappedBytes).toBe(8 * MIB);

    const snap: VMwareVCenterSnapshotBufferEntry | undefined =
      b.vcenterBuffer.get(VCENTER);
    expect(snap).toEqual({
      sawDatacenter: true,
      sawCluster: true,
      sawHost: true,
      sawVirtualMachine: true,
      sawDatastore: true,
      sawResourcePool: true,
    });
  });

  test("identity attributes are first-non-null-wins; a later attribute-less patch never blanks them", () => {
    const b: Buffers = buffers();
    feed(
      b,
      VM_ON,
      "vcenter.vm.memory.usage",
      datapoint({ value: 2048, atMs: BASE_MS }),
    );
    // A NEWER point from a receiver build that omitted the pool attributes.
    const bare: Record<string, string> = {
      ...HOST,
      "vcenter.vm.name": "web-01",
      "vcenter.vm.id": "5030a1b2-0000-4000-8000-000000000001",
    };
    feed(
      b,
      bare,
      "vcenter.vm.memory.usage",
      datapoint({ value: 4096, atMs: BASE_MS + 60_000 }),
    );

    const vm: VMwareResourceBufferEntry = entry(
      b,
      "VirtualMachine",
      "vm/5030a1b2-0000-4000-8000-000000000001",
    );
    expect(vm.resourcePoolName).toBe("Web");
    expect(vm.resourcePoolPath).toBe("/DC1/host/Prod-Cluster/Resources/Web");
    expect(vm.latestMemoryBytes).toBe(4096 * MIB);
    expect(vm.observedAt).toEqual(new Date(BASE_MS + 60_000));
  });

  test("metric fields are newest-observedAt-wins regardless of arrival order", () => {
    const b: Buffers = buffers();
    // Newest point arrives FIRST, then a stale point.
    feed(
      b,
      HOST,
      "vcenter.host.cpu.utilization",
      datapoint({ value: 80, atMs: BASE_MS + 60_000, asDouble: true }),
    );
    feed(
      b,
      HOST,
      "vcenter.host.cpu.utilization",
      datapoint({ value: 20, atMs: BASE_MS, asDouble: true }),
    );

    const host: VMwareResourceBufferEntry = entry(
      b,
      "Host",
      "host/DC1/esx01.example.com",
    );
    expect(host.latestCpuPercent).toBe(80);
    expect(host.observedAt).toEqual(new Date(BASE_MS + 60_000));
  });

  test("a stale metric point never blanks a field it does not carry", () => {
    const b: Buffers = buffers();
    feed(
      b,
      HOST,
      "vcenter.host.cpu.usage",
      datapoint({ value: 5000, atMs: BASE_MS + 60_000 }),
    );
    feed(
      b,
      HOST,
      "vcenter.host.memory.usage",
      datapoint({ value: 1024, atMs: BASE_MS }),
    );
    const host: VMwareResourceBufferEntry = entry(
      b,
      "Host",
      "host/DC1/esx01.example.com",
    );
    expect(host.latestCpuMhz).toBe(5000);
    // Older point → its own field is not taken; nothing else is touched.
    expect(host.latestMemoryBytes).toBeNull();
  });

  test("non-finite and missing values are dropped before folding", () => {
    const b: Buffers = buffers();
    feed(b, HOST, "vcenter.host.cpu.usage", {
      asDouble: "Infinity",
      timeUnixNano: toNano(BASE_MS),
      attributes: [],
    } as JSONObject);
    feed(b, HOST, "vcenter.host.cpu.usage", {
      asDouble: "NaN",
      timeUnixNano: toNano(BASE_MS),
      attributes: [],
    } as JSONObject);
    feed(b, HOST, "vcenter.host.cpu.usage", {
      timeUnixNano: toNano(BASE_MS),
      attributes: [],
    } as JSONObject);
    expect(entries(b)).toHaveLength(0);
    expect(b.vcenterBuffer.size).toBe(0);
  });

  test("asInt is read when asDouble is absent, and int64 strings parse", () => {
    const b: Buffers = buffers();
    feed(b, HOST, "vcenter.host.cpu.usage", {
      asInt: "13600",
      timeUnixNano: toNano(BASE_MS),
      attributes: [],
    } as JSONObject);
    expect(entry(b, "Host", "host/DC1/esx01.example.com").latestCpuMhz).toBe(
      13600,
    );
  });

  test("MiBy memory series convert to bytes with truncation, never rounding up", () => {
    const b: Buffers = buffers();
    feed(
      b,
      VM_ON,
      "vcenter.vm.memory.usage",
      datapoint({ value: 1.5, asDouble: true }),
    );
    feed(
      b,
      VM_ON,
      "vcenter.vm.memory.ballooned",
      datapoint({ value: 0.0000001, asDouble: true }),
    );
    feed(b, VM_ON, "vcenter.vm.memory.swapped", datapoint({ value: -5 }));
    const vm: VMwareResourceBufferEntry = entry(
      b,
      "VirtualMachine",
      "vm/5030a1b2-0000-4000-8000-000000000001",
    );
    expect(vm.latestMemoryBytes).toBe(Math.trunc(1.5 * MIB));
    expect(vm.memoryBalloonedBytes).toBe(0);
    expect(vm.memorySwappedBytes).toBe(0);
  });

  test("a disk_state the receiver does not emit carries no signal", () => {
    const b: Buffers = buffers();
    feed(
      b,
      DATASTORE,
      "vcenter.datastore.disk.usage",
      datapoint({ value: 1, labels: { disk_state: "reserved" } }),
    );
    feed(b, DATASTORE, "vcenter.datastore.disk.usage", datapoint({ value: 1 }));
    expect(entries(b)).toHaveLength(0);
  });

  test("two vCenters are folded into disjoint buffers", () => {
    const b: Buffers = buffers();
    feed(b, HOST, "vcenter.host.cpu.usage", datapoint({ value: 1 }));
    bufferVMwareSnapshotMetric({
      vcenterIdStr: "other-vcenter",
      metricName: "vcenter.host.cpu.usage",
      resourceAttributes: HOST,
      datapoint: datapoint({ value: 2 }),
      resourceBuffer: b.resourceBuffer,
      vcenterBuffer: b.vcenterBuffer,
    });
    expect(entries(b)).toHaveLength(1);
    expect(
      b.resourceBuffer
        .get("other-vcenter")
        ?.get("Host|host/DC1/esx01.example.com")?.latestCpuMhz,
    ).toBe(2);
    expect(
      getOrCreateVMwareVCenterSnapshot(b.vcenterBuffer, "other-vcenter"),
    ).toMatchObject({
      sawHost: true,
    });
  });
});

describe("VMwareSnapshotScan - summed counts", () => {
  test("a count that fans out over attribute values is SUMMED, never newest-wins", () => {
    const b: Buffers = buffers();
    feed(
      b,
      CLUSTER,
      "vcenter.cluster.vm.count",
      datapoint({ value: 30, labels: { power_state: "on" } }),
    );
    feed(
      b,
      CLUSTER,
      "vcenter.cluster.vm.count",
      datapoint({ value: 4, labels: { power_state: "off" } }),
    );
    feed(
      b,
      CLUSTER,
      "vcenter.cluster.vm.count",
      datapoint({ value: 1, labels: { power_state: "suspended" } }),
    );
    feed(
      b,
      CLUSTER,
      "vcenter.cluster.vm.count",
      datapoint({ value: 0, labels: { power_state: "unknown" } }),
    );
    const cluster: VMwareResourceBufferEntry = entry(
      b,
      "Cluster",
      "cluster/DC1/Prod-Cluster",
    );
    expect(cluster.vmCount?.value).toBe(35);
    expect(cluster.poweredOnVmCount?.value).toBe(30);
  });

  test("a newer timestamp resets the sum; an older one is ignored", () => {
    const b: Buffers = buffers();
    // Collection 1
    feed(
      b,
      DC,
      "vcenter.datacenter.host.count",
      datapoint({ value: 3, atMs: BASE_MS, labels: { power_state: "on" } }),
    );
    feed(
      b,
      DC,
      "vcenter.datacenter.host.count",
      datapoint({ value: 1, atMs: BASE_MS, labels: { power_state: "off" } }),
    );
    // Collection 2 (one host powered on since) — arrives in the same batch.
    feed(
      b,
      DC,
      "vcenter.datacenter.host.count",
      datapoint({
        value: 4,
        atMs: BASE_MS + 120_000,
        labels: { power_state: "on" },
      }),
    );
    // A straggler from collection 1 arriving last must not add to collection 2.
    feed(
      b,
      DC,
      "vcenter.datacenter.host.count",
      datapoint({
        value: 1,
        atMs: BASE_MS,
        labels: { power_state: "standby" },
      }),
    );
    const dc: VMwareResourceBufferEntry = entry(
      b,
      "Datacenter",
      "datacenter/DC1",
    );
    expect(dc.hostCount).toEqual({
      value: 4,
      observedAt: new Date(BASE_MS + 120_000),
    });
    expect(dc.poweredOnHostCount?.value).toBe(4);
  });

  test("a filtered count resets to 0 when the newest collection has no matching datapoint", () => {
    const b: Buffers = buffers();
    feed(
      b,
      CLUSTER,
      "vcenter.cluster.host.count",
      datapoint({ value: 2, atMs: BASE_MS, labels: { effective: true } }),
    );
    // Next collection: every host went into maintenance mode.
    feed(
      b,
      CLUSTER,
      "vcenter.cluster.host.count",
      datapoint({
        value: 2,
        atMs: BASE_MS + 120_000,
        labels: { effective: false },
      }),
    );
    const cluster: VMwareResourceBufferEntry = entry(
      b,
      "Cluster",
      "cluster/DC1/Prod-Cluster",
    );
    expect(cluster.hostCount?.value).toBe(2);
    expect(cluster.effectiveHostCount?.value).toBe(0);
  });

  test("the boolean `effective` dimension is read from boolValue and from its string form", () => {
    for (const effective of [true, "true"] as Array<boolean | string>) {
      const b: Buffers = buffers();
      feed(
        b,
        CLUSTER,
        "vcenter.cluster.host.count",
        datapoint({ value: 3, labels: { effective } }),
      );
      expect(
        entry(b, "Cluster", "cluster/DC1/Prod-Cluster").effectiveHostCount
          ?.value,
      ).toBe(3);
    }
  });

  test("fractional or negative count values are clamped to whole non-negative numbers", () => {
    const b: Buffers = buffers();
    feed(
      b,
      DC,
      "vcenter.datacenter.datastore.count",
      datapoint({ value: 3.9, asDouble: true }),
    );
    feed(b, DC, "vcenter.datacenter.cluster.count", datapoint({ value: -1 }));
    const dc: VMwareResourceBufferEntry = entry(
      b,
      "Datacenter",
      "datacenter/DC1",
    );
    expect(dc.datastoreCount?.value).toBe(3);
    expect(dc.clusterCount?.value).toBe(0);
  });
});

describe("VMwareSnapshotScan - powered-on inference", () => {
  test("a VM with any vcenter.vm.cpu.* point is powered on", () => {
    const b: Buffers = buffers();
    feed(b, VM_ON, "vcenter.vm.cpu.readiness", datapoint({ value: 0 }));
    expect(
      computeVMwareIsPoweredOn(
        entry(b, "VirtualMachine", "vm/5030a1b2-0000-4000-8000-000000000001"),
      ),
    ).toBe(true);
  });

  test("a VM with memory/disk points but no CPU point is powered off", () => {
    const b: Buffers = buffers();
    feed(b, VM_OFF, "vcenter.vm.memory.usage", datapoint({ value: 0 }));
    expect(
      computeVMwareIsPoweredOn(
        entry(b, "VirtualMachine", "vm/5030a1b2-0000-4000-8000-000000000002"),
      ),
    ).toBe(false);
  });

  test("CPU evidence is sticky within the batch regardless of point order", () => {
    const b: Buffers = buffers();
    feed(b, VM_ON, "vcenter.vm.memory.usage", datapoint({ value: 1 }));
    feed(b, VM_ON, "vcenter.vm.cpu.usage", datapoint({ value: 1 }));
    feed(b, VM_ON, "vcenter.vm.disk.utilization", datapoint({ value: 1 }));
    expect(
      computeVMwareIsPoweredOn(
        entry(b, "VirtualMachine", "vm/5030a1b2-0000-4000-8000-000000000001"),
      ),
    ).toBe(true);
  });

  test("a template never gets a power state", () => {
    const b: Buffers = buffers();
    feed(
      b,
      TEMPLATE,
      "vcenter.vm.disk.usage",
      datapoint({ value: 1, labels: { disk_state: "used" } }),
    );
    const template: VMwareResourceBufferEntry = entry(
      b,
      "VirtualMachine",
      "vm/5030a1b2-0000-4000-8000-0000000000aa",
    );
    expect(template.sawNonCpuMetric).toBe(true);
    expect(computeVMwareIsPoweredOn(template)).toBeNull();
  });

  test("non-VM rows never get a power state", () => {
    const b: Buffers = buffers();
    feed(b, HOST, "vcenter.host.cpu.usage", datapoint({ value: 1 }));
    expect(
      computeVMwareIsPoweredOn(entry(b, "Host", "host/DC1/esx01.example.com")),
    ).toBeNull();
  });
});

describe("VMwareSnapshotScan - latest-metric derive", () => {
  test("maxDiskBytes = used + available and datacenter disk percent is derived", () => {
    const b: Buffers = buffers();
    feedFullCollection(b);

    const dc: VMwareResourceLatestMetricSnapshot =
      deriveVMwareResourceLatestMetric(
        entry(b, "Datacenter", "datacenter/DC1"),
      );
    expect(dc.diskBytes).toBe(30 * 1024 * MIB);
    expect(dc.maxDiskBytes).toBe(100 * 1024 * MIB);
    expect(dc.diskPercent).toBeCloseTo(30, 9);
    expect(dc.hostCount).toBe(4);
    expect(dc.poweredOnHostCount).toBe(3);
    expect(dc.vmCount).toBe(45);
    expect(dc.poweredOnVmCount).toBe(40);
    expect(dc.clusterCount).toBe(2);
    expect(dc.datastoreCount).toBe(4);
    expect(dc.effectiveHostCount).toBeNull();
    expect(dc.vmTemplateCount).toBeNull();

    const datastore: VMwareResourceLatestMetricSnapshot =
      deriveVMwareResourceLatestMetric(
        entry(b, "Datastore", "datastore/DC1/vsanDatastore"),
      );
    expect(datastore.maxDiskBytes).toBe(100 * 1024 * MIB);
    // The receiver's own utilization wins over a derivation.
    expect(datastore.diskPercent).toBe(30);

    // A template with only `used` has no capacity.
    const template: VMwareResourceLatestMetricSnapshot =
      deriveVMwareResourceLatestMetric(
        entry(b, "VirtualMachine", "vm/5030a1b2-0000-4000-8000-0000000000aa"),
      );
    expect(template.diskBytes).toBe(5 * 1024 * MIB);
    expect(template.maxDiskBytes).toBeNull();
  });

  test("a reported host memory capacity is used as-is", () => {
    const b: Buffers = buffers();
    feedFullCollection(b);
    const host: VMwareResourceLatestMetricSnapshot =
      deriveVMwareResourceLatestMetric(
        entry(b, "Host", "host/DC1/esx01.example.com"),
      );
    expect(host.maxMemoryBytes).toBe(131072 * MIB);
    expect(host.memoryBytes).toBe(65536 * MIB);
    expect(host.memoryPercent).toBe(50);
    expect(host.cpuMhz).toBe(13600);
    expect(host.cpuCapacityMhz).toBe(32000);
  });

  test("host memory capacity falls back to usage × 100 ÷ utilization when the capacity metric is disabled", () => {
    const b: Buffers = buffers();
    feed(b, HOST, "vcenter.host.memory.usage", datapoint({ value: 65536 }));
    feed(
      b,
      HOST,
      "vcenter.host.memory.utilization",
      datapoint({ value: 25, asDouble: true }),
    );
    const host: VMwareResourceLatestMetricSnapshot =
      deriveVMwareResourceLatestMetric(
        entry(b, "Host", "host/DC1/esx01.example.com"),
      );
    expect(host.maxMemoryBytes).toBe(65536 * 4 * MIB);
  });

  test("VM memory capacity is always derived, and stays null when utilization is 0 or absent", () => {
    const b: Buffers = buffers();
    feedFullCollection(b);
    const vmOn: VMwareResourceLatestMetricSnapshot =
      deriveVMwareResourceLatestMetric(
        entry(b, "VirtualMachine", "vm/5030a1b2-0000-4000-8000-000000000001"),
      );
    expect(vmOn.maxMemoryBytes).toBe(2048 * 4 * MIB);
    expect(vmOn.cpuReadinessPercent).toBe(1.5);
    expect(vmOn.memoryBalloonedBytes).toBe(0);
    expect(vmOn.diskBytes).toBe(20 * 1024 * MIB);
    expect(vmOn.maxDiskBytes).toBe(100 * 1024 * MIB);

    // Powered-off VM: usage 0 and no utilization → no derivation.
    const vmOff: VMwareResourceLatestMetricSnapshot =
      deriveVMwareResourceLatestMetric(
        entry(b, "VirtualMachine", "vm/5030a1b2-0000-4000-8000-000000000002"),
      );
    expect(vmOff.memoryBytes).toBe(0);
    expect(vmOff.maxMemoryBytes).toBeNull();
    expect(vmOff.cpuPercent).toBeNull();

    const c: Buffers = buffers();
    feed(c, VM_ON, "vcenter.vm.memory.usage", datapoint({ value: 100 }));
    feed(
      c,
      VM_ON,
      "vcenter.vm.memory.utilization",
      datapoint({ value: 0, asDouble: true }),
    );
    expect(
      deriveVMwareResourceLatestMetric(
        entry(c, "VirtualMachine", "vm/5030a1b2-0000-4000-8000-000000000001"),
      ).maxMemoryBytes,
    ).toBeNull();
  });

  test("cluster and resource-pool rows map their own columns and leave the rest null", () => {
    const b: Buffers = buffers();
    feedFullCollection(b);
    const cluster: VMwareResourceLatestMetricSnapshot =
      deriveVMwareResourceLatestMetric(
        entry(b, "Cluster", "cluster/DC1/Prod-Cluster"),
      );
    expect(cluster).toMatchObject({
      kind: "Cluster",
      cpuCapacityMhz: 64000,
      cpuEffectiveMhz: 60000,
      maxMemoryBytes: 256 * 1024 * MIB,
      memoryEffectiveBytes: 240 * 1024 * MIB,
      hostCount: 3,
      effectiveHostCount: 2,
      vmCount: 35,
      poweredOnVmCount: 30,
      vmTemplateCount: 2,
      cpuPercent: null,
      memoryBytes: null,
      diskBytes: null,
      poweredOnHostCount: null,
      clusterCount: null,
      datastoreCount: null,
    });
    // A cluster never derives a memory fallback — its limit IS the capacity.
    expect(cluster.memoryPercent).toBeNull();

    const pool: VMwareResourceLatestMetricSnapshot =
      deriveVMwareResourceLatestMetric(
        entry(
          b,
          "ResourcePool",
          "resourcepool//DC1/host/Prod-Cluster/Resources/Web",
        ),
      );
    expect(pool).toMatchObject({
      cpuMhz: 1200,
      memoryBytes: 4096 * MIB,
      memoryBalloonedBytes: 16 * MIB,
      memorySwappedBytes: 8 * MIB,
      maxMemoryBytes: null,
      cpuPercent: null,
    });
    expect(pool.observedAt).toEqual(new Date(BASE_MS));
  });
});

describe("VMwareSnapshotScan - vCenter extras derive", () => {
  test("a full collection derives every count from the same folded buffer", () => {
    const b: Buffers = buffers();
    feedFullCollection(b);
    expect(extras(b)).toEqual({
      datacenterCount: 1,
      clusterCount: 1,
      hostCount: 1,
      // Two VMs; the template is not a VM.
      vmCount: 2,
      poweredOnVmCount: 1,
      datastoreCount: 1,
      resourcePoolCount: 1,
      datastoreCapacityBytes: 100 * 1024 * MIB,
      datastoreUsedBytes: 30 * 1024 * MIB,
    });
  });

  test("a partial batch never zeroes a count (no resource of that kind ⇒ key absent)", () => {
    const b: Buffers = buffers();
    // Only one host's resource block made it into this batch.
    feed(b, HOST, "vcenter.host.cpu.usage", datapoint({ value: 100 }));
    expect(extras(b)).toEqual({ hostCount: 1 });
    expect(Object.keys(extras(b))).not.toContain("vmCount");
    expect(Object.keys(extras(b))).not.toContain("datastoreCount");
  });

  test("an empty buffer derives nothing", () => {
    const b: Buffers = buffers();
    expect(extras(b)).toEqual({});
    expect(deriveVMwareVCenterSnapshotExtras([], undefined)).toEqual({});
  });

  test("a template-only batch writes vmCount = 0 and poweredOnVmCount = 0 (templates are not VMs)", () => {
    const b: Buffers = buffers();
    feed(
      b,
      TEMPLATE,
      "vcenter.vm.disk.usage",
      datapoint({ value: 1, labels: { disk_state: "used" } }),
    );
    expect(extras(b)).toEqual({ vmCount: 0, poweredOnVmCount: 0 });
  });

  test("all VMs powered off is a legitimate 0, distinct from 'not seen'", () => {
    const b: Buffers = buffers();
    feed(b, VM_OFF, "vcenter.vm.memory.usage", datapoint({ value: 0 }));
    expect(extras(b)).toEqual({ vmCount: 1, poweredOnVmCount: 0 });
  });

  test("datastore capacity / used totals sum every datastore and are skipped when no datastore carried a disk_state series", () => {
    const b: Buffers = buffers();
    feed(
      b,
      DATASTORE,
      "vcenter.datastore.disk.usage",
      datapoint({ value: 100, labels: { disk_state: "used" } }),
    );
    feed(
      b,
      DATASTORE,
      "vcenter.datastore.disk.usage",
      datapoint({ value: 900, labels: { disk_state: "available" } }),
    );
    const second: Record<string, string> = {
      ...DC,
      "vcenter.datastore.name": "nfs-backup",
    };
    feed(
      b,
      second,
      "vcenter.datastore.disk.usage",
      datapoint({ value: 50, labels: { disk_state: "used" } }),
    );
    feed(
      b,
      second,
      "vcenter.datastore.disk.usage",
      datapoint({ value: 50, labels: { disk_state: "available" } }),
    );
    expect(extras(b)).toEqual({
      datastoreCount: 2,
      datastoreCapacityBytes: 1100,
      datastoreUsedBytes: 150,
    });

    // Utilization-only datastore points: count yes, byte totals no.
    const c: Buffers = buffers();
    feed(
      c,
      DATASTORE,
      "vcenter.datastore.disk.utilization",
      datapoint({ value: 30, asDouble: true }),
    );
    expect(extras(c)).toEqual({ datastoreCount: 1 });
  });

  test("the extras shape is exactly the VMwareVCenter snapshot columns", () => {
    const b: Buffers = buffers();
    feedFullCollection(b);
    expect(Object.keys(extras(b)).sort()).toEqual(
      [
        "clusterCount",
        "datacenterCount",
        "datastoreCapacityBytes",
        "datastoreCount",
        "datastoreUsedBytes",
        "hostCount",
        "poweredOnVmCount",
        "resourcePoolCount",
        "vmCount",
      ].sort(),
    );
  });

  test("the kind literals match VMwareResourceKind", () => {
    const b: Buffers = buffers();
    feedFullCollection(b);
    const kinds: Set<string> = new Set(
      entries(b).map((e: VMwareResourceBufferEntry) => {
        return e.kind;
      }),
    );
    expect(kinds).toEqual(new Set(Object.values(VMwareResourceKind)));
  });
});
