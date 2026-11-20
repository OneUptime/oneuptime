import {
  MANAGED_DEVICE_ALERT_MONITORING_INTERVAL,
  MANAGED_DEVICE_CONNECTION_GROUP_BY_ATTRIBUTES,
  MANAGED_DEVICE_CONNECTION_READ_ROLLING_TIME,
  ManagedDeviceAlertTemplate,
  ManagedDeviceAlertTemplateArgs,
  getAllManagedDeviceAlertTemplates,
  getManagedDeviceAlertTemplateById,
  getManagedDeviceAlertTemplatesFor,
  getManagedDeviceConnectionStoppedReadingMinutes,
} from "../../../Types/Monitor/ManagedDeviceAlertTemplates";
import {
  DeviceManagementConnectionReadingAttribute,
  MANAGED_DEVICE_CONNECTION_READ_AGE_METRIC_NAME,
  MANAGED_DEVICE_CONNECTION_READ_AGE_UNIT,
} from "../../../Types/DeviceManagement/DeviceManagementConnectionReading";
import { getDeviceManagementStaleAfterMinutes } from "../../../Types/DeviceManagement/DeviceManagementConnectionHealth";
import {
  DEFAULT_DEVICE_MANAGEMENT_READ_INTERVAL_IN_MINUTES,
  DEVICE_MANAGEMENT_READ_INTERVALS_IN_MINUTES,
} from "../../../Types/DeviceManagement/DeviceManagementConnectionSettings";
import DeviceManagementProvider, {
  DEVICE_MANAGEMENT_PROVIDERS,
} from "../../../Types/DeviceManagement/DeviceManagementProvider";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import {
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepMetricMonitor from "../../../Types/Monitor/MonitorStepMetricMonitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import MonitorRecommendationUtil from "../../../Types/Monitor/Recommendation/MonitorRecommendationUtil";
import SeriesDebugHints, {
  SeriesDebugCommand,
} from "../../../Types/Monitor/SeriesContext/SeriesDebugHints";
import SeriesLabelDisplay from "../../../Types/Monitor/SeriesContext/SeriesLabelDisplay";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import { describe, expect, test } from "@jest/globals";

/*
 * Connection Stopped Reading (#10006): one Metrics monitor per device
 * management connection, of every service, over the connection's own
 * reading - how long since a read of it worked - alerting once no read has
 * worked for as long as its Status waits before it says Stale, and
 * resolving with the first read that works.
 */

const CONNECTION_ID: string = ObjectID.generate().toString();

const CONNECTION_TEMPLATE_IDS: Record<DeviceManagementProvider, string> = {
  [DeviceManagementProvider.Esper]: "esper-connection-stopped-reading",
  [DeviceManagementProvider.Intune]: "intune-connection-stopped-reading",
  [DeviceManagementProvider.WorkspaceOne]:
    "workspace-one-connection-stopped-reading",
  [DeviceManagementProvider.Soti]: "soti-connection-stopped-reading",
};

function args(
  overrides: Partial<ManagedDeviceAlertTemplateArgs> = {},
): ManagedDeviceAlertTemplateArgs {
  return {
    deviceManagementConnectionId: CONNECTION_ID,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Esper acme - Esper Connection Stopped Reading",
    ...overrides,
  };
}

function templateOf(
  provider: DeviceManagementProvider,
): ManagedDeviceAlertTemplate {
  return getManagedDeviceAlertTemplateById(CONNECTION_TEMPLATE_IDS[provider])!;
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

describe("each service's connection is offered its own, first", () => {
  test.each(DEVICE_MANAGEMENT_PROVIDERS)(
    "%s",
    (provider: DeviceManagementProvider) => {
      const template: ManagedDeviceAlertTemplate = templateOf(provider);

      expect(template).toBeDefined();
      expect(template.provider).toBe(provider);
      expect(getManagedDeviceAlertTemplatesFor(provider)[0]).toBe(template);

      expect(
        MonitorRecommendationCatalog.getRecommendations(
          MonitorRecommendationResourceType.DeviceManagementConnection,
          { deviceManagementProvider: provider },
        )[0]!.recommendationId,
      ).toBe(`DeviceManagementConnection:${CONNECTION_TEMPLATE_IDS[provider]}`);
    },
  );

  test("named for its service, critical, an availability alert evaluated every five minutes", () => {
    expect(
      DEVICE_MANAGEMENT_PROVIDERS.map((provider: DeviceManagementProvider) => {
        return templateOf(provider).name;
      }),
    ).toEqual([
      "Esper Connection Stopped Reading",
      "Intune Connection Stopped Reading",
      "Workspace ONE Connection Stopped Reading",
      "SOTI Connection Stopped Reading",
    ]);

    for (const provider of DEVICE_MANAGEMENT_PROVIDERS) {
      const template: ManagedDeviceAlertTemplate = templateOf(provider);

      expect(template.category).toBe("Availability");
      // The whole fleet goes unwatched: more than one device's silence.
      expect(template.severity).toBe("Critical");
      expect(template.monitoringInterval).toBe(
        MANAGED_DEVICE_ALERT_MONITORING_INTERVAL,
      );
      expect(template.metricName).toBe(
        MANAGED_DEVICE_CONNECTION_READ_AGE_METRIC_NAME,
      );
      // Every device of the connection is fed by it: it reads no platform.
      expect(template.platforms).toBeUndefined();
    }
  });

  test("says when it fires in one short sentence, with no metric's name, each its own", () => {
    const summaries: Set<string> = new Set<string>();

    for (const provider of DEVICE_MANAGEMENT_PROVIDERS) {
      const summary: string = templateOf(provider).summary;

      expect(summary.length).toBeLessThanOrEqual(80);
      expect(summary.endsWith(".")).toBe(true);
      expect(summary).toContain("three read intervals");
      expect(summary).not.toMatch(/\b[a-z][a-z0-9]*\.[a-z][a-z0-9_.]*\b/);
      expect(summary).not.toMatch(/\b[a-z][a-z0-9]*_[a-z0-9_]+\b/);
      summaries.add(summary);
    }

    expect(summaries.size).toBe(DEVICE_MANAGEMENT_PROVIDERS.length);
    expect(templateOf(DeviceManagementProvider.Esper).summary).toBe(
      "No read of this Esper connection has worked for three read intervals.",
    );
  });

  test("its description says how long at the default interval, as the Stale rule counts it, and what usually broke", () => {
    expect(DEFAULT_DEVICE_MANAGEMENT_READ_INTERVAL_IN_MINUTES).toBe(15);
    expect(getManagedDeviceConnectionStoppedReadingMinutes()).toBe(55);

    for (const provider of DEVICE_MANAGEMENT_PROVIDERS) {
      const template: ManagedDeviceAlertTemplate = templateOf(provider);

      expect(template.thresholdInMinutes).toBe(55);
      expect(template.description).toContain(
        "55 minutes at the default 15-minute interval",
      );
      expect(template.description).toContain("Stale");
      expect(template.description).toContain("Most often");
    }

    expect(templateOf(DeviceManagementProvider.Esper).description).toContain(
      "API key was revoked or replaced",
    );
    expect(templateOf(DeviceManagementProvider.Intune).description).toContain(
      "client secret expired",
    );
    expect(
      templateOf(DeviceManagementProvider.WorkspaceOne).description,
    ).toContain("OAuth client was deleted");
    expect(templateOf(DeviceManagementProvider.Soti).description).toContain(
      "API client was removed",
    );
  });
});

describe("what the monitor reads", () => {
  test("the connection's own reading, of this connection alone, one series named after it", () => {
    const step: MonitorStep = templateOf(
      DeviceManagementProvider.Esper,
    ).getMonitorStep(args());
    const query: MetricQueryConfigData = queryOf(step);

    expect(query.metricQueryData.filterData.metricName).toBe(
      MANAGED_DEVICE_CONNECTION_READ_AGE_METRIC_NAME,
    );
    // No device filter: the connection is no device, and no host.
    expect(query.metricQueryData.filterData.attributes).toEqual({
      [DeviceManagementConnectionReadingAttribute.ConnectionId]: CONNECTION_ID,
    });
    expect(query.metricQueryData.groupByAttributeKeys).toEqual([
      DeviceManagementConnectionReadingAttribute.ConnectionName,
    ]);
    expect(MANAGED_DEVICE_CONNECTION_GROUP_BY_ATTRIBUTES).toEqual([
      "oneuptime.managed_device.connection.name",
    ]);
    // A read and the claim that queued it, in one minute: it read.
    expect(query.metricQueryData.filterData.aggegationType).toBe(
      MetricsAggregationType.Min,
    );
    expect(query.metricAliasData!.legendUnit).toBe(
      MANAGED_DEVICE_CONNECTION_READ_AGE_UNIT,
    );
  });

  test("judges the connection on its newest reading, over two hours", () => {
    const metricMonitor: MonitorStepMetricMonitor = metricMonitorOf(
      templateOf(DeviceManagementProvider.Intune).getMonitorStep(args()),
    );

    expect(metricMonitor.judgeLatestReading).toBe(true);
    expect(metricMonitor.rollingTime).toBe(RollingTime.Past2Hours);
    expect(MANAGED_DEVICE_CONNECTION_READ_ROLLING_TIME).toBe(
      RollingTime.Past2Hours,
    );
  });

  test("the alert names the connection: its group-by key is one the alert can name", () => {
    for (const key of MANAGED_DEVICE_CONNECTION_GROUP_BY_ATTRIBUTES) {
      expect(SeriesLabelDisplay.isKnownLabelKey(key)).toBe(true);
      expect(SeriesLabelDisplay.getFriendlyLabelName(key)).toBe("Connection");
    }

    expect(
      SeriesLabelDisplay.buildTitleSuffix({
        [DeviceManagementConnectionReadingAttribute.ConnectionName]:
          "Esper acme",
      }),
    ).toBe(" - Connection: Esper acme");
  });
});

describe("when it fires, and resolves", () => {
  test.each(DEVICE_MANAGEMENT_READ_INTERVALS_IN_MINUTES)(
    "a connection read every %i minutes waits three intervals and ten minutes, as its Status does",
    (interval: number) => {
      const threshold: number = getDeviceManagementStaleAfterMinutes(interval);
      const [unhealthy, healthy]: Array<MonitorCriteriaInstance> = instancesOf(
        templateOf(DeviceManagementProvider.Esper).getMonitorStep(
          args({ readIntervalInMinutes: interval }),
        ),
      );

      expect(getManagedDeviceConnectionStoppedReadingMinutes(interval)).toBe(
        threshold,
      );
      expect(threshold).toBe(Math.max(30, interval * 3 + 10));

      expect(filterOf(unhealthy!).filterType).toBe(FilterType.GreaterThan);
      expect(Number(filterOf(unhealthy!).value)).toBe(threshold);
      // One reading here, its newest: Any Value is that reading.
      expect(
        filterOf(unhealthy!).metricMonitorOptions?.metricAggregationType,
      ).toBe(EvaluateOverTimeType.AnyValue);
      // No dead band: a read that works reads 0.
      expect(filterOf(healthy!).filterType).toBe(FilterType.LessThanOrEqualTo);
      expect(Number(filterOf(healthy!).value)).toBe(threshold);
    },
  );

  test("without the connection's interval, the default one's", () => {
    const [unhealthy]: Array<MonitorCriteriaInstance> = instancesOf(
      templateOf(DeviceManagementProvider.Soti).getMonitorStep(args()),
    );

    expect(Number(filterOf(unhealthy!).value)).toBe(55);
  });

  test.each([
    [DeviceManagementProvider.Esper, "[Esper]"],
    [DeviceManagementProvider.Intune, "[Intune]"],
    [DeviceManagementProvider.WorkspaceOne, "[Workspace ONE]"],
    [DeviceManagementProvider.Soti, "[SOTI]"],
  ])(
    "%s: an alert by default, tagged as its devices' are, that says what to check first",
    (provider: DeviceManagementProvider, tag: string) => {
      const [unhealthy, healthy]: Array<MonitorCriteriaInstance> = instancesOf(
        templateOf(provider).getMonitorStep(args()),
      );
      const alert: { title: string; description: string } =
        unhealthy!.data!.alerts[0]!;

      expect(unhealthy!.data!.createAlerts).toBe(true);
      expect(unhealthy!.data!.name).toBe("The connection stopped reading");
      expect(alert.title).toBe(`${tag} Connection stopped reading`);
      expect(alert.description).toContain("View error");
      expect(alert.description).toContain("its first command below");
      expect(alert.description).toContain(
        "This resolves on its own with the first read that works.",
      );
      expect(alert.description).not.toContain("{{");
      expect(healthy!.data!.createAlerts).toBeFalsy();
    },
  );
});

describe("the recommendation", () => {
  function argsFor(connectionId: string): MonitorRecommendationArgs {
    return {
      resourceIdentifier: connectionId,
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      monitorName: "Esper acme",
    };
  }

  function connectionRecommendation(
    readIntervalInMinutes?: number,
  ): MonitorRecommendation {
    return MonitorRecommendationCatalog.getRecommendations(
      MonitorRecommendationResourceType.DeviceManagementConnection,
      {
        deviceManagementProvider: DeviceManagementProvider.Esper,
        deviceManagementReadIntervalInMinutes: readIntervalInMinutes,
      },
    ).find((recommendation: MonitorRecommendation) => {
      return recommendation.templateId === "esper-connection-stopped-reading";
    })!;
  }

  test("waits as long as the connection's own interval says, from the page's context", () => {
    const hourly: MonitorStep = connectionRecommendation(60).getMonitorStep(
      argsFor(CONNECTION_ID),
    );
    const fallback: MonitorStep = connectionRecommendation().getMonitorStep(
      argsFor(CONNECTION_ID),
    );

    expect(Number(filterOf(instancesOf(hourly)[0]!).value)).toBe(190);
    expect(Number(filterOf(instancesOf(fallback)[0]!).value)).toBe(55);
    expect(queryOf(hourly).metricQueryData.filterData.attributes).toEqual({
      [DeviceManagementConnectionReadingAttribute.ConnectionId]: CONNECTION_ID,
    });
  });

  test("a monitor of this connection covers it; another connection's does not; neither does a device's", () => {
    const recommendation: MonitorRecommendation = connectionRecommendation(15);
    const covered: (steps: Array<MonitorStep>) => boolean = (
      steps: Array<MonitorStep>,
    ): boolean => {
      return MonitorRecommendationUtil.getCoveredRecommendationIds({
        recommendations: [recommendation],
        existingMonitorSteps: steps,
        args: argsFor(CONNECTION_ID),
      }).has(recommendation.recommendationId);
    };

    expect(
      covered([recommendation.getMonitorStep(argsFor(CONNECTION_ID))]),
    ).toBe(true);
    expect(
      covered([
        recommendation.getMonitorStep(argsFor(ObjectID.generate().toString())),
      ]),
    ).toBe(false);

    const checkIns: MonitorRecommendation =
      MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.DeviceManagementConnection,
      ).find((candidate: MonitorRecommendation) => {
        return candidate.templateId === "esper-device-stopped-checking-in";
      })!;

    expect(covered([checkIns.getMonitorStep(argsFor(CONNECTION_ID))])).toBe(
      false,
    );
  });

  test("a monitor made at another interval keeps the wait it was made with, and is told apart", () => {
    const madeHourly: MonitorStep = connectionRecommendation(60).getMonitorStep(
      argsFor(CONNECTION_ID),
    );

    expect(
      MonitorRecommendationUtil.getCoveredRecommendationIds({
        recommendations: [connectionRecommendation(15)],
        existingMonitorSteps: [madeHourly],
        args: argsFor(CONNECTION_ID),
      }).size,
    ).toBe(0);
  });

  test("the catalog of every template holds one per service", () => {
    expect(
      getAllManagedDeviceAlertTemplates()
        .filter((template: ManagedDeviceAlertTemplate) => {
          return (
            template.metricName ===
            MANAGED_DEVICE_CONNECTION_READ_AGE_METRIC_NAME
          );
        })
        .map((template: ManagedDeviceAlertTemplate) => {
          return template.provider;
        }),
    ).toEqual([...DEVICE_MANAGEMENT_PROVIDERS]);
  });
});

describe("its first debug step", () => {
  test("lists the connection's last readings, each with the error its read failed with", () => {
    const commands: Array<SeriesDebugCommand> =
      SeriesDebugHints.getDebugCommands({
        monitorType: MonitorType.Metrics,
        seriesLabels: {
          [DeviceManagementConnectionReadingAttribute.ConnectionName]:
            "Esper acme",
        },
      });

    expect(commands).toEqual([
      {
        purpose:
          "The connection's last error, and how long since one of its reads worked, at each of its last reads",
        command: `oneuptime metric list --query '{"name":"oneuptime.managed_device.connection.read.age","attributes":{"oneuptime.managed_device.connection.name":"Esper acme"}}' --sort '{"time":"DESC"}' --limit 5 --fields time,value,attributes`,
      },
    ]);
  });

  test("quotes a name that would break out of the command", () => {
    const command: string = SeriesDebugHints.getDebugCommands({
      monitorType: MonitorType.Metrics,
      seriesLabels: {
        [DeviceManagementConnectionReadingAttribute.ConnectionName]:
          "Bob's fleet; rm -rf /",
      },
    })[0]!.command;

    expect(command).toContain(`Bob'\\''s fleet; rm -rf /`);
    expect(command.startsWith("oneuptime metric list --query '")).toBe(true);
  });

  test("a device's series keeps the device's commands, and a series naming neither has none", () => {
    const deviceCommands: Array<SeriesDebugCommand> =
      SeriesDebugHints.getDebugCommands({
        monitorType: MonitorType.Metrics,
        seriesLabels: { "oneuptime.managed_device.name": "ESP-ID-AAAAW" },
      });

    expect(deviceCommands.length).toBeGreaterThan(0);
    for (const command of deviceCommands) {
      expect(command.command).not.toContain(
        MANAGED_DEVICE_CONNECTION_READ_AGE_METRIC_NAME,
      );
    }

    expect(
      SeriesDebugHints.getDebugCommands({
        monitorType: MonitorType.Metrics,
        seriesLabels: { "service.name": "checkout" },
      }),
    ).toEqual([]);
  });
});
