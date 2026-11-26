/*
 * The made-up estates the XCP-ng pages fixture serves, for an "Acme
 * Virtualization" workspace. Nothing here is a real customer's data: the
 * pool mirrors the recorded lab the agent's tests read
 * (Tests/Ops/Fixtures/XcpNg/XenOrchestraScrape.js, its second scrape), with
 * the same names and UUIDs.
 *
 * buildEstate(scenario, loadedAt) returns the pool row (XcpNgPool) and its
 * inventory (XcpNgResource rows, the shape ingest writes), for one of:
 *
 *   busy   (default) the Production pool: xcp-prod-01 running, xcp-prod-02
 *          running but disabled (maintenance mode), xcp-prod-03 halted;
 *          web-01 halted a minute after it ran, db-01 starved of CPU,
 *          app-02 just started, win-03 suspended, two control domains; a
 *          local LVM repository, an NFS one 92.5% full and allocated past
 *          its size, an ISO library; the virtual disks between them;
 *   calm   the same pool with nothing that needs attention;
 *   new    a pool that was just added: Xen Orchestra has reported nothing;
 *   large  twenty-four hosts and two hundred and forty VMs.
 *
 * scenario.collector "disconnected": the agent and Xen Orchestra both went
 * quiet three days ago; "stopped": the agent runs, but Xen Orchestra last
 * reported the pool two hours ago.
 */

export const PROJECT_ID = "10000000-0000-4000-8000-000000000001";

export function uuid(prefix, number) {
  return `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

export const POOL_ID = uuid("71000000", 1);

// The lab's UUIDs (XenOrchestraScrape.js).
export const POOL_UUID = "b7569d99-30f8-178a-7d94-801de3e29b5b";
export const HOST = {
  prod1: "9c6c0b6e-4f2a-4a7e-8b1e-0d1f2a3b4c5d",
  prod2: "4e1d3a2b-7c8d-4e9f-a0b1-c2d3e4f5a6b7",
  prod3: "f0e1d2c3-b4a5-4968-8776-655443322110",
};
export const VM = {
  web01: "e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c",
  db01: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
  app02: "7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e",
  win03: "9d0e1f2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a",
  dom0prod1: "0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e",
  dom0prod2: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
};
export const SR = {
  local: "ad4b8c63-1f2e-4d3c-8b4a-596877665544",
  nfs: "1d2c3b4a-5e6f-4789-9abc-def012345678",
  tools: "c0ffee00-1111-4222-8333-444455556666",
};
export const VDI = {
  web01: "aa11bb22-cc33-4d44-8e55-ff6677889900",
  db01: "bb22cc33-dd44-4e55-8f66-007788990011",
  orphan: "cc33dd44-ee55-4f66-8077-118899001122",
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const GIB = 1024 * 1024 * 1024;

/*
 * One inventory row, as XcpNgResourceService writes it. Unset columns stay
 * undefined, as a row whose series never arrived reads.
 */
function row(number, fields, loadedAt) {
  return {
    _id: uuid("73000000", number),
    xcpNgPoolId: POOL_ID,
    metricsUpdatedAt: new Date(loadedAt - MINUTE),
    lastSeenAt: new Date(loadedAt - MINUTE),
    ...fields,
  };
}

function busyInventory(loadedAt, options) {
  const healthy = Boolean(options && options.healthy);
  const ago = (ms) => {
    return new Date(loadedAt - ms);
  };
  const hosts = [
    row(
      1,
      {
        kind: "Host",
        externalId: HOST.prod1,
        name: "xcp-prod-01",
        powerState: "Running",
        isUp: true,
        isEnabled: true,
        tags: "rack-a",
        uptimeSeconds: 10 * 86400,
        cpuCount: 4,
        runningVcpuCount: healthy ? 7 : 5,
        latestCpuPercent: 42.4,
        loadAverage: 1.32,
        latestMemoryBytes: 41 * GIB,
        maxMemoryBytes: 64 * GIB,
        powerWatts: 241,
      },
      loadedAt,
    ),
    row(
      2,
      {
        kind: "Host",
        externalId: HOST.prod2,
        name: "xcp-prod-02",
        powerState: "Running",
        isUp: true,
        // In maintenance mode: disabled, still running its VMs.
        isEnabled: healthy,
        uptimeSeconds: 5 * 3600,
        cpuCount: 4,
        runningVcpuCount: 8,
        latestCpuPercent: 71.8,
        loadAverage: 3.9,
        latestMemoryBytes: 29 * GIB,
        maxMemoryBytes: 64 * GIB,
      },
      loadedAt,
    ),
    row(
      3,
      {
        kind: "Host",
        externalId: HOST.prod3,
        name: "xcp-prod-03",
        powerState: healthy ? "Running" : "Halted",
        isUp: healthy,
        isEnabled: true,
        cpuCount: 4,
        ...(healthy
          ? {
              uptimeSeconds: 31 * 86400,
              runningVcpuCount: 4,
              latestCpuPercent: 12.1,
              loadAverage: 0.4,
              latestMemoryBytes: 9 * GIB,
              maxMemoryBytes: 64 * GIB,
            }
          : {
              // Down: Xen Orchestra keeps reporting its status, and nothing else.
              maxMemoryBytes: 64 * GIB,
              metricsUpdatedAt: ago(4 * HOUR),
            }),
      },
      loadedAt,
    ),
  ];

  const vms = [
    row(
      10,
      {
        kind: "VM",
        externalId: VM.web01,
        name: "web-01",
        isControlDomain: false,
        // Shut down a minute ago, after two days of running.
        powerState: healthy ? "Running" : "Halted",
        isUp: healthy,
        parentHostExternalId: HOST.prod1,
        parentHostName: "xcp-prod-01",
        tags: "production,web",
        cpuCount: 2,
        maxMemoryBytes: 4 * GIB,
        lastRunningAt: ago(MINUTE),
        ...(healthy
          ? {
              uptimeSeconds: 2 * 86400,
              latestCpuPercent: 18.3,
              latestMemoryBytes: 2.6 * GIB,
            }
          : { metricsUpdatedAt: ago(2 * MINUTE) }),
      },
      loadedAt,
    ),
    row(
      11,
      {
        kind: "VM",
        externalId: VM.db01,
        name: "db-01",
        isControlDomain: false,
        powerState: "Running",
        isUp: true,
        parentHostExternalId: HOST.prod2,
        parentHostName: "xcp-prod-02",
        tags: "production",
        cpuCount: 4,
        uptimeSeconds: 4 * 3600,
        lastRunningAt: ago(MINUTE),
        // Starved of CPU: its vCPUs wait for the host's.
        latestCpuPercent: healthy ? 34.2 : 96.4,
        latestMemoryBytes: 13.1 * GIB,
        maxMemoryBytes: 16 * GIB,
      },
      loadedAt,
    ),
    row(
      12,
      {
        kind: "VM",
        externalId: VM.app02,
        name: "app-02",
        isControlDomain: false,
        powerState: "Running",
        isUp: true,
        parentHostExternalId: HOST.prod1,
        parentHostName: "xcp-prod-01",
        cpuCount: 1,
        // Started forty seconds ago, no guest tools yet: no memory reading.
        uptimeSeconds: 40,
        lastRunningAt: ago(MINUTE),
        latestCpuPercent: 7.5,
        maxMemoryBytes: 2 * GIB,
      },
      loadedAt,
    ),
    row(
      13,
      {
        kind: "VM",
        externalId: VM.win03,
        name: "win-03",
        isControlDomain: false,
        powerState: "Suspended",
        isUp: false,
        tags: "windows",
        cpuCount: 2,
        maxMemoryBytes: 8 * GIB,
        metricsUpdatedAt: undefined,
      },
      loadedAt,
    ),
    row(
      14,
      {
        kind: "VM",
        externalId: VM.dom0prod1,
        name: "Control domain on host: xcp-prod-01",
        isControlDomain: true,
        powerState: "Running",
        isUp: true,
        parentHostExternalId: HOST.prod1,
        parentHostName: "xcp-prod-01",
        cpuCount: 4,
        latestCpuPercent: 3.1,
        maxMemoryBytes: 2 * GIB,
      },
      loadedAt,
    ),
    row(
      15,
      {
        kind: "VM",
        externalId: VM.dom0prod2,
        name: "Control domain on host: xcp-prod-02",
        isControlDomain: true,
        powerState: "Running",
        isUp: true,
        parentHostExternalId: HOST.prod2,
        parentHostName: "xcp-prod-02",
        cpuCount: 4,
        latestCpuPercent: 4.8,
        maxMemoryBytes: 2 * GIB,
      },
      loadedAt,
    ),
  ];

  const nfsUsed = healthy ? 1290 * GIB : Math.round(1894.4 * GIB);
  const repositories = [
    row(
      20,
      {
        kind: "StorageRepository",
        externalId: SR.local,
        name: "Local storage",
        srType: "lvm",
        contentType: "user",
        isShared: false,
        parentHostExternalId: HOST.prod1,
        parentHostName: "xcp-prod-01",
        latestDiskBytes: 120 * GIB,
        maxDiskBytes: 500 * GIB,
        latestDiskPercent: 24,
        virtualAllocationBytes: 200 * GIB,
      },
      loadedAt,
    ),
    row(
      21,
      {
        kind: "StorageRepository",
        externalId: SR.nfs,
        name: "NFS VM store",
        srType: "nfs",
        contentType: "user",
        isShared: true,
        tags: "shared-storage",
        latestDiskBytes: nfsUsed,
        maxDiskBytes: 2048 * GIB,
        latestDiskPercent: (nfsUsed / (2048 * GIB)) * 100,
        // Thin provisioning took it past its size (130%).
        virtualAllocationBytes: healthy ? 1700 * GIB : Math.round(2662.4 * GIB),
      },
      loadedAt,
    ),
    row(
      22,
      {
        kind: "StorageRepository",
        externalId: SR.tools,
        name: "XCP-ng Tools",
        srType: "iso",
        contentType: "iso",
        isShared: true,
        latestDiskBytes: 0,
        maxDiskBytes: 0,
        virtualAllocationBytes: 0,
      },
      loadedAt,
    ),
  ];

  const disks = [
    row(
      30,
      {
        kind: "VDI",
        externalId: VDI.web01,
        name: "web-01 system",
        vmExternalId: VM.web01,
        vmName: "web-01",
        storageRepositoryExternalId: SR.nfs,
        storageRepositoryName: "NFS VM store",
        maxDiskBytes: 20 * GIB,
        latestDiskBytes: 8 * GIB,
      },
      loadedAt,
    ),
    row(
      31,
      {
        kind: "VDI",
        externalId: VDI.db01,
        name: "db-01 data",
        vmExternalId: VM.db01,
        vmName: "db-01",
        storageRepositoryExternalId: SR.nfs,
        storageRepositoryName: "NFS VM store",
        maxDiskBytes: 100 * GIB,
        latestDiskBytes: 61 * GIB,
      },
      loadedAt,
    ),
    row(
      32,
      {
        kind: "VDI",
        externalId: VDI.orphan,
        name: "old-backup",
        storageRepositoryExternalId: SR.nfs,
        storageRepositoryName: "NFS VM store",
        maxDiskBytes: 50 * GIB,
        latestDiskBytes: 50 * GIB,
      },
      loadedAt,
    ),
  ];

  return [...hosts, ...vms, ...repositories, ...disks];
}

/*
 * Twenty-four hosts with ten VMs each and six shared repositories: the
 * Overview shows eight hosts and a way to all of them.
 */
function largeInventory(loadedAt) {
  const rows = [];
  let number = 100;
  for (let index = 1; index <= 24; index++) {
    const name = `xcp-fra-${String(index).padStart(2, "0")}`;
    const hostId = uuid("74000000", index);
    const isUp = index !== 17;
    rows.push(
      row(
        number++,
        {
          kind: "Host",
          externalId: hostId,
          name: name,
          powerState: isUp ? "Running" : "Halted",
          isUp: isUp,
          isEnabled: index !== 9,
          cpuCount: 32,
          runningVcpuCount: isUp ? 40 : 0,
          uptimeSeconds: isUp ? (20 + index) * 86400 : undefined,
          latestCpuPercent: isUp ? 20 + ((index * 7) % 60) : undefined,
          latestMemoryBytes: isUp ? (100 + index * 5) * GIB : undefined,
          maxMemoryBytes: 384 * GIB,
          metricsUpdatedAt: new Date(loadedAt - (isUp ? MINUTE : 6 * HOUR)),
        },
        loadedAt,
      ),
    );
    for (let vm = 1; vm <= 10; vm++) {
      const running = isUp && vm !== 10;
      rows.push(
        row(
          number++,
          {
            kind: "VM",
            externalId: uuid("75000000", index * 100 + vm),
            name: `fra-${String(index).padStart(2, "0")}-vm-${String(vm).padStart(2, "0")}`,
            isControlDomain: false,
            powerState: running ? "Running" : "Halted",
            isUp: running,
            parentHostExternalId: hostId,
            parentHostName: name,
            cpuCount: 4,
            maxMemoryBytes: 16 * GIB,
            uptimeSeconds: running ? 7 * 86400 : undefined,
            latestCpuPercent: running
              ? 5 + ((index + vm * 11) % 80)
              : undefined,
            latestMemoryBytes: running ? (4 + (vm % 10)) * GIB : undefined,
          },
          loadedAt,
        ),
      );
    }
  }
  for (let index = 1; index <= 6; index++) {
    const size = 8192 * GIB;
    const used = (index === 3 ? 0.93 : 0.4 + index * 0.06) * size;
    rows.push(
      row(
        number++,
        {
          kind: "StorageRepository",
          externalId: uuid("76000000", index),
          name: `ceph-fra-${index}`,
          srType: "nfs",
          contentType: "user",
          isShared: true,
          latestDiskBytes: Math.round(used),
          maxDiskBytes: size,
          latestDiskPercent: (used / size) * 100,
          virtualAllocationBytes: Math.round(size * 0.8),
        },
        loadedAt,
      ),
    );
  }
  return rows;
}

function count(inventory, predicate) {
  return inventory.filter(predicate).length;
}

export function buildEstate(scenario, loadedAt) {
  const estate = scenario.estate;
  const disconnected = scenario.collector === "disconnected";
  const stopped = scenario.collector === "stopped";
  const isNew = estate === "new";

  let inventory = [];
  if (estate === "busy") {
    inventory = busyInventory(loadedAt, {});
  } else if (estate === "calm") {
    inventory = busyInventory(loadedAt, { healthy: true });
  } else if (estate === "large") {
    inventory = largeInventory(loadedAt);
  }

  const quietFor = disconnected ? 3 * DAY : stopped ? 2 * HOUR : 0;
  if (quietFor > 0) {
    inventory = inventory.map((record) => {
      return {
        ...record,
        metricsUpdatedAt: new Date(loadedAt - quietFor),
        lastSeenAt: new Date(loadedAt - quietFor),
      };
    });
  }

  const hosts = inventory.filter((record) => {
    return record.kind === "Host";
  });
  const vms = inventory.filter((record) => {
    return record.kind === "VM" && !record.isControlDomain;
  });
  const holdsVmDisks = (record) => {
    return (
      record.kind === "StorageRepository" &&
      record.contentType !== "iso" &&
      record.contentType !== "disk" &&
      (record.maxDiskBytes || 0) > 0
    );
  };

  const pool = {
    _id: POOL_ID,
    name: estate === "large" ? "Frankfurt" : "Production",
    description: isNew
      ? undefined
      : estate === "large"
        ? "Frankfurt production estate: 24 hosts on the shared Ceph NFS gateways."
        : "Production pool in the Paris data centre: web, database and Windows VMs.",
    // Entered when the pool was added, before Xen Orchestra reported it.
    poolIdentifier: POOL_UUID,
    reportedName: isNew
      ? undefined
      : estate === "large"
        ? "Frankfurt"
        : "Production",
    xenOrchestraName: isNew ? undefined : "xo-paris",
    agentVersion: isNew ? undefined : "0.165.0",
    otelCollectorStatus:
      isNew || disconnected || stopped ? "disconnected" : "connected",
    // When Xen Orchestra last reported the pool; never, for a new one.
    lastSeenAt: isNew ? undefined : new Date(loadedAt - (quietFor || MINUTE)),
    // When the agent last sent anything (its heartbeat).
    agentLastSeenAt: isNew
      ? undefined
      : new Date(loadedAt - (disconnected ? 3 * DAY : MINUTE)),
    hostCount: hosts.length,
    runningHostCount: count(hosts, (record) => {
      return record.isUp === true;
    }),
    disabledHostCount: count(hosts, (record) => {
      return record.isEnabled === false;
    }),
    vmCount: vms.length,
    runningVmCount: count(vms, (record) => {
      return record.isUp === true;
    }),
    storageRepositoryCount: count(inventory, (record) => {
      return record.kind === "StorageRepository";
    }),
    vdiCount: count(inventory, (record) => {
      return record.kind === "VDI";
    }),
    storageCapacityBytes: inventory
      .filter(holdsVmDisks)
      .reduce((sum, record) => {
        return sum + (record.maxDiskBytes || 0);
      }, 0),
    storageUsedBytes: inventory.filter(holdsVmDisks).reduce((sum, record) => {
      return sum + (record.latestDiskBytes || 0);
    }, 0),
    labels: [],
    isArchived: false,
    createdAt: new Date(loadedAt - (isNew ? 2 * MINUTE : 90 * DAY)),
  };

  return { pool, inventory };
}
