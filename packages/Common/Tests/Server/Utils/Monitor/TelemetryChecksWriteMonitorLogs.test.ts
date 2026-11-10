/*
 * MONITORING LOGS ON EVERY MONITOR BUT A MANUAL ONE (issue #6639).
 *
 * "We have monitor logs for website, api, etc monitors but we dont have
 * monitor logs for metric monitors." The rows were there: the telemetry
 * worker hands every check of a Metrics, Logs, Kubernetes or other
 * telemetry monitor to MonitorResourceUtil.monitorResource, which ends each
 * evaluation with MonitorLogUtil.saveMonitorLog. Only the Dashboard left
 * the page out. This suite pins the server half, so the page cannot again
 * be offered for checks nobody writes: a telemetry check, whether its
 * criteria matched, did not, or it read no data at all, puts exactly one
 * row in ClickHouse - through the real evaluator and the real MonitorLog
 * writer - and that row reads back on the page as what the check saw.
 *
 * Postgres, Redis and the incident and alert machinery are stood in for;
 * the row is caught where MonitorLogUtil hands it to ClickHouse, flushed
 * through the shutdown handler it registers (as MonitorLogUtilRedaction
 * does).
 */

jest.mock("isolated-vm", () => {
  return {};
});

const mockShutdown: { callback: (() => Promise<void> | void) | null } = {
  callback: null,
};

jest.mock("../../../../Server/Utils/GracefulShutdown", () => {
  return {
    __esModule: true,
    default: {
      registerHandler: (
        _name: string,
        _priority: number,
        callback: () => Promise<void> | void,
      ): void => {
        if (_name === "MonitorLogUtil") {
          mockShutdown.callback = callback;
        }
      },
    },
    ShutdownPriority: {
      HttpServer: 10,
      Workers: 20,
      Buffers: 30,
      DataStores: 40,
      Telemetry: 50,
    },
  };
});

jest.mock("../../../../Server/Services/MonitorLogService", () => {
  return {
    __esModule: true,
    default: {
      insertJsonRows: jest.fn(() => {
        return Promise.resolve();
      }),
    },
  };
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
import MonitorLogService from "../../../../Server/Services/MonitorLogService";
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
import OneUptimeDate from "../../../../Types/Date";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../Types/JSON";
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
import MonitorEvaluationSummary from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import { TelemetryObservationKind } from "../../../../Types/Monitor/TelemetryObservation";
import ObjectID from "../../../../Types/ObjectID";
import RollingTime from "../../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../../Types/RollingTime/RollingTimeUtil";
import JSONFunctions from "../../../../Types/JSONFunctions";
import MonitorStepMetricQueries from "../../../../Utils/Monitor/MonitorStepMetricQueries";
import MonitorLogSummaryUtil from "../../../../Utils/Monitor/MonitorLogSummaryUtil";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

const ONLINE: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OFFLINE: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const MONITOR_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const insertJsonRows: jest.Mock =
  MonitorLogService.insertJsonRows as unknown as jest.Mock;

const QUERY: MetricQueryConfigData = {
  metricAliasData: {
    metricVariable: "a",
    title: "CPU",
    description: "",
    legend: "",
    legendUnit: "",
  },
  metricQueryData: {
    filterData: {
      metricName: "system.cpu.utilization",
      aggegationType: MetricsAggregationType.Avg,
    } as never,
  },
};

// "Above 90": a metric criteria that marks the monitor offline.
const ABOVE_90: MonitorCriteriaInstance = (() => {
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
    incidents: [],
    alerts: [],
    createAlerts: false,
    createIncidents: false,
    changeMonitorStatus: true,
    isEnabled: true,
  } as unknown as MonitorCriteriaInstance["data"];
  return instance;
})();

// "Errors": a logs criteria on the count of matching logs.
const ERRORS: MonitorCriteriaInstance = (() => {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: "errors",
    name: "Errors",
    description: "",
    monitorStatusId: OFFLINE,
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: CheckOn.LogCount,
        filterType: FilterType.GreaterThan,
        value: 10,
      },
    ],
    incidents: [],
    alerts: [],
    createAlerts: false,
    createIncidents: false,
    changeMonitorStatus: true,
    isEnabled: true,
  } as unknown as MonitorCriteriaInstance["data"];
  return instance;
})();

let monitor: Monitor;

function setUpMonitor(data: {
  monitorType: MonitorType;
  stepData: JSONObject;
  criteria: MonitorCriteriaInstance;
}): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  const criteria: MonitorCriteria = new MonitorCriteria();
  criteria.data = { monitorCriteriaInstanceArray: [data.criteria] };
  step.data = {
    id: "step-1",
    monitorCriteria: criteria,
    ...data.stepData,
  } as unknown as MonitorStep["data"];

  monitor = new Monitor();
  monitor.id = MONITOR_ID;
  monitor.projectId = PROJECT_ID;
  monitor.name = `${data.monitorType} monitor`;
  monitor.monitorType = data.monitorType;
  monitor.currentMonitorStatusId = ONLINE;
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ONLINE,
  };
  monitor.monitorSteps = monitorSteps;

  return step;
}

function setUpMetricMonitor(monitorType: MonitorType): MonitorStep {
  return setUpMonitor({
    monitorType: monitorType,
    criteria: ABOVE_90,
    stepData: {
      [MonitorStepMetricQueries.getStepKey(monitorType)!]: {
        ...(monitorType === MonitorType.Host
          ? { hostIdentifier: "web-01" }
          : {}),
        rollingTime: RollingTime.Past5Minutes,
        metricViewConfig: { queryConfigs: [QUERY], formulaConfigs: [] },
      },
    } as unknown as JSONObject,
  });
}

// The worker's response for a metric check that read `values`.
function metricCheck(values: Array<number>): MetricMonitorResponse {
  const now: Date = OneUptimeDate.getCurrentDate();
  const result: AggregatedResult = {
    data: values.map((value: number, index: number) => {
      return {
        timestamp: OneUptimeDate.addRemoveSeconds(now, -60 * (index + 1)),
        value: value,
      };
    }),
  };

  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    metricViewConfig: { queryConfigs: [QUERY], formulaConfigs: [] },
    metricResult: [result],
    startAndEndDate: RollingTimeUtil.convertToStartAndEndDate(
      RollingTime.Past5Minutes,
      now,
    ),
  };
}

// The rows MonitorLogUtil handed to ClickHouse for the check just run.
async function loggedRows(): Promise<Array<JSONObject>> {
  // saveMonitorLog reads the retention first: give that a turn.
  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });

  if (!mockShutdown.callback) {
    throw new Error("MonitorLogUtil wrote no row: it never buffered one.");
  }

  await mockShutdown.callback();

  return (
    insertJsonRows.mock.calls as unknown as Array<Array<unknown>>
  ).flatMap((call: Array<unknown>): Array<JSONObject> => {
    return call[0] as Array<JSONObject>;
  });
}

// A row as the Dashboard's HTTP client hands it to the page.
function readBack(row: JSONObject): JSONObject {
  return JSONFunctions.deserialize(
    JSON.parse(JSON.stringify(row["logBody"])) as JSONObject,
  ) as JSONObject;
}

function evaluationOf(logBody: JSONObject): MonitorEvaluationSummary {
  return logBody["evaluationSummary"] as unknown as MonitorEvaluationSummary;
}

beforeEach(() => {
  insertJsonRows.mockClear();

  jest.spyOn(MonitorLogUtil, "getRetentionDays").mockResolvedValue(1);
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
  jest
    .spyOn(MonitorIncident, "criteriaMetCreateIncidentsAndUpdateMonitorStatus")
    .mockResolvedValue(undefined as never);
  jest
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
  jest.restoreAllMocks();
});

describe.each([MonitorType.Metrics, MonitorType.Host])(
  "a %s monitor's check",
  (monitorType: MonitorType) => {
    test("that matched a criteria writes one row: the check, and why it matched", async () => {
      setUpMetricMonitor(monitorType);

      await MonitorResourceUtil.monitorResource(metricCheck([95, 40]));

      const rows: Array<JSONObject> = await loggedRows();

      expect(rows).toHaveLength(1);
      expect(rows[0]!["monitorId"]).toBe(MONITOR_ID.toString());
      expect(rows[0]!["projectId"]).toBe(PROJECT_ID.toString());
      expect(rows[0]!["time"]).toEqual(expect.any(String));

      const logBody: JSONObject = readBack(rows[0]!);
      const evaluation: MonitorEvaluationSummary = evaluationOf(logBody);

      expect(evaluation.criteriaResults[0]?.criteriaName).toBe("Above 90");
      expect(evaluation.criteriaResults[0]?.met).toBe(true);

      // The page reads what the check saw from the row.
      expect(
        MonitorLogSummaryUtil.getTelemetryObservation({
          monitorType: monitorType,
          logBody: logBody,
        }),
      ).toEqual({
        kind: TelemetryObservationKind.MetricDataPoints,
        count: 2,
      });
    });

    test("that matched nothing still writes its row", async () => {
      setUpMetricMonitor(monitorType);

      await MonitorResourceUtil.monitorResource(metricCheck([40, 41, 42]));

      const rows: Array<JSONObject> = await loggedRows();

      expect(rows).toHaveLength(1);

      const logBody: JSONObject = readBack(rows[0]!);

      expect(evaluationOf(logBody).criteriaResults[0]?.met).toBe(false);
      expect(
        MonitorLogSummaryUtil.getTelemetryObservation({
          monitorType: monitorType,
          logBody: logBody,
        }),
      ).toEqual({
        kind: TelemetryObservationKind.MetricDataPoints,
        count: 3,
      });
    });

    test("that read no data writes a row that says so", async () => {
      setUpMetricMonitor(monitorType);

      await MonitorResourceUtil.monitorResource(metricCheck([]));

      const rows: Array<JSONObject> = await loggedRows();

      expect(rows).toHaveLength(1);
      expect(
        MonitorLogSummaryUtil.getTelemetryObservation({
          monitorType: monitorType,
          logBody: readBack(rows[0]!),
        }),
      ).toEqual({ kind: TelemetryObservationKind.NoMetricData, count: 0 });
    });

    test("is shown in View Summary as a check that has run", async () => {
      setUpMetricMonitor(monitorType);

      await MonitorResourceUtil.monitorResource(metricCheck([95]));

      const rows: Array<JSONObject> = await loggedRows();
      const time: Date = OneUptimeDate.fromString(rows[0]!["time"] as string);

      const summary: ReturnType<
        typeof MonitorLogSummaryUtil.toSummaryInfoProps
      > = MonitorLogSummaryUtil.toSummaryInfoProps({
        monitorType: monitorType,
        logBody: readBack(rows[0]!),
        monitoredAt: time,
      });

      expect(summary.telemetryMonitorSummary).toEqual({
        lastCheckedAt: time,
        isPastCheck: true,
        observation: {
          kind: TelemetryObservationKind.MetricDataPoints,
          count: 1,
        },
      });
      expect(summary.evaluationSummary?.criteriaResults[0]?.met).toBe(true);
    });
  },
);

describe("a Logs monitor's check", () => {
  test("writes one row, which reads back as the logs it counted", async () => {
    setUpMonitor({
      monitorType: MonitorType.Logs,
      criteria: ERRORS,
      stepData: {
        logMonitor: {
          attributes: {},
          body: "",
          severityTexts: [],
          telemetryServiceIds: [],
          lastXSecondsOfLogs: 60,
        },
      } as unknown as JSONObject,
    });

    await MonitorResourceUtil.monitorResource({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      logCount: 12,
      logQuery: {},
    } as never);

    const rows: Array<JSONObject> = await loggedRows();

    expect(rows).toHaveLength(1);

    const logBody: JSONObject = readBack(rows[0]!);

    expect(evaluationOf(logBody).criteriaResults[0]?.criteriaName).toBe(
      "Errors",
    );
    expect(
      MonitorLogSummaryUtil.getTelemetryObservation({
        monitorType: MonitorType.Logs,
        logBody: logBody,
      }),
    ).toEqual({ kind: TelemetryObservationKind.Logs, count: 12 });
  });
});
