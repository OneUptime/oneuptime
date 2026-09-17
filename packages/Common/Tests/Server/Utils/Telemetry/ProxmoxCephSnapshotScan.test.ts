import {
  PVE_SNAPSHOT_METRIC_NAMES,
  CEPH_SNAPSHOT_METRIC_NAMES,
  ProxmoxResourceBufferEntry,
  ProxmoxClusterSnapshotBufferEntry,
  ProxmoxClusterSnapshotExtras,
  CephResourceBufferEntry,
  CephClusterSnapshotBufferEntry,
  CephClusterSnapshotExtras,
  bufferProxmoxSnapshotMetric,
  bufferCephSnapshotMetric,
  computeProxmoxGuestBackedUp,
  deriveProxmoxClusterSnapshotExtras,
  deriveCephClusterSnapshotExtras,
} from "../../../../Server/Utils/Telemetry/ProxmoxCephSnapshotScan";
import { JSONObject } from "../../../../Types/JSON";

/*
 * WI-21: the Proxmox/Ceph snapshot scan, fed with synthetic OTLP
 * datapoints (the exact JSON shape the prometheus receiver emits
 * through the OTLP decode: asInt/asDouble + timeUnixNano + a raw
 * key/stringValue attribute array). Locks in:
 *
 *   - identity first-non-null-wins / status newest-observedAt-wins,
 *   - the never-zero-a-count-on-a-partial-batch contract (a count is
 *     derived only when the batch carried the matching identity
 *     series; same COALESCE-style guard the upsert uses per column),
 *   - the WI-24 backup-coverage join (sawBackupInfo gate + the
 *     externalId-or-bare-vmid id match),
 *   - non-allow-listed metrics never reaching the inventory fold.
 */

const CLUSTER: string = "0a1b2c3d-0000-0000-0000-000000000001";

// 2023-11-14T22:13:20.000Z — an arbitrary fixed scrape instant.
const BASE_MS: number = 1700000000000;

type LabelMap = Record<string, string>;

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
    ([key, value]: [string, string]) => {
      return { key, value: { stringValue: value } };
    },
  );
  return {
    ...(data.asDouble ? { asDouble: data.value } : { asInt: data.value }),
    timeUnixNano: toNano(data.atMs ?? BASE_MS),
    attributes,
  };
}

interface ProxmoxBuffers {
  resourceBuffer: Map<string, Map<string, ProxmoxResourceBufferEntry>>;
  clusterBuffer: Map<string, ProxmoxClusterSnapshotBufferEntry>;
}

function proxmoxBuffers(): ProxmoxBuffers {
  return { resourceBuffer: new Map(), clusterBuffer: new Map() };
}

function feedProxmox(
  buffers: ProxmoxBuffers,
  metricName: string,
  dp: JSONObject,
): void {
  bufferProxmoxSnapshotMetric({
    clusterIdStr: CLUSTER,
    metricName,
    datapoint: dp,
    resourceBuffer: buffers.resourceBuffer,
    clusterBuffer: buffers.clusterBuffer,
  });
}

function proxmoxEntries(
  buffers: ProxmoxBuffers,
): Array<ProxmoxResourceBufferEntry> {
  return Array.from(buffers.resourceBuffer.get(CLUSTER)?.values() || []);
}

function proxmoxEntry(
  buffers: ProxmoxBuffers,
  kind: string,
  externalId: string,
): ProxmoxResourceBufferEntry {
  const entry: ProxmoxResourceBufferEntry | undefined = buffers.resourceBuffer
    .get(CLUSTER)
    ?.get(`${kind}|${externalId}`);
  if (!entry) {
    throw new Error(`expected buffered entry ${kind}|${externalId}`);
  }
  return entry;
}

interface CephBuffers {
  resourceBuffer: Map<string, Map<string, CephResourceBufferEntry>>;
  clusterBuffer: Map<string, CephClusterSnapshotBufferEntry>;
}

function cephBuffers(): CephBuffers {
  return { resourceBuffer: new Map(), clusterBuffer: new Map() };
}

function feedCeph(
  buffers: CephBuffers,
  metricName: string,
  dp: JSONObject,
): void {
  bufferCephSnapshotMetric({
    clusterIdStr: CLUSTER,
    metricName,
    datapoint: dp,
    resourceBuffer: buffers.resourceBuffer,
    clusterBuffer: buffers.clusterBuffer,
  });
}

function cephEntries(buffers: CephBuffers): Array<CephResourceBufferEntry> {
  return Array.from(buffers.resourceBuffer.get(CLUSTER)?.values() || []);
}

function cephEntry(
  buffers: CephBuffers,
  kind: string,
  externalId: string,
): CephResourceBufferEntry {
  const entry: CephResourceBufferEntry | undefined = buffers.resourceBuffer
    .get(CLUSTER)
    ?.get(`${kind}|${externalId}`);
  if (!entry) {
    throw new Error(`expected buffered entry ${kind}|${externalId}`);
  }
  return entry;
}

describe("ProxmoxCephSnapshotScan - metric allow-lists", () => {
  test("non-snapshot metrics are not allow-listed (the ingest gate)", () => {
    // Perf series go to ClickHouse only — never the Postgres mirror.
    expect(PVE_SNAPSHOT_METRIC_NAMES.has("pve_network_receive_bytes")).toBe(
      false,
    );
    expect(PVE_SNAPSHOT_METRIC_NAMES.has("pve_replication_failed_syncs")).toBe(
      false,
    );
    expect(CEPH_SNAPSHOT_METRIC_NAMES.has("ceph_health_detail")).toBe(false);
    expect(CEPH_SNAPSHOT_METRIC_NAMES.has("ceph_pg_degraded")).toBe(false);
  });

  test("WI-24 backup-coverage series are allow-listed", () => {
    expect(PVE_SNAPSHOT_METRIC_NAMES.has("pve_not_backed_up_total")).toBe(true);
    expect(PVE_SNAPSHOT_METRIC_NAMES.has("pve_not_backed_up_info")).toBe(true);
  });

  test("a non-allow-listed metric name never creates an inventory row", () => {
    const buffers: ProxmoxBuffers = proxmoxBuffers();
    /*
     * Defense in depth: even if the Set gate were bypassed, the fold's
     * metric-name switch drops unknown names.
     */
    feedProxmox(
      buffers,
      "pve_network_receive_bytes",
      datapoint({ value: 1234, labels: { id: "qemu/100" } }),
    );
    expect(proxmoxEntries(buffers)).toHaveLength(0);
  });
});

describe("ProxmoxCephSnapshotScan - Proxmox fold", () => {
  test("a full scrape folds nodes, guests and storage with identity + status", () => {
    const buffers: ProxmoxBuffers = proxmoxBuffers();

    feedProxmox(
      buffers,
      "pve_node_info",
      datapoint({ value: 1, labels: { id: "node/pve1", name: "pve1" } }),
    );
    feedProxmox(
      buffers,
      "pve_up",
      datapoint({
        value: 1,
        labels: { id: "node/pve1", "pve.scope": "node" },
      }),
    );
    feedProxmox(
      buffers,
      "pve_node_info",
      datapoint({ value: 1, labels: { id: "node/pve2", name: "pve2" } }),
    );
    feedProxmox(
      buffers,
      "pve_up",
      datapoint({
        value: 0,
        labels: { id: "node/pve2", "pve.scope": "node" },
      }),
    );
    feedProxmox(
      buffers,
      "pve_guest_info",
      datapoint({
        value: 1,
        labels: { id: "qemu/100", name: "web-vm", node: "pve1" },
      }),
    );
    feedProxmox(
      buffers,
      "pve_storage_info",
      datapoint({
        value: 1,
        labels: { id: "storage/pve1/local", storage: "local", node: "pve1" },
      }),
    );
    feedProxmox(
      buffers,
      "pve_version_info",
      datapoint({ value: 1, labels: { version: "8.2.4" } }),
    );

    const node1: ProxmoxResourceBufferEntry = proxmoxEntry(
      buffers,
      "Node",
      "node/pve1",
    );
    expect(node1.name).toBe("pve1");
    expect(node1.isUp).toBe(true);

    const node2: ProxmoxResourceBufferEntry = proxmoxEntry(
      buffers,
      "Node",
      "node/pve2",
    );
    expect(node2.isUp).toBe(false);

    const guest: ProxmoxResourceBufferEntry = proxmoxEntry(
      buffers,
      "Guest",
      "qemu/100",
    );
    expect(guest.name).toBe("web-vm");
    expect(guest.vmid).toBe(100);
    expect(guest.guestType).toBe("qemu");
    expect(guest.parentNodeName).toBe("pve1");

    const storage: ProxmoxResourceBufferEntry = proxmoxEntry(
      buffers,
      "Storage",
      "storage/pve1/local",
    );
    expect(storage.name).toBe("local");
    expect(storage.parentNodeName).toBe("pve1");

    // pve_version_info has no id — cluster-level only, never a row.
    expect(proxmoxEntries(buffers)).toHaveLength(4);
    expect(buffers.clusterBuffer.get(CLUSTER)?.pveVersion).toBe("8.2.4");
  });

  test("scope falls back to the id prefix when the agent transform is absent", () => {
    const buffers: ProxmoxBuffers = proxmoxBuffers();
    // No pve.scope / pve.type attributes — hand-rolled collector config.
    feedProxmox(
      buffers,
      "pve_up",
      datapoint({ value: 1, labels: { id: "lxc/101" } }),
    );

    const guest: ProxmoxResourceBufferEntry = proxmoxEntry(
      buffers,
      "Guest",
      "lxc/101",
    );
    expect(guest.guestType).toBe("lxc");
    expect(guest.vmid).toBe(101);
  });

  test("cluster-scoped and id-less series never create inventory rows", () => {
    const buffers: ProxmoxBuffers = proxmoxBuffers();
    feedProxmox(
      buffers,
      "pve_up",
      datapoint({ value: 1, labels: { id: "cluster/pve" } }),
    );
    feedProxmox(buffers, "pve_up", datapoint({ value: 1 }));
    expect(proxmoxEntries(buffers)).toHaveLength(0);
  });

  test("identity labels are first-non-null-wins; a later info-less patch never blanks them", () => {
    const buffers: ProxmoxBuffers = proxmoxBuffers();
    feedProxmox(
      buffers,
      "pve_guest_info",
      datapoint({
        value: 1,
        atMs: BASE_MS,
        labels: { id: "qemu/100", name: "web-vm", node: "pve1" },
      }),
    );
    // A NEWER pve_up patch carries no name/node labels.
    feedProxmox(
      buffers,
      "pve_up",
      datapoint({
        value: 1,
        atMs: BASE_MS + 60_000,
        labels: { id: "qemu/100", "pve.scope": "guest" },
      }),
    );

    const guest: ProxmoxResourceBufferEntry = proxmoxEntry(
      buffers,
      "Guest",
      "qemu/100",
    );
    expect(guest.name).toBe("web-vm");
    expect(guest.parentNodeName).toBe("pve1");
    expect(guest.isUp).toBe(true);
    expect(guest.observedAt).toEqual(new Date(BASE_MS + 60_000));
  });

  test("status fields are newest-observedAt-wins regardless of arrival order", () => {
    const buffers: ProxmoxBuffers = proxmoxBuffers();
    const labels: LabelMap = { id: "node/pve1", "pve.scope": "node" };
    // Newest point (up) arrives FIRST, then a stale point (down).
    feedProxmox(
      buffers,
      "pve_up",
      datapoint({ value: 1, atMs: BASE_MS + 60_000, labels }),
    );
    feedProxmox(
      buffers,
      "pve_up",
      datapoint({ value: 0, atMs: BASE_MS, labels }),
    );

    const node: ProxmoxResourceBufferEntry = proxmoxEntry(
      buffers,
      "Node",
      "node/pve1",
    );
    expect(node.isUp).toBe(true);
    expect(node.observedAt).toEqual(new Date(BASE_MS + 60_000));
  });

  test("pve_ha_state folds only the active enum row; zero rows leave no trace", () => {
    const buffers: ProxmoxBuffers = proxmoxBuffers();
    feedProxmox(
      buffers,
      "pve_ha_state",
      datapoint({
        value: 0,
        labels: { id: "qemu/100", state: "started", "pve.scope": "guest" },
      }),
    );
    // The zero row must not even create an empty patch.
    expect(proxmoxEntries(buffers)).toHaveLength(0);

    feedProxmox(
      buffers,
      "pve_ha_state",
      datapoint({
        value: 1,
        labels: { id: "qemu/100", state: "error", "pve.scope": "guest" },
      }),
    );
    expect(proxmoxEntry(buffers, "Guest", "qemu/100").haState).toBe("error");
  });

  test("latest-metric mirror fields fold with truncation and ratio→percent", () => {
    const buffers: ProxmoxBuffers = proxmoxBuffers();
    const labels: LabelMap = { id: "qemu/100", "pve.scope": "guest" };
    feedProxmox(
      buffers,
      "pve_cpu_usage_ratio",
      datapoint({ value: 0.25, asDouble: true, labels }),
    );
    feedProxmox(
      buffers,
      "pve_memory_usage_bytes",
      datapoint({ value: 1024.9, asDouble: true, labels }),
    );
    feedProxmox(
      buffers,
      "pve_memory_size_bytes",
      datapoint({ value: 2048, labels }),
    );

    const guest: ProxmoxResourceBufferEntry = proxmoxEntry(
      buffers,
      "Guest",
      "qemu/100",
    );
    expect(guest.latestCpuPercent).toBe(25);
    expect(guest.latestMemoryBytes).toBe(1024);
    expect(guest.maxMemoryBytes).toBe(2048);
    /*
     * No disk series in the batch: a qemu guest without the QEMU guest
     * agent stays NULL (never 0) — the upsert COALESCE keeps it NULL.
     */
    expect(guest.latestDiskBytes).toBeNull();
  });

  test("non-finite and missing values are dropped before folding", () => {
    const buffers: ProxmoxBuffers = proxmoxBuffers();
    feedProxmox(buffers, "pve_up", {
      asDouble: "Infinity",
      timeUnixNano: toNano(BASE_MS),
      attributes: [{ key: "id", value: { stringValue: "node/pve1" } }],
    } as JSONObject);
    feedProxmox(buffers, "pve_up", {
      timeUnixNano: toNano(BASE_MS),
      attributes: [{ key: "id", value: { stringValue: "node/pve1" } }],
    } as JSONObject);
    expect(proxmoxEntries(buffers)).toHaveLength(0);
  });
});

describe("ProxmoxCephSnapshotScan - WI-24 backup coverage", () => {
  function bufferedGuest(
    externalId: string,
    vmid: number | null,
  ): ProxmoxResourceBufferEntry {
    return {
      kind: "Guest",
      externalId,
      name: null,
      vmid,
      guestType: "qemu",
      parentNodeName: null,
      isUp: true,
      haState: null,
      onboot: null,
      uptimeSeconds: null,
      latestCpuPercent: null,
      latestMemoryBytes: null,
      maxMemoryBytes: null,
      latestDiskBytes: null,
      maxDiskBytes: null,
      observedAt: new Date(BASE_MS),
    };
  }

  test("backup series fold into the cluster buffer, never the inventory", () => {
    const buffers: ProxmoxBuffers = proxmoxBuffers();
    feedProxmox(buffers, "pve_not_backed_up_total", datapoint({ value: 2 }));
    feedProxmox(
      buffers,
      "pve_not_backed_up_info",
      datapoint({ value: 1, labels: { id: "qemu/100" } }),
    );
    feedProxmox(
      buffers,
      "pve_not_backed_up_info",
      datapoint({ value: 1, labels: { id: "101" } }),
    );

    expect(proxmoxEntries(buffers)).toHaveLength(0);

    const snap: ProxmoxClusterSnapshotBufferEntry | undefined =
      buffers.clusterBuffer.get(CLUSTER);
    expect(snap?.sawBackupInfo).toBe(true);
    expect(snap?.guestsWithoutBackupCount).toBe(2);
    expect(snap?.notBackedUpIds).toEqual(new Set(["qemu/100", "101"]));
  });

  test("guests join against the uncovered ids by externalId OR bare vmid", () => {
    const buffers: ProxmoxBuffers = proxmoxBuffers();
    feedProxmox(buffers, "pve_not_backed_up_total", datapoint({ value: 2 }));
    feedProxmox(
      buffers,
      "pve_not_backed_up_info",
      datapoint({ value: 1, labels: { id: "qemu/100" } }),
    );
    feedProxmox(
      buffers,
      "pve_not_backed_up_info",
      datapoint({ value: 1, labels: { id: "101" } }),
    );
    const snap: ProxmoxClusterSnapshotBufferEntry | undefined =
      buffers.clusterBuffer.get(CLUSTER);

    // Full-id match (qemu/100), bare-vmid match (101), covered (102).
    expect(
      computeProxmoxGuestBackedUp(bufferedGuest("qemu/100", 100), snap),
    ).toBe(false);
    expect(
      computeProxmoxGuestBackedUp(bufferedGuest("lxc/101", 101), snap),
    ).toBe(false);
    expect(
      computeProxmoxGuestBackedUp(bufferedGuest("qemu/102", 102), snap),
    ).toBe(true);
  });

  test("a batch WITHOUT backup-info output yields null for every guest (COALESCE keeps last-known)", () => {
    const buffers: ProxmoxBuffers = proxmoxBuffers();
    feedProxmox(
      buffers,
      "pve_up",
      datapoint({ value: 1, labels: { id: "qemu/100", "pve.scope": "guest" } }),
    );
    const snap: ProxmoxClusterSnapshotBufferEntry | undefined =
      buffers.clusterBuffer.get(CLUSTER);

    expect(snap?.sawBackupInfo).toBe(false);
    expect(
      computeProxmoxGuestBackedUp(bufferedGuest("qemu/100", 100), snap),
    ).toBe(null);
    // No snapshot at all (cluster never seen this batch) — also null.
    expect(
      computeProxmoxGuestBackedUp(bufferedGuest("qemu/100", 100), undefined),
    ).toBe(null);
  });

  test("non-Guest rows never get a backup flag", () => {
    const buffers: ProxmoxBuffers = proxmoxBuffers();
    feedProxmox(buffers, "pve_not_backed_up_total", datapoint({ value: 1 }));
    const snap: ProxmoxClusterSnapshotBufferEntry | undefined =
      buffers.clusterBuffer.get(CLUSTER);

    const node: ProxmoxResourceBufferEntry = {
      ...bufferedGuest("node/pve1", null),
      kind: "Node",
      guestType: null,
    };
    expect(computeProxmoxGuestBackedUp(node, snap)).toBe(null);
  });
});

describe("ProxmoxCephSnapshotScan - Proxmox cluster extras derive", () => {
  test("a full batch derives every count from the same folded buffer", () => {
    const buffers: ProxmoxBuffers = proxmoxBuffers();
    feedProxmox(
      buffers,
      "pve_node_info",
      datapoint({ value: 1, labels: { id: "node/pve1", name: "pve1" } }),
    );
    feedProxmox(
      buffers,
      "pve_up",
      datapoint({ value: 1, labels: { id: "node/pve1", "pve.scope": "node" } }),
    );
    feedProxmox(
      buffers,
      "pve_node_info",
      datapoint({ value: 1, labels: { id: "node/pve2", name: "pve2" } }),
    );
    feedProxmox(
      buffers,
      "pve_up",
      datapoint({ value: 0, labels: { id: "node/pve2", "pve.scope": "node" } }),
    );
    feedProxmox(
      buffers,
      "pve_guest_info",
      datapoint({ value: 1, labels: { id: "qemu/100", name: "web-vm" } }),
    );
    feedProxmox(
      buffers,
      "pve_storage_info",
      datapoint({
        value: 1,
        labels: { id: "storage/pve1/local", storage: "local" },
      }),
    );
    feedProxmox(
      buffers,
      "pve_version_info",
      datapoint({ value: 1, labels: { version: "8.2.4" } }),
    );
    feedProxmox(buffers, "pve_not_backed_up_total", datapoint({ value: 0 }));

    const extras: ProxmoxClusterSnapshotExtras =
      deriveProxmoxClusterSnapshotExtras(
        proxmoxEntries(buffers),
        buffers.clusterBuffer.get(CLUSTER),
      );

    expect(extras).toEqual({
      pveVersion: "8.2.4",
      nodeCount: 2,
      onlineNodeCount: 1,
      guestCount: 1,
      storageCount: 1,
      // 0 is a legitimate value — distinct from "collector silent".
      guestsWithoutBackupCount: 0,
    });
  });

  test("a partial batch never zeroes a count (no identity series ⇒ key absent)", () => {
    const buffers: ProxmoxBuffers = proxmoxBuffers();
    // Only a perf series made it through (e.g. a pipeline filter).
    feedProxmox(
      buffers,
      "pve_cpu_usage_ratio",
      datapoint({
        value: 0.5,
        asDouble: true,
        labels: { id: "node/pve1", "pve.scope": "node" },
      }),
    );

    const extras: ProxmoxClusterSnapshotExtras =
      deriveProxmoxClusterSnapshotExtras(
        proxmoxEntries(buffers),
        buffers.clusterBuffer.get(CLUSTER),
      );

    /*
     * The buffered node row exists, but no saw* flag flipped — so NO
     * count keys appear and the cluster row's existing counts survive
     * (the flush only writes the keys present here).
     */
    expect(extras).toEqual({});
  });

  test("guest-only batch writes guestCount without touching node counts", () => {
    const buffers: ProxmoxBuffers = proxmoxBuffers();
    feedProxmox(
      buffers,
      "pve_guest_info",
      datapoint({ value: 1, labels: { id: "qemu/100", name: "web-vm" } }),
    );

    const extras: ProxmoxClusterSnapshotExtras =
      deriveProxmoxClusterSnapshotExtras(
        proxmoxEntries(buffers),
        buffers.clusterBuffer.get(CLUSTER),
      );

    expect(extras).toEqual({ guestCount: 1 });
    expect(Object.keys(extras)).not.toContain("nodeCount");
    expect(Object.keys(extras)).not.toContain("guestsWithoutBackupCount");
  });
});

describe("ProxmoxCephSnapshotScan - Ceph fold", () => {
  test("daemon series fold by ceph_daemon with kind from the prefix", () => {
    const buffers: CephBuffers = cephBuffers();
    feedCeph(
      buffers,
      "ceph_osd_metadata",
      datapoint({
        value: 1,
        labels: {
          ceph_daemon: "osd.3",
          hostname: "ceph-node-1",
          device_class: "ssd",
          ceph_version: "ceph version 18.2.2 reef",
        },
      }),
    );
    feedCeph(
      buffers,
      "ceph_osd_up",
      datapoint({ value: 1, labels: { ceph_daemon: "osd.3" } }),
    );
    feedCeph(
      buffers,
      "ceph_osd_in",
      datapoint({ value: 0, labels: { ceph_daemon: "osd.3" } }),
    );
    feedCeph(
      buffers,
      "ceph_mon_quorum_status",
      datapoint({ value: 1, labels: { ceph_daemon: "mon.a" } }),
    );
    // Unknown daemon prefix — not an inventory kind.
    feedCeph(
      buffers,
      "ceph_osd_up",
      datapoint({ value: 1, labels: { ceph_daemon: "client.admin" } }),
    );

    const osd: CephResourceBufferEntry = cephEntry(buffers, "Osd", "osd.3");
    expect(osd.hostname).toBe("ceph-node-1");
    expect(osd.deviceClass).toBe("ssd");
    expect(osd.isUp).toBe(true);
    expect(osd.isIn).toBe(false);

    const mon: CephResourceBufferEntry = cephEntry(buffers, "Mon", "mon.a");
    expect(mon.inQuorum).toBe(true);

    expect(cephEntries(buffers)).toHaveLength(2);
  });

  test("pool series fold by pool_id; the name only ever comes from metadata", () => {
    const buffers: CephBuffers = cephBuffers();
    feedCeph(
      buffers,
      "ceph_pool_stored",
      datapoint({ value: 1000, labels: { pool_id: "2" } }),
    );
    feedCeph(
      buffers,
      "ceph_pool_metadata",
      datapoint({ value: 1, labels: { pool_id: "2", name: "rbd" } }),
    );
    feedCeph(
      buffers,
      "ceph_pool_max_avail",
      datapoint({ value: 9000, labels: { pool_id: "2" } }),
    );
    // Pool series without pool_id are dropped.
    feedCeph(buffers, "ceph_pool_stored", datapoint({ value: 5 }));

    const pool: CephResourceBufferEntry = cephEntry(buffers, "Pool", "2");
    expect(pool.name).toBe("rbd");
    expect(pool.storedBytes).toBe(1000);
    expect(pool.maxAvailBytes).toBe(9000);
    expect(cephEntries(buffers)).toHaveLength(1);
  });

  test("cluster health/capacity series never create resource rows", () => {
    const buffers: CephBuffers = cephBuffers();
    feedCeph(buffers, "ceph_health_status", datapoint({ value: 1 }));
    feedCeph(buffers, "ceph_cluster_total_bytes", datapoint({ value: 300 }));
    feedCeph(
      buffers,
      "ceph_cluster_total_used_bytes",
      datapoint({ value: 100 }),
    );

    expect(cephEntries(buffers)).toHaveLength(0);
    const snap: CephClusterSnapshotBufferEntry | undefined =
      buffers.clusterBuffer.get(CLUSTER);
    expect(snap?.healthStatus).toBe(1);
    expect(snap?.totalBytes).toBe(300);
    expect(snap?.totalUsedBytes).toBe(100);
  });

  test("identity is first-non-null-wins, status newest-wins (out-of-order)", () => {
    const buffers: CephBuffers = cephBuffers();
    feedCeph(
      buffers,
      "ceph_osd_up",
      datapoint({
        value: 0,
        atMs: BASE_MS + 60_000,
        labels: { ceph_daemon: "osd.3" },
      }),
    );
    feedCeph(
      buffers,
      "ceph_osd_up",
      datapoint({ value: 1, atMs: BASE_MS, labels: { ceph_daemon: "osd.3" } }),
    );
    feedCeph(
      buffers,
      "ceph_osd_metadata",
      datapoint({
        value: 1,
        atMs: BASE_MS,
        labels: { ceph_daemon: "osd.3", hostname: "ceph-node-1" },
      }),
    );

    const osd: CephResourceBufferEntry = cephEntry(buffers, "Osd", "osd.3");
    // The newest (down) observation wins over the stale up one.
    expect(osd.isUp).toBe(false);
    // Identity from the older metadata series still sticks.
    expect(osd.hostname).toBe("ceph-node-1");
    expect(osd.observedAt).toEqual(new Date(BASE_MS + 60_000));
  });
});

describe("ProxmoxCephSnapshotScan - Ceph cluster extras derive", () => {
  function feedFullCephBatch(buffers: CephBuffers): void {
    for (const mon of ["mon.a", "mon.b", "mon.c"]) {
      feedCeph(
        buffers,
        "ceph_mon_metadata",
        datapoint({
          value: 1,
          labels: {
            ceph_daemon: mon,
            hostname: `host-${mon}`,
            ceph_version:
              mon === "mon.c"
                ? "ceph version 19.2.0 squid"
                : "ceph version 18.2.2 reef",
          },
        }),
      );
    }
    for (const [osd, up, inCluster] of [
      ["osd.0", 1, 1],
      ["osd.1", 1, 0],
      ["osd.2", 0, 1],
    ] as Array<[string, number, number]>) {
      feedCeph(
        buffers,
        "ceph_osd_metadata",
        datapoint({ value: 1, labels: { ceph_daemon: osd } }),
      );
      feedCeph(
        buffers,
        "ceph_osd_up",
        datapoint({ value: up, labels: { ceph_daemon: osd } }),
      );
      feedCeph(
        buffers,
        "ceph_osd_in",
        datapoint({ value: inCluster, labels: { ceph_daemon: osd } }),
      );
    }
    feedCeph(
      buffers,
      "ceph_pool_metadata",
      datapoint({ value: 1, labels: { pool_id: "1", name: "rbd" } }),
    );
    feedCeph(buffers, "ceph_health_status", datapoint({ value: 2 }));
    feedCeph(buffers, "ceph_cluster_total_bytes", datapoint({ value: 3 }));
    feedCeph(buffers, "ceph_cluster_total_used_bytes", datapoint({ value: 1 }));
  }

  test("a full batch derives counts, health, capacity and the modal version", () => {
    const buffers: CephBuffers = cephBuffers();
    feedFullCephBatch(buffers);

    const extras: CephClusterSnapshotExtras = deriveCephClusterSnapshotExtras(
      cephEntries(buffers),
      buffers.clusterBuffer.get(CLUSTER),
    );

    expect(extras).toEqual({
      monCount: 3,
      osdCount: 3,
      osdUpCount: 2,
      osdInCount: 2,
      poolCount: 1,
      healthStatus: 2,
      // 1/3 → rounded to 2 decimals (fingerprint-stability contract).
      capacityUsedPercent: 33.33,
      // 2× reef beats 1× squid.
      cephVersion: "ceph version 18.2.2 reef",
    });
  });

  test("a partial batch never zeroes a count and skips capacity without totals", () => {
    const buffers: CephBuffers = cephBuffers();
    // Latency mirror only — no identity / health / capacity series.
    feedCeph(
      buffers,
      "ceph_osd_apply_latency_ms",
      datapoint({ value: 12, labels: { ceph_daemon: "osd.0" } }),
    );
    // Used-bytes without total-bytes must not derive a percent.
    feedCeph(buffers, "ceph_cluster_total_used_bytes", datapoint({ value: 1 }));

    const extras: CephClusterSnapshotExtras = deriveCephClusterSnapshotExtras(
      cephEntries(buffers),
      buffers.clusterBuffer.get(CLUSTER),
    );

    expect(extras).toEqual({});
  });

  test("healthStatus 0 (HEALTH_OK) is still written — 0 is a value, not absence", () => {
    const buffers: CephBuffers = cephBuffers();
    feedCeph(buffers, "ceph_health_status", datapoint({ value: 0 }));

    const extras: CephClusterSnapshotExtras = deriveCephClusterSnapshotExtras(
      cephEntries(buffers),
      buffers.clusterBuffer.get(CLUSTER),
    );

    expect(extras).toEqual({ healthStatus: 0 });
  });
});
