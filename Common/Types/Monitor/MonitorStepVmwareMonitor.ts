import MetricQueryConfigData from "../Metrics/MetricQueryConfigData";
import MetricsQuery from "../Metrics/MetricsQuery";
import { JSONObject } from "../JSON";
import MetricsViewConfig from "../Metrics/MetricsViewConfig";
import RollingTime from "../RollingTime/RollingTime";
import MonitorStepMetricMonitor, {
  MonitorStepMetricMonitorUtil,
} from "./MonitorStepMetricMonitor";

export enum VmwareResourceType {
  Host = "host",
  VM = "vm",
  Datastore = "datastore",
  Cluster = "cluster",
}

export const VMWARE_SOURCE_ATTRIBUTE: string =
  "resource.oneuptime.vmware.source.id";
export const VMWARE_RESOURCE_TYPE_ATTRIBUTE: string =
  "resource.oneuptime.vmware.resource.type";
export const VMWARE_RESOURCE_ATTRIBUTE: string =
  "resource.oneuptime.vmware.resource.id";
export const VMWARE_RESOURCE_GROUP_KEYS: Array<string> = [
  VMWARE_SOURCE_ATTRIBUTE,
  VMWARE_RESOURCE_TYPE_ATTRIBUTE,
  VMWARE_RESOURCE_ATTRIBUTE,
];

export interface VmwareResourceFilters {
  resourceType?: VmwareResourceType | undefined;
  resourceIdentifier?: string | undefined;
}

export default interface MonitorStepVmwareMonitor {
  sourceIdentifier: string;
  resourceFilters: VmwareResourceFilters;
  metricViewConfig: MetricsViewConfig;
  rollingTime: RollingTime;
}

export class MonitorStepVmwareMonitorUtil {
  public static getDefault(): MonitorStepVmwareMonitor {
    return {
      sourceIdentifier: "",
      resourceFilters: {},
      metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
      rollingTime: RollingTime.Past5Minutes,
    };
  }

  public static fromJSON(json: JSONObject): MonitorStepVmwareMonitor {
    const monitor: MonitorStepVmwareMonitor =
      json as unknown as MonitorStepVmwareMonitor;
    return {
      ...this.getDefault(),
      ...monitor,
      resourceFilters: monitor.resourceFilters || {},
      metricViewConfig:
        MonitorStepMetricMonitorUtil.getMetricViewConfig(monitor),
    };
  }

  public static toJSON(monitor: MonitorStepVmwareMonitor): JSONObject {
    return monitor as unknown as JSONObject;
  }

  public static isSourceMonitor(monitor: MonitorStepVmwareMonitor): boolean {
    return (
      monitor.metricViewConfig.queryConfigs.length > 0 &&
      monitor.metricViewConfig.queryConfigs.every(
        (query: MetricQueryConfigData) => {
          return (
            typeof query.metricQueryData.filterData.metricName === "string" &&
            query.metricQueryData.filterData.metricName.startsWith(
              "oneuptime.vmware.source.",
            )
          );
        },
      )
    );
  }

  /** Source scope and stable incident identity are enforced server-side, including API-created monitors. */
  public static toMetricMonitor(
    monitor: MonitorStepVmwareMonitor,
  ): MonitorStepMetricMonitor {
    const isSource: boolean = this.isSourceMonitor(monitor);
    return {
      rollingTime: monitor.rollingTime,
      metricViewConfig: {
        ...monitor.metricViewConfig,
        queryConfigs: monitor.metricViewConfig.queryConfigs.map(
          (query: MetricQueryConfigData) => {
            const attributes: MetricsQuery["attributes"] = {
              ...(query.metricQueryData.filterData
                .attributes as MetricsQuery["attributes"]),
            };
            delete attributes[VMWARE_SOURCE_ATTRIBUTE];
            delete attributes[VMWARE_RESOURCE_TYPE_ATTRIBUTE];
            delete attributes[VMWARE_RESOURCE_ATTRIBUTE];
            return {
              ...query,
              metricQueryData: {
                ...query.metricQueryData,
                groupByAttributeKeys: isSource
                  ? [VMWARE_SOURCE_ATTRIBUTE]
                  : [...VMWARE_RESOURCE_GROUP_KEYS],
                filterData: {
                  ...query.metricQueryData.filterData,
                  attributes: {
                    ...attributes,
                    [VMWARE_SOURCE_ATTRIBUTE]: monitor.sourceIdentifier,
                    ...(!isSource && monitor.resourceFilters.resourceType
                      ? {
                          [VMWARE_RESOURCE_TYPE_ATTRIBUTE]:
                            monitor.resourceFilters.resourceType,
                        }
                      : {}),
                    ...(!isSource && monitor.resourceFilters.resourceIdentifier
                      ? {
                          [VMWARE_RESOURCE_ATTRIBUTE]:
                            monitor.resourceFilters.resourceIdentifier,
                        }
                      : {}),
                  },
                },
              },
            };
          },
        ),
      },
    };
  }

  public static getValidationError(
    monitor: MonitorStepVmwareMonitor,
  ): string | undefined {
    if (
      typeof monitor.sourceIdentifier !== "string" ||
      !monitor.sourceIdentifier.trim() ||
      monitor.sourceIdentifier !== monitor.sourceIdentifier.trim()
    ) {
      return "A stable VMware source identifier is required";
    }
    const queries: Array<MetricQueryConfigData> =
      monitor.metricViewConfig?.queryConfigs;
    if (!Array.isArray(queries) || queries.length === 0) {
      return "Select at least one VMware metric";
    }
    if (
      queries.some((query: MetricQueryConfigData) => {
        return (
          typeof query?.metricQueryData?.filterData?.metricName !== "string" ||
          !query.metricQueryData.filterData.metricName.startsWith(
            "oneuptime.vmware.",
          )
        );
      })
    ) {
      return "VMware monitors require metrics from the OneUptime VMware Agent";
    }
    if (
      queries.some((query: MetricQueryConfigData) => {
        return (
          typeof query.metricQueryData.filterData.metricName === "string" &&
          query.metricQueryData.filterData.metricName.startsWith(
            "oneuptime.vmware.source.",
          )
        );
      }) &&
      !this.isSourceMonitor(monitor)
    ) {
      return "Collection health and resource metrics need separate VMware monitors";
    }
    if (
      monitor.resourceFilters?.resourceType &&
      !Object.values(VmwareResourceType).includes(
        monitor.resourceFilters.resourceType,
      )
    ) {
      return "Select a valid VMware resource type";
    }
    if (
      monitor.resourceFilters?.resourceIdentifier &&
      !monitor.resourceFilters.resourceType
    ) {
      return "Select a resource type when filtering a VMware resource ID";
    }
    return undefined;
  }
}
