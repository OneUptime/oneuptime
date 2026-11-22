import MonitorSeriesTable, {
  MAX_SERIES_TABLE_ROWS,
} from "../../../../Server/Utils/Monitor/MonitorSeriesTable";
import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import { JSONObject } from "../../../../Types/JSON";
import { getHostAlertTemplateById } from "../../../../Types/Monitor/HostAlertTemplates";
import LogMonitorResponse from "../../../../Types/Monitor/LogMonitor/LogMonitorResponse";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import {
  MonitorEvaluationSeries,
  MonitorEvaluationSeriesRow,
  MonitorEvaluationSeriesValueKind,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import SeriesLabelDisplay from "../../../../Types/Monitor/SeriesContext/SeriesLabelDisplay";
import TraceMonitorResponse from "../../../../Types/Monitor/TraceMonitor/TraceMonitorResponse";
import ObjectID from "../../../../Types/ObjectID";
import { MatchedCriteriaResult } from "../../../../Types/Probe/ProbeApiIngestResponse";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import { describe, expect, test } from "@jest/globals";

/*
 * THE SERIES A GROUPED CHECK KEEPS FOR ITS MONITOR'S OVERVIEW (#10062): each
 * series the check read, its newest value of what the criteria compare, the
 * criteria it met and whether it keeps the status - bounded, the ones that
 * matter first.
 */

const ONLINE: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OFFLINE: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

const T0: number = Date.UTC(2026, 10, 22, 9, 0, 0);

function filesystemStep(): MonitorStep {
  return getHostAlertTemplateById("host-high-filesystem")!.getMonitorStep({
    hostIdentifier: "web-01",
    onlineMonitorStatusId: ONLINE,
    offlineMonitorStatusId: OFFLINE,
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "web-01",
  });
}

function criteriaOf(step: MonitorStep): Array<MonitorCriteriaInstance> {
  return step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;
}

function idOf(step: MonitorStep, statusId: ObjectID): string {
  return criteriaOf(step)
    .find((criteria: MonitorCriteriaInstance): boolean => {
      return criteria.data!.monitorStatusId!.toString() === statusId.toString();
    })!
    .data!.id.toString();
}

function points(values: Array<number>): AggregatedResult {
  return {
    data: values.map((value: number, index: number): AggregateModel => {
      return {
        timestamp: new Date(T0 + index * 60_000),
        value: value,
      } as AggregateModel;
    }),
  };
}

// A disk's query (a 0..1 ratio) and its formula (in percent), minute by minute.
function disk(mountpoint: string, percents: Array<number>): MetricSeriesResult {
  const labels: JSONObject = {
    mountpoint: mountpoint,
    device: `/dev/${mountpoint.length}`,
  };

  return {
    fingerprint: MetricSeriesFingerprint.computeFingerprint(labels),
    labels: labels,
    aggregatedResults: [
      points(
        percents.map((percent: number): number => {
          return percent / 100;
        }),
      ),
      points(percents),
    ],
  };
}

function check(series: Array<MetricSeriesResult>): MetricMonitorResponse {
  return {
    monitorId: ObjectID.generate(),
    projectId: ObjectID.generate(),
    metricViewConfig: MonitorStep.getMetricsViewConfig(filesystemStep())!,
    metricResult: [],
    seriesBreakdown: series,
  };
}

function match(
  criteriaId: string,
  series: Array<MetricSeriesResult>,
): MatchedCriteriaResult {
  return {
    criteriaId: criteriaId,
    rootCause: "",
    perSeriesMatches: series.map((one: MetricSeriesResult) => {
      return {
        criteriaMetId: criteriaId,
        fingerprint: one.fingerprint,
        labels: one.labels,
        rootCause: "",
      };
    }),
  };
}

function build(input: {
  step: MonitorStep;
  series: Array<MetricSeriesResult>;
  matched: Array<MatchedCriteriaResult>;
  keepingStatus?: Array<string>;
  monitorType?: MonitorType;
}): MonitorEvaluationSeries | undefined {
  return MonitorSeriesTable.build({
    monitorType: input.monitorType || MonitorType.Host,
    monitorStep: input.step,
    dataToProcess: check(input.series),
    criteriaInstances: criteriaOf(input.step),
    defaultMonitorStatusId: ONLINE,
    matchedCriteria: input.matched,
    seriesKeepingStatus: new Set<string>(input.keepingStatus || []),
  });
}

describe("MonitorSeriesTable.build: a Host monitor's disks", () => {
  test("each disk with its newest percent, the criteria it met, and the full one first", () => {
    const step: MonitorStep = filesystemStep();
    const root: MetricSeriesResult = disk("/", [69, 70]);
    const data: MetricSeriesResult = disk("/data", [95, 96]);
    const boot: MetricSeriesResult = disk("/boot", [14, 14]);

    const table: MonitorEvaluationSeries = build({
      step: step,
      series: [root, data, boot],
      matched: [
        match(idOf(step, OFFLINE), [data]),
        match(idOf(step, ONLINE), [root, boot]),
      ],
    })!;

    expect(table.count).toBe(3);
    expect(
      table.rows.map((row: MonitorEvaluationSeriesRow) => {
        return row.labels["mountpoint"];
      }),
    ).toEqual(["/data", "/", "/boot"]);

    const full: MonitorEvaluationSeriesRow = table.rows[0]!;

    // The formula's value - what the criteria compare - in its unit.
    expect(full.value).toBe(96);
    expect(full.unit).toBe("%");
    expect(full.valueKind).toBe(MonitorEvaluationSeriesValueKind.Metric);
    expect(full.metCriteriaIds).toEqual([idOf(step, OFFLINE)]);
    expect(full.isKeepingStatus).toBeUndefined();

    expect(table.rows[1]!.metCriteriaIds).toEqual([idOf(step, ONLINE)]);
  });

  test("the disk that keeps the status is flagged, and listed first", () => {
    const step: MonitorStep = filesystemStep();
    const root: MetricSeriesResult = disk("/", [70]);
    const data: MetricSeriesResult = disk("/data", [89]);

    const table: MonitorEvaluationSeries = build({
      step: step,
      series: [root, data],
      // The recovery criteria met the root disk, and waits for /data.
      matched: [match(idOf(step, ONLINE), [root])],
      keepingStatus: [data.fingerprint],
    })!;

    expect(table.rows[0]!.fingerprint).toBe(data.fingerprint);
    expect(table.rows[0]!.isKeepingStatus).toBe(true);
    expect(table.rows[0]!.metCriteriaIds).toEqual([]);
    expect(table.rows[1]!.metCriteriaIds).toEqual([idOf(step, ONLINE)]);
  });

  test("a series met by several criteria lists them in criteria order", () => {
    const step: MonitorStep = filesystemStep();
    const data: MetricSeriesResult = disk("/data", [95]);

    const table: MonitorEvaluationSeries = build({
      step: step,
      series: [data],
      matched: [
        match(idOf(step, ONLINE), [data]),
        match(idOf(step, OFFLINE), [data]),
      ],
    })!;

    expect(table.rows[0]!.metCriteriaIds).toEqual([
      idOf(step, OFFLINE),
      idOf(step, ONLINE),
    ]);
  });

  test("a series seeded for a host that stopped reporting is left out, unless a criteria met it", () => {
    const step: MonitorStep = filesystemStep();
    const quiet: MetricSeriesResult = {
      ...disk("/gone", []),
      aggregatedResults: [points([]), points([])],
    };
    const silentButMatched: MetricSeriesResult = {
      ...disk("/stopped", []),
      aggregatedResults: [points([]), points([])],
    };
    const root: MetricSeriesResult = disk("/", [40]);

    const table: MonitorEvaluationSeries = build({
      step: step,
      series: [quiet, silentButMatched, root],
      matched: [match(idOf(step, OFFLINE), [silentButMatched])],
    })!;

    expect(table.count).toBe(2);
    expect(table.rows[0]!.fingerprint).toBe(silentButMatched.fingerprint);
    expect(table.rows[0]!.value).toBeUndefined();
    expect(table.rows[1]!.fingerprint).toBe(root.fingerprint);
  });

  test("a monitor of many series keeps the ones that matter first, and says how many it read", () => {
    const step: MonitorStep = filesystemStep();
    const series: Array<MetricSeriesResult> = [];

    for (let index: number = 0; index < MAX_SERIES_TABLE_ROWS * 3; index++) {
      series.push(disk(`/mnt/${index}`, [10]));
    }

    const full: MetricSeriesResult = series[series.length - 1]!;

    const table: MonitorEvaluationSeries = build({
      step: step,
      series: series,
      matched: [match(idOf(step, OFFLINE), [full])],
    })!;

    expect(table.count).toBe(MAX_SERIES_TABLE_ROWS * 3);
    expect(table.rows).toHaveLength(MAX_SERIES_TABLE_ROWS);
    expect(table.rows[0]!.fingerprint).toBe(full.fingerprint);
  });

  test("the value of the newest point, whatever order the points come in", () => {
    const step: MonitorStep = filesystemStep();
    const data: MetricSeriesResult = disk("/data", [96]);
    data.aggregatedResults[1] = {
      data: [
        { timestamp: new Date(T0 + 120_000), value: 91 } as AggregateModel,
        { timestamp: new Date(T0), value: 99 } as AggregateModel,
        { timestamp: new Date(T0 + 60_000), value: 95 } as AggregateModel,
      ],
    };

    const table: MonitorEvaluationSeries = build({
      step: step,
      series: [data],
      matched: [],
    })!;

    expect(table.rows[0]!.value).toBe(91);
  });
});

describe("MonitorSeriesTable.build: other grouped monitors, and the rest", () => {
  test("a Logs monitor's groups count their logs", () => {
    const step: MonitorStep = filesystemStep();
    const labels: JSONObject = { tunnel: "HQ-Branch1" };
    const fingerprint: string =
      MetricSeriesFingerprint.computeFingerprint(labels);

    const response: LogMonitorResponse = {
      monitorId: ObjectID.generate(),
      projectId: ObjectID.generate(),
      logCount: 12,
      logQuery: {},
      groupBreakdown: [
        { fingerprint: fingerprint, labels: labels, logCount: 12 },
      ],
    } as unknown as LogMonitorResponse;

    const table: MonitorEvaluationSeries = MonitorSeriesTable.build({
      monitorType: MonitorType.Logs,
      monitorStep: step,
      dataToProcess: response,
      criteriaInstances: criteriaOf(step),
      defaultMonitorStatusId: ONLINE,
      matchedCriteria: [],
      seriesKeepingStatus: new Set<string>(),
    })!;

    expect(table.rows[0]).toEqual({
      fingerprint: fingerprint,
      labels: labels,
      valueKind: MonitorEvaluationSeriesValueKind.Logs,
      value: 12,
      metCriteriaIds: [],
    });
  });

  test("a Traces monitor's groups count their spans, with what names their device", () => {
    const step: MonitorStep = filesystemStep();
    const labels: JSONObject = { "app.installation.id": "1b4e" };

    const response: TraceMonitorResponse = {
      monitorId: ObjectID.generate(),
      projectId: ObjectID.generate(),
      spanCount: 3,
      spanQuery: {},
      groupBreakdown: [
        {
          fingerprint: MetricSeriesFingerprint.computeFingerprint(labels),
          labels: labels,
          spanCount: 3,
          context: { "device.name": "Store 0412" },
        },
      ],
    } as unknown as TraceMonitorResponse;

    const table: MonitorEvaluationSeries = MonitorSeriesTable.build({
      monitorType: MonitorType.Traces,
      monitorStep: step,
      dataToProcess: response,
      criteriaInstances: criteriaOf(step),
      defaultMonitorStatusId: ONLINE,
      matchedCriteria: [],
      seriesKeepingStatus: new Set<string>(),
    })!;

    expect(table.rows[0]!.valueKind).toBe(
      MonitorEvaluationSeriesValueKind.Spans,
    );
    expect(table.rows[0]!.value).toBe(3);
    expect(table.rows[0]!.context).toEqual({ "device.name": "Store 0412" });
  });

  test("labels are kept as the text they read as, and name the series as the check's own do", () => {
    const step: MonitorStep = filesystemStep();
    const labels: JSONObject = {
      mountpoint: "/data",
      "disk.index": 2,
      "disk.tags": ["ssd", "nvme"],
      "disk.label": "",
      "disk.owner": null,
    };

    const table: MonitorEvaluationSeries = build({
      step: step,
      series: [
        {
          fingerprint: MetricSeriesFingerprint.computeFingerprint(labels),
          labels: labels,
          aggregatedResults: [points([0.5]), points([50])],
        },
      ],
      matched: [],
    })!;

    // A number and a list as text; an empty label and a null one left out.
    expect(table.rows[0]!.labels).toEqual({
      mountpoint: "/data",
      "disk.index": "2",
      "disk.tags": "ssd, nvme",
    });

    expect(SeriesLabelDisplay.getDisplayLabels(table.rows[0]!.labels)).toEqual(
      SeriesLabelDisplay.getDisplayLabels(labels),
    );
  });

  test("a check with no series of its own keeps no table", () => {
    const step: MonitorStep = filesystemStep();

    expect(
      MonitorSeriesTable.build({
        monitorType: MonitorType.Host,
        monitorStep: step,
        // An ungrouped check: no seriesBreakdown.
        dataToProcess: {
          monitorId: ObjectID.generate(),
          projectId: ObjectID.generate(),
          metricViewConfig: MonitorStep.getMetricsViewConfig(step)!,
          metricResult: [points([96]), points([96])],
        } as MetricMonitorResponse,
        criteriaInstances: criteriaOf(step),
        defaultMonitorStatusId: ONLINE,
        matchedCriteria: [],
        seriesKeepingStatus: new Set<string>(),
      }),
    ).toBeUndefined();

    expect(
      MonitorSeriesTable.build({
        monitorType: MonitorType.Server,
        monitorStep: step,
        dataToProcess: {
          monitorId: ObjectID.generate(),
          projectId: ObjectID.generate(),
        } as never,
        criteriaInstances: criteriaOf(step),
        defaultMonitorStatusId: ONLINE,
        matchedCriteria: [],
        seriesKeepingStatus: new Set<string>(),
      }),
    ).toBeUndefined();
  });

  test("a PromQL check, whose series name no query, shows each series' own result", () => {
    const step: MonitorStep = new MonitorStep();
    step.data = {
      id: ObjectID.generate().toString(),
      monitorCriteria: filesystemStep().data!.monitorCriteria,
      metricMonitor: { promql: "up" },
    } as unknown as MonitorStep["data"];

    const labels: JSONObject = { job: "api" };

    const table: MonitorEvaluationSeries = MonitorSeriesTable.build({
      monitorType: MonitorType.Metrics,
      monitorStep: step,
      dataToProcess: {
        monitorId: ObjectID.generate(),
        projectId: ObjectID.generate(),
        metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
        metricResult: [],
        seriesBreakdown: [
          {
            fingerprint: MetricSeriesFingerprint.computeFingerprint(labels),
            labels: labels,
            aggregatedResults: [points([1, 0])],
          },
        ],
      } as MetricMonitorResponse,
      criteriaInstances: criteriaOf(step),
      defaultMonitorStatusId: ONLINE,
      matchedCriteria: [],
      seriesKeepingStatus: new Set<string>(),
    })!;

    expect(table.rows[0]!.value).toBe(0);
    expect(table.rows[0]!.unit).toBeUndefined();
  });
});
