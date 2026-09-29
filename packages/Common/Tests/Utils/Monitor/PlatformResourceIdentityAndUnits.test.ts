import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { getAllCephMetrics } from "../../../Types/Monitor/CephMetricCatalog";
import { getAllDockerMetrics } from "../../../Types/Monitor/DockerMetricCatalog";
import { getAllDockerSwarmMetrics } from "../../../Types/Monitor/DockerSwarmMetricCatalog";
import * as HostMetricCatalog from "../../../Types/Monitor/HostMetricCatalog";
import { getAllIoTMetrics } from "../../../Types/Monitor/IotMetricCatalog";
import { getAllKubernetesMetrics } from "../../../Types/Monitor/KubernetesMetricCatalog";
import { getAllPodmanMetrics } from "../../../Types/Monitor/PodmanMetricCatalog";
import { getAllProxmoxMetrics } from "../../../Types/Monitor/ProxmoxMetricCatalog";
import { getAllVMwareMetrics } from "../../../Types/Monitor/VMwareMetricCatalog";
import MetricValueFormatter from "../../../Utils/Monitor/MetricValueFormatter";
import PlatformMetricUnitUtil, {
  MetricCatalogPlatform,
} from "../../../Utils/Monitor/PlatformMetricUnitUtil";
import PlatformResourceIdentity, {
  CephResourceIdentity,
  DockerSwarmResourceIdentity,
  KubernetesResourceIdentity,
  ProxmoxResourceIdentity,
  VMwareResourceIdentity,
} from "../../../Utils/Monitor/PlatformResourceIdentity";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * WHICH RESOURCE IS THIS, AND WHAT UNIT IS ITS VALUE IN.
 *
 * An alert's "Affected Resources" list is written by two readers that must
 * never disagree:
 *
 *  - the telemetry worker, naming the resource behind each raw datapoint it
 *    scanned;
 *  - the criteria evaluator, naming the resource behind each series a
 *    grouped monitor evaluated, from the series' group-by labels enriched
 *    with context borrowed from the series' own first breaching datapoint.
 *
 * PlatformResourceIdentity is the one copy of the attribute keys both
 * readers use. The borrowing rules (with*Context) are where a wrong answer
 * is most expensive: a node-level series that borrowed a namespace from an
 * arbitrary container row would title the node with somebody else's
 * tenant, and a series that borrowed from a datapoint that DISAGREES with
 * it would be titled as a different object altogether. So every rule is
 * pinned both ways — what a series may borrow, and what it may not.
 *
 * PlatformMetricUnitUtil decides what unit those values are in. The
 * platform catalog beats the exporter-declared unit (docker_stats declares
 * container.cpu.utilization as "1" but sends 0–100; kubeletstats declares
 * k8s.node.cpu.utilization as "1" but it is a cores gauge), and every
 * catalog unit must survive MetricValueFormatter without printing "NaN" or
 * "undefined" into somebody's inbox.
 */

type ExpectedIdentity<T> = { [K in keyof T]-?: T[K] | undefined };

function sortedEntries(
  value: Record<string, unknown>,
): Array<[string, unknown]> {
  return Object.entries(value)
    .filter((entry: [string, unknown]) => {
      return entry[1] !== undefined;
    })
    .sort((a: [string, unknown], b: [string, unknown]) => {
      return a[0].localeCompare(b[0]);
    });
}

/*
 * Compare identities by their DEFINED fields: the mappers return every key
 * (with undefined for absent ones) while the context rules spread series
 * objects, and neither shape is the point of these tests.
 */
function expectSameIdentity(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
): void {
  expect(sortedEntries(actual)).toEqual(sortedEntries(expected));
}

describe("PlatformResourceIdentity.readAttribute", () => {
  test("returns non-empty strings verbatim", () => {
    expect(
      PlatformResourceIdentity.readAttribute({ key: "node-1" }, "key"),
    ).toBe("node-1");
  });

  test("an empty string is not a name", () => {
    expect(
      PlatformResourceIdentity.readAttribute({ key: "" }, "key"),
    ).toBeUndefined();
  });

  test("finite numbers are stringified, non-finite ones are not names", () => {
    expect(PlatformResourceIdentity.readAttribute({ key: 7 }, "key")).toBe("7");
    expect(PlatformResourceIdentity.readAttribute({ key: 0 }, "key")).toBe("0");
    expect(
      PlatformResourceIdentity.readAttribute({ key: Number.NaN }, "key"),
    ).toBeUndefined();
    expect(
      PlatformResourceIdentity.readAttribute(
        { key: Number.POSITIVE_INFINITY },
        "key",
      ),
    ).toBeUndefined();
  });

  test("booleans, objects, null and missing keys are not names", () => {
    const attributes: JSONObject = {
      flag: true,
      nested: { name: "x" },
      empty: null,
    };

    expect(
      PlatformResourceIdentity.readAttribute(attributes, "flag"),
    ).toBeUndefined();
    expect(
      PlatformResourceIdentity.readAttribute(attributes, "nested"),
    ).toBeUndefined();
    expect(
      PlatformResourceIdentity.readAttribute(attributes, "empty"),
    ).toBeUndefined();
    expect(
      PlatformResourceIdentity.readAttribute(attributes, "missing"),
    ).toBeUndefined();
  });
});

describe("PlatformResourceIdentity.withBothAttributeSpellings", () => {
  test("mirrors a resource.-prefixed label under its bare OTel key", () => {
    expect(
      PlatformResourceIdentity.withBothAttributeSpellings({
        "resource.k8s.node.name": "node-1",
      }),
    ).toEqual({
      "resource.k8s.node.name": "node-1",
      "k8s.node.name": "node-1",
    });
  });

  test("mirrors a bare OTel label under its resource.-prefixed key", () => {
    expect(
      PlatformResourceIdentity.withBothAttributeSpellings({
        "k8s.node.name": "node-1",
      }),
    ).toEqual({
      "k8s.node.name": "node-1",
      "resource.k8s.node.name": "node-1",
    });
  });

  test("never overwrites a key that is already there, in either direction", () => {
    expect(
      PlatformResourceIdentity.withBothAttributeSpellings({
        "resource.k8s.node.name": "stored-node",
        "k8s.node.name": "bare-node",
      }),
    ).toEqual({
      "resource.k8s.node.name": "stored-node",
      "k8s.node.name": "bare-node",
    });
  });

  test("does not mutate the labels it was given", () => {
    const labels: JSONObject = { "resource.k8s.pod.name": "web-1" };

    PlatformResourceIdentity.withBothAttributeSpellings(labels);

    expect(labels).toEqual({ "resource.k8s.pod.name": "web-1" });
  });

  test("a bare 'resource.' key has no other spelling and gains no '' key", () => {
    expect(
      PlatformResourceIdentity.withBothAttributeSpellings({ "resource.": "x" }),
    ).toEqual({ "resource.": "x" });
  });

  test("a bare-keyed series reads as the same Kubernetes identity as a stored-keyed one", () => {
    const bare: KubernetesResourceIdentity =
      PlatformResourceIdentity.kubernetes(
        PlatformResourceIdentity.withBothAttributeSpellings({
          "k8s.node.name": "node-1",
        }),
      );
    const stored: KubernetesResourceIdentity =
      PlatformResourceIdentity.kubernetes(
        PlatformResourceIdentity.withBothAttributeSpellings({
          "resource.k8s.node.name": "node-1",
        }),
      );

    expect(bare).toEqual(stored);
    expect(bare.nodeName).toBe("node-1");
  });
});

describe("PlatformResourceIdentity.kubernetes", () => {
  test("maps a pod datapoint's resource attributes to its identity", () => {
    const identity: KubernetesResourceIdentity =
      PlatformResourceIdentity.kubernetes({
        "resource.k8s.cluster.name": "prod-cluster",
        "resource.k8s.namespace.name": "payments",
        "resource.k8s.node.name": "gke-pool-1-abcd",
        "resource.k8s.pod.name": "checkout-7d9f8b6c5-x2k4q",
        "resource.k8s.container.name": "checkout",
        "resource.k8s.deployment.name": "checkout",
        "resource.k8s.replicaset.name": "checkout-7d9f8b6c5",
      });

    const expected: ExpectedIdentity<KubernetesResourceIdentity> = {
      podName: "checkout-7d9f8b6c5-x2k4q",
      namespace: "payments",
      nodeName: "gke-pool-1-abcd",
      containerName: "checkout",
      workloadType: "Deployment",
      workloadName: "checkout",
    };

    expect(identity).toEqual(expected);
  });

  /*
   * The precedence chain, most specific controller first. Each row stamps
   * its own key AND every less specific one after it, and must still be
   * titled by its own.
   */
  const workloadChain: Array<[string, string]> = [
    ["resource.k8s.deployment.name", "Deployment"],
    ["resource.k8s.statefulset.name", "StatefulSet"],
    ["resource.k8s.daemonset.name", "DaemonSet"],
    ["resource.k8s.job.name", "Job"],
    ["resource.k8s.cronjob.name", "CronJob"],
    ["resource.k8s.replicaset.name", "ReplicaSet"],
    ["resource.k8s.hpa.name", "HorizontalPodAutoscaler"],
  ];

  for (let index: number = 0; index < workloadChain.length; index++) {
    const [key, type] = workloadChain[index] as [string, string];

    test(`${type} wins over every less specific workload key`, () => {
      const attributes: JSONObject = {};

      for (const [laterKey] of workloadChain.slice(index)) {
        attributes[laterKey] = `name-of-${laterKey}`;
      }

      const identity: KubernetesResourceIdentity =
        PlatformResourceIdentity.kubernetes(attributes);

      expect(identity.workloadType).toBe(type);
      expect(identity.workloadName).toBe(`name-of-${key}`);
    });
  }

  test("a Job pod spawned by a CronJob is titled by its Job", () => {
    const identity: KubernetesResourceIdentity =
      PlatformResourceIdentity.kubernetes({
        "resource.k8s.cronjob.name": "nightly-backup",
        "resource.k8s.job.name": "nightly-backup-28745120",
        "resource.k8s.pod.name": "nightly-backup-28745120-7xkqz",
      });

    expect(identity.workloadType).toBe("Job");
    expect(identity.workloadName).toBe("nightly-backup-28745120");
  });

  test("an empty workload name is skipped, not taken as the winner", () => {
    const identity: KubernetesResourceIdentity =
      PlatformResourceIdentity.kubernetes({
        "resource.k8s.deployment.name": "",
        "resource.k8s.statefulset.name": "postgres",
        "resource.k8s.pod.name": "",
        "resource.k8s.namespace.name": "",
      });

    expect(identity.workloadType).toBe("StatefulSet");
    expect(identity.workloadName).toBe("postgres");
    expect(identity.podName).toBeUndefined();
    expect(identity.namespace).toBeUndefined();
  });

  test("no workload key leaves both workload fields undefined", () => {
    const identity: KubernetesResourceIdentity =
      PlatformResourceIdentity.kubernetes({
        "resource.k8s.node.name": "node-1",
      });

    expect(identity.workloadType).toBeUndefined();
    expect(identity.workloadName).toBeUndefined();
    expect(identity.nodeName).toBe("node-1");
  });

  test("reads only the stored resource.-prefixed keys", () => {
    const identity: KubernetesResourceIdentity =
      PlatformResourceIdentity.kubernetes({
        "k8s.node.name": "node-1",
        "k8s.pod.name": "web-1",
        "k8s.deployment.name": "web",
      });

    expectSameIdentity(identity, {});
  });

  test("kubernetesKey joins pod, namespace, node, container and workload name", () => {
    expect(
      PlatformResourceIdentity.kubernetesKey({
        podName: "web-1",
        namespace: "prod",
        nodeName: "node-1",
        containerName: "app",
        workloadType: "Deployment",
        workloadName: "web",
      }),
    ).toBe("web-1|prod|node-1|app|web");

    expect(PlatformResourceIdentity.kubernetesKey({ nodeName: "node-1" })).toBe(
      "||node-1||",
    );
    expect(PlatformResourceIdentity.kubernetesKey({})).toBe("||||");
  });

  test("kubernetesKey does not depend on the workload TYPE", () => {
    expect(
      PlatformResourceIdentity.kubernetesKey({
        workloadType: "Deployment",
        workloadName: "web",
      }),
    ).toBe(
      PlatformResourceIdentity.kubernetesKey({
        workloadType: "StatefulSet",
        workloadName: "web",
      }),
    );
  });
});

describe("PlatformResourceIdentity.withKubernetesContext", () => {
  /*
   * The first breaching datapoint of a pod series: a full raw attribute
   * map, as the worker keeps it on each query row.
   */
  const podDatapoint: KubernetesResourceIdentity =
    PlatformResourceIdentity.kubernetes({
      "resource.k8s.namespace.name": "payments",
      "resource.k8s.node.name": "gke-pool-1-abcd",
      "resource.k8s.pod.name": "checkout-7d9f8b6c5-x2k4q",
      "resource.k8s.container.name": "checkout",
      "resource.k8s.deployment.name": "checkout",
      "resource.k8s.replicaset.name": "checkout-7d9f8b6c5",
    });

  test("a pod series borrows its node, workload and namespace", () => {
    const series: KubernetesResourceIdentity =
      PlatformResourceIdentity.kubernetes({
        "resource.k8s.pod.name": "checkout-7d9f8b6c5-x2k4q",
      });

    expectSameIdentity(
      PlatformResourceIdentity.withKubernetesContext(series, podDatapoint),
      {
        podName: "checkout-7d9f8b6c5-x2k4q",
        namespace: "payments",
        nodeName: "gke-pool-1-abcd",
        workloadType: "Deployment",
        workloadName: "checkout",
      },
    );
  });

  /*
   * A pod has many containers; its series is not about any one of them.
   */
  test("a pod series does not borrow a container", () => {
    const series: KubernetesResourceIdentity = {
      podName: "checkout-7d9f8b6c5-x2k4q",
    };

    expect(
      PlatformResourceIdentity.withKubernetesContext(series, podDatapoint)
        .containerName,
    ).toBeUndefined();
  });

  test("a pod series keeps what its own labels already say", () => {
    const series: KubernetesResourceIdentity = {
      podName: "checkout-7d9f8b6c5-x2k4q",
      namespace: "payments",
      workloadType: "Deployment",
      workloadName: "checkout",
    };

    expectSameIdentity(
      PlatformResourceIdentity.withKubernetesContext(series, podDatapoint),
      {
        podName: "checkout-7d9f8b6c5-x2k4q",
        namespace: "payments",
        nodeName: "gke-pool-1-abcd",
        workloadType: "Deployment",
        workloadName: "checkout",
      },
    );
  });

  test("a pod + container series borrows the pod's context too", () => {
    const series: KubernetesResourceIdentity = {
      podName: "checkout-7d9f8b6c5-x2k4q",
      containerName: "checkout",
    };

    expectSameIdentity(
      PlatformResourceIdentity.withKubernetesContext(series, podDatapoint),
      {
        podName: "checkout-7d9f8b6c5-x2k4q",
        containerName: "checkout",
        namespace: "payments",
        nodeName: "gke-pool-1-abcd",
        workloadType: "Deployment",
        workloadName: "checkout",
      },
    );
  });

  test("a workload series borrows only its namespace", () => {
    const series: KubernetesResourceIdentity =
      PlatformResourceIdentity.kubernetes({
        "resource.k8s.deployment.name": "checkout",
      });

    expectSameIdentity(
      PlatformResourceIdentity.withKubernetesContext(series, podDatapoint),
      {
        workloadType: "Deployment",
        workloadName: "checkout",
        namespace: "payments",
      },
    );
  });

  test("a workload + container series borrows nothing", () => {
    const series: KubernetesResourceIdentity = {
      workloadType: "Deployment",
      workloadName: "checkout",
      containerName: "checkout",
    };

    expect(
      PlatformResourceIdentity.withKubernetesContext(series, podDatapoint),
    ).toEqual(series);
  });

  /*
   * A node-level series summed from container rows has a different pod
   * and namespace on every row. Borrowing one would title the node with
   * an arbitrary tenant.
   */
  test("a node series borrows nothing", () => {
    const series: KubernetesResourceIdentity =
      PlatformResourceIdentity.kubernetes({
        "resource.k8s.node.name": "gke-pool-1-abcd",
      });

    const enriched: KubernetesResourceIdentity =
      PlatformResourceIdentity.withKubernetesContext(series, podDatapoint);

    expectSameIdentity(enriched, { nodeName: "gke-pool-1-abcd" });
    expect(enriched.namespace).toBeUndefined();
    expect(enriched.podName).toBeUndefined();
    expect(enriched.workloadName).toBeUndefined();
  });

  test("a container series with no pod borrows nothing", () => {
    const series: KubernetesResourceIdentity = { containerName: "checkout" };

    expect(
      PlatformResourceIdentity.withKubernetesContext(series, podDatapoint),
    ).toEqual({ containerName: "checkout" });
  });

  test("a namespace series borrows nothing", () => {
    const series: KubernetesResourceIdentity = { namespace: "payments" };

    expect(
      PlatformResourceIdentity.withKubernetesContext(series, podDatapoint),
    ).toEqual({ namespace: "payments" });
  });

  const disagreements: Array<[string, KubernetesResourceIdentity]> = [
    ["pod", { podName: "some-other-pod" }],
    [
      "namespace",
      { podName: "checkout-7d9f8b6c5-x2k4q", namespace: "billing" },
    ],
    ["node", { podName: "checkout-7d9f8b6c5-x2k4q", nodeName: "other-node" }],
    [
      "container",
      { podName: "checkout-7d9f8b6c5-x2k4q", containerName: "istio-proxy" },
    ],
    [
      "workload type",
      {
        workloadType: "StatefulSet",
        workloadName: "checkout",
      },
    ],
    [
      "workload name",
      {
        podName: "checkout-7d9f8b6c5-x2k4q",
        workloadType: "Deployment",
        workloadName: "cart",
      },
    ],
  ];

  for (const [field, series] of disagreements) {
    test(`a datapoint that disagrees on the ${field} is not the series' datapoint`, () => {
      expect(
        PlatformResourceIdentity.withKubernetesContext(series, podDatapoint),
      ).toBe(series);
    });
  }
});

describe("PlatformResourceIdentity.proxmox", () => {
  const guestAttributes: JSONObject = {
    id: "qemu/100",
    name: "web-vm",
    "pve.type": "qemu",
    "pve.scope": "guest",
    node: "pve1",
  };

  test("maps the agent's id / name / pve.type / pve.scope / node", () => {
    const expected: ExpectedIdentity<ProxmoxResourceIdentity> = {
      resourceId: "qemu/100",
      resourceName: "web-vm",
      resourceType: "qemu",
      scope: "guest",
      nodeName: "pve1",
    };

    expect(PlatformResourceIdentity.proxmox(guestAttributes)).toEqual(expected);
  });

  test("empty strings are not names", () => {
    expectSameIdentity(
      PlatformResourceIdentity.proxmox({ id: "lxc/101", name: "", node: "" }),
      { resourceId: "lxc/101" },
    );
  });

  test("proxmoxKey joins id, name and node", () => {
    expect(
      PlatformResourceIdentity.proxmoxKey(
        PlatformResourceIdentity.proxmox(guestAttributes),
      ),
    ).toBe("qemu/100|web-vm|pve1");
    expect(
      PlatformResourceIdentity.proxmoxKey({ resourceId: "node/pve1" }),
    ).toBe("node/pve1||");
  });

  test("a series grouped by id borrows type, scope, name and node", () => {
    const series: ProxmoxResourceIdentity = PlatformResourceIdentity.proxmox({
      id: "qemu/100",
    });

    expectSameIdentity(
      PlatformResourceIdentity.withProxmoxContext(
        series,
        PlatformResourceIdentity.proxmox(guestAttributes),
      ),
      {
        resourceId: "qemu/100",
        resourceName: "web-vm",
        resourceType: "qemu",
        scope: "guest",
        nodeName: "pve1",
      },
    );
  });

  test("a series with no id borrows nothing", () => {
    const series: ProxmoxResourceIdentity = { nodeName: "pve1" };

    expect(
      PlatformResourceIdentity.withProxmoxContext(
        series,
        PlatformResourceIdentity.proxmox(guestAttributes),
      ),
    ).toBe(series);
  });

  test("a datapoint that disagrees on any shared field is ignored", () => {
    const context: ProxmoxResourceIdentity =
      PlatformResourceIdentity.proxmox(guestAttributes);

    const disagreeing: Array<ProxmoxResourceIdentity> = [
      { resourceId: "qemu/101" },
      { resourceId: "qemu/100", resourceName: "db-vm" },
      { resourceId: "qemu/100", resourceType: "lxc" },
      { resourceId: "qemu/100", scope: "node" },
      { resourceId: "qemu/100", nodeName: "pve2" },
    ];

    for (const series of disagreeing) {
      expect(PlatformResourceIdentity.withProxmoxContext(series, context)).toBe(
        series,
      );
    }
  });
});

describe("PlatformResourceIdentity.vmware", () => {
  const vmAttributes: JSONObject = {
    "resource.vcenter.datacenter.name": "dc-east",
    "resource.vcenter.cluster.name": "cluster-a",
    "resource.vcenter.host.name": "esx-01.lab",
    "resource.vcenter.vm.name": "web-01",
    "resource.vcenter.vm.id": "vm-1042",
    "resource.vcenter.resource_pool.name": "prod-pool",
    "resource.vcenter.resource_pool.inventory_path":
      "/dc-east/host/cluster-a/Resources/prod-pool",
  };

  test("maps the vcenter receiver's resource attributes", () => {
    const expected: ExpectedIdentity<VMwareResourceIdentity> = {
      datacenterName: "dc-east",
      clusterName: "cluster-a",
      hostName: "esx-01.lab",
      vmName: "web-01",
      vmId: "vm-1042",
      datastoreName: undefined,
      resourcePoolName: "prod-pool",
      resourcePoolPath: "/dc-east/host/cluster-a/Resources/prod-pool",
    };

    expect(PlatformResourceIdentity.vmware(vmAttributes)).toEqual(expected);
  });

  test("a VM template's identity folds into the VM fields", () => {
    expectSameIdentity(
      PlatformResourceIdentity.vmware({
        "resource.vcenter.datacenter.name": "dc-east",
        "resource.vcenter.vm_template.name": "ubuntu-22.04-golden",
        "resource.vcenter.vm_template.id": "vm-7",
      }),
      {
        datacenterName: "dc-east",
        vmName: "ubuntu-22.04-golden",
        vmId: "vm-7",
      },
    );
  });

  test("a real VM name wins over a template name, an empty one does not", () => {
    const both: VMwareResourceIdentity = PlatformResourceIdentity.vmware({
      "resource.vcenter.vm.name": "web-01",
      "resource.vcenter.vm.id": "vm-1042",
      "resource.vcenter.vm_template.name": "golden",
      "resource.vcenter.vm_template.id": "vm-7",
    });

    expect(both.vmName).toBe("web-01");
    expect(both.vmId).toBe("vm-1042");

    const emptyVm: VMwareResourceIdentity = PlatformResourceIdentity.vmware({
      "resource.vcenter.vm.name": "",
      "resource.vcenter.vm_template.name": "golden",
    });

    expect(emptyVm.vmName).toBe("golden");
  });

  test("vmwareKey dedupes on the full tuple, preferring the pool path over its name", () => {
    expect(
      PlatformResourceIdentity.vmwareKey(
        PlatformResourceIdentity.vmware(vmAttributes),
      ),
    ).toBe(
      "dc-east|cluster-a|esx-01.lab|vm-1042|web-01||/dc-east/host/cluster-a/Resources/prod-pool",
    );

    expect(
      PlatformResourceIdentity.vmwareKey({
        datacenterName: "dc-east",
        resourcePoolName: "prod-pool",
      }),
    ).toBe("dc-east||||||prod-pool");

    expect(
      PlatformResourceIdentity.vmwareKey({ datastoreName: "datastore-1" }),
    ).toBe("|||||datastore-1|");
  });

  /*
   * The first breaching datapoint of a VM: the whole tree above it.
   */
  const vmDatapoint: VMwareResourceIdentity =
    PlatformResourceIdentity.vmware(vmAttributes);

  test("a VM series borrows its host, cluster, datacenter and pool", () => {
    expectSameIdentity(
      PlatformResourceIdentity.withVMwareContext(
        { vmName: "web-01" },
        vmDatapoint,
      ),
      {
        datacenterName: "dc-east",
        clusterName: "cluster-a",
        hostName: "esx-01.lab",
        vmName: "web-01",
        vmId: "vm-1042",
        resourcePoolName: "prod-pool",
        resourcePoolPath: "/dc-east/host/cluster-a/Resources/prod-pool",
      },
    );
  });

  test("a VM series keyed by id alone borrows its name too", () => {
    expect(
      PlatformResourceIdentity.withVMwareContext(
        { vmId: "vm-1042" },
        vmDatapoint,
      ).vmName,
    ).toBe("web-01");
  });

  test("a VM series never borrows a datastore", () => {
    expect(
      PlatformResourceIdentity.withVMwareContext(
        { vmName: "web-01" },
        { ...vmDatapoint, datastoreName: "datastore-1" },
      ).datastoreName,
    ).toBeUndefined();
  });

  test("a host series borrows its cluster and datacenter, nothing below or beside it", () => {
    expectSameIdentity(
      PlatformResourceIdentity.withVMwareContext(
        { hostName: "esx-01.lab" },
        vmDatapoint,
      ),
      {
        datacenterName: "dc-east",
        clusterName: "cluster-a",
        hostName: "esx-01.lab",
      },
    );
  });

  /*
   * The VMs in a pool can run on different hosts, so the host of one of
   * them is not the pool's.
   */
  test("a resource pool series borrows its cluster, datacenter and own path but never a host", () => {
    const enriched: VMwareResourceIdentity =
      PlatformResourceIdentity.withVMwareContext(
        { resourcePoolName: "prod-pool" },
        vmDatapoint,
      );

    /*
     * The pool's inventory path is the same object as its name, so the
     * series is titled the way the raw-scan list titles it.
     */
    expectSameIdentity(enriched, {
      datacenterName: "dc-east",
      clusterName: "cluster-a",
      resourcePoolName: "prod-pool",
      resourcePoolPath: "/dc-east/host/cluster-a/Resources/prod-pool",
    });
    expect(enriched.hostName).toBeUndefined();
    expect(enriched.vmName).toBeUndefined();
  });

  test("a pool series keyed by its inventory path never borrows a host either", () => {
    expect(
      PlatformResourceIdentity.withVMwareContext(
        {
          resourcePoolPath: "/dc-east/host/cluster-a/Resources/prod-pool",
        },
        vmDatapoint,
      ).hostName,
    ).toBeUndefined();
  });

  test("a datastore series borrows only its datacenter", () => {
    expectSameIdentity(
      PlatformResourceIdentity.withVMwareContext(
        { datastoreName: "datastore-1" },
        { datacenterName: "dc-east", clusterName: "cluster-a" },
      ),
      { datastoreName: "datastore-1", datacenterName: "dc-east" },
    );
  });

  test("a cluster series borrows only its datacenter", () => {
    expectSameIdentity(
      PlatformResourceIdentity.withVMwareContext(
        { clusterName: "cluster-a" },
        vmDatapoint,
      ),
      { clusterName: "cluster-a", datacenterName: "dc-east" },
    );
  });

  test("a datacenter series borrows nothing", () => {
    expect(
      PlatformResourceIdentity.withVMwareContext(
        { datacenterName: "dc-east" },
        vmDatapoint,
      ),
    ).toEqual({ datacenterName: "dc-east" });
  });

  test("a datapoint that disagrees on any shared field is ignored", () => {
    const disagreeing: Array<VMwareResourceIdentity> = [
      { vmName: "web-02" },
      { vmName: "web-01", vmId: "vm-9999" },
      { vmName: "web-01", hostName: "esx-02.lab" },
      { hostName: "esx-01.lab", clusterName: "cluster-b" },
      { resourcePoolName: "prod-pool", datacenterName: "dc-west" },
      { resourcePoolPath: "/elsewhere/prod-pool" },
    ];

    for (const series of disagreeing) {
      expect(
        PlatformResourceIdentity.withVMwareContext(series, vmDatapoint),
      ).toBe(series);
    }
  });
});

describe("PlatformResourceIdentity.ceph", () => {
  test("maps a daemon datapoint", () => {
    const expected: ExpectedIdentity<CephResourceIdentity> = {
      daemon: "osd.3",
      poolId: undefined,
      poolName: undefined,
      hostname: "ceph-node-2",
    };

    expect(
      PlatformResourceIdentity.ceph({
        ceph_daemon: "osd.3",
        hostname: "ceph-node-2",
        device_class: "ssd",
      }),
    ).toEqual(expected);
  });

  test("a numeric pool_id is stringified, like a string one", () => {
    expectSameIdentity(
      PlatformResourceIdentity.ceph({ pool_id: 7, name: "rbd" }),
      {
        poolId: "7",
        poolName: "rbd",
      },
    );
    expect(PlatformResourceIdentity.ceph({ pool_id: "7" }).poolId).toBe("7");
    expect(PlatformResourceIdentity.ceph({ pool_id: 0 }).poolId).toBe("0");
  });

  test("the numeric and string pool ids key identically", () => {
    expect(
      PlatformResourceIdentity.cephKey(
        PlatformResourceIdentity.ceph({ pool_id: 7, name: "rbd" }),
      ),
    ).toBe(
      PlatformResourceIdentity.cephKey(
        PlatformResourceIdentity.ceph({ pool_id: "7", name: "rbd" }),
      ),
    );
    expect(
      PlatformResourceIdentity.cephKey({
        daemon: "osd.3",
        hostname: "ceph-node-2",
      }),
    ).toBe("osd.3|||ceph-node-2");
  });

  test("a daemon series borrows the host it runs on", () => {
    expectSameIdentity(
      PlatformResourceIdentity.withCephContext(
        { daemon: "osd.3" },
        PlatformResourceIdentity.ceph({
          ceph_daemon: "osd.3",
          hostname: "ceph-node-2",
        }),
      ),
      { daemon: "osd.3", hostname: "ceph-node-2" },
    );
  });

  test("a pool series borrows its name", () => {
    expectSameIdentity(
      PlatformResourceIdentity.withCephContext(
        { poolId: "7" },
        PlatformResourceIdentity.ceph({ pool_id: 7, name: "rbd" }),
      ),
      { poolId: "7", poolName: "rbd" },
    );
  });

  test("a series naming neither a daemon nor a pool borrows nothing", () => {
    const series: CephResourceIdentity = { hostname: "ceph-node-2" };

    expect(
      PlatformResourceIdentity.withCephContext(series, {
        daemon: "osd.3",
        hostname: "ceph-node-2",
      }),
    ).toBe(series);
  });

  test("a datapoint that disagrees on any shared field is ignored", () => {
    const osd3: CephResourceIdentity = {
      daemon: "osd.3",
      hostname: "ceph-node-2",
    };

    const disagreeing: Array<CephResourceIdentity> = [
      { daemon: "osd.4" },
      { daemon: "osd.3", hostname: "ceph-node-1" },
      { poolId: "7", poolName: "cephfs_data" },
    ];

    for (const series of disagreeing) {
      expect(
        PlatformResourceIdentity.withCephContext(series, {
          ...osd3,
          poolId: "7",
          poolName: "rbd",
        }),
      ).toBe(series);
    }
  });
});

describe("PlatformResourceIdentity.dockerSwarm", () => {
  const taskAttributes: JSONObject = {
    "resource.container.name": "web.1.x7k2m9p4q1",
    "resource.container.image.name": "nginx:1.25",
    "docker.swarm.node.name": "worker-1",
    "docker.swarm.service.name": "web",
  };

  test("maps the prefixed container keys and the swarm keys", () => {
    const expected: ExpectedIdentity<DockerSwarmResourceIdentity> = {
      containerName: "web.1.x7k2m9p4q1",
      containerImage: "nginx:1.25",
      nodeName: "worker-1",
      serviceName: "web",
    };

    expect(PlatformResourceIdentity.dockerSwarm(taskAttributes)).toEqual(
      expected,
    );
  });

  test("the bare container keys are not where docker_stats puts identity", () => {
    expectSameIdentity(
      PlatformResourceIdentity.dockerSwarm({
        "container.name": "web.1.x7k2m9p4q1",
        "container.image.name": "nginx:1.25",
      }),
      {},
    );
  });

  test("dockerSwarmKey joins container, image, node and service", () => {
    expect(
      PlatformResourceIdentity.dockerSwarmKey(
        PlatformResourceIdentity.dockerSwarm(taskAttributes),
      ),
    ).toBe("web.1.x7k2m9p4q1|nginx:1.25|worker-1|web");
    expect(
      PlatformResourceIdentity.dockerSwarmKey({ serviceName: "web" }),
    ).toBe("|||web");
  });

  test("a container series borrows its image, node and service", () => {
    expectSameIdentity(
      PlatformResourceIdentity.withDockerSwarmContext(
        { containerName: "web.1.x7k2m9p4q1" },
        PlatformResourceIdentity.dockerSwarm(taskAttributes),
      ),
      {
        containerName: "web.1.x7k2m9p4q1",
        containerImage: "nginx:1.25",
        nodeName: "worker-1",
        serviceName: "web",
      },
    );
  });

  test("a service series or a node series borrows nothing", () => {
    const context: DockerSwarmResourceIdentity =
      PlatformResourceIdentity.dockerSwarm(taskAttributes);
    const service: DockerSwarmResourceIdentity = { serviceName: "web" };
    const node: DockerSwarmResourceIdentity = { nodeName: "worker-1" };

    expect(
      PlatformResourceIdentity.withDockerSwarmContext(service, context),
    ).toBe(service);
    expect(PlatformResourceIdentity.withDockerSwarmContext(node, context)).toBe(
      node,
    );
  });

  test("a datapoint that disagrees on any shared field is ignored", () => {
    const context: DockerSwarmResourceIdentity =
      PlatformResourceIdentity.dockerSwarm(taskAttributes);

    const disagreeing: Array<DockerSwarmResourceIdentity> = [
      { containerName: "web.2.aaaaaaaaaa" },
      { containerName: "web.1.x7k2m9p4q1", containerImage: "nginx:1.24" },
      { containerName: "web.1.x7k2m9p4q1", nodeName: "worker-2" },
      { containerName: "web.1.x7k2m9p4q1", serviceName: "api" },
    ];

    for (const series of disagreeing) {
      expect(
        PlatformResourceIdentity.withDockerSwarmContext(series, context),
      ).toBe(series);
    }
  });
});

describe("PlatformMetricUnitUtil.getPlatformForMonitorType", () => {
  const mapped: Array<[MonitorType, MetricCatalogPlatform]> = [
    [MonitorType.Kubernetes, "kubernetes"],
    [MonitorType.Proxmox, "proxmox"],
    [MonitorType.VMware, "vmware"],
    [MonitorType.DockerSwarm, "dockerSwarm"],
    [MonitorType.Ceph, "ceph"],
    [MonitorType.Docker, "docker"],
    [MonitorType.Podman, "podman"],
    [MonitorType.Host, "host"],
    [MonitorType.IoTDevice, "iot"],
  ];

  for (const [monitorType, platform] of mapped) {
    test(`${monitorType} reads the ${platform} catalog`, () => {
      expect(
        PlatformMetricUnitUtil.getPlatformForMonitorType(monitorType),
      ).toBe(platform);
    });
  }

  test("a generic Metrics monitor keeps the exporter's declared unit", () => {
    expect(
      PlatformMetricUnitUtil.getPlatformForMonitorType(MonitorType.Metrics),
    ).toBeNull();
  });

  test("every other monitor type, and no type at all, has no catalog", () => {
    const platformTypes: Set<MonitorType> = new Set<MonitorType>(
      mapped.map((entry: [MonitorType, MetricCatalogPlatform]) => {
        return entry[0];
      }),
    );

    for (const monitorType of Object.values(MonitorType)) {
      if (platformTypes.has(monitorType)) {
        continue;
      }

      expect(
        PlatformMetricUnitUtil.getPlatformForMonitorType(monitorType),
      ).toBeNull();
    }

    expect(
      PlatformMetricUnitUtil.getPlatformForMonitorType(undefined),
    ).toBeNull();
  });
});

describe("PlatformMetricUnitUtil.getCatalogUnit", () => {
  test("returns the unit exactly as the catalog spells it", () => {
    expect(
      PlatformMetricUnitUtil.getCatalogUnit({
        platform: "kubernetes",
        metricName: "k8s.node.memory.usage",
      }),
    ).toBe("bytes");
    expect(
      PlatformMetricUnitUtil.getCatalogUnit({
        platform: "kubernetes",
        metricName: "k8s.node.cpu.utilization",
      }),
    ).toBe("cores");
    expect(
      PlatformMetricUnitUtil.getCatalogUnit({
        platform: "host",
        metricName: "system.cpu.utilization",
      }),
    ).toBe("ratio");
    expect(
      PlatformMetricUnitUtil.getCatalogUnit({
        platform: "kubernetes",
        metricName: "k8s.container.restarts",
      }),
    ).toBe("count");
    expect(
      PlatformMetricUnitUtil.getCatalogUnit({
        platform: "docker",
        metricName: "container.cpu.utilization",
      }),
    ).toBe("%");
  });

  test("undefined for a metric the catalog does not know", () => {
    expect(
      PlatformMetricUnitUtil.getCatalogUnit({
        platform: "kubernetes",
        metricName: "not.a.kubernetes.metric",
      }),
    ).toBeUndefined();
  });

  test("undefined for a catalog entry whose unit is empty", () => {
    expect(
      PlatformMetricUnitUtil.getCatalogUnit({
        platform: "kubernetes",
        metricName: "k8s.pod.phase",
      }),
    ).toBeUndefined();
  });

  test("looks the metric up in the platform's OWN catalog", () => {
    // A Kubernetes metric is unknown to the Docker catalog.
    expect(
      PlatformMetricUnitUtil.getCatalogUnit({
        platform: "docker",
        metricName: "k8s.node.memory.usage",
      }),
    ).toBeUndefined();
  });
});

describe("PlatformMetricUnitUtil.getMetricUnit", () => {
  /*
   * docker_stats declares "1" and sends 0–100. Taking the declared unit
   * renders 85.3 as "8530.00%" and makes a "%" threshold fire forever.
   */
  test("the catalog's % beats docker_stats' declared '1'", () => {
    expect(
      PlatformMetricUnitUtil.getMetricUnit({
        platform: "docker",
        metricName: "container.cpu.utilization",
        declaredUnit: "1",
      }),
    ).toBe("%");
  });

  test("the catalog's cores beats kubeletstats' declared '1'", () => {
    expect(
      PlatformMetricUnitUtil.getMetricUnit({
        platform: "kubernetes",
        metricName: "k8s.node.cpu.utilization",
        declaredUnit: "1",
      }),
    ).toBe("cores");
  });

  test("the catalog's 'ratio' becomes UCUM's '1', declared or not", () => {
    expect(
      PlatformMetricUnitUtil.getMetricUnit({
        platform: "host",
        metricName: "system.cpu.utilization",
        declaredUnit: "1",
      }),
    ).toBe("1");
    expect(
      PlatformMetricUnitUtil.getMetricUnit({
        platform: "host",
        metricName: "system.cpu.utilization",
      }),
    ).toBe("1");
  });

  test("the catalog's 'count' names no dimension and defers to the declared unit", () => {
    expect(
      PlatformMetricUnitUtil.getMetricUnit({
        platform: "kubernetes",
        metricName: "k8s.container.restarts",
        declaredUnit: "{restart}",
      }),
    ).toBe("{restart}");
    expect(
      PlatformMetricUnitUtil.getMetricUnit({
        platform: "kubernetes",
        metricName: "k8s.container.restarts",
      }),
    ).toBeUndefined();
  });

  test("a metric the catalog does not know keeps its declared unit", () => {
    expect(
      PlatformMetricUnitUtil.getMetricUnit({
        platform: "kubernetes",
        metricName: "my.custom.gauge",
        declaredUnit: "By",
      }),
    ).toBe("By");
  });

  test("a catalog entry with an empty unit keeps the declared unit", () => {
    expect(
      PlatformMetricUnitUtil.getMetricUnit({
        platform: "kubernetes",
        metricName: "k8s.pod.phase",
        declaredUnit: "{phase}",
      }),
    ).toBe("{phase}");
  });

  test("no platform means the declared unit, even for a metric a catalog knows", () => {
    expect(
      PlatformMetricUnitUtil.getMetricUnit({
        platform: null,
        metricName: "container.cpu.utilization",
        declaredUnit: "1",
      }),
    ).toBe("1");
  });

  test("the declared unit is trimmed, and a blank one is no unit", () => {
    expect(
      PlatformMetricUnitUtil.getMetricUnit({
        platform: null,
        metricName: "my.custom.gauge",
        declaredUnit: "  By  ",
      }),
    ).toBe("By");
    expect(
      PlatformMetricUnitUtil.getMetricUnit({
        platform: null,
        metricName: "my.custom.gauge",
        declaredUnit: "   ",
      }),
    ).toBeUndefined();
  });

  test("nothing known means undefined", () => {
    expect(
      PlatformMetricUnitUtil.getMetricUnit({
        platform: null,
        metricName: "my.custom.gauge",
      }),
    ).toBeUndefined();
    expect(
      PlatformMetricUnitUtil.getMetricUnit({
        platform: "kubernetes",
        metricName: "my.custom.gauge",
        declaredUnit: null,
      }),
    ).toBeUndefined();
  });

  describe("the catalogs' English spellings, whatever their case", () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    const spellings: Array<[string, string | undefined]> = [
      ["fraction", "1"],
      ["Fraction", "1"],
      ["RATIO", "1"],
      ["counts", undefined],
      ["Count", undefined],
      ["  bytes  ", "bytes"],
    ];

    for (const [catalogUnit, expected] of spellings) {
      test(`catalog unit '${catalogUnit}' resolves to ${String(expected)}`, () => {
        jest
          .spyOn(HostMetricCatalog, "getHostMetricByMetricName")
          .mockReturnValue({
            id: "test-metric",
            friendlyName: "Test Metric",
            description: "A metric the test injects into the host catalog.",
            metricName: "test.metric",
            category: "CPU",
            defaultAggregation:
              HostMetricCatalog.getAllHostMetrics()[0]!.defaultAggregation,
            unit: catalogUnit,
          } as HostMetricCatalog.HostMetricDefinition);

        expect(
          PlatformMetricUnitUtil.getMetricUnit({
            platform: "host",
            metricName: "test.metric",
          }),
        ).toBe(expected);
      });
    }
  });
});

describe("PlatformMetricUnitUtil.buildUnitsByMetricName", () => {
  test("one lowercased entry per metric with a known unit", () => {
    const declared: Map<string, string> = new Map<string, string>([
      ["k8s.node.cpu.utilization", "1"],
      ["k8s.container.restarts", "{restart}"],
      ["k8s.node.allocatable_memory", "By"],
      ["my.custom.latency", "ms"],
    ]);

    const units: Dictionary<string> =
      PlatformMetricUnitUtil.buildUnitsByMetricName({
        platform: "kubernetes",
        metricNames: [
          "k8s.node.memory.usage",
          "k8s.node.cpu.utilization",
          "k8s.container.restarts",
          "k8s.node.allocatable_memory",
          "My.Custom.Latency",
          "no.unit.anywhere",
          "",
        ],
        declaredUnitsByMetricName: declared,
      });

    expect(units).toEqual({
      "k8s.node.memory.usage": "bytes",
      "k8s.node.cpu.utilization": "cores",
      "k8s.container.restarts": "{restart}",
      "k8s.node.allocatable_memory": "bytes",
      "my.custom.latency": "ms",
    });
  });

  test("metrics with no known unit are left out, not mapped to ''", () => {
    const units: Dictionary<string> =
      PlatformMetricUnitUtil.buildUnitsByMetricName({
        platform: "kubernetes",
        metricNames: ["k8s.container.restarts", "k8s.pod.phase"],
        declaredUnitsByMetricName: new Map<string, string>(),
      });

    expect(units).toEqual({});
    expect(Object.keys(units)).not.toContain("k8s.container.restarts");
  });

  test("the declared-unit map is read with the lowercased name", () => {
    const units: Dictionary<string> =
      PlatformMetricUnitUtil.buildUnitsByMetricName({
        platform: null,
        metricNames: ["Custom.Metric"],
        declaredUnitsByMetricName: new Map<string, string>([
          ["custom.metric", "By"],
        ]),
      });

    expect(units).toEqual({ "custom.metric": "By" });
  });

  test("without a platform every entry is the declared unit", () => {
    const units: Dictionary<string> =
      PlatformMetricUnitUtil.buildUnitsByMetricName({
        platform: null,
        metricNames: ["container.cpu.utilization", "k8s.node.cpu.utilization"],
        declaredUnitsByMetricName: new Map<string, string>([
          ["container.cpu.utilization", "1"],
          ["k8s.node.cpu.utilization", "1"],
        ]),
      });

    expect(units).toEqual({
      "container.cpu.utilization": "1",
      "k8s.node.cpu.utilization": "1",
    });
  });
});

describe("PlatformMetricUnitUtil × MetricValueFormatter over every catalog entry", () => {
  type CatalogEntry = {
    platform: MetricCatalogPlatform;
    metricName: string;
    unit?: string | undefined;
  };

  const catalogEntries: Array<CatalogEntry> = [
    ...getAllKubernetesMetrics().map(
      (m: { metricName: string; unit?: string }) => {
        return { platform: "kubernetes" as MetricCatalogPlatform, ...m };
      },
    ),
    ...getAllProxmoxMetrics().map(
      (m: { metricName: string; unit?: string }) => {
        return { platform: "proxmox" as MetricCatalogPlatform, ...m };
      },
    ),
    ...getAllVMwareMetrics().map((m: { metricName: string; unit?: string }) => {
      return { platform: "vmware" as MetricCatalogPlatform, ...m };
    }),
    ...getAllDockerSwarmMetrics().map(
      (m: { metricName: string; unit?: string }) => {
        return { platform: "dockerSwarm" as MetricCatalogPlatform, ...m };
      },
    ),
    ...getAllCephMetrics().map((m: { metricName: string; unit?: string }) => {
      return { platform: "ceph" as MetricCatalogPlatform, ...m };
    }),
    ...getAllDockerMetrics().map((m: { metricName: string; unit?: string }) => {
      return { platform: "docker" as MetricCatalogPlatform, ...m };
    }),
    ...getAllPodmanMetrics().map((m: { metricName: string; unit?: string }) => {
      return { platform: "podman" as MetricCatalogPlatform, ...m };
    }),
    ...HostMetricCatalog.getAllHostMetrics().map(
      (m: { metricName: string; unit?: string }) => {
        return { platform: "host" as MetricCatalogPlatform, ...m };
      },
    ),
    ...getAllIoTMetrics().map((m: { metricName: string; unit?: string }) => {
      return { platform: "iot" as MetricCatalogPlatform, ...m };
    }),
  ];

  test("every platform catalog contributes entries", () => {
    const platforms: Set<MetricCatalogPlatform> = new Set(
      catalogEntries.map((entry: CatalogEntry) => {
        return entry.platform;
      }),
    );

    expect(platforms.size).toBe(9);
  });

  test("every entry formats a large value without NaN or undefined", () => {
    const failures: Array<string> = [];

    for (const entry of catalogEntries) {
      const unit: string | undefined = PlatformMetricUnitUtil.getMetricUnit({
        platform: entry.platform,
        metricName: entry.metricName,
      });

      let rendered: string;

      try {
        rendered = MetricValueFormatter.format({
          value: 123456789,
          unit: unit,
          metricName: entry.metricName,
        });
      } catch (error) {
        failures.push(
          `${entry.platform} ${entry.metricName} (${String(unit)}) threw ${String(error)}`,
        );
        continue;
      }

      if (
        !rendered ||
        rendered.includes("NaN") ||
        rendered.includes("undefined")
      ) {
        failures.push(
          `${entry.platform} ${entry.metricName} (${String(unit)}) → "${rendered}"`,
        );
      }
    }

    expect(failures).toEqual([]);
  });

  test("every catalog unit resolves to a unit or to nothing — never to ''", () => {
    for (const entry of catalogEntries) {
      const unit: string | undefined = PlatformMetricUnitUtil.getMetricUnit({
        platform: entry.platform,
        metricName: entry.metricName,
      });

      expect(unit === undefined || unit.trim().length > 0).toBe(true);
    }
  });

  /*
   * "ratio" becomes "1", and "1" only renders as a percentage on a metric
   * whose NAME says it is a fraction. A ratio entry whose name did not
   * would print 0.5 bare instead of "50.00%".
   */
  test("every catalog 'ratio' metric renders as a percentage", () => {
    const ratioEntries: Array<CatalogEntry> = catalogEntries.filter(
      (entry: CatalogEntry) => {
        return (entry.unit || "").trim().toLowerCase() === "ratio";
      },
    );

    expect(ratioEntries.length).toBeGreaterThan(0);

    for (const entry of ratioEntries) {
      expect(
        MetricValueFormatter.format({
          value: 0.5,
          unit: PlatformMetricUnitUtil.getMetricUnit({
            platform: entry.platform,
            metricName: entry.metricName,
          }),
          metricName: entry.metricName,
        }),
      ).toBe("50.00%");
    }
  });

  test("every catalog '%' metric renders as the percentage it already is", () => {
    const percentEntries: Array<CatalogEntry> = catalogEntries.filter(
      (entry: CatalogEntry) => {
        return (entry.unit || "").trim() === "%";
      },
    );

    expect(percentEntries.length).toBeGreaterThan(0);

    for (const entry of percentEntries) {
      expect(
        MetricValueFormatter.format({
          value: 85.3,
          unit: PlatformMetricUnitUtil.getMetricUnit({
            platform: entry.platform,
            metricName: entry.metricName,
            declaredUnit: "1",
          }),
          metricName: entry.metricName,
        }),
      ).toBe("85.30%");
    }
  });

  test("every catalog byte metric renders on the decimal byte ladder", () => {
    const byteEntries: Array<CatalogEntry> = catalogEntries.filter(
      (entry: CatalogEntry) => {
        const unit: string = (entry.unit || "").trim();
        return unit === "bytes" || unit === "By";
      },
    );

    expect(byteEntries.length).toBeGreaterThan(0);

    for (const entry of byteEntries) {
      expect(
        MetricValueFormatter.format({
          value: 257760964608,
          unit: PlatformMetricUnitUtil.getMetricUnit({
            platform: entry.platform,
            metricName: entry.metricName,
          }),
          metricName: entry.metricName,
        }),
      ).toBe("258 GB");
    }
  });
});
