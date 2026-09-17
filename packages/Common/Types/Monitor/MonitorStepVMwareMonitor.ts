import { JSONObject } from "../JSON";
import MetricsViewConfig from "../Metrics/MetricsViewConfig";
import RollingTime from "../RollingTime/RollingTime";

/**
 * The kind of vSphere object a metric series belongs to.
 *
 * The OpenTelemetry Collector `vcenter` receiver emits one OTLP resource per
 * vSphere object and identifies it through RESOURCE attributes
 * (`vcenter.datacenter.name`, `vcenter.cluster.name`, `vcenter.host.name`,
 * `vcenter.vm.name` / `vcenter.vm.id`, `vcenter.datastore.name`,
 * `vcenter.resource_pool.inventory_path`). There is no agent-stamped scope
 * attribute the way Proxmox has `pve.scope`, so this enum is a catalog /
 * picker hint that says which identity attributes a metric carries — it is
 * never sent to ClickHouse as a filter itself.
 */
export enum VMwareResourceScope {
  VCenter = "vcenter",
  Datacenter = "datacenter",
  Cluster = "cluster",
  Host = "host",
  VirtualMachine = "vm",
  Datastore = "datastore",
  ResourcePool = "resource_pool",
}

/**
 * The inventory row kinds `VMwareResource.kind` can hold. Kept next to the
 * scope enum so the ingest scan, the inventory model description and the
 * dashboard all reference the same literal strings.
 *
 * VM templates are VirtualMachine rows with `isTemplate = true`; vApps are
 * not an inventory kind (vApp membership is a VM attribute only).
 */
export enum VMwareResourceKind {
  Datacenter = "Datacenter",
  Cluster = "Cluster",
  Host = "Host",
  VirtualMachine = "VirtualMachine",
  Datastore = "Datastore",
  ResourcePool = "ResourcePool",
}

/*
 * Filter contract: every filter below is an equality on an OTel RESOURCE
 * attribute, which OtelMetricsIngestService stores `resource.`-prefixed in
 * ClickHouse. The monitor worker maps each field to its prefixed attribute
 * (the arrow in each comment) and always adds
 * `resource.vmware.vcenter.name = vcenterIdentifier` on top.
 *
 * Datapoint attributes (`disk_state`, `power_state`, `status`, `effective`,
 * `direction`, `object`, `type`) are NOT filters here — they are per-query
 * attribute filters on the metric query itself, exactly like the Kubernetes
 * templates use them.
 */
export interface VMwareResourceFilters {
  /** → `resource.vcenter.datacenter.name` equality. */
  datacenterName?: string | undefined;
  /**
   * → `resource.vcenter.cluster.name` equality. Present on cluster, host,
   * VM and resource-pool series when the object sits inside a cluster;
   * absent for standalone ESXi hosts and the objects on them.
   */
  clusterName?: string | undefined;
  /**
   * → `resource.vcenter.host.name` equality. Scopes to the ESXi host's own
   * series AND to the series of every VM it runs (the receiver stamps the
   * parent host on VM resources), so a host filter alone still fans out
   * across the VMs of that host — combine with `vmName` to target one VM.
   */
  hostName?: string | undefined;
  /** → `resource.vcenter.vm.name` equality. */
  vmName?: string | undefined;
  /** → `resource.vcenter.datastore.name` equality. */
  datastoreName?: string | undefined;
  /**
   * → `resource.vcenter.resource_pool.inventory_path` equality. The
   * inventory path (`/DC/host/Cluster/Resources/pool`) is used rather than
   * the pool name because pool names are only unique within a parent.
   */
  resourcePoolPath?: string | undefined;
}

export default interface MonitorStepVMwareMonitor {
  /**
   * The `vmware.vcenter.name` resource attribute the agent stamps on every
   * metric — one value per vCenter Server (or standalone ESXi host) the
   * agent connects to.
   */
  vcenterIdentifier: string;
  resourceFilters: VMwareResourceFilters;
  metricViewConfig: MetricsViewConfig;
  rollingTime: RollingTime;
}

export class MonitorStepVMwareMonitorUtil {
  public static getDefault(): MonitorStepVMwareMonitor {
    return {
      vcenterIdentifier: "",
      resourceFilters: {},
      metricViewConfig: {
        queryConfigs: [],
        formulaConfigs: [],
      },
      /*
       * The VMware Agent polls vCenter every VCENTER_COLLECTION_INTERVAL
       * (2 minutes by default) and the vcenter receiver emits ONE sample per
       * object per collection, so the 1-minute window the 30-second Proxmox
       * and Kubernetes agents default to would hold no sample on roughly
       * every other evaluation — a hand-built monitor would flip between
       * "no criteria met" and firing every tick. Default to 5 minutes (at
       * least two collections) so the step form, the metric picker, the API
       * and Terraform all seed the same safe window; the shipped templates
       * hard-code 5 / 15 minutes for the same reason.
       */
      rollingTime: RollingTime.Past5Minutes,
    };
  }

  public static fromJSON(json: JSONObject): MonitorStepVMwareMonitor {
    return json as any as MonitorStepVMwareMonitor;
  }

  public static toJSON(monitor: MonitorStepVMwareMonitor): JSONObject {
    return monitor as any as JSONObject;
  }
}
