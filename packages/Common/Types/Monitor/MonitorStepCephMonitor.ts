import { JSONObject } from "../JSON";
import MetricsViewConfig from "../Metrics/MetricsViewConfig";
import RollingTime from "../RollingTime/RollingTime";

/**
 * The kind of Ceph resource a metric series belongs to. Unlike Proxmox
 * there is no agent-stamped scope attribute — ceph-mgr series are already
 * equality-filterable by `ceph_daemon` / `pool_id` — so this enum is a
 * catalog/UI hint only, never a query filter.
 */
export enum CephResourceScope {
  Cluster = "Cluster",
  Mon = "Mon",
  Osd = "OSD",
  Pool = "Pool",
}

export interface CephResourceFilters {
  osdId?: string | undefined; // datapoint label `ceph_daemon` (e.g. "osd.3")
  /**
   * → equality on the `pool_id` datapoint label (e.g. "2"). Pool data
   * series (ceph_pool_stored, ceph_pool_max_avail, ceph_pool_rd/wr…)
   * carry ONLY `pool_id` — there is no pool-name label on data series;
   * the name exists solely on ceph_pool_metadata. Filter by id and join
   * ceph_pool_metadata when a display name is needed.
   */
  poolId?: string | undefined;
}

export default interface MonitorStepCephMonitor {
  clusterIdentifier: string;
  resourceFilters: CephResourceFilters;
  metricViewConfig: MetricsViewConfig;
  rollingTime: RollingTime;
}

export class MonitorStepCephMonitorUtil {
  public static getDefault(): MonitorStepCephMonitor {
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

  public static fromJSON(json: JSONObject): MonitorStepCephMonitor {
    return json as any as MonitorStepCephMonitor;
  }

  public static toJSON(monitor: MonitorStepCephMonitor): JSONObject {
    return monitor as any as JSONObject;
  }
}
