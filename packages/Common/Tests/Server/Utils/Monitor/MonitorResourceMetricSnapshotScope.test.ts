/*
 * MonitorResource reaches the native isolated-vm addon through the criteria
 * evaluator's sandbox runner. Nothing here runs a sandbox, and the prebuilt
 * binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import MonitorAlert from "../../../../Server/Utils/Monitor/MonitorAlert";
import MonitorLogUtil from "../../../../Server/Utils/Monitor/MonitorLogUtil";
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import MonitorStatusTimelineUtil from "../../../../Server/Utils/Monitor/MonitorStatusTimeline";
import MonitorSummaryCapture from "../../../../Server/Utils/Monitor/MonitorSummaryCapture";
import MonitorMaintenanceSuppression from "../../../../Server/Utils/Monitor/MonitorMaintenanceSuppression";
import MonitorDependencySuppression from "../../../../Server/Utils/Monitor/MonitorDependencySuppression";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import MonitorProbeService from "../../../../Server/Services/MonitorProbeService";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import ProjectService from "../../../../Server/Services/ProjectService";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import logger from "../../../../Server/Utils/Logger";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import Wildcard from "../../../../Types/BaseDatabase/Wildcard";
import Dictionary from "../../../../Types/Dictionary";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../../Types/Metrics/MetricsAggregationType";
import {
  CheckOn,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import RollingTime from "../../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../../Types/RollingTime/RollingTimeUtil";
import { TelemetryQuery } from "../../../../Types/Telemetry/TelemetryQuery";
import TelemetryType from "../../../../Types/Telemetry/TelemetryType";
import MonitorStepMetricQueries from "../../../../Utils/Monitor/MonitorStepMetricQueries";
import MetricTelemetrySnapshot from "../../../../Utils/Monitor/MetricTelemetrySnapshot";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Issue #6265 on the path every telemetry check takes: the worker's response
 * for a metric monitor goes into MonitorResourceUtil.monitorResource,
 * through the real criteria evaluator, and the incident and alert it opens
 * are handed the snapshot their metric card charts. An infrastructure
 * monitor's snapshot keeps beside each query the filters the check read it
 * with - the host, cluster or fleet it watches - and a Metrics monitor's is
 * as it always was. Postgres, Redis and the incident and alert machinery
 * are stood in for.
 */

const NOW: Date = new Date(Date.UTC(2026, 10, 7, 12, 15, 30));

const ONLINE: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OFFLINE: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

const queryOf: (data: {
  metricName: string;
  attributes?: Dictionary<unknown>;
}) => MetricQueryConfigData = (data: {
  metricName: string;
  attributes?: Dictionary<unknown>;
}): MetricQueryConfigData => {
  return {
    metricAliasData: {
      metricVariable: "a",
      title: "Usage",
      description: "",
      legend: "",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: data.metricName,
        aggegationType: MetricsAggregationType.Avg,
        ...(data.attributes ? { attributes: data.attributes } : {}),
      } as never,
    },
  };
};

// "Above 90", opening an incident and an alert.
const firing: MonitorCriteriaInstance = (() => {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: "above-90",
    name: "Above 90",
    description: "",
    monitorStatusId: OFFLINE,
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: CheckOn.MetricValue,
        filterType: FilterType.GreaterThan,
        value: 90,
        metricMonitorOptions: {
          metricAlias: "a",
          metricAggregationType: EvaluateOverTimeType.AnyValue,
        },
      },
    ],
    incidents: [
      {
        id: "incident-1",
        title: "Above 90",
        description: "Above 90",
        incidentSeverityId: ObjectID.generate(),
      },
    ],
    alerts: [
      {
        id: "alert-1",
        title: "Above 90",
        description: "Above 90",
        alertSeverityId: ObjectID.generate(),
      },
    ],
    createAlerts: true,
    createIncidents: true,
    changeMonitorStatus: true,
    isEnabled: true,
  } as unknown as MonitorCriteriaInstance["data"];
  return instance;
})();

interface MonitorCase {
  name: string;
  monitorType: MonitorType;
  settings: Dictionary<unknown>;
  query: MetricQueryConfigData;
  // What the worker said it read the query with.
  read: Dictionary<unknown> | undefined;
  // What the monitor added to the query's own filters.
  scope: Dictionary<unknown>;
}

const CASES: Array<MonitorCase> = [
  {
    name: "Host",
    monitorType: MonitorType.Host,
    settings: { hostIdentifier: "web-01" },
    query: queryOf({ metricName: "system.cpu.utilization" }),
    read: { "resource.host.name": "web-01" },
    scope: { "resource.host.name": "web-01" },
  },
  {
    name: "Kubernetes",
    monitorType: MonitorType.Kubernetes,
    settings: {
      clusterIdentifier: "prod",
      resourceFilters: { namespace: "payments" },
    },
    query: queryOf({
      metricName: "k8s.pod.cpu.utilization",
      attributes: { "resource.k8s.pod.name": "api-0" },
    }),
    read: {
      "resource.k8s.pod.name": "api-0",
      "resource.k8s.cluster.name": "prod",
      "resource.k8s.namespace.name": "payments",
    },
    scope: {
      "resource.k8s.cluster.name": "prod",
      "resource.k8s.namespace.name": "payments",
    },
  },
  {
    name: "Proxmox",
    monitorType: MonitorType.Proxmox,
    settings: {
      clusterIdentifier: "pve-prod",
      resourceFilters: { nodeName: "pve1" },
    },
    query: queryOf({ metricName: "pve_cpu_usage_ratio" }),
    read: {
      "resource.proxmox.cluster.name": "pve-prod",
      "pve.scope": "node",
      "pve.id": "pve1",
    },
    scope: {
      "resource.proxmox.cluster.name": "pve-prod",
      "pve.scope": "node",
      "pve.id": "pve1",
    },
  },
  {
    name: "IoT Device",
    monitorType: MonitorType.IoTDevice,
    settings: { fleetIdentifier: "Sensors" },
    query: queryOf({ metricName: "iot.temperature" }),
    read: {
      "resource.iot.fleet.name": new Wildcard<string>(["Sensors"]),
    },
    scope: {
      "resource.iot.fleet.name": new Wildcard<string>(["Sensors"]),
    },
  },
];

let monitor: Monitor;
let openIncidents: jest.SpyInstance;
let openAlerts: jest.SpyInstance;

function setUpMonitor(monitorCase: MonitorCase): void {
  const step: MonitorStep = new MonitorStep();
  const criteria: MonitorCriteria = new MonitorCriteria();
  criteria.data = { monitorCriteriaInstanceArray: [firing] };
  step.data = {
    id: "step-1",
    monitorCriteria: criteria,
    [MonitorStepMetricQueries.getStepKey(monitorCase.monitorType)!]: {
      ...monitorCase.settings,
      rollingTime: RollingTime.Past5Minutes,
      metricViewConfig: {
        queryConfigs: [monitorCase.query],
        formulaConfigs: [],
      },
    },
  } as unknown as MonitorStep["data"];

  monitor = new Monitor();
  monitor.id = new ObjectID("33333333-3333-4333-8333-333333333333");
  monitor.projectId = new ObjectID("44444444-4444-4444-8444-444444444444");
  monitor.name = `${monitorCase.name} monitor`;
  monitor.monitorType = monitorCase.monitorType;
  monitor.currentMonitorStatusId = ONLINE;
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ONLINE,
  };
  monitor.monitorSteps = monitorSteps;
}

// The worker's response: a value of 95, read as the worker says it was.
function responseOf(
  monitorCase: MonitorCase,
  queryAttributes: Array<Dictionary<unknown> | undefined> | undefined,
): MetricMonitorResponse {
  const result: AggregatedResult = {
    data: [{ timestamp: new Date(NOW.getTime() - 60_000), value: 95 }],
  };

  return {
    projectId: monitor.projectId!,
    monitorId: monitor.id!,
    metricViewConfig: {
      queryConfigs: [monitorCase.query],
      formulaConfigs: [],
    },
    metricResult: [result],
    startAndEndDate: RollingTimeUtil.convertToStartAndEndDate(
      RollingTime.Past5Minutes,
      NOW,
    ),
    ...(queryAttributes ? { queryAttributes: queryAttributes } : {}),
  };
}

// The snapshot the incident creator and the alert creator were handed.
function handedSnapshots(): {
  incident: TelemetryQuery | undefined;
  alert: TelemetryQuery | undefined;
} {
  expect(openIncidents).toHaveBeenCalled();
  expect(openAlerts).toHaveBeenCalled();

  const propsOf: (spy: jest.SpyInstance) => TelemetryQuery | undefined = (
    spy: jest.SpyInstance,
  ): TelemetryQuery | undefined => {
    return (
      spy.mock.calls[0]![0] as {
        props: { telemetryQuery?: TelemetryQuery };
      }
    ).props.telemetryQuery;
  };

  return { incident: propsOf(openIncidents), alert: propsOf(openAlerts) };
}

// What the event's card charts the snapshot's first query with.
function chartedAttributesOf(snapshot: TelemetryQuery | undefined): unknown {
  return MetricTelemetrySnapshot.applyScopes({
    queryConfigs: snapshot!.metricViewData!.queryConfigs,
    scopes: MetricTelemetrySnapshot.getStoredScopes(snapshot) || [],
  })[0]?.metricQueryData.filterData.attributes;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);

  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
  jest.spyOn(MonitorService, "findOneById").mockImplementation(() => {
    return Promise.resolve(monitor) as never;
  });
  jest
    .spyOn(MonitorService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  jest.spyOn(MonitorProbeService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(MonitorStatusService, "findOneBy")
    .mockResolvedValue(null as never);
  jest
    .spyOn(MonitorStatusTimelineService, "findOneBy")
    .mockImplementation(() => {
      const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
      timeline.monitorStatusId = monitor.currentMonitorStatusId!;
      return Promise.resolve(timeline) as never;
    });
  jest
    .spyOn(MonitorMetricUtil, "saveMonitorMetrics")
    .mockResolvedValue(undefined);
  jest.spyOn(MonitorLogUtil, "saveMonitorLog").mockReturnValue(undefined);
  jest
    .spyOn(MonitorStatusTimelineUtil, "updateMonitorStatusTimeline")
    .mockResolvedValue(null as never);
  jest
    .spyOn(MonitorMaintenanceSuppression, "getMaintenanceSuppression")
    .mockResolvedValue({
      suppressedSeriesFingerprints: new Set<string>(),
      suppressingDatabaseServerIds: [],
    } as never);
  jest
    .spyOn(MonitorDependencySuppression, "getDependencySuppression")
    .mockResolvedValue({ isSuppressed: false } as never);
  jest.spyOn(MonitorSummaryCapture, "capture").mockResolvedValue(null as never);
  jest
    .spyOn(MonitorIncident, "checkOpenIncidentsAndCloseIfResolved")
    .mockResolvedValue([] as never);
  jest
    .spyOn(MonitorAlert, "checkOpenAlertsAndCloseIfResolved")
    .mockResolvedValue([] as never);
  openIncidents = jest
    .spyOn(MonitorIncident, "criteriaMetCreateIncidentsAndUpdateMonitorStatus")
    .mockResolvedValue(undefined as never);
  openAlerts = jest
    .spyOn(MonitorAlert, "criteriaMetCreateAlertsAndUpdateMonitorStatus")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
    .mockResolvedValue([ObjectID.generate()]);
  jest
    .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
    .mockResolvedValue([ObjectID.generate()]);
  jest.spyOn(AlertService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(IncidentService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe.each(CASES)(
  "a $name monitor's incident and alert",
  (monitorCase: MonitorCase) => {
    test("chart only the resource it watches: each query as the check read it", async () => {
      setUpMonitor(monitorCase);

      await MonitorResourceUtil.monitorResource(
        responseOf(monitorCase, [monitorCase.read]),
      );

      const { incident, alert } = handedSnapshots();

      for (const snapshot of [incident, alert]) {
        expect(snapshot?.telemetryType).toBe(TelemetryType.Metric);
        expect(snapshot?.metricQueryScopes).toEqual([monitorCase.scope]);
        expect(chartedAttributesOf(snapshot)).toEqual(monitorCase.read);
        // The step's query as it keeps it, and the window it read.
        expect(snapshot?.metricViewData?.queryConfigs).toEqual([
          monitorCase.query,
        ]);
        expect(snapshot?.metricViewData?.startAndEndDate).toEqual(
          RollingTimeUtil.convertToStartAndEndDate(
            RollingTime.Past5Minutes,
            NOW,
          ),
        );
      }

      // What the dashboard twin says this monitor reads (held to the worker).
      expect(chartedAttributesOf(incident)).toEqual(
        MonitorStepMetricQueries.getReads({
          monitorType: monitorCase.monitorType,
          monitorStep:
            monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!,
        })!.queryConfigs[0]!.metricQueryData.filterData.attributes,
      );

      // The monitor's own step is left as it was: no scope saved into it.
      expect(
        monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data![
          MonitorStepMetricQueries.getStepKey(monitorCase.monitorType)!
        ],
      ).toMatchObject({
        metricViewConfig: { queryConfigs: [monitorCase.query] },
      });
    });

    test("a response that does not say what it read with keeps no scope, as before", async () => {
      setUpMonitor(monitorCase);

      await MonitorResourceUtil.monitorResource(
        responseOf(monitorCase, undefined),
      );

      const { incident } = handedSnapshots();
      expect(incident?.metricQueryScopes).toBeUndefined();
      expect(incident?.metricViewData?.queryConfigs).toEqual([
        monitorCase.query,
      ]);
    });
  },
);

describe("a Metrics monitor's incident", () => {
  test("keeps its queries exactly as they were, with their own filters", async () => {
    const metricsCase: MonitorCase = {
      name: "Metrics",
      monitorType: MonitorType.Metrics,
      settings: {},
      query: queryOf({
        metricName: "http.server.duration",
        attributes: { "resource.service.name": "checkout" },
      }),
      read: undefined,
      scope: {},
    };
    setUpMonitor(metricsCase);

    await MonitorResourceUtil.monitorResource(
      responseOf(metricsCase, [
        metricsCase.query.metricQueryData.filterData.attributes as never,
      ]),
    );

    const { incident } = handedSnapshots();
    expect(incident?.metricViewData?.queryConfigs[0]).toBe(metricsCase.query);
    // Nothing added to the query's own filters.
    expect(incident?.metricQueryScopes).toEqual([null]);
    expect(chartedAttributesOf(incident)).toEqual({
      "resource.service.name": "checkout",
    });
  });
});

// Issue #6266: a Metrics monitor limited to some services.
describe("a service-limited Metrics monitor's incident and alert", () => {
  const SERVICES: Array<string> = [
    "77777777-7777-4777-8777-777777777777",
    "88888888-8888-4888-8888-888888888888",
  ];

  test("keep the services every query was read for", async () => {
    const metricsCase: MonitorCase = {
      name: "Metrics",
      monitorType: MonitorType.Metrics,
      settings: { telemetryServiceIds: SERVICES },
      query: queryOf({ metricName: "http.server.duration" }),
      read: undefined,
      scope: {},
    };
    setUpMonitor(metricsCase);

    await MonitorResourceUtil.monitorResource({
      ...responseOf(metricsCase, [undefined]),
      queryServiceIds: SERVICES,
    });

    const { incident, alert } = handedSnapshots();
    for (const snapshot of [incident, alert]) {
      expect(snapshot?.metricServiceIds).toEqual(SERVICES);
      // The queries as the step keeps them.
      expect(snapshot?.metricViewData?.queryConfigs).toEqual([
        metricsCase.query,
      ]);
    }
  });

  test("a check that read every service keeps none", async () => {
    const metricsCase: MonitorCase = {
      name: "Metrics",
      monitorType: MonitorType.Metrics,
      settings: {},
      query: queryOf({ metricName: "http.server.duration" }),
      read: undefined,
      scope: {},
    };
    setUpMonitor(metricsCase);

    await MonitorResourceUtil.monitorResource(
      responseOf(metricsCase, [undefined]),
    );

    const { incident } = handedSnapshots();
    expect(incident?.metricServiceIds).toBeUndefined();
  });
});
