/*
 * The made-up estate of the resource topology fixture: one "Acme Platform"
 * project with a vCenter, a Kubernetes cluster, a host whose services call
 * one another, a Docker host, a Podman host, a Docker Swarm cluster, a
 * Proxmox cluster, a Ceph cluster and a storage array — each with parts that
 * are healthy, parts that need attention and parts that are broken, and open
 * incidents and alerts on some of them.
 *
 * `?estate=` picks the size: `normal` (default), `large` (a vCenter of
 * thousands of virtual machines and a cluster of thousands of pods, for the
 * folding and the frame rate), `quiet` (everything healthy, no incidents)
 * or `empty` (resources with no inventory yet). Large estates are drawn from
 * the shared seeded generator, so every run draws the same one.
 */
import EntityType from "Common/Types/Telemetry/EntityType";
import {
  keyForHost,
  keyForKubernetesCluster,
  keyForVMwareVCenter,
} from "Common/Utils/Telemetry/EntityKey";
import { seededRandom } from "Common/Tests/Helpers/SeededRandom";

export const PROJECT_ID = "10000000-0000-4000-8000-000000000001";

export function uuid(prefix, number) {
  return `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

export const IDS = {
  vcenter: uuid("31000000", 1),
  kubernetes: uuid("32000000", 1),
  host: uuid("33000000", 1),
  dockerHost: uuid("34000000", 1),
  podmanHost: uuid("35000000", 1),
  swarm: uuid("36000000", 1),
  proxmox: uuid("37000000", 1),
  ceph: uuid("38000000", 1),
  storageArray: uuid("39000000", 1),
  cloudAccount: uuid("3a000000", 1),
};

// The AWS account the cloud account's resources belong to.
export const CLOUD_ACCOUNT_ID = "123456789012";

export const NAMES = {
  vcenter: "vcenter-prod",
  kubernetes: "prod-eu",
  host: "web-01.acme.example",
};

const MINUTE = 60 * 1000;
const GIB = 1024 * 1024 * 1024;

export function buildEstate(options) {
  const loadedAt = options.loadedAt;
  const estate = options.estate;
  const isEmpty = estate === "empty";
  const isQuiet = estate === "quiet";
  const isLarge = estate === "large";
  const fresh = new Date(loadedAt - 2 * MINUTE);
  const stale = new Date(loadedAt - 3 * 60 * MINUTE);
  const random = seededRandom(5150);
  let counter = 1;
  const nextId = (prefix) => {
    return uuid(prefix, counter++);
  };

  /*
   * -------------------------------------------------------------------
   * VMware: vcenter-prod
   * -------------------------------------------------------------------
   */
  const vmwareRows = [];
  const vmwareRow = (fields) => {
    const row = {
      _id: nextId("40000000"),
      vmwareVCenterId: IDS.vcenter,
      lastSeenAt: fresh,
      metricsUpdatedAt: fresh,
      ...fields,
    };
    vmwareRows.push(row);
    return row;
  };

  const vmNames = [
    "web",
    "api",
    "worker",
    "cache",
    "queue",
    "search",
    "batch",
    "jenkins",
    "k8s-node",
    "ldap",
    "mail",
    "reports",
  ];

  const datacenters = isLarge
    ? [
        ["Amsterdam", 3, 16, 30],
        ["Frankfurt", 2, 16, 30],
        ["London", 2, 12, 25],
      ]
    : [
        ["Amsterdam", 2, 4, 9],
        ["Frankfurt", 1, 3, 6],
      ];

  if (!isEmpty) {
    for (const [dc, clusters, hostsPerCluster, vmsPerHost] of datacenters) {
      vmwareRow({
        kind: "Datacenter",
        externalId: `datacenter/${dc}`,
        name: dc,
        datacenterName: dc,
        hostCount: clusters * hostsPerCluster + (dc === "Frankfurt" ? 1 : 0),
        poweredOnHostCount:
          clusters * hostsPerCluster + (dc === "Frankfurt" ? 1 : 0),
      });

      for (let c = 1; c <= clusters; c++) {
        const cluster = `${dc.toLowerCase().slice(0, 3)}-${c === 1 ? "prod" : c === 2 ? "dev" : `pool-${c}`}`;
        const notEffective = !isQuiet && dc === "Amsterdam" && c === 1;
        vmwareRow({
          kind: "Cluster",
          externalId: `cluster/${dc}/${cluster}`,
          name: cluster,
          datacenterName: dc,
          clusterName: cluster,
          hostCount: hostsPerCluster,
          effectiveHostCount: notEffective
            ? hostsPerCluster - 1
            : hostsPerCluster,
        });

        for (let h = 1; h <= hostsPerCluster; h++) {
          const host = `esx${String(c * 100 + h).padStart(3, "0")}.${dc.toLowerCase().slice(0, 3)}.acme.example`;
          const notReporting =
            !isQuiet && dc === "Amsterdam" && c === 1 && h === 3;
          const hot = !isQuiet && dc === "Amsterdam" && c === 1 && h === 2;
          vmwareRow({
            kind: "Host",
            externalId: `host/${dc}/${host}`,
            name: host,
            datacenterName: dc,
            clusterName: cluster,
            hostName: host,
            latestCpuPercent: hot ? 94.2 : 18 + random(55),
            latestMemoryPercent: 30 + random(50),
            metricsUpdatedAt: notReporting ? stale : fresh,
          });

          for (let v = 1; v <= vmsPerHost; v++) {
            const base = vmNames[(h * 7 + v) % vmNames.length];
            const name = `${base}-${String(c * 1000 + h * 50 + v).padStart(4, "0")}`;
            const uuidPart = String(vmwareRows.length).padStart(12, "0");
            const off = v % 9 === 0;
            const swapping =
              !isQuiet && dc === "Amsterdam" && c === 1 && h === 1 && v === 2;
            const contended =
              !isQuiet && dc === "Amsterdam" && c === 2 && h === 1 && v === 4;
            vmwareRow({
              kind: "VirtualMachine",
              externalId: `vm/4210aaaa-bbbb-cccc-dddd-${uuidPart}`,
              vmInstanceUuid: `4210aaaa-bbbb-cccc-dddd-${uuidPart}`,
              name: swapping
                ? "db-primary-01"
                : contended
                  ? "api-gateway-07"
                  : name,
              datacenterName: dc,
              clusterName: cluster,
              hostName: host,
              resourcePoolName: c === 1 ? "Production" : "Dev",
              isTemplate: false,
              isPoweredOn: !off,
              latestCpuPercent: off ? undefined : 5 + random(60),
              latestMemoryPercent: off ? undefined : 20 + random(60),
              memorySwappedBytes: swapping ? 2 * GIB : 0,
              cpuReadinessPercent: contended ? 14.6 : 1 + random(4),
              metricsUpdatedAt: notReporting ? stale : fresh,
            });
          }
        }

        vmwareRow({
          kind: "ResourcePool",
          externalId: `resourcepool//${dc}/host/${cluster}/Resources/${c === 1 ? "Production" : "Dev"}`,
          name: c === 1 ? "Production" : "Dev",
          datacenterName: dc,
          clusterName: cluster,
          resourcePoolName: c === 1 ? "Production" : "Dev",
          resourcePoolPath: `/${dc}/host/${cluster}/Resources/${c === 1 ? "Production" : "Dev"}`,
        });
      }

      const datastores = isLarge ? 24 : dc === "Amsterdam" ? 6 : 3;
      for (let d = 1; d <= datastores; d++) {
        const name = `${dc.toLowerCase().slice(0, 3)}-ssd-${String(d).padStart(2, "0")}`;
        const percent =
          !isQuiet && dc === "Amsterdam" && d === 2
            ? 93.4
            : !isQuiet && dc === "Amsterdam" && d === 5
              ? 84.1
              : 20 + random(50);
        vmwareRow({
          kind: "Datastore",
          externalId: `datastore/${dc}/${name}`,
          name: name,
          datacenterName: dc,
          latestDiskPercent: percent,
          maxDiskBytes: 4096 * GIB,
          latestDiskBytes: (percent / 100) * 4096 * GIB,
        });
      }
    }

    // A standalone host in Frankfurt, outside any cluster.
    vmwareRow({
      kind: "Host",
      externalId: "host/Frankfurt/esx900.fra.acme.example",
      name: "esx900.fra.acme.example",
      datacenterName: "Frankfurt",
      hostName: "esx900.fra.acme.example",
      latestCpuPercent: 22.4,
      latestMemoryPercent: 41.2,
    });
    vmwareRow({
      kind: "VirtualMachine",
      externalId: "vm/4210aaaa-bbbb-cccc-dddd-999999999999",
      vmInstanceUuid: "4210aaaa-bbbb-cccc-dddd-999999999999",
      name: "backup-appliance",
      datacenterName: "Frankfurt",
      hostName: "esx900.fra.acme.example",
      isPoweredOn: true,
      latestCpuPercent: 7.5,
      latestMemoryPercent: 33,
    });
    vmwareRow({
      kind: "VirtualMachine",
      externalId: "vm/template-ubuntu-24",
      vmInstanceUuid: "template-ubuntu-24",
      name: "ubuntu-24-template",
      datacenterName: "Frankfurt",
      hostName: "esx900.fra.acme.example",
      isTemplate: true,
    });
  }

  /*
   * -------------------------------------------------------------------
   * Kubernetes: prod-eu
   * -------------------------------------------------------------------
   */
  const k8sRows = [];
  const k8sContainers = [];
  const k8sRow = (fields) => {
    const row = {
      _id: nextId("42000000"),
      kubernetesClusterId: IDS.kubernetes,
      lastSeenAt: fresh,
      metricsUpdatedAt: fresh,
      namespaceKey: "",
      ...fields,
    };
    k8sRows.push(row);
    return row;
  };
  const container = (pod, fields) => {
    k8sContainers.push({
      _id: nextId("43000000"),
      kubernetesClusterId: IDS.kubernetes,
      podNamespaceKey: pod.namespaceKey,
      podName: pod.name,
      name: "app",
      state: "running",
      isReady: true,
      restartCount: 0,
      ...fields,
    });
  };

  const nodeCount = isLarge ? 40 : 6;
  const nodeNames = [];
  if (!isEmpty) {
    for (let n = 1; n <= nodeCount; n++) {
      const name = `ip-10-0-${n}-${20 + n}.eu-west-1.compute.internal`;
      nodeNames.push(name);
      k8sRow({
        kind: "Node",
        name: name,
        isReady: !(!isQuiet && n === 4),
        hasMemoryPressure: !isQuiet && n === 5,
        hasDiskPressure: false,
        hasPidPressure: false,
        latestCpuPercent: 20 + random(50),
        latestMemoryBytes: (8 + random(20)) * GIB,
      });
    }

    const namespaces = [
      "payments",
      "checkout",
      "catalog",
      "monitoring",
      "kube-system",
    ];
    if (isLarge) {
      for (let n = 1; n <= 14; n++) {
        namespaces.push(`team-${String(n).padStart(2, "0")}`);
      }
    }
    for (const namespace of namespaces) {
      k8sRow({
        kind: "Namespace",
        name: namespace,
        status: { phase: "Active" },
      });
    }

    const workloads = [
      ["Deployment", "payments", "payments-api", 3, 3],
      ["Deployment", "payments", "payments-worker", 2, 2],
      ["Deployment", "checkout", "checkout-web", 3, isQuiet ? 3 : 2],
      ["Deployment", "catalog", "catalog-api", 2, isQuiet ? 2 : 0],
      ["StatefulSet", "payments", "postgres", 1, 1],
      ["StatefulSet", "catalog", "redis", 3, 3],
      [
        "DaemonSet",
        "monitoring",
        "node-exporter",
        nodeCount,
        nodeCount - (isQuiet ? 0 : 1),
      ],
      ["Deployment", "monitoring", "prometheus", 1, 1],
      ["Deployment", "kube-system", "coredns", 2, 2],
    ];
    if (isLarge) {
      for (let t = 1; t <= 14; t++) {
        for (let w = 1; w <= 12; w++) {
          workloads.push([
            "Deployment",
            `team-${String(t).padStart(2, "0")}`,
            `svc-${String(w).padStart(2, "0")}`,
            8,
            8,
          ]);
        }
      }
    }

    let podIndex = 0;
    for (const [kind, namespace, name, desired, ready] of workloads) {
      const spec =
        kind === "DaemonSet"
          ? {}
          : { replicas: desired, selector: { app: name } };
      const status =
        kind === "DaemonSet"
          ? { desiredNumberScheduled: desired, numberReady: ready }
          : { replicas: desired, readyReplicas: ready };
      k8sRow({ kind, namespaceKey: namespace, name, spec, status });

      for (let r = 0; r < desired; r++) {
        podIndex++;
        const node =
          kind === "DaemonSet"
            ? nodeNames[r % nodeNames.length]
            : nodeNames[(podIndex * 3) % nodeNames.length];
        const suffix = `${(podIndex * 7919).toString(36).padStart(5, "x").slice(-5)}`;
        const podName =
          kind === "StatefulSet"
            ? `${name}-${r}`
            : kind === "DaemonSet"
              ? `${name}-${suffix}`
              : `${name}-7d9f8c6b5-${suffix}`;
        const notReady = r >= ready;
        const crashing = !isQuiet && name === "catalog-api";
        const pending = !isQuiet && name === "checkout-web" && notReady;
        const owner =
          kind === "Deployment"
            ? { kind: "ReplicaSet", name: `${name}-7d9f8c6b5` }
            : { kind, name };
        const volumes =
          name === "postgres"
            ? [
                {
                  name: "data",
                  type: "persistentVolumeClaim",
                  source: `data-postgres-${r}`,
                },
              ]
            : [];
        const pod = k8sRow({
          kind: "Pod",
          namespaceKey: namespace,
          name: podName,
          phase: pending ? "Pending" : "Running",
          ownerReferences: { items: [{ ...owner, uid: `uid-${podIndex}` }] },
          controllerDeploymentName: kind === "Deployment" ? name : undefined,
          spec: { nodeName: pending ? "" : node, volumes: volumes },
          latestCpuPercent: 2 + random(30),
          latestMemoryBytes: (64 + random(900)) * 1024 * 1024,
        });
        container(pod, {
          state: crashing
            ? "waiting"
            : pending
              ? "waiting"
              : notReady
                ? "running"
                : "running",
          reason: crashing
            ? "CrashLoopBackOff"
            : pending
              ? "ContainerCreating"
              : undefined,
          isReady: !(crashing || notReady),
          restartCount: crashing ? 23 : 0,
        });
      }
    }

    k8sRow({
      kind: "CronJob",
      namespaceKey: "catalog",
      name: "nightly-reindex",
      spec: { schedule: "0 2 * * *", suspend: false },
      status: {},
    });
    k8sRow({
      kind: "Job",
      namespaceKey: "catalog",
      name: "nightly-reindex-29351840",
      ownerReferences: {
        items: [{ kind: "CronJob", name: "nightly-reindex" }],
      },
      status: { active: 0, succeeded: 1, failed: 0 },
    });
    k8sRow({
      kind: "PersistentVolumeClaim",
      namespaceKey: "payments",
      name: "data-postgres-0",
      spec: { volumeName: "pvc-6c1f0b7e-postgres" },
      status: { phase: "Bound", capacity: { storage: "100Gi" } },
    });
    k8sRow({
      kind: "PersistentVolume",
      name: "pvc-6c1f0b7e-postgres",
      spec: { claimRef: { name: "data-postgres-0", namespace: "payments" } },
      status: { phase: "Bound", capacity: { storage: "100Gi" } },
    });
  }

  /*
   * -------------------------------------------------------------------
   * Docker host, Podman host
   * -------------------------------------------------------------------
   */
  const containerHostRows = (hostField, hostId) => {
    if (isEmpty) {
      return [];
    }
    const rows = [];
    const add = (fields) => {
      rows.push({
        _id: nextId("44000000"),
        [hostField]: hostId,
        lastSeenAt: fresh,
        metricsUpdatedAt: fresh,
        ...fields,
      });
    };
    const compose = (project, service) => {
      return {
        "com.docker.compose.project": project,
        "com.docker.compose.service": service,
      };
    };
    add({
      kind: "Container",
      name: "shop-web-1",
      imageName: "nginx:1.27",
      state: "running",
      labels: compose("shop", "web"),
      latestCpuPercent: 3.2,
      latestMemoryBytes: 42 * 1024 * 1024,
    });
    add({
      kind: "Container",
      name: "shop-api-1",
      imageName: "acme/shop-api:2.4.1",
      state: "running",
      labels: compose("shop", "api"),
      latestCpuPercent: 21.4,
      latestMemoryBytes: 310 * 1024 * 1024,
    });
    add({
      kind: "Container",
      name: "shop-api-2",
      imageName: "acme/shop-api:2.4.1",
      state: isQuiet ? "running" : "restarting",
      labels: compose("shop", "api"),
    });
    add({
      kind: "Container",
      name: "shop-db-1",
      imageName: "postgres:16",
      state: "running",
      labels: compose("shop", "db"),
      latestCpuPercent: 8.7,
      latestMemoryBytes: 512 * 1024 * 1024,
    });
    add({
      kind: "Container",
      name: "metrics-agent",
      imageName: "otel/opentelemetry-collector-contrib:0.111.0",
      state: "running",
      latestCpuPercent: 1.1,
    });
    add({
      kind: "Container",
      name: "old-cron",
      imageName: "acme/cron:1.0",
      state: "exited",
    });
    add({
      kind: "Container",
      name: "broken-worker",
      imageName: "acme/worker:3.0",
      state: isQuiet ? "running" : "dead",
    });
    add({ kind: "Image", name: "nginx:1.27" });
    add({ kind: "Image", name: "acme/shop-api:2.4.1" });
    add({ kind: "Image", name: "postgres:16" });
    add({ kind: "Image", name: "acme/legacy:0.9" });
    add({
      kind: "Network",
      name: "shop_default",
      state: "bridge/local",
      labels: { "com.docker.compose.project": "shop" },
    });
    add({ kind: "Network", name: "bridge", state: "bridge/local" });
    add({
      kind: "Volume",
      name: "shop_pgdata",
      state: "local",
      labels: { "com.docker.compose.project": "shop" },
    });
    return rows;
  };

  /*
   * -------------------------------------------------------------------
   * Docker Swarm, Proxmox, Ceph, storage array
   * -------------------------------------------------------------------
   */
  const swarmRows = [];
  const proxmoxRows = [];
  const cephRows = [];
  const storageRows = [];

  if (!isEmpty) {
    const swarm = (fields) => {
      swarmRows.push({
        _id: nextId("45000000"),
        dockerSwarmClusterId: IDS.swarm,
        lastSeenAt: fresh,
        ...fields,
      });
    };
    swarm({
      kind: "Node",
      externalId: "node/n1",
      name: "swarm-manager-1",
      state: "Ready",
      isReady: true,
      role: "manager",
      attributes: { availability: "Active", isLeader: true },
    });
    swarm({
      kind: "Node",
      externalId: "node/n2",
      name: "swarm-worker-1",
      state: "Ready",
      isReady: true,
      role: "worker",
      attributes: { availability: "Active" },
    });
    swarm({
      kind: "Node",
      externalId: "node/n3",
      name: "swarm-worker-2",
      state: isQuiet ? "Ready" : "Down",
      isReady: isQuiet,
      role: "worker",
      attributes: { availability: "Active" },
    });
    swarm({
      kind: "Stack",
      externalId: "stack/shop",
      name: "shop",
      stackName: "shop",
    });
    swarm({
      kind: "Service",
      externalId: "service/s1",
      name: "shop_web",
      stackName: "shop",
      serviceMode: "replicated",
      desiredReplicas: 3,
      runningReplicas: isQuiet ? 3 : 2,
      image: "nginx:1.27",
    });
    swarm({
      kind: "Service",
      externalId: "service/s2",
      name: "shop_api",
      stackName: "shop",
      serviceMode: "replicated",
      desiredReplicas: 2,
      runningReplicas: 2,
      image: "acme/shop-api:2.4.1",
    });
    swarm({
      kind: "Service",
      externalId: "service/s3",
      name: "monitoring",
      serviceMode: "global",
      runningReplicas: 3,
      image: "otel/collector",
    });
    const tasks = [
      ["shop_web.1", "swarm-worker-1", "running"],
      ["shop_web.2", "swarm-manager-1", "running"],
      ["shop_web.3", "swarm-worker-2", isQuiet ? "running" : "failed"],
      ["shop_api.1", "swarm-worker-1", "running"],
      ["shop_api.2", "swarm-manager-1", "running"],
      ["monitoring.n1", "swarm-manager-1", "running"],
      ["monitoring.n2", "swarm-worker-1", "running"],
      ["monitoring.n3", "swarm-worker-2", "running"],
    ];
    tasks.forEach(([name, node, state], index) => {
      swarm({
        kind: "Task",
        externalId: `task/t${index}`,
        name,
        nodeHostname: node,
        state,
        serviceName: name.split(".")[0],
        attributes: {
          desiredState: "Running",
          error: state === "failed" ? "task: non-zero exit (137)" : "",
        },
      });
    });
    swarm({
      kind: "Network",
      externalId: "network/x1",
      name: "shop_backend",
      driver: "overlay",
    });

    const proxmox = (fields) => {
      proxmoxRows.push({
        _id: nextId("46000000"),
        proxmoxClusterId: IDS.proxmox,
        lastSeenAt: fresh,
        metricsUpdatedAt: fresh,
        ...fields,
      });
    };
    ["pve1", "pve2", "pve3"].forEach((node, index) => {
      proxmox({
        kind: "Node",
        externalId: `node/${node}`,
        name: node,
        isUp: !(index === 2 && !isQuiet),
        latestCpuPercent: 30 + index * 10,
        latestMemoryPercent: 50,
      });
      for (let g = 1; g <= 5; g++) {
        const vmid = 100 + index * 10 + g;
        proxmox({
          kind: "Guest",
          externalId: `${g === 5 ? "lxc" : "qemu"}/${vmid}`,
          name: `${g === 5 ? "ct" : "vm"}-${node}-${g}`,
          vmid,
          guestType: g === 5 ? "lxc" : "qemu",
          parentNodeName: node,
          isUp: g !== 4,
          onboot: g === 4 && index === 0 && !isQuiet,
          isBackedUp: !(g === 3 && index === 1 && !isQuiet),
          latestCpuPercent: 10 + g,
          latestMemoryPercent: 40,
        });
      }
      proxmox({
        kind: "Storage",
        externalId: `storage/${node}/local-lvm`,
        name: "local-lvm",
        parentNodeName: node,
        latestDiskBytes: (index === 0 && !isQuiet ? 880 : 400) * GIB,
        maxDiskBytes: 1000 * GIB,
      });
    });

    const ceph = (fields) => {
      cephRows.push({
        _id: nextId("47000000"),
        cephClusterId: IDS.ceph,
        lastSeenAt: fresh,
        metricsUpdatedAt: fresh,
        ...fields,
      });
    };
    ["ceph-a", "ceph-b", "ceph-c"].forEach((host, index) => {
      ceph({
        kind: "Mon",
        externalId: `mon.${host}`,
        name: `mon.${host}`,
        hostname: host,
        inQuorum: true,
      });
      for (let o = 0; o < 4; o++) {
        const id = index * 4 + o;
        ceph({
          kind: "Osd",
          externalId: `osd.${id}`,
          name: `osd.${id}`,
          hostname: host,
          isUp: !(id === 5 && !isQuiet),
          isIn: true,
          deviceClass: "ssd",
          statBytes: 4000 * GIB,
          statBytesUsed: (1200 + id * 50) * GIB,
        });
      }
    });
    ceph({
      kind: "Mgr",
      externalId: "mgr.ceph-a",
      name: "mgr.ceph-a",
      hostname: "ceph-a",
      isUp: true,
    });
    ceph({
      kind: "Pool",
      externalId: "1",
      name: "rbd",
      storedBytes: 6000 * GIB,
      maxAvailBytes: isQuiet ? 9000 * GIB : 900 * GIB,
    });
    ceph({
      kind: "Pool",
      externalId: "2",
      name: "cephfs_data",
      storedBytes: 2000 * GIB,
      maxAvailBytes: 9000 * GIB,
    });

    const storage = (fields) => {
      storageRows.push({
        _id: nextId("48000000"),
        storageArrayId: IDS.storageArray,
        lastSeenAt: fresh,
        ...fields,
      });
    };
    storage({
      kind: "Host",
      externalId: "esx001",
      name: "esx001",
      groupName: "vsphere-prod",
      status: "healthy",
      connectionCount: 12,
    });
    storage({
      kind: "Host",
      externalId: "esx002",
      name: "esx002",
      groupName: "vsphere-prod",
      status: "healthy",
      connectionCount: 12,
    });
    storage({
      kind: "Host",
      externalId: "sql-01",
      name: "sql-01",
      status: isQuiet ? "healthy" : "degraded",
      connectionCount: 2,
    });
    storage({
      kind: "Pod",
      externalId: "pod-dr",
      name: "pod-dr",
      status: "online",
    });
    storage({
      kind: "Volume",
      externalId: "pod-dr::vol-sql-data",
      name: "pod-dr::vol-sql-data",
      groupName: "pod-dr",
      capacityBytes: 2048 * GIB,
      usedBytes: 1200 * GIB,
    });
    for (let v = 1; v <= 9; v++) {
      storage({
        kind: "Volume",
        externalId: `vg-vmware/ds-${v}`,
        name: `vg-vmware/ds-${v}`,
        groupName: "vg-vmware",
        capacityBytes: 8192 * GIB,
        usedBytes: (2000 + v * 300) * GIB,
      });
    }
    storage({
      kind: "Controller",
      externalId: "CT0",
      name: "CT0",
      status: "ok",
      model: "FA-X70R3",
    });
    storage({
      kind: "Controller",
      externalId: "CT1",
      name: "CT1",
      status: isQuiet ? "ok" : "critical",
      statusDetail: "Controller is not responding",
    });
    for (let d = 0; d < 6; d++) {
      storage({
        kind: "Drive",
        externalId: `CH0.BAY${d}`,
        name: `CH0.BAY${d}`,
        status: "healthy",
        componentType: "SSD",
      });
    }
  }

  /*
   * -------------------------------------------------------------------
   * The entity inventory (the master Topology's data, and a host's)
   * -------------------------------------------------------------------
   */
  const items = [];
  const relationships = [];
  const createdAt = new Date("2026-09-01T08:00:00Z").getTime();
  const item = (key, name, type, identifyingAttributes = null) => {
    const index = items.length + 1;
    items.push({
      id: uuid("70000000", index),
      projectId: PROJECT_ID,
      key,
      type,
      name,
      source: "discovered",
      firstSeenAt: new Date(loadedAt - 30 * 24 * 60 * MINUTE),
      lastSeenAt: fresh,
      createdAt: new Date(createdAt + index * 1000),
      isArchived: false,
      deleted: false,
      descriptiveAttributes: null,
      identifyingAttributes,
      resourceType: null,
      resourceId: null,
    });
    return key;
  };
  const relate = (from, to, type, metrics = {}) => {
    const index = relationships.length + 1;
    relationships.push({
      id: uuid("71000000", index),
      projectId: PROJECT_ID,
      from,
      to,
      type,
      lastSeenAt: fresh,
      createdAt: new Date(createdAt + index * 1000),
      deleted: false,
      callCount: null,
      errorCount: null,
      avgDurationMs: null,
      ...metrics,
    });
  };

  const hostKey = keyForHost(PROJECT_ID, NAMES.host);
  if (!isEmpty) {
    item(hostKey, NAMES.host, EntityType.Host, { "host.name": NAMES.host });
    item("host-app-02", "app-02.acme.example", EntityType.Host, {
      "host.name": "app-02.acme.example",
    });
    item("container-nginx", "nginx", EntityType.Container);
    item("container-checkout", "checkout-api", EntityType.Container);
    relate("container-nginx", hostKey, "runs-on");
    relate("container-checkout", hostKey, "runs-on");
    item("service-storefront", "storefront", EntityType.Service, {
      "service.name": "storefront",
    });
    item("service-checkout", "checkout", EntityType.Service, {
      "service.name": "checkout",
    });
    item("service-payments", "payments", EntityType.Service, {
      "service.name": "payments",
    });
    item("service-mobile-bff", "mobile-bff", EntityType.Service, {
      "service.name": "mobile-bff",
    });
    item("db-orders", "postgres orders", EntityType.Database, {
      "db.system.name": "postgresql",
      "server.address": "orders-db",
    });
    item("remote-stripe", "api.stripe.com", EntityType.RemoteService, {
      "server.address": "api.stripe.com",
    });
    relate("service-storefront", "container-nginx", "runs-on");
    relate("service-checkout", "container-checkout", "runs-on");
    relate("service-payments", "host-app-02", "hosted-on");
    relate("service-mobile-bff", "host-app-02", "hosted-on");
    relate("service-storefront", "service-checkout", "depends-on", {
      callCount: 12000,
      errorCount: 30,
      avgDurationMs: 42,
    });
    relate("service-checkout", "service-payments", "depends-on", {
      callCount: 3000,
      errorCount: isQuiet ? 0 : 210,
      avgDurationMs: 180,
    });
    relate("service-checkout", "db-orders", "depends-on", {
      callCount: 9000,
      errorCount: 0,
      avgDurationMs: 4,
    });
    relate("service-payments", "remote-stripe", "depends-on", {
      callCount: 2900,
      errorCount: 0,
      avgDurationMs: 320,
    });
    relate("service-mobile-bff", "service-checkout", "depends-on", {
      callCount: 4000,
      errorCount: 8,
      avgDurationMs: 51,
    });

    // The master Topology's resources that have a topology of their own.
    const vcenterKey = keyForVMwareVCenter(PROJECT_ID, NAMES.vcenter);
    item(vcenterKey, NAMES.vcenter, EntityType.VMwareVCenter, {
      "vmware.vcenter.name": NAMES.vcenter,
    });
    item("vmware-cluster-ams", "ams-prod", EntityType.VMwareCluster, {
      "vcenter.cluster.name": "ams-prod",
    });
    relate("vmware-cluster-ams", vcenterKey, "member-of");
    const clusterKey = keyForKubernetesCluster(PROJECT_ID, NAMES.kubernetes);
    item(clusterKey, NAMES.kubernetes, EntityType.KubernetesCluster, {
      "k8s.cluster.name": NAMES.kubernetes,
    });
    item("k8s-node-1", "ip-10-0-1-21", EntityType.KubernetesNode, {
      "k8s.node.name": "ip-10-0-1-21",
    });
    relate("k8s-node-1", clusterKey, "member-of");
  }

  /*
   * -------------------------------------------------------------------
   * Cloud: the "production" AWS account. Two regions: a network of
   * subnets with the machines in them, a scaling group, a load balancer,
   * a database, a queue and a bucket in eu-west-1, a small edge network in
   * us-east-1, and a CloudFront distribution that is in no region. One
   * machine has stopped being listed; the database has an open incident
   * (see Fixture.js). A large estate adds a few hundred machines.
   * -------------------------------------------------------------------
   */
  const cloudRows = [];
  const arn = (service, region, resource) => {
    return `arn:aws:${service}:${region}:${CLOUD_ACCOUNT_ID}:${resource}`;
  };
  const cloudRow = (fields) => {
    const row = {
      _id: nextId("4a000000"),
      cloudProvider: "aws",
      cloudAccountId: CLOUD_ACCOUNT_ID,
      lastSeenAt: fresh,
      otelCollectorStatus: "disconnected",
      cloudRelationships: [],
      isArchived: false,
      ...fields,
    };
    cloudRows.push(row);
    return row;
  };
  const runsIn = (target, targetType) => {
    return { kind: "runs-in", target, targetType };
  };

  if (!isEmpty) {
    for (const [region, vpc, subnets] of [
      ["eu-west-1", "vpc-0main", ["subnet-0a", "subnet-0b", "subnet-0public"]],
      ["us-east-1", "vpc-0edge", ["subnet-0edge"]],
    ]) {
      cloudRow({
        name: vpc === "vpc-0main" ? "main" : "edge",
        cloudResourceType: "AWS::EC2::VPC",
        providerResourceId: arn("ec2", region, `vpc/${vpc}`),
        cloudRegion: region,
      });

      for (const subnet of subnets) {
        cloudRow({
          name: subnet.replace("subnet-0", "subnet-"),
          cloudResourceType: "AWS::EC2::Subnet",
          providerResourceId: arn("ec2", region, `subnet/${subnet}`),
          cloudRegion: region,
          cloudRelationships: [runsIn(vpc, "AWS::EC2::VPC")],
        });
      }
    }

    const machine = (name, region, subnet, extra) => {
      return cloudRow({
        name,
        cloudResourceType: "AWS::EC2::Instance",
        providerResourceId: arn("ec2", region, `instance/i-0${name}`),
        cloudRegion: region,
        cloudRelationships: [
          runsIn(subnet, "AWS::EC2::Subnet"),
          ...((extra && extra.relationships) || []),
        ],
        ...((extra && extra.fields) || {}),
      });
    };

    cloudRow({
      name: "web-asg",
      cloudResourceType: "AWS::AutoScaling::AutoScalingGroup",
      providerResourceId: arn(
        "autoscaling",
        "eu-west-1",
        "autoScalingGroup:uuid:autoScalingGroupName/web-asg",
      ),
      cloudRegion: "eu-west-1",
    });

    for (const [name, subnet] of [
      ["web-1", "subnet-0a"],
      ["web-2", "subnet-0b"],
    ]) {
      machine(name, "eu-west-1", subnet, {
        relationships: [
          {
            kind: "part-of",
            target: "web-asg",
            targetType: "AWS::AutoScaling::AutoScalingGroup",
          },
        ],
      });
    }

    machine("worker-1", "eu-west-1", "subnet-0a", {
      // Not listed for three hours: it needs attention.
      fields: { lastSeenAt: isQuiet ? fresh : stale },
    });
    machine("bastion", "eu-west-1", "subnet-0public");
    machine("edge-proxy", "us-east-1", "subnet-0edge");

    if (isLarge) {
      for (let index = 1; index <= 300; index++) {
        machine(
          `batch-${String(index).padStart(3, "0")}`,
          "eu-west-1",
          index % 2 === 0 ? "subnet-0a" : "subnet-0b",
        );
      }
    }

    cloudRow({
      name: "web-alb",
      cloudResourceType: "AWS::ElasticLoadBalancingV2::LoadBalancer",
      providerResourceId: arn(
        "elasticloadbalancing",
        "eu-west-1",
        "loadbalancer/app/web-alb/50dc6c495c0c9188",
      ),
      cloudRegion: "eu-west-1",
      cloudRelationships: [
        {
          kind: "routes-to",
          target: "i-0web-1",
          targetType: "AWS::EC2::Instance",
        },
        {
          kind: "routes-to",
          target: "i-0web-2",
          targetType: "AWS::EC2::Instance",
        },
      ],
    });
    cloudRow({
      name: "orders-db",
      cloudResourceType: "AWS::RDS::DBInstance",
      providerResourceId: arn("rds", "eu-west-1", "db:orders-db"),
      cloudRegion: "eu-west-1",
      cloudRelationships: [runsIn("subnet-0b", "AWS::EC2::Subnet")],
    });
    cloudRow({
      name: "orders",
      cloudResourceType: "AWS::SQS::Queue",
      providerResourceId: arn("sqs", "eu-west-1", "orders"),
      cloudRegion: "eu-west-1",
    });
    cloudRow({
      name: "acme-assets",
      cloudResourceType: "AWS::S3::Bucket",
      providerResourceId: `arn:aws:s3:::acme-assets`,
      cloudRegion: "eu-west-1",
    });
    cloudRow({
      name: "assets",
      cloudResourceType: "AWS::CloudFront::Distribution",
      providerResourceId: `arn:aws:cloudfront::${CLOUD_ACCOUNT_ID}:distribution/E2QWRUHAPOMQZL`,
      cloudRegion: "",
    });
  }

  return {
    vmwareRows,
    k8sRows,
    k8sContainers,
    dockerRows: containerHostRows("dockerHostId", IDS.dockerHost),
    podmanRows: containerHostRows("podmanHostId", IDS.podmanHost),
    swarmRows,
    proxmoxRows,
    cephRows,
    storageRows,
    cloudRows,
    inventory: { projectId: PROJECT_ID, items, relationships },
    hostKey,
  };
}
