import {
  MANAGED_DEVICE_ALERT_MONITORING_INTERVAL,
  MANAGED_DEVICE_CHECK_IN_GROUP_BY_ATTRIBUTES,
  MANAGED_DEVICE_CHECK_IN_ROLLING_TIME,
  MANAGED_DEVICE_STOPPED_CHECKING_IN_MINUTES,
  ManagedDeviceAlertTemplate,
  ManagedDeviceAlertTemplateArgs,
  buildManagedDeviceCheckInMetricMonitor,
  getAllManagedDeviceAlertTemplates,
  getManagedDeviceAlertTemplateById,
} from "../../../Types/Monitor/ManagedDeviceAlertTemplates";
import {
  MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME,
  MANAGED_DEVICE_CHECK_IN_AGE_UNIT,
  ManagedDeviceCheckInAttribute,
} from "../../../Types/DeviceManagement/ManagedDeviceCheckIn";
import { MANAGED_DEVICE_ONLINE_WINDOW_MINUTES } from "../../../Types/DeviceManagement/ManagedDeviceStatus";
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
  test("is Esper Device Stopped Checking In", () => {
    expect(
      getAllManagedDeviceAlertTemplates().map(
        (candidate: ManagedDeviceAlertTemplate) => {
          return candidate.id;
        },
      ),
    ).toEqual(["esper-device-stopped-checking-in"]);
    expect(template().name).toBe("Esper Device Stopped Checking In");
    expect(getManagedDeviceAlertTemplateById("nope")).toBeUndefined();
  });

  test("says when it fires in one sentence, and why on the card behind it", () => {
    expect(template().summary).toBe(
      "A device has not checked in with Esper for more than an hour.",
    );
    expect(template().description).toContain("one alert per device");
    expect(template().description).toContain("Host Stopped Reporting");
    expect(template().category).toBe("Availability");
    expect(template().severity).toBe("Warning");
  });

  test("is offered to every connection, as a recommendation of its own resource type", () => {
    const recommendations: Array<MonitorRecommendation> =
      MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.DeviceManagementConnection,
      );

    expect(
      recommendations.map((recommendation: MonitorRecommendation) => {
        return recommendation.recommendationId;
      }),
    ).toEqual(["DeviceManagementConnection:esper-device-stopped-checking-in"]);
    expect(recommendations[0]!.monitorType).toBe(MonitorType.Metrics);
    expect(recommendations[0]!.summary).toBe(template().summary);
    // Evaluated as often as a reading can arrive, not every minute.
    expect(recommendations[0]!.monitoringInterval).toBe("*/5 * * * *");
    expect(MANAGED_DEVICE_ALERT_MONITORING_INTERVAL).toBe("*/5 * * * *");

    const definition: ReturnType<
      typeof MonitorRecommendationCatalog.getResourceTypeDefinition
    > = MonitorRecommendationCatalog.getResourceTypeDefinition(
      MonitorRecommendationResourceType.DeviceManagementConnection,
    );

    expect(definition!.resourceLabel).toBe("Esper Connection");
    expect(definition!.identifierFieldName).toBe(
      "deviceManagementConnectionId",
    );
    expect(definition!.monitorTypes).toEqual([MonitorType.Metrics]);
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
    });
    expect(query.metricAliasData!.legendUnit).toBe(
      MANAGED_DEVICE_CHECK_IN_AGE_UNIT,
    );
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
      }),
    ).toEqual(metricMonitorOf(stepOf()));
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
    )[0]!;

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
