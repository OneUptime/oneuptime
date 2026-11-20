import {
  MANAGED_DEVICE_ALERT_MONITORING_INTERVAL,
  MANAGED_DEVICE_APPLE_PLATFORMS,
  MANAGED_DEVICE_NON_APPLE_PLATFORMS,
  MANAGED_DEVICE_CHECK_IN_GROUP_BY_ATTRIBUTES,
  MANAGED_DEVICE_CHECK_IN_ROLLING_TIME,
  MANAGED_DEVICE_STOPPED_CHECKING_IN_MINUTES,
  MANAGED_DEVICE_STOPPED_SYNCING_MINUTES,
  ManagedDeviceAlertTemplate,
  ManagedDeviceAlertTemplateArgs,
  buildManagedDeviceCheckInMetricMonitor,
  getAllManagedDeviceAlertTemplates,
  getManagedDeviceAlertTemplateById,
  getManagedDeviceAlertTemplatesFor,
} from "../../../Types/Monitor/ManagedDeviceAlertTemplates";
import {
  MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME,
  MANAGED_DEVICE_CHECK_IN_AGE_UNIT,
  ManagedDeviceCheckInAttribute,
} from "../../../Types/DeviceManagement/ManagedDeviceCheckIn";
import DeviceManagementProvider from "../../../Types/DeviceManagement/DeviceManagementProvider";
import { ManagedDevicePlatform } from "../../../Types/DeviceManagement/ManagedDevicePlatform";
import {
  MANAGED_DEVICE_ONLINE_WINDOW_MINUTES,
  MANAGED_DEVICE_SYNC_ONLINE_WINDOW_MINUTES,
} from "../../../Types/DeviceManagement/ManagedDeviceStatus";
import Includes from "../../../Types/BaseDatabase/Includes";
import { DEVICE_MANAGEMENT_READ_INTERVALS_IN_MINUTES } from "../../../Types/DeviceManagement/DeviceManagementConnectionSettings";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorStepMetricMonitor from "../../../Types/Monitor/MonitorStepMetricMonitor";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../Types/RollingTime/RollingTimeUtil";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
  MonitorRecommendationNotificationMode,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import MonitorRecommendationUtil, {
  MonitorRecommendationFingerprint,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationUtil";
import SeriesDebugHints from "../../../Types/Monitor/SeriesContext/SeriesDebugHints";
import SeriesLabelDisplay from "../../../Types/Monitor/SeriesContext/SeriesLabelDisplay";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * Esper Device Stopped Checking In (#9835): one Metrics monitor per Esper
 * connection, over the minutes since each device last checked in that
 * every read writes (ManagedDeviceCheckIn), alerting once per device that
 * has been quiet for more than an hour - and never for a device the
 * Android agent reports, which Host Stopped Reporting watches.
 */

const CONNECTION_ID: string = ObjectID.generate().toString();

function buildArgs(
  overrides: Partial<ManagedDeviceAlertTemplateArgs> = {},
): ManagedDeviceAlertTemplateArgs {
  return {
    deviceManagementConnectionId: CONNECTION_ID,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Esper acme - Esper Device Stopped Checking In",
    ...overrides,
  };
}

function template(): ManagedDeviceAlertTemplate {
  return getManagedDeviceAlertTemplateById("esper-device-stopped-checking-in")!;
}

function appleTemplate(): ManagedDeviceAlertTemplate {
  return getManagedDeviceAlertTemplateById(
    "esper-apple-device-stopped-checking-in",
  )!;
}

function stepOf(
  args: ManagedDeviceAlertTemplateArgs = buildArgs(),
): MonitorStep {
  return template().getMonitorStep(args);
}

function metricMonitorOf(step: MonitorStep): MonitorStepMetricMonitor {
  return step.data!.metricMonitor!;
}

function queryOf(step: MonitorStep): MetricQueryConfigData {
  return metricMonitorOf(step).metricViewConfig.queryConfigs[0]!;
}

function instancesOf(step: MonitorStep): Array<MonitorCriteriaInstance> {
  return step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;
}

function filterOf(instance: MonitorCriteriaInstance): CriteriaFilter {
  return instance.data!.filters[0]!;
}

describe("the catalog of a connection's alerts", () => {
  test("is an Esper connection's Android devices and its Apple devices, an Intune connection's devices, a Workspace ONE connection's, and a SOTI connection's devices and its Apple devices, each stopped checking in, and each service's Android devices behind on security patches", () => {
    expect(
      getAllManagedDeviceAlertTemplates().map(
        (candidate: ManagedDeviceAlertTemplate) => {
          return candidate.id;
        },
      ),
    ).toEqual([
      // #10006: each service's connection itself, first: it feeds the rest.
      "esper-connection-stopped-reading",
      "esper-device-stopped-checking-in",
      "esper-apple-device-stopped-checking-in",
      "esper-security-patch-out-of-date",
      "intune-connection-stopped-reading",
      "intune-device-stopped-checking-in",
      "intune-security-patch-out-of-date",
      "workspace-one-connection-stopped-reading",
      "workspace-one-device-stopped-checking-in",
      "workspace-one-security-patch-out-of-date",
      "soti-connection-stopped-reading",
      "soti-device-stopped-checking-in",
      "soti-apple-device-stopped-checking-in",
      "soti-security-patch-out-of-date",
    ]);
    expect(template().name).toBe("Esper Android Device Stopped Checking In");
    expect(appleTemplate().name).toBe("Esper Apple Device Stopped Checking In");
    expect(getManagedDeviceAlertTemplateById("nope")).toBeUndefined();
  });

  test("says when it fires in one sentence, and why on the card behind it", () => {
    expect(template().summary).toBe(
      "An Android device has not checked in with Esper for more than an hour.",
    );
    expect(template().description).toContain("one alert per device");
    expect(template().description).toContain("Host Stopped Reporting");
    expect(template().category).toBe("Availability");
    expect(template().severity).toBe("Warning");
    expect(appleTemplate().summary).toBe(
      "An iPhone, iPad or Apple TV has not checked in with Esper for more than a day.",
    );
    expect(appleTemplate().description).toContain("one alert per device");
    expect(appleTemplate().description).toContain("Apple's push service");
  });

  test("is offered to every Esper connection, and to one whose service is not known, as recommendations of its own resource type", () => {
    for (const context of [
      undefined,
      { deviceManagementProvider: null },
      { deviceManagementProvider: DeviceManagementProvider.Esper },
    ]) {
      expect(
        MonitorRecommendationCatalog.getRecommendations(
          MonitorRecommendationResourceType.DeviceManagementConnection,
          context,
        ).map((recommendation: MonitorRecommendation) => {
          return recommendation.recommendationId;
        }),
      ).toEqual([
        // #10006: the connection itself stopped reading.
        "DeviceManagementConnection:esper-connection-stopped-reading",
        "DeviceManagementConnection:esper-device-stopped-checking-in",
        "DeviceManagementConnection:esper-apple-device-stopped-checking-in",
        // #10098: its Android devices behind on their security patches.
        "DeviceManagementConnection:esper-security-patch-out-of-date",
      ]);
    }

    const recommendations: Array<MonitorRecommendation> =
      MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.DeviceManagementConnection,
      );
    const checkIns: MonitorRecommendation = recommendations.find(
      (recommendation: MonitorRecommendation) => {
        return recommendation.templateId === template().id;
      },
    )!;

    expect(checkIns.monitorType).toBe(MonitorType.Metrics);
    expect(checkIns.summary).toBe(template().summary);
    // Evaluated as often as a reading can arrive, not every minute.
    for (const recommendation of recommendations) {
      expect(recommendation.monitoringInterval).toBe("*/5 * * * *");
    }
    expect(MANAGED_DEVICE_ALERT_MONITORING_INTERVAL).toBe("*/5 * * * *");

    // A service with no templates of its own is offered none of Esper's.
    expect(
      MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.DeviceManagementConnection,
        { deviceManagementProvider: "another-service" },
      ),
    ).toEqual([]);
    expect(getManagedDeviceAlertTemplatesFor("another-service")).toEqual([]);

    const definition: ReturnType<
      typeof MonitorRecommendationCatalog.getResourceTypeDefinition
    > = MonitorRecommendationCatalog.getResourceTypeDefinition(
      MonitorRecommendationResourceType.DeviceManagementConnection,
    );

    expect(definition!.resourceLabel).toBe("Device Management Connection");
    expect(definition!.identifierFieldName).toBe(
      "deviceManagementConnectionId",
    );
    expect(definition!.monitorTypes).toEqual([MonitorType.Metrics]);
  });

  /*
   * #9837: an Intune connection's devices - every platform - check in about
   * every eight hours, so its template fires after a day, the Offline
   * window of a device that syncs.
   */
  test("an Intune connection is offered its own: every device it manages, after a day", () => {
    const intune: ManagedDeviceAlertTemplate =
      getManagedDeviceAlertTemplateById("intune-device-stopped-checking-in")!;

    expect(
      MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.DeviceManagementConnection,
        { deviceManagementProvider: DeviceManagementProvider.Intune },
      ).map((recommendation: MonitorRecommendation) => {
        return recommendation.recommendationId;
      }),
    ).toEqual([
      "DeviceManagementConnection:intune-connection-stopped-reading",
      "DeviceManagementConnection:intune-device-stopped-checking-in",
      "DeviceManagementConnection:intune-security-patch-out-of-date",
    ]);
    expect(intune.name).toBe("Intune Device Stopped Checking In");
    expect(intune.summary).toBe(
      "A device has not checked in with Intune for more than a day.",
    );
    expect(intune.thresholdInMinutes).toBe(24 * 60);
    expect(intune.platforms).toBeUndefined();
    expect(intune.description).toContain("Host Stopped Reporting");

    const step: MonitorStep = intune.getMonitorStep(
      buildArgs({ monitorName: "Contoso devices" }),
    );
    const attributes: Record<string, unknown> =
      (queryOf(step).metricQueryData.filterData.attributes as Record<
        string,
        unknown
      >) || {};

    // Every device of the connection: no platform is named.
    expect(Object.keys(attributes).sort()).toEqual(
      [
        ManagedDeviceCheckInAttribute.ConnectionId,
        ManagedDeviceCheckInAttribute.IsHost,
      ].sort(),
    );
  });
});

describe("what the monitor reads", () => {
  test("the minutes since each device's last check-in, of this connection's devices", () => {
    const query: MetricQueryConfigData = queryOf(stepOf());

    expect(query.metricQueryData.filterData.metricName).toBe(
      MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME,
    );
    expect(query.metricQueryData.filterData.attributes).toEqual({
      [ManagedDeviceCheckInAttribute.ConnectionId]: CONNECTION_ID,
      [ManagedDeviceCheckInAttribute.IsHost]: "false",
      // An Apple device checks in hours apart: it has a template of its own.
      [ManagedDeviceCheckInAttribute.Platform]: ManagedDevicePlatform.Android,
    });
    expect(query.metricAliasData!.legendUnit).toBe(
      MANAGED_DEVICE_CHECK_IN_AGE_UNIT,
    );
  });

  test("the Apple template reads the connection's iPhones, iPads, Apple TVs and Macs, and no Android device", () => {
    const query: MetricQueryConfigData = queryOf(
      appleTemplate().getMonitorStep(buildArgs()),
    );
    const attributes: Record<string, unknown> = query.metricQueryData.filterData
      .attributes as Record<string, unknown>;
    const platforms: unknown =
      attributes[ManagedDeviceCheckInAttribute.Platform];

    expect(attributes[ManagedDeviceCheckInAttribute.ConnectionId]).toBe(
      CONNECTION_ID,
    );
    expect(attributes[ManagedDeviceCheckInAttribute.IsHost]).toBe("false");
    expect(platforms).toBeInstanceOf(Includes);
    expect((platforms as Includes).values).toEqual([
      ManagedDevicePlatform.IOS,
      ManagedDevicePlatform.IPadOS,
      ManagedDevicePlatform.TvOS,
      ManagedDevicePlatform.MacOS,
    ]);
    expect(MANAGED_DEVICE_APPLE_PLATFORMS).not.toContain(
      ManagedDevicePlatform.Android,
    );
  });

  test("the Apple template fires after a day, its offline window, and resolves the same way", () => {
    const [unhealthy, healthy]: Array<MonitorCriteriaInstance> = instancesOf(
      appleTemplate().getMonitorStep(buildArgs()),
    );

    expect(MANAGED_DEVICE_STOPPED_SYNCING_MINUTES).toBe(24 * 60);
    expect(MANAGED_DEVICE_STOPPED_SYNCING_MINUTES).toBe(
      MANAGED_DEVICE_SYNC_ONLINE_WINDOW_MINUTES,
    );
    expect(appleTemplate().thresholdInMinutes).toBe(24 * 60);
    expect(filterOf(unhealthy!).filterType).toBe(FilterType.GreaterThan);
    expect(Number(filterOf(unhealthy!).value)).toBe(24 * 60);
    expect(filterOf(healthy!).filterType).toBe(FilterType.LessThanOrEqualTo);
    expect(Number(filterOf(healthy!).value)).toBe(24 * 60);
    expect(unhealthy!.data!.alerts[0]!.title).toBe(
      "[Esper] Apple device stopped checking in",
    );
    expect(unhealthy!.data!.alerts[0]!.description).toContain(
      "more than a day",
    );
  });

  test("the two Esper templates are told apart when one is made: neither covers the other", () => {
    const recommendations: Array<MonitorRecommendation> =
      MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.DeviceManagementConnection,
      );
    const args: MonitorRecommendationArgs = {
      resourceIdentifier: CONNECTION_ID,
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      monitorName: "Esper acme",
    };

    expect(
      Array.from(
        MonitorRecommendationUtil.getCoveredRecommendationIds({
          recommendations,
          existingMonitorSteps: [
            recommendations
              .find((recommendation: MonitorRecommendation) => {
                return recommendation.templateId === appleTemplate().id;
              })!
              .getMonitorStep(args),
          ],
          args,
        }),
      ),
    ).toEqual([
      "DeviceManagementConnection:esper-apple-device-stopped-checking-in",
    ]);
  });

  test("leaves out every device the Android agent reports: Host Stopped Reporting watches those", () => {
    expect(
      (
        queryOf(stepOf()).metricQueryData.filterData.attributes as Record<
          string,
          string
        >
      )["oneuptime.managed_device.is_host"],
    ).toBe("false");
  });

  test("one series per device, by its name in Esper, never its alias", () => {
    const query: MetricQueryConfigData = queryOf(stepOf());

    expect(query.metricQueryData.groupByAttributeKeys).toEqual([
      "oneuptime.managed_device.name",
    ]);
    expect(MANAGED_DEVICE_CHECK_IN_GROUP_BY_ATTRIBUTES).toEqual([
      ManagedDeviceCheckInAttribute.DeviceName,
    ]);
    // Max per minute: two reads in a minute say the longer silence.
    expect(query.metricQueryData.filterData.aggegationType).toBe(
      MetricsAggregationType.Max,
    );
  });

  test("each device on its latest reading, over a window that holds a read at the longest interval", () => {
    const monitor: MonitorStepMetricMonitor = metricMonitorOf(stepOf());

    expect(monitor.judgeLatestReading).toBe(true);
    expect(monitor.rollingTime).toBe(RollingTime.Past2Hours);
    expect(MANAGED_DEVICE_CHECK_IN_ROLLING_TIME).toBe(RollingTime.Past2Hours);

    const window: { startValue: Date; endValue: Date } =
      RollingTimeUtil.convertToStartAndEndDate(
        MANAGED_DEVICE_CHECK_IN_ROLLING_TIME,
        new Date("2026-11-19T12:00:00.000Z"),
      ) as unknown as { startValue: Date; endValue: Date };
    const windowMinutes: number =
      (window.endValue.getTime() - window.startValue.getTime()) / 60_000;

    // A read at the longest interval (an hour), and a late or failed one after it.
    expect(Math.max(...DEVICE_MANAGEMENT_READ_INTERVALS_IN_MINUTES)).toBe(60);
    expect(windowMinutes).toBeGreaterThanOrEqual(
      2 * Math.max(...DEVICE_MANAGEMENT_READ_INTERVALS_IN_MINUTES),
    );
  });

  test("the query alone, for another page to build on, reads the same", () => {
    expect(
      buildManagedDeviceCheckInMetricMonitor({
        deviceManagementConnectionId: CONNECTION_ID,
        platforms: [ManagedDevicePlatform.Android],
      }),
    ).toEqual(metricMonitorOf(stepOf()));

    // With no platforms, it reads every device of the connection.
    expect(
      Object.keys(
        buildManagedDeviceCheckInMetricMonitor({
          deviceManagementConnectionId: CONNECTION_ID,
        }).metricViewConfig.queryConfigs[0]!.metricQueryData.filterData
          .attributes || {},
      ),
    ).toEqual([
      ManagedDeviceCheckInAttribute.ConnectionId,
      ManagedDeviceCheckInAttribute.IsHost,
    ]);
  });

  test("is a valid monitor step", () => {
    const steps: MonitorSteps = new MonitorSteps();
    steps.data = {
      monitorStepsInstanceArray: [stepOf()],
      defaultMonitorStatusId: ObjectID.generate(),
    };

    expect(MonitorSteps.getValidationError(steps, MonitorType.Metrics)).toBe(
      null,
    );
  });
});

describe("when it fires, and when it resolves", () => {
  test("fires on a device quiet for more than an hour, twice Esper's own offline window", () => {
    const [unhealthy]: Array<MonitorCriteriaInstance> = instancesOf(stepOf());
    const filter: CriteriaFilter = filterOf(unhealthy!);

    expect(MANAGED_DEVICE_STOPPED_CHECKING_IN_MINUTES).toBe(60);
    expect(MANAGED_DEVICE_STOPPED_CHECKING_IN_MINUTES).toBe(
      2 * MANAGED_DEVICE_ONLINE_WINDOW_MINUTES,
    );
    expect(filter.checkOn).toBe(CheckOn.MetricValue);
    expect(filter.filterType).toBe(FilterType.GreaterThan);
    expect(Number(filter.value)).toBe(60);
    // The latest reading is the one value a device holds: any value is it.
    expect(filter.metricMonitorOptions?.metricAggregationType).toBe(
      EvaluateOverTimeType.AnyValue,
    );
    // Silence is never a breach here: no reading is no news.
    expect(filter.metricMonitorOptions?.onNoDataPolicy).toBeUndefined();
  });

  test("opens an alert that resolves itself, named for a device", () => {
    const [unhealthy]: Array<MonitorCriteriaInstance> = instancesOf(stepOf());

    expect(unhealthy!.data!.createAlerts).toBe(true);
    expect(unhealthy!.data!.alerts[0]!.autoResolveAlert).toBe(true);
    expect(unhealthy!.data!.alerts[0]!.title).toBe(
      "[Esper] Device stopped checking in",
    );
    expect(unhealthy!.data!.alerts[0]!.description).toContain(
      "more than an hour",
    );
    expect(unhealthy!.data!.incidents[0]!.autoResolveIncident).toBe(true);
    expect(unhealthy!.data!.name).toBe("A device stopped checking in");
  });

  test("made from the Recommendations page as it opens (Create an alert), it opens an alert and no incident", () => {
    const step: MonitorStep =
      MonitorRecommendationUtil.applyNotificationSettingsToMonitorStep({
        monitorStep: stepOf(),
        notificationSettings: {
          notificationMode: MonitorRecommendationNotificationMode.Alert,
        },
        severity: template().severity,
      });
    const [unhealthy]: Array<MonitorCriteriaInstance> = instancesOf(step);

    expect(unhealthy!.data!.createAlerts).toBe(true);
    expect(unhealthy!.data!.createIncidents).toBe(false);
  });

  test("resolves once the device's latest reading is an hour or less: no dead band", () => {
    const [, healthy]: Array<MonitorCriteriaInstance> = instancesOf(stepOf());
    const filter: CriteriaFilter = filterOf(healthy!);

    expect(filter.filterType).toBe(FilterType.LessThanOrEqualTo);
    expect(Number(filter.value)).toBe(60);
    expect(filter.metricMonitorOptions?.metricAggregationType).toBe(
      EvaluateOverTimeType.AnyValue,
    );
    expect(healthy!.data!.createAlerts).toBe(false);
    expect(healthy!.data!.createIncidents).toBe(false);
  });

  test("never names the monitor twice in the alert's title", () => {
    const [unhealthy]: Array<MonitorCriteriaInstance> = instancesOf(
      stepOf(buildArgs({ monitorName: "Esper acme - Something" })),
    );

    expect(unhealthy!.data!.alerts[0]!.title).not.toContain("Something");
  });
});

describe("the alert a device opens", () => {
  const seriesLabels: Record<string, string> = {
    "oneuptime.managed_device.name": "ESP-ID-AAAAW",
  };

  test("names the device, by a name a person reads", () => {
    expect(
      SeriesLabelDisplay.isKnownLabelKey("oneuptime.managed_device.name"),
    ).toBe(true);
    expect(
      SeriesLabelDisplay.getFriendlyLabelName("oneuptime.managed_device.name"),
    ).toBe("Device");
    expect(SeriesLabelDisplay.buildTitleSuffix(seriesLabels)).toBe(
      " - Device: ESP-ID-AAAAW",
    );
  });

  test("hands the engineer a first command: what the connection last read of the device", () => {
    expect(
      SeriesDebugHints.getDebugCommands({
        monitorType: MonitorType.Metrics,
        seriesLabels,
      }),
    ).toEqual([
      {
        purpose:
          "The device's last readings: how many minutes since it checked in at each read, its alias and its group",
        command: `oneuptime metric list --query '{"name":"oneuptime.managed_device.check_in.age","attributes":{"oneuptime.managed_device.name":"ESP-ID-AAAAW"}}' --sort '{"time":"DESC"}' --limit 5 --fields time,value,attributes`,
      },
      // A series names the device alone, of either template (#10098).
      {
        purpose:
          "An Android device's security patch at each read: how many days old it was, and its level",
        command: `oneuptime metric list --query '{"name":"oneuptime.managed_device.security_patch.age","attributes":{"oneuptime.managed_device.name":"ESP-ID-AAAAW"}}' --sort '{"time":"DESC"}' --limit 5 --fields time,value,attributes`,
      },
    ]);
  });
});

describe("whether a monitor already covers it", () => {
  function argsFor(connectionId: string): MonitorRecommendationArgs {
    return {
      resourceIdentifier: connectionId,
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      monitorName: "Esper - Esper Device Stopped Checking In",
    };
  }

  const recommendation: MonitorRecommendation =
    MonitorRecommendationCatalog.getRecommendations(
      MonitorRecommendationResourceType.DeviceManagementConnection,
    ).find((candidate: MonitorRecommendation) => {
      return candidate.templateId === "esper-device-stopped-checking-in";
    })!;

  test("names the connection as the resource the monitor watches", () => {
    const fingerprint: MonitorRecommendationFingerprint | undefined =
      MonitorRecommendationUtil.getFingerprintFromMonitorStep(
        recommendation.getMonitorStep(argsFor(CONNECTION_ID)),
      );

    expect(fingerprint!.resourceIdentifier).toBe(CONNECTION_ID);
    expect(fingerprint!.metricNames).toEqual([
      MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME,
    ]);
    // Judging each device's latest reading is part of what it watches.
    expect(fingerprint!.configValues).toContain("judgeLatestReading=true");
  });

  test("a monitor of this connection covers it; another connection's does not", () => {
    const other: string = ObjectID.generate().toString();

    expect(
      MonitorRecommendationUtil.getCoveredRecommendationIds({
        recommendations: [recommendation],
        existingMonitorSteps: [
          recommendation.getMonitorStep(argsFor(CONNECTION_ID)),
        ],
        args: argsFor(CONNECTION_ID),
      }).has(recommendation.recommendationId),
    ).toBe(true);

    expect(
      MonitorRecommendationUtil.getCoveredRecommendationIds({
        recommendations: [recommendation],
        existingMonitorSteps: [recommendation.getMonitorStep(argsFor(other))],
        args: argsFor(CONNECTION_ID),
      }).size,
    ).toBe(0);
  });

  test("a hand-made monitor of the same metric judged over its whole window does not", () => {
    const step: MonitorStep = recommendation.getMonitorStep(
      argsFor(CONNECTION_ID),
    );
    delete step.data!.metricMonitor!.judgeLatestReading;

    expect(
      MonitorRecommendationUtil.getCoveredRecommendationIds({
        recommendations: [recommendation],
        existingMonitorSteps: [step],
        args: argsFor(CONNECTION_ID),
      }).size,
    ).toBe(0);
  });
});

/*
 * #10086, #10087: a Workspace ONE connection's devices report on their own
 * schedule, hours apart, and are gone after a day; a SOTI agent keeps a
 * live connection - its Android, Windows and Linux devices are gone after
 * an hour - while its Apple devices check in through Apple's push and are
 * gone after a day. The two SOTI templates read their devices apart.
 */
describe("a Workspace ONE or SOTI connection's alerts", () => {
  function recommendedFor(provider: DeviceManagementProvider): Array<string> {
    return MonitorRecommendationCatalog.getRecommendations(
      MonitorRecommendationResourceType.DeviceManagementConnection,
      { deviceManagementProvider: provider },
    ).map((recommendation: MonitorRecommendation) => {
      return recommendation.recommendationId;
    });
  }

  function platformsRead(candidate: ManagedDeviceAlertTemplate): unknown {
    const step: MonitorStep = candidate.getMonitorStep(buildArgs());

    return (
      queryOf(step).metricQueryData.filterData.attributes as Record<
        string,
        unknown
      >
    )[ManagedDeviceCheckInAttribute.Platform];
  }

  test("a Workspace ONE connection is offered its own: every device it manages, after a day", () => {
    const workspaceOne: ManagedDeviceAlertTemplate =
      getManagedDeviceAlertTemplateById(
        "workspace-one-device-stopped-checking-in",
      )!;

    expect(recommendedFor(DeviceManagementProvider.WorkspaceOne)).toEqual([
      "DeviceManagementConnection:workspace-one-connection-stopped-reading",
      "DeviceManagementConnection:workspace-one-device-stopped-checking-in",
      "DeviceManagementConnection:workspace-one-security-patch-out-of-date",
    ]);
    expect(workspaceOne).toMatchObject({
      name: "Workspace ONE Device Stopped Checking In",
      provider: DeviceManagementProvider.WorkspaceOne,
      thresholdInMinutes: MANAGED_DEVICE_STOPPED_SYNCING_MINUTES,
      severity: "Warning",
      monitoringInterval: MANAGED_DEVICE_ALERT_MONITORING_INTERVAL,
    });
    expect(workspaceOne.summary).toBe(
      "A device has not reported to Workspace ONE for more than a day.",
    );
    expect(workspaceOne.platforms).toBeUndefined();
    expect(platformsRead(workspaceOne)).toBeUndefined();
    expect(workspaceOne.description).toContain("Host Stopped Reporting");
  });

  test("a SOTI connection is offered two: its agents' devices after an hour, its Apple devices after a day, never the same device twice", () => {
    const agents: ManagedDeviceAlertTemplate =
      getManagedDeviceAlertTemplateById("soti-device-stopped-checking-in")!;
    const apple: ManagedDeviceAlertTemplate = getManagedDeviceAlertTemplateById(
      "soti-apple-device-stopped-checking-in",
    )!;

    expect(recommendedFor(DeviceManagementProvider.Soti)).toEqual([
      "DeviceManagementConnection:soti-connection-stopped-reading",
      "DeviceManagementConnection:soti-device-stopped-checking-in",
      "DeviceManagementConnection:soti-apple-device-stopped-checking-in",
      "DeviceManagementConnection:soti-security-patch-out-of-date",
    ]);
    expect(agents.name).toBe("SOTI Device Stopped Checking In");
    expect(apple.name).toBe("SOTI Apple Device Stopped Checking In");
    // An hour: two of the half hour a device with a heartbeat is Offline after.
    expect(agents.thresholdInMinutes).toBe(
      MANAGED_DEVICE_STOPPED_CHECKING_IN_MINUTES,
    );
    expect(agents.thresholdInMinutes).toBe(
      2 * MANAGED_DEVICE_ONLINE_WINDOW_MINUTES,
    );
    expect(apple.thresholdInMinutes).toBe(
      MANAGED_DEVICE_SYNC_ONLINE_WINDOW_MINUTES,
    );

    expect(platformsRead(agents)).toEqual(
      new Includes([...MANAGED_DEVICE_NON_APPLE_PLATFORMS]),
    );
    expect(platformsRead(apple)).toEqual(
      new Includes([...MANAGED_DEVICE_APPLE_PLATFORMS]),
    );
    for (const platform of MANAGED_DEVICE_APPLE_PLATFORMS) {
      expect(MANAGED_DEVICE_NON_APPLE_PLATFORMS).not.toContain(platform);
    }
  });

  test("each hands the engineer a first step: what to check, and where the service shows it", () => {
    for (const id of [
      "workspace-one-device-stopped-checking-in",
      "soti-device-stopped-checking-in",
      "soti-apple-device-stopped-checking-in",
    ]) {
      const candidate: ManagedDeviceAlertTemplate =
        getManagedDeviceAlertTemplateById(id)!;
      const step: MonitorStep = candidate.getMonitorStep(buildArgs());
      const unhealthy: MonitorCriteriaInstance = instancesOf(step)[0]!;
      const incident: { description: string } = unhealthy.data!.incidents[0]!;

      expect(incident.description).toContain(
        "Check its power and its network first",
      );
      expect(incident.description).toContain("console");
      expect(incident.description).toContain(
        "This resolves on its own once it",
      );
      expect(filterOf(unhealthy).value).toBe(candidate.thresholdInMinutes);
      expect(MonitorStep.getGroupByAttributeKeys(step)).toEqual([
        ...MANAGED_DEVICE_CHECK_IN_GROUP_BY_ATTRIBUTES,
      ]);
    }
  });

  test("a connection of a service is offered no other service's", () => {
    for (const provider of [
      DeviceManagementProvider.Esper,
      DeviceManagementProvider.Intune,
      DeviceManagementProvider.WorkspaceOne,
      DeviceManagementProvider.Soti,
    ]) {
      for (const candidate of getManagedDeviceAlertTemplatesFor(provider)) {
        expect(candidate.provider).toBe(provider);
      }
    }
  });
});
