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
import DeviceManagementProvider from "../DeviceManagement/DeviceManagementProvider";
import {
  MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME,
  MANAGED_DEVICE_CHECK_IN_AGE_UNIT,
  ManagedDeviceCheckInAttribute,
} from "../DeviceManagement/ManagedDeviceCheckIn";
import { ManagedDevicePlatform } from "../DeviceManagement/ManagedDevicePlatform";
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
 *     on Managed Devices says why.
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
  // The minutes of silence it fires after.
  thresholdInMinutes: number;
  // The platforms it reads; none is every device of the connection.
  platforms?: ReadonlyArray<ManagedDevicePlatform> | undefined;
  getMonitorStep: (args: ManagedDeviceAlertTemplateArgs) => MonitorStep;
}

/*
 * The query of a connection's devices' check-ins: the minutes since each
 * one's last check-in, the devices no agent reports - of the given
 * platforms, where the template reads some apart - one series per device.
 * Max per minute: two reads in one minute ("Read now" beside a scheduled
 * one) say the longer silence, never a mix of the two.
 */
export function buildManagedDeviceCheckInMetricMonitor(data: {
  deviceManagementConnectionId: string;
  platforms?: ReadonlyArray<ManagedDevicePlatform> | undefined;
}): MonitorStepMetricMonitor {
  const attributes: Dictionary<string | Includes> = {
    [ManagedDeviceCheckInAttribute.ConnectionId]:
      data.deviceManagementConnectionId,
    // A device the Android agent reports is Host Stopped Reporting's.
    [ManagedDeviceCheckInAttribute.IsHost]: "false",
  };

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
              attributes: attributes,
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
  return {
    id: spec.id,
    provider: spec.provider,
    name: spec.name,
    summary: spec.summary,
    description: spec.description,
    category: "Availability",
    severity: "Warning",
    monitoringInterval: MANAGED_DEVICE_ALERT_MONITORING_INTERVAL,
    thresholdInMinutes: spec.thresholdInMinutes,
    platforms: spec.platforms,
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
          platforms: spec.platforms,
        }),
      );

      const unhealthy: MonitorCriteriaInstance = buildUnhealthyCriteriaInstance(
        {
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
           * (judgeLatestReading): Any Value is that reading. All Values
           * would also ask one reading to cover the two-hour window, which a
           * reading taken every 15 minutes never does (MetricWindowCoverage).
           */
          metricAggregationType: EvaluateOverTimeType.AnyValue,
        },
      );

      const healthy: MonitorCriteriaInstance = buildHealthyCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias: METRIC_ALIAS,
        filterType: FilterType.LessThanOrEqualTo,
        value: spec.thresholdInMinutes,
        /*
         * No dead band: a device that checks in again reads a few minutes,
         * nowhere near the threshold, and a band would only keep the
         * monitor offline for a device that reads exactly the threshold.
         */
        recoveryValue: spec.thresholdInMinutes,
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
    summary:
      "A device has not reported to Workspace ONE for more than a day.",
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

const ALL_TEMPLATES: ReadonlyArray<ManagedDeviceAlertTemplate> = [
  esperAndroidDeviceStoppedCheckingInTemplate,
  esperAppleDeviceStoppedCheckingInTemplate,
  intuneDeviceStoppedCheckingInTemplate,
  workspaceOneDeviceStoppedCheckingInTemplate,
  sotiDeviceStoppedCheckingInTemplate,
  sotiAppleDeviceStoppedCheckingInTemplate,
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
