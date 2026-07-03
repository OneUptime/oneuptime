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
  | "System"
  | "Fleet Health";

export type IoTAlertTemplateSeverity = "Critical" | "Warning";

export interface IoTAlertTemplateArgs {
  fleetIdentifier: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
  /*
   * On-call policies to attach to the template's incident/alert
   * criteria. Sourced from the fleet's default on-call policy so
   * template-created monitors page someone out of the box instead of
   * silently defaulting to nobody.
   */
  onCallPolicyIds?: Array<ObjectID> | undefined;
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
 *
 * Fleet rollup contract: a per-minute worker emits fleet-level rollup
 * series to ClickHouse — one datapoint per fleet per minute — carrying
 * the attributes `resource.iot.fleet.name` (fleet name), `iot.scope` =
 * "fleet" and `oneuptime.synthetic` = "fleet-rollup". The series are
 * iot_fleet_device_count, iot_fleet_online_count, iot_fleet_offline_count,
 * iot_fleet_stale_count, iot_fleet_online_ratio (0..1; emitted only when
 * device_count > 0), iot_fleet_battery_percent_p50 /
 * iot_fleet_battery_percent_p10 (only when fresh battery readings exist)
 * and iot_fleet_weak_signal_count (fresh readings < -100 dBm). "Fleet
 * Health" templates evaluate these series: they must NOT group by
 * `device.id` (the rollups carry no per-device identity — a group-by
 * would just fingerprint every datapoint into one anonymous bucket) so
 * the worker's collectGroupByAttributeKeys returns [] and the monitor
 * evaluates ONE series per fleet. Titles reference the monitor/fleet
 * name, never `{{device.id}}`. Emission gaps (empty fleet, no fresh
 * battery readings) are covered by the default Ignore no-data policy:
 * absent rollup datapoints match no criteria, so the monitor holds state
 * instead of flapping.
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
  onCallPolicyIds?: Array<ObjectID> | undefined;
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
        onCallPolicyIds: args.onCallPolicyIds || [],
      },
    ],
    alerts: [
      {
        title: incidentTitle,
        description: incidentDescription,
        alertSeverityId: args.alertSeverityId,
        autoResolveAlert: true,
        id: ObjectID.generate().toString(),
        onCallPolicyIds: args.onCallPolicyIds || [],
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
        onCallPolicyIds: args.onCallPolicyIds,
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
        onCallPolicyIds: args.onCallPolicyIds,
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
        onCallPolicyIds: args.onCallPolicyIds,
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
        onCallPolicyIds: args.onCallPolicyIds,
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
        onCallPolicyIds: args.onCallPolicyIds,
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

const highMemoryPressureTemplate: IoTAlertTemplate = {
  id: "iot-high-memory",
  name: "High Memory Pressure",
  description:
    "Alert when any IoT device's memory usage exceeds 90% of its total memory ((iot_memory_usage_bytes / iot_memory_size_bytes) * 100 > 90). One incident per device, grouped by device.id.",
  category: "System",
  severity: "Warning",
  getMonitorStep: (args: IoTAlertTemplateArgs): MonitorStep => {
    const resultAlias: string = "memory_usage_percent";

    return buildIoTMonitorStep({
      iotMonitor: buildIoTRatioMonitorConfig({
        fleetIdentifier: args.fleetIdentifier,
        numeratorMetricName: "iot_memory_usage_bytes",
        denominatorMetricName: "iot_memory_size_bytes",
        numeratorAlias: "memory_usage_bytes",
        denominatorAlias: "memory_size_bytes",
        resultAlias,
        resultLegend: "Memory Usage %",
        rollingTime: RollingTime.Past5Minutes,
        attributes: {},
        groupByAttributeKey: "device.id",
        /*
         * Avg per device — usage and size ride the SAME push from the
         * device, so Avg/Avg and the builder's default Sum/Sum yield the
         * identical ratio (the push-count multiple cancels either way).
         * Avg is chosen so each intermediate series stays a meaningful
         * per-minute level reading, matching the other level templates.
         */
        aggregationType: MetricsAggregationType.Avg,
      }),
      offlineCriteriaInstance: buildIoTOfflineCriteriaInstance({
        onCallPolicyIds: args.onCallPolicyIds,
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias: resultAlias,
        filterType: FilterType.GreaterThan,
        value: 90,
        incidentTitle: `[IoT] High Memory Pressure (>90%) - {{device.id}} - ${args.monitorName}`,
        incidentDescription: `IoT device {{device.id}} is using more than 90% of its total memory ((iot_memory_usage_bytes / iot_memory_size_bytes) * 100 > 90). Sustained memory pressure leads to allocation failures, watchdog resets, and dropped telemetry. Investigate the workload on the device or consider hardware with more memory. See the root cause for fleet and device details.`,
        criteriaName:
          "High Memory Pressure - (iot_memory_usage_bytes / iot_memory_size_bytes) * 100 > 90",
        criteriaDescription:
          "Triggers when any device's memory usage exceeds 90% of its total memory over the monitoring window.",
      }),
      onlineCriteriaInstance: buildIoTOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias: resultAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 90,
      }),
    });
  },
};

/*
 * Fleet Health templates evaluate the server-computed per-minute rollup
 * series (see the fleet rollup contract above). Single series per fleet:
 * NO device.id group-by, and titles reference the monitor/fleet name
 * instead of {{device.id}}.
 */

const fleetOfflineRatioTemplate: IoTAlertTemplate = {
  id: "iot-fleet-offline-ratio",
  name: "Fleet Offline Ratio High",
  description:
    "Alert when more than 10% of the fleet is offline (iot_fleet_online_ratio < 0.9). Evaluates the server-computed per-minute fleet rollup — one incident per fleet, not per device.",
  category: "Fleet Health",
  severity: "Critical",
  getMonitorStep: (args: IoTAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "fleet_online_ratio";

    return buildIoTMonitorStep({
      iotMonitor: buildIoTMonitorConfig({
        fleetIdentifier: args.fleetIdentifier,
        metricName: "iot_fleet_online_ratio",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Avg over the window — the rollup worker emits ONE datapoint per
         * fleet per minute, so the average over Past5Minutes is the
         * sustained online ratio; a single noisy minute won't flap the
         * monitor. No group-by: the rollup carries no per-device identity.
         */
        aggregationType: MetricsAggregationType.Avg,
        attributes: {},
      }),
      offlineCriteriaInstance: buildIoTOfflineCriteriaInstance({
        onCallPolicyIds: args.onCallPolicyIds,
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.LessThan,
        value: 0.9,
        incidentTitle: `[IoT] Fleet Offline Ratio High (>10% offline) - ${args.monitorName}`,
        incidentDescription: `More than 10% of the IoT fleet monitored by ${args.monitorName} is offline (iot_fleet_online_ratio < 0.9). A fleet-wide availability drop usually points at shared infrastructure — a gateway, network segment, or power domain — rather than individual devices. Check the fleet's gateway and connectivity first. See the root cause for fleet details.`,
        criteriaName: "Fleet Offline Ratio High - iot_fleet_online_ratio < 0.9",
        criteriaDescription:
          "Triggers when the fleet's online ratio drops below 0.9 (more than 10% of active devices offline) over the monitoring window.",
      }),
      onlineCriteriaInstance: buildIoTOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 0.9,
      }),
    });
  },
};

const fleetBatteryLowTemplate: IoTAlertTemplate = {
  id: "iot-fleet-battery-low",
  name: "Fleet Battery Low",
  description:
    "Alert when the fleet's bottom-decile battery level drops below 20% (iot_fleet_battery_percent_p10 < 20). Evaluates the server-computed per-minute fleet rollup — one incident per fleet, not per device.",
  category: "Fleet Health",
  severity: "Warning",
  getMonitorStep: (args: IoTAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "fleet_battery_p10";

    return buildIoTMonitorStep({
      iotMonitor: buildIoTMonitorConfig({
        fleetIdentifier: args.fleetIdentifier,
        metricName: "iot_fleet_battery_percent_p10",
        metricAlias,
        rollingTime: RollingTime.Past15Minutes,
        /*
         * Avg over a longer Past15Minutes window — battery percentiles
         * move slowly, and the p10 series is only emitted while fresh
         * battery readings exist, so a wider window rides out emission
         * gaps. No group-by: the rollup carries no per-device identity.
         */
        aggregationType: MetricsAggregationType.Avg,
        attributes: {},
      }),
      offlineCriteriaInstance: buildIoTOfflineCriteriaInstance({
        onCallPolicyIds: args.onCallPolicyIds,
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.LessThan,
        value: 20,
        incidentTitle: `[IoT] Fleet Battery Low (p10 <20%) - ${args.monitorName}`,
        incidentDescription: `The bottom 10% of devices in the IoT fleet monitored by ${args.monitorName} report battery below 20% (iot_fleet_battery_percent_p10 < 20). A sinking bottom decile means a batch of devices will start dying soon — plan a battery replacement or recharge round before they drop offline. See the root cause for fleet details.`,
        criteriaName:
          "Fleet Battery Low - iot_fleet_battery_percent_p10 < 20",
        criteriaDescription:
          "Triggers when the fleet's 10th-percentile battery level drops below 20% over the monitoring window.",
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

export function getAllIoTAlertTemplates(): Array<IoTAlertTemplate> {
  return [
    deviceOfflineTemplate,
    lowBatteryTemplate,
    weakSignalTemplate,
    highTemperatureTemplate,
    highCpuTemplate,
    highMemoryPressureTemplate,
    fleetOfflineRatioTemplate,
    fleetBatteryLowTemplate,
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
