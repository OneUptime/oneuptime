import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import {
  buildHealthyCriteriaInstance,
  buildUnhealthyCriteriaInstance,
} from "./Recommendation/RecommendationCriteriaBuilder";
import { FilterType, EvaluateOverTimeType } from "./CriteriaFilter";
import MonitorStepIoTMonitor from "./MonitorStepIoTMonitor";
import RollingTime from "../RollingTime/RollingTime";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import { getIoTMetricByMetricName } from "./IotMetricCatalog";

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
  metricAggregationType?: EvaluateOverTimeType | undefined;
  /*
   * A device that has stopped reporting emits no series at all, so the
   * offline comparison has to count absence as zero rather than skip.
   */
  treatNoDataAsZero?: boolean | undefined;
}): MonitorCriteriaInstance {
  return buildUnhealthyCriteriaInstance({
    ...args,
    resourceNoun: "device",
  });
}

export function buildIoTOnlineCriteriaInstance(args: {
  onlineMonitorStatusId: ObjectID;
  metricAlias: string;
  filterType: FilterType;
  value: number;
  recoveryValue?: number | undefined;
  marginFraction?: number | undefined;
  isBinaryMetric?: boolean | undefined;
  metricAggregationType?: EvaluateOverTimeType | undefined;
}): MonitorCriteriaInstance {
  return buildHealthyCriteriaInstance(args);
}

export function buildIoTMonitorConfig(args: {
  fleetIdentifier: string;
  metricName: string;
  metricAlias: string;
  rollingTime: RollingTime;
  aggregationType: MetricsAggregationType;
  attributes?: Record<string, string>;
  groupByAttributeKey?: string | undefined;
  /*
   * Display unit for the series. Defaults to the unit IotMetricCatalog
   * already declares for `metricName`, which every template was throwing
   * away: MetricMonitorCriteria uses this as the sample unit AND (absent an
   * explicit thresholdUnit) as the threshold unit, so without it a root
   * cause reads "is -103.2 which is less than -100" instead of "is -103.2
   * dBm which is less than -100 dBm". The IoT device-detail charts already
   * label these same metrics "%", "dBm" and "°C".
   *
   * Safe against silent rescaling: setting a display unit enables
   * MetricResultUnitConverter, but "dBm", "°C" and "ratio" belong to no
   * MetricUnitUtil family and are passed through untouched. The only
   * convertible catalog units are "%", "bytes" and "s", and there the
   * conversion is the correction — a device declaring the dimensionless "1"
   * and sending a 0-1 battery fraction currently satisfies "< 20" forever.
   */
  legendUnit?: string | undefined;
}): MonitorStepIoTMonitor {
  const legendUnit: string | undefined =
    args.legendUnit ?? getIoTMetricByMetricName(args.metricName)?.unit;

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
            legendUnit: legendUnit,
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
        /*
         * This window is the SILENCE GRACE PERIOD, not the detection
         * latency.
         *
         * A registered device that emits nothing gets a synthetic empty
         * series (IoTDeviceAbsenceSeries, seeded by
         * MonitorTelemetryMonitor.injectExpectedAbsentIoTDeviceSeries from
         * the enabled IoTDeviceCredential rows, with no recency aging), and
         * TreatAsZero folds that to 0 and trips `< 1`. Crucially the empty
         * case reaches the comparator as a SCALAR — MetricMonitorCriteria
         * passes `0`, not `[0]`, and CompareCriteria short-circuits a scalar
         * before any quantifier — so sustained evaluation gives absence no
         * protection and the window length is the only knob there is.
         *
         * At five minutes, every device whose push interval exceeded the
         * window was declared Offline in every window it skipped and
         * resolved in the window it pushed. Thirty minutes is twice the
         * fifteen the inventory already allows a device to be silent
         * (IoTDeviceService.getStaleThresholdMinutes), which covers duty
         * cycles up to roughly a quarter hour. A device that reports less
         * often than that still needs a hand-widened window or a disabled
         * credential — a fleet-wide template cannot know its interval.
         *
         * The cost is that silent-death alerting now lags the inventory's
         * Down flip by about fifteen minutes. Detection of a device that
         * explicitly reports down is unaffected — see the AnyValue note on
         * the firing filter below.
         */
        rollingTime: RollingTime.Past30Minutes,
        /*
         * Min per device — a single down push in a minute wins over pushes
         * where the device was still up.
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
        /*
         * The documented exception to SustainedEvaluation, because this
         * signal is an EVENT and not a level: `iot_device_up = 0` is the
         * device — or its broker's MQTT Last Will — explicitly declaring
         * itself down. A binary heartbeat has no scrape-to-scrape jitter to
         * smooth away, and requiring AllValues over a thirty-minute window
         * would delay the Last Will path (documented as detection with "no
         * polling, no missed-scrape delay") by that whole window.
         *
         * Still mutually exclusive with the healthy criteria, but only
         * because that side opts OUT of the recovery dead band
         * (`isBinaryMetric: true` below — the metric is boolean). With the
         * opt-out, "some value < 1" over a non-empty window is the exact
         * negation of "all values >= 1"; without it the healthy side
         * recovers at 1.1 and this claim is false, so the two must move
         * together. On the absence path only this side carries a no-data
         * policy, so only this side can match.
         */
        metricAggregationType: EvaluateOverTimeType.AnyValue,
        incidentTitle: `[IoT] Device Offline - ${args.monitorName}`,
        incidentDescription: `An IoT device is reporting as down (iot_device_up = 0) or has stopped reporting entirely. The device is unreachable, powered off, or has lost connectivity to its gateway. Check the root cause for the affected device id, verify the device's power and network state, and confirm its gateway is forwarding telemetry.`,
        criteriaName: "Device Offline - iot_device_up < 1",
        criteriaDescription:
          "Triggers when any device reports iot_device_up below 1, or when a registered device stays silent for the whole 30-minute window.",
        treatNoDataAsZero: true,
      }),
      onlineCriteriaInstance: buildIoTOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 1,
        /*
         * `iot_device_up` is strictly 0 or 1, so the shared 10% recovery dead band
         * would put this at `>= 1.1` — unreachable, leaving the monitor
         * permanently unable to report healthy.
         */
        isBinaryMetric: true,
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
        incidentTitle: `[IoT] Low Battery (<20%) - ${args.monitorName}`,
        incidentDescription: `An IoT device's battery has dropped below 20%. The device will stop reporting once its battery is exhausted. Check the root cause for the affected device id, then replace or recharge its battery before it dies.`,
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
        incidentTitle: `[IoT] Weak Signal (<-100 dBm) - ${args.monitorName}`,
        incidentDescription: `An IoT device's radio signal strength has dropped below -100 dBm. A weak signal causes dropped telemetry and intermittent connectivity. Check the root cause for the affected device id, then verify its proximity to the gateway, check for interference, or reposition the device or gateway.`,
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
         * Max per device, deliberately overriding the catalog's declared
         * Avg default (IotMetricCatalog: iot-temperature) — a hot reading
         * must not be masked by cooler readings in the SAME MINUTE.
         *
         * This is a per-minute reducer only. The criteria then quantifies
         * across the minutes with the sustained default, so the condition is
         * "the peak reading in every minute of the window exceeded 70°C",
         * not "one sample anywhere spiked". A single hot reading does not
         * page.
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
        incidentTitle: `[IoT] High Temperature (>70°C) - ${args.monitorName}`,
        incidentDescription: `An IoT device is reporting a temperature above 70°C. Overheating can damage the device, shorten battery life, and corrupt readings. Check the root cause for the affected device id, then verify ventilation, ambient conditions, and the device's workload.`,
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
        /*
         * A raw 0-1 ratio, not a percentage — IoTSnapshotScan scales it to
         * percent only for the device inventory column, never for the stored
         * metric. 0.9 IS 90%, but the criteria compares 0.9 and the root
         * cause prints "0.94 ratio", so the title says ratio too.
         */
        value: 0.9,
        incidentTitle: `[IoT] High CPU Usage (ratio >0.9) - ${args.monitorName}`,
        incidentDescription: `An IoT device's CPU usage has exceeded 90% of its capacity. Sustained high CPU can delay telemetry, drain the battery faster, and cause the device to become unresponsive. Check the root cause for the affected device id, then investigate the workload running on the device.`,
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
