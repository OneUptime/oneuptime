import { beforeAll, describe, expect, test } from "@jest/globals";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Includes from "Common/Types/BaseDatabase/Includes";
import { JSONObject } from "Common/Types/JSON";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricsQuery from "Common/Types/Metrics/MetricsQuery";
import {
  HostAlertTemplate,
  buildHostMonitorConfig,
  getHostAlertTemplateById,
} from "Common/Types/Monitor/HostAlertTemplates";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorStepHostMonitor from "Common/Types/Monitor/MonitorStepHostMonitor";
import { MetricMonitorQueryLanguage } from "Common/Types/Monitor/MonitorStepMetricMonitor";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import type { HostServiceKind as HostServiceKindType } from "../../FeatureSet/Dashboard/src/Utils/HostServiceMonitorPrefill";
import type {
  HostServiceMonitorMatch,
  HostServiceMonitorSubject,
} from "../../FeatureSet/Dashboard/src/Utils/HostServiceMonitors";

/*
 * WHICH MONITORS ALREADY WATCH A SERVICE ON A HOST (#10296).
 *
 * A service's page lists the monitors that watch it, so nobody makes a
 * second one by accident, and its Create Monitor says "Create Another
 * Monitor" while there is one. These pin which monitors those are:
 * a Host monitor of this host, or a Metrics monitor that names this host or
 * no host, with a query of the service's state that names this service, or
 * names none (one that groups by every service, as the host's Systemd Unit
 * Failed alert does, watches this one among them). Never a monitor of
 * another host, of another service, of another metric, or of another kind.
 */

type MonitorsModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/HostServiceMonitors");
type PrefillModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/HostServiceMonitorPrefill");

let Monitors: MonitorsModule;
let Prefill: PrefillModule;
let WINDOWS: HostServiceKindType;
let SYSTEMD: HostServiceKindType;

// Common/UI/Config reads `window` as it loads (HostServiceMonitorPrefill.test).
beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: { pathname: "/", search: "", hash: "" },
    history: {
      state: null,
      replaceState: (): void => {
        // no-op; these tests never navigate.
      },
    },
  };

  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          // no-op
        },
        removeItem: (): void => {
          // no-op
        },
      },
      configurable: true,
      writable: true,
    });
  }

  Monitors = await import(
    "../../FeatureSet/Dashboard/src/Utils/HostServiceMonitors"
  );
  Prefill = await import(
    "../../FeatureSet/Dashboard/src/Utils/HostServiceMonitorPrefill"
  );
  WINDOWS = Prefill.HostServiceKind.WindowsService;
  SYSTEMD = Prefill.HostServiceKind.SystemdUnit;
});

const HOST_ID: string = "11111111-2222-4333-8444-555555555555";
const OTHER_HOST_ID: string = "66666666-7777-4888-8999-aaaaaaaaaaaa";

function subject(
  kind: HostServiceKindType,
  serviceName: string,
): HostServiceMonitorSubject {
  return {
    kind: kind,
    serviceName: serviceName,
    hostId: HOST_ID,
    hostIdentifier: "web-01",
  };
}

interface QuerySpec {
  metricName: string;
  attributes?: Record<string, unknown>;
  groupByAttributeKeys?: Array<string>;
}

function hostMonitorConfig(data: {
  hostIdentifier: string;
  resourceId?: string | undefined;
  queries: Array<QuerySpec>;
}): MonitorStepHostMonitor {
  const config: MonitorStepHostMonitor = buildHostMonitorConfig({
    hostIdentifier: data.hostIdentifier,
    metricName: data.queries[0]!.metricName,
    metricAlias: "a",
    rollingTime: RollingTime.Past5Minutes,
    aggregationType: MetricsAggregationType.Max,
  });

  config.metricViewConfig.queryConfigs = data.queries.map(
    (query: QuerySpec, index: number) => {
      return {
        metricAliasData: {
          metricVariable: `q${index}`,
          title: `q${index}`,
          description: undefined,
          legend: undefined,
          legendUnit: undefined,
        },
        metricQueryData: {
          filterData: {
            metricName: query.metricName,
            attributes: (query.attributes ||
              {}) as unknown as MetricsQuery["attributes"],
            aggegationType: MetricsAggregationType.Max,
            aggregateBy: {},
          },
          ...(query.groupByAttributeKeys
            ? { groupByAttributeKeys: query.groupByAttributeKeys }
            : {}),
        },
      };
    },
  );

  if (data.resourceId) {
    config.resourceId = data.resourceId;
  }

  return config;
}

function stepWith(configure: (step: MonitorStep) => void): MonitorStep {
  const steps: MonitorSteps = new MonitorSteps();
  const step: MonitorStep = steps.data!.monitorStepsInstanceArray[0]!;
  configure(step);
  return step;
}

let monitorCount: number = 0;

function monitorOf(
  monitorType: MonitorType,
  steps: Array<MonitorStep>,
  name?: string,
): Monitor {
  const monitor: Monitor = new Monitor();
  monitorCount++;
  monitor._id = ObjectID.generate().toString();
  monitor.name = name || `Monitor ${monitorCount}`;
  monitor.monitorType = monitorType;

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data!.monitorStepsInstanceArray = steps;
  monitor.monitorSteps = monitorSteps;

  return monitor;
}

function hostMonitor(data: {
  hostIdentifier?: string;
  resourceId?: string | undefined;
  queries: Array<QuerySpec>;
  name?: string;
}): Monitor {
  return monitorOf(
    MonitorType.Host,
    [
      stepWith((step: MonitorStep) => {
        step.setHostMonitor(
          hostMonitorConfig({
            hostIdentifier: data.hostIdentifier ?? "web-01",
            resourceId: data.resourceId,
            queries: data.queries,
          }),
        );
      }),
    ],
    data.name,
  );
}

function metricsMonitor(
  queries: Array<QuerySpec>,
  options?: { isPromQL?: boolean },
): Monitor {
  return monitorOf(MonitorType.Metrics, [
    stepWith((step: MonitorStep) => {
      step.setMetricMonitor({
        ...(options?.isPromQL
          ? {
              queryLanguage: MetricMonitorQueryLanguage.PromQL,
              promQLQuery: 'windows_service_status{name="Spooler"} != 4',
            }
          : {}),
        metricViewConfig: hostMonitorConfig({
          hostIdentifier: "",
          queries: queries,
        }).metricViewConfig,
        rollingTime: RollingTime.Past5Minutes,
        telemetryServiceIds: [],
      });
    }),
  ]);
}

function find(
  monitors: Array<Monitor>,
  watched: HostServiceMonitorSubject,
): Array<{ name: string; isForThisService: boolean }> {
  return Monitors.findMonitorsWatchingHostService({
    monitors: monitors,
    subject: watched,
  }).map((match: HostServiceMonitorMatch) => {
    return {
      name: match.monitor.name || "",
      isForThisService: match.isForThisService,
    };
  });
}

const SPOOLER: QuerySpec = {
  metricName: "windows.service.status",
  attributes: { name: "Spooler" },
};

describe("monitors that watch a Windows service", () => {
  test("a monitor made by Create Monitor on the service's page is listed there", () => {
    const prefill: JSONObject | null = Prefill.buildHostServiceMonitorPrefill({
      link: { hostId: HOST_ID, kind: WINDOWS, serviceName: "Spooler" },
      host: { id: HOST_ID, hostIdentifier: "web-01", name: "Web 01" },
      seeds: {
        operationalMonitorStatusId: null,
        offlineMonitorStatusId: null,
        rankedIncidentSeverityIds: [],
        rankedAlertSeverityIds: [],
      },
    });
    const made: Monitor = monitorOf(
      MonitorType.Host,
      MonitorSteps.fromJSON(prefill!["monitorSteps"] as JSONObject).data!
        .monitorStepsInstanceArray,
      prefill!["name"] as string,
    );

    expect(find([made], subject(WINDOWS, "Spooler"))).toEqual([
      { name: "Spooler on Web 01", isForThisService: true },
    ]);
    // And not on another service's page, nor another host's.
    expect(find([made], subject(WINDOWS, "W3SVC"))).toEqual([]);
    expect(
      find([made], { ...subject(WINDOWS, "Spooler"), hostId: OTHER_HOST_ID }),
    ).toEqual([]);
  });

  test("a Host monitor of this host, bound by its id, whatever host name it was saved with", () => {
    const bound: Monitor = hostMonitor({
      hostIdentifier: "old-name",
      resourceId: HOST_ID,
      queries: [SPOOLER],
      name: "Bound",
    });

    expect(find([bound], subject(WINDOWS, "Spooler"))).toEqual([
      { name: "Bound", isForThisService: true },
    ]);
  });

  test("a Host monitor bound to another host is that host's, even if it was saved with this one's name", () => {
    const other: Monitor = hostMonitor({
      hostIdentifier: "web-01",
      resourceId: OTHER_HOST_ID,
      queries: [SPOOLER],
    });

    expect(find([other], subject(WINDOWS, "Spooler"))).toEqual([]);
  });

  test("a Host monitor with no id is matched by its host name as ingest stores it: trimmed, any case", () => {
    const unbound: Monitor = hostMonitor({
      hostIdentifier: "  WEB-01 ",
      queries: [SPOOLER],
      name: "Unbound",
    });
    const elsewhere: Monitor = hostMonitor({
      hostIdentifier: "web-02",
      queries: [SPOOLER],
    });

    expect(find([unbound, elsewhere], subject(WINDOWS, "Spooler"))).toEqual([
      { name: "Unbound", isForThisService: true },
    ]);
  });

  test("a service's name is matched exactly, as the collector reports it and the metric is filtered", () => {
    const lowerCase: Monitor = hostMonitor({
      resourceId: HOST_ID,
      queries: [
        {
          metricName: "windows.service.status",
          attributes: { name: "spooler" },
        },
      ],
    });

    expect(find([lowerCase], subject(WINDOWS, "Spooler"))).toEqual([]);
  });

  test("not a monitor of another service, or of another metric of this host", () => {
    const otherService: Monitor = hostMonitor({
      resourceId: HOST_ID,
      queries: [
        { metricName: "windows.service.status", attributes: { name: "W3SVC" } },
      ],
    });
    const cpu: Monitor = hostMonitor({
      resourceId: HOST_ID,
      queries: [{ metricName: "system.cpu.utilization" }],
    });

    expect(find([otherService, cpu], subject(WINDOWS, "Spooler"))).toEqual([]);
  });

  test("a monitor of every service on the host watches this one too, and says it is not this service's alone", () => {
    const everyService: Monitor = hostMonitor({
      resourceId: HOST_ID,
      queries: [
        {
          metricName: "windows.service.status",
          groupByAttributeKeys: ["name"],
        },
      ],
      name: "Every service",
    });

    expect(find([everyService], subject(WINDOWS, "Spooler"))).toEqual([
      { name: "Every service", isForThisService: false },
    ]);
  });

  test("a step with several queries is listed for the one that names this service", () => {
    const several: Monitor = hostMonitor({
      resourceId: HOST_ID,
      queries: [
        { metricName: "system.memory.usage" },
        {
          metricName: "windows.service.status",
          groupByAttributeKeys: ["name"],
        },
        SPOOLER,
      ],
      name: "Several",
    });

    expect(find([several], subject(WINDOWS, "Spooler"))).toEqual([
      { name: "Several", isForThisService: true },
    ]);
  });

  describe("a Metrics monitor someone built by hand (the issue's workaround)", () => {
    test("one that names this host and this service", () => {
      expect(
        find(
          [
            metricsMonitor([
              {
                metricName: "windows.service.status",
                attributes: { name: "Spooler", "resource.host.name": "Web-01" },
              },
            ]),
          ],
          subject(WINDOWS, "Spooler"),
        ),
      ).toEqual([{ name: expect.any(String), isForThisService: true }]);
    });

    test("one that names no host reads this one's too", () => {
      expect(
        find([metricsMonitor([SPOOLER])], subject(WINDOWS, "Spooler")),
      ).toHaveLength(1);
    });

    test("not one that names another host", () => {
      expect(
        find(
          [
            metricsMonitor([
              {
                metricName: "windows.service.status",
                attributes: { name: "Spooler", "resource.host.name": "web-02" },
              },
            ]),
          ],
          subject(WINDOWS, "Spooler"),
        ),
      ).toEqual([]);
    });

    test("a list of services, as an Includes or as it is stored, is read", () => {
      const asIncludes: Monitor = metricsMonitor([
        {
          metricName: "windows.service.status",
          attributes: { name: new Includes(["W3SVC", "Spooler"]) },
        },
      ]);
      const asStored: Monitor = metricsMonitor([
        {
          metricName: "windows.service.status",
          attributes: { name: { _type: "Includes", value: ["Spooler"] } },
        },
      ]);
      const without: Monitor = metricsMonitor([
        {
          metricName: "windows.service.status",
          attributes: { name: new Includes(["W3SVC"]) },
        },
      ]);

      expect(
        find([asIncludes, asStored, without], subject(WINDOWS, "Spooler")),
      ).toHaveLength(2);
    });

    test("a filter this cannot read, such as a search, is not taken for this service", () => {
      expect(
        find(
          [
            metricsMonitor([
              {
                metricName: "windows.service.status",
                attributes: { name: { _type: "Search", value: "Spool" } },
              },
            ]),
          ],
          subject(WINDOWS, "Spooler"),
        ),
      ).toEqual([]);
    });

    test("not one written in PromQL: its expression is not read", () => {
      expect(
        find(
          [metricsMonitor([SPOOLER], { isPromQL: true })],
          subject(WINDOWS, "Spooler"),
        ),
      ).toEqual([]);
    });
  });

  test("not a monitor of another kind", () => {
    const website: Monitor = monitorOf(MonitorType.Website, [
      stepWith((step: MonitorStep) => {
        step.setHostMonitor(
          hostMonitorConfig({ hostIdentifier: "web-01", queries: [SPOOLER] }),
        );
      }),
    ]);

    expect(find([website], subject(WINDOWS, "Spooler"))).toEqual([]);
  });

  test("the list keeps the order it was read in, by name", () => {
    const first: Monitor = hostMonitor({
      resourceId: HOST_ID,
      queries: [SPOOLER],
      name: "A",
    });
    const second: Monitor = metricsMonitor([SPOOLER]);
    second.name = "B";

    expect(
      find([first, second], subject(WINDOWS, "Spooler")).map(
        (match: { name: string }) => {
          return match.name;
        },
      ),
    ).toEqual(["A", "B"]);
  });
});

describe("monitors that watch a systemd unit", () => {
  test("the host's Systemd Unit Failed alert watches every unit, this one among them", () => {
    const template: HostAlertTemplate = getHostAlertTemplateById(
      "host-systemd-unit-failed",
    )!;
    const failed: Monitor = monitorOf(
      MonitorType.Host,
      [
        template.getMonitorStep({
          hostIdentifier: "web-01",
          onlineMonitorStatusId: ObjectID.generate(),
          offlineMonitorStatusId: ObjectID.generate(),
          defaultIncidentSeverityId: ObjectID.generate(),
          defaultAlertSeverityId: ObjectID.generate(),
          monitorName: "web-01 - Systemd Unit Failed",
        }),
      ],
      "web-01 - Systemd Unit Failed",
    );

    expect(find([failed], subject(SYSTEMD, "nginx.service"))).toEqual([
      { name: "web-01 - Systemd Unit Failed", isForThisService: false },
    ]);
    // It reads systemd's state, not a Windows service's.
    expect(find([failed], subject(WINDOWS, "nginx.service"))).toEqual([]);
  });

  test("a monitor made by Create Monitor on the unit's page is listed there, and not on another unit's", () => {
    const prefill: JSONObject | null = Prefill.buildHostServiceMonitorPrefill({
      link: { hostId: HOST_ID, kind: SYSTEMD, serviceName: "nginx.service" },
      host: { id: HOST_ID, hostIdentifier: "web-01" },
      seeds: {
        operationalMonitorStatusId: null,
        offlineMonitorStatusId: null,
        rankedIncidentSeverityIds: [],
        rankedAlertSeverityIds: [],
      },
    });
    const made: Monitor = monitorOf(
      MonitorType.Host,
      MonitorSteps.fromJSON(prefill!["monitorSteps"] as JSONObject).data!
        .monitorStepsInstanceArray,
      "made",
    );

    expect(find([made], subject(SYSTEMD, "nginx.service"))).toEqual([
      { name: "made", isForThisService: true },
    ]);
    expect(find([made], subject(SYSTEMD, "sshd.service"))).toEqual([]);
    // A Windows service of the same name is not the unit.
    expect(find([made], subject(WINDOWS, "nginx.service"))).toEqual([]);
  });
});

describe("how the list is read", () => {
  test("the project's Host and Metrics monitors that are not archived, with what the card draws", () => {
    expect(Monitors.HOST_SERVICE_MONITOR_TYPES).toEqual([
      MonitorType.Host,
      MonitorType.Metrics,
    ]);
    expect(Monitors.HOST_SERVICE_MONITOR_SELECT).toEqual(
      expect.objectContaining({
        _id: true,
        name: true,
        monitorType: true,
        monitorSteps: true,
        currentMonitorStatus: { name: true, color: true },
        disableActiveMonitoring: true,
        isArchived: true,
      }),
    );
  });
});
