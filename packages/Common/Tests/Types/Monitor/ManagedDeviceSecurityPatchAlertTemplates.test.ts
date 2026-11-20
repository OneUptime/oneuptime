import { describe, expect, test } from "@jest/globals";
import {
  MANAGED_DEVICE_ALERT_MONITORING_INTERVAL,
  MANAGED_DEVICE_CHECK_IN_GROUP_BY_ATTRIBUTES,
  MANAGED_DEVICE_CHECK_IN_ROLLING_TIME,
  ManagedDeviceAlertTemplate,
  ManagedDeviceAlertTemplateArgs,
  buildManagedDeviceSecurityPatchMetricMonitor,
  getAllManagedDeviceAlertTemplates,
  getManagedDeviceAlertTemplateById,
  getManagedDeviceAlertTemplatesFor,
} from "../../../Types/Monitor/ManagedDeviceAlertTemplates";
import {
  MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME,
  MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME,
  MANAGED_DEVICE_SECURITY_PATCH_AGE_UNIT,
  ManagedDeviceCheckInAttribute,
} from "../../../Types/DeviceManagement/ManagedDeviceCheckIn";
import DeviceManagementProvider, {
  DEVICE_MANAGEMENT_PROVIDERS,
} from "../../../Types/DeviceManagement/DeviceManagementProvider";
import { ManagedDevicePlatform } from "../../../Types/DeviceManagement/ManagedDevicePlatform";
import { MANAGED_DEVICE_CONNECTION_READ_AGE_METRIC_NAME } from "../../../Types/DeviceManagement/DeviceManagementConnectionReading";
import { ANDROID_SECURITY_PATCH_MAX_AGE_DAYS } from "../../../Types/Host/AndroidSecurityPatch";
import { getHostAlertTemplateById } from "../../../Types/Monitor/HostAlertTemplates";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStepMetricMonitor from "../../../Types/Monitor/MonitorStepMetricMonitor";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
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
import ManagedDeviceCheckInSilence from "../../../Server/Utils/Monitor/ManagedDeviceCheckInSilence";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import ObjectID from "../../../Types/ObjectID";

/*
 * Security Patch Out of Date, for the Android devices a device manager
 * imports (#10098): one Metrics monitor per connection, over how old each
 * Android device's security patch level is at the connection's latest read
 * (ManagedDeviceCheckIn), alerting once per device more than 90 days behind
 * - the rule Inventory's Security Patch Level filter and the Android agent's
 * Host template read - and never for a device the agent reports, which its
 * host's own Security Patch Out of Date watches.
 */

const CONNECTION_ID: string = ObjectID.generate().toString();

const PATCH_TEMPLATE_IDS: Record<DeviceManagementProvider, string> = {
  [DeviceManagementProvider.Esper]: "esper-security-patch-out-of-date",
  [DeviceManagementProvider.Intune]: "intune-security-patch-out-of-date",
  [DeviceManagementProvider.WorkspaceOne]:
    "workspace-one-security-patch-out-of-date",
  [DeviceManagementProvider.Soti]: "soti-security-patch-out-of-date",
};

// What each service's template calls the service in its sentences.
const SERVICE_NAMES: Record<DeviceManagementProvider, string> = {
  [DeviceManagementProvider.Esper]: "Esper",
  [DeviceManagementProvider.Intune]: "Intune",
  [DeviceManagementProvider.WorkspaceOne]: "Workspace ONE",
  [DeviceManagementProvider.Soti]: "MobiControl",
};

function buildArgs(
  overrides: Partial<ManagedDeviceAlertTemplateArgs> = {},
): ManagedDeviceAlertTemplateArgs {
  return {
    deviceManagementConnectionId: CONNECTION_ID,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Esper acme - Esper Security Patch Out of Date",
    ...overrides,
  };
}

function templateOf(
  provider: DeviceManagementProvider,
): ManagedDeviceAlertTemplate {
  return getManagedDeviceAlertTemplateById(PATCH_TEMPLATE_IDS[provider])!;
}

function stepOf(
  provider: DeviceManagementProvider = DeviceManagementProvider.Esper,
  args: ManagedDeviceAlertTemplateArgs = buildArgs(),
): MonitorStep {
  return templateOf(provider).getMonitorStep(args);
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

const PROVIDER_CASES: Array<[DeviceManagementProvider]> =
  DEVICE_MANAGEMENT_PROVIDERS.map(
    (provider: DeviceManagementProvider): [DeviceManagementProvider] => {
      return [provider];
    },
  );

describe("every device manager's connection is offered one", () => {
  test("one per service, each its own service's, after its check-ins", () => {
    for (const provider of DEVICE_MANAGEMENT_PROVIDERS) {
      const offered: Array<ManagedDeviceAlertTemplate> =
        getManagedDeviceAlertTemplatesFor(provider);
      const patches: Array<ManagedDeviceAlertTemplate> = offered.filter(
        (template: ManagedDeviceAlertTemplate): boolean => {
          return (
            template.metricName ===
            MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME
          );
        },
      );

      expect({
        provider,
        patches: patches.map((template: ManagedDeviceAlertTemplate) => {
          return template.id;
        }),
      }).toEqual({ provider, patches: [PATCH_TEMPLATE_IDS[provider]] });

      /*
       * The connection itself first (#10006), then its devices' check-ins:
       * what a connection is set up for first.
       */
      expect(offered[offered.length - 1]!.id).toBe(
        PATCH_TEMPLATE_IDS[provider],
      );
      expect(offered[0]!.metricName).toBe(
        MANAGED_DEVICE_CONNECTION_READ_AGE_METRIC_NAME,
      );
      expect(offered[1]!.metricName).toBe(
        MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME,
      );
    }
  });

  test("a connection whose service is not known is Esper's, and gets Esper's", () => {
    expect(
      getManagedDeviceAlertTemplatesFor(undefined).map(
        (template: ManagedDeviceAlertTemplate) => {
          return template.id;
        },
      ),
    ).toContain("esper-security-patch-out-of-date");
    expect(getManagedDeviceAlertTemplatesFor("another-service")).toEqual([]);
  });

  test.each(PROVIDER_CASES)(
    "%s's is a recommendation of its connections",
    (provider: DeviceManagementProvider) => {
      const recommendation: MonitorRecommendation | undefined =
        MonitorRecommendationCatalog.getRecommendations(
          MonitorRecommendationResourceType.DeviceManagementConnection,
          { deviceManagementProvider: provider },
        ).find((candidate: MonitorRecommendation): boolean => {
          return candidate.templateId === PATCH_TEMPLATE_IDS[provider];
        });

      expect(recommendation).toBeDefined();
      expect(recommendation!.monitorType).toBe(MonitorType.Metrics);
      expect(recommendation!.category).toBe("Security");
      expect(recommendation!.severity).toBe("Warning");
      expect(recommendation!.summary).toBe(templateOf(provider).summary);
      expect(recommendation!.monitoringInterval).toBe(
        MANAGED_DEVICE_ALERT_MONITORING_INTERVAL,
      );
    },
  );

  test("every possible recommendation of a connection holds the four", () => {
    const ids: Array<string> =
      MonitorRecommendationCatalog.getAllPossibleRecommendations(
        MonitorRecommendationResourceType.DeviceManagementConnection,
      ).map((recommendation: MonitorRecommendation): string => {
        return recommendation.templateId;
      });

    for (const id of Object.values(PATCH_TEMPLATE_IDS)) {
      expect(ids).toContain(id);
    }
    expect(ids).toHaveLength(getAllManagedDeviceAlertTemplates().length);
  });
});

describe("what it says", () => {
  test.each(PROVIDER_CASES)(
    "%s's names its service, says when it fires in one line, and why behind it",
    (provider: DeviceManagementProvider) => {
      const template: ManagedDeviceAlertTemplate = templateOf(provider);
      const service: string = SERVICE_NAMES[provider];

      expect(template.provider).toBe(provider);
      expect(template.name.endsWith("Security Patch Out of Date")).toBe(true);
      expect(template.category).toBe("Security");
      expect(template.severity).toBe("Warning");

      // One line, as the other templates' cards read.
      expect(template.summary.length).toBeLessThanOrEqual(80);
      expect(template.summary.endsWith(".")).toBe(true);
      expect(template.summary).toContain(service);
      expect(template.summary).toContain("90 days");
      expect(template.summary).not.toMatch(/[a-z]+\.[a-z_.]+/);

      expect(template.description).toContain(
        `Android device ${service} manages`,
      );
      expect(template.description).toContain("one alert per device");
      expect(template.description).toContain("more than 90 days old");
      // The agent's devices are its host's to alert on.
      expect(template.description).toContain(
        `its host's ${getHostAlertTemplateById("android-security-patch-out-of-date")!.name}`,
      );
    },
  );

  test("each names its service apart from the others", () => {
    const names: Array<string> = DEVICE_MANAGEMENT_PROVIDERS.map(
      (provider: DeviceManagementProvider): string => {
        return templateOf(provider).name;
      },
    );

    expect(names).toEqual([
      "Esper Security Patch Out of Date",
      "Intune Security Patch Out of Date",
      "Workspace ONE Security Patch Out of Date",
      "SOTI Security Patch Out of Date",
    ]);
    expect(new Set(names).size).toBe(names.length);
  });

  test.each(PROVIDER_CASES)(
    "%s's alert names the service, says how to update the device, and that it resolves on its own",
    (provider: DeviceManagementProvider) => {
      const service: string = SERVICE_NAMES[provider];
      const [unhealthy]: Array<MonitorCriteriaInstance> = instancesOf(
        stepOf(provider),
      );
      const alert: { title: string; description: string } =
        unhealthy!.data!.alerts[0]!;

      expect(alert.title).toBe(`[${service}] Security patch out of date`);
      expect(alert.description).toContain(
        `the system update policy ${service} sets on it`,
      );
      expect(alert.description).toContain("Settings, System, Software update");
      expect(alert.description).toContain(
        `This resolves on its own once ${service} reports a patch level from the last 90 days.`,
      );
      expect(unhealthy!.data!.incidents[0]!.title).toBe(alert.title);
      expect(unhealthy!.data!.name).toBe(
        "A device's security patch is out of date",
      );
    },
  );
});

describe("what the monitor reads", () => {
  test.each(PROVIDER_CASES)(
    "%s's: how old each Android device's patch is, of this connection's devices no agent reports",
    (provider: DeviceManagementProvider) => {
      const query: MetricQueryConfigData = queryOf(stepOf(provider));

      expect(query.metricQueryData.filterData.metricName).toBe(
        MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME,
      );
      expect(query.metricQueryData.filterData.attributes).toEqual({
        [ManagedDeviceCheckInAttribute.ConnectionId]: CONNECTION_ID,
        // The Android agent's devices are their hosts' (no second alert).
        [ManagedDeviceCheckInAttribute.IsHost]: "false",
        [ManagedDeviceCheckInAttribute.Platform]: ManagedDevicePlatform.Android,
      });
      expect(query.metricQueryData.filterData.aggegationType).toBe(
        MetricsAggregationType.Max,
      );
      expect(query.metricAliasData!.legendUnit).toBe(
        MANAGED_DEVICE_SECURITY_PATCH_AGE_UNIT,
      );
    },
  );

  test("one series, and one alert, per device: by its name in the service", () => {
    expect(MonitorStep.getGroupByAttributeKeys(stepOf())).toEqual([
      ...MANAGED_DEVICE_CHECK_IN_GROUP_BY_ATTRIBUTES,
    ]);
    expect(MANAGED_DEVICE_CHECK_IN_GROUP_BY_ATTRIBUTES).toEqual([
      ManagedDeviceCheckInAttribute.DeviceName,
    ]);
  });

  test("each device on its latest reading, over the window the check-ins read", () => {
    const monitor: MonitorStepMetricMonitor = metricMonitorOf(stepOf());

    expect(monitor.judgeLatestReading).toBe(true);
    expect(monitor.rollingTime).toBe(MANAGED_DEVICE_CHECK_IN_ROLLING_TIME);
  });

  test("the query alone, for another page to build on, reads the same", () => {
    expect(
      buildManagedDeviceSecurityPatchMetricMonitor({
        deviceManagementConnectionId: CONNECTION_ID,
      }),
    ).toEqual(metricMonitorOf(stepOf()));
  });

  test("is a valid monitor step, for every service", () => {
    for (const provider of DEVICE_MANAGEMENT_PROVIDERS) {
      const steps: MonitorSteps = new MonitorSteps();
      steps.data = {
        monitorStepsInstanceArray: [stepOf(provider)],
        defaultMonitorStatusId: ObjectID.generate(),
      };

      expect({
        provider,
        error: MonitorSteps.getValidationError(steps, MonitorType.Metrics),
      }).toEqual({ provider, error: null });
    }
  });

  test("never reads the agent's own metric, which the host's template reads by the host's name", () => {
    const hostTemplate: MonitorStep = getHostAlertTemplateById(
      "android-security-patch-out-of-date",
    )!.getMonitorStep({
      hostIdentifier: "esp-id-aaaaw",
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      monitorName: "ESP-ID-AAAAW",
    });
    const hostMetricNames: Array<string> = (
      hostTemplate.data!.hostMonitor?.metricViewConfig.queryConfigs || []
    ).map((config: MetricQueryConfigData): string => {
      return String(config.metricQueryData.filterData.metricName || "");
    });

    expect(hostMetricNames).toEqual(["android.os.security_patch.age"]);
    expect(hostMetricNames).not.toContain(
      MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME,
    );
    expect(queryOf(stepOf()).metricQueryData.filterData.metricName).not.toBe(
      "android.os.security_patch.age",
    );
  });
});

describe("when it fires, and when it resolves", () => {
  test("fires on a device whose latest reading is more than 90 days, the rule Inventory reads", () => {
    const [unhealthy]: Array<MonitorCriteriaInstance> = instancesOf(stepOf());
    const filter: CriteriaFilter = filterOf(unhealthy!);

    expect(ANDROID_SECURITY_PATCH_MAX_AGE_DAYS).toBe(90);
    expect(
      templateOf(DeviceManagementProvider.Esper).maxSecurityPatchAgeInDays,
    ).toBe(ANDROID_SECURITY_PATCH_MAX_AGE_DAYS);
    expect(
      templateOf(DeviceManagementProvider.Esper).thresholdInMinutes,
    ).toBeUndefined();
    expect(filter.checkOn).toBe(CheckOn.MetricValue);
    expect(filter.filterType).toBe(FilterType.GreaterThan);
    expect(Number(filter.value)).toBe(90);
    expect(filter.metricMonitorOptions?.metricAggregationType).toBe(
      EvaluateOverTimeType.AnyValue,
    );
    // No reading is no news, never a breach.
    expect(filter.metricMonitorOptions?.onNoDataPolicy).toBeUndefined();
  });

  test("resolves once the device's latest reading is 90 days or newer: no dead band", () => {
    const [, healthy]: Array<MonitorCriteriaInstance> = instancesOf(stepOf());
    const filter: CriteriaFilter = filterOf(healthy!);

    expect(filter.filterType).toBe(FilterType.LessThanOrEqualTo);
    expect(Number(filter.value)).toBe(90);
    expect(filter.metricMonitorOptions?.metricAggregationType).toBe(
      EvaluateOverTimeType.AnyValue,
    );
    expect(healthy!.data!.createAlerts).toBe(false);
    expect(healthy!.data!.createIncidents).toBe(false);
  });

  test("opens an alert that resolves itself", () => {
    const [unhealthy]: Array<MonitorCriteriaInstance> = instancesOf(stepOf());

    expect(unhealthy!.data!.createAlerts).toBe(true);
    expect(unhealthy!.data!.alerts[0]!.autoResolveAlert).toBe(true);
    expect(unhealthy!.data!.incidents[0]!.autoResolveIncident).toBe(true);
  });

  test("made from the Recommendations page as it opens (Create an alert), it opens an alert and no incident", () => {
    const step: MonitorStep =
      MonitorRecommendationUtil.applyNotificationSettingsToMonitorStep({
        monitorStep: stepOf(),
        notificationSettings: {
          notificationMode: MonitorRecommendationNotificationMode.Alert,
        },
        severity: templateOf(DeviceManagementProvider.Esper).severity,
      });
    const [unhealthy]: Array<MonitorCriteriaInstance> = instancesOf(step);

    expect(unhealthy!.data!.createAlerts).toBe(true);
    expect(unhealthy!.data!.createIncidents).toBe(false);
  });

  test("never names the monitor twice in the alert's title", () => {
    const [unhealthy]: Array<MonitorCriteriaInstance> = instancesOf(
      stepOf(
        DeviceManagementProvider.Esper,
        buildArgs({ monitorName: "Esper acme - Something" }),
      ),
    );

    expect(unhealthy!.data!.alerts[0]!.title).not.toContain("Something");
  });

  test("a window with no patch reading of any device is the connection gone quiet, not every device updated", () => {
    const response: MetricMonitorResponse = {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      metricViewConfig: MonitorStep.getMetricsViewConfig(stepOf())!,
      metricResult: [{ data: [] }],
      seriesBreakdown: [],
    } as unknown as MetricMonitorResponse;

    expect(ManagedDeviceCheckInSilence.readsCheckIns(response)).toBe(true);
    expect(ManagedDeviceCheckInSilence.isQuietWindow(response)).toBe(true);
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
      monitorName: "Esper - Esper Security Patch Out of Date",
    };
  }

  const recommendations: Array<MonitorRecommendation> =
    MonitorRecommendationCatalog.getRecommendations(
      MonitorRecommendationResourceType.DeviceManagementConnection,
      { deviceManagementProvider: DeviceManagementProvider.Esper },
    );
  const patch: MonitorRecommendation = recommendations.find(
    (candidate: MonitorRecommendation): boolean => {
      return candidate.templateId === "esper-security-patch-out-of-date";
    },
  )!;
  const checkIn: MonitorRecommendation = recommendations[0]!;

  test("names the connection and the patch metric as what the monitor watches", () => {
    const fingerprint: MonitorRecommendationFingerprint | undefined =
      MonitorRecommendationUtil.getFingerprintFromMonitorStep(
        patch.getMonitorStep(argsFor(CONNECTION_ID)),
      );

    expect(fingerprint!.resourceIdentifier).toBe(CONNECTION_ID);
    expect(fingerprint!.metricNames).toEqual([
      MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME,
    ]);
  });

  test("a check-in monitor of the connection does not cover it, nor it a check-in one", () => {
    const covered: Set<string> =
      MonitorRecommendationUtil.getCoveredRecommendationIds({
        recommendations: [checkIn, patch],
        existingMonitorSteps: [checkIn.getMonitorStep(argsFor(CONNECTION_ID))],
        args: argsFor(CONNECTION_ID),
      });

    expect(covered.has(checkIn.recommendationId)).toBe(true);
    expect(covered.has(patch.recommendationId)).toBe(false);

    const coveredByPatch: Set<string> =
      MonitorRecommendationUtil.getCoveredRecommendationIds({
        recommendations: [checkIn, patch],
        existingMonitorSteps: [patch.getMonitorStep(argsFor(CONNECTION_ID))],
        args: argsFor(CONNECTION_ID),
      });

    expect(coveredByPatch.has(patch.recommendationId)).toBe(true);
    expect(coveredByPatch.has(checkIn.recommendationId)).toBe(false);
  });

  test("another connection's monitor does not cover it", () => {
    expect(
      MonitorRecommendationUtil.getCoveredRecommendationIds({
        recommendations: [patch],
        existingMonitorSteps: [
          patch.getMonitorStep(argsFor(ObjectID.generate().toString())),
        ],
        args: argsFor(CONNECTION_ID),
      }).size,
    ).toBe(0);
  });
});
