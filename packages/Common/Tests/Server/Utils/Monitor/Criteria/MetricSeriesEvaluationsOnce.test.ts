/*
 * MonitorCriteriaEvaluator reaches the template renderer, which loads the
 * native isolated-vm addon. Nothing here uses the sandbox and the prebuilt
 * binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import EventLoop from "../../../../../Server/Utils/EventLoop";
import MetricMonitorCriteria, {
  MetricSeriesEvaluationResult,
  MetricSeriesEvaluations,
} from "../../../../../Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import DataToProcess from "../../../../../Server/Utils/Monitor/DataToProcess";
import MonitorCriteriaEvaluator from "../../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import AggregateModel from "../../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../../Types/BaseDatabase/AggregatedResult";
import FilterCondition from "../../../../../Types/Filter/FilterCondition";
import MetricAliasData from "../../../../../Types/Metrics/MetricAliasData";
import MetricQueryConfigData from "../../../../../Types/Metrics/MetricQueryConfigData";
import MetricQueryData from "../../../../../Types/Metrics/MetricQueryData";
import MetricsViewConfig from "../../../../../Types/Metrics/MetricsViewConfig";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import MetricMonitorResponse from "../../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteria from "../../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "../../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../../Types/ObjectID";
import ProbeApiIngestResponse, {
  MatchedCriteriaResult,
  PerSeriesCriteriaMatch,
} from "../../../../../Types/Probe/ProbeApiIngestResponse";
import RollingTime from "../../../../../Types/RollingTime/RollingTime";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * EVERY SERIES JUDGED ONCE BY EACH FILTER, A SLICE AT A TIME (issue #10108).
 *
 * A grouped monitor's criteria that matches is read twice: for its verdict
 * (does any series breach?) and for the series it matched (the alerts to
 * open, one per series). Each read judged every series again - 16,250 of
 * them, for each of the #10108 monitor's three criteria - and all of a
 * filter's series at once, in one block of the event loop. Now one check
 * keeps what each filter judged (MetricSeriesEvaluations), and a filter
 * judges its series one after another, handing the loop back as it goes.
 * What is matched, and for which series, is as before.
 */

const HOST_KEY: string = "host.name";
const SERIES: number = 300;

interface CriteriaInternals {
  evaluateOneSeries: (input: unknown) => Promise<MetricSeriesEvaluationResult>;
}

const internals: CriteriaInternals =
  MetricMonitorCriteria as unknown as CriteriaInternals;

function hostOf(index: number): string {
  return `host-${String(index).padStart(4, "0")}`;
}

// A value per series both sides can tell: 0 to 99.
function valueOf(index: number): number {
  return (index * 37) % 100;
}

function buildStep(criteriaInstances: Array<MonitorCriteriaInstance>): {
  monitorStep: MonitorStep;
} {
  const metricAliasData: MetricAliasData = {
    metricVariable: "a",
    title: "Disk used",
    description: undefined,
    legend: undefined,
    legendUnit: "%",
  };
  const metricQueryData: MetricQueryData = {
    filterData: { metricName: "disk.used" },
    groupByAttributeKeys: [HOST_KEY],
  } as unknown as MetricQueryData;
  const queryConfigs: Array<MetricQueryConfigData> = [
    { metricAliasData, metricQueryData },
  ];
  const metricViewConfig: MetricsViewConfig = {
    queryConfigs,
    formulaConfigs: [],
  };

  const criteria: MonitorCriteria = new MonitorCriteria();
  criteria.data = { monitorCriteriaInstanceArray: criteriaInstances };

  const monitorStep: MonitorStep = new MonitorStep();
  monitorStep.data = {
    id: ObjectID.generate().toString(),
    monitorCriteria: criteria,
  } as unknown as MonitorStep["data"];
  monitorStep.data!.metricMonitor = {
    metricViewConfig,
    rollingTime: RollingTime.Past1Minute,
  };

  return { monitorStep };
}

function buildResponse(): MetricMonitorResponse {
  function sample(index: number): AggregateModel {
    return {
      timestamp: new Date("2026-11-17T10:00:00.000Z"),
      value: valueOf(index),
      attributes: { [HOST_KEY]: hostOf(index) },
    } as unknown as AggregateModel;
  }

  const indexes: Array<number> = Array.from(
    { length: SERIES },
    (_: unknown, index: number): number => {
      return index;
    },
  );

  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    metricResult: [{ data: indexes.map(sample) } as AggregatedResult],
    metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
    seriesBreakdown: indexes.map((index: number) => {
      return {
        fingerprint: `fp-${hostOf(index)}`,
        labels: { [HOST_KEY]: hostOf(index) },
        aggregatedResults: [{ data: [sample(index)] } as AggregatedResult],
      };
    }) as unknown as MetricMonitorResponse["seriesBreakdown"],
  } as unknown as MetricMonitorResponse;
}

function overFilter(greaterThan: number): CriteriaFilter {
  return {
    checkOn: CheckOn.MetricValue,
    filterType: FilterType.GreaterThan,
    value: String(greaterThan),
    metricMonitorOptions: {
      metricAlias: "a",
      metricAggregationType: EvaluateOverTimeType.AnyValue,
    },
  };
}

function criteriaInstance(input: {
  id: string;
  filters: Array<CriteriaFilter>;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: input.id,
    name: input.id,
    description: "",
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: input.filters,
    incidents: [],
    alerts: [],
    createAlerts: true,
    createIncidents: false,
    isEnabled: true,
  } as unknown as MonitorCriteriaInstance["data"];
  return instance;
}

async function evaluate(
  criteriaInstances: Array<MonitorCriteriaInstance>,
): Promise<ProbeApiIngestResponse> {
  const monitor: Monitor = new Monitor();
  monitor._id = ObjectID.generate().toString();
  monitor.projectId = ObjectID.generate();
  monitor.monitorType = MonitorType.Metrics;
  monitor.name = "Disk used by host";

  return MonitorCriteriaEvaluator.processMonitorStep({
    dataToProcess: buildResponse(),
    monitorStep: buildStep(criteriaInstances).monitorStep,
    monitor: monitor,
    probeApiIngestResponse: { monitorId: monitor.id!, rootCause: null },
    evaluationSummary: {
      criteriaResults: [],
      events: [],
    } as unknown as MonitorEvaluationSummary,
  });
}

function fingerprintsOver(greaterThan: number): Array<string> {
  const fingerprints: Array<string> = [];

  for (let index: number = 0; index < SERIES; index++) {
    if (valueOf(index) > greaterThan) {
      fingerprints.push(`fp-${hostOf(index)}`);
    }
  }

  return fingerprints.sort();
}

function matchedFingerprints(matched: MatchedCriteriaResult): Array<string> {
  return matched.perSeriesMatches
    .map((match: PerSeriesCriteriaMatch) => {
      return match.fingerprint;
    })
    .sort();
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a grouped check judges every series once per filter", () => {
  test("two matching criteria over 300 series: 600 judgements, not 1,200, and the same series matched", async () => {
    const evaluateOneSeries: jest.SpiedFunction<
      CriteriaInternals["evaluateOneSeries"]
    > = jest.spyOn(internals, "evaluateOneSeries");

    const response: ProbeApiIngestResponse = await evaluate([
      criteriaInstance({ id: "critical", filters: [overFilter(90)] }),
      criteriaInstance({ id: "warning", filters: [overFilter(70)] }),
    ]);

    expect(response.criteriaMetId).toBe("critical");
    expect(response.matchedCriteria).toHaveLength(2);
    expect(matchedFingerprints(response.matchedCriteria![0]!)).toEqual(
      fingerprintsOver(90),
    );
    expect(matchedFingerprints(response.matchedCriteria![1]!)).toEqual(
      fingerprintsOver(70),
    );

    expect(evaluateOneSeries).toHaveBeenCalledTimes(2 * SERIES);
  });

  test("a criteria that matches nothing is judged once, and matches nothing", async () => {
    const evaluateOneSeries: jest.SpiedFunction<
      CriteriaInternals["evaluateOneSeries"]
    > = jest.spyOn(internals, "evaluateOneSeries");

    const response: ProbeApiIngestResponse = await evaluate([
      criteriaInstance({ id: "impossible", filters: [overFilter(1_000)] }),
    ]);

    expect(response.criteriaMetId).toBeFalsy();
    expect(response.matchedCriteria ?? []).toHaveLength(0);
    expect(evaluateOneSeries).toHaveBeenCalledTimes(SERIES);
  });
});

describe("MetricMonitorCriteria.evaluateAllSeries", () => {
  const criteria: MonitorCriteriaInstance = criteriaInstance({
    id: "critical",
    filters: [overFilter(90), overFilter(50)],
  });
  const { monitorStep } = buildStep([criteria]);

  function judge(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
    evaluations?: MetricSeriesEvaluations | undefined;
  }): Promise<Array<MetricSeriesEvaluationResult>> {
    return MetricMonitorCriteria.evaluateAllSeries({
      dataToProcess: input.dataToProcess,
      criteriaFilter: input.criteriaFilter,
      monitorStep: monitorStep,
      evaluations: input.evaluations,
    });
  }

  test("a filter judged for the check is not judged again; another filter is", async () => {
    const evaluateOneSeries: jest.SpiedFunction<
      CriteriaInternals["evaluateOneSeries"]
    > = jest.spyOn(internals, "evaluateOneSeries");
    const dataToProcess: DataToProcess = buildResponse();
    const evaluations: MetricSeriesEvaluations = new Map();
    const filters: Array<CriteriaFilter> = criteria.data!.filters;

    const first: Array<MetricSeriesEvaluationResult> = await judge({
      dataToProcess,
      criteriaFilter: filters[0]!,
      evaluations,
    });
    const again: Array<MetricSeriesEvaluationResult> = await judge({
      dataToProcess,
      criteriaFilter: filters[0]!,
      evaluations,
    });

    expect(again).toBe(first);
    expect(evaluateOneSeries).toHaveBeenCalledTimes(SERIES);

    await judge({ dataToProcess, criteriaFilter: filters[1]!, evaluations });
    expect(evaluateOneSeries).toHaveBeenCalledTimes(2 * SERIES);
    expect(evaluations.size).toBe(2);
  });

  test("without the check's judgements, a filter is judged every time, as before", async () => {
    const evaluateOneSeries: jest.SpiedFunction<
      CriteriaInternals["evaluateOneSeries"]
    > = jest.spyOn(internals, "evaluateOneSeries");
    const dataToProcess: DataToProcess = buildResponse();
    const filter: CriteriaFilter = criteria.data!.filters[0]!;

    const first: Array<MetricSeriesEvaluationResult> = await judge({
      dataToProcess,
      criteriaFilter: filter,
    });
    const again: Array<MetricSeriesEvaluationResult> = await judge({
      dataToProcess,
      criteriaFilter: filter,
    });

    expect(evaluateOneSeries).toHaveBeenCalledTimes(2 * SERIES);
    expect(again).not.toBe(first);
    expect(again).toEqual(first);
  });

  test("judges the series one after another, in their order", async () => {
    const original: CriteriaInternals["evaluateOneSeries"] =
      internals.evaluateOneSeries.bind(MetricMonitorCriteria);
    let inFlight: number = 0;
    let mostInFlight: number = 0;

    jest
      .spyOn(internals, "evaluateOneSeries")
      .mockImplementation(
        async (input: unknown): Promise<MetricSeriesEvaluationResult> => {
          inFlight++;
          mostInFlight = Math.max(mostInFlight, inFlight);

          // A series whose judging awaits - a baseline read, say.
          await new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, 0);
          });

          try {
            return await original(input);
          } finally {
            inFlight--;
          }
        },
      );

    const evaluations: Array<MetricSeriesEvaluationResult> = await judge({
      dataToProcess: buildResponse(),
      criteriaFilter: criteria.data!.filters[0]!,
    });

    expect(mostInFlight).toBe(1);
    expect(
      evaluations.map((evaluation: MetricSeriesEvaluationResult) => {
        return evaluation.fingerprint;
      }),
    ).toEqual(
      Array.from({ length: SERIES }, (_: unknown, index: number): string => {
        return `fp-${hostOf(index)}`;
      }),
    );
    expect(
      evaluations
        .filter((evaluation: MetricSeriesEvaluationResult) => {
          return evaluation.rootCause !== null;
        })
        .map((evaluation: MetricSeriesEvaluationResult) => {
          return evaluation.fingerprint;
        })
        .sort(),
    ).toEqual(fingerprintsOver(90));
  });

  test("hands the event loop back as it judges, once the work has taken its budget", async () => {
    let now: number = 0;
    let handBacks: number = 0;

    // Each look at the clock: a millisecond of work.
    jest.spyOn(EventLoop, "now").mockImplementation((): number => {
      now += 1;
      return now;
    });
    jest
      .spyOn(EventLoop, "yieldToEventLoop")
      .mockImplementation(async (): Promise<void> => {
        handBacks++;
      });

    await judge({
      dataToProcess: buildResponse(),
      criteriaFilter: criteria.data!.filters[0]!,
    });

    // Some 300 ms of work: handed back about every 20 ms.
    expect(handBacks).toBeGreaterThanOrEqual(10);
    expect(handBacks).toBeLessThan(SERIES);
  });
});
