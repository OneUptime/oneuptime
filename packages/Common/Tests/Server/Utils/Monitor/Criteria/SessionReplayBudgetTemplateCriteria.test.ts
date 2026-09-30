/*
 * MonitorCriteriaEvaluator reaches the template renderer, which loads the
 * native isolated-vm addon. Nothing here uses the sandbox and the prebuilt
 * binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MonitorCriteriaEvaluator from "../../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import AggregateModel from "../../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../../Types/BaseDatabase/AggregatedResult";
import { JSONObject } from "../../../../../Types/JSON";
import MetricsViewConfig from "../../../../../Types/Metrics/MetricsViewConfig";
import { NoDataPolicy } from "../../../../../Types/Monitor/CriteriaFilter";
import MetricMonitorResponse from "../../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteriaInstance from "../../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary, {
  MonitorEvaluationCriteriaResult,
} from "../../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../../Types/Monitor/MonitorType";
import {
  RumAlertTemplate,
  getRumAlertTemplateById,
} from "../../../../../Types/Monitor/RumAlertTemplates";
import ObjectID from "../../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../../Types/Probe/ProbeApiIngestResponse";
import SessionReplayBudgetMetricTypeUtil from "../../../../../Utils/SessionReplay/SessionReplayBudgetMetricType";
import SessionReplayBudgetMetricType from "../../../../../Types/Rum/SessionReplayBudgetMetricType";
import { describe, expect, test } from "@jest/globals";

/*
 * The session replay budget templates, evaluated the way the worker evaluates
 * them: the template's OWN step and criteria, through
 * MonitorCriteriaEvaluator.processMonitorStep - the entry point
 * MonitorResource calls with the telemetry monitor's response - fed the
 * per-minute samples the metric query returns for a window.
 *
 * The shape tests pin what the templates say; these pin what that shape DOES:
 *
 *   - a crossing fires the breach criteria (80 the Warning, 100 the Critical);
 *   - a window that crossed at any point still fires, however low the rest of
 *     it is - MaximumValue, where the evaluator's fallback (All Values, what a
 *     filter gets with no metricAlias) would wait for every point to cross;
 *   - a window entirely below the threshold meets Healthy, which recovers;
 *   - an empty window - the sweep posts nothing for zero usage, or when it
 *     cannot read the counters - meets NEITHER, which is how an open alert
 *     resolves after midnight when nothing more is uploaded, rather than
 *     staying open on stale data.
 */

const DAILY_NEARLY_SPENT: string =
  "rum-session-replay-daily-budget-nearly-spent";
const DAILY_SPENT: string = "rum-session-replay-daily-budget-spent";
const MONTHLY_NEARLY_SPENT: string =
  "rum-session-replay-monthly-budget-nearly-spent";
const MONTHLY_SPENT: string = "rum-session-replay-monthly-budget-spent";

const RUM_APPLICATION_ID: ObjectID = ObjectID.generate();

// The minute the newest sample lands on; older samples go back one minute each.
const WINDOW_END: Date = new Date("2026-09-29T12:00:00.000Z");

function getTemplate(id: string): RumAlertTemplate {
  const template: RumAlertTemplate | undefined = getRumAlertTemplateById(id);

  if (!template) {
    throw new Error(`Missing RUM template ${id}`);
  }

  return template;
}

function buildTemplateStep(templateId: string): MonitorStep {
  return getTemplate(templateId).getMonitorStep({
    rumApplicationId: RUM_APPLICATION_ID.toString(),
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Storefront",
  });
}

function getCriteriaInstances(
  step: MonitorStep,
): Array<MonitorCriteriaInstance> {
  return step.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || [];
}

/*
 * What monitorMetric hands the evaluator for this step: one aggregated result
 * per query (the template has one), a sample per minute, already in the
 * query's legend unit, and the unit the sweep registered for the series.
 */
function buildResponse(input: {
  step: MonitorStep;
  samples: Array<number>;
}): MetricMonitorResponse {
  const metricViewConfig: MetricsViewConfig =
    input.step.data!.metricMonitor!.metricViewConfig;
  const metricName: SessionReplayBudgetMetricType = metricViewConfig
    .queryConfigs[0]!.metricQueryData.filterData
    .metricName as SessionReplayBudgetMetricType;

  const aggregated: AggregatedResult = {
    data: input.samples.map((value: number, index: number) => {
      return {
        timestamp: new Date(
          WINDOW_END.getTime() - (input.samples.length - 1 - index) * 60000,
        ),
        value: value,
      } as AggregateModel;
    }),
  };

  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    metricResult: [aggregated],
    metricViewConfig: metricViewConfig,
    nativeUnitsByMetricName: {
      [metricName.toLowerCase()]:
        SessionReplayBudgetMetricTypeUtil.getUnit(metricName),
    },
  } as unknown as MetricMonitorResponse;
}

interface Evaluation {
  response: ProbeApiIngestResponse;
  summary: MonitorEvaluationSummary;
  breach: MonitorCriteriaInstance;
  healthy: MonitorCriteriaInstance;
}

async function evaluate(input: {
  step: MonitorStep;
  samples: Array<number>;
}): Promise<Evaluation> {
  const monitor: Monitor = new Monitor();
  monitor._id = ObjectID.generate().toString();
  monitor.projectId = ObjectID.generate();
  monitor.monitorType = MonitorType.Metrics;
  monitor.name = "Storefront - Session Replay Budget";

  const summary: MonitorEvaluationSummary = {
    evaluatedAt: WINDOW_END,
    criteriaResults: [],
    events: [],
  };

  const response: ProbeApiIngestResponse =
    await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: buildResponse(input),
      monitorStep: input.step,
      monitor: monitor,
      probeApiIngestResponse: {
        monitorId: monitor.id!,
        rootCause: null,
      },
      evaluationSummary: summary,
    });

  const [breach, healthy]: Array<MonitorCriteriaInstance> =
    getCriteriaInstances(input.step);

  return {
    response: response,
    summary: summary,
    breach: breach!,
    healthy: healthy!,
  };
}

async function evaluateTemplate(
  templateId: string,
  samples: Array<number>,
): Promise<Evaluation> {
  return await evaluate({
    step: buildTemplateStep(templateId),
    samples: samples,
  });
}

function criteriaResultFor(
  evaluation: Evaluation,
  criteria: MonitorCriteriaInstance,
): MonitorEvaluationCriteriaResult | undefined {
  return evaluation.summary.criteriaResults.find(
    (result: MonitorEvaluationCriteriaResult) => {
      return result.criteriaId === criteria.data?.id;
    },
  );
}

type Outcome = "breach" | "healthy" | "neither";

function outcomeOf(evaluation: Evaluation): Outcome {
  if (evaluation.response.criteriaMetId === evaluation.breach.data?.id) {
    return "breach";
  }

  if (evaluation.response.criteriaMetId === evaluation.healthy.data?.id) {
    return "healthy";
  }

  expect(evaluation.response.criteriaMetId).toBeUndefined();

  return "neither";
}

describe("session replay budget templates, through the real criteria evaluation", () => {
  describe("the project's daily budget", () => {
    test("[79.99] does not breach the 80% Warning, and reads as Healthy", async () => {
      const evaluation: Evaluation = await evaluateTemplate(
        DAILY_NEARLY_SPENT,
        [79.99],
      );

      expect(outcomeOf(evaluation)).toBe("healthy");
      expect(criteriaResultFor(evaluation, evaluation.breach)?.met).toBe(false);
      expect(criteriaResultFor(evaluation, evaluation.healthy)?.met).toBe(true);
    });

    test("[80] fires the daily Warning", async () => {
      const evaluation: Evaluation = await evaluateTemplate(
        DAILY_NEARLY_SPENT,
        [80],
      );

      expect(getTemplate(DAILY_NEARLY_SPENT).severity).toBe("Warning");
      expect(outcomeOf(evaluation)).toBe("breach");
      expect(evaluation.response.rootCause).toContain(
        "Session Replay Daily Budget Nearly Spent - 80% or more used",
      );
    });

    test("[99.99] does not fire the Critical: rounded down, 100 means spent", async () => {
      expect(outcomeOf(await evaluateTemplate(DAILY_SPENT, [99.99]))).toBe(
        "healthy",
      );
    });

    test("[100] fires the daily Critical, and the Warning with it", async () => {
      const critical: Evaluation = await evaluateTemplate(DAILY_SPENT, [100]);

      expect(getTemplate(DAILY_SPENT).severity).toBe("Critical");
      expect(outcomeOf(critical)).toBe("breach");
      expect(critical.response.rootCause).toContain(
        "Session Replay Daily Budget Spent - 100% used",
      );

      expect(outcomeOf(await evaluateTemplate(DAILY_NEARLY_SPENT, [100]))).toBe(
        "breach",
      );
    });

    /*
     * The budget reset at midnight, or a budget was raised: the window still
     * holds the crossing point next to newer, far lower ones. It stays open
     * until the crossing point has left the window.
     */
    test("[100, 5] still breaches: MaximumValue reads the crossing point", async () => {
      for (const templateId of [DAILY_NEARLY_SPENT, DAILY_SPENT]) {
        expect(outcomeOf(await evaluateTemplate(templateId, [100, 5]))).toBe(
          "breach",
        );
        expect(outcomeOf(await evaluateTemplate(templateId, [5, 100]))).toBe(
          "breach",
        );
      }
    });

    test("[5] meets Healthy", async () => {
      for (const templateId of [DAILY_NEARLY_SPENT, DAILY_SPENT]) {
        const evaluation: Evaluation = await evaluateTemplate(templateId, [5]);

        expect(outcomeOf(evaluation)).toBe("healthy");
        expect(evaluation.response.rootCause).toContain("Healthy");
      }
    });

    /*
     * No point in the window: zero usage (the sweep writes nothing at 0), or
     * counters the sweep could not read. Neither criteria is met - never a
     * breach from missing data, and not Healthy either.
     */
    test("[] meets neither criteria", async () => {
      for (const templateId of [DAILY_NEARLY_SPENT, DAILY_SPENT]) {
        const evaluation: Evaluation = await evaluateTemplate(templateId, []);

        expect(outcomeOf(evaluation)).toBe("neither");
        expect(evaluation.response.rootCause).toBeNull();
        expect(criteriaResultFor(evaluation, evaluation.breach)?.met).toBe(
          false,
        );
        expect(criteriaResultFor(evaluation, evaluation.healthy)?.met).toBe(
          false,
        );
      }
    });
  });

  /*
   * Every template, at and around its own threshold. A budget lowered below
   * what is already used reads over 100, which is still spent.
   */
  describe.each([
    { templateId: DAILY_NEARLY_SPENT, threshold: 80 },
    { templateId: DAILY_SPENT, threshold: 100 },
    { templateId: MONTHLY_NEARLY_SPENT, threshold: 80 },
    { templateId: MONTHLY_SPENT, threshold: 100 },
  ])("$templateId", (item: { templateId: string; threshold: number }) => {
    test.each([
      { samples: [item.threshold - 0.01], outcome: "healthy" },
      { samples: [item.threshold], outcome: "breach" },
      { samples: [item.threshold + 0.01], outcome: "breach" },
      { samples: [250], outcome: "breach" },
      { samples: [1, 2, 3, item.threshold, 4], outcome: "breach" },
      { samples: [item.threshold, 5], outcome: "breach" },
      {
        samples: [item.threshold - 1, item.threshold - 1, item.threshold - 1],
        outcome: "healthy",
      },
      { samples: [0], outcome: "healthy" },
      { samples: [5], outcome: "healthy" },
      { samples: [], outcome: "neither" },
    ] as Array<{ samples: Array<number>; outcome: Outcome }>)(
      "$samples -> $outcome",
      async (testCase: { samples: Array<number>; outcome: Outcome }) => {
        expect(
          outcomeOf(await evaluateTemplate(item.templateId, testCase.samples)),
        ).toBe(testCase.outcome);
      },
    );
  });

  /*
   * Why the template passes `metricAlias`: without it no metricMonitorOptions
   * are written, and the same window is judged as All Values - a spent budget
   * sharing its window with one lower point breaches NOTHING and recovers
   * NOTHING, so the alert never opens and an open one never resolves.
   */
  test("without the template's metricMonitorOptions, [100, 5] would meet neither criteria", async () => {
    const step: MonitorStep = buildTemplateStep(DAILY_SPENT);

    for (const instance of getCriteriaInstances(step)) {
      for (const filter of instance.data?.filters || []) {
        delete filter.metricMonitorOptions;
      }
    }

    expect(outcomeOf(await evaluate({ step: step, samples: [100, 5] }))).toBe(
      "neither",
    );
    expect(
      outcomeOf(
        await evaluate({
          step: buildTemplateStep(DAILY_SPENT),
          samples: [100, 5],
        }),
      ),
    ).toBe("breach");
  });

  /*
   * Missing data is never a breach. The templates leave the no-data policy
   * unset, which the evaluator reads as Ignore - the setting the docs tell
   * anyone building their own budget monitor to keep.
   */
  test("leaves the no-data policy at Ignore on both criteria", () => {
    for (const templateId of [
      DAILY_NEARLY_SPENT,
      DAILY_SPENT,
      MONTHLY_NEARLY_SPENT,
      MONTHLY_SPENT,
    ]) {
      const instances: Array<MonitorCriteriaInstance> = getCriteriaInstances(
        buildTemplateStep(templateId),
      );

      // The breach and Healthy criteria, each with its options written.
      expect(instances).toHaveLength(2);

      for (const instance of instances) {
        expect(instance.data?.filters[0]?.metricMonitorOptions).toBeDefined();

        const policy: NoDataPolicy | undefined =
          instance.data?.filters[0]?.metricMonitorOptions?.onNoDataPolicy;

        expect(policy === undefined || policy === NoDataPolicy.Ignore).toBe(
          true,
        );
      }
    }
  });

  /*
   * A saved monitor is a JSON row. What the worker evaluates is the step
   * read back from it, so the outcome must not depend on having the
   * in-memory object the template built.
   */
  test("evaluates the same once the step has been saved and read back", async () => {
    const restored: MonitorStep = MonitorStep.fromJSON(
      JSON.parse(
        JSON.stringify(buildTemplateStep(MONTHLY_SPENT).toJSON()),
      ) as JSONObject,
    );

    expect(
      outcomeOf(await evaluate({ step: restored, samples: [100, 5] })),
    ).toBe("breach");
    expect(outcomeOf(await evaluate({ step: restored, samples: [5] }))).toBe(
      "healthy",
    );
    expect(outcomeOf(await evaluate({ step: restored, samples: [] }))).toBe(
      "neither",
    );
  });
});
