import { JSONObject } from "../../Types/JSON";
import {
  CephAffectedResource,
  DockerSwarmAffectedResource,
  KubernetesAffectedResource,
  ProxmoxAffectedResource,
  VMwareAffectedResource,
} from "../../Types/Monitor/MetricMonitor/MetricMonitorResponse";

/*
 * A platform resource without the numbers — just "which object is this".
 */
export type KubernetesResourceIdentity = Omit<
  KubernetesAffectedResource,
  "metricValue" | "lowestMetricValue"
>;
export type ProxmoxResourceIdentity = Omit<
  ProxmoxAffectedResource,
  "metricValue" | "lowestMetricValue"
>;
export type VMwareResourceIdentity = Omit<
  VMwareAffectedResource,
  "metricValue" | "lowestMetricValue"
>;
export type CephResourceIdentity = Omit<
  CephAffectedResource,
  "metricValue" | "lowestMetricValue"
>;
export type DockerSwarmResourceIdentity = Omit<
  DockerSwarmAffectedResource,
  "metricValue" | "lowestMetricValue"
>;

/*
 * Which platform object a set of metric attributes describes.
 *
 * Two readers need this answer and must never disagree about it:
 *
 *  - the telemetry worker, which scans raw datapoints and names the
 *    resource behind each one for the "Affected Resources" list;
 *  - the criteria evaluator, which names the resource behind each series
 *    a grouped monitor evaluated — from the series' group-by labels, which
 *    are the same attribute keys the worker reads (a template grouping by
 *    node groups by `resource.k8s.node.name`).
 *
 * Both used to carry their own copy of the attribute keys. Keeping one copy
 * here is what lets a per-series list and a raw-scan list title the same
 * node the same way.
 */
export default class PlatformResourceIdentity {
  /**
   * Read one attribute as a non-empty string. Numbers are stringified —
   * Ceph's `pool_id` arrives as either.
   */
  public static readAttribute(
    attributes: JSONObject,
    key: string,
  ): string | undefined {
    const value: unknown = attributes[key];

    if (typeof value === "string") {
      return value.length > 0 ? value : undefined;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }

    return undefined;
  }

  /**
   * Series labels are whatever keys the user grouped by. The shipped
   * templates group by the stored, `resource.`-prefixed key; a hand-built
   * monitor may group by the bare OTel key ("k8s.node.name"). Mirror each
   * label under its other spelling so either reads as the same identity.
   * An existing key is never overwritten.
   */
  public static withBothAttributeSpellings(labels: JSONObject): JSONObject {
    const result: JSONObject = { ...labels };
    const resourcePrefix: string = "resource.";

    for (const key of Object.keys(labels)) {
      const otherSpelling: string = key.startsWith(resourcePrefix)
        ? key.substring(resourcePrefix.length)
        : `${resourcePrefix}${key}`;

      if (otherSpelling && result[otherSpelling] === undefined) {
        result[otherSpelling] = labels[key] as JSONObject[string];
      }
    }

    return result;
  }

  public static kubernetes(attributes: JSONObject): KubernetesResourceIdentity {
    const read: (key: string) => string | undefined = (
      key: string,
    ): string | undefined => {
      return PlatformResourceIdentity.readAttribute(attributes, key);
    };

    let workloadType: string | undefined = undefined;
    let workloadName: string | undefined = undefined;

    /*
     * Most specific controller first. A pod created by a Deployment is
     * also stamped with its ReplicaSet, and the Deployment is the name a
     * human looks for.
     */
    const workloadKeys: Array<[string, string]> = [
      ["resource.k8s.deployment.name", "Deployment"],
      ["resource.k8s.statefulset.name", "StatefulSet"],
      ["resource.k8s.daemonset.name", "DaemonSet"],
      ["resource.k8s.job.name", "Job"],
      ["resource.k8s.cronjob.name", "CronJob"],
      ["resource.k8s.replicaset.name", "ReplicaSet"],
      /*
       * Not a workload, but the object the HPA templates group by, and a
       * series titled by it reads far better than one titled by its
       * namespace.
       */
      ["resource.k8s.hpa.name", "HorizontalPodAutoscaler"],
    ];

    for (const [key, type] of workloadKeys) {
      const name: string | undefined = read(key);

      if (name) {
        workloadType = type;
        workloadName = name;
        break;
      }
    }

    return {
      podName: read("resource.k8s.pod.name"),
      namespace: read("resource.k8s.namespace.name"),
      nodeName: read("resource.k8s.node.name"),
      containerName: read("resource.k8s.container.name"),
      workloadType: workloadType,
      workloadName: workloadName,
    };
  }

  /**
   * The key the worker dedupes Kubernetes datapoints on: two rows with the
   * same key are the same resource.
   */
  public static kubernetesKey(identity: KubernetesResourceIdentity): string {
    return [
      identity.podName || "",
      identity.namespace || "",
      identity.nodeName || "",
      identity.containerName || "",
      identity.workloadName || "",
    ].join("|");
  }

  /**
   * Fill in the context a Kubernetes series' own labels do not carry —
   * its namespace, workload and node — from one of the series' own
   * datapoints.
   *
   * Only what is guaranteed to be the same for EVERY datapoint of the
   * series is borrowed. A pod runs on one node and belongs to one
   * workload and one namespace, so a series that names a pod may borrow
   * all three; a workload lives in one namespace. A series grouped by
   * node may borrow nothing: a node-level series summed from container
   * rows (container CPU requests per node) has a different pod and
   * namespace on every row, and borrowing one would title the node with
   * an arbitrary tenant. The datapoint must also agree with every field
   * the series already has, or it is not the series' datapoint at all.
   */
  public static withKubernetesContext(
    series: KubernetesResourceIdentity,
    context: KubernetesResourceIdentity,
  ): KubernetesResourceIdentity {
    const agrees: boolean = PlatformResourceIdentity.agreesOn(
      series as JSONObject,
      context as JSONObject,
      [
        "podName",
        "namespace",
        "nodeName",
        "containerName",
        "workloadType",
        "workloadName",
      ],
    );

    if (!agrees) {
      return series;
    }

    if (series.podName) {
      return {
        ...series,
        namespace: series.namespace || context.namespace,
        nodeName: series.nodeName || context.nodeName,
        workloadType: series.workloadName
          ? series.workloadType
          : context.workloadType,
        workloadName: series.workloadName || context.workloadName,
      };
    }

    if (series.workloadName && !series.containerName) {
      return {
        ...series,
        namespace: series.namespace || context.namespace,
      };
    }

    return series;
  }

  public static proxmox(attributes: JSONObject): ProxmoxResourceIdentity {
    return {
      resourceId: PlatformResourceIdentity.readAttribute(attributes, "id"),
      resourceName: PlatformResourceIdentity.readAttribute(attributes, "name"),
      resourceType: PlatformResourceIdentity.readAttribute(
        attributes,
        "pve.type",
      ),
      scope: PlatformResourceIdentity.readAttribute(attributes, "pve.scope"),
      nodeName: PlatformResourceIdentity.readAttribute(attributes, "node"),
    };
  }

  public static proxmoxKey(identity: ProxmoxResourceIdentity): string {
    return [
      identity.resourceId || "",
      identity.resourceName || "",
      identity.nodeName || "",
    ].join("|");
  }

  /**
   * A Proxmox series grouped by `id` names one guest, node or storage;
   * every datapoint of it carries the same agent-stamped type and scope,
   * and (on the metadata series) the same name and node.
   */
  public static withProxmoxContext(
    series: ProxmoxResourceIdentity,
    context: ProxmoxResourceIdentity,
  ): ProxmoxResourceIdentity {
    if (
      !series.resourceId ||
      !PlatformResourceIdentity.agreesOn(
        series as JSONObject,
        context as JSONObject,
        ["resourceId", "resourceName", "resourceType", "scope", "nodeName"],
      )
    ) {
      return series;
    }

    return {
      ...series,
      resourceName: series.resourceName || context.resourceName,
      resourceType: series.resourceType || context.resourceType,
      scope: series.scope || context.scope,
      nodeName: series.nodeName || context.nodeName,
    };
  }

  public static vmware(attributes: JSONObject): VMwareResourceIdentity {
    const read: (key: string) => string | undefined = (
      key: string,
    ): string | undefined => {
      return PlatformResourceIdentity.readAttribute(attributes, key);
    };

    /*
     * Identity lives in the RESOURCE attributes the vcenter receiver
     * stamps, stored `resource.`-prefixed. A VM template is a VM with
     * `isTemplate` in the inventory, so its `vcenter.vm_template.*`
     * identity folds into the VM fields.
     */
    return {
      datacenterName: read("resource.vcenter.datacenter.name"),
      clusterName: read("resource.vcenter.cluster.name"),
      hostName: read("resource.vcenter.host.name"),
      vmName:
        read("resource.vcenter.vm.name") ||
        read("resource.vcenter.vm_template.name"),
      vmId:
        read("resource.vcenter.vm.id") ||
        read("resource.vcenter.vm_template.id"),
      datastoreName: read("resource.vcenter.datastore.name"),
      resourcePoolName: read("resource.vcenter.resource_pool.name"),
      resourcePoolPath: read("resource.vcenter.resource_pool.inventory_path"),
    };
  }

  /**
   * Dedupe on the full identity tuple: `vcenter.vm.id` alone identifies a
   * VM, but hosts / datastores / clusters are only unique within their
   * datacenter and pools within their path.
   */
  public static vmwareKey(identity: VMwareResourceIdentity): string {
    return [
      identity.datacenterName || "",
      identity.clusterName || "",
      identity.hostName || "",
      identity.vmId || "",
      identity.vmName || "",
      identity.datastoreName || "",
      identity.resourcePoolPath || identity.resourcePoolName || "",
    ].join("|");
  }

  /**
   * vSphere is a strict tree — a VM sits on one host in one cluster in one
   * datacenter — so a series that names an object may borrow the objects
   * ABOVE it from its own datapoint, never anything beside or below it. A
   * resource pool may not borrow a host: the VMs in a pool can run on
   * different hosts.
   */
  public static withVMwareContext(
    series: VMwareResourceIdentity,
    context: VMwareResourceIdentity,
  ): VMwareResourceIdentity {
    if (
      !PlatformResourceIdentity.agreesOn(
        series as JSONObject,
        context as JSONObject,
        [
          "datacenterName",
          "clusterName",
          "hostName",
          "vmName",
          "vmId",
          "datastoreName",
          "resourcePoolName",
          "resourcePoolPath",
        ],
      )
    ) {
      return series;
    }

    const above: {
      datacenterName: string | undefined;
      clusterName: string | undefined;
    } = {
      datacenterName: series.datacenterName || context.datacenterName,
      clusterName: series.clusterName || context.clusterName,
    };

    if (series.vmName || series.vmId) {
      return {
        ...series,
        ...above,
        hostName: series.hostName || context.hostName,
        vmName: series.vmName || context.vmName,
        vmId: series.vmId || context.vmId,
        resourcePoolName: series.resourcePoolName || context.resourcePoolName,
        resourcePoolPath: series.resourcePoolPath || context.resourcePoolPath,
      };
    }

    if (series.resourcePoolName || series.resourcePoolPath) {
      return { ...series, ...above };
    }

    if (series.hostName) {
      return { ...series, ...above };
    }

    if (series.datastoreName || series.clusterName) {
      return {
        ...series,
        datacenterName: above.datacenterName,
      };
    }

    return series;
  }

  public static ceph(attributes: JSONObject): CephResourceIdentity {
    return {
      daemon: PlatformResourceIdentity.readAttribute(attributes, "ceph_daemon"),
      poolId: PlatformResourceIdentity.readAttribute(attributes, "pool_id"),
      poolName: PlatformResourceIdentity.readAttribute(attributes, "name"),
      hostname: PlatformResourceIdentity.readAttribute(attributes, "hostname"),
    };
  }

  public static cephKey(identity: CephResourceIdentity): string {
    return [
      identity.daemon || "",
      identity.poolId || "",
      identity.poolName || "",
      identity.hostname || "",
    ].join("|");
  }

  /**
   * A daemon runs on one host and a pool id has one name, so a series that
   * names either may borrow those from its own datapoint.
   */
  public static withCephContext(
    series: CephResourceIdentity,
    context: CephResourceIdentity,
  ): CephResourceIdentity {
    if (
      (!series.daemon && !series.poolId) ||
      !PlatformResourceIdentity.agreesOn(
        series as JSONObject,
        context as JSONObject,
        ["daemon", "poolId", "poolName", "hostname"],
      )
    ) {
      return series;
    }

    return {
      ...series,
      poolName: series.poolName || context.poolName,
      hostname: series.hostname || context.hostname,
    };
  }

  public static dockerSwarm(
    attributes: JSONObject,
  ): DockerSwarmResourceIdentity {
    /*
     * Prefixed: the docker_stats receiver puts container identity on the
     * RESOURCE, so ClickHouse stores `resource.container.name`.
     */
    return {
      containerName: PlatformResourceIdentity.readAttribute(
        attributes,
        "resource.container.name",
      ),
      containerImage: PlatformResourceIdentity.readAttribute(
        attributes,
        "resource.container.image.name",
      ),
      nodeName: PlatformResourceIdentity.readAttribute(
        attributes,
        "docker.swarm.node.name",
      ),
      serviceName: PlatformResourceIdentity.readAttribute(
        attributes,
        "docker.swarm.service.name",
      ),
    };
  }

  public static dockerSwarmKey(identity: DockerSwarmResourceIdentity): string {
    return [
      identity.containerName || "",
      identity.containerImage || "",
      identity.nodeName || "",
      identity.serviceName || "",
    ].join("|");
  }

  /**
   * A Swarm task's container runs one image on one node for one service,
   * so a series that names the container may borrow all three.
   */
  public static withDockerSwarmContext(
    series: DockerSwarmResourceIdentity,
    context: DockerSwarmResourceIdentity,
  ): DockerSwarmResourceIdentity {
    if (
      !series.containerName ||
      !PlatformResourceIdentity.agreesOn(
        series as JSONObject,
        context as JSONObject,
        ["containerName", "containerImage", "nodeName", "serviceName"],
      )
    ) {
      return series;
    }

    return {
      ...series,
      containerImage: series.containerImage || context.containerImage,
      nodeName: series.nodeName || context.nodeName,
      serviceName: series.serviceName || context.serviceName,
    };
  }

  /*
   * True when every listed field present on both sides has the same value.
   */
  private static agreesOn(
    series: JSONObject,
    context: JSONObject,
    fields: Array<string>,
  ): boolean {
    return fields.every((field: string) => {
      const a: unknown = series[field];
      const b: unknown = context[field];

      return a === undefined || b === undefined || a === b;
    });
  }
}
