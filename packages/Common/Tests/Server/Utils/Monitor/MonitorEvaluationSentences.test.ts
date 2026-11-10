import Monitor from "../../../../Models/DatabaseModels/Monitor";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorEvaluationDetailsBuilder from "../../../../Server/Utils/Monitor/MonitorEvaluationDetailsBuilder";
import URL from "../../../../Types/API/URL";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import {
  EvaluationSentence,
  englishOfEvaluationSentence,
  isEvaluationSentence,
  wordStoredEvaluationText,
} from "../../../../Types/Monitor/EvaluationSentence";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationDetails, {
  MonitorEvaluationFilterDetails,
} from "../../../../Types/Monitor/MonitorEvaluationDetails";
import MonitorEvaluationSummary, {
  MonitorEvaluationFilterResult,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import { createTranslator, Translator } from "../../../../Types/Translator";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";
import MonitorRootCauseWording from "../../../../Utils/Monitor/MonitorRootCauseWording";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT AN EVALUATION FOUND, STORED FOR EACH READER'S LANGUAGE (issue #6542).
 *
 * A real evaluation of an API check, through the engine: each filter's
 * finding is stored as the English it always was and as the sentence it
 * was filled from - whose English is exactly that text, so a reader whose
 * language does not word it reads what the server stored - and the
 * incident's evaluation details keep the sentence beside the finding, for
 * its root cause to be read in the reader's language.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const MONITOR_ID: ObjectID = ObjectID.generate();
const CHECKED_AT: Date = new Date("2026-11-10T09:30:00.000Z");

// The words a Chinese reader's locale has for what this check says.
const CHINESE: Record<string, string> = {
  "{{subject}} was {{value}}": "{{subject}}为 {{value}}",
  "{{observation}}, {{comparison}}.": "{{observation}}，{{comparison}}。",
  "above the {{threshold}} threshold": "高于阈值 {{threshold}}",
  "at or above the {{threshold}} threshold": "达到或高于阈值 {{threshold}}",
  "Response body contains {{text}}.": "响应正文包含 {{text}}。",
  "Response Time (in ms) was {{value}} ms": "响应时间为 {{value}} 毫秒",
  "{{description}} condition met.": "{{description}} 条件已满足。",
  "{{check}} {{condition}} {{value}}": "{{check}} {{condition}} {{value}}",
  "Response Time (in ms)": "响应时间（毫秒）",
  "Less Than": "小于",
  "Created because the following criteria was met": "因满足以下条件而创建",
  "Criteria Name": "条件名称",
  "Filter Conditions Met": "满足的筛选条件",
  "All filters met.": "所有筛选条件均已满足。",
  "Request Details": "请求详情",
  "Response Snapshot": "响应快照",
  "Request Method": "请求方法",
  "Response Status Code": "响应状态码",
  "Response Time": "响应时间",
  Destination: "目标",
};

const chinese: Translator = createTranslator((key: string) => {
  return CHINESE[key];
}, "zh-CN");

function criteriaInstance(input: {
  filterCondition: FilterCondition;
  filters: Array<CriteriaFilter>;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.id = "criteria-1";
  instance.data!.name = "Checkout degraded";
  instance.data!.filterCondition = input.filterCondition;
  instance.data!.filters = input.filters;
  instance.data!.createIncidents = false;
  instance.data!.createAlerts = false;
  return instance;
}

function monitorFor(step: MonitorStep): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  monitor.projectId = PROJECT_ID;
  monitor.monitorType = MonitorType.API;
  monitor.name = "Checkout API";

  const steps: MonitorSteps = new MonitorSteps();
  steps.data!.monitorStepsInstanceArray = [step];
  monitor.monitorSteps = steps;

  return monitor;
}

function check(): DataToProcess {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    probeId: ObjectID.generate(),
    isOnline: true,
    responseCode: 503,
    responseTimeInMs: 640,
    responseBody: '{"status":"error","detail":"payments unavailable"}',
    responseHeaders: { "content-type": "application/json" },
    monitorDestination: URL.fromString("https://api.acme.example/v1/health"),
    failureCause: "",
    monitoredAt: CHECKED_AT,
  } as unknown as DataToProcess;
}

interface Evaluated {
  monitor: Monitor;
  step: MonitorStep;
  instance: MonitorCriteriaInstance;
  dataToProcess: DataToProcess;
  summary: MonitorEvaluationSummary;
  rootCause: string | null;
}

async function evaluate(input: {
  filterCondition: FilterCondition;
  filters: Array<CriteriaFilter>;
}): Promise<Evaluated> {
  const instance: MonitorCriteriaInstance = criteriaInstance(input);
  const step: MonitorStep = new MonitorStep();
  step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray = [instance];
  step.data!.monitorDestination = URL.fromString(
    "https://api.acme.example/v1/health",
  );

  const monitor: Monitor = monitorFor(step);
  const dataToProcess: DataToProcess = check();
  const summary: MonitorEvaluationSummary = {
    evaluatedAt: CHECKED_AT,
    criteriaResults: [],
    events: [],
  };

  const response: ProbeApiIngestResponse =
    await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: dataToProcess,
      monitorStep: step,
      monitor: monitor,
      probeApiIngestResponse: {
        monitorId: MONITOR_ID,
        rootCause: null,
      } as ProbeApiIngestResponse,
      evaluationSummary: summary,
    });

  return {
    monitor,
    step,
    instance,
    dataToProcess,
    summary,
    rootCause: response.rootCause || null,
  };
}

function filtersOf(
  summary: MonitorEvaluationSummary,
): Array<MonitorEvaluationFilterResult> {
  return summary.criteriaResults.flatMap(
    (
      result: MonitorEvaluationSummary["criteriaResults"][number],
    ): Array<MonitorEvaluationFilterResult> => {
      return result.filters;
    },
  );
}

// Every stored sentence says, in English, exactly what is stored beside it.
function expectSentencesMatchTheirEnglish(
  filters: Array<MonitorEvaluationFilterResult>,
): void {
  for (const filter of filters) {
    if (filter.messageSentence === undefined) {
      continue;
    }

    expect(isEvaluationSentence(filter.messageSentence)).toBe(true);
    expect(englishOfEvaluationSentence(filter.messageSentence)).toBe(
      filter.message,
    );
  }
}

const STATUS_ABOVE_499: CriteriaFilter = {
  checkOn: CheckOn.ResponseStatusCode,
  filterType: FilterType.GreaterThan,
  value: 499,
};

const BODY_CONTAINS_ERROR: CriteriaFilter = {
  checkOn: CheckOn.ResponseBody,
  filterType: FilterType.Contains,
  value: "error",
};

const FAST_RESPONSE: CriteriaFilter = {
  checkOn: CheckOn.ResponseTime,
  filterType: FilterType.LessThan,
  value: 100,
};

describe("An evaluation stores each finding as a sentence too", () => {
  test("a met filter's finding is stored with the sentence its English is filled from", async () => {
    const evaluated: Evaluated = await evaluate({
      filterCondition: FilterCondition.All,
      filters: [STATUS_ABOVE_499, BODY_CONTAINS_ERROR],
    });
    const filters: Array<MonitorEvaluationFilterResult> = filtersOf(
      evaluated.summary,
    );

    expect(filters).toHaveLength(2);
    expect(
      filters.every((filter: MonitorEvaluationFilterResult) => {
        return filter.met && filter.messageSentence !== undefined;
      }),
    ).toBe(true);
    expectSentencesMatchTheirEnglish(filters);

    // The English the server always stored, unchanged.
    expect(filters[0]!.message).toBe(
      "Response Status Code was 503, above the 499 threshold.",
    );
    expect(filters[1]!.message).toBe("Response body contains error.");
  });

  test("a filter that was not met is stored with its sentence too", async () => {
    const evaluated: Evaluated = await evaluate({
      filterCondition: FilterCondition.Any,
      filters: [FAST_RESPONSE],
    });
    const filters: Array<MonitorEvaluationFilterResult> = filtersOf(
      evaluated.summary,
    );

    expect(filters).toHaveLength(1);
    expect(filters[0]!.met).toBe(false);
    expect(filters[0]!.messageSentence).toBeDefined();
    expectSentencesMatchTheirEnglish(filters);
    expect(filters[0]!.message).toBe(
      "Response Time (in ms) Less Than 100 did not satisfy the configured condition (to be less than 100).",
    );
  });

  test("a reader in Chinese reads a finding their language words in Chinese", async () => {
    const evaluated: Evaluated = await evaluate({
      filterCondition: FilterCondition.All,
      filters: [STATUS_ABOVE_499, BODY_CONTAINS_ERROR],
    });
    const filters: Array<MonitorEvaluationFilterResult> = filtersOf(
      evaluated.summary,
    );

    expect(
      filters.map((filter: MonitorEvaluationFilterResult) => {
        return wordStoredEvaluationText({
          english: filter.message,
          sentence: filter.messageSentence,
          translator: chinese,
        });
      }),
    ).toEqual(["响应状态码为 503，高于阈值 499。", "响应正文包含 error。"]);
  });

  test("a finding whose sentence their language words only in part reads in English", async () => {
    const evaluated: Evaluated = await evaluate({
      filterCondition: FilterCondition.Any,
      filters: [FAST_RESPONSE],
    });
    const filter: MonitorEvaluationFilterResult = filtersOf(
      evaluated.summary,
    )[0]!;

    // "to be less than {{value}}" has no Chinese here: all of it is English.
    expect(
      wordStoredEvaluationText({
        english: filter.message,
        sentence: filter.messageSentence,
        translator: chinese,
      }),
    ).toBe(filter.message);
  });
});

describe("An incident's evaluation details keep each finding's sentence", () => {
  test("beside the whole finding", async () => {
    const evaluated: Evaluated = await evaluate({
      filterCondition: FilterCondition.All,
      filters: [STATUS_ABOVE_499, BODY_CONTAINS_ERROR],
    });

    const details: MonitorEvaluationDetails | null =
      await MonitorEvaluationDetailsBuilder.build({
        monitor: evaluated.monitor,
        monitorStep: evaluated.step,
        criteriaInstance: evaluated.instance,
        evaluationSummary: evaluated.summary,
        dataToProcess: evaluated.dataToProcess,
      });

    expect(details).not.toBeNull();

    for (const filter of details!.filters) {
      expect(filter.messageSentence).toBeDefined();
      expect(
        englishOfEvaluationSentence(
          filter.messageSentence as EvaluationSentence,
        ),
      ).toBe(filter.message);
    }
  });

  test("never beside a finding cut to fit the record", () => {
    const filter: MonitorEvaluationFilterDetails = {
      checkOn: CheckOn.ResponseBody,
      met: true,
      message: "x".repeat(1000),
      messageSentence: { template: "{{text}}", values: { text: "x" } },
      actual: "y".repeat(20000),
    };
    const details: MonitorEvaluationDetails = {
      version: 1,
      evaluatedAt: CHECKED_AT,
      criteriaName: "Checkout degraded",
      filters: [filter, { ...filter }, { ...filter }],
    } as MonitorEvaluationDetails;

    const fitted: MonitorEvaluationDetails =
      MonitorEvaluationDetailsBuilder.fitToSizeLimit(details, 8 * 1024);

    expect(fitted.isTrimmedToSizeLimit).toBe(true);

    for (const fittedFilter of fitted.filters) {
      expect(fittedFilter.message.length).toBeLessThan(1000);
      expect(fittedFilter.messageSentence).toBeUndefined();
    }
  });
});

describe("A root cause a monitor wrote reads in the reader's language", () => {
  async function rootCauseAndDetails(): Promise<{
    rootCause: string;
    details: MonitorEvaluationDetails;
  }> {
    const evaluated: Evaluated = await evaluate({
      filterCondition: FilterCondition.All,
      filters: [STATUS_ABOVE_499, BODY_CONTAINS_ERROR],
    });

    const details: MonitorEvaluationDetails | null =
      await MonitorEvaluationDetailsBuilder.build({
        monitor: evaluated.monitor,
        monitorStep: evaluated.step,
        criteriaInstance: evaluated.instance,
        evaluationSummary: evaluated.summary,
        dataToProcess: evaluated.dataToProcess,
      });

    return { rootCause: evaluated.rootCause!, details: details! };
  }

  test("its labels and its findings, the rest as written", async () => {
    const { rootCause, details } = await rootCauseAndDetails();

    const worded: string = MonitorRootCauseWording.wordRootCause({
      rootCause: rootCause,
      translator: chinese,
      findings: details.filters,
    });

    expect(worded).toContain("**因满足以下条件而创建**:");
    expect(worded).toContain("**条件名称**: Checkout degraded");
    expect(worded).toContain("**满足的筛选条件**: 所有筛选条件均已满足。");
    expect(worded).toContain("- 响应状态码为 503，高于阈值 499。");
    expect(worded).toContain("- 响应正文包含 error。");
    expect(worded).toContain("**请求详情**");
    expect(worded).toContain("- 目标: https://api.acme.example/v1/health");
    expect(worded).toContain("- 请求方法: GET");

    // Nothing of OneUptime's own English is left in what was worded.
    expect(worded).not.toContain("Created because");
    expect(worded).not.toContain("Filter Conditions Met");
    expect(worded).not.toContain("Response Status Code was");
  });

  test("is as stored for an English reader", async () => {
    const { rootCause, details } = await rootCauseAndDetails();

    expect(
      MonitorRootCauseWording.wordRootCause({
        rootCause: rootCause,
        translator: createTranslator(undefined, "en"),
        findings: details.filters,
      }),
    ).toBe(rootCause);
  });

  test("words its labels without the evaluation details", async () => {
    const { rootCause } = await rootCauseAndDetails();

    const worded: string = MonitorRootCauseWording.wordRootCause({
      rootCause: rootCause,
      translator: chinese,
    });

    expect(worded).toContain("**满足的筛选条件**: 所有筛选条件均已满足。");
    // Without their sentences, the findings read as the engine wrote them.
    expect(worded).toContain(
      "- Response Status Code was 503, above the 499 threshold.",
    );
  });

  test("never words a label somebody wrote that is not OneUptime's", () => {
    const written: string =
      "**Our notes**: the deploy at 09:00 broke it\n- Owner: payments team\n**Cause**: bad config";

    expect(
      MonitorRootCauseWording.wordRootCause({
        rootCause: written,
        translator: createTranslator((key: string) => {
          return key === "Cause" ? "原因" : undefined;
        }, "zh-CN"),
      }),
    ).toBe(
      "**Our notes**: the deploy at 09:00 broke it\n- Owner: payments team\n**原因**: bad config",
    );
  });

  test("a translated label is placed as text, never as Markdown", () => {
    expect(
      MonitorRootCauseWording.wordRootCause({
        rootCause: "**Cause**: timeout",
        translator: createTranslator((key: string) => {
          return key === "Cause" ? "[原因](https://evil.example)" : undefined;
        }, "zh-CN"),
      }),
    ).toBe("**\\[原因\\](https://evil.example)**: timeout");
  });

  test("reads a long root cause line by line, in linear time", () => {
    const long: string = `**${"a".repeat(100000)}`;
    const rootCause: string = `${long}\n- ${"b".repeat(100000)}: x`;
    const timed: FastestRun<string> = fastestRun({
      run: (): string => {
        return MonitorRootCauseWording.wordRootCause({
          rootCause: rootCause,
          translator: chinese,
        });
      },
      limitInMs: 1000,
    });

    expect(timed.inMs).toBeLessThan(1000);
    // Neither line is one OneUptime wrote: both read as written.
    expect(timed.result).toBe(rootCause);
  });
});
