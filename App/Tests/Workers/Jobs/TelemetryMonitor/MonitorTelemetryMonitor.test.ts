import MonitorStep from "Common/Types/Monitor/MonitorStep";
import { MonitorStepLogMonitorUtil } from "Common/Types/Monitor/MonitorStepLogMonitor";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import Search from "Common/Types/BaseDatabase/Search";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import LogMonitorResponse from "Common/Types/Monitor/LogMonitor/LogMonitorResponse";
import TraceMonitorResponse from "Common/Types/Monitor/TraceMonitor/TraceMonitorResponse";
import ExceptionMonitorResponse from "Common/Types/Monitor/ExceptionMonitor/ExceptionMonitorResponse";
import { describe, expect, test, beforeEach } from "@jest/globals";
import {
  RumAlertTemplate,
  getRumAlertTemplateById,
} from "Common/Types/Monitor/RumAlertTemplates";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";

/*
 * Covers the worker-side half of the "log monitors do not work" fix. A
 * telemetry monitor step saved with no sub-config used to make these workers
 * throw "<type> query/config is missing" on every cycle, so the monitor never
 * evaluated. monitorLogs/monitorTrace/monitorException now fall back to the
 * default config instead; monitorMetric deliberately keeps its guard.
 */

// Keep the heavy worker module from touching Redis at import time.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

/*
 * The worker transitively imports MonitorResource -> MonitorCriteriaEvaluator
 * -> VMAPI -> VMRunner, which loads the native `isolated-vm` addon. None of
 * the functions under test evaluate JavaScript expressions, so stub the VM
 * runner out to keep the module importable in a plain jest environment.
 */
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/LogService", () => {
  return { __esModule: true, default: { countBy: jest.fn() } };
});
jest.mock("Common/Server/Services/SpanService", () => {
  return { __esModule: true, default: { countBy: jest.fn() } };
});
jest.mock("Common/Server/Services/ExceptionInstanceService", () => {
  return { __esModule: true, default: { countBy: jest.fn() } };
});
jest.mock("Common/Server/Services/TelemetryExceptionService", () => {
  return {
    __esModule: true,
    default: { getResolvedOrArchivedFingerprints: jest.fn() },
  };
});
jest.mock("Common/Server/Services/MetricService", () => {
  return { __esModule: true, default: { aggregateBy: jest.fn() } };
});
jest.mock("Common/Server/Services/MetricTypeService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import {
  monitorLogs,
  monitorTrace,
  monitorException,
  monitorMetric,
} from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const logCountBy: jest.Mock = LogService.countBy as unknown as jest.Mock;
const spanCountBy: jest.Mock = SpanService.countBy as unknown as jest.Mock;
const exceptionCountBy: jest.Mock =
  ExceptionInstanceService.countBy as unknown as jest.Mock;
const resolvedFingerprints: jest.Mock =
  TelemetryExceptionService.getResolvedOrArchivedFingerprints as unknown as jest.Mock;
const metricAggregateBy: jest.Mock =
  MetricService.aggregateBy as unknown as jest.Mock;
const metricTypeFindBy: jest.Mock =
  MetricTypeService.findBy as unknown as jest.Mock;

const monitorId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();

beforeEach(() => {
  logCountBy.mockReset().mockResolvedValue(new PositiveNumber(0));
  spanCountBy.mockReset().mockResolvedValue(new PositiveNumber(0));
  exceptionCountBy.mockReset().mockResolvedValue(new PositiveNumber(0));
  resolvedFingerprints.mockReset().mockResolvedValue([]);
  metricAggregateBy.mockReset().mockResolvedValue({ data: [] });
  metricTypeFindBy.mockReset().mockResolvedValue([]);
});

describe("monitorLogs", () => {
  test("falls back to the default query when logMonitor config is missing", async () => {
    logCountBy.mockResolvedValue(new PositiveNumber(4));

    // new MonitorStep() has every telemetry sub-config undefined.
    const response: LogMonitorResponse = await monitorLogs({
      monitorStep: new MonitorStep(),
      monitorId,
      projectId,
    });

    expect(response.logCount).toBe(4);
    expect(logCountBy).toHaveBeenCalledTimes(1);

    /*
     * The default query is the minimal "recent logs" query: a time window,
     * scoped to the project, with no over-scoping filters.
     */
    const passedQuery: Record<string, unknown> = logCountBy.mock.calls[0]![0]
      .query as Record<string, unknown>;
    expect(passedQuery["time"]).toBeInstanceOf(InBetween);
    expect(passedQuery["projectId"]).toBeDefined();
    expect(passedQuery["primaryEntityId"]).toBeUndefined();
    expect(passedQuery["body"]).toBeUndefined();
  });

  test("uses the saved config when present", async () => {
    logCountBy.mockResolvedValue(new PositiveNumber(1));

    const step: MonitorStep = new MonitorStep();
    step.setLogMonitor({
      ...MonitorStepLogMonitorUtil.getDefault(),
      body: "connection refused",
    });

    await monitorLogs({ monitorStep: step, monitorId, projectId });

    const passedQuery: Record<string, unknown> = logCountBy.mock.calls[0]![0]
      .query as Record<string, unknown>;
    expect(passedQuery["body"]).toBeInstanceOf(Search);
    expect((passedQuery["body"] as Search<string>).value).toBe(
      "connection refused",
    );
  });
});

describe("monitorTrace", () => {
  test("falls back to the default query when traceMonitor config is missing", async () => {
    spanCountBy.mockResolvedValue(new PositiveNumber(2));

    const response: TraceMonitorResponse = await monitorTrace({
      monitorStep: new MonitorStep(),
      monitorId,
      projectId,
    });

    expect(response.spanCount).toBe(2);
    const passedQuery: Record<string, unknown> = spanCountBy.mock.calls[0]![0]
      .query as Record<string, unknown>;
    expect(passedQuery["startTime"]).toBeInstanceOf(InBetween);
  });
});

describe("monitorException", () => {
  test("falls back to the default query when exceptionMonitor config is missing", async () => {
    exceptionCountBy.mockResolvedValue(new PositiveNumber(3));

    const response: ExceptionMonitorResponse = await monitorException({
      monitorStep: new MonitorStep(),
      monitorId,
      projectId,
    });

    expect(response.exceptionCount).toBe(3);
    expect(exceptionCountBy).toHaveBeenCalledTimes(1);
  });
});

describe("monitorMetric", () => {
  test("still throws when metricMonitor config is missing (guard preserved)", async () => {
    await expect(
      monitorMetric({
        monitorStep: new MonitorStep(),
        monitorId,
        projectId,
      }),
    ).rejects.toThrow("Metric config is missing");
  });

  test("scopes a recommendation-created RUM metric query to its application id", async () => {
    const rumApplicationId: ObjectID = ObjectID.generate();
    const template: RumAlertTemplate | undefined =
      getRumAlertTemplateById("rum-poor-lcp");

    expect(template).toBeDefined();

    const step: MonitorStep = template!.getMonitorStep({
      rumApplicationId: rumApplicationId.toString(),
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      monitorName: "Storefront",
    });

    await monitorMetric({ monitorStep: step, monitorId, projectId });

    expect(metricAggregateBy).toHaveBeenCalledTimes(1);

    const query: Record<string, unknown> = metricAggregateBy.mock.calls[0]![0]
      .query as Record<string, unknown>;
    const primaryEntityId: Includes = query["primaryEntityId"] as Includes;

    expect(primaryEntityId).toBeInstanceOf(Includes);
    expect(
      (primaryEntityId.values as Array<string | ObjectID | number>).map(
        (id: string | ObjectID | number) => {
          return id.toString();
        },
      ),
    ).toEqual([rumApplicationId.toString()]);
    expect(query["projectId"]).toBe(projectId);
    expect(query["name"]).toBe("web_vital.lcp");
  });

  test("keeps legacy generic metric monitors project-wide when no scope is configured", async () => {
    const step: MonitorStep = new MonitorStep();
    step.setMetricMonitor({
      rollingTime: RollingTime.Past5Minutes,
      metricViewConfig: {
        queryConfigs: [
          {
            metricAliasData: {
              metricVariable: "latency",
              title: "Latency",
              description: "Latency",
              legend: "Latency",
              legendUnit: "ms",
            },
            metricQueryData: {
              filterData: {
                metricName: "custom.latency",
                attributes: {},
                aggegationType: MetricsAggregationType.Avg,
                aggregateBy: {},
              },
            },
          },
        ],
        formulaConfigs: [],
      },
    });

    await monitorMetric({ monitorStep: step, monitorId, projectId });

    const query: Record<string, unknown> = metricAggregateBy.mock.calls[0]![0]
      .query as Record<string, unknown>;

    expect(query["primaryEntityId"]).toBeUndefined();
  });
});
