/*
 * MonitorCriteriaEvaluator reaches the template renderer, which loads the
 * native isolated-vm addon. Nothing here uses the sandbox and the
 * prebuilt binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import MetricAliasData from "../../../../Types/Metrics/MetricAliasData";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import MetricQueryData from "../../../../Types/Metrics/MetricQueryData";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import RollingTime from "../../../../Types/RollingTime/RollingTime";
import MonitorEvaluationSummary from "../../../../Types/Monitor/MonitorEvaluationSummary";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse, {
  MatchedCriteriaResult,
  PerSeriesCriteriaMatch,
} from "../../../../Types/Probe/ProbeApiIngestResponse";
import { describe, expect, it } from "@jest/globals";

/*
 * Two questions used to share one variable: "which criteria sets the
 * monitor's status" and "which criteria gets to raise records". Because
 * evaluation stopped at the first match, a grouped monitor with
 * `critical > 95%` above `warning > 80%` never evaluated the warning
 * band at all — a host at 85% got nothing for as long as another host
 * held the monitor critical.
 *
 * Grouped monitors now evaluate every criteria and report all of them;
 * `criteriaMetId` still names the first match, because the monitor still
 * has exactly one status. Ungrouped monitors keep first-match-wins.
 */

const HOST_KEY: string = "host.name";

type SeriesSample = {
  host: string;
  // One value per query alias, in alias order (a, then b).
  valuesByAlias: Array<number>;
};

function buildStep(input: {
  aliases: Array<string>;
  grouped: boolean;
  criteriaInstances: Array<MonitorCriteriaInstance>;
}): MonitorStep {
  const queryConfigs: Array<MetricQueryConfigData> = input.aliases.map(
    (alias: string): MetricQueryConfigData => {
      const metricAliasData: MetricAliasData = {
        metricVariable: alias,
        title: `Metric ${alias}`,
        description: undefined,
        legend: undefined,
        legendUnit: "%",
      };

      const metricQueryData: MetricQueryData = {
        filterData: { metricName: `metric.${alias}` },
        ...(input.grouped ? { groupByAttributeKeys: [HOST_KEY] } : {}),
      } as unknown as MetricQueryData;

      return { metricAliasData, metricQueryData };
    },
  );

  const metricViewConfig: MetricsViewConfig = {
    queryConfigs,
    formulaConfigs: [],
  };

  const criteria: MonitorCriteria = new MonitorCriteria();
  criteria.data = {
    monitorCriteriaInstanceArray: input.criteriaInstances,
  };

  const monitorStep: MonitorStep = new MonitorStep();
  monitorStep.data = {
    id: ObjectID.generate().toString(),
    monitorCriteria: criteria,
  } as unknown as MonitorStep["data"];
  monitorStep.data!.metricMonitor = {
    metricViewConfig,
    rollingTime: RollingTime.Past1Minute,
  };

  return monitorStep;
}

function buildResponse(input: {
  aliases: Array<string>;
  series: Array<SeriesSample>;
  withSeriesBreakdown: boolean;
}): MetricMonitorResponse {
  function sample(value: number, host: string): AggregateModel {
    return {
      timestamp: new Date("2026-08-27T00:00:00.000Z"),
      value,
      attributes: { [HOST_KEY]: host },
    } as unknown as AggregateModel;
  }

  // One AggregatedResult per alias, holding every host's row.
  const metricResult: Array<AggregatedResult> = input.aliases.map(
    (_alias: string, aliasIndex: number): AggregatedResult => {
      return {
        data: input.series.map((s: SeriesSample) => {
          return sample(s.valuesByAlias[aliasIndex]!, s.host);
        }),
      } as AggregatedResult;
    },
  );

  const seriesBreakdown: Array<{
    fingerprint: string;
    labels: Record<string, string>;
    aggregatedResults: Array<AggregatedResult>;
  }> = input.series.map((s: SeriesSample) => {
    return {
      fingerprint: `fp-${s.host}`,
      labels: { [HOST_KEY]: s.host },
      aggregatedResults: input.aliases.map(
        (_alias: string, aliasIndex: number): AggregatedResult => {
          return {
            data: [sample(s.valuesByAlias[aliasIndex]!, s.host)],
          } as AggregatedResult;
        },
      ),
    };
  });

  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    metricResult,
    metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
    ...(input.withSeriesBreakdown
      ? {
          seriesBreakdown:
            seriesBreakdown as unknown as MetricMonitorResponse["seriesBreakdown"],
        }
      : {}),
  } as unknown as MetricMonitorResponse;
}

function thresholdFilter(input: {
  alias: string;
  greaterThan: number;
}): CriteriaFilter {
  return {
    checkOn: CheckOn.MetricValue,
    filterType: FilterType.GreaterThan,
    value: String(input.greaterThan),
    metricMonitorOptions: {
      metricAlias: input.alias,
      metricAggregationType: EvaluateOverTimeType.AnyValue,
    },
  };
}

function criteriaInstance(input: {
  id: string;
  name: string;
  filters: Array<CriteriaFilter>;
  filterCondition?: FilterCondition | undefined;
  createAlerts?: boolean | undefined;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: input.id,
    name: input.name,
    description: "",
    monitorStatusId: undefined,
    filterCondition: input.filterCondition || FilterCondition.All,
    filters: input.filters,
    incidents: [],
    alerts: [],
    createAlerts: input.createAlerts !== false,
    createIncidents: input.createAlerts !== false,
  } as unknown as MonitorCriteriaInstance["data"];
  return instance;
}

function monitorModel(): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = ObjectID.generate().toString();
  monitor.projectId = ObjectID.generate();
  monitor.monitorType = MonitorType.Metrics;
  monitor.name = "Disk usage by host";
  return monitor;
}

function emptySummary(): MonitorEvaluationSummary {
  return {
    criteriaResults: [],
    events: [],
  } as unknown as MonitorEvaluationSummary;
}

async function evaluate(input: {
  grouped: boolean;
  aliases: Array<string>;
  criteriaInstances: Array<MonitorCriteriaInstance>;
  series: Array<SeriesSample>;
}): Promise<{
  response: ProbeApiIngestResponse;
  summary: MonitorEvaluationSummary;
}> {
  const monitor: Monitor = monitorModel();
  const monitorStep: MonitorStep = buildStep({
    aliases: input.aliases,
    grouped: input.grouped,
    criteriaInstances: input.criteriaInstances,
  });
  const dataToProcess: MetricMonitorResponse = buildResponse({
    aliases: input.aliases,
    series: input.series,
    // Ungrouped monitors get no breakdown, exactly as the worker does it.
    withSeriesBreakdown: input.grouped,
  });
  const summary: MonitorEvaluationSummary = emptySummary();

  const response: ProbeApiIngestResponse =
    await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: dataToProcess,
      monitorStep: monitorStep,
      monitor: monitor,
      probeApiIngestResponse: {
        monitorId: monitor.id!,
        rootCause: null,
      },
      evaluationSummary: summary,
    });

  return { response, summary };
}

function fingerprintsOf(matched: MatchedCriteriaResult): Array<string> {
  return matched.perSeriesMatches.map((match: PerSeriesCriteriaMatch) => {
    return match.fingerprint;
  });
}

describe("MonitorCriteriaEvaluator per-series fan-out", () => {
  describe("grouped monitors evaluate every criteria", () => {
    it("critical on one host and warning on another both fan out", async () => {
      const { response, summary } = await evaluate({
        grouped: true,
        aliases: ["a"],
        criteriaInstances: [
          criteriaInstance({
            id: "critical",
            name: "Disk > 95%",
            filters: [thresholdFilter({ alias: "a", greaterThan: 95 })],
          }),
          criteriaInstance({
            id: "warning",
            name: "Disk > 80%",
            filters: [thresholdFilter({ alias: "a", greaterThan: 80 })],
          }),
        ],
        series: [
          { host: "host-a", valuesByAlias: [96] },
          { host: "host-b", valuesByAlias: [85] },
        ],
      });

      // The monitor still has one status, owned by the first match.
      expect(response.criteriaMetId).toBe("critical");

      expect(response.matchedCriteria).toHaveLength(2);
      expect(response.matchedCriteria![0]!.criteriaId).toBe("critical");
      expect(fingerprintsOf(response.matchedCriteria![0]!)).toEqual([
        "fp-host-a",
      ]);

      expect(response.matchedCriteria![1]!.criteriaId).toBe("warning");
      // host-a breaches 80 too; de-escalation happens downstream.
      expect(fingerprintsOf(response.matchedCriteria![1]!).sort()).toEqual([
        "fp-host-a",
        "fp-host-b",
      ]);

      expect(response.evaluatedCriteriaIds).toEqual(["critical", "warning"]);

      // Both criteria are reported, so the log explains what happened.
      expect(summary.criteriaResults).toHaveLength(2);
      expect(
        summary.criteriaResults.every(
          (result: { skipped?: boolean | undefined }) => {
            return result.skipped !== true;
          },
        ),
      ).toBe(true);
    });

    it("records an unmatched criteria with an empty breaching set, not as absent", async () => {
      const { response } = await evaluate({
        grouped: true,
        aliases: ["a"],
        criteriaInstances: [
          criteriaInstance({
            id: "critical",
            name: "Disk > 95%",
            filters: [thresholdFilter({ alias: "a", greaterThan: 95 })],
          }),
          criteriaInstance({
            id: "warning",
            name: "Disk > 80%",
            filters: [thresholdFilter({ alias: "a", greaterThan: 80 })],
          }),
        ],
        series: [
          { host: "host-a", valuesByAlias: [96] },
          { host: "host-b", valuesByAlias: [10] },
        ],
      });

      /*
       * Both criteria ran. "warning" matched host-a only. The resolve
       * pass needs `evaluatedCriteriaIds` to tell an evaluated-and-clean
       * criteria (resolve its records) from one that never ran at all
       * (leave them alone).
       */
      expect(response.evaluatedCriteriaIds).toEqual(["critical", "warning"]);
      expect(response.matchedCriteria).toHaveLength(2);
    });

    it("a grouped monitor always publishes a per-series array", async () => {
      const { response } = await evaluate({
        grouped: true,
        aliases: ["a"],
        criteriaInstances: [
          criteriaInstance({
            id: "critical",
            name: "Disk > 95%",
            filters: [thresholdFilter({ alias: "a", greaterThan: 95 })],
          }),
        ],
        series: [{ host: "host-a", valuesByAlias: [96] }],
      });

      /*
       * A defined array is what tells the creators to dedupe on
       * (criteria, series). Leaving it undefined is what made the first
       * host's alert block every other host.
       */
      expect(response.perSeriesMatches).toBeDefined();
      expect(response.perSeriesMatches).toHaveLength(1);
      expect(response.perSeriesMatches![0]!.fingerprint).toBe("fp-host-a");
    });
  });

  describe("a criteria no single series satisfies does not fire", () => {
    it("two filters met by two different hosts is not a match", async () => {
      /*
       * Under FilterCondition.All the scalar verdict evaluates each
       * filter independently and each collapses to its own first
       * breaching series, so filter "a" can be satisfied by host-a while
       * filter "b" is satisfied by host-b and the criteria reports met.
       * Honouring that opened one unattributed whole-monitor alert that
       * then blocked every real per-host alert.
       */
      const { response, summary } = await evaluate({
        grouped: true,
        aliases: ["a", "b"],
        criteriaInstances: [
          criteriaInstance({
            id: "both-metrics",
            name: "a and b both high",
            filterCondition: FilterCondition.All,
            filters: [
              thresholdFilter({ alias: "a", greaterThan: 90 }),
              thresholdFilter({ alias: "b", greaterThan: 90 }),
            ],
          }),
        ],
        series: [
          { host: "host-a", valuesByAlias: [95, 10] },
          { host: "host-b", valuesByAlias: [10, 95] },
        ],
      });

      expect(response.criteriaMetId).toBeUndefined();
      expect(response.matchedCriteria).toEqual([]);
      expect(summary.criteriaResults[0]!.met).toBe(false);
    });

    it("the same two filters DO fire when one host satisfies both", async () => {
      const { response } = await evaluate({
        grouped: true,
        aliases: ["a", "b"],
        criteriaInstances: [
          criteriaInstance({
            id: "both-metrics",
            name: "a and b both high",
            filterCondition: FilterCondition.All,
            filters: [
              thresholdFilter({ alias: "a", greaterThan: 90 }),
              thresholdFilter({ alias: "b", greaterThan: 90 }),
            ],
          }),
        ],
        series: [
          { host: "host-a", valuesByAlias: [95, 95] },
          { host: "host-b", valuesByAlias: [10, 10] },
        ],
      });

      expect(response.criteriaMetId).toBe("both-metrics");
      expect(fingerprintsOf(response.matchedCriteria![0]!)).toEqual([
        "fp-host-a",
      ]);
    });
  });

  describe("ungrouped monitors keep first-match-wins", () => {
    it("stops at the first matching criteria and reports the rest as skipped", async () => {
      const { response, summary } = await evaluate({
        grouped: false,
        aliases: ["a"],
        criteriaInstances: [
          criteriaInstance({
            id: "critical",
            name: "Disk > 95%",
            filters: [thresholdFilter({ alias: "a", greaterThan: 95 })],
          }),
          criteriaInstance({
            id: "warning",
            name: "Disk > 80%",
            filters: [thresholdFilter({ alias: "a", greaterThan: 80 })],
          }),
        ],
        series: [{ host: "host-a", valuesByAlias: [96] }],
      });

      expect(response.criteriaMetId).toBe("critical");
      // Nothing new is published for an ungrouped monitor.
      expect(response.matchedCriteria).toBeUndefined();
      expect(response.evaluatedCriteriaIds).toBeUndefined();
      expect(response.perSeriesMatches).toBeUndefined();

      /*
       * The criteria that never ran is now named in the summary rather
       * than being an unexplained gap in it.
       */
      expect(summary.criteriaResults).toHaveLength(2);
      expect(summary.criteriaResults[1]!.criteriaId).toBe("warning");
      expect(summary.criteriaResults[1]!.skipped).toBe(true);
      expect(summary.criteriaResults[1]!.skipReason).toContain(
        "already matched",
      );
    });
  });
});

describe("MonitorResourceUtil de-escalation", () => {
  /*
   * claimUnclaimedSeries is private; exercised through the documented
   * escape hatch, the same way HostAbsenceSeriesIntegration reaches
   * collectPerSeriesMatches.
   */
  const claimUnclaimedSeries: (input: {
    matches: Array<PerSeriesCriteriaMatch>;
    claimed: Set<string>;
    isClaiming: boolean;
  }) => Array<PerSeriesCriteriaMatch> = (
    MonitorResourceUtil as unknown as {
      claimUnclaimedSeries: (input: {
        matches: Array<PerSeriesCriteriaMatch>;
        claimed: Set<string>;
        isClaiming: boolean;
      }) => Array<PerSeriesCriteriaMatch>;
    }
  ).claimUnclaimedSeries;

  function match(fingerprint: string): PerSeriesCriteriaMatch {
    return {
      criteriaMetId: "c",
      fingerprint,
      labels: {},
      rootCause: "breached",
    };
  }

  it("a host claimed by the critical band is not claimed again by warning", () => {
    const claimed: Set<string> = new Set<string>();

    const critical: Array<PerSeriesCriteriaMatch> = claimUnclaimedSeries({
      matches: [match("fp-host-a")],
      claimed,
      isClaiming: true,
    });

    const warning: Array<PerSeriesCriteriaMatch> = claimUnclaimedSeries({
      matches: [match("fp-host-a"), match("fp-host-b")],
      claimed,
      isClaiming: true,
    });

    expect(
      critical.map((m: PerSeriesCriteriaMatch) => {
        return m.fingerprint;
      }),
    ).toEqual(["fp-host-a"]);
    // host-a already pages at critical; only host-b gets the warning.
    expect(
      warning.map((m: PerSeriesCriteriaMatch) => {
        return m.fingerprint;
      }),
    ).toEqual(["fp-host-b"]);
  });

  it("a criteria that creates nothing claims nothing", () => {
    const claimed: Set<string> = new Set<string>();

    claimUnclaimedSeries({
      matches: [match("fp-host-a")],
      claimed,
      isClaiming: false,
    });

    const alerting: Array<PerSeriesCriteriaMatch> = claimUnclaimedSeries({
      matches: [match("fp-host-a")],
      claimed,
      isClaiming: true,
    });

    /*
     * A passive recovery criteria must never steal a series from the
     * criteria that would have alerted on it.
     */
    expect(
      alerting.map((m: PerSeriesCriteriaMatch) => {
        return m.fingerprint;
      }),
    ).toEqual(["fp-host-a"]);
  });
});
