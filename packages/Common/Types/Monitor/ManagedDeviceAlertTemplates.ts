import ObjectID from "../ObjectID";
import Includes from "../BaseDatabase/Includes";
import Dictionary from "../Dictionary";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import { EvaluateOverTimeType, FilterType } from "./CriteriaFilter";
import MonitorType from "./MonitorType";
import MonitorStepMetricMonitor from "./MonitorStepMetricMonitor";
import RollingTime from "../RollingTime/RollingTime";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import DeviceManagementProvider, {
  getDeviceManagementProviderShortTitle,
} from "../DeviceManagement/DeviceManagementProvider";
import { getDeviceManagementStaleAfterMinutes } from "../DeviceManagement/DeviceManagementConnectionHealth";
import {
  DEFAULT_DEVICE_MANAGEMENT_READ_INTERVAL_IN_MINUTES,
  DEVICE_MANAGEMENT_READ_INTERVALS_IN_MINUTES,
} from "../DeviceManagement/DeviceManagementConnectionSettings";
import {
  DeviceManagementConnectionReadingAttribute,
  MANAGED_DEVICE_CONNECTION_READ_AGE_METRIC_NAME,
  MANAGED_DEVICE_CONNECTION_READ_AGE_UNIT,
} from "../DeviceManagement/DeviceManagementConnectionReading";
import {
  MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME,
  MANAGED_DEVICE_BATTERY_LEVEL_UNIT,
  MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME,
  MANAGED_DEVICE_CHECK_IN_AGE_UNIT,
  MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME,
  MANAGED_DEVICE_SECURITY_PATCH_AGE_UNIT,
  MANAGED_DEVICE_STORAGE_USED_METRIC_NAME,
  MANAGED_DEVICE_STORAGE_USED_UNIT,
  ManagedDeviceCheckInAttribute,
} from "../DeviceManagement/ManagedDeviceCheckIn";
import { ANDROID_SECURITY_PATCH_MAX_AGE_DAYS } from "../Host/AndroidSecurityPatch";
import { ManagedDevicePlatform } from "../DeviceManagement/ManagedDevicePlatform";
import {
  buildHealthyCriteriaInstance,
  buildUnhealthyCriteriaInstance,
} from "./Recommendation/RecommendationCriteriaBuilder";

/*
 * The curated alert library for ONE device management connection (a
 * DeviceManagementConnection row: an Esper tenant, #9835): Metrics monitors
 * over the readings each read of the connection writes for its devices
 * (ManagedDeviceCheckIn), filtered on the connection's id and its service,
 * so one monitor watches every device the connection imports - one
 * enrolled next week too - and alerts once per device.
 *
 * A connection is offered its own service's templates
 * (getManagedDeviceAlertTemplatesFor), each with the silence that says a
 * device of that kind is gone:
 *
 *   - AN HOUR, for an Esper Android device ("Esper Android Device Stopped
 *     Checking In"). Esper itself calls a device offline 30 minutes after
 *     its last check-in, and so do the Managed Devices list and the device's
 *     card; an hour is two of those, so a reboot for an update, a store's
 *     Wi-Fi dropping for a few minutes or one missed check-in does not page
 *     anyone, and a kiosk that is really gone is seen within the hour. A
 *     fleet switched off at night alerts every night: raise the threshold
 *     above the night, or schedule maintenance for the hours it is off.
 *   - A DAY, for a device that checks in hours apart (#9837): an Esper Apple
 *     device ("Esper Apple Device Stopped Checking In"), which checks in
 *     when Apple's push service wakes it - Esper says its iOS devices
 *     reporting more than 30 minutes is expected - and is offline after a
 *     day, Esper's own next bucket. The two Esper templates read their
 *     devices apart, by platform, so neither alerts for the other's.
 *   - A DAY for every device of a Workspace ONE UEM connection (#10086),
 *     which reports on its own sample schedule, hours apart on an iPhone,
 *     as Intune's devices do; AN HOUR for a SOTI MobiControl device (#10087)
 *     whose agent keeps a live connection to its server - Android, Windows,
 *     Linux - and A DAY for a SOTI Apple device, which checks in through
 *     Apple's push service. The two SOTI templates read their devices
 *     apart, by platform, as Esper's do.
 *   - ITS LATEST READING. A reading is written once per read, every 15
 *     minutes by default and as seldom as every hour, so the window is two
 *     hours - a read at the longest interval, a late one and one that
 *     failed still leave a reading in it - and each device is judged on the
 *     newest (judgeLatestReading): the alert opens with the first read that
 *     finds the device silent for longer than its threshold, and resolves
 *     with the first that finds it checked in again.
 *   - ONE ALERT PER DEVICE, by its name in the service, which names it
 *     uniquely (Esper generates ESP-ID-AAAAW and never changes it); not its
 *     alias, which people edit. Made from the Recommendations page it is an
 *     alert by default, as every recommended monitor is
 *     (MonitorRecommendationCreateSideOver): one kiosk of a fleet is the
 *     team's to fix, not a status page's to publish. It stays open while the
 *     device is quiet and resolves once, when it checks in again.
 *   - NOT A DEVICE THE ANDROID AGENT REPORTS. Such a device is a host in
 *     Hosts, and Host Stopped Reporting watches it, ten minutes after the
 *     agent goes quiet: the query reads only the devices that are not
 *     (IsHost "false"), so a device that goes dark is told of once.
 *   - SILENCE IS NOT RECOVERY. A device that leaves the service, is
 *     disabled or starts running the agent has no new reading: once its last
 *     one has left the window, its alert resolves while the others' readings
 *     go on. When no device has a reading at all, the connection stopped
 *     reading - a refused key, the service down, the connection turned off -
 *     and the open alerts stay open until readings arrive again
 *     (MonitorResource.isSilentInfrastructureWindow); the connection's row
 *     on Managed Devices says why. A connection deleted is never read
 *     again: every monitor that reads it alone is turned off with it, what
 *     it had open resolved, saying why (DeviceManagementConnectionAlerts,
 *     #10286).
 *
 * First of each service's, CONNECTION STOPPED READING (#10006): the
 * connection itself, which every other template is fed by. Every read of
 * it, and every read it falls due for, records how long since one worked
 * (DeviceManagementConnectionReading), and the template alerts once no read
 * has worked for longer than three of its read intervals and ten minutes -
 * as long as its Status chip waits before it says Stale
 * (getDeviceManagementStaleAfterMinutes), so a read that fails once and
 * works at the next try never alerts - and resolves with the first read
 * that works. One alert, for the connection, named after it; its first
 * command lists the connection's last readings, each with the error its
 * read failed with. Without it a revoked key or a service out of reach
 * froze every device alert of the fleet, and nobody learned the fleet was
 * unwatched. Turning the connection off resolves it, saying who did: no
 * read of a connection that is off is overdue, and its last reading, 0,
 * says so to the monitor (DeviceManagementConnectionAlerts, #10286).
 *
 * Where a service reports them, LOW BATTERY and STORAGE NEARLY FULL
 * (#10008): a device's battery, as its service last heard it, under 20%,
 * and its own storage more than 90% in use - the thresholds of the Android
 * agent's own Low Battery and Storage Nearly Full, so a device reads the
 * same alert whichever reports it. Each read writes them beside the
 * device's check-in, and the templates read them the way the check-in
 * templates read theirs: each device's latest reading, one alert per
 * device, never a device the agent reports - whose host's own templates
 * read the agent's hw.battery.charge and system.filesystem.utilization, and
 * none of the import's - and no resolving on a connection gone quiet. A
 * dying battery shows hours before the device stops checking in. Esper,
 * Workspace ONE and SOTI report a battery in their device lists; Intune's
 * says none, and its reads ask each iPhone and iPad alone once it has
 * checked in since (#10287): Graph says no other device's battery.
 *
 * And, for every service, SECURITY PATCH OUT OF DATE (#10098): an Android
 * device whose security patch level, as the service reports it, is more than
 * 90 days old - the rule Inventory's Security Patch Level filter and the
 * Android agent's own Host template read (Host/AndroidSecurityPatch). Each
 * read writes every Android device's patch age beside its check-in
 * (ManagedDeviceCheckIn), and the template reads them the way the check-in
 * templates read theirs: each device's latest reading, one alert per device,
 * never a device the agent reports - whose host's Security Patch Out of Date
 * reads the agent's own age - and no resolving on a connection gone quiet.
 * It resolves at the first read that finds the device updated.
 */

// The threshold of a device with a heartbeat: more than this many minutes since its last check-in.
export const MANAGED_DEVICE_STOPPED_CHECKING_IN_MINUTES: number = 60;

/*
 * The threshold of a device that checks in hours apart: more than a day,
 * its offline window (MANAGED_DEVICE_SYNC_ONLINE_WINDOW_MINUTES), which
 * already holds three missed check-ins.
 */
export const MANAGED_DEVICE_STOPPED_SYNCING_MINUTES: number = 24 * 60;

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

/*
 * Connection Stopped Reading's window (#10006). A connection writes its
 * reading at every read and whenever a read of it falls due: an interval
 * apart at the longest while it reads, and an hour apart while a refused
 * key waits for its retry. Two hours always holds one, and the connection
 * is judged on its newest.
 */
export const MANAGED_DEVICE_CONNECTION_READ_ROLLING_TIME: RollingTime =
  RollingTime.Past2Hours;

/*
 * One series, and one alert, per connection - the monitor reads one - by
 * its name, as Managed Devices lists it, so the alert says which.
 */
export const MANAGED_DEVICE_CONNECTION_GROUP_BY_ATTRIBUTES: ReadonlyArray<string> =
  [DeviceManagementConnectionReadingAttribute.ConnectionName];

/*
 * How long Connection Stopped Reading lets a connection go without a read
 * that worked, at its read interval (the default one when not known): as
 * long as its Status chip waits before it says Stale - three intervals and
 * ten minutes, half an hour at the least - so a read that fails once and
 * works at its retry never alerts.
 */
export function getManagedDeviceConnectionStoppedReadingMinutes(
  readIntervalInMinutes?: number | undefined,
): number {
  return getDeviceManagementStaleAfterMinutes(
    readIntervalInMinutes ?? DEFAULT_DEVICE_MANAGEMENT_READ_INTERVAL_IN_MINUTES,
  );
}

// Apple's platforms, as an Esper connection's Apple devices are read apart.
export const MANAGED_DEVICE_APPLE_PLATFORMS: ReadonlyArray<ManagedDevicePlatform> =
  [
    ManagedDevicePlatform.IOS,
    ManagedDevicePlatform.IPadOS,
    ManagedDevicePlatform.TvOS,
    ManagedDevicePlatform.MacOS,
  ];

/*
 * Every platform but Apple's: the devices a SOTI agent keeps a live
 * connection from, read apart from its Apple devices.
 */
export const MANAGED_DEVICE_NON_APPLE_PLATFORMS: ReadonlyArray<ManagedDevicePlatform> =
  [
    ManagedDevicePlatform.Android,
    ManagedDevicePlatform.Windows,
    ManagedDevicePlatform.Linux,
    ManagedDevicePlatform.Other,
  ];

/*
 * Low Battery's threshold (#10008): less than this many percent, the
 * Android agent's own Low Battery's, so a device reads the same alert
 * whether its device manager or the agent reports it.
 */
export const MANAGED_DEVICE_LOW_BATTERY_PERCENT: number = 20;

/*
 * Storage Nearly Full's (#10008): more than this many percent of its own
 * storage in use, the agent's own Storage Nearly Full's.
 */
export const MANAGED_DEVICE_STORAGE_NEARLY_FULL_PERCENT: number = 90;

const METRIC_ALIAS: string = "minutes_since_check_in";

const SECURITY_PATCH_METRIC_ALIAS: string = "days_since_security_patch";

const BATTERY_METRIC_ALIAS: string = "battery_percent";

const STORAGE_METRIC_ALIAS: string = "storage_used_percent";

export type ManagedDeviceAlertTemplateCategory =
  | "Availability"
  | "Security"
  | "Resource";

export type ManagedDeviceAlertTemplateSeverity = "Critical" | "Warning";

export interface ManagedDeviceAlertTemplateArgs {
  deviceManagementConnectionId: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
  /*
   * How often the connection is read, in minutes: what Connection Stopped
   * Reading waits three of. The default interval when not known.
   */
  readIntervalInMinutes?: number | undefined;
}

export interface ManagedDeviceAlertTemplate {
  id: string;
  // The service whose connections are offered it.
  provider: DeviceManagementProvider;
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
  /*
   * The reading it reads, each device's latest - a check-in's, a patch's -
   * or the connection's own (Connection Stopped Reading).
   */
  metricName: string;
  /*
   * A check-in template's: the minutes of silence it fires after.
   * Connection Stopped Reading's: those a connection read at the default
   * interval waits (getManagedDeviceConnectionStoppedReadingMinutes says
   * how long at its own).
   */
  thresholdInMinutes?: number | undefined;
  // A security patch template's: the days old a patch may be, and no more.
  maxSecurityPatchAgeInDays?: number | undefined;
  // Low Battery's: the percent a battery may fall to, and no lower (#10008).
  minBatteryPercent?: number | undefined;
  // Storage Nearly Full's: the percent of its storage a device may use, and no more.
  maxStorageUsedPercent?: number | undefined;
  // The platforms it reads; none is every device of the connection.
  platforms?: ReadonlyArray<ManagedDevicePlatform> | undefined;
  /*
   * Connection Stopped Reading's: its step waits as long as the
   * connection's read interval says, so a monitor made at another interval
   * is still it (getManagedDeviceAlertTemplateEquivalentSteps).
   */
  followsReadInterval?: boolean | undefined;
  getMonitorStep: (args: ManagedDeviceAlertTemplateArgs) => MonitorStep;
  /*
   * The steps a monitor made from an earlier version of it has, which are
   * still it (getManagedDeviceAlertTemplateEquivalentSteps): a check-in or
   * security patch template's query, made before it read its service as
   * well as its connection (#10059, #10123, #10182), reads the same
   * devices. So a monitor made then still counts as made, and is never
   * offered a second time.
   */
  getEarlierMonitorSteps?:
    | ((args: ManagedDeviceAlertTemplateArgs) => Array<MonitorStep>)
    | undefined;
}

/*
 * The query of a connection's devices' check-ins: the minutes since each
 * one's last check-in, the devices no agent reports - of the given
 * platforms, where the template reads some apart - one series per device.
 * Max per minute: two reads in one minute ("Read now" beside a scheduled
 * one) say the longer silence, never a mix of the two. The service, where
 * it is given, is read too (see buildManagedDeviceReadingMetricMonitor).
 */
export function buildManagedDeviceCheckInMetricMonitor(data: {
  deviceManagementConnectionId: string;
  platforms?: ReadonlyArray<ManagedDevicePlatform> | undefined;
  provider?: DeviceManagementProvider | undefined;
}): MonitorStepMetricMonitor {
  return buildManagedDeviceReadingMetricMonitor({
    deviceManagementConnectionId: data.deviceManagementConnectionId,
    provider: data.provider,
    platforms: data.platforms,
    metricName: MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME,
    metricAlias: METRIC_ALIAS,
    title: "Minutes since last check-in",
    description:
      "How long since each device last checked in, at the connection's latest read.",
    legendUnit: MANAGED_DEVICE_CHECK_IN_AGE_UNIT,
  });
}

/*
 * The query of a connection's Android devices' security patches (#10098):
 * the days since each one's patch level, of the devices no agent reports,
 * one series per device. Max per minute, as the check-ins read theirs, and
 * the service read too where it is given.
 */
export function buildManagedDeviceSecurityPatchMetricMonitor(data: {
  deviceManagementConnectionId: string;
  provider?: DeviceManagementProvider | undefined;
}): MonitorStepMetricMonitor {
  return buildManagedDeviceReadingMetricMonitor({
    deviceManagementConnectionId: data.deviceManagementConnectionId,
    provider: data.provider,
    // Android's alone: no other platform has a security patch level.
    platforms: [ManagedDevicePlatform.Android],
    metricName: MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME,
    metricAlias: SECURITY_PATCH_METRIC_ALIAS,
    title: "Days since security patch",
    description:
      "How old each Android device's security patch level is, at the connection's latest read.",
    legendUnit: MANAGED_DEVICE_SECURITY_PATCH_AGE_UNIT,
  });
}

/*
 * The query of a connection's devices' batteries (#10008): each one's
 * battery in percent, of the devices no agent reports, one series per
 * device. Min per minute: two reads in one minute say the lower charge.
 */
export function buildManagedDeviceBatteryMetricMonitor(data: {
  deviceManagementConnectionId: string;
  provider: DeviceManagementProvider;
}): MonitorStepMetricMonitor {
  return buildManagedDeviceReadingMetricMonitor({
    deviceManagementConnectionId: data.deviceManagementConnectionId,
    provider: data.provider,
    metricName: MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME,
    metricAlias: BATTERY_METRIC_ALIAS,
    title: "Battery",
    description:
      "Each device's battery, as its device manager last heard it, at the connection's latest read.",
    legendUnit: MANAGED_DEVICE_BATTERY_LEVEL_UNIT,
    aggregationType: MetricsAggregationType.Min,
  });
}

/*
 * The query of a connection's devices' storage (#10008): how much of each
 * one's own storage is in use, in percent, of the devices no agent reports,
 * one series per device. Max per minute: the fuller of two reads.
 */
export function buildManagedDeviceStorageMetricMonitor(data: {
  deviceManagementConnectionId: string;
  provider: DeviceManagementProvider;
}): MonitorStepMetricMonitor {
  return buildManagedDeviceReadingMetricMonitor({
    deviceManagementConnectionId: data.deviceManagementConnectionId,
    provider: data.provider,
    metricName: MANAGED_DEVICE_STORAGE_USED_METRIC_NAME,
    metricAlias: STORAGE_METRIC_ALIAS,
    title: "Storage used",
    description:
      "How much of each device's own storage is in use, as its device manager last heard it, at the connection's latest read.",
    legendUnit: MANAGED_DEVICE_STORAGE_USED_UNIT,
  });
}

/*
 * A connection's readings of its devices, of one metric: the devices no
 * agent reports, of the given platforms, one series per device. Max per
 * minute unless the metric says otherwise.
 *
 * The service, where it is given, is read as well - every template gives
 * it: it changes no reading the connection's id does not already pick (a
 * connection reads one service, and every reading names it), and it keeps
 * each service's template of a metric apart from the others' in the
 * recommendations' fingerprint (MonitorRecommendationUtil), so a monitor
 * made from Esper's is never another service's. The battery and storage
 * templates read it from the start (#10008); the check-in and security
 * patch templates since their services' templates of one metric were told
 * apart, and a monitor made from one of them before is still theirs
 * (getEarlierMonitorSteps).
 */
function buildManagedDeviceReadingMetricMonitor(data: {
  deviceManagementConnectionId: string;
  provider?: DeviceManagementProvider | undefined;
  platforms?: ReadonlyArray<ManagedDevicePlatform> | undefined;
  metricName: string;
  metricAlias: string;
  title: string;
  description: string;
  legendUnit: string;
  aggregationType?: MetricsAggregationType | undefined;
}): MonitorStepMetricMonitor {
  const attributes: Dictionary<string | Includes> = {
    [ManagedDeviceCheckInAttribute.ConnectionId]:
      data.deviceManagementConnectionId,
    /*
     * A device the Android agent reports is its host's to alert on: Host
     * Stopped Reporting, and its own Security Patch Out of Date.
     */
    [ManagedDeviceCheckInAttribute.IsHost]: "false",
  };

  if (data.provider) {
    attributes[ManagedDeviceCheckInAttribute.Provider] = data.provider;
  }

  if (data.platforms && data.platforms.length === 1) {
    attributes[ManagedDeviceCheckInAttribute.Platform] = data.platforms[0]!;
  } else if (data.platforms && data.platforms.length > 1) {
    attributes[ManagedDeviceCheckInAttribute.Platform] = new Includes([
      ...data.platforms,
    ]);
  }

  return {
    rollingTime: MANAGED_DEVICE_CHECK_IN_ROLLING_TIME,
    judgeLatestReading: true,
    metricViewConfig: {
      queryConfigs: [
        {
          metricAliasData: {
            metricVariable: data.metricAlias,
            title: data.title,
            description: data.description,
            legend: data.title,
            legendUnit: data.legendUnit,
          },
          metricQueryData: {
            filterData: {
              metricName: data.metricName,
              attributes: attributes,
              aggegationType:
                data.aggregationType || MetricsAggregationType.Max,
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

// What a template says, and whom it reads.
interface CheckInTemplateSpec {
  id: string;
  provider: DeviceManagementProvider;
  name: string;
  summary: string;
  description: string;
  thresholdInMinutes: number;
  platforms?: ReadonlyArray<ManagedDevicePlatform> | undefined;
  incidentTitle: string;
  incidentDescription: string;
  criteriaDescription: string;
}

function buildCheckInTemplate(
  spec: CheckInTemplateSpec,
): ManagedDeviceAlertTemplate {
  /*
   * The template's step, its query reading the template's service - or,
   * for a monitor made before it did, the connection alone.
   */
  const buildStep: (
    args: ManagedDeviceAlertTemplateArgs,
    provider: DeviceManagementProvider | undefined,
  ) => MonitorStep = (
    args: ManagedDeviceAlertTemplateArgs,
    provider: DeviceManagementProvider | undefined,
  ): MonitorStep => {
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
        platforms: spec.platforms,
        provider,
      }),
    );

    const unhealthy: MonitorCriteriaInstance = buildUnhealthyCriteriaInstance({
      offlineMonitorStatusId: args.offlineMonitorStatusId,
      incidentSeverityId: args.defaultIncidentSeverityId,
      alertSeverityId: args.defaultAlertSeverityId,
      monitorName: args.monitorName,
      metricAlias: METRIC_ALIAS,
      filterType: FilterType.GreaterThan,
      value: spec.thresholdInMinutes,
      incidentTitle: spec.incidentTitle,
      incidentDescription: spec.incidentDescription,
      criteriaName: "A device stopped checking in",
      criteriaDescription: spec.criteriaDescription,
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
      value: spec.thresholdInMinutes,
      /*
       * No dead band: a device that checks in again reads a few minutes,
       * nowhere near the threshold, and a band would only keep the monitor
       * offline for a device that reads exactly the threshold.
       */
      recoveryValue: spec.thresholdInMinutes,
      metricAggregationType: EvaluateOverTimeType.AnyValue,
    });

    const criteria: MonitorCriteria = new MonitorCriteria();
    criteria.data = { monitorCriteriaInstanceArray: [unhealthy, healthy] };
    step.setMonitorCriteria(criteria);

    return step;
  };

  return {
    id: spec.id,
    provider: spec.provider,
    name: spec.name,
    summary: spec.summary,
    description: spec.description,
    category: "Availability",
    severity: "Warning",
    monitoringInterval: MANAGED_DEVICE_ALERT_MONITORING_INTERVAL,
    metricName: MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME,
    thresholdInMinutes: spec.thresholdInMinutes,
    platforms: spec.platforms,
    getMonitorStep: (args: ManagedDeviceAlertTemplateArgs): MonitorStep => {
      return buildStep(args, spec.provider);
    },
    // A monitor made before the query read its service (#9835, #9837, #10086, #10087).
    getEarlierMonitorSteps: (
      args: ManagedDeviceAlertTemplateArgs,
    ): Array<MonitorStep> => {
      return [buildStep(args, undefined)];
    },
  };
}

/*
 * An Esper connection's Android devices. Its id and query are the ones a
 * monitor made before Esper's Apple devices were imported was made with,
 * the platform aside: a data migration
 * (KeepManagedDeviceCheckInMonitorsOnAndroid) gives those monitors the
 * platform filter, so they keep reading what they read and still cover this
 * recommendation.
 */
const esperAndroidDeviceStoppedCheckingInTemplate: ManagedDeviceAlertTemplate =
  buildCheckInTemplate({
    id: "esper-device-stopped-checking-in",
    provider: DeviceManagementProvider.Esper,
    name: "Esper Android Device Stopped Checking In",
    summary:
      "An Android device has not checked in with Esper for more than an hour.",
    description:
      "Alert when an Android device Esper manages has not checked in for more than an hour, one alert per device, resolved once it checks in again. Every read of the connection records how long each device has been quiet. A device that runs the OneUptime Android agent is left to Host Stopped Reporting.",
    thresholdInMinutes: MANAGED_DEVICE_STOPPED_CHECKING_IN_MINUTES,
    platforms: [ManagedDevicePlatform.Android],
    incidentTitle: "[Esper] Device stopped checking in",
    incidentDescription:
      "An Android device Esper manages has not checked in with Esper for more than an hour, so it is off, has lost its network, or its Esper agent stopped. Check its power and its network first; the Esper console shows its last known battery, network and location. This resolves on its own once it checks in again.",
    criteriaDescription:
      "Triggers when a device's latest reading says it has not checked in with Esper for more than an hour, once for each such device.",
  });

const esperAppleDeviceStoppedCheckingInTemplate: ManagedDeviceAlertTemplate =
  buildCheckInTemplate({
    id: "esper-apple-device-stopped-checking-in",
    provider: DeviceManagementProvider.Esper,
    name: "Esper Apple Device Stopped Checking In",
    summary:
      "An iPhone, iPad or Apple TV has not checked in with Esper for more than a day.",
    description:
      "Alert when an Apple device Esper manages has not checked in for more than a day, one alert per device, resolved once it checks in again. An Apple device checks in when Apple's push service wakes it, often hours apart, so a day without one is what says it is gone.",
    thresholdInMinutes: MANAGED_DEVICE_STOPPED_SYNCING_MINUTES,
    platforms: MANAGED_DEVICE_APPLE_PLATFORMS,
    incidentTitle: "[Esper] Apple device stopped checking in",
    incidentDescription:
      "An iPhone, iPad or Apple TV Esper manages has not checked in with Esper for more than a day, so it is off, cannot reach Apple's push service, or was taken out of Esper on the device. Check its power and its network first; the Esper console shows its last known battery and network. This resolves on its own once it checks in again.",
    criteriaDescription:
      "Triggers when a device's latest reading says it has not checked in with Esper for more than a day, once for each such device.",
  });

/*
 * A Microsoft Intune connection's devices, every platform (#9837): each
 * checks in with Intune about every eight hours, and when someone opens the
 * Company Portal or a policy changes, so a day without a check-in is what
 * says it is gone - as Inventory's Offline does.
 */
const intuneDeviceStoppedCheckingInTemplate: ManagedDeviceAlertTemplate =
  buildCheckInTemplate({
    id: "intune-device-stopped-checking-in",
    provider: DeviceManagementProvider.Intune,
    name: "Intune Device Stopped Checking In",
    summary: "A device has not checked in with Intune for more than a day.",
    description:
      "Alert when a device Intune manages has not checked in for more than a day, one alert per device, resolved once it checks in again. A device checks in with Intune about every eight hours, so a day without one is what says it is gone. A laptop left off over a weekend reads the same: raise the threshold for those. A device that is a host in Hosts, because a OneUptime agent reports it, is left to Host Stopped Reporting.",
    thresholdInMinutes: MANAGED_DEVICE_STOPPED_SYNCING_MINUTES,
    incidentTitle: "[Intune] Device stopped checking in",
    incidentDescription:
      "A device Intune manages has not checked in with Intune for more than a day, so it is off, has lost its network, or was taken out of management on the device. Check its power and its network first; the Microsoft Intune admin center shows its last check-in and its compliance. This resolves on its own once it checks in again.",
    criteriaDescription:
      "Triggers when a device's latest reading says it has not checked in with Intune for more than a day, once for each such device.",
  });

/*
 * A Workspace ONE UEM connection's devices, every platform (#10086): each
 * reports on its own sample schedule - an iPhone hours apart, when Apple's
 * push service wakes it - so a day without a report is what says it is
 * gone, as Inventory's Offline does.
 */
const workspaceOneDeviceStoppedCheckingInTemplate: ManagedDeviceAlertTemplate =
  buildCheckInTemplate({
    id: "workspace-one-device-stopped-checking-in",
    provider: DeviceManagementProvider.WorkspaceOne,
    name: "Workspace ONE Device Stopped Checking In",
    summary: "A device has not reported to Workspace ONE for more than a day.",
    description:
      "Alert when a device Workspace ONE UEM manages has not reported for more than a day, one alert per device, resolved once it reports again. A device reports on its own schedule, an iPhone hours apart, so a day without a report is what says it is gone. A laptop left off over a weekend reads the same: raise the threshold for those. A device that is a host in Hosts, because a OneUptime agent reports it, is left to Host Stopped Reporting.",
    thresholdInMinutes: MANAGED_DEVICE_STOPPED_SYNCING_MINUTES,
    incidentTitle: "[Workspace ONE] Device stopped checking in",
    incidentDescription:
      "A device Workspace ONE UEM manages has not reported to Workspace ONE for more than a day, so it is off, has lost its network, or its Intelligent Hub stopped. Check its power and its network first; its Device Details page in the Workspace ONE UEM console shows when it was last seen. This resolves on its own once it reports again.",
    criteriaDescription:
      "Triggers when a device's latest reading says it has not reported to Workspace ONE for more than a day, once for each such device.",
  });

/*
 * A SOTI MobiControl connection's devices whose agent keeps a live
 * connection to the server (#10087): Android, Windows, Linux. MobiControl
 * shows such a device offline the moment its agent disconnects, and an
 * hour without it is what says it is gone - a reboot or a dropped Wi-Fi
 * reconnects well within it.
 */
const sotiDeviceStoppedCheckingInTemplate: ManagedDeviceAlertTemplate =
  buildCheckInTemplate({
    id: "soti-device-stopped-checking-in",
    provider: DeviceManagementProvider.Soti,
    name: "SOTI Device Stopped Checking In",
    summary:
      "An Android, Windows or Linux device's MobiControl agent has been disconnected for more than an hour.",
    description:
      "Alert when the MobiControl agent of an Android, Windows or Linux device has not been connected to its server for more than an hour, one alert per device, resolved once it connects again. A MobiControl agent keeps a live connection, so an hour without one is what says the device is gone. A fleet switched off at night alerts every night: raise the threshold above the night. A device that is a host in Hosts, because a OneUptime agent reports it, is left to Host Stopped Reporting.",
    thresholdInMinutes: MANAGED_DEVICE_STOPPED_CHECKING_IN_MINUTES,
    platforms: MANAGED_DEVICE_NON_APPLE_PLATFORMS,
    incidentTitle: "[SOTI] Device stopped checking in",
    incidentDescription:
      "The MobiControl agent of a device SOTI MobiControl manages has not been connected to its server for more than an hour, so the device is off, has lost its network, or its agent stopped. Check its power and its network first; the MobiControl web console shows when its agent last connected. This resolves on its own once it connects again.",
    criteriaDescription:
      "Triggers when a device's latest reading says its MobiControl agent has not been connected for more than an hour, once for each such device.",
  });

/*
 * A SOTI MobiControl connection's Apple devices (#10087): an iPhone, iPad
 * or Mac checks in through Apple's push service, hours apart, so a day
 * without a check-in is what says it is gone.
 */
const sotiAppleDeviceStoppedCheckingInTemplate: ManagedDeviceAlertTemplate =
  buildCheckInTemplate({
    id: "soti-apple-device-stopped-checking-in",
    provider: DeviceManagementProvider.Soti,
    name: "SOTI Apple Device Stopped Checking In",
    summary:
      "An iPhone, iPad or Mac has not checked in with MobiControl for more than a day.",
    description:
      "Alert when an Apple device SOTI MobiControl manages has not checked in for more than a day, one alert per device, resolved once it checks in again. An Apple device checks in when Apple's push service wakes it, often hours apart, so a day without one is what says it is gone.",
    thresholdInMinutes: MANAGED_DEVICE_STOPPED_SYNCING_MINUTES,
    platforms: MANAGED_DEVICE_APPLE_PLATFORMS,
    incidentTitle: "[SOTI] Apple device stopped checking in",
    incidentDescription:
      "An iPhone, iPad or Mac SOTI MobiControl manages has not checked in with MobiControl for more than a day, so it is off, cannot reach Apple's push service, or was taken out of management on the device. Check its power and its network first; the MobiControl web console shows when it last checked in. This resolves on its own once it checks in again.",
    criteriaDescription:
      "Triggers when a device's latest reading says it has not checked in with MobiControl for more than a day, once for each such device.",
  });

const CONNECTION_METRIC_ALIAS: string = "minutes_since_read";

/*
 * The query of a connection's own readings (#10006): the minutes since a
 * read of it worked, of this connection alone, one series named after it.
 * Min per minute: a read that worked and the claim that queued it, in one
 * minute, say it read - the claim was taken before the read ended. Its
 * service is read too, as the devices' battery and storage are: it keeps
 * each service's template apart in the recommendations' fingerprint.
 */
export function buildManagedDeviceConnectionReadMetricMonitor(data: {
  deviceManagementConnectionId: string;
  provider: DeviceManagementProvider;
}): MonitorStepMetricMonitor {
  return {
    rollingTime: MANAGED_DEVICE_CONNECTION_READ_ROLLING_TIME,
    judgeLatestReading: true,
    metricViewConfig: {
      queryConfigs: [
        {
          metricAliasData: {
            metricVariable: CONNECTION_METRIC_ALIAS,
            title: "Minutes since a read worked",
            description:
              "How long since a read of the connection last worked, at each read and whenever one is due.",
            legend: "Minutes since a read worked",
            legendUnit: MANAGED_DEVICE_CONNECTION_READ_AGE_UNIT,
          },
          metricQueryData: {
            filterData: {
              metricName: MANAGED_DEVICE_CONNECTION_READ_AGE_METRIC_NAME,
              attributes: {
                [DeviceManagementConnectionReadingAttribute.ConnectionId]:
                  data.deviceManagementConnectionId,
                [DeviceManagementConnectionReadingAttribute.Provider]:
                  data.provider,
              },
              aggegationType: MetricsAggregationType.Min,
              aggregateBy: {},
            },
            groupByAttributeKeys: [
              ...MANAGED_DEVICE_CONNECTION_GROUP_BY_ATTRIBUTES,
            ],
          },
        },
      ],
      formulaConfigs: [],
    },
  };
}

// What a connection's own template says, in its service's words.
interface ConnectionTemplateSpec {
  id: string;
  provider: DeviceManagementProvider;
  name: string;
  summary: string;
  // The service as a sentence names it: "Esper", "Intune", "MobiControl".
  serviceName: string;
  // Why a read of it fails, most often first, in its service's words.
  usualCauses: string;
}

/*
 * Connection Stopped Reading, for one service's connections (#10006): the
 * connection's latest reading of how long since a read of it worked, more
 * than its Stale point fires, one alert for the connection; a read that
 * works resolves it, with no dead band - the reading drops to 0 then, far
 * under the threshold.
 */
function buildConnectionStoppedReadingTemplate(
  spec: ConnectionTemplateSpec,
): ManagedDeviceAlertTemplate {
  return {
    id: spec.id,
    provider: spec.provider,
    name: spec.name,
    summary: spec.summary,
    description: `Alert when no read of a ${spec.serviceName} connection has worked for longer than three of its read intervals and ten minutes, as long as its Status waits before it says Stale: 55 minutes at the default 15-minute interval. One alert for the connection, resolved by the first read that works. While it lasts, OneUptime sees nothing new of the connection's devices, so their alerts can neither open nor resolve. ${spec.usualCauses} Every read of the connection, and every read it falls due for, records how long since one worked.`,
    category: "Availability",
    severity: "Critical",
    monitoringInterval: MANAGED_DEVICE_ALERT_MONITORING_INTERVAL,
    metricName: MANAGED_DEVICE_CONNECTION_READ_AGE_METRIC_NAME,
    thresholdInMinutes: getManagedDeviceConnectionStoppedReadingMinutes(),
    followsReadInterval: true,
    getMonitorStep: (args: ManagedDeviceAlertTemplateArgs): MonitorStep => {
      const thresholdInMinutes: number =
        getManagedDeviceConnectionStoppedReadingMinutes(
          args.readIntervalInMinutes,
        );

      const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
        monitorName: args.monitorName,
        monitorType: MonitorType.Metrics,
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        defaultIncidentSeverityId: args.defaultIncidentSeverityId,
        defaultAlertSeverityId: args.defaultAlertSeverityId,
      });

      step.setMetricMonitor(
        buildManagedDeviceConnectionReadMetricMonitor({
          deviceManagementConnectionId: args.deviceManagementConnectionId,
          provider: spec.provider,
        }),
      );

      const unhealthy: MonitorCriteriaInstance = buildUnhealthyCriteriaInstance(
        {
          offlineMonitorStatusId: args.offlineMonitorStatusId,
          incidentSeverityId: args.defaultIncidentSeverityId,
          alertSeverityId: args.defaultAlertSeverityId,
          monitorName: args.monitorName,
          metricAlias: CONNECTION_METRIC_ALIAS,
          filterType: FilterType.GreaterThan,
          value: thresholdInMinutes,
          // Tagged as its devices' alerts are: [Esper], [Intune], [Workspace ONE], [SOTI].
          incidentTitle: `[${getDeviceManagementProviderShortTitle(spec.provider)}] Connection stopped reading`,
          incidentDescription: `No read of this ${spec.serviceName} connection has worked for longer than three of its read intervals, so OneUptime sees nothing new of its devices: their alerts can neither open nor resolve until it reads again. ${spec.usualCauses} The connection's row on Inventory, Managed Devices says why its last read failed (View error); its first command below lists its last readings, each with the error its read failed with. If no read failed, OneUptime's workers may have stopped. This resolves on its own with the first read that works.`,
          criteriaName: "The connection stopped reading",
          criteriaDescription:
            "Triggers when the connection's latest reading says no read of it has worked for longer than three of its read intervals.",
          resourceNoun: "connection",
          // One reading here, its latest (judgeLatestReading): Any Value is that reading.
          metricAggregationType: EvaluateOverTimeType.AnyValue,
        },
      );

      const healthy: MonitorCriteriaInstance = buildHealthyCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias: CONNECTION_METRIC_ALIAS,
        filterType: FilterType.LessThanOrEqualTo,
        value: thresholdInMinutes,
        // No dead band: a read that works reads 0.
        recoveryValue: thresholdInMinutes,
        metricAggregationType: EvaluateOverTimeType.AnyValue,
      });

      const criteria: MonitorCriteria = new MonitorCriteria();
      criteria.data = { monitorCriteriaInstanceArray: [unhealthy, healthy] };
      step.setMonitorCriteria(criteria);

      return step;
    },
  };
}

const esperConnectionStoppedReadingTemplate: ManagedDeviceAlertTemplate =
  buildConnectionStoppedReadingTemplate({
    id: "esper-connection-stopped-reading",
    provider: DeviceManagementProvider.Esper,
    name: "Esper Connection Stopped Reading",
    summary:
      "No read of this Esper connection has worked for three read intervals.",
    serviceName: "Esper",
    usualCauses:
      "Most often its API key was revoked or replaced, the Esper user it belongs to was deleted or lost the role that reads devices, or Esper could not be reached.",
  });

const intuneConnectionStoppedReadingTemplate: ManagedDeviceAlertTemplate =
  buildConnectionStoppedReadingTemplate({
    id: "intune-connection-stopped-reading",
    provider: DeviceManagementProvider.Intune,
    name: "Intune Connection Stopped Reading",
    summary:
      "No read of this Intune connection has worked for three read intervals.",
    serviceName: "Intune",
    usualCauses:
      "Most often its client secret expired or was deleted, the app registration lost its admin consent to DeviceManagementManagedDevices.Read.All, or Microsoft Graph could not be reached.",
  });

const workspaceOneConnectionStoppedReadingTemplate: ManagedDeviceAlertTemplate =
  buildConnectionStoppedReadingTemplate({
    id: "workspace-one-connection-stopped-reading",
    provider: DeviceManagementProvider.WorkspaceOne,
    name: "Workspace ONE Connection Stopped Reading",
    summary:
      "No read of this Workspace ONE connection has worked for three read intervals.",
    serviceName: "Workspace ONE",
    usualCauses:
      "Most often its OAuth client was deleted or its secret regenerated, its admin role lost Read on Devices and Apps, the tenant's daily API quota was used up, or its server could not be reached.",
  });

const sotiConnectionStoppedReadingTemplate: ManagedDeviceAlertTemplate =
  buildConnectionStoppedReadingTemplate({
    id: "soti-connection-stopped-reading",
    provider: DeviceManagementProvider.Soti,
    name: "SOTI Connection Stopped Reading",
    summary:
      "No read of this MobiControl connection has worked for three read intervals.",
    serviceName: "MobiControl",
    usualCauses:
      "Most often its API client was removed or its secret changed, the MobiControl user's password changed or the user lost Web Console Access, or the server could not be reached.",
  });

// What a security patch template says, for its service.
interface SecurityPatchTemplateSpec {
  id: string;
  provider: DeviceManagementProvider;
  name: string;
  summary: string;
  // The service as a sentence names it: "Esper", "Intune", "MobiControl".
  serviceName: string;
}

/*
 * Security Patch Out of Date, for one service's Android devices (#10098):
 * their latest reading of how old their patch level is, more than 90 days
 * fires, one alert per device; 90 days or newer - the device updated -
 * resolves, with no dead band: the age only grows, a day at a time, until
 * an update takes it back under the threshold, as the Android agent's Host
 * template reads it.
 */
function buildSecurityPatchTemplate(
  spec: SecurityPatchTemplateSpec,
): ManagedDeviceAlertTemplate {
  /*
   * The criteria read the rule's own number; the words write it out, "90
   * days", as the Host template's do, so no code joins a figure to its word
   * (NumbersKeepTheirUnitsInCodeGuard). The templates' tests hold the two
   * together.
   */
  const maxAge: number = ANDROID_SECURITY_PATCH_MAX_AGE_DAYS;

  // Its step, its query reading its service - or, made before, the connection alone.
  const buildStep: (
    args: ManagedDeviceAlertTemplateArgs,
    provider: DeviceManagementProvider | undefined,
  ) => MonitorStep = (
    args: ManagedDeviceAlertTemplateArgs,
    provider: DeviceManagementProvider | undefined,
  ): MonitorStep => {
    const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
      monitorName: args.monitorName,
      monitorType: MonitorType.Metrics,
      onlineMonitorStatusId: args.onlineMonitorStatusId,
      offlineMonitorStatusId: args.offlineMonitorStatusId,
      defaultIncidentSeverityId: args.defaultIncidentSeverityId,
      defaultAlertSeverityId: args.defaultAlertSeverityId,
    });

    step.setMetricMonitor(
      buildManagedDeviceSecurityPatchMetricMonitor({
        deviceManagementConnectionId: args.deviceManagementConnectionId,
        provider,
      }),
    );

    const unhealthy: MonitorCriteriaInstance = buildUnhealthyCriteriaInstance({
      offlineMonitorStatusId: args.offlineMonitorStatusId,
      incidentSeverityId: args.defaultIncidentSeverityId,
      alertSeverityId: args.defaultAlertSeverityId,
      monitorName: args.monitorName,
      metricAlias: SECURITY_PATCH_METRIC_ALIAS,
      filterType: FilterType.GreaterThan,
      value: maxAge,
      incidentTitle: `[${spec.serviceName}] Security patch out of date`,
      incidentDescription: `An Android device ${spec.serviceName} manages has a security patch level more than 90 days old, so it misses the fixes of the Android security bulletins since then. Update its operating system: through the system update policy ${spec.serviceName} sets on it, or on the device in Settings, System, Software update. A device whose maker no longer ships updates stays out of date until it is replaced. This resolves on its own once ${spec.serviceName} reports a patch level from the last 90 days.`,
      criteriaName: "A device's security patch is out of date",
      criteriaDescription: `Triggers when a device's latest reading says its security patch level is more than 90 days old, once for each such device.`,
      resourceNoun: "device",
      // Each device holds one reading here, its latest: Any Value is that reading.
      metricAggregationType: EvaluateOverTimeType.AnyValue,
    });

    const healthy: MonitorCriteriaInstance = buildHealthyCriteriaInstance({
      onlineMonitorStatusId: args.onlineMonitorStatusId,
      metricAlias: SECURITY_PATCH_METRIC_ALIAS,
      filterType: FilterType.LessThanOrEqualTo,
      value: maxAge,
      // No dead band: an update to a patch from the last 90 days is up to date.
      recoveryValue: maxAge,
      metricAggregationType: EvaluateOverTimeType.AnyValue,
    });

    const criteria: MonitorCriteria = new MonitorCriteria();
    criteria.data = { monitorCriteriaInstanceArray: [unhealthy, healthy] };
    step.setMonitorCriteria(criteria);

    return step;
  };

  return {
    id: spec.id,
    provider: spec.provider,
    name: spec.name,
    summary: spec.summary,
    description: `Alert when an Android device ${spec.serviceName} manages has a security patch level more than 90 days old, one alert per device, resolved once it is updated. Android Enterprise Recommended devices get each monthly Android security bulletin within 90 days, so a device further behind misses fixes for known vulnerabilities. Every read of the connection records how old each device's patch level is. A device that runs the OneUptime Android agent is left to its host's Security Patch Out of Date.`,
    category: "Security",
    severity: "Warning",
    monitoringInterval: MANAGED_DEVICE_ALERT_MONITORING_INTERVAL,
    metricName: MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME,
    maxSecurityPatchAgeInDays: maxAge,
    platforms: [ManagedDevicePlatform.Android],
    getMonitorStep: (args: ManagedDeviceAlertTemplateArgs): MonitorStep => {
      return buildStep(args, spec.provider);
    },
    // A monitor made before the query read its service (#10098).
    getEarlierMonitorSteps: (
      args: ManagedDeviceAlertTemplateArgs,
    ): Array<MonitorStep> => {
      return [buildStep(args, undefined)];
    },
  };
}

const esperSecurityPatchOutOfDateTemplate: ManagedDeviceAlertTemplate =
  buildSecurityPatchTemplate({
    id: "esper-security-patch-out-of-date",
    provider: DeviceManagementProvider.Esper,
    name: "Esper Security Patch Out of Date",
    summary:
      "An Android device Esper manages has a security patch over 90 days old.",
    serviceName: "Esper",
  });

const intuneSecurityPatchOutOfDateTemplate: ManagedDeviceAlertTemplate =
  buildSecurityPatchTemplate({
    id: "intune-security-patch-out-of-date",
    provider: DeviceManagementProvider.Intune,
    name: "Intune Security Patch Out of Date",
    summary:
      "An Android device Intune manages has a security patch over 90 days old.",
    serviceName: "Intune",
  });

const workspaceOneSecurityPatchOutOfDateTemplate: ManagedDeviceAlertTemplate =
  buildSecurityPatchTemplate({
    id: "workspace-one-security-patch-out-of-date",
    provider: DeviceManagementProvider.WorkspaceOne,
    name: "Workspace ONE Security Patch Out of Date",
    summary:
      "An Android device Workspace ONE manages has a patch over 90 days old.",
    serviceName: "Workspace ONE",
  });

const sotiSecurityPatchOutOfDateTemplate: ManagedDeviceAlertTemplate =
  buildSecurityPatchTemplate({
    id: "soti-security-patch-out-of-date",
    provider: DeviceManagementProvider.Soti,
    name: "SOTI Security Patch Out of Date",
    summary:
      "An Android device MobiControl manages has a patch over 90 days old.",
    serviceName: "MobiControl",
  });

// What a battery or storage template says, for its service.
interface DeviceReadingTemplateSpec {
  id: string;
  provider: DeviceManagementProvider;
  name: string;
  summary: string;
  // The service as a sentence names it: "Esper", "Intune", "MobiControl".
  serviceName: string;
  /*
   * Which devices the service says it of, when not every one with a
   * battery: a sentence of its own, said after what the template does.
   */
  devicesNote?: string | undefined;
}

/*
 * Low Battery, for one service's devices (#10008): each device's latest
 * reading of its battery, under 20% fires, one alert per device; 20% or
 * more resolves. No dead band: a battery only falls between two reads
 * until it is charged, and then it climbs past the threshold.
 */
function buildLowBatteryTemplate(
  spec: DeviceReadingTemplateSpec,
): ManagedDeviceAlertTemplate {
  // The words write the number out, "20%", as the agent's template's do.
  const minPercent: number = MANAGED_DEVICE_LOW_BATTERY_PERCENT;

  return {
    id: spec.id,
    provider: spec.provider,
    name: spec.name,
    summary: spec.summary,
    description: `Alert when a device ${spec.serviceName} manages reports less than 20% battery, one alert per device, resolved once it reports 20% or more: a handheld is about to shut down, or a kiosk lost its power, and a device that runs out stops checking in. Every read of the connection records each device's battery as ${spec.serviceName} last heard it.${spec.devicesNote ? ` ${spec.devicesNote}` : ""} A device without a battery reports none and never raises it. A device that runs the OneUptime Android agent is left to its host's Low Battery.`,
    category: "Resource",
    severity: "Warning",
    monitoringInterval: MANAGED_DEVICE_ALERT_MONITORING_INTERVAL,
    metricName: MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME,
    minBatteryPercent: minPercent,
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
        buildManagedDeviceBatteryMetricMonitor({
          deviceManagementConnectionId: args.deviceManagementConnectionId,
          provider: spec.provider,
        }),
      );

      const unhealthy: MonitorCriteriaInstance = buildUnhealthyCriteriaInstance(
        {
          offlineMonitorStatusId: args.offlineMonitorStatusId,
          incidentSeverityId: args.defaultIncidentSeverityId,
          alertSeverityId: args.defaultAlertSeverityId,
          monitorName: args.monitorName,
          metricAlias: BATTERY_METRIC_ALIAS,
          filterType: FilterType.LessThan,
          value: minPercent,
          incidentTitle: `[${getDeviceManagementProviderShortTitle(spec.provider)}] Low battery`,
          incidentDescription: `A device ${spec.serviceName} manages reports less than 20% battery, so it will shut down soon unless it is charged, and then stops checking in. Put it on its charger or swap its battery; a kiosk or a terminal meant to stay on power has lost it, so check its cable, adapter and socket. The battery is the one the device last reported to ${spec.serviceName}. This resolves on its own once it reports 20% or more.`,
          criteriaName: "A device's battery is low",
          criteriaDescription:
            "Triggers when a device's latest reading says its battery is below 20%, once for each such device.",
          resourceNoun: "device",
          // Each device holds one reading here, its latest: Any Value is that reading.
          metricAggregationType: EvaluateOverTimeType.AnyValue,
        },
      );

      const healthy: MonitorCriteriaInstance = buildHealthyCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias: BATTERY_METRIC_ALIAS,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: minPercent,
        recoveryValue: minPercent,
        metricAggregationType: EvaluateOverTimeType.AnyValue,
      });

      const criteria: MonitorCriteria = new MonitorCriteria();
      criteria.data = { monitorCriteriaInstanceArray: [unhealthy, healthy] };
      step.setMonitorCriteria(criteria);

      return step;
    },
  };
}

/*
 * Storage Nearly Full, for one service's devices (#10008): each device's
 * latest reading of how much of its own storage is in use, more than 90%
 * fires, one alert per device; 90% or less resolves.
 */
function buildStorageNearlyFullTemplate(
  spec: DeviceReadingTemplateSpec,
): ManagedDeviceAlertTemplate {
  // The words write the number out, "90%", as the agent's template's do.
  const maxPercent: number = MANAGED_DEVICE_STORAGE_NEARLY_FULL_PERCENT;

  return {
    id: spec.id,
    provider: spec.provider,
    name: spec.name,
    summary: spec.summary,
    description: `Alert when a device ${spec.serviceName} manages has more than 90% of its own storage in use, one alert per device, resolved once it has 90% or less: a device refuses app installs and updates as its storage fills, and apps that keep caches or logs start failing. Every read of the connection records how full each device's storage is, as ${spec.serviceName} last heard it. A device that reports no free space never raises it. A device that runs the OneUptime Android agent is left to its host's Storage Nearly Full.`,
    category: "Resource",
    severity: "Warning",
    monitoringInterval: MANAGED_DEVICE_ALERT_MONITORING_INTERVAL,
    metricName: MANAGED_DEVICE_STORAGE_USED_METRIC_NAME,
    maxStorageUsedPercent: maxPercent,
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
        buildManagedDeviceStorageMetricMonitor({
          deviceManagementConnectionId: args.deviceManagementConnectionId,
          provider: spec.provider,
        }),
      );

      const unhealthy: MonitorCriteriaInstance = buildUnhealthyCriteriaInstance(
        {
          offlineMonitorStatusId: args.offlineMonitorStatusId,
          incidentSeverityId: args.defaultIncidentSeverityId,
          alertSeverityId: args.defaultAlertSeverityId,
          monitorName: args.monitorName,
          metricAlias: STORAGE_METRIC_ALIAS,
          filterType: FilterType.GreaterThan,
          value: maxPercent,
          incidentTitle: `[${getDeviceManagementProviderShortTitle(spec.provider)}] Storage nearly full`,
          incidentDescription: `A device ${spec.serviceName} manages has more than 90% of its own storage in use. As it fills, the device refuses app installs and updates, ${spec.serviceName}'s included, and apps that keep caches or logs start failing. Clear what its apps keep, or remove apps it does not need, through ${spec.serviceName}. This resolves on its own once ${spec.serviceName} reports 90% or less in use.`,
          criteriaName: "A device's storage is nearly full",
          criteriaDescription:
            "Triggers when a device's latest reading says more than 90% of its storage is in use, once for each such device.",
          resourceNoun: "device",
          // Each device holds one reading here, its latest: Any Value is that reading.
          metricAggregationType: EvaluateOverTimeType.AnyValue,
        },
      );

      const healthy: MonitorCriteriaInstance = buildHealthyCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias: STORAGE_METRIC_ALIAS,
        filterType: FilterType.LessThanOrEqualTo,
        value: maxPercent,
        recoveryValue: maxPercent,
        metricAggregationType: EvaluateOverTimeType.AnyValue,
      });

      const criteria: MonitorCriteria = new MonitorCriteria();
      criteria.data = { monitorCriteriaInstanceArray: [unhealthy, healthy] };
      step.setMonitorCriteria(criteria);

      return step;
    },
  };
}

/*
 * Low Battery for every service. Esper's, Workspace ONE's and SOTI's device
 * lists say a device's battery; Intune's says none, so an Intune
 * connection's reads ask each iPhone and iPad on its own, once it has
 * checked in since it was last asked (#10287): Graph's beta
 * hardwareInformation holds a battery level of an iOS or iPadOS device
 * alone, as of its last check-in.
 */
const esperLowBatteryTemplate: ManagedDeviceAlertTemplate =
  buildLowBatteryTemplate({
    id: "esper-low-battery",
    provider: DeviceManagementProvider.Esper,
    name: "Esper Low Battery",
    summary: "A device Esper manages has less than 20% battery left.",
    serviceName: "Esper",
  });

const intuneLowBatteryTemplate: ManagedDeviceAlertTemplate =
  buildLowBatteryTemplate({
    id: "intune-low-battery",
    provider: DeviceManagementProvider.Intune,
    name: "Intune Low Battery",
    summary: "An iPhone or iPad Intune manages has less than 20% battery left.",
    serviceName: "Intune",
    devicesNote:
      "Intune says the battery of an iPhone or an iPad alone, as of its last check-in, about every eight hours.",
  });

const workspaceOneLowBatteryTemplate: ManagedDeviceAlertTemplate =
  buildLowBatteryTemplate({
    id: "workspace-one-low-battery",
    provider: DeviceManagementProvider.WorkspaceOne,
    name: "Workspace ONE Low Battery",
    summary: "A device Workspace ONE manages has less than 20% battery left.",
    serviceName: "Workspace ONE",
  });

const sotiLowBatteryTemplate: ManagedDeviceAlertTemplate =
  buildLowBatteryTemplate({
    id: "soti-low-battery",
    provider: DeviceManagementProvider.Soti,
    name: "SOTI Low Battery",
    summary: "A device MobiControl manages has less than 20% battery left.",
    serviceName: "MobiControl",
  });

// Storage Nearly Full for every service: each says a device's storage and its free space.
const esperStorageNearlyFullTemplate: ManagedDeviceAlertTemplate =
  buildStorageNearlyFullTemplate({
    id: "esper-storage-nearly-full",
    provider: DeviceManagementProvider.Esper,
    name: "Esper Storage Nearly Full",
    summary: "A device Esper manages has more than 90% of its storage in use.",
    serviceName: "Esper",
  });

const intuneStorageNearlyFullTemplate: ManagedDeviceAlertTemplate =
  buildStorageNearlyFullTemplate({
    id: "intune-storage-nearly-full",
    provider: DeviceManagementProvider.Intune,
    name: "Intune Storage Nearly Full",
    summary: "A device Intune manages has more than 90% of its storage in use.",
    serviceName: "Intune",
  });

const workspaceOneStorageNearlyFullTemplate: ManagedDeviceAlertTemplate =
  buildStorageNearlyFullTemplate({
    id: "workspace-one-storage-nearly-full",
    provider: DeviceManagementProvider.WorkspaceOne,
    name: "Workspace ONE Storage Nearly Full",
    summary:
      "A device Workspace ONE manages has over 90% of its storage in use.",
    serviceName: "Workspace ONE",
  });

const sotiStorageNearlyFullTemplate: ManagedDeviceAlertTemplate =
  buildStorageNearlyFullTemplate({
    id: "soti-storage-nearly-full",
    provider: DeviceManagementProvider.Soti,
    name: "SOTI Storage Nearly Full",
    summary:
      "A device MobiControl manages has more than 90% of its storage in use.",
    serviceName: "MobiControl",
  });

/*
 * Each service's templates in the order its connection is offered them: the
 * connection itself first, which feeds every other one, then its devices'
 * check-ins, their batteries and their storage, then its Android devices'
 * security patches.
 */
const ALL_TEMPLATES: ReadonlyArray<ManagedDeviceAlertTemplate> = [
  esperConnectionStoppedReadingTemplate,
  esperAndroidDeviceStoppedCheckingInTemplate,
  esperAppleDeviceStoppedCheckingInTemplate,
  esperLowBatteryTemplate,
  esperStorageNearlyFullTemplate,
  esperSecurityPatchOutOfDateTemplate,
  intuneConnectionStoppedReadingTemplate,
  intuneDeviceStoppedCheckingInTemplate,
  intuneLowBatteryTemplate,
  intuneStorageNearlyFullTemplate,
  intuneSecurityPatchOutOfDateTemplate,
  workspaceOneConnectionStoppedReadingTemplate,
  workspaceOneDeviceStoppedCheckingInTemplate,
  workspaceOneLowBatteryTemplate,
  workspaceOneStorageNearlyFullTemplate,
  workspaceOneSecurityPatchOutOfDateTemplate,
  sotiConnectionStoppedReadingTemplate,
  sotiDeviceStoppedCheckingInTemplate,
  sotiAppleDeviceStoppedCheckingInTemplate,
  sotiLowBatteryTemplate,
  sotiStorageNearlyFullTemplate,
  sotiSecurityPatchOutOfDateTemplate,
];

// Every template, of every service.
export function getAllManagedDeviceAlertTemplates(): Array<ManagedDeviceAlertTemplate> {
  return [...ALL_TEMPLATES];
}

/*
 * The templates a connection of a service is offered. A connection whose
 * service is not known is Esper's, as every connection was before #9837.
 */
export function getManagedDeviceAlertTemplatesFor(
  provider: DeviceManagementProvider | string | undefined | null,
): Array<ManagedDeviceAlertTemplate> {
  const service: string = provider || DeviceManagementProvider.Esper;

  return ALL_TEMPLATES.filter(
    (template: ManagedDeviceAlertTemplate): boolean => {
      return template.provider === service;
    },
  );
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

// Whether a monitor made from a template may have another step than the template's own.
export function hasManagedDeviceAlertTemplateEquivalentSteps(
  template: ManagedDeviceAlertTemplate,
): boolean {
  return Boolean(
    template.followsReadInterval || template.getEarlierMonitorSteps,
  );
}

/*
 * The other steps a monitor made from a template may have and still be it
 * (MonitorRecommendation.getEquivalentMonitorSteps), each of which counts
 * as made, so the template is never offered a second time:
 *
 *   - those of an earlier version of it (getEarlierMonitorSteps): a
 *     check-in or security patch template's from before its query read its
 *     service;
 *   - Connection Stopped Reading's at each wait another read interval a
 *     connection may have gives it, for a monitor made before its
 *     connection's interval changed, which keeps the wait it was made
 *     with. No other template's step follows the interval.
 */
export function getManagedDeviceAlertTemplateEquivalentSteps(
  template: ManagedDeviceAlertTemplate,
  args: ManagedDeviceAlertTemplateArgs,
): Array<MonitorStep> {
  const steps: Array<MonitorStep> = [
    ...(template.getEarlierMonitorSteps?.(args) || []),
  ];

  if (!template.followsReadInterval) {
    return steps;
  }

  const waits: Set<number> = new Set<number>([
    getManagedDeviceConnectionStoppedReadingMinutes(args.readIntervalInMinutes),
  ]);

  for (const interval of DEVICE_MANAGEMENT_READ_INTERVALS_IN_MINUTES) {
    const wait: number =
      getManagedDeviceConnectionStoppedReadingMinutes(interval);

    if (waits.has(wait)) {
      continue;
    }

    waits.add(wait);
    steps.push(
      template.getMonitorStep({ ...args, readIntervalInMinutes: interval }),
    );
  }

  return steps;
}
