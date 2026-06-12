import { JSONObject } from "../JSON";
import MetricsViewConfig from "../Metrics/MetricsViewConfig";
import RollingTime from "../RollingTime/RollingTime";

/**
 * The kind of Proxmox resource a metric series belongs to. Enum values are
 * byte-equal to the `pve.scope` datapoint attribute stamped by the agent's
 * OTTL transform processor (which splits pve-exporter's `id` label —
 * `node/pve1`, `qemu/100`, `lxc/101`, `storage/local` — into `pve.scope`,
 * `pve.type` and `pve.id`), so the monitor worker can map a scope filter to
 * an attribute-equality clause with no translation.
 */
export enum ProxmoxResourceScope {
  Cluster = "cluster",
  Node = "node",
  Guest = "guest",
  Storage = "storage",
}

/*
 * pve-exporter label semantics (the trap these filters avoid): data metrics
 * (pve_up, pve_cpu_usage_ratio, pve_memory_*, pve_disk_*, pve_network_*,
 * pve_ha_state) carry ONLY the `id` datapoint label — the `name` and `node`
 * labels exist solely on the *_info metadata series (pve_node_info,
 * pve_guest_info, pve_storage_info). Filters therefore target `id` and the
 * agent-stamped `pve.scope` / `pve.id` attributes, never `name`.
 */
export interface ProxmoxResourceFilters {
  /**
   * → equality on the `pve.scope` datapoint attribute
   * (node | guest | storage | cluster).
   */
  scope?: ProxmoxResourceScope | undefined;
  /**
   * → equality on the `pve.id` datapoint attribute — the part of the `id`
   * label after the slash ("pve1" for node/pve1, "100" for qemu/100,
   * "local" for storage/local). Pair with `scope` to target one resource.
   */
  pveId?: string | undefined;
  /**
   * → `pve.scope=node` + `pve.id=<nodeName>` equality. Scopes to the
   * node's OWN series (for nodes, `pve.id` IS the node name). This cannot
   * filter guest/storage series by their parent node — that relationship
   * only exists on the *_info metadata series.
   */
  nodeName?: string | undefined;
  /**
   * → equality on the raw `id` datapoint label (e.g. "qemu/100",
   * "lxc/101"). Wins over the other filters when set.
   */
  guestId?: string | undefined;
}

export default interface MonitorStepProxmoxMonitor {
  clusterIdentifier: string;
  resourceFilters: ProxmoxResourceFilters;
  metricViewConfig: MetricsViewConfig;
  rollingTime: RollingTime;
}

export class MonitorStepProxmoxMonitorUtil {
  public static getDefault(): MonitorStepProxmoxMonitor {
    return {
      clusterIdentifier: "",
      resourceFilters: {},
      metricViewConfig: {
        queryConfigs: [],
        formulaConfigs: [],
      },
      rollingTime: RollingTime.Past1Minute,
    };
  }

  public static fromJSON(json: JSONObject): MonitorStepProxmoxMonitor {
    return json as any as MonitorStepProxmoxMonitor;
  }

  public static toJSON(monitor: MonitorStepProxmoxMonitor): JSONObject {
    return monitor as any as JSONObject;
  }
}
