import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import FilterCondition from "../Filter/FilterCondition";
import { CheckOn, FilterType, EvaluateOverTimeType } from "./CriteriaFilter";
import MonitorStepIoTMonitor from "./MonitorStepIoTMonitor";
import RollingTime from "../RollingTime/RollingTime";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";

export type IoTAlertTemplateCategory =
  | "Availability"
  | "Power"
  | "Connectivity"
  | "Environment"
  | "System";

export type IoTAlertTemplateSeverity = "Critical" | "Warning";

export interface IoTAlertTemplateArgs {
  fleetIdentifier: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

export interface IoTAlertTemplate {
  id: string;
  name: string;
  description: string;
  category: IoTAlertTemplateCategory;
  severity: IoTAlertTemplateSeverity;
  getMonitorStep: (args: IoTAlertTemplateArgs) => MonitorStep;
}

/*
 * Filter contract: IoT devices push OTel metrics that carry the `device.id`
 * datapoint label per device, plus the datapoint attributes `iot.scope`
 * (fleet | device), `iot.device.type` and `iot.device.kind`. Templates filter
 * on those attributes and group by the untouched `device.id` label so one
 * incident fires per device. All of these are datapoint attributes, so they
 * are NOT `resource.`-prefixed in ClickHouse.
 *
 * Title/description contract: because these templates group by `device.id`,
 * every incident/alert is rendered per breaching series and the series'
 * labels are exposed to the template engine (see
 * MonitorTemplateUtil.buildTemplateStorageMap). Titles and descriptions
 * embed `{{device.id}}` so ten breaching devices produce ten
 * device-identified incidents instead of ten identical static titles.
 */

export function buildIoTMonitorStep(args: {
  iotMonitor: MonitorStepIoTMonitor;
  offlineCriteriaInstance: MonitorCriteriaInstance;
  onlineCriteriaInstance: MonitorCriteriaInstance;
}): MonitorStep {
  const monitorStep: MonitorStep = new MonitorStep();

  const monitorCriteria: MonitorCriteria = new MonitorCriteria();

  monitorCriteria.data = {
    monitorCriteriaInstanceArray: [
      args.offlineCriteriaInstance,
      args.onlineCriteriaInstance,
    ],
  };

  monitorStep.data = {
    id: ObjectID.generate().toString(),
    monitorDestination: undefined,
    doNotFollowRedirects: undefined,
    monitorDestinationPort: undefined,
    monitorCriteria: monitorCriteria,
    requestType: "GET" as any,
    requestHeaders: undefined,
    requestBody: undefined,
    customCode: undefined,
    screenSizeTypes: undefined,
    browserTypes: undefined,
    retryCountOnError: undefined,
    logMonitor: undefined,
    traceMonitor: undefined,
    metricMonitor: undefined,
    exceptionMonitor: undefined,
    snmpMonitor: undefined,
    dnsMonitor: undefined,
    domainMonitor: undefined,
    externalStatusPageMonitor: undefined,
    kubernetesMonitor: undefined,
    profileMonitor: undefined,
    dockerMonitor: undefined,
    iotMonitor: args.iotMonitor,
  };

  return monitorStep;
}

export function buildIoTOfflineCriteriaInstance(args: {
  offlineMonitorStatusId: ObjectID;
  incidentSeverityId: ObjectID;
  alertSeverityId: ObjectID;
  monitorName: string;
  metricAlias: string;
  filterType: FilterType;
  value: number;
  incidentTitle?: string;
  incidentDescription?: string;
  criteriaName?: string;
  criteriaDescription?: string;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  const incidentTitle: string =
    args.incidentTitle || `${args.monitorName} - Alert Triggered`;
  const incidentDescription: string =
    args.incidentDescription ||
    `${args.monitorName} has triggered an alert condition. See root cause for detailed IoT device information.`;

  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: args.offlineMonitorStatusId,
    filterCondition: FilterCondition.Any,
    filters: [
      {
        checkOn: CheckOn.MetricValue,
        filterType: args.filterType,
        metricMonitorOptions: {
          metricAggregationType: EvaluateOverTimeType.AnyValue,
          metricAlias: args.metricAlias,
        },
        value: args.value,
      },
    ],
    incidents: [
      {
        title: incidentTitle,
        description: incidentDescription,
        incidentSeverityId: args.incidentSeverityId,
        autoResolveIncident: true,
        id: ObjectID.generate().toString(),
        onCallPolicyIds: [],
      },
    ],
    alerts: [
      {
        title: incidentTitle,
        description: incidentDescription,
        alertSeverityId: args.alertSeverityId,
        autoResolveAlert: true,
        id: ObjectID.generate().toString(),
        onCallPolicyIds: [],
      },
    ],
    changeMonitorStatus: true,
    createIncidents: true,
    createAlerts: true,
    name: args.criteriaName || `${args.monitorName} - Unhealthy`,
    description:
      args.criteriaDescription || `Criteria for detecting unhealthy state.`,
  };

  return instance;
}

export function buildIoTOnlineCriteriaInstance(args: {
  onlineMonitorStatusId: ObjectID;
  metricAlias: string;
  filterType: FilterType;
  value: number;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: args.onlineMonitorStatusId,
    filterCondition: FilterCondition.Any,
    filters: [
      {
        checkOn: CheckOn.MetricValue,
        filterType: args.filterType,
        metricMonitorOptions: {
          metricAggregationType: EvaluateOverTimeType.AnyValue,
          metricAlias: args.metricAlias,
        },
        value: args.value,
      },
    ],
    incidents: [],
    alerts: [],
    changeMonitorStatus: true,
    createIncidents: false,
    createAlerts: false,
    name: "Healthy",
    description: "Criteria for healthy state.",
  };

  return instance;
}

export function buildIoTMonitorConfig(args: {
  fleetIdentifier: string;
  metricName: string;
  metricAlias: string;
  rollingTime: RollingTime;
  aggregationType: MetricsAggregationType;
  attributes?: Record<string, string>;
  groupByAttributeKey?: string | undefined;
}): MonitorStepIoTMonitor {
  return {
    fleetIdentifier: args.fleetIdentifier,
    resourceFilters: {},
    metricViewConfig: {
      queryConfigs: [
        {
          metricAliasData: {
            metricVariable: args.metricAlias,
            title: args.metricAlias,
            description: args.metricAlias,
            legend: args.metricAlias,
            legendUnit: undefined,
          },
          metricQueryData: {
            filterData: {
              metricName: args.metricName,
              attributes: args.attributes || {},
              aggegationType: args.aggregationType,
              aggregateBy: {},
            },
            ...(args.groupByAttributeKey
              ? { groupByAttributeKeys: [args.groupByAttributeKey] }
              : {}),
          },
        },
      ],
      formulaConfigs: [],
    },
    rollingTime: args.rollingTime,
  };
}

/**
 * Build a ratio monitor: `(numerator / denominator) * 100`, optionally
 * grouped by an OpenTelemetry attribute so one incident fires per group
 * (e.g. per `device.id` = per device).
 *
 * Aggregation contract (see buildKubernetesRatioMonitorConfig for the full
 * derivation): the per-series worker buckets raw rows by (group, minute)
 * and applies the aggregation across both the grouped series AND the
 * scrapes in that minute. `Sum` is only correct when numerator and
 * denominator ride the SAME receiver/scrape so the scrape multiple
 * cancels: `(Σnum × scrapes) / (Σden × scrapes)`. Every IoT metric for a
 * device comes from ONE push from that device — so all IoT ratios are
 * same-receiver and default to `Sum`/`Sum`. (`Avg`/`Avg` is the
 * cross-receiver variant; not needed here.)
 *
 * `attributes` is applied to BOTH queries — the device stamps `iot.scope` /
 * `iot.device.type` on every series of a push (including the *_info metadata
 * series, which also carry `device.id`), so a shared equality filter is safe.
 */
export function buildIoTRatioMonitorConfig(args: {
  fleetIdentifier: string;
  numeratorMetricName: string;
  denominatorMetricName: string;
  numeratorAlias: string;
  denominatorAlias: string;
  resultAlias: string;
  resultLegend: string;
  rollingTime: RollingTime;
  attributes?: Record<string, string> | undefined;
  groupByAttributeKey?: string | undefined;
  aggregationType?: MetricsAggregationType | undefined;
}): MonitorStepIoTMonitor {
  const aggregationType: MetricsAggregationType =
    args.aggregationType || MetricsAggregationType.Sum;

  const buildQueryConfig: (alias: string, metricName: string) => any = (
    alias: string,
    metricName: string,
  ): any => {
    return {
      metricAliasData: {
        metricVariable: alias,
        title: alias,
        description: alias,
        legend: alias,
        legendUnit: undefined,
      },
      metricQueryData: {
        filterData: {
          metricName: metricName,
          attributes: args.attributes || {},
          aggegationType: aggregationType,
          aggregateBy: {},
        },
        ...(args.groupByAttributeKey
          ? { groupByAttributeKeys: [args.groupByAttributeKey] }
          : {}),
      },
    };
  };

  return {
    fleetIdentifier: args.fleetIdentifier,
    resourceFilters: {},
    metricViewConfig: {
      queryConfigs: [
        buildQueryConfig(args.numeratorAlias, args.numeratorMetricName),
        buildQueryConfig(args.denominatorAlias, args.denominatorMetricName),
      ],
      formulaConfigs: [
        {
          metricAliasData: {
            metricVariable: args.resultAlias,
            title: args.resultLegend,
            description: args.resultLegend,
            legend: args.resultLegend,
            legendUnit: "%",
          },
          metricFormulaData: {
            metricFormula: `(${args.numeratorAlias} / ${args.denominatorAlias}) * 100`,
          },
        },
      ],
    },
    rollingTime: args.rollingTime,
  };
}

// --- Template Definitions ---

const deviceOfflineTemplate: IoTAlertTemplate = {
  id: "iot-device-offline",
  name: "Device Offline",
  description:
    "Alert when any IoT device reports as down (iot_device_up = 0). One incident per device, grouped by device.id.",
  category: "Availability",
  severity: "Critical",
  getMonitorStep: (args: IoTAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "device_up";

    return buildIoTMonitorStep({
      iotMonitor: buildIoTMonitorConfig({
        fleetIdentifier: args.fleetIdentifier,
        metricName: "iot_device_up",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Min per device — a single down push trips the threshold instead
         * of being masked by pushes where the device was still up.
         */
        aggregationType: MetricsAggregationType.Min,
        attributes: {},
        groupByAttributeKey: "device.id",
      }),
      offlineCriteriaInstance: buildIoTOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.LessThan,
        value: 1,
        incidentTitle: `[IoT] Device Offline - {{device.id}} - ${args.monitorName}`,
        incidentDescription: `IoT device {{device.id}} is reporting as down (iot_device_up = 0). The device is unreachable, powered off, or has lost connectivity to its gateway. Verify the device's power and network state, and confirm its gateway is forwarding telemetry. See the root cause for fleet and device details.`,
        criteriaName: "Device Offline - iot_device_up < 1",
        criteriaDescription:
          "Triggers when any device reports iot_device_up below 1 over the monitoring window.",
      }),
      onlineCriteriaInstance: buildIoTOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 1,
      }),
    });
  },
};

const lowBatteryTemplate: IoTAlertTemplate = {
  id: "iot-low-battery",
  name: "Low Battery",
  description:
    "Alert when any IoT device's battery level drops below 20% (iot_battery_percent < 20). One incident per device, grouped by device.id.",
  category: "Power",
  severity: "Warning",
  getMonitorStep: (args: IoTAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "battery_percent";

    return buildIoTMonitorStep({
      iotMonitor: buildIoTMonitorConfig({
        fleetIdentifier: args.fleetIdentifier,
        metricName: "iot_battery_percent",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Avg per device — battery percentage is a slow-moving level, so
         * the per-minute average is the representative reading regardless
         * of push count.
         */
        aggregationType: MetricsAggregationType.Avg,
        attributes: {},
        groupByAttributeKey: "device.id",
      }),
      offlineCriteriaInstance: buildIoTOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.LessThan,
        value: 20,
        incidentTitle: `[IoT] Low Battery (<20%) - {{device.id}} - ${args.monitorName}`,
        incidentDescription: `IoT device {{device.id}}'s battery has dropped below 20%. The device will stop reporting once its battery is exhausted. Replace or recharge its battery before it dies. See the root cause for fleet and device details.`,
        criteriaName: "Low Battery - iot_battery_percent < 20",
        criteriaDescription:
          "Triggers when any device's battery level drops below 20% over the monitoring window.",
      }),
      onlineCriteriaInstance: buildIoTOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 20,
      }),
    });
  },
};

const weakSignalTemplate: IoTAlertTemplate = {
  id: "iot-weak-signal",
  name: "Weak Signal",
  description:
    "Alert when any IoT device's signal strength drops below -100 dBm (iot_signal_strength_dbm < -100). One incident per device, grouped by device.id.",
  category: "Connectivity",
  severity: "Warning",
  getMonitorStep: (args: IoTAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "signal_strength";

    return buildIoTMonitorStep({
      iotMonitor: buildIoTMonitorConfig({
        fleetIdentifier: args.fleetIdentifier,
        metricName: "iot_signal_strength_dbm",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Avg per device — signal strength (dBm) is a level reading, so
         * the per-minute average is the representative value regardless
         * of push count.
         */
        aggregationType: MetricsAggregationType.Avg,
        attributes: {},
        groupByAttributeKey: "device.id",
      }),
      offlineCriteriaInstance: buildIoTOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.LessThan,
        value: -100,
        incidentTitle: `[IoT] Weak Signal (<-100 dBm) - {{device.id}} - ${args.monitorName}`,
        incidentDescription: `IoT device {{device.id}}'s radio signal strength has dropped below -100 dBm. A weak signal causes dropped telemetry and intermittent connectivity. Verify the device's proximity to the gateway, check for interference, or reposition the device or gateway. See the root cause for fleet and device details.`,
        criteriaName: "Weak Signal - iot_signal_strength_dbm < -100",
        criteriaDescription:
          "Triggers when any device's signal strength drops below -100 dBm over the monitoring window.",
      }),
      onlineCriteriaInstance: buildIoTOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: -100,
      }),
    });
  },
};

const highTemperatureTemplate: IoTAlertTemplate = {
  id: "iot-high-temperature",
  name: "High Temperature",
  description:
    "Alert when any IoT device's temperature exceeds 70°C (iot_temperature_celsius > 70). One incident per device, grouped by device.id.",
  category: "Environment",
  severity: "Critical",
  getMonitorStep: (args: IoTAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "temperature_celsius";

    return buildIoTMonitorStep({
      iotMonitor: buildIoTMonitorConfig({
        fleetIdentifier: args.fleetIdentifier,
        metricName: "iot_temperature_celsius",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Max per device — a single hot reading should trip the threshold
         * instead of being masked by cooler readings in the same minute.
         */
        aggregationType: MetricsAggregationType.Max,
        attributes: {},
        groupByAttributeKey: "device.id",
      }),
      offlineCriteriaInstance: buildIoTOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 70,
        incidentTitle: `[IoT] High Temperature (>70°C) - {{device.id}} - ${args.monitorName}`,
        incidentDescription: `IoT device {{device.id}} is reporting a temperature above 70°C. Overheating can damage the device, shorten battery life, and corrupt readings. Verify ventilation, ambient conditions, and the device's workload. See the root cause for fleet and device details.`,
        criteriaName: "High Temperature - iot_temperature_celsius > 70",
        criteriaDescription:
          "Triggers when any device's temperature exceeds 70°C over the monitoring window.",
      }),
      onlineCriteriaInstance: buildIoTOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 70,
      }),
    });
  },
};

const highCpuTemplate: IoTAlertTemplate = {
  id: "iot-high-cpu",
  name: "High CPU Usage",
  description:
    "Alert when any IoT device's CPU usage exceeds 90% (iot_cpu_usage_ratio > 0.9). One incident per device, grouped by device.id.",
  category: "System",
  severity: "Warning",
  getMonitorStep: (args: IoTAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "cpu_usage";

    return buildIoTMonitorStep({
      iotMonitor: buildIoTMonitorConfig({
        fleetIdentifier: args.fleetIdentifier,
        metricName: "iot_cpu_usage_ratio",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Avg per device — iot_cpu_usage_ratio is already a true 0-1 ratio
         * (one series per device), so the per-minute average is the
         * sustained utilization regardless of push count.
         */
        aggregationType: MetricsAggregationType.Avg,
        attributes: {},
        groupByAttributeKey: "device.id",
      }),
      offlineCriteriaInstance: buildIoTOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0.9,
        incidentTitle: `[IoT] High CPU Usage (>90%) - {{device.id}} - ${args.monitorName}`,
        incidentDescription: `IoT device {{device.id}}'s CPU usage has exceeded 90% of its capacity. Sustained high CPU can delay telemetry, drain the battery faster, and cause the device to become unresponsive. Investigate the workload running on the device. See the root cause for fleet and device details.`,
        criteriaName: "High CPU - iot_cpu_usage_ratio > 0.9",
        criteriaDescription:
          "Triggers when any device's average CPU usage ratio exceeds 0.9 over the monitoring window.",
      }),
      onlineCriteriaInstance: buildIoTOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 0.9,
      }),
    });
  },
};

export function getAllIoTAlertTemplates(): Array<IoTAlertTemplate> {
  return [
    deviceOfflineTemplate,
    lowBatteryTemplate,
    weakSignalTemplate,
    highTemperatureTemplate,
    highCpuTemplate,
  ];
}

export function getIoTAlertTemplatesByCategory(
  category: IoTAlertTemplateCategory,
): Array<IoTAlertTemplate> {
  return getAllIoTAlertTemplates().filter((template: IoTAlertTemplate) => {
    return template.category === category;
  });
}

export function getIoTAlertTemplateById(
  id: string,
): IoTAlertTemplate | undefined {
  return getAllIoTAlertTemplates().find((template: IoTAlertTemplate) => {
    return template.id === id;
  });
}
