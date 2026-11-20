import {
  MANAGED_DEVICE_ALERT_MONITORING_INTERVAL,
  MANAGED_DEVICE_CHECK_IN_GROUP_BY_ATTRIBUTES,
  MANAGED_DEVICE_CHECK_IN_ROLLING_TIME,
  MANAGED_DEVICE_LOW_BATTERY_PERCENT,
  MANAGED_DEVICE_STORAGE_NEARLY_FULL_PERCENT,
  ManagedDeviceAlertTemplate,
  ManagedDeviceAlertTemplateArgs,
  getManagedDeviceAlertTemplateById,
  getManagedDeviceAlertTemplatesFor,
} from "../../../Types/Monitor/ManagedDeviceAlertTemplates";
import {
  MANAGED_DEVICE_BATTERY_CHARGING_METRIC_NAME,
  MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME,
  MANAGED_DEVICE_BATTERY_LEVEL_UNIT,
  MANAGED_DEVICE_STORAGE_USED_METRIC_NAME,
  MANAGED_DEVICE_STORAGE_USED_UNIT,
  ManagedDeviceCheckInAttribute,
} from "../../../Types/DeviceManagement/ManagedDeviceCheckIn";
import DeviceManagementProvider, {
  DEVICE_MANAGEMENT_PROVIDERS,
} from "../../../Types/DeviceManagement/DeviceManagementProvider";
import { getHostAlertTemplateById } from "../../../Types/Monitor/HostAlertTemplates";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import {
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../Types/Monitor/CriteriaFilter";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepMetricMonitor from "../../../Types/Monitor/MonitorStepMetricMonitor";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import MonitorRecommendationUtil from "../../../Types/Monitor/Recommendation/MonitorRecommendationUtil";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * Low Battery and Storage Nearly Full for the devices a device manager
 * imports (#10008): each device's latest reading of its battery and of how
 * much of its storage is in use, as its service last heard them, one alert
 * per device - at the Android agent's own thresholds, and never for a
 * device the agent reports, whose host's templates read the agent's own
 * metrics.
 */

const CONNECTION_ID: string = ObjectID.generate().toString();

const BATTERY_TEMPLATE_IDS: Record<DeviceManagementProvider, string> = {
  [DeviceManagementProvider.Esper]: "esper-low-battery",
  // #10287: an iPhone's or iPad's, each asked alone on Graph's beta.
  [DeviceManagementProvider.Intune]: "intune-low-battery",
  [DeviceManagementProvider.WorkspaceOne]: "workspace-one-low-battery",
  [DeviceManagementProvider.Soti]: "soti-low-battery",
};

const STORAGE_TEMPLATE_IDS: Record<DeviceManagementProvider, string> = {
  [DeviceManagementProvider.Esper]: "esper-storage-nearly-full",
  [DeviceManagementProvider.Intune]: "intune-storage-nearly-full",
  [DeviceManagementProvider.WorkspaceOne]: "workspace-one-storage-nearly-full",
  [DeviceManagementProvider.Soti]: "soti-storage-nearly-full",
};

function args(): ManagedDeviceAlertTemplateArgs {
  return {
    deviceManagementConnectionId: CONNECTION_ID,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Esper acme - Esper Low Battery",
  };
}

function template(id: string): ManagedDeviceAlertTemplate {
  const found: ManagedDeviceAlertTemplate | undefined =
    getManagedDeviceAlertTemplateById(id);

  expect(found).toBeDefined();
  return found!;
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

// The value a Host template's unhealthy criteria compares its reading with.
function hostThreshold(id: string): number {
  const step: MonitorStep = getHostAlertTemplateById(id)!.getMonitorStep({
    hostIdentifier: "esp-id-agent",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "ESP-ID-AGENT",
  });

  return Number(filterOf(instancesOf(step)[0]!).value);
}

describe("which connections are offered them", () => {
  test("Low Battery to every service, each its own", () => {
    for (const provider of DEVICE_MANAGEMENT_PROVIDERS) {
      const batteries: Array<string> = getManagedDeviceAlertTemplatesFor(
        provider,
      )
        .filter((candidate: ManagedDeviceAlertTemplate): boolean => {
          return (
            candidate.metricName === MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME
          );
        })
        .map((candidate: ManagedDeviceAlertTemplate): string => {
          return candidate.id;
        });

      expect({ provider, batteries }).toEqual({
        provider,
        batteries: [BATTERY_TEMPLATE_IDS[provider]],
      });
      expect(template(BATTERY_TEMPLATE_IDS[provider]).provider).toBe(provider);
    }
  });

  test("Intune's says which devices Intune says a battery of: an iPhone's or an iPad's alone", () => {
    expect(template("intune-low-battery").name).toBe("Intune Low Battery");
    expect(template("intune-low-battery").summary).toBe(
      "An iPhone or iPad Intune manages has less than 20% battery left.",
    );
    expect(template("intune-low-battery").description).toContain(
      "Intune says the battery of an iPhone or an iPad alone, as of its last check-in",
    );

    // The others' devices lists say every device's: no such sentence.
    for (const id of [
      "esper-low-battery",
      "workspace-one-low-battery",
      "soti-low-battery",
    ]) {
      expect(template(id).description).not.toContain("alone, as of");
    }
  });

  test("Storage Nearly Full to every service, each its own", () => {
    for (const provider of DEVICE_MANAGEMENT_PROVIDERS) {
      expect(
        getManagedDeviceAlertTemplatesFor(provider)
          .filter((candidate: ManagedDeviceAlertTemplate): boolean => {
            return (
              candidate.metricName === MANAGED_DEVICE_STORAGE_USED_METRIC_NAME
            );
          })
          .map((candidate: ManagedDeviceAlertTemplate): string => {
            return candidate.id;
          }),
      ).toEqual([STORAGE_TEMPLATE_IDS[provider]]);
      expect(template(STORAGE_TEMPLATE_IDS[provider]).provider).toBe(provider);
    }
  });

  test("named for the service, as the agent's own templates are named", () => {
    expect(template("esper-low-battery").name).toBe("Esper Low Battery");
    expect(template("workspace-one-low-battery").name).toBe(
      "Workspace ONE Low Battery",
    );
    expect(template("soti-low-battery").name).toBe("SOTI Low Battery");
    expect(template("esper-storage-nearly-full").name).toBe(
      "Esper Storage Nearly Full",
    );
    expect(template("intune-storage-nearly-full").name).toBe(
      "Intune Storage Nearly Full",
    );
    expect(template("workspace-one-storage-nearly-full").name).toBe(
      "Workspace ONE Storage Nearly Full",
    );
    expect(template("soti-storage-nearly-full").name).toBe(
      "SOTI Storage Nearly Full",
    );
    // The agent's: Low Battery and Storage Nearly Full.
    expect(getHostAlertTemplateById("android-low-battery")!.name).toBe(
      "Low Battery",
    );
    expect(getHostAlertTemplateById("android-storage-nearly-full")!.name).toBe(
      "Storage Nearly Full",
    );
  });

  test("each says when it fires in one short sentence, with no metric's name", () => {
    const ids: Array<string> = [
      ...(Object.values(BATTERY_TEMPLATE_IDS) as Array<string>),
      ...Object.values(STORAGE_TEMPLATE_IDS),
    ];
    const summaries: Set<string> = new Set<string>();

    for (const id of ids) {
      const summary: string = template(id).summary;

      expect(summary.length).toBeLessThanOrEqual(80);
      expect(summary.endsWith(".")).toBe(true);
      expect(summary).not.toMatch(/\b[a-z][a-z0-9]*\.[a-z][a-z0-9_.]*\b/);
      expect(summary).not.toMatch(/\b[a-z][a-z0-9]*_[a-z0-9_]+\b/);
      summaries.add(summary);
    }

    expect(summaries.size).toBe(ids.length);
    expect(template("esper-low-battery").summary).toBe(
      "A device Esper manages has less than 20% battery left.",
    );
    expect(template("intune-storage-nearly-full").summary).toBe(
      "A device Intune manages has more than 90% of its storage in use.",
    );
  });

  test("a resource warning each, evaluated every five minutes, an alert by default", () => {
    for (const id of [
      ...(Object.values(BATTERY_TEMPLATE_IDS) as Array<string>),
      ...Object.values(STORAGE_TEMPLATE_IDS),
    ]) {
      const candidate: ManagedDeviceAlertTemplate = template(id);
      const [unhealthy]: Array<MonitorCriteriaInstance> = instancesOf(
        candidate.getMonitorStep(args()),
      );

      expect(candidate.category).toBe("Resource");
      expect(candidate.severity).toBe("Warning");
      expect(candidate.monitoringInterval).toBe(
        MANAGED_DEVICE_ALERT_MONITORING_INTERVAL,
      );
      expect(unhealthy!.data!.createAlerts).toBe(true);
    }
  });
});

describe("the thresholds are the Android agent's own", () => {
  test("Low Battery: under 20%, as the agent's Low Battery", () => {
    expect(MANAGED_DEVICE_LOW_BATTERY_PERCENT).toBe(20);
    expect(hostThreshold("android-low-battery")).toBe(
      MANAGED_DEVICE_LOW_BATTERY_PERCENT,
    );

    for (const id of Object.values(BATTERY_TEMPLATE_IDS) as Array<string>) {
      const candidate: ManagedDeviceAlertTemplate = template(id);
      const [unhealthy, healthy]: Array<MonitorCriteriaInstance> = instancesOf(
        candidate.getMonitorStep(args()),
      );

      expect(candidate.minBatteryPercent).toBe(20);
      expect(filterOf(unhealthy!).filterType).toBe(FilterType.LessThan);
      expect(Number(filterOf(unhealthy!).value)).toBe(20);
      expect(
        filterOf(unhealthy!).metricMonitorOptions?.metricAggregationType,
      ).toBe(EvaluateOverTimeType.AnyValue);
      expect(filterOf(healthy!).filterType).toBe(
        FilterType.GreaterThanOrEqualTo,
      );
      expect(Number(filterOf(healthy!).value)).toBe(20);
      // The words write it out as the criteria read it.
      expect(candidate.summary).toContain("20%");
      expect(candidate.description).toContain("less than 20% battery");
      expect(unhealthy!.data!.alerts[0]!.description).toContain(
        "reports 20% or more",
      );
    }
  });

  test("Storage Nearly Full: more than 90% in use, as the agent's Storage Nearly Full", () => {
    expect(MANAGED_DEVICE_STORAGE_NEARLY_FULL_PERCENT).toBe(90);
    expect(hostThreshold("android-storage-nearly-full")).toBe(
      MANAGED_DEVICE_STORAGE_NEARLY_FULL_PERCENT,
    );

    for (const id of Object.values(STORAGE_TEMPLATE_IDS)) {
      const candidate: ManagedDeviceAlertTemplate = template(id);
      const [unhealthy, healthy]: Array<MonitorCriteriaInstance> = instancesOf(
        candidate.getMonitorStep(args()),
      );

      expect(candidate.maxStorageUsedPercent).toBe(90);
      expect(filterOf(unhealthy!).filterType).toBe(FilterType.GreaterThan);
      expect(Number(filterOf(unhealthy!).value)).toBe(90);
      expect(filterOf(healthy!).filterType).toBe(FilterType.LessThanOrEqualTo);
      expect(Number(filterOf(healthy!).value)).toBe(90);
      expect(candidate.summary).toContain("90%");
      expect(candidate.description).toContain(
        "more than 90% of its own storage",
      );
    }
  });
});

describe("what the monitors read", () => {
  test("Low Battery: each device's battery, of this connection's devices no agent reports, one series per device, the lower of two", () => {
    const query: MetricQueryConfigData = queryOf(
      template("esper-low-battery").getMonitorStep(args()),
    );

    expect(query.metricQueryData.filterData.metricName).toBe(
      MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME,
    );
    // Its service too, which keeps each service's template apart in the catalog.
    expect(query.metricQueryData.filterData.attributes).toEqual({
      [ManagedDeviceCheckInAttribute.ConnectionId]: CONNECTION_ID,
      [ManagedDeviceCheckInAttribute.IsHost]: "false",
      [ManagedDeviceCheckInAttribute.Provider]: DeviceManagementProvider.Esper,
    });
    expect(query.metricQueryData.groupByAttributeKeys).toEqual([
      ...MANAGED_DEVICE_CHECK_IN_GROUP_BY_ATTRIBUTES,
    ]);
    expect(query.metricQueryData.filterData.aggegationType).toBe(
      MetricsAggregationType.Min,
    );
    expect(query.metricAliasData!.legendUnit).toBe(
      MANAGED_DEVICE_BATTERY_LEVEL_UNIT,
    );
  });

  test("Storage Nearly Full: how full each device's storage is, the fuller of two", () => {
    const query: MetricQueryConfigData = queryOf(
      template("soti-storage-nearly-full").getMonitorStep(args()),
    );

    expect(query.metricQueryData.filterData.metricName).toBe(
      MANAGED_DEVICE_STORAGE_USED_METRIC_NAME,
    );
    expect(query.metricQueryData.filterData.attributes).toEqual({
      [ManagedDeviceCheckInAttribute.ConnectionId]: CONNECTION_ID,
      [ManagedDeviceCheckInAttribute.IsHost]: "false",
      [ManagedDeviceCheckInAttribute.Provider]: DeviceManagementProvider.Soti,
    });
    expect(query.metricQueryData.filterData.aggegationType).toBe(
      MetricsAggregationType.Max,
    );
    expect(query.metricAliasData!.legendUnit).toBe(
      MANAGED_DEVICE_STORAGE_USED_UNIT,
    );
  });

  test("each device judged on its latest reading, over the check-ins' window", () => {
    for (const id of [
      "workspace-one-low-battery",
      "intune-storage-nearly-full",
    ]) {
      const metricMonitor: MonitorStepMetricMonitor = metricMonitorOf(
        template(id).getMonitorStep(args()),
      );

      expect(metricMonitor.judgeLatestReading).toBe(true);
      expect(metricMonitor.rollingTime).toBe(
        MANAGED_DEVICE_CHECK_IN_ROLLING_TIME,
      );
    }
  });

  test.each([
    ["esper-low-battery", "[Esper] Low battery"],
    ["intune-low-battery", "[Intune] Low battery"],
    ["workspace-one-low-battery", "[Workspace ONE] Low battery"],
    ["soti-low-battery", "[SOTI] Low battery"],
    ["esper-storage-nearly-full", "[Esper] Storage nearly full"],
    ["intune-storage-nearly-full", "[Intune] Storage nearly full"],
    [
      "workspace-one-storage-nearly-full",
      "[Workspace ONE] Storage nearly full",
    ],
    ["soti-storage-nearly-full", "[SOTI] Storage nearly full"],
  ])(
    "%s's alert is tagged as its service's others are",
    (id: string, title: string) => {
      const [unhealthy]: Array<MonitorCriteriaInstance> = instancesOf(
        template(id).getMonitorStep(args()),
      );

      expect(unhealthy!.data!.alerts[0]!.title).toBe(title);
      expect(unhealthy!.data!.alerts[0]!.description).toContain(
        "This resolves on its own",
      );
    },
  );

  test("a device the Android agent reports is its host's to alert on, as the descriptions say", () => {
    for (const id of Object.values(BATTERY_TEMPLATE_IDS) as Array<string>) {
      expect(template(id).description).toContain("its host's Low Battery");
    }

    for (const id of Object.values(STORAGE_TEMPLATE_IDS)) {
      expect(template(id).description).toContain(
        "its host's Storage Nearly Full",
      );
    }
  });
});

describe("whether a monitor already covers them", () => {
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

  test("each of a connection's recommendations is told apart from every other of the same connection", () => {
    for (const provider of DEVICE_MANAGEMENT_PROVIDERS) {
      const recommendations: Array<MonitorRecommendation> =
        MonitorRecommendationCatalog.getRecommendations(
          MonitorRecommendationResourceType.DeviceManagementConnection,
          { deviceManagementProvider: provider },
        );

      for (const recommendation of recommendations) {
        const covered: Set<string> =
          MonitorRecommendationUtil.getCoveredRecommendationIds({
            recommendations,
            existingMonitorSteps: [
              recommendation.getMonitorStep(argsFor(CONNECTION_ID)),
            ],
            args: argsFor(CONNECTION_ID),
          });

        expect([provider, Array.from(covered)]).toEqual([
          provider,
          [recommendation.recommendationId],
        ]);
      }
    }
  });
});

/*
 * #10288: Low Battery leaves a device on its charger be, where its service
 * says which: Workspace ONE (AcLineStatus) and SOTI (an Android+ device's
 * IsCharging). Its step reads the device's charging beside its battery, one
 * series per device, and fires only when the battery is low and the device
 * is off its charger; a device its service says neither of counts as off
 * it. Esper's and Intune's read the battery alone, as before.
 */
describe("Low Battery leaves a device on its charger be", () => {
  const CHARGING_TEMPLATE_IDS: Array<string> = [
    "workspace-one-low-battery",
    "soti-low-battery",
  ];

  function queriesOf(step: MonitorStep): Array<MetricQueryConfigData> {
    return metricMonitorOf(step).metricViewConfig.queryConfigs;
  }

  test.each(CHARGING_TEMPLATE_IDS)(
    "%s reads each device's charging beside its battery: the same devices, one series each",
    (id: string) => {
      const [battery, charging] = queriesOf(
        template(id).getMonitorStep(args()),
      );

      expect(queriesOf(template(id).getMonitorStep(args()))).toHaveLength(2);
      expect(battery!.metricQueryData.filterData.metricName).toBe(
        MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME,
      );
      expect(charging!.metricQueryData.filterData.metricName).toBe(
        MANAGED_DEVICE_BATTERY_CHARGING_METRIC_NAME,
      );
      expect(charging!.metricQueryData.filterData.attributes).toEqual(
        battery!.metricQueryData.filterData.attributes,
      );
      expect(charging!.metricQueryData.groupByAttributeKeys).toEqual(
        battery!.metricQueryData.groupByAttributeKeys,
      );
      // On its charger at either of two reads in a minute is on it.
      expect(charging!.metricQueryData.filterData.aggegationType).toBe(
        MetricsAggregationType.Max,
      );
      expect(charging!.metricAliasData!.metricVariable).not.toBe(
        battery!.metricAliasData!.metricVariable,
      );
    },
  );

  test.each(CHARGING_TEMPLATE_IDS)(
    "%s fires below 20% and off its charger - a device that says neither is off it - and is well at 20% or on its charger",
    (id: string) => {
      const step: MonitorStep = template(id).getMonitorStep(args());
      const [battery, charging] = queriesOf(step);
      const [unhealthy, healthy]: Array<MonitorCriteriaInstance> =
        instancesOf(step);

      expect(unhealthy!.data!.filterCondition).toBe(FilterCondition.All);
      expect(
        unhealthy!.data!.filters.map((filter: CriteriaFilter) => {
          return {
            alias: filter.metricMonitorOptions?.metricAlias,
            type: filter.filterType,
            value: Number(filter.value),
            noData: filter.metricMonitorOptions?.onNoDataPolicy,
          };
        }),
      ).toEqual([
        {
          alias: battery!.metricAliasData!.metricVariable,
          type: FilterType.LessThan,
          value: 20,
          noData: undefined,
        },
        {
          alias: charging!.metricAliasData!.metricVariable,
          type: FilterType.LessThan,
          value: 1,
          noData: NoDataPolicy.TreatAsZero,
        },
      ]);

      expect(healthy!.data!.filterCondition).toBe(FilterCondition.Any);
      expect(
        healthy!.data!.filters.map((filter: CriteriaFilter) => {
          return {
            alias: filter.metricMonitorOptions?.metricAlias,
            type: filter.filterType,
            value: Number(filter.value),
            noData: filter.metricMonitorOptions?.onNoDataPolicy,
          };
        }),
      ).toEqual([
        {
          alias: battery!.metricAliasData!.metricVariable,
          type: FilterType.GreaterThanOrEqualTo,
          value: 20,
          noData: undefined,
        },
        {
          alias: charging!.metricAliasData!.metricVariable,
          type: FilterType.GreaterThanOrEqualTo,
          value: 1,
          noData: undefined,
        },
      ]);

      expect(template(id).description).toContain("is left be");
      expect(unhealthy!.data!.description).toContain("not on its charger");
      expect(unhealthy!.data!.alerts[0]!.description).toContain(
        "reports it on its charger",
      );
    },
  );

  test("Esper's and Intune's read the battery alone, their services saying no charging state", () => {
    for (const id of ["esper-low-battery", "intune-low-battery"]) {
      const step: MonitorStep = template(id).getMonitorStep(args());
      const [unhealthy, healthy]: Array<MonitorCriteriaInstance> =
        instancesOf(step);

      expect({ id, queries: queriesOf(step).length }).toEqual({
        id,
        queries: 1,
      });
      expect(unhealthy!.data!.filters).toHaveLength(1);
      expect(healthy!.data!.filters).toHaveLength(1);
      expect(template(id).getEarlierMonitorSteps).toBeUndefined();
      expect(template(id).description).not.toContain("is left be");
    }
  });

  test.each(CHARGING_TEMPLATE_IDS)(
    "%s's monitor made before, of the battery alone, still counts as made, and on its own connection alone",
    (id: string) => {
      const candidate: ManagedDeviceAlertTemplate = template(id);
      const earlier: Array<MonitorStep> =
        candidate.getEarlierMonitorSteps!(args());
      const recommendations: Array<MonitorRecommendation> =
        MonitorRecommendationCatalog.getRecommendations(
          MonitorRecommendationResourceType.DeviceManagementConnection,
          { deviceManagementProvider: candidate.provider },
        );
      const recommendationArgs: MonitorRecommendationArgs = {
        resourceIdentifier: CONNECTION_ID,
        onlineMonitorStatusId: ObjectID.generate(),
        offlineMonitorStatusId: ObjectID.generate(),
        defaultIncidentSeverityId: ObjectID.generate(),
        defaultAlertSeverityId: ObjectID.generate(),
        monitorName: "Stores West",
      };

      // The battery alone, read from the service, as #10008 made it.
      expect(earlier).toHaveLength(1);
      expect(queriesOf(earlier[0]!)).toHaveLength(1);
      expect(
        queriesOf(earlier[0]!)[0]!.metricQueryData.filterData.attributes,
      ).toEqual(
        queriesOf(candidate.getMonitorStep(args()))[0]!.metricQueryData
          .filterData.attributes,
      );
      expect(instancesOf(earlier[0]!)[0]!.data!.filters).toHaveLength(1);

      expect([
        ...MonitorRecommendationUtil.getCoveredRecommendationIds({
          recommendations,
          existingMonitorSteps: [earlier[0]!],
          args: recommendationArgs,
        }),
      ]).toEqual([
        `${MonitorRecommendationResourceType.DeviceManagementConnection}:${id}`,
      ]);
      // And today's step counts too, as itself.
      expect([
        ...MonitorRecommendationUtil.getCoveredRecommendationIds({
          recommendations,
          existingMonitorSteps: [candidate.getMonitorStep(args())],
          args: recommendationArgs,
        }),
      ]).toEqual([
        `${MonitorRecommendationResourceType.DeviceManagementConnection}:${id}`,
      ]);
      // Of another connection, it is none of this one's.
      expect(
        MonitorRecommendationUtil.getCoveredRecommendationIds({
          recommendations,
          existingMonitorSteps: [
            candidate.getEarlierMonitorSteps!({
              ...args(),
              deviceManagementConnectionId: ObjectID.generate().toString(),
            })[0]!,
          ],
          args: recommendationArgs,
        }).size,
      ).toBe(0);
    },
  );
});
