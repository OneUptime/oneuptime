/*
 * MonitorCriteriaEvaluator reaches the template renderer, which loads the
 * native isolated-vm addon. Nothing here uses the sandbox.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import LlmMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/LlmMonitorCriteria";
import MonitorCriteriaEvaluator from "../../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorCriteriaDataExtractor from "../../../../../Server/Utils/Monitor/MonitorCriteriaDataExtractor";
import MonitorCriteriaObservationBuilder from "../../../../../Server/Utils/Monitor/MonitorCriteriaObservationBuilder";
import DataToProcess from "../../../../../Server/Utils/Monitor/DataToProcess";
import FilterCondition from "../../../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import LlmMonitorResponse, {
  LlmMonitorResponseUtil,
} from "../../../../../Types/Monitor/LlmMonitor/LlmMonitorResponse";
import LlmMonitorTemplates, {
  LlmMonitorTemplate,
  LlmMonitorTemplateFilter,
  LlmMonitorTemplateId,
} from "../../../../../Types/Monitor/LlmMonitor/LlmMonitorTemplates";
import MonitorCriteria from "../../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "../../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../../Types/Monitor/MonitorStep";
import { MonitorStepLlmMonitorUtil } from "../../../../../Types/Monitor/MonitorStepLlmMonitor";
import MonitorType from "../../../../../Types/Monitor/MonitorType";
import TraceMonitorResponse from "../../../../../Types/Monitor/TraceMonitor/TraceMonitorResponse";
import ObjectID from "../../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../../Types/Probe/ProbeApiIngestResponse";
import { LlmAnswerIssue } from "../../../../../Types/Telemetry/LlmAnswerIssue";
import { describe, expect, test } from "@jest/globals";

/*
 * What turns one AI / LLM check - the answers in a window and how many were
 * bad - into a verdict: the three numbers the criteria compare, the default
 * criteria pair a new AI / LLM monitor ships, and every ready-made alert on
 * the Alerts tab, each run through the same evaluator the worker uses.
 */

function response(answerCount: number, badAnswerCount: number): DataToProcess {
  const llm: LlmMonitorResponse = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    llmAnswerCount: answerCount,
    llmBadAnswerCount: badAnswerCount,
    llmBadAnswerPercent: LlmMonitorResponseUtil.getBadAnswerPercent({
      answerCount,
      badAnswerCount,
    }),
    llmSpanQuery: { isLlmSpan: true },
  };

  return llm as DataToProcess;
}

function evaluate(
  data: DataToProcess,
  filter: CriteriaFilter,
): Promise<string | null> {
  return LlmMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: data,
    criteriaFilter: filter,
  });
}

describe("LlmMonitorCriteria: the three numbers", () => {
  test.each([
    // checkOn, filterType, threshold, answers, bad, met
    [CheckOn.LlmBadAnswerPercent, FilterType.GreaterThan, 5, 200, 15, true],
    [CheckOn.LlmBadAnswerPercent, FilterType.GreaterThan, 5, 200, 10, false],
    [CheckOn.LlmBadAnswerPercent, FilterType.GreaterThanOrEqualTo, 5, 200, 10, true],
    [CheckOn.LlmBadAnswerPercent, FilterType.LessThanOrEqualTo, 5, 200, 10, true],
    [CheckOn.LlmBadAnswerPercent, FilterType.LessThan, 5, 200, 10, false],
    [CheckOn.LlmBadAnswerPercent, FilterType.EqualTo, 0, 50, 0, true],
    [CheckOn.LlmBadAnswerCount, FilterType.GreaterThanOrEqualTo, 3, 10, 3, true],
    [CheckOn.LlmBadAnswerCount, FilterType.GreaterThanOrEqualTo, 3, 10, 2, false],
    [CheckOn.LlmBadAnswerCount, FilterType.LessThan, 3, 10, 2, true],
    [CheckOn.LlmBadAnswerCount, FilterType.NotEqualTo, 0, 10, 1, true],
    [CheckOn.LlmAnswerCount, FilterType.EqualTo, 0, 0, 0, true],
    [CheckOn.LlmAnswerCount, FilterType.EqualTo, 0, 3, 0, false],
    [CheckOn.LlmAnswerCount, FilterType.GreaterThan, 0, 3, 0, true],
    [CheckOn.LlmAnswerCount, FilterType.LessThan, 100, 99, 0, true],
  ])(
    "%s %s %p with %p answers, %p bad: met %p",
    async (
      checkOn: CheckOn,
      filterType: FilterType,
      threshold: number,
      answers: number,
      bad: number,
      met: boolean,
    ) => {
      const result: string | null = await evaluate(response(answers, bad), {
        checkOn,
        filterType,
        value: threshold,
      });

      expect(Boolean(result)).toBe(met);
    },
  );

  test("a share threshold keeps its decimals ('2.5' is not 2)", async () => {
    // 2.2% of answers: above 2, below 2.5.
    const data: DataToProcess = response(1000, 22);

    expect(
      await evaluate(data, {
        checkOn: CheckOn.LlmBadAnswerPercent,
        filterType: FilterType.GreaterThan,
        value: "2.5",
      }),
    ).toBeNull();

    expect(
      await evaluate(data, {
        checkOn: CheckOn.LlmBadAnswerPercent,
        filterType: FilterType.GreaterThan,
        value: "2",
      }),
    ).toBeTruthy();
  });

  test.each([[undefined], [""], ["  "], ["many"], [Number.NaN]])(
    "a threshold of %p meets nothing",
    async (value: unknown) => {
      expect(
        await evaluate(response(10, 10), {
          checkOn: CheckOn.LlmBadAnswerCount,
          filterType: FilterType.GreaterThan,
          value: value as number,
        }),
      ).toBeNull();
    },
  );

  test("a check-on of another monitor meets nothing", async () => {
    expect(
      await evaluate(response(10, 10), {
        checkOn: CheckOn.SpanCount,
        filterType: FilterType.GreaterThan,
        value: 0,
      }),
    ).toBeNull();
  });

  test("another monitor's payload meets nothing", async () => {
    const trace: TraceMonitorResponse = {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      spanCount: 50,
      spanQuery: {},
    };

    expect(
      await evaluate(trace as DataToProcess, {
        checkOn: CheckOn.LlmBadAnswerCount,
        filterType: FilterType.GreaterThan,
        value: 0,
      }),
    ).toBeNull();
  });

  test("the message names the number and the threshold", async () => {
    const message: string | null = await evaluate(response(200, 15), {
      checkOn: CheckOn.LlmBadAnswerPercent,
      filterType: FilterType.GreaterThan,
      value: 5,
    });

    expect(message).toContain("Bad AI Answers (in %)");
    expect(message).toContain("7.5");
    expect(message).toContain("5");
  });
});

describe("reading an AI / LLM check's payload", () => {
  test("is recognised by its own marker field", () => {
    expect(
      MonitorCriteriaDataExtractor.getLlmMonitorResponse(response(4, 1)),
    ).not.toBeNull();
  });

  test("no other payload is taken for one", () => {
    const trace: TraceMonitorResponse = {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      spanCount: 50,
      spanQuery: {},
    };

    expect(
      MonitorCriteriaDataExtractor.getLlmMonitorResponse(
        trace as DataToProcess,
      ),
    ).toBeNull();
    expect(
      MonitorCriteriaDataExtractor.getTraceMonitorResponse(response(4, 1)),
    ).toBeNull();
  });

  test.each([
    [120, 9, "9 of 120 AI answers were bad (7.5%)."],
    [1, 1, "1 of 1 AI answer was bad (100%)."],
    [0, 0, "The AI gave no answers in the window."],
  ])(
    "%p answers with %p bad reads %p",
    (answers: number, bad: number, sentence: string) => {
      expect(
        MonitorCriteriaObservationBuilder.describeLlmAnswersObservation({
          dataToProcess: response(answers, bad),
        }),
      ).toBe(sentence);
    },
  );
});

const ONLINE: ObjectID = ObjectID.generate();
const OFFLINE: ObjectID = ObjectID.generate();

function monitorOfType(): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = ObjectID.generate().toString();
  monitor.projectId = ObjectID.generate();
  monitor.monitorType = MonitorType.Llm;
  monitor.name = "Support bot";
  return monitor;
}

function stepWith(criteria: MonitorCriteria): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.setLlmMonitor(MonitorStepLlmMonitorUtil.getDefault());
  step.data!.monitorCriteria = criteria;
  return step;
}

async function run(
  criteria: MonitorCriteria,
  data: DataToProcess,
): Promise<ProbeApiIngestResponse> {
  const monitor: Monitor = monitorOfType();

  return await MonitorCriteriaEvaluator.processMonitorStep({
    dataToProcess: data,
    monitorStep: stepWith(criteria),
    monitor,
    probeApiIngestResponse: { monitorId: monitor.id!, rootCause: null },
    evaluationSummary: {
      criteriaResults: [],
      events: [],
    } as unknown as MonitorEvaluationSummary,
  });
}

describe("a new AI / LLM monitor's default criteria", () => {
  const criteria: MonitorCriteria = MonitorCriteria.getDefaultMonitorCriteria({
    monitorType: MonitorType.Llm,
    monitorName: "Support bot",
    onlineMonitorStatusId: ONLINE,
    offlineMonitorStatusId: OFFLINE,
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
  });

  const [unhealthy, healthy] = criteria.data!.monitorCriteriaInstanceArray as [
    MonitorCriteriaInstance,
    MonitorCriteriaInstance,
  ];

  test("are the unhealthy criteria first, then the healthy one", () => {
    expect(criteria.data!.monitorCriteriaInstanceArray).toHaveLength(2);
    expect(unhealthy.data!.monitorStatusId).toEqual(OFFLINE);
    expect(healthy.data!.monitorStatusId).toEqual(ONLINE);
    expect(
      MonitorCriteria.getValidationError(criteria, MonitorType.Llm),
    ).toBeNull();
  });

  test("the unhealthy one raises an alert that resolves itself, not an incident", () => {
    expect(unhealthy.data!.createAlerts).toBe(true);
    expect(unhealthy.data!.createIncidents).toBe(false);
    expect(unhealthy.data!.alerts[0]?.autoResolveAlert).toBe(true);
    // The incident is filled in, ready to switch on.
    expect(unhealthy.data!.incidents[0]?.title).toContain(
      "the AI is answering badly",
    );
  });

  test.each([
    // answers, bad, which one wins
    [200, 15, "unhealthy"],
    [10, 3, "unhealthy"],
    [200, 10, "healthy"],
    // One bad answer out of two pages nobody: the floor of 3.
    [2, 1, "healthy"],
    [2, 2, "healthy"],
    // Quiet is not broken.
    [0, 0, "healthy"],
  ])(
    "%p answers with %p bad: the %s criteria is met",
    async (answers: number, bad: number, winner: string) => {
      const result: ProbeApiIngestResponse = await run(
        criteria,
        response(answers, bad),
      );

      expect(result.criteriaMetId).toBe(
        winner === "unhealthy" ? unhealthy.data!.id : healthy.data!.id,
      );
    },
  );

  test("the root cause says how many answers were bad", async () => {
    const result: ProbeApiIngestResponse = await run(
      criteria,
      response(200, 15),
    );

    expect(result.rootCause).toContain("Bad AI Answers");
  });
});

/*
 * Every ready-made alert: its unhealthy criteria (all filters) and its
 * healthy one (any filter) are complements, so each check lands on exactly
 * one of them - a monitor never sits in a status no check explains.
 */
function meets(
  filters: Array<LlmMonitorTemplateFilter>,
  condition: FilterCondition,
  answers: number,
  bad: number,
): Promise<boolean> {
  return Promise.all(
    filters.map((filter: LlmMonitorTemplateFilter) => {
      return evaluate(response(answers, bad), {
        checkOn: filter.checkOn,
        filterType: filter.filterType,
        value: filter.value,
      });
    }),
  ).then((results: Array<string | null>) => {
    return condition === FilterCondition.All
      ? results.every(Boolean)
      : results.some(Boolean);
  });
}

const GRID: Array<[number, number]> = [];

for (const answers of [0, 1, 2, 3, 5, 10, 20, 30, 100, 1000]) {
  for (const bad of [0, 1, 2, 3, 4, 5, 10, 50, 100]) {
    if (bad <= answers) {
      GRID.push([answers, bad]);
    }
  }
}

describe("the ready-made AI alerts", () => {
  test("there are seven, each with its own id", () => {
    const ids: Array<string> = LlmMonitorTemplates.getAll().map(
      (template: LlmMonitorTemplate): string => {
        return template.id;
      },
    );

    expect(ids).toEqual(Object.values(LlmMonitorTemplateId));
    expect(new Set(ids).size).toBe(7);
  });

  test.each(LlmMonitorTemplates.getAll().map((t: LlmMonitorTemplate) => [t.id, t]))(
    "%s: every check lands on exactly one of its two criteria",
    async (_id: string, template: LlmMonitorTemplate) => {
      for (const [answers, bad] of GRID) {
        const unhealthy: boolean = await meets(
          template.unhealthyFilters,
          FilterCondition.All,
          answers,
          bad,
        );
        const healthy: boolean = await meets(
          template.healthyFilters,
          FilterCondition.Any,
          answers,
          bad,
        );

        expect({ answers, bad, unhealthy, healthy }).toEqual({
          answers,
          bad,
          unhealthy: !healthy,
          healthy,
        });
      }
    },
  );

  test.each([
    [LlmMonitorTemplateId.BadAnswers, 200, 15, true],
    [LlmMonitorTemplateId.BadAnswers, 200, 5, false],
    [LlmMonitorTemplateId.FailedCalls, 20, 3, true],
    [LlmMonitorTemplateId.FailedCalls, 100, 5, false],
    [LlmMonitorTemplateId.Refusals, 40, 3, true],
    [LlmMonitorTemplateId.CutOffAnswers, 1000, 3, true],
    [LlmMonitorTemplateId.CutOffAnswers, 1000, 2, false],
    [LlmMonitorTemplateId.FlaggedAnswers, 1000, 1, true],
    [LlmMonitorTemplateId.FlaggedAnswers, 1000, 0, false],
    [LlmMonitorTemplateId.SlowAnswers, 20, 3, true],
    [LlmMonitorTemplateId.NoAnswers, 0, 0, true],
    [LlmMonitorTemplateId.NoAnswers, 1, 0, false],
  ])(
    "%s with %p answers, %p bad: alerts %p",
    async (
      id: LlmMonitorTemplateId,
      answers: number,
      bad: number,
      alerts: boolean,
    ) => {
      const template: LlmMonitorTemplate = LlmMonitorTemplates.get(id)!;

      expect(
        await meets(template.unhealthyFilters, FilterCondition.All, answers, bad),
      ).toBe(alerts);
    },
  );

  test("each counts what its card promises", () => {
    expect(LlmMonitorTemplates.get(LlmMonitorTemplateId.BadAnswers)!.step.issues).toHaveLength(5);
    expect(
      LlmMonitorTemplates.get(LlmMonitorTemplateId.FailedCalls)!.step,
    ).toMatchObject({ issues: [LlmAnswerIssue.Failed], lastXSecondsOfCalls: 300 });
    expect(
      LlmMonitorTemplates.get(LlmMonitorTemplateId.Refusals)!.step,
    ).toMatchObject({ issues: [LlmAnswerIssue.Refused], lastXSecondsOfCalls: 1800 });
    expect(
      LlmMonitorTemplates.get(LlmMonitorTemplateId.CutOffAnswers)!.step.issues,
    ).toEqual([LlmAnswerIssue.CutOff]);
    expect(
      LlmMonitorTemplates.get(LlmMonitorTemplateId.FlaggedAnswers)!.step.issues,
    ).toEqual([LlmAnswerIssue.Flagged]);
    expect(
      LlmMonitorTemplates.get(LlmMonitorTemplateId.SlowAnswers)!.step,
    ).toMatchObject({ issues: [], slowAnswerSeconds: 30 });
    expect(
      LlmMonitorTemplates.get(LlmMonitorTemplateId.NoAnswers)!.unhealthyFilters,
    ).toEqual([
      { checkOn: CheckOn.LlmAnswerCount, filterType: FilterType.EqualTo, value: 0 },
    ]);
  });

  test("failures and silence are critical; the rest are warnings", () => {
    const critical: Array<string> = LlmMonitorTemplates.getAll()
      .filter((template: LlmMonitorTemplate): boolean => {
        return template.severity === "Critical";
      })
      .map((template: LlmMonitorTemplate): string => {
        return template.id;
      });

    expect(critical.sort()).toEqual(
      [LlmMonitorTemplateId.FailedCalls, LlmMonitorTemplateId.NoAnswers].sort(),
    );
  });

  test("an unknown id is no template", () => {
    expect(LlmMonitorTemplates.get("nope")).toBeNull();
    expect(LlmMonitorTemplates.get(undefined)).toBeNull();
  });

  test("a caller changing its copy never changes the table", () => {
    const copy: LlmMonitorTemplate = LlmMonitorTemplates.get(
      LlmMonitorTemplateId.Refusals,
    )!;
    copy.step.issues.push(LlmAnswerIssue.Empty);
    copy.unhealthyFilters[0]!.value = 99;

    const fresh: LlmMonitorTemplate = LlmMonitorTemplates.get(
      LlmMonitorTemplateId.Refusals,
    )!;
    expect(fresh.step.issues).toEqual([LlmAnswerIssue.Refused]);
    expect(fresh.unhealthyFilters[0]!.value).toBe(5);
  });

  test("a template's step survives the monitor step's JSON unchanged", () => {
    for (const template of LlmMonitorTemplates.getAll()) {
      expect(
        MonitorStepLlmMonitorUtil.fromJSON(
          MonitorStepLlmMonitorUtil.toJSON(template.step),
        ),
      ).toEqual(template.step);
    }
  });
});
