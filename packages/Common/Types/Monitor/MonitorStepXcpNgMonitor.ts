import { JSONObject } from "../JSON";
import MetricsViewConfig from "../Metrics/MetricsViewConfig";
import RollingTime from "../RollingTime/RollingTime";
import { XcpNgScope } from "../XcpNg/XcpNgTelemetry";

/*
 * Which of a pool's objects a monitor reads. Every XCP-ng datapoint carries
 * `xcp_ng.scope` (pool | host | vm | sr | vdi | xostor) and `xcp_ng.id` (the
 * object's XAPI UUID), stamped at ingest (XcpNgSeriesNormalizer), so the
 * monitor worker maps these filters to attribute equality with no
 * translation, whichever of Xen Orchestra's labels named the object.
 */
export interface XcpNgResourceFilters {
  // -> equality on `xcp_ng.scope`.
  scope?: XcpNgScope | undefined;
  /*
   * -> equality on `xcp_ng.id`: one host's, VM's, storage repository's or
   * virtual disk's UUID. Pair with `scope` to read one object.
   */
  xcpNgId?: string | undefined;
  /*
   * -> equality on the `host_name` label: a host's own series and the
   * series of the VMs running on it (Xen Orchestra names a VM's host on
   * each of its metrics).
   */
  hostName?: string | undefined;
}

export default interface MonitorStepXcpNgMonitor {
  // The pool's XAPI UUID (XcpNgPool.poolIdentifier).
  poolIdentifier: string;
  /*
   * The pool's id. Bound on every write and read by the worker, so a
   * rename keeps the monitor on its pool (InfrastructureResourceBinding).
   */
  resourceId?: string | undefined;
  resourceFilters: XcpNgResourceFilters;
  metricViewConfig: MetricsViewConfig;
  rollingTime: RollingTime;
}

export class MonitorStepXcpNgMonitorUtil {
  public static getDefault(): MonitorStepXcpNgMonitor {
    return {
      poolIdentifier: "",
      resourceFilters: {},
      metricViewConfig: {
        queryConfigs: [],
        formulaConfigs: [],
      },
      rollingTime: RollingTime.Past1Minute,
    };
  }

  public static fromJSON(json: JSONObject): MonitorStepXcpNgMonitor {
    return json as any as MonitorStepXcpNgMonitor;
  }

  public static toJSON(monitor: MonitorStepXcpNgMonitor): JSONObject {
    return monitor as any as JSONObject;
  }
}
