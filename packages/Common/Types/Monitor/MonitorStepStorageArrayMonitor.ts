import { JSONObject } from "../JSON";
import MetricsViewConfig from "../Metrics/MetricsViewConfig";
import RollingTime from "../RollingTime/RollingTime";

/**
 * The kind of storage array object a metric series belongs to. Like Ceph,
 * there is no agent-stamped scope attribute — the arrays' series are
 * already equality-filterable by their own datapoint labels (`name`,
 * `host`, `component_name`) — so this enum is a catalog/UI hint only,
 * never a query filter.
 */
export enum StorageArrayResourceScope {
  Array = "Array",
  Volume = "Volume",
  Host = "Host",
  Pod = "Pod",
  Hardware = "Hardware",
  FileSystem = "File System",
  Bucket = "Bucket",
}

/*
 * Optional narrowing of a storage array monitor to one object. Each filter
 * becomes an equality filter on the datapoint label the platform uses for
 * that object (see StorageArrayMetricCatalog.getResourceFilterLabel):
 * FlashArray volumes, pods and directories carry `name`, hosts carry
 * `host`, hardware carries `component_name`; FlashBlade file systems,
 * buckets and hardware carry `name`.
 */
export interface StorageArrayResourceFilters {
  volumeName?: string | undefined;
  hostName?: string | undefined;
  podName?: string | undefined;
  componentName?: string | undefined;
  fileSystemName?: string | undefined;
  bucketName?: string | undefined;
}

export default interface MonitorStepStorageArrayMonitor {
  // StorageArray.name — the `storage.array.name` resource attribute.
  arrayIdentifier: string;
  /*
   * The platform of the array when the monitor was configured
   * (StorageArray.storageSystem). Picks the metric catalog and templates in
   * the form; evaluation never depends on it.
   */
  storageSystem?: string | undefined;
  resourceFilters: StorageArrayResourceFilters;
  metricViewConfig: MetricsViewConfig;
  rollingTime: RollingTime;
}

export class MonitorStepStorageArrayMonitorUtil {
  public static getDefault(): MonitorStepStorageArrayMonitor {
    return {
      arrayIdentifier: "",
      storageSystem: undefined,
      resourceFilters: {},
      metricViewConfig: {
        queryConfigs: [],
        formulaConfigs: [],
      },
      rollingTime: RollingTime.Past1Minute,
    };
  }

  public static fromJSON(json: JSONObject): MonitorStepStorageArrayMonitor {
    return json as any as MonitorStepStorageArrayMonitor;
  }

  public static toJSON(monitor: MonitorStepStorageArrayMonitor): JSONObject {
    return monitor as any as JSONObject;
  }
}
