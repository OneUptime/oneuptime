import {
  ANDROID_TEMPLATE_GROUP_BY,
  HostAlertTemplate,
  HostAlertTemplateArgs,
  getAllHostAlertTemplates,
  getAndroidHostAlertTemplates,
  getHostAlertTemplateById,
  getHostAlertTemplatesFor,
} from "../../../Types/Monitor/HostAlertTemplates";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import SeriesDebugHints, {
  SeriesDebugCommand,
} from "../../../Types/Monitor/SeriesContext/SeriesDebugHints";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * Issue #9802: alert templates for what only an Android device reports - a
 * kiosk unplugged, a battery run down, a device overheating, a restart loop,
 * its storage nearly full - offered for the hosts whose OS is Android, each
 * reading a metric the OneUptime Android agent sends, and each alert
 * starting with adb commands rather than a server's shell.
 */

function args(): HostAlertTemplateArgs {
  return {
    hostIdentifier: "store-0412-kiosk-02",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Kiosk monitor",
  };
}

function stepOf(id: string): MonitorStep {
  return getHostAlertTemplateById(id)!.getMonitorStep(args());
}

function metricNamesOf(step: MonitorStep): Array<string> {
  return (step.data!.hostMonitor!.metricViewConfig.queryConfigs || []).map(
    (query: MetricQueryConfigData) => {
      return String(query.metricQueryData.filterData.metricName);
    },
  );
}

function criteriaOf(step: MonitorStep): Array<MonitorCriteriaInstance> {
  return step.data!.monitorCriteria!.data!.monitorCriteriaInstanceArray;
}

function offlineFilterOf(step: MonitorStep): {
  filterType?: string | undefined;
  value?: unknown;
} {
  return criteriaOf(step)[0]!.data!.filters[0]! as {
    filterType?: string | undefined;
    value?: unknown;
  };
}

const ANDROID_IDS: Array<string> = [
  "android-device-unplugged",
  "android-low-battery",
  "android-device-overheating",
  "android-restart-loop",
  "android-storage-nearly-full",
  "android-high-cpu",
];

// What the agent sends (agents/AndroidAgent collect/HostMetrics.kt), and so what each template may read.
const AGENT_METRICS: Array<string> = [
  "android.battery.plugged",
  "hw.battery.charge",
  "android.thermal.status",
  "android.boot.recent_count",
  "system.filesystem.utilization",
  "system.cpu.utilization",
  "system.memory.usage",
  "system.memory.utilization",
  "system.uptime",
];

describe("the Android templates (issue #9802)", () => {
  test("there is one for each failure only a device has", () => {
    expect(
      getAndroidHostAlertTemplates().map((template: HostAlertTemplate) => {
        return template.id;
      }),
    ).toEqual(ANDROID_IDS);
  });

  test.each(ANDROID_IDS)(
    "%s is complete and reads what the agent sends",
    (id: string) => {
      const template: HostAlertTemplate = getHostAlertTemplateById(id)!;
      const step: MonitorStep = template.getMonitorStep(args());

      expect(template.name.length).toBeGreaterThan(0);
      expect(template.summary.length).toBeGreaterThan(0);
      expect(template.summary.length).toBeLessThan(80);
      expect(template.description.length).toBeGreaterThan(40);
      expect(["Availability", "Resource"]).toContain(template.category);
      expect(["Critical", "Warning"]).toContain(template.severity);
      expect(step.data!.hostMonitor!.hostIdentifier).toBe(
        "store-0412-kiosk-02",
      );
      for (const metricName of metricNamesOf(step)) {
        expect(AGENT_METRICS).toContain(metricName);
      }
      // An offline criteria that raises an incident and an alert, then an online one that clears it.
      const [offline, online] = criteriaOf(step);
      expect(offline!.data!.createIncidents).toBe(true);
      expect(offline!.data!.incidents![0]!.title).toMatch(
        /^\[Android\] .+ - store-0412-kiosk-02$/,
      );
      expect(online!.data!.monitorStatusId).toBeDefined();
    },
  );

  test("each groups by the device and its API level, so the alert names it and its first commands are adb's", () => {
    for (const id of ANDROID_IDS) {
      const groupBy: Array<string> = MonitorStep.getGroupByAttributeKeys(
        stepOf(id),
      );
      expect(groupBy).toContain("resource.android.os.api_level");
      if (id === "android-storage-nearly-full") {
        expect(groupBy).toEqual([
          "mountpoint",
          "resource.android.os.api_level",
        ]);
      } else {
        expect(groupBy).toEqual(ANDROID_TEMPLATE_GROUP_BY);
      }
    }
  });

  test("the thresholds: unplugged at 0, battery below 20%, thermal severe, three boots, storage over 90%, CPU over 80%", () => {
    expect(offlineFilterOf(stepOf("android-device-unplugged"))).toMatchObject({
      value: 1,
    });
    expect(offlineFilterOf(stepOf("android-low-battery"))).toMatchObject({
      value: 20,
    });
    expect(offlineFilterOf(stepOf("android-device-overheating"))).toMatchObject(
      { value: 3 },
    );
    expect(offlineFilterOf(stepOf("android-restart-loop"))).toMatchObject({
      value: 3,
    });
    expect(
      offlineFilterOf(stepOf("android-storage-nearly-full")),
    ).toMatchObject({ value: 90 });
    expect(offlineFilterOf(stepOf("android-high-cpu"))).toMatchObject({
      value: 80,
    });
  });

  test("an Android device's CPU is busy as 1 - idle, which both ways the agent reads it give", () => {
    const formulas: Array<string> = (
      stepOf("android-high-cpu").data!.hostMonitor!.metricViewConfig
        .formulaConfigs || []
    ).map((formula: { metricFormulaData: { metricFormula: string } }) => {
      return formula.metricFormulaData.metricFormula;
    });

    expect(formulas).toEqual(["(1 - android_cpu_idle) * 100"]);
  });

  test("the server templates are unchanged, and none is an Android one", () => {
    const ids: Array<string> = getAllHostAlertTemplates().map(
      (template: HostAlertTemplate) => {
        return template.id;
      },
    );
    expect(ids).not.toContain("android-device-unplugged");
    expect(ids).toContain("host-high-cpu");
  });
});

describe("which templates a host is offered", () => {
  const idsFor: (host: {
    isAndroid?: boolean;
    reportsCpu?: boolean;
  }) => Array<string> = (host: {
    isAndroid?: boolean;
    reportsCpu?: boolean;
  }): Array<string> => {
    return getHostAlertTemplatesFor(host).map((template: HostAlertTemplate) => {
      return template.id;
    });
  };

  test("a server is offered every server template, as before", () => {
    expect(idsFor({})).toEqual(
      getAllHostAlertTemplates().map((template: HostAlertTemplate) => {
        return template.id;
      }),
    );
  });

  test("an Android device the server ones it answers and its own, without CPU while it reports none", () => {
    expect(idsFor({ isAndroid: true })).toEqual([
      "host-stopped-reporting",
      "host-restarted",
      "host-high-memory",
      "android-device-unplugged",
      "android-low-battery",
      "android-device-overheating",
      "android-restart-loop",
      "android-storage-nearly-full",
    ]);
  });

  test("an Android device that reports CPU use is offered its CPU template, never the server one", () => {
    const ids: Array<string> = idsFor({ isAndroid: true, reportsCpu: true });

    expect(ids).toContain("android-high-cpu");
    expect(ids).not.toContain("host-high-cpu");
    expect(ids).not.toContain("host-high-filesystem");
    expect(ids).not.toContain("host-systemd-unit-failed");
  });
});

describe("the recommendations for a host", () => {
  const recommendationIds: (
    context?: Parameters<
      typeof MonitorRecommendationCatalog.getRecommendations
    >[1],
  ) => Array<string> = (
    context?: Parameters<
      typeof MonitorRecommendationCatalog.getRecommendations
    >[1],
  ): Array<string> => {
    return MonitorRecommendationCatalog.getRecommendations(
      MonitorRecommendationResourceType.Host,
      context,
    ).map((recommendation: MonitorRecommendation) => {
      return recommendation.recommendationId;
    });
  };

  test("a host whose OS is android is offered the Android set", () => {
    const ids: Array<string> = recommendationIds({ hostOsType: "android" });

    expect(ids).toContain("Host:android-restart-loop");
    expect(ids).toContain("Host:host-stopped-reporting");
    expect(ids).not.toContain("Host:host-high-swap");
  });

  test("any other host, or one not known yet, the server set", () => {
    expect(recommendationIds()).not.toContain("Host:android-restart-loop");
    expect(recommendationIds({ hostOsType: "linux" })).toContain(
      "Host:host-high-swap",
    );
  });

  test("every Android template is among every recommendation a host can get, so the registry's guards cover it", () => {
    const all: Array<string> =
      MonitorRecommendationCatalog.getAllRecommendations()
        .filter((recommendation: MonitorRecommendation) => {
          return recommendation.monitorType === MonitorType.Host;
        })
        .map((recommendation: MonitorRecommendation) => {
          return recommendation.recommendationId;
        });

    for (const id of ANDROID_IDS) {
      expect(all).toContain(`Host:${id}`);
    }
  });
});

describe("an Android alert's first commands", () => {
  const commandsFor: (labels: Record<string, string>) => Array<string> = (
    labels: Record<string, string>,
  ): Array<string> => {
    return SeriesDebugHints.getDebugCommands({
      monitorType: MonitorType.Host,
      seriesLabels: labels,
    }).map((command: SeriesDebugCommand) => {
      return command.command;
    });
  };

  test("a device's alert starts with adb, never a server's shell", () => {
    const commands: Array<string> = commandsFor({
      "resource.host.name": "store-0412-kiosk-02",
      "resource.os.name": "Android",
    });

    expect(commands[0]).toBe("adb shell dumpsys battery");
    expect(commands).toContain("adb shell dumpsys thermalservice");
    expect(commands).toContain("adb shell getprop sys.boot.reason");
    expect(
      commands.every((command: string) => {
        return command.startsWith("adb shell ");
      }),
    ).toBe(true);
  });

  test("the API level the Android templates group by is enough to know a device", () => {
    expect(
      commandsFor({
        "resource.host.name": "store-0412-kiosk-02",
        "resource.android.os.api_level": "34",
      })[0],
    ).toBe("adb shell dumpsys battery");
  });

  test("a device's full storage starts with its free space", () => {
    expect(
      commandsFor({ mountpoint: "/data", "resource.os.name": "Android" })[0],
    ).toBe("adb shell df -h /data");
  });

  test("a server's alert is unchanged", () => {
    expect(commandsFor({ mountpoint: "/var" })[0]).toBe(
      "df -h /var && df -i /var",
    );
    expect(
      commandsFor({ mountpoint: "/var", "resource.os.name": "Ubuntu" })[0],
    ).toBe("df -h /var && df -i /var");
  });
});
