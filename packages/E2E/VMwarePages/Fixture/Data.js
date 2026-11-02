/*
 * The made-up vCenters the VMware pages fixture serves, for an "Acme
 * Virtualization" workspace. Nothing here is a real customer's data.
 *
 * buildEstate(scenario, loadedAt) returns the vCenter row and its inventory
 * (VMwareResource rows, the shape the metrics ingest writes), for one of:
 *
 *   busy   (default) two datacenters and three clusters: an ESXi host vCenter
 *          lost contact with (it reports 0 MiB in use, and its datacenter
 *          counts one host whose power state is unknown), a host past 90%
 *          CPU, a host in maintenance mode (connected, not effective), a
 *          cluster whose hosts could not take the load of its largest one,
 *          a VM the host swaps, one ballooned, one waiting for a CPU, a
 *          datastore 93% full and one 84% full, a resource pool whose
 *          memory is swapped, and the datacenter's own alarm counts;
 *   calm   the same vCenter with nothing that needs attention;
 *   new    a vCenter that has just connected and reported nothing yet;
 *   large  forty hosts and four hundred VMs, a few of them in trouble;
 *   standby a datacenter whose powered-off and standby hosts report no use.
 */

export const PROJECT_ID = "10000000-0000-4000-8000-000000000001";

export function uuid(prefix, number) {
  return `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

export const VCENTER_ID = uuid("31000000", 1);
export const VCENTER_NAME = "vcenter-prod";

const MINUTE = 60 * 1000;
const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const TIB = 1024 * GIB;

let rowNumber = 0;

/*
 * One inventory row, as VMwareResourceService writes it. Unset columns stay
 * undefined, as a row whose series never arrived reads.
 */
function row(fields, loadedAt) {
  rowNumber++;
  return {
    _id: uuid("40000000", rowNumber),
    vmwareVCenterId: VCENTER_ID,
    metricsUpdatedAt: new Date(loadedAt - 2 * MINUTE),
    lastSeenAt: new Date(loadedAt - 2 * MINUTE),
    ...fields,
  };
}

function datacenter(name, fields, loadedAt) {
  return row(
    {
      kind: "Datacenter",
      externalId: `datacenter/${name}`,
      name: name,
      datacenterName: name,
      ...fields,
    },
    loadedAt,
  );
}

function cluster(datacenterName, name, fields, loadedAt) {
  return row(
    {
      kind: "Cluster",
      externalId: `cluster/${datacenterName}/${name}`,
      name: name,
      datacenterName: datacenterName,
      clusterName: name,
      ...fields,
    },
    loadedAt,
  );
}

function host(datacenterName, clusterName, name, fields, loadedAt) {
  const memoryBytes = fields.latestMemoryBytes;
  const maxMemoryBytes =
    fields.maxMemoryBytes !== undefined ? fields.maxMemoryBytes : 512 * GIB;
  return row(
    {
      kind: "Host",
      externalId: `host/${datacenterName}/${name}`,
      name: name,
      hostName: name,
      datacenterName: datacenterName,
      clusterName: clusterName || undefined,
      cpuCapacityMhz: 76800,
      maxMemoryBytes: maxMemoryBytes,
      latestMemoryPercent:
        memoryBytes !== undefined && maxMemoryBytes
          ? (memoryBytes / maxMemoryBytes) * 100
          : undefined,
      ...fields,
    },
    loadedAt,
  );
}

function vm(number, name, hostRow, fields, loadedAt) {
  const instance = `4210aaaa-bbbb-cccc-dddd-${String(number).padStart(12, "0")}`;
  // The cluster's root pool ("Resources"), or a pool under it.
  const poolName = fields.resourcePoolName || "Resources";
  const rootPath = `/${hostRow.datacenterName}/host/${hostRow.clusterName || hostRow.hostName}/Resources`;
  return row(
    {
      kind: "VirtualMachine",
      externalId: `vm/${instance}`,
      vmInstanceUuid: instance,
      name: name,
      datacenterName: hostRow.datacenterName,
      clusterName: hostRow.clusterName,
      hostName: hostRow.hostName,
      resourcePoolName: poolName,
      resourcePoolPath:
        poolName === "Resources" ? rootPath : `${rootPath}/${poolName}`,
      isTemplate: false,
      isPoweredOn: true,
      memoryBalloonedBytes: 0,
      memorySwappedBytes: 0,
      ...fields,
    },
    loadedAt,
  );
}

function datastore(datacenterName, name, usedBytes, capacityBytes, loadedAt) {
  return row(
    {
      kind: "Datastore",
      externalId: `datastore/${datacenterName}/${name}`,
      name: name,
      datacenterName: datacenterName,
      latestDiskBytes: usedBytes,
      maxDiskBytes: capacityBytes,
      latestDiskPercent: (usedBytes / capacityBytes) * 100,
    },
    loadedAt,
  );
}

function pool(clusterName, datacenterName, name, fields, loadedAt) {
  const path = `/${datacenterName}/host/${clusterName}/Resources${name === "Resources" ? "" : `/${name}`}`;
  return row(
    {
      kind: "ResourcePool",
      externalId: `resourcepool/${path}`,
      name: name,
      resourcePoolName: name,
      resourcePoolPath: path,
      datacenterName: datacenterName,
      clusterName: clusterName,
      memoryBalloonedBytes: 0,
      memorySwappedBytes: 0,
      ...fields,
    },
    loadedAt,
  );
}

function busyEstate(loadedAt, calm) {
  const rows = [];

  rows.push(
    datacenter(
      "dc-east",
      {
        hostCount: 6,
        poweredOnHostCount: calm ? 6 : 5,
        // esx03: vCenter lost contact with it.
        notRespondingHostCount: calm ? 0 : 1,
        standbyHostCount: 0,
        // esx03's connection alarm, and esx02's hardware sensor.
        criticalHostCount: calm ? 0 : 2,
        warningHostCount: calm ? 0 : 1,
        criticalVmCount: calm ? 0 : 1,
        criticalClusterCount: 0,
        vmCount: 14,
        poweredOnVmCount: 12,
        clusterCount: 2,
        datastoreCount: 4,
      },
      loadedAt,
    ),
    datacenter(
      "dc-west",
      {
        hostCount: 2,
        poweredOnHostCount: 2,
        notRespondingHostCount: 0,
        standbyHostCount: 0,
        criticalHostCount: 0,
        warningHostCount: 0,
        criticalVmCount: 0,
        criticalClusterCount: 0,
        vmCount: 4,
        poweredOnVmCount: 4,
        clusterCount: 1,
        datastoreCount: 1,
      },
      loadedAt,
    ),
  );

  rows.push(
    cluster(
      "dc-east",
      "prod-cluster",
      {
        hostCount: 4,
        effectiveHostCount: calm ? 4 : 3,
        vmCount: 10,
        poweredOnVmCount: 9,
        vmTemplateCount: 1,
        cpuCapacityMhz: 307200,
        cpuEffectiveMhz: calm ? 307200 : 230400,
        maxMemoryBytes: 2 * TIB,
        memoryEffectiveBytes: calm ? 2 * TIB : 1.5 * TIB,
      },
      loadedAt,
    ),
    cluster(
      "dc-east",
      "dev-cluster",
      {
        hostCount: 2,
        // esx06 is in maintenance mode: connected, not effective.
        effectiveHostCount: calm ? 2 : 1,
        vmCount: 4,
        poweredOnVmCount: 3,
        vmTemplateCount: 0,
        cpuCapacityMhz: 153600,
        cpuEffectiveMhz: calm ? 153600 : 76800,
        maxMemoryBytes: 1 * TIB,
        memoryEffectiveBytes: calm ? 1 * TIB : 512 * GIB,
      },
      loadedAt,
    ),
    cluster(
      "dc-west",
      "west-cluster",
      {
        hostCount: 2,
        effectiveHostCount: 2,
        vmCount: 4,
        poweredOnVmCount: 4,
        vmTemplateCount: 0,
        cpuCapacityMhz: 153600,
        cpuEffectiveMhz: 153600,
        maxMemoryBytes: 512 * GIB,
        memoryEffectiveBytes: 512 * GIB,
      },
      loadedAt,
    ),
  );

  const esx01 = host(
    "dc-east",
    "prod-cluster",
    "esx01.acme.example",
    {
      latestCpuPercent: 41.6,
      latestCpuMhz: 31949,
      latestMemoryBytes: 316 * GIB,
    },
    loadedAt,
  );
  const esx02 = host(
    "dc-east",
    "prod-cluster",
    "esx02.acme.example",
    {
      latestCpuPercent: calm ? 52.3 : 94.2,
      latestCpuMhz: calm ? 40166 : 72346,
      latestMemoryBytes: 342 * GIB,
    },
    loadedAt,
  );
  // vCenter reports no use for a host it lost contact with: 0 MiB, 0 MHz.
  const esx03 = host(
    "dc-east",
    "prod-cluster",
    "esx03.acme.example",
    calm
      ? {
          latestCpuPercent: 38.1,
          latestCpuMhz: 29260,
          latestMemoryBytes: 280 * GIB,
        }
      : {
          latestCpuPercent: 0,
          latestCpuMhz: 0,
          latestMemoryBytes: 0,
          latestMemoryPercent: 0,
        },
    loadedAt,
  );
  const esx04 = host(
    "dc-east",
    "prod-cluster",
    "esx04.acme.example",
    {
      latestCpuPercent: 33.4,
      latestCpuMhz: 25651,
      latestMemoryBytes: 268 * GIB,
    },
    loadedAt,
  );
  const esx05 = host(
    "dc-east",
    "dev-cluster",
    "esx05.acme.example",
    {
      latestCpuPercent: 22.8,
      latestCpuMhz: 17510,
      latestMemoryBytes: 190 * GIB,
    },
    loadedAt,
  );
  // In maintenance mode: up and connected (ESXi uses memory of its own).
  const esx06 = host(
    "dc-east",
    "dev-cluster",
    "esx06.acme.example",
    {
      latestCpuPercent: 1.2,
      latestCpuMhz: 921,
      latestMemoryBytes: 9 * GIB,
    },
    loadedAt,
  );
  // Two hosts that use more memory than one of them has.
  const west01 = host(
    "dc-west",
    "west-cluster",
    "esx-west-01.acme.example",
    {
      latestCpuPercent: 48.9,
      latestCpuMhz: 37555,
      latestMemoryBytes: calm ? 96 * GIB : 148 * GIB,
      maxMemoryBytes: 256 * GIB,
    },
    loadedAt,
  );
  const west02 = host(
    "dc-west",
    "west-cluster",
    "esx-west-02.acme.example",
    {
      latestCpuPercent: 51.2,
      latestCpuMhz: 39322,
      latestMemoryBytes: calm ? 101 * GIB : 152 * GIB,
      maxMemoryBytes: 256 * GIB,
    },
    loadedAt,
  );
  rows.push(esx01, esx02, esx03, esx04, esx05, esx06, west01, west02);

  rows.push(
    vm(
      1,
      "db-primary",
      esx01,
      {
        latestCpuPercent: 78.4,
        latestCpuMhz: 7526,
        latestMemoryBytes: 58 * GIB,
        maxMemoryBytes: 64 * GIB,
        latestMemoryPercent: 90.6,
        cpuReadinessPercent: 6.2,
        memorySwappedBytes: calm ? 0 : 1.5 * GIB,
        latestDiskBytes: 410 * GIB,
        maxDiskBytes: 500 * GIB,
        latestDiskPercent: 82,
      },
      loadedAt,
    ),
    vm(
      2,
      "ci-runner-01",
      esx02,
      {
        latestCpuPercent: 64.1,
        latestCpuMhz: 6154,
        latestMemoryBytes: 11 * GIB,
        maxMemoryBytes: 16 * GIB,
        latestMemoryPercent: 68.8,
        cpuReadinessPercent: calm ? 2.1 : 14.2,
      },
      loadedAt,
    ),
    vm(
      3,
      "app-03",
      esx02,
      {
        latestCpuPercent: 31.9,
        latestCpuMhz: 1531,
        latestMemoryBytes: 5 * GIB,
        maxMemoryBytes: 8 * GIB,
        latestMemoryPercent: 62.5,
        cpuReadinessPercent: 1.1,
        memoryBalloonedBytes: calm ? 0 : 768 * MIB,
      },
      loadedAt,
    ),
    vm(
      4,
      "web-01",
      esx01,
      {
        latestCpuPercent: 28.2,
        latestCpuMhz: 1354,
        latestMemoryBytes: 5 * GIB,
        maxMemoryBytes: 8 * GIB,
        latestMemoryPercent: 62.5,
        cpuReadinessPercent: 0.9,
      },
      loadedAt,
    ),
    vm(
      5,
      "web-02",
      esx04,
      {
        latestCpuPercent: 26.7,
        latestCpuMhz: 1282,
        latestMemoryBytes: 5 * GIB,
        maxMemoryBytes: 8 * GIB,
        latestMemoryPercent: 62.5,
        cpuReadinessPercent: 0.7,
      },
      loadedAt,
    ),
    // On the host vCenter lost: last known power state, no use reported.
    vm(
      6,
      "cache-01",
      esx03,
      {
        latestCpuPercent: 0,
        latestCpuMhz: 0,
        latestMemoryBytes: 0,
        maxMemoryBytes: 32 * GIB,
        latestMemoryPercent: 0,
        cpuReadinessPercent: 0,
      },
      loadedAt,
    ),
    vm(
      7,
      "legacy-app",
      esx04,
      {
        isPoweredOn: false,
        resourcePoolName: "Retired",
      },
      loadedAt,
    ),
    vm(
      8,
      "ubuntu-24-template",
      esx01,
      {
        isTemplate: true,
        isPoweredOn: undefined,
        latestDiskBytes: 18 * GIB,
        maxDiskBytes: 40 * GIB,
      },
      loadedAt,
    ),
    vm(
      9,
      "batch-worker-01",
      esx04,
      {
        latestCpuPercent: 55.0,
        latestCpuMhz: 4224,
        latestMemoryBytes: 20 * GIB,
        maxMemoryBytes: 24 * GIB,
        latestMemoryPercent: 83.3,
        resourcePoolName: "batch",
      },
      loadedAt,
    ),
    vm(
      10,
      "analytics-worker-with-a-rather-long-name-01",
      esx01,
      {
        latestCpuPercent: 9.3,
        latestCpuMhz: 893,
        latestMemoryBytes: 30 * GIB,
        maxMemoryBytes: 48 * GIB,
        latestMemoryPercent: 62.5,
      },
      loadedAt,
    ),
    vm(
      11,
      "dev-build-01",
      esx05,
      {
        latestCpuPercent: 18.0,
        latestCpuMhz: 1382,
        latestMemoryBytes: 6 * GIB,
        maxMemoryBytes: 16 * GIB,
        latestMemoryPercent: 37.5,
      },
      loadedAt,
    ),
    vm(
      12,
      "dev-db",
      esx05,
      {
        latestCpuPercent: 12.0,
        latestCpuMhz: 921,
        latestMemoryBytes: 12 * GIB,
        maxMemoryBytes: 32 * GIB,
        latestMemoryPercent: 37.5,
      },
      loadedAt,
    ),
    vm(
      13,
      "dev-old",
      esx05,
      {
        isPoweredOn: false,
      },
      loadedAt,
    ),
    vm(
      14,
      "dev-cache",
      esx05,
      {
        latestCpuPercent: 4.0,
        latestCpuMhz: 307,
        latestMemoryBytes: 3 * GIB,
        maxMemoryBytes: 8 * GIB,
        latestMemoryPercent: 37.5,
      },
      loadedAt,
    ),
    vm(
      15,
      "west-app-01",
      west01,
      {
        latestCpuPercent: 44.0,
        latestCpuMhz: 3379,
        latestMemoryBytes: 60 * GIB,
        maxMemoryBytes: 64 * GIB,
        latestMemoryPercent: 93.8,
      },
      loadedAt,
    ),
    vm(
      16,
      "west-app-02",
      west01,
      {
        latestCpuPercent: 41.0,
        latestCpuMhz: 3149,
        latestMemoryBytes: 58 * GIB,
        maxMemoryBytes: 64 * GIB,
        latestMemoryPercent: 90.6,
      },
      loadedAt,
    ),
    vm(
      17,
      "west-db-01",
      west02,
      {
        latestCpuPercent: 62.0,
        latestCpuMhz: 4762,
        latestMemoryBytes: 92 * GIB,
        maxMemoryBytes: 96 * GIB,
        latestMemoryPercent: 95.8,
      },
      loadedAt,
    ),
    vm(
      18,
      "west-db-02",
      west02,
      {
        latestCpuPercent: 58.0,
        latestCpuMhz: 4454,
        latestMemoryBytes: 44 * GIB,
        maxMemoryBytes: 48 * GIB,
        latestMemoryPercent: 91.7,
      },
      loadedAt,
    ),
  );

  rows.push(
    datastore(
      "dc-east",
      "ds-prod-01",
      calm ? 4.1 * TIB : 7.44 * TIB,
      8 * TIB,
      loadedAt,
    ),
    datastore(
      "dc-east",
      "ds-prod-02",
      calm ? 2.2 * TIB : 3.36 * TIB,
      4 * TIB,
      loadedAt,
    ),
    datastore("dc-east", "ds-dev", 0.8 * TIB, 2 * TIB, loadedAt),
    datastore("dc-east", "iso-library", 120 * GIB, 1 * TIB, loadedAt),
    datastore("dc-west", "ds-west", 1.24 * TIB, 2 * TIB, loadedAt),
  );

  rows.push(
    pool(
      "prod-cluster",
      "dc-east",
      "Resources",
      { latestCpuMhz: 98000, latestMemoryBytes: 900 * GIB },
      loadedAt,
    ),
    pool(
      "prod-cluster",
      "dc-east",
      "batch",
      {
        latestCpuMhz: 12000,
        latestMemoryBytes: 60 * GIB,
        memorySwappedBytes: calm ? 0 : 3 * GIB,
      },
      loadedAt,
    ),
    pool(
      "dev-cluster",
      "dc-east",
      "Resources",
      { latestCpuMhz: 9000, latestMemoryBytes: 120 * GIB },
      loadedAt,
    ),
    pool(
      "west-cluster",
      "dc-west",
      "Resources",
      { latestCpuMhz: 15000, latestMemoryBytes: 254 * GIB },
      loadedAt,
    ),
  );

  return rows;
}

/*
 * A datacenter whose quiet hosts are planned: one powered off, one DPM put
 * in standby - no host vCenter lost contact with.
 */
function standbyEstate(loadedAt) {
  const rows = [];
  rows.push(
    datacenter(
      "dc-lab",
      {
        hostCount: 3,
        poweredOnHostCount: 1,
        notRespondingHostCount: 0,
        standbyHostCount: 1,
        criticalHostCount: 0,
        warningHostCount: 0,
        criticalVmCount: 0,
        criticalClusterCount: 0,
        vmCount: 2,
        poweredOnVmCount: 2,
      },
      loadedAt,
    ),
    cluster(
      "dc-lab",
      "lab-cluster",
      {
        hostCount: 3,
        effectiveHostCount: 1,
        vmCount: 2,
        poweredOnVmCount: 2,
        vmTemplateCount: 0,
        cpuCapacityMhz: 230400,
        cpuEffectiveMhz: 76800,
        maxMemoryBytes: 768 * GIB,
        memoryEffectiveBytes: 256 * GIB,
      },
      loadedAt,
    ),
  );
  const lab01 = host(
    "dc-lab",
    "lab-cluster",
    "lab-01.acme.example",
    {
      latestCpuPercent: 20,
      latestCpuMhz: 15360,
      latestMemoryBytes: 80 * GIB,
      maxMemoryBytes: 256 * GIB,
    },
    loadedAt,
  );
  rows.push(
    lab01,
    host(
      "dc-lab",
      "lab-cluster",
      "lab-02.acme.example",
      {
        latestCpuPercent: 0,
        latestCpuMhz: 0,
        latestMemoryBytes: 0,
        latestMemoryPercent: 0,
        maxMemoryBytes: 256 * GIB,
      },
      loadedAt,
    ),
    host(
      "dc-lab",
      "lab-cluster",
      "lab-03.acme.example",
      {
        latestCpuPercent: 0,
        latestCpuMhz: 0,
        latestMemoryBytes: 0,
        latestMemoryPercent: 0,
        maxMemoryBytes: 256 * GIB,
      },
      loadedAt,
    ),
    vm(
      101,
      "lab-vm-01",
      lab01,
      {
        latestCpuPercent: 12,
        latestCpuMhz: 900,
        latestMemoryBytes: 8 * GIB,
        maxMemoryBytes: 16 * GIB,
        latestMemoryPercent: 50,
      },
      loadedAt,
    ),
    vm(
      102,
      "lab-vm-02",
      lab01,
      {
        latestCpuPercent: 10,
        latestCpuMhz: 760,
        latestMemoryBytes: 7 * GIB,
        maxMemoryBytes: 16 * GIB,
        latestMemoryPercent: 43.8,
      },
      loadedAt,
    ),
    datastore("dc-lab", "ds-lab", 300 * GIB, 2 * TIB, loadedAt),
  );
  return rows;
}

// Forty hosts in four clusters, ten VMs each; a few in trouble.
function largeEstate(loadedAt) {
  const rows = [];
  const clusters = ["fra-a", "fra-b", "fra-c", "fra-d"];
  rows.push(
    datacenter(
      "dc-fra",
      {
        hostCount: 40,
        poweredOnHostCount: 39,
        notRespondingHostCount: 1,
        standbyHostCount: 0,
        criticalHostCount: 1,
        warningHostCount: 0,
        criticalVmCount: 0,
        criticalClusterCount: 0,
        vmCount: 400,
        poweredOnVmCount: 380,
      },
      loadedAt,
    ),
  );
  clusters.forEach((name, clusterIndex) => {
    rows.push(
      cluster(
        "dc-fra",
        name,
        {
          hostCount: 10,
          effectiveHostCount: clusterIndex === 2 ? 9 : 10,
          vmCount: 100,
          poweredOnVmCount: 95,
          vmTemplateCount: 2,
          cpuCapacityMhz: 768000,
          cpuEffectiveMhz: clusterIndex === 2 ? 691200 : 768000,
          maxMemoryBytes: 5 * TIB,
          memoryEffectiveBytes: clusterIndex === 2 ? 4.5 * TIB : 5 * TIB,
        },
        loadedAt,
      ),
    );
  });
  let vmNumber = 1000;
  for (let index = 1; index <= 40; index++) {
    const clusterName = clusters[(index - 1) % 4];
    const isLost = index === 27;
    const hostRow = host(
      "dc-fra",
      clusterName,
      `esx-fra-${String(index).padStart(2, "0")}.acme.example`,
      isLost
        ? {
            latestCpuPercent: 0,
            latestCpuMhz: 0,
            latestMemoryBytes: 0,
            latestMemoryPercent: 0,
          }
        : {
            latestCpuPercent: index === 5 ? 96.4 : 20 + ((index * 7) % 50),
            latestCpuMhz: 20000 + index * 300,
            latestMemoryBytes: (180 + ((index * 11) % 120)) * GIB,
          },
      loadedAt,
    );
    rows.push(hostRow);
    for (let vmIndex = 0; vmIndex < 10; vmIndex++) {
      vmNumber++;
      rows.push(
        vm(
          vmNumber,
          `fra-vm-${String(vmNumber - 1000).padStart(3, "0")}`,
          hostRow,
          {
            isPoweredOn: vmIndex !== 9,
            latestCpuPercent: 10 + ((vmNumber * 3) % 60),
            latestCpuMhz: 800 + ((vmNumber * 17) % 4000),
            latestMemoryBytes: (4 + (vmNumber % 12)) * GIB,
            maxMemoryBytes: 16 * GIB,
            latestMemoryPercent: ((4 + (vmNumber % 12)) / 16) * 100,
            cpuReadinessPercent: vmNumber % 97 === 0 ? 15 : (vmNumber * 13) % 9,
            memorySwappedBytes: vmNumber % 151 === 0 ? 2 * GIB : 0,
          },
          loadedAt,
        ),
      );
    }
  }
  for (let index = 1; index <= 12; index++) {
    rows.push(
      datastore(
        "dc-fra",
        `ds-fra-${String(index).padStart(2, "0")}`,
        (index === 4 ? 3.8 : 1 + ((index * 0.37) % 2.2)) * TIB,
        4 * TIB,
        loadedAt,
      ),
    );
  }
  return rows;
}

export function buildEstate(scenario, loadedAt) {
  rowNumber = 0;
  const disconnected = scenario.collector === "disconnected";
  const lastSeen = disconnected
    ? new Date(loadedAt - 3 * 24 * 60 * MINUTE)
    : new Date(loadedAt - MINUTE);

  let inventory = [];
  if (scenario.estate === "busy") {
    inventory = busyEstate(loadedAt, false);
  } else if (scenario.estate === "calm") {
    inventory = busyEstate(loadedAt, true);
  } else if (scenario.estate === "large") {
    inventory = largeEstate(loadedAt);
  } else if (scenario.estate === "standby") {
    inventory = standbyEstate(loadedAt);
  }

  if (disconnected) {
    // The agent went quiet three days ago: every reading is that old.
    for (const record of inventory) {
      record.metricsUpdatedAt = lastSeen;
      record.lastSeenAt = lastSeen;
    }
  }

  const virtualMachines = inventory.filter((record) => {
    return record.kind === "VirtualMachine" && record.isTemplate !== true;
  });

  return {
    vcenter: {
      _id: VCENTER_ID,
      name: VCENTER_NAME,
      description: "Production vSphere estate",
      otelCollectorStatus: disconnected ? "disconnected" : "connected",
      collectionMethod: "Agent",
      agentVersion: "0.161.0",
      lastSeenAt: scenario.estate === "new" ? undefined : lastSeen,
      isArchived: false,
      datacenterCount: inventory.filter((record) => {
        return record.kind === "Datacenter";
      }).length,
      clusterCount: inventory.filter((record) => {
        return record.kind === "Cluster";
      }).length,
      hostCount: inventory.filter((record) => {
        return record.kind === "Host";
      }).length,
      vmCount: virtualMachines.length,
      poweredOnVmCount:
        scenario.estate === "new"
          ? undefined
          : virtualMachines.filter((record) => {
              return record.isPoweredOn === true;
            }).length,
      datastoreCount: inventory.filter((record) => {
        return record.kind === "Datastore";
      }).length,
      resourcePoolCount: inventory.filter((record) => {
        return record.kind === "ResourcePool";
      }).length,
    },
    inventory: inventory,
  };
}
