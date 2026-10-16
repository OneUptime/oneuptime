import MetricMonitorCriteria, {
  IsCriteriaInEffect,
  MetricSeriesEvaluationResult,
} from "../../../../../Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import MonitorCriteriaMessageBuilder from "../../../../../Server/Utils/Monitor/MonitorCriteriaMessageBuilder";
import DataToProcess from "../../../../../Server/Utils/Monitor/DataToProcess";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import AggregateModel from "../../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../../../Types/BaseDatabase/InBetween";
import { JSONObject } from "../../../../../Types/JSON";
import MetricFormulaConfigData from "../../../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../../../Types/Metrics/MetricQueryConfigData";
import MetricsViewConfig from "../../../../../Types/Metrics/MetricsViewConfig";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../../../Types/Monitor/CriteriaFilter";
import {
  KubernetesAlertTemplate,
  getKubernetesAlertTemplateById,
} from "../../../../../Types/Monitor/KubernetesAlertTemplates";
import MetricMonitorResponse from "../../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorCriteriaInstance from "../../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../../Types/ObjectID";
import RollingTime from "../../../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../../../Types/RollingTime/RollingTimeUtil";
import MetricFormulaEvaluator from "../../../../../Utils/Metrics/MetricFormulaEvaluator";
import MetricSeriesFingerprint from "../../../../../Utils/Metrics/MetricSeriesFingerprint";
import { describe, expect, test } from "@jest/globals";

/*
 * Issue #4793. A Kubernetes "Deployment Replica Mismatch" monitor (Past 15
 * Minutes, All Values, replica_shortfall = desired - available > 0, grouped
 * by namespace and deployment) opened an alert 73 seconds after a brand-new
 * deployment fell short:
 *
 *   "Deployment Replica Shortfall was 1 in 1 reading, above the 0 threshold."
 *
 * "All Values over the past 15 minutes" says the condition held for the
 * whole 15 minutes. These are the customer's monitor - the shipped template
 * itself - and data shaped as the worker hands it over: one bucket a
 * minute per query, per deployment, and the formula worked out from them.
 * The window is the worker's own, ending at a fixed time; nothing here
 * reads the clock.
 */

const MINUTE: number = 60_000;

// The check that is evaluated: 12:15:30, so the window starts at 12:00:30.
const NOW: Date = new Date(Date.UTC(2026, 9, 16, 12, 15, 30));
const WINDOW: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
  RollingTime.Past15Minutes,
  NOW,
);

const NAMESPACE_KEY: string = "resource.k8s.namespace.name";
const DEPLOYMENT_KEY: string = "resource.k8s.deployment.name";

const template: KubernetesAlertTemplate = getKubernetesAlertTemplateById(
  "k8s-deployment-replica-mismatch",
)!;

const step: MonitorStep = template.getMonitorStep({
  clusterIdentifier: "prod",
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: "Replica Mismatch",
});

const viewConfig: MetricsViewConfig = MonitorStep.getMetricsViewConfig(step)!;

const criteria: Array<MonitorCriteriaInstance> =
  step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;

// replica_shortfall > 0, All Values: the shipped firing filter.
const unhealthyFilter: CriteriaFilter = criteria[0]!.data!.filters[0]!;
// replica_shortfall <= 0, All Values: the shipped recovery filter.
const healthyFilter: CriteriaFilter = criteria[1]!.data!.filters[0]!;

// A copy, so a test can set what the shipped filter does not.
function filter(overrides: Partial<CriteriaFilter> = {}): CriteriaFilter {
  return {
    ...JSON.parse(JSON.stringify(unhealthyFilter)),
    ...overrides,
  } as CriteriaFilter;
}

function withAggregation(type: EvaluateOverTimeType): CriteriaFilter {
  const copy: CriteriaFilter = filter();
  copy.metricMonitorOptions = {
    ...copy.metricMonitorOptions,
    metricAggregationType: type,
  };
  return copy;
}

// The minute bucket starting `minute` minutes after 12:00.
function bucket(minute: number): Date {
  return new Date(Date.UTC(2026, 9, 16, 12, 0, 0) + minute * MINUTE);
}

interface Minute {
  minute: number;
  desired: number;
  available: number;
}

// Every minute from `from` to `to`, desired and available as given.
function minutes(
  from: number,
  to: number,
  desired: number,
  available: number,
): Array<Minute> {
  const result: Array<Minute> = [];
  for (let minute: number = from; minute <= to; minute++) {
    result.push({ minute, desired, available });
  }
  return result;
}

function labelsOf(deployment: string): JSONObject {
  return { [NAMESPACE_KEY]: "payments", [DEPLOYMENT_KEY]: deployment };
}

function fingerprintOf(deployment: string): string {
  return MetricSeriesFingerprint.computeFingerprint(labelsOf(deployment));
}

/*
 * One deployment's series as buildSeriesBreakdown hands it over: the two
 * queries' buckets, then the formula's, worked out by the same evaluator.
 */
function series(deployment: string, data: Array<Minute>): MetricSeriesResult {
  const rows: (pick: (minute: Minute) => number) => AggregatedResult = (
    pick: (minute: Minute) => number,
  ): AggregatedResult => {
    return {
      data: data.map((minute: Minute): AggregateModel => {
        return {
          timestamp: bucket(minute.minute),
          value: pick(minute),
          attributes: labelsOf(deployment),
        };
      }),
    };
  };

  const queryResults: Array<AggregatedResult> = [
    rows((minute: Minute) => {
      return minute.desired;
    }),
    rows((minute: Minute) => {
      return minute.available;
    }),
  ];

  const formula: MetricFormulaConfigData = viewConfig.formulaConfigs[0]!;

  return {
    fingerprint: fingerprintOf(deployment),
    labels: labelsOf(deployment),
    aggregatedResults: [
      ...queryResults,
      MetricFormulaEvaluator.evaluateFormula({
        formula: formula.metricFormulaData.metricFormula,
        queryConfigs: viewConfig.queryConfigs,
        formulaConfigs: [],
        results: queryResults,
      }),
    ],
  };
}

function response(input: {
  breakdown: Array<MetricSeriesResult>;
  // Left out: the 12:15:30 window. Given as undefined: no window at all.
  window?: InBetween<Date> | undefined;
  dataCompleteFrom?: Date | undefined;
}): MetricMonitorResponse {
  const window: InBetween<Date> | undefined =
    "window" in input ? input.window : WINDOW;

  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    metricViewConfig: viewConfig,
    metricResult: [],
    seriesBreakdown: input.breakdown,
    ...(window ? { startAndEndDate: window } : {}),
    ...(input.dataCompleteFrom
      ? { dataCompleteFrom: input.dataCompleteFrom }
      : {}),
  };
}

async function evaluate(input: {
  breakdown: Array<MetricSeriesResult>;
  criteriaFilter?: CriteriaFilter | undefined;
  isInEffect?: IsCriteriaInEffect | undefined;
  window?: InBetween<Date> | undefined;
  dataCompleteFrom?: Date | undefined;
}): Promise<Array<MetricSeriesEvaluationResult>> {
  return MetricMonitorCriteria.evaluateAllSeries({
    dataToProcess: response(input) as DataToProcess,
    criteriaFilter: input.criteriaFilter || filter(),
    monitorStep: step,
    isInEffect: input.isInEffect,
  });
}

function fired(
  evaluations: Array<MetricSeriesEvaluationResult>,
): Array<string> {
  return evaluations
    .filter((evaluation: MetricSeriesEvaluationResult) => {
      return evaluation.rootCause !== null;
    })
    .map((evaluation: MetricSeriesEvaluationResult) => {
      return String(evaluation.labels[DEPLOYMENT_KEY]);
    });
}

// A deployment short one replica, every minute from `from` to 12:15.
function shortSince(deployment: string, from: number): MetricSeriesResult {
  return series(deployment, minutes(from, 15, 2, 1));
}

describe("All Values over a metric monitor's time range waits for a full window (#4793)", () => {
  test("the shipped template is the customer's: All Values over the past 15 minutes, grouped by namespace and deployment", () => {
    expect(step.data!.kubernetesMonitor!.rollingTime).toBe(
      RollingTime.Past15Minutes,
    );
    expect(unhealthyFilter.metricMonitorOptions?.metricAggregationType).toBe(
      EvaluateOverTimeType.AllValues,
    );
    expect(unhealthyFilter.filterType).toBe(FilterType.GreaterThan);
    expect(Number(unhealthyFilter.value)).toBe(0);
    expect(
      viewConfig.queryConfigs.map((query: MetricQueryConfigData) => {
        return query.metricQueryData.groupByAttributeKeys;
      }),
    ).toEqual([
      [NAMESPACE_KEY, DEPLOYMENT_KEY],
      [NAMESPACE_KEY, DEPLOYMENT_KEY],
    ]);
  });

  describe("a brand-new deployment", () => {
    test("one reading short: no match - it waits, and says how long", async () => {
      const [evaluation] = await evaluate({
        breakdown: [shortSince("api", 15)],
      });

      expect(evaluation!.rootCause).toBeNull();
      expect(evaluation!.context.windowWait).toEqual({
        message:
          "Deployment: api | Namespace: payments - Deployment Replica Shortfall was 1 in 1 reading, above the 0 threshold. Waiting for 15 minutes of data: less than a minute of 15 minutes so far.",
        waitingSeriesCount: 1,
        shortfall: "StartsLate",
        windowMs: 15 * MINUTE,
        coveredMs: 30_000,
      });
    });

    test("1, 5, 10 and 12.5 minutes short: still waiting", async () => {
      for (const from of [14, 10, 5, 3]) {
        const [evaluation] = await evaluate({
          breakdown: [shortSince("api", from)],
        });

        expect({ from, rootCause: evaluation!.rootCause }).toEqual({
          from,
          rootCause: null,
        });
        expect(evaluation!.context.windowWait?.shortfall).toBe("StartsLate");
      }
    });

    test("short for the whole 15 minutes: it fires, with the message it always had", async () => {
      const [evaluation] = await evaluate({
        breakdown: [shortSince("api", 0)],
      });

      expect(evaluation!.rootCause).toBe(
        "Deployment Replica Shortfall was 1 in all 16 readings, above the 0 threshold.",
      );
      expect(evaluation!.context.windowWait).toBeUndefined();
      expect(evaluation!.context.breachingSamples).toHaveLength(16);
    });

    /*
     * Judged at the resolution of the data, as every over-time window is
     * (WindowCoverage): data reaching back to within one and a half data
     * points - 90 seconds - of the window's start covers it. That is what
     * keeps a long-standing series from flipping to "waiting" when the
     * window starts mid-minute.
     */
    test("the boundary: data from 12:02 covers the window that starts at 12:00:30; from 12:03 it does not", async () => {
      expect(
        fired(await evaluate({ breakdown: [shortSince("api", 2)] })),
      ).toEqual(["api"]);
      expect(
        fired(await evaluate({ breakdown: [shortSince("api", 3)] })),
      ).toEqual([]);
    });

    /*
     * Minute by minute, as the worker evaluates it: a deployment short
     * from 12:00 is reported waiting on every check until its data covers
     * the window - reaching back to within 90 seconds of its start - then
     * fires: 13.5 minutes in, not 73 seconds.
     */
    test("evaluated every minute from its first reading, it fires once its data covers the window", async () => {
      const verdicts: Array<string> = [];

      for (let checkMinute: number = 1; checkMinute <= 20; checkMinute++) {
        const checkAt: Date = new Date(bucket(checkMinute).getTime() + 30_000);
        const window: InBetween<Date> =
          RollingTimeUtil.convertToStartAndEndDate(
            RollingTime.Past15Minutes,
            checkAt,
          );
        // Buckets from 12:00 up to the minute of the check.
        const [evaluation] = await evaluate({
          breakdown: [series("api", minutes(0, checkMinute, 2, 1))],
          window,
        });

        verdicts.push(
          `${checkMinute}: ${evaluation!.rootCause ? "fires" : evaluation!.context.windowWait!.message.split("Waiting for 15 minutes of data: ")[1]}`,
        );
      }

      expect(verdicts).toEqual([
        "1: 1 of 15 minutes so far.",
        "2: 2 of 15 minutes so far.",
        "3: 3 of 15 minutes so far.",
        "4: 4 of 15 minutes so far.",
        "5: 5 of 15 minutes so far.",
        "6: 6 of 15 minutes so far.",
        "7: 7 of 15 minutes so far.",
        "8: 8 of 15 minutes so far.",
        "9: 9 of 15 minutes so far.",
        "10: 10 of 15 minutes so far.",
        "11: 11 of 15 minutes so far.",
        "12: 12 of 15 minutes so far.",
        // 13.5 minutes in: the data reaches back to within 90 s of the start.
        "13: fires",
        "14: fires",
        "15: fires",
        "16: fires",
        "17: fires",
        "18: fires",
        "19: fires",
        "20: fires",
      ]);
    });
  });

  describe("a deployment whose data has a hole", () => {
    test("one missing minute is bridged: it fires", async () => {
      const data: Array<Minute> = minutes(0, 15, 2, 1).filter(
        (minute: Minute) => {
          return minute.minute !== 7;
        },
      );

      expect(
        fired(await evaluate({ breakdown: [series("api", data)] })),
      ).toEqual(["api"]);
    });

    test("three missing minutes in the middle: it waits, since the gap", async () => {
      const data: Array<Minute> = [
        ...minutes(0, 5, 2, 1),
        ...minutes(9, 15, 2, 1),
      ];

      const [evaluation] = await evaluate({ breakdown: [series("api", data)] });

      expect(evaluation!.rootCause).toBeNull();
      expect(evaluation!.context.windowWait?.shortfall).toBe("Hole");
      expect(evaluation!.context.windowWait?.message).toContain(
        "Waiting for 15 minutes of data: 6 of 15 minutes so far, since a 3-minute gap in its data.",
      );
    });

    test("once the hole has left the window, the data covers it again and it fires", async () => {
      const checkAt: Date = new Date(bucket(24).getTime() + 30_000);
      const window: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
        RollingTime.Past15Minutes,
        checkAt,
      );

      // What the worker reads at 12:24:30: from 12:09:30 on.
      expect(
        fired(
          await evaluate({
            breakdown: [series("api", minutes(9, 24, 2, 1))],
            window,
          }),
        ),
      ).toEqual(["api"]);
    });

    test("a deployment recreated under the same name after a gap is treated as new", async () => {
      // The old one was short until 12:05, gone 4 minutes, the new one short since.
      const data: Array<Minute> = [
        ...minutes(0, 5, 3, 1),
        ...minutes(10, 15, 1, 0),
      ];

      const [evaluation] = await evaluate({ breakdown: [series("api", data)] });

      expect(evaluation!.rootCause).toBeNull();
      expect(evaluation!.context.windowWait?.shortfall).toBe("Hole");
    });
  });

  test("stale data - the deployment stopped reporting 4 minutes ago - waits", async () => {
    const [evaluation] = await evaluate({
      breakdown: [series("api", minutes(0, 11, 2, 1))],
    });

    expect(evaluation!.rootCause).toBeNull();
    expect(evaluation!.context.windowWait?.shortfall).toBe("Stale");
    expect(evaluation!.context.windowWait?.message).toContain(
      "Waiting for 15 minutes of data: no new data point for the last 3 minutes.",
    );
  });

  describe("several deployments at once", () => {
    test("a deployment short all along fires while a new one beside it waits", async () => {
      const evaluations: Array<MetricSeriesEvaluationResult> = await evaluate({
        breakdown: [shortSince("checkout", 0), shortSince("api", 14)],
      });

      expect(fired(evaluations)).toEqual(["checkout"]);
      expect(evaluations[1]!.context.windowWait?.shortfall).toBe("StartsLate");
    });

    test("the criteria's verdict names the one that fired", async () => {
      const criteriaFilter: CriteriaFilter = filter();

      const rootCause: string | null =
        await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: response({
            breakdown: [shortSince("api", 14), shortSince("checkout", 0)],
          }) as DataToProcess,
          criteriaFilter,
          monitorStep: step,
        });

      expect(rootCause).toBe(
        "Deployment Replica Shortfall was 1 in all 16 readings, above the 0 threshold.",
      );
      expect(criteriaFilter.metricCriteriaContext?.seriesLabels).toEqual(
        labelsOf("checkout"),
      );
      expect(criteriaFilter.metricCriteriaContext?.windowWait).toBeUndefined();
    });

    test("when only waiting ones meet the condition, the log says how many wait and how far the closest has got", async () => {
      const criteriaFilter: CriteriaFilter = filter();

      const rootCause: string | null =
        await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: response({
            breakdown: [
              shortSince("api", 14),
              shortSince("checkout", 6),
              // Healthy: not waiting, nothing to wait for.
              series("search", minutes(0, 15, 2, 2)),
            ],
          }) as DataToProcess,
          criteriaFilter,
          monitorStep: step,
        });

      expect(rootCause).toBeNull();
      expect(criteriaFilter.metricCriteriaContext?.seriesLabels).toEqual(
        labelsOf("checkout"),
      );
      expect(criteriaFilter.metricCriteriaContext?.windowWait).toEqual({
        message:
          "2 series are waiting for a full window of data. Closest: Deployment: checkout | Namespace: payments - Deployment Replica Shortfall was 1 in all 10 readings, above the 0 threshold. Waiting for 15 minutes of data: 9 of 15 minutes so far.",
        waitingSeriesCount: 2,
        shortfall: "StartsLate",
        windowMs: 15 * MINUTE,
        coveredMs: 9.5 * MINUTE,
      });

      // And that is the filter's line in the evaluation log.
      expect(
        MonitorCriteriaMessageBuilder.buildCriteriaFilterMessage({
          monitor: kubernetesMonitor(),
          criteriaFilter,
          dataToProcess: response({ breakdown: [] }) as DataToProcess,
          monitorStep: step,
          didMeetCriteria: false,
          matchMessage: null,
        }),
      ).toBe(criteriaFilter.metricCriteriaContext?.windowWait?.message);
    });
  });

  describe("a criteria already in effect is judged on its readings, as before", () => {
    const gappy: Array<Minute> = [
      ...minutes(0, 5, 2, 1),
      ...minutes(10, 15, 2, 1),
    ];

    test("an open alert for the deployment: a gap in its data does not stop the match", async () => {
      const asked: Array<string | undefined> = [];

      const evaluations: Array<MetricSeriesEvaluationResult> = await evaluate({
        breakdown: [series("api", gappy)],
        isInEffect: async (fingerprint: string | undefined) => {
          asked.push(fingerprint);
          return fingerprint === fingerprintOf("api");
        },
      });

      expect(fired(evaluations)).toEqual(["api"]);
      expect(evaluations[0]!.context.windowWait).toBeUndefined();
      expect(asked).toEqual([fingerprintOf("api")]);
    });

    test("no open alert: the same data waits", async () => {
      const [evaluation] = await evaluate({
        breakdown: [series("api", gappy)],
        isInEffect: async () => {
          return false;
        },
      });

      expect(evaluation!.rootCause).toBeNull();
      expect(evaluation!.context.windowWait?.shortfall).toBe("Hole");
    });

    test("another deployment's open alert does not count for this one", async () => {
      expect(
        fired(
          await evaluate({
            breakdown: [series("api", gappy)],
            isInEffect: async (fingerprint: string | undefined) => {
              return fingerprint === fingerprintOf("checkout");
            },
          }),
        ),
      ).toEqual([]);
    });

    test("is asked only about a series that would match but for its window - never about a covered or a healthy one", async () => {
      const asked: Array<string | undefined> = [];

      await evaluate({
        breakdown: [
          shortSince("checkout", 0),
          series("search", minutes(0, 15, 2, 2)),
          series("cart", [...minutes(0, 5, 2, 1), ...minutes(10, 15, 2, 2)]),
          shortSince("api", 12),
        ],
        isInEffect: async (fingerprint: string | undefined) => {
          asked.push(fingerprint);
          return false;
        },
      });

      expect(asked).toEqual([fingerprintOf("api")]);
    });

    test("a reading that misses the condition still ends the match, open alert or not", async () => {
      // Recovered at 12:15: available caught up.
      const recovered: Array<Minute> = [
        ...minutes(0, 14, 2, 1),
        { minute: 15, desired: 2, available: 2 },
      ];

      const [evaluation] = await evaluate({
        breakdown: [series("api", recovered)],
        isInEffect: async () => {
          return true;
        },
      });

      expect(evaluation!.rootCause).toBeNull();
      expect(evaluation!.context.windowWait).toBeUndefined();
    });
  });

  describe("the recovery criteria follows the same rule", () => {
    test("a new healthy deployment waits before it can call the monitor healthy", async () => {
      const [evaluation] = await evaluate({
        breakdown: [series("api", minutes(12, 15, 2, 2))],
        criteriaFilter: JSON.parse(JSON.stringify(healthyFilter)),
      });

      expect(evaluation!.rootCause).toBeNull();
      expect(evaluation!.context.windowWait?.message).toContain(
        "Deployment: api | Namespace: payments - Deployment Replica Shortfall was 0 in all 4 readings, at or below the 0 threshold. Waiting for 15 minutes of data: 3 of 15 minutes so far.",
      );
    });

    test("unless the monitor is already healthy: then it is in effect and matches at once", async () => {
      expect(
        fired(
          await evaluate({
            breakdown: [series("api", minutes(12, 15, 2, 2))],
            criteriaFilter: JSON.parse(JSON.stringify(healthyFilter)),
            isInEffect: async () => {
              return true;
            },
          }),
        ),
      ).toEqual(["api"]);
    });

    test("a healthy deployment reporting all along matches", async () => {
      expect(
        fired(
          await evaluate({
            breakdown: [series("api", minutes(0, 15, 2, 2))],
            criteriaFilter: JSON.parse(JSON.stringify(healthyFilter)),
          }),
        ),
      ).toEqual(["api"]);
    });
  });

  describe("only All Values says something about the whole window", () => {
    test("Any Value fires on the first reading, as documented", async () => {
      expect(
        fired(
          await evaluate({
            breakdown: [shortSince("api", 15)],
            criteriaFilter: withAggregation(EvaluateOverTimeType.AnyValue),
          }),
        ),
      ).toEqual(["api"]);
    });

    /*
     * An aggregate describes the readings there are - the average of what
     * arrived - and never claimed the whole window. A sparse counter that
     * only reports when something happens would never cover a window, so
     * making an aggregate wait would silence it outright.
     */
    test.each([
      EvaluateOverTimeType.Average,
      EvaluateOverTimeType.Sum,
      EvaluateOverTimeType.MaximumValue,
      EvaluateOverTimeType.MunimumValue,
    ])(
      "%s compares the readings there are, without waiting",
      async (type: EvaluateOverTimeType) => {
        const [evaluation] = await evaluate({
          breakdown: [shortSince("api", 14)],
          criteriaFilter: withAggregation(type),
        });

        expect(evaluation!.rootCause).not.toBeNull();
        expect(evaluation!.context.windowWait).toBeUndefined();
      },
    );

    test("an anomaly criteria is not touched", async () => {
      const [evaluation] = await evaluate({
        breakdown: [shortSince("api", 14)],
        criteriaFilter: filter({ filterType: FilterType.AnomalouslyHigh }),
      });

      expect(evaluation!.rootCause).toBeNull();
      expect(evaluation!.context.windowWait).toBeUndefined();
    });
  });

  describe("If No Data keeps its meaning: a window with no data points at all", () => {
    test.each([
      NoDataPolicy.Trigger,
      NoDataPolicy.TreatAsZero,
      NoDataPolicy.Ignore,
    ])(
      "%s: a window with some data that does not cover it waits",
      async (policy: NoDataPolicy) => {
        const criteriaFilter: CriteriaFilter = filter();
        criteriaFilter.metricMonitorOptions = {
          ...criteriaFilter.metricMonitorOptions,
          onNoDataPolicy: policy,
        };

        const [evaluation] = await evaluate({
          breakdown: [shortSince("api", 14)],
          criteriaFilter,
        });

        expect(evaluation!.rootCause).toBeNull();
        expect(evaluation!.context.windowWait?.shortfall).toBe("StartsLate");
      },
    );

    test("Trigger still fires on an empty window", async () => {
      const criteriaFilter: CriteriaFilter = filter();
      criteriaFilter.metricMonitorOptions = {
        ...criteriaFilter.metricMonitorOptions,
        onNoDataPolicy: NoDataPolicy.Trigger,
      };

      const [evaluation] = await evaluate({
        breakdown: [series("api", [])],
        criteriaFilter,
      });

      expect(evaluation!.rootCause).toContain("No data received");
    });
  });

  test("a response that does not say what window it read is judged as before", async () => {
    expect(
      fired(
        await evaluate({
          breakdown: [shortSince("api", 15)],
          window: undefined,
        }),
      ),
    ).toEqual(["api"]);
  });

  describe("a read cut at its row limit", () => {
    // The newest rows the reads returned go back to 12:10:30.
    const completeFrom: Date = new Date(NOW.getTime() - 5 * MINUTE);

    test("judges a deployment from where the data is complete", async () => {
      // Its oldest rows were cut: it seems to begin at 12:10.
      expect(
        fired(
          await evaluate({
            breakdown: [shortSince("checkout", 10)],
            dataCompleteFrom: completeFrom,
          }),
        ),
      ).toEqual(["checkout"]);
    });

    test("and a deployment newer than that still waits, saying what could be read", async () => {
      const [evaluation] = await evaluate({
        breakdown: [shortSince("api", 14)],
        dataCompleteFrom: completeFrom,
      });

      expect(evaluation!.rootCause).toBeNull();
      expect(evaluation!.context.windowWait?.message).toContain(
        "Waiting for 5 minutes of data: 1 of 5 minutes so far. Only the newest 5 minutes of the 15-minute time range could be read",
      );
    });
  });

  describe("an ungrouped monitor", () => {
    function ungrouped(data: Array<Minute>): MetricMonitorResponse {
      const whole: MetricSeriesResult = series("whole", data);
      return {
        ...response({ breakdown: [] }),
        seriesBreakdown: undefined,
        metricResult: whole.aggregatedResults,
      };
    }

    test("judges the whole monitor by the same rule", async () => {
      const waiting: Array<MetricSeriesEvaluationResult> =
        await MetricMonitorCriteria.evaluateAllSeries({
          dataToProcess: ungrouped(minutes(14, 15, 2, 1)) as DataToProcess,
          criteriaFilter: filter(),
          monitorStep: step,
        });

      expect(waiting[0]!.rootCause).toBeNull();
      expect(waiting[0]!.context.windowWait?.message).toBe(
        "Deployment Replica Shortfall was 1 in all 2 readings, above the 0 threshold. Waiting for 15 minutes of data: 1 of 15 minutes so far.",
      );

      const covered: Array<MetricSeriesEvaluationResult> =
        await MetricMonitorCriteria.evaluateAllSeries({
          dataToProcess: ungrouped(minutes(0, 15, 2, 1)) as DataToProcess,
          criteriaFilter: filter(),
          monitorStep: step,
        });

      expect(covered[0]!.rootCause).not.toBeNull();
    });

    test("asks whether the criteria is in effect for the whole monitor", async () => {
      const asked: Array<string | undefined> = [];

      const evaluations: Array<MetricSeriesEvaluationResult> =
        await MetricMonitorCriteria.evaluateAllSeries({
          dataToProcess: ungrouped(minutes(14, 15, 2, 1)) as DataToProcess,
          criteriaFilter: filter(),
          monitorStep: step,
          isInEffect: async (fingerprint: string | undefined) => {
            asked.push(fingerprint);
            return true;
          },
        });

      expect(asked).toEqual([undefined]);
      expect(evaluations[0]!.rootCause).not.toBeNull();
    });
  });
});

function kubernetesMonitor(): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = ObjectID.generate();
  monitor.monitorType = MonitorType.Kubernetes;
  return monitor;
}

// The firing filter really reads the formula, not a query.
test("the filter targets the replica_shortfall formula", () => {
  expect(unhealthyFilter.checkOn).toBe(CheckOn.MetricValue);
  expect(unhealthyFilter.metricMonitorOptions?.metricAlias).toBe(
    "replica_shortfall",
  );
});
