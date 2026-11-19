import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import { EvaluateOverTimeType, FilterType } from "./CriteriaFilter";
import MonitorType from "./MonitorType";
import MonitorStepMetricMonitor from "./MonitorStepMetricMonitor";
import RollingTime from "../RollingTime/RollingTime";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import {
  MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME,
  MANAGED_DEVICE_CHECK_IN_AGE_UNIT,
  ManagedDeviceCheckInAttribute,
} from "../DeviceManagement/ManagedDeviceCheckIn";
import {
  buildHealthyCriteriaInstance,
  buildUnhealthyCriteriaInstance,
} from "./Recommendation/RecommendationCriteriaBuilder";

/*
 * The curated alert library for ONE device management connection (a
 * DeviceManagementConnection row: an Esper tenant, #9835): Metrics monitors
 * over the readings each read of the connection writes for its devices
 * (ManagedDeviceCheckIn), filtered on the connection's id, so one monitor
 * watches every device the connection imports - one enrolled next week
 * too - and alerts once per device.
 *
 * "Esper Device Stopped Checking In" fires when a device has not checked in
 * with Esper for more than an hour:
 *
 *   - AN HOUR, for a kiosk fleet. Esper itself calls a device offline 30
 *     minutes after its last check-in, and so do the Managed Devices list
 *     and the device's card; an hour is two of those, so a reboot for an
 *     update, a store's Wi-Fi dropping for a few minutes or one missed
 *     check-in does not page anyone, and a kiosk that is really gone is
 *     seen within the hour. A fleet switched off at night alerts every
 *     night: raise the threshold above the night, or schedule maintenance
 *     for the hours it is off.
 *   - ITS LATEST READING. A reading is written once per read, every 15
 *     minutes by default and as seldom as every hour, so the window is two
 *     hours - a read at the longest interval, a late one and one that
 *     failed still leave a reading in it - and each device is judged on the
 *     newest (judgeLatestReading): the alert opens with the first read that
 *     finds the device silent for more than an hour, and resolves with the
 *     first that finds it checked in again.
 *   - ONE ALERT PER DEVICE, by its name in Esper, which Esper generates and
 *     never changes (ESP-ID-AAAAW); not its alias, which people edit. Made
 *     from the Recommendations page it is an alert by default, as every
 *     recommended monitor is (MonitorRecommendationCreateSideOver): one
 *     kiosk of a fleet is the team's to fix, not a status page's to
 *     publish. It stays open while the device is quiet and resolves once,
 *     when it checks in again.
 *   - NOT A DEVICE THE ANDROID AGENT REPORTS. Such a device is a host in
 *     Hosts, and Host Stopped Reporting watches it, ten minutes after the
 *     agent goes quiet: the query reads only the devices that are not
 *     (IsHost "false"), so a device that goes dark is told of once.
 *   - SILENCE IS NOT RECOVERY. A device that leaves Esper, is disabled or
 *     starts running the agent has no new reading: once its last one has
 *     left the window, its alert resolves while the others' readings go on.
 *     When no device has a reading at all, the connection stopped reading -
 *     a refused key, Esper down, the connection turned off - and the open
 *     alerts stay open until readings arrive again
 *     (MonitorResource.isSilentInfrastructureWindow); the connection's row
 *     on Managed Devices says why.
 */

// The threshold: more than this many minutes since a device's last check-in.
export const MANAGED_DEVICE_STOPPED_CHECKING_IN_MINUTES: number = 60;

// The window each evaluation reads: one read at the longest interval, and then some.
export const MANAGED_DEVICE_CHECK_IN_ROLLING_TIME: RollingTime =
  RollingTime.Past2Hours;

/*
 * How often the monitor is evaluated: a reading arrives at most every five
 * minutes (the shortest read interval), so evaluating more often changes
 * nothing.
 */
export const MANAGED_DEVICE_ALERT_MONITORING_INTERVAL: string = "*/5 * * * *";

// One series, and one alert, per device: its name in the service.
export const MANAGED_DEVICE_CHECK_IN_GROUP_BY_ATTRIBUTES: ReadonlyArray<string> =
  [ManagedDeviceCheckInAttribute.DeviceName];

const METRIC_ALIAS: string = "minutes_since_check_in";

export type ManagedDeviceAlertTemplateCategory = "Availability";

export type ManagedDeviceAlertTemplateSeverity = "Critical" | "Warning";

export interface ManagedDeviceAlertTemplateArgs {
  deviceManagementConnectionId: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

export interface ManagedDeviceAlertTemplate {
  id: string;
  name: string;
  /*
   * One plain sentence: when the template fires, with its threshold, without
   * metric names. The card shows it; `description` is shown once picked.
   */
  summary: string;
  description: string;
  category: ManagedDeviceAlertTemplateCategory;
  severity: ManagedDeviceAlertTemplateSeverity;
  monitoringInterval: string;
  getMonitorStep: (args: ManagedDeviceAlertTemplateArgs) => MonitorStep;
}

/*
 * The query of a connection's devices' check-ins: the minutes since each
 * one's last check-in, the devices no agent reports, one series per device.
 * Max per minute: two reads in one minute ("Read now" beside a scheduled
 * one) say the longer silence, never a mix of the two.
 */
export function buildManagedDeviceCheckInMetricMonitor(data: {
  deviceManagementConnectionId: string;
}): MonitorStepMetricMonitor {
  return {
    rollingTime: MANAGED_DEVICE_CHECK_IN_ROLLING_TIME,
    judgeLatestReading: true,
    metricViewConfig: {
      queryConfigs: [
        {
          metricAliasData: {
            metricVariable: METRIC_ALIAS,
            title: "Minutes since last check-in",
            description:
              "How long since each device last checked in, at the connection's latest read.",
            legend: "Minutes since last check-in",
            legendUnit: MANAGED_DEVICE_CHECK_IN_AGE_UNIT,
          },
          metricQueryData: {
            filterData: {
              metricName: MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME,
              attributes: {
                [ManagedDeviceCheckInAttribute.ConnectionId]:
                  data.deviceManagementConnectionId,
                // A device the Android agent reports is Host Stopped Reporting's.
                [ManagedDeviceCheckInAttribute.IsHost]: "false",
              },
              aggegationType: MetricsAggregationType.Max,
              aggregateBy: {},
            },
            groupByAttributeKeys: [
              ...MANAGED_DEVICE_CHECK_IN_GROUP_BY_ATTRIBUTES,
            ],
          },
        },
      ],
      formulaConfigs: [],
    },
  };
}

const esperDeviceStoppedCheckingInTemplate: ManagedDeviceAlertTemplate = {
  id: "esper-device-stopped-checking-in",
  name: "Esper Device Stopped Checking In",
  summary: "A device has not checked in with Esper for more than an hour.",
  description:
    "Alert when a device Esper manages has not checked in for more than an hour, one alert per device, resolved once it checks in again. Every read of the connection records how long each device has been quiet. A device that runs the OneUptime Android agent is left to Host Stopped Reporting.",
  category: "Availability",
  severity: "Warning",
  monitoringInterval: MANAGED_DEVICE_ALERT_MONITORING_INTERVAL,
  getMonitorStep: (args: ManagedDeviceAlertTemplateArgs): MonitorStep => {
    const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
      monitorName: args.monitorName,
      monitorType: MonitorType.Metrics,
      onlineMonitorStatusId: args.onlineMonitorStatusId,
      offlineMonitorStatusId: args.offlineMonitorStatusId,
      defaultIncidentSeverityId: args.defaultIncidentSeverityId,
      defaultAlertSeverityId: args.defaultAlertSeverityId,
    });

    step.setMetricMonitor(
      buildManagedDeviceCheckInMetricMonitor({
        deviceManagementConnectionId: args.deviceManagementConnectionId,
      }),
    );

    const unhealthy: MonitorCriteriaInstance = buildUnhealthyCriteriaInstance({
      offlineMonitorStatusId: args.offlineMonitorStatusId,
      incidentSeverityId: args.defaultIncidentSeverityId,
      alertSeverityId: args.defaultAlertSeverityId,
      monitorName: args.monitorName,
      metricAlias: METRIC_ALIAS,
      filterType: FilterType.GreaterThan,
      value: MANAGED_DEVICE_STOPPED_CHECKING_IN_MINUTES,
      incidentTitle: "[Esper] Device stopped checking in",
      incidentDescription:
        "A device Esper manages has not checked in with Esper for more than an hour, so it is off, has lost its network, or its Esper agent stopped. Check its power and its network first; the Esper console shows its last known battery, network and location. This resolves on its own once it checks in again.",
      criteriaName: "A device stopped checking in",
      criteriaDescription:
        "Triggers when a device's latest reading says it has not checked in with Esper for more than an hour, once for each such device.",
      resourceNoun: "device",
      /*
       * Each device holds one reading here, its latest
       * (judgeLatestReading): Any Value is that reading. All Values would
       * also ask one reading to cover the two-hour window, which a reading
       * taken every 15 minutes never does (MetricWindowCoverage).
       */
      metricAggregationType: EvaluateOverTimeType.AnyValue,
    });

    const healthy: MonitorCriteriaInstance = buildHealthyCriteriaInstance({
      onlineMonitorStatusId: args.onlineMonitorStatusId,
      metricAlias: METRIC_ALIAS,
      filterType: FilterType.LessThanOrEqualTo,
      value: MANAGED_DEVICE_STOPPED_CHECKING_IN_MINUTES,
      /*
       * No dead band: a device that checks in again reads a few minutes,
       * nowhere near the threshold, and a band would only keep the monitor
       * offline for a device that reads exactly an hour.
       */
      recoveryValue: MANAGED_DEVICE_STOPPED_CHECKING_IN_MINUTES,
      metricAggregationType: EvaluateOverTimeType.AnyValue,
    });

    const criteria: MonitorCriteria = new MonitorCriteria();
    criteria.data = { monitorCriteriaInstanceArray: [unhealthy, healthy] };
    step.setMonitorCriteria(criteria);

    return step;
  },
};

/*
 * Every connection is an Esper tenant today (DeviceManagementProvider), so
 * every connection is offered these. A service added beside Esper (#9837)
 * adds its own templates, and a recommendation context that picks them by
 * the connection's service.
 */
export function getAllManagedDeviceAlertTemplates(): Array<ManagedDeviceAlertTemplate> {
  return [esperDeviceStoppedCheckingInTemplate];
}

export function getManagedDeviceAlertTemplateById(
  id: string,
): ManagedDeviceAlertTemplate | undefined {
  return getAllManagedDeviceAlertTemplates().find(
    (template: ManagedDeviceAlertTemplate): boolean => {
      return template.id === id;
    },
  );
}
