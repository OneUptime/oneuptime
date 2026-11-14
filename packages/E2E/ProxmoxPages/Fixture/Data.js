/*
 * The made-up estates the Proxmox pages fixture serves, for an "Acme
 * Virtualization" workspace. Nothing here is a real customer's data.
 *
 * buildEstate(scenario, loadedAt) returns the cluster row, its inventory
 * (ProxmoxResource rows, the shape ingest writes), its open incidents and
 * alerts, its replication jobs and the linked Ceph cluster, for one of:
 *
 *   busy   (default) three nodes, one of them offline; guests that should be
 *          running and are not, an HA resource in error, a guest in no backup
 *          job, two templates, a storage nearly full and one unavailable, a
 *          failing replication job, backup results from the cluster's own
 *          notifications;
 *   calm   the same cluster with nothing that needs attention;
 *   new    a cluster that has just connected and reported nothing yet;
 *   large  twenty-four nodes and six hundred guests;
 *   native the Proxmox VE native OpenTelemetry push (no HA, start-on-boot,
 *          backup or replication data).
 *
 * scenario.notifications false: the cluster has never sent Proxmox VE's
 * notifications, so no guest has a backup result (backup job coverage still
 * comes from the exporter).
 */

export const PROJECT_ID = "10000000-0000-4000-8000-000000000001";

export function uuid(prefix, number) {
  return `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

export const CLUSTER_ID = uuid("71000000", 1);
export const CEPH_CLUSTER_ID = uuid("72000000", 1);

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const GIB = 1024 * 1024 * 1024;
const TIB = 1024 * GIB;

/*
 * One inventory row, as ProxmoxResourceService writes it. Unset columns stay
 * undefined, as a row whose series never arrived reads.
 */
function row(number, fields, loadedAt) {
  return {
    _id: uuid("73000000", number),
    proxmoxClusterId: CLUSTER_ID,
    metricsUpdatedAt: new Date(loadedAt - MINUTE),
    lastSeenAt: new Date(loadedAt - MINUTE),
    isNativePush: false,
    ...fields,
  };
}

function node(number, name, fields, loadedAt) {
  return row(
    number,
    {
      kind: "Node",
      externalId: `node/${name}`,
      name: name,
      ...fields,
    },
    loadedAt,
  );
}

function guest(number, vmid, name, type, nodeName, fields, loadedAt) {
  const memoryBytes =
    fields.latestMemoryBytes !== undefined ? fields.latestMemoryBytes : null;
  const maxMemoryBytes =
    fields.maxMemoryBytes !== undefined ? fields.maxMemoryBytes : null;
  return row(
    number,
    {
      kind: "Guest",
      externalId: `${type}/${vmid}`,
      name: name,
      vmid: vmid,
      guestType: type,
      parentNodeName: nodeName,
      latestMemoryPercent:
        memoryBytes !== null && maxMemoryBytes
          ? (memoryBytes / maxMemoryBytes) * 100
          : undefined,
      ...fields,
    },
    loadedAt,
  );
}

function storage(number, nodeName, name, fields, loadedAt) {
  return row(
    number,
    {
      kind: "Storage",
      externalId: `storage/${nodeName}/${name}`,
      name: name,
      parentNodeName: nodeName,
      ...fields,
    },
    loadedAt,
  );
}

function busyInventory(loadedAt, options) {
  const healthy = Boolean(options.healthy);
  const native = Boolean(options.native);
  const withoutResults = options.notifications === false;
  const lastNightBackup = new Date(loadedAt - 7 * HOUR);
  const backup = (status, ageHours, bytes, seconds) => {
    if (native || withoutResults) {
      return {};
    }
    return {
      lastBackupAt: new Date(loadedAt - ageHours * HOUR),
      lastBackupStatus: status,
      lastBackupBytes: bytes,
      lastBackupDurationSeconds: seconds,
    };
  };
  const ha = (state) => {
    return native ? {} : { haState: state };
  };
  const onboot = (value) => {
    return native ? {} : { onboot: value };
  };
  const covered = (value) => {
    return native ? {} : { isBackedUp: value };
  };

  const nodes = [
    node(
      1,
      "pve1",
      {
        isUp: true,
        ...ha("online"),
        uptimeSeconds: 41 * 86400 + 5 * 3600,
        latestCpuPercent: 42.3,
        latestMemoryBytes: 154 * GIB,
        maxMemoryBytes: 256 * GIB,
        latestMemoryPercent: (154 / 256) * 100,
        latestDiskBytes: 31 * GIB,
        maxDiskBytes: 94 * GIB,
        cpuCount: 64,
        subscriptionLevel: native ? undefined : "c",
      },
      loadedAt,
    ),
    node(
      2,
      "pve2",
      {
        isUp: true,
        ...ha("online"),
        uptimeSeconds: 12 * 86400 + 2 * 3600,
        latestCpuPercent: healthy ? 37.9 : 78.4,
        latestMemoryBytes: (healthy ? 160 : 223) * GIB,
        maxMemoryBytes: 256 * GIB,
        latestMemoryPercent: ((healthy ? 160 : 223) / 256) * 100,
        latestDiskBytes: 28 * GIB,
        maxDiskBytes: 94 * GIB,
        cpuCount: 64,
        subscriptionLevel: native ? undefined : "c",
      },
      loadedAt,
    ),
    node(
      3,
      "pve3",
      healthy
        ? {
            isUp: true,
            ...ha("online"),
            uptimeSeconds: 41 * 86400 + 4 * 3600,
            latestCpuPercent: 21.4,
            latestMemoryBytes: 98 * GIB,
            maxMemoryBytes: 128 * GIB,
            latestMemoryPercent: (98 / 128) * 100,
            latestDiskBytes: 22 * GIB,
            maxDiskBytes: 94 * GIB,
            cpuCount: 32,
            subscriptionLevel: native ? undefined : "c",
          }
        : {
            isUp: false,
            ...ha("unknown"),
            uptimeSeconds: 0,
            maxMemoryBytes: 128 * GIB,
            cpuCount: 32,
            metricsUpdatedAt: new Date(loadedAt - 25 * MINUTE),
            lastSeenAt: new Date(loadedAt - MINUTE),
            subscriptionLevel: native ? undefined : "c",
          },
      loadedAt,
    ),
  ];

  const guests = [
    guest(
      10,
      100,
      "web-01",
      "qemu",
      "pve1",
      {
        isUp: true,
        ...ha("started"),
        ...onboot(true),
        ...covered(true),
        ...backup("ok", 7, 18.4 * GIB, 212),
        tags: native ? undefined : "prod;web",
        uptimeSeconds: 12 * 86400,
        latestCpuPercent: 22.1,
        latestMemoryBytes: 5.6 * GIB,
        maxMemoryBytes: 8 * GIB,
        latestDiskBytes: 0,
        maxDiskBytes: 64 * GIB,
        cpuCount: 4,
      },
      loadedAt,
    ),
    guest(
      11,
      101,
      "web-02",
      "qemu",
      "pve2",
      {
        isUp: true,
        ...ha("started"),
        ...onboot(true),
        ...covered(true),
        ...backup("ok", 7, 18.1 * GIB, 205),
        tags: native ? undefined : "prod;web",
        uptimeSeconds: 12 * 86400,
        latestCpuPercent: 19.4,
        latestMemoryBytes: 5.1 * GIB,
        maxMemoryBytes: 8 * GIB,
        maxDiskBytes: 64 * GIB,
        cpuCount: 4,
      },
      loadedAt,
    ),
    guest(
      12,
      102,
      "db-01",
      "qemu",
      "pve2",
      {
        isUp: true,
        ...ha("started"),
        ...onboot(true),
        ...covered(true),
        ...backup(healthy ? "ok" : "failed", 7, 0, 41),
        tags: native ? undefined : "prod;db",
        uptimeSeconds: 12 * 86400,
        latestCpuPercent: healthy ? 48.2 : 91.6,
        latestMemoryBytes: 58 * GIB,
        maxMemoryBytes: 64 * GIB,
        maxDiskBytes: 512 * GIB,
        cpuCount: 16,
      },
      loadedAt,
    ),
    guest(
      13,
      103,
      "cache-01",
      "lxc",
      "pve1",
      {
        isUp: true,
        ...onboot(true),
        ...covered(true),
        ...backup("ok", 7, 1.2 * GIB, 18),
        tags: native ? undefined : "prod",
        uptimeSeconds: 41 * 86400,
        latestCpuPercent: 3.2,
        latestMemoryBytes: 1.4 * GIB,
        maxMemoryBytes: 4 * GIB,
        latestDiskBytes: 2.1 * GIB,
        maxDiskBytes: 8 * GIB,
        cpuCount: 2,
      },
      loadedAt,
    ),
    guest(
      14,
      104,
      "mail",
      "qemu",
      "pve3",
      healthy
        ? {
            isUp: true,
            ...ha("started"),
            ...onboot(true),
            ...covered(true),
            ...backup("ok", 7, 9.8 * GIB, 96),
            uptimeSeconds: 41 * 86400,
            latestCpuPercent: 6.1,
            latestMemoryBytes: 3.1 * GIB,
            maxMemoryBytes: 6 * GIB,
            maxDiskBytes: 128 * GIB,
            cpuCount: 2,
          }
        : {
            isUp: false,
            ...ha("error"),
            ...onboot(true),
            ...covered(true),
            ...backup("ok", 31, 9.8 * GIB, 96),
            uptimeSeconds: 0,
            maxMemoryBytes: 6 * GIB,
            maxDiskBytes: 128 * GIB,
            cpuCount: 2,
          },
      loadedAt,
    ),
    guest(
      15,
      105,
      "ci-runner",
      "lxc",
      "pve1",
      {
        isUp: true,
        ...onboot(true),
        ...covered(true),
        ...backup("ok", 7, 6.4 * GIB, 54),
        lockState: native || healthy ? undefined : "backup",
        tags: native ? undefined : "ci",
        uptimeSeconds: 3 * 86400,
        latestCpuPercent: 64.8,
        latestMemoryBytes: 6.9 * GIB,
        maxMemoryBytes: 8 * GIB,
        latestDiskBytes: 21 * GIB,
        maxDiskBytes: 32 * GIB,
        cpuCount: 8,
      },
      loadedAt,
    ),
    guest(
      16,
      106,
      "monitoring",
      "lxc",
      "pve2",
      {
        isUp: true,
        ...onboot(true),
        ...covered(true),
        ...backup("ok", 7, 3.3 * GIB, 31),
        uptimeSeconds: 12 * 86400,
        latestCpuPercent: 7.5,
        latestMemoryBytes: 1.9 * GIB,
        maxMemoryBytes: 4 * GIB,
        latestDiskBytes: 11 * GIB,
        maxDiskBytes: 16 * GIB,
        cpuCount: 2,
      },
      loadedAt,
    ),
    guest(
      17,
      107,
      "build-box",
      "qemu",
      "pve1",
      {
        isUp: false,
        ...onboot(false),
        ...covered(true),
        ...backup("ok", 7, 22 * GIB, 260),
        uptimeSeconds: 0,
        maxMemoryBytes: 16 * GIB,
        maxDiskBytes: 128 * GIB,
        cpuCount: 8,
      },
      loadedAt,
    ),
    guest(
      18,
      109,
      "vpn",
      "lxc",
      "pve2",
      {
        isUp: true,
        ...onboot(true),
        ...covered(healthy ? true : false),
        ...(healthy ? backup("ok", 7, 0.6 * GIB, 9) : {}),
        uptimeSeconds: 12 * 86400,
        latestCpuPercent: 1.1,
        latestMemoryBytes: 0.3 * GIB,
        maxMemoryBytes: 1 * GIB,
        latestDiskBytes: 1.1 * GIB,
        maxDiskBytes: 4 * GIB,
        cpuCount: 1,
      },
      loadedAt,
    ),
    guest(
      19,
      110,
      "files",
      "lxc",
      "pve3",
      healthy
        ? {
            isUp: true,
            ...onboot(true),
            ...covered(true),
            ...backup("ok", 7, 140 * GIB, 1290),
            uptimeSeconds: 41 * 86400,
            latestCpuPercent: 2.4,
            latestMemoryBytes: 1.1 * GIB,
            maxMemoryBytes: 2 * GIB,
            latestDiskBytes: 410 * GIB,
            maxDiskBytes: 512 * GIB,
            cpuCount: 2,
          }
        : {
            isUp: false,
            ...onboot(true),
            ...covered(true),
            ...backup("ok", 31, 140 * GIB, 1290),
            uptimeSeconds: 0,
            maxMemoryBytes: 2 * GIB,
            maxDiskBytes: 512 * GIB,
            cpuCount: 2,
          },
      loadedAt,
    ),
    guest(
      20,
      111,
      "analytics",
      "qemu",
      "pve2",
      {
        isUp: true,
        ...onboot(false),
        ...covered(true),
        ...backup("ok", 7, 46 * GIB, 488),
        tags: native ? undefined : "data",
        uptimeSeconds: 2 * 86400,
        latestCpuPercent: 33.9,
        latestMemoryBytes: 27 * GIB,
        maxMemoryBytes: 32 * GIB,
        maxDiskBytes: 256 * GIB,
        cpuCount: 8,
      },
      loadedAt,
    ),
    guest(
      21,
      9000,
      "debian-12-template",
      "qemu",
      "pve1",
      {
        isUp: false,
        isTemplate: native ? undefined : true,
        ...onboot(false),
        ...covered(true),
        uptimeSeconds: 0,
        maxMemoryBytes: 2 * GIB,
        maxDiskBytes: 32 * GIB,
        cpuCount: 2,
      },
      loadedAt,
    ),
    guest(
      22,
      9001,
      "ubuntu-24.04-template",
      "qemu",
      "pve2",
      {
        isUp: false,
        isTemplate: native ? undefined : true,
        ...onboot(false),
        ...covered(true),
        uptimeSeconds: 0,
        maxMemoryBytes: 2 * GIB,
        maxDiskBytes: 32 * GIB,
        cpuCount: 2,
      },
      loadedAt,
    ),
  ];

  const storages = [
    storage(
      40,
      "pve1",
      "local",
      {
        isUp: true,
        storageType: native ? undefined : "dir",
        storageContent: native ? undefined : "backup,iso,vztmpl",
        isShared: native ? undefined : false,
        latestDiskBytes: 17 * GIB,
        maxDiskBytes: 94 * GIB,
      },
      loadedAt,
    ),
    storage(
      41,
      "pve1",
      "local-lvm",
      {
        isUp: true,
        storageType: native ? undefined : "lvmthin",
        storageContent: native ? undefined : "images,rootdir",
        isShared: native ? undefined : false,
        latestDiskBytes: 1.3 * TIB,
        maxDiskBytes: 1.8 * TIB,
      },
      loadedAt,
    ),
    storage(
      42,
      "pve2",
      "local",
      {
        isUp: true,
        storageType: native ? undefined : "dir",
        storageContent: native ? undefined : "backup,iso,vztmpl",
        isShared: native ? undefined : false,
        latestDiskBytes: 21 * GIB,
        maxDiskBytes: 94 * GIB,
      },
      loadedAt,
    ),
    storage(
      43,
      "pve2",
      "local-zfs",
      {
        isUp: true,
        storageType: native ? undefined : "zfspool",
        storageContent: native ? undefined : "images,rootdir",
        isShared: native ? undefined : false,
        latestDiskBytes: (healthy ? 1.1 : 1.71) * TIB,
        maxDiskBytes: 1.8 * TIB,
      },
      loadedAt,
    ),
    storage(
      44,
      "pve3",
      "local",
      healthy
        ? {
            isUp: true,
            storageType: native ? undefined : "dir",
            storageContent: native ? undefined : "backup,iso,vztmpl",
            isShared: native ? undefined : false,
            latestDiskBytes: 12 * GIB,
            maxDiskBytes: 94 * GIB,
          }
        : {
            isUp: false,
            storageType: native ? undefined : "dir",
            storageContent: native ? undefined : "backup,iso,vztmpl",
            isShared: native ? undefined : false,
            maxDiskBytes: 94 * GIB,
            metricsUpdatedAt: new Date(loadedAt - 25 * MINUTE),
          },
      loadedAt,
    ),
    storage(
      45,
      "pve1",
      "pbs-offsite",
      {
        isUp: healthy,
        storageType: native ? undefined : "pbs",
        storageContent: native ? undefined : "backup",
        isShared: native ? undefined : true,
        latestDiskBytes: healthy ? 6.1 * TIB : undefined,
        maxDiskBytes: 12 * TIB,
      },
      loadedAt,
    ),
    storage(
      46,
      "pve1",
      "ceph-vm",
      {
        isUp: true,
        storageType: native ? undefined : "rbd",
        storageContent: native ? undefined : "images,rootdir",
        isShared: native ? undefined : true,
        latestDiskBytes: 9.8 * TIB,
        maxDiskBytes: 18 * TIB,
      },
      loadedAt,
    ),
  ];

  return [...nodes, ...guests, ...storages];
}

function largeInventory(loadedAt) {
  const rows = [];
  let number = 1;
  for (let n = 1; n <= 24; n++) {
    const name = `pve-${String(n).padStart(2, "0")}`;
    rows.push(
      node(
        number++,
        name,
        {
          isUp: n !== 17,
          haState: n === 17 ? "unknown" : "online",
          uptimeSeconds: (20 + n) * 86400,
          latestCpuPercent: n === 17 ? undefined : 20 + ((n * 7) % 60),
          latestMemoryBytes:
            n === 17 ? undefined : (120 + ((n * 11) % 120)) * GIB,
          maxMemoryBytes: 256 * GIB,
          latestMemoryPercent:
            n === 17 ? undefined : ((120 + ((n * 11) % 120)) / 256) * 100,
          cpuCount: 64,
          subscriptionLevel: "s",
        },
        loadedAt,
      ),
    );
  }
  for (let g = 0; g < 600; g++) {
    const vmid = 1000 + g;
    const nodeName = `pve-${String((g % 24) + 1).padStart(2, "0")}`;
    const isContainer = g % 3 === 0;
    const isUp = g % 41 !== 0;
    rows.push(
      guest(
        number++,
        vmid,
        `${isContainer ? "ct" : "vm"}-${String(g).padStart(3, "0")}`,
        isContainer ? "lxc" : "qemu",
        nodeName,
        {
          isUp: nodeName === "pve-17" ? false : isUp,
          haState: g % 5 === 0 ? "started" : undefined,
          onboot: true,
          isBackedUp: g % 97 !== 0,
          lastBackupAt: new Date(loadedAt - (6 + (g % 5)) * HOUR),
          lastBackupStatus: g % 113 === 0 ? "failed" : "ok",
          uptimeSeconds: isUp ? (g % 30) * 86400 : 0,
          latestCpuPercent: isUp ? (g * 13) % 97 : undefined,
          latestMemoryBytes: isUp ? ((g % 16) + 1) * GIB * 0.6 : undefined,
          maxMemoryBytes: ((g % 16) + 1) * GIB,
          maxDiskBytes: 64 * GIB,
          cpuCount: (g % 8) + 1,
        },
        loadedAt,
      ),
    );
  }
  for (let n = 1; n <= 24; n++) {
    const name = `pve-${String(n).padStart(2, "0")}`;
    rows.push(
      storage(
        number++,
        name,
        "local-zfs",
        {
          isUp: n !== 17,
          storageType: "zfspool",
          storageContent: "images,rootdir",
          isShared: false,
          latestDiskBytes: n === 17 ? undefined : (0.4 + (n % 9) / 10) * TIB,
          maxDiskBytes: 1.8 * TIB,
        },
        loadedAt,
      ),
    );
  }
  rows.push(
    storage(
      number++,
      "pve-01",
      "ceph-vm",
      {
        isUp: true,
        storageType: "rbd",
        storageContent: "images,rootdir",
        isShared: true,
        latestDiskBytes: 160 * TIB,
        maxDiskBytes: 240 * TIB,
      },
      loadedAt,
    ),
  );
  return rows;
}

export function buildEstate(scenario, loadedAt) {
  const estate = scenario.estate;
  const disconnected = scenario.collector === "disconnected";
  /*
   * Issue #7439: the agent runs, but the cluster is not read - it last read
   * the cluster 25 minutes ago (unreadable), or never has (waiting).
   */
  const unreadable = scenario.collector === "unreadable";
  const waiting = scenario.collector === "waiting";
  const notifications = scenario.notifications !== false;

  let inventory = [];
  if (waiting) {
    // Nothing read yet: no inventory at all.
    inventory = [];
  } else if (estate === "busy") {
    inventory = busyInventory(loadedAt, { notifications });
  } else if (estate === "calm") {
    inventory = busyInventory(loadedAt, { healthy: true, notifications });
  } else if (estate === "native") {
    inventory = busyInventory(loadedAt, { native: true }).map((record) => {
      return { ...record, isNativePush: true };
    });
  } else if (estate === "large") {
    inventory = largeInventory(loadedAt);
  }

  if (disconnected) {
    inventory = inventory.map((record) => {
      return {
        ...record,
        metricsUpdatedAt: new Date(loadedAt - 3 * DAY),
        lastSeenAt: new Date(loadedAt - 3 * DAY),
      };
    });
  }
  if (unreadable) {
    inventory = inventory.map((record) => {
      return {
        ...record,
        metricsUpdatedAt: new Date(loadedAt - 25 * MINUTE),
        lastSeenAt: new Date(loadedAt - 25 * MINUTE),
      };
    });
  }

  const nodes = inventory.filter((record) => {
    return record.kind === "Node";
  });
  const guests = inventory.filter((record) => {
    return record.kind === "Guest";
  });
  const storages = inventory.filter((record) => {
    return record.kind === "Storage";
  });

  const cluster = {
    _id: CLUSTER_ID,
    name: estate === "large" ? "pve-fra" : "pve-prod",
    description:
      estate === "large"
        ? "Frankfurt production estate: 24 nodes behind the shared Ceph pool."
        : "Production cluster in the Amsterdam data centre: web, database and mail.",
    otelCollectorStatus:
      disconnected || unreadable || waiting ? "disconnected" : "connected",
    // When the cluster was last read; never, while the agent waits.
    lastSeenAt: waiting
      ? undefined
      : estate === "new"
        ? new Date(loadedAt - MINUTE)
        : new Date(
            loadedAt -
              (disconnected ? 3 * DAY : unreadable ? 25 * MINUTE : MINUTE),
          ),
    // When the agent last sent anything, read or not (fenced to ~5 minutes).
    agentLastSeenAt: new Date(
      loadedAt - (disconnected ? 3 * DAY : waiting ? MINUTE : 3 * MINUTE),
    ),
    pveVersion: estate === "new" ? undefined : "9.0.10",
    agentVersion:
      estate === "native" || estate === "new" ? undefined : "0.161.2",
    nodeCount: nodes.length,
    onlineNodeCount: nodes.filter((record) => {
      return record.isUp;
    }).length,
    guestCount: guests.length,
    storageCount: storages.length,
    guestsWithoutBackupCount:
      estate === "native" || estate === "new"
        ? undefined
        : guests.filter((record) => {
            return record.isBackedUp === false;
          }).length,
    isQuorate:
      estate === "native" || estate === "new"
        ? undefined
        : nodes.filter((record) => {
            return record.isUp;
          }).length *
            2 >
          nodes.length,
    // The last backup's notification, last night.
    lastNotificationAt:
      notifications && estate !== "native" && estate !== "new"
        ? new Date(loadedAt - 7 * HOUR)
        : undefined,
    cephClusterId:
      estate === "busy" || estate === "calm" ? CEPH_CLUSTER_ID : undefined,
    labels: [],
    isArchived: false,
    createdAt: new Date(loadedAt - 90 * DAY),
  };

  const cephCluster = {
    _id: CEPH_CLUSTER_ID,
    name: "ceph-ams",
    healthStatus: estate === "busy" ? 1 : 0,
    capacityUsedPercent: 54.4,
  };

  const replicationJobs =
    estate === "busy" || estate === "calm"
      ? [
          {
            id: "102-0",
            guest: "102",
            source: "node/pve2",
            target: "node/pve1",
            lastSyncSecondsAgo: 9 * 60,
            durationSeconds: 38,
            failedSyncs: 0,
          },
          {
            id: "101-0",
            guest: "101",
            source: "node/pve2",
            target: "node/pve3",
            lastSyncSecondsAgo: estate === "busy" ? 3 * 3600 : 6 * 60,
            durationSeconds: 12,
            failedSyncs: estate === "busy" ? 3 : 0,
          },
        ]
      : [];

  return {
    cluster,
    cephCluster,
    inventory,
    replicationJobs,
  };
}
