import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import React from "react";
import { initReactI18next } from "react-i18next";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import {
  EvaluationSentence,
  englishOfEvaluationSentence,
  evaluationTerm,
  translatableSentence,
} from "../../../Types/Monitor/EvaluationSentence";
import MonitorEvaluationSummary, {
  MonitorEvaluationEvent,
  MonitorEvaluationFilterResult,
} from "../../../Types/Monitor/MonitorEvaluationSummary";
import EvaluationLogList from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/EvaluationLogList";
import MonitorRootCauseValue from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/MonitorRootCauseValue";

/*
 * WHAT A MONITOR'S EVALUATION SAYS, IN THE READER'S LANGUAGE (issue #6542).
 *
 * A team reading the Dashboard in Chinese saw the monitor's evaluation log -
 * what each filter found, the probe agreement, the incident it opened - and
 * the incident's root cause in English. The engine now stores each as the
 * sentence it was filled from, beside the English it always stored; the
 * Dashboard words the sentence in the reader's language, and shows the
 * English of anything it has no sentence for, or whose sentence the
 * reader's language does not word whole.
 */

const AT: Date = new Date("2026-11-10T09:30:00.000Z");

const CHINESE: Record<string, string> = {
  "{{observation}}, {{comparison}}.": "{{observation}}，{{comparison}}。",
  "{{subject}} was {{value}}": "{{subject}}为 {{value}}",
  "above the {{threshold}} threshold": "高于阈值 {{threshold}}",
  "Response Status Code": "响应状态码",
  "Probe Agreement Check": "探针一致性检查",
  "Probe agreement reached: {{agreeing}}/{{required}} probes agree ({{active}} active probes total).":
    "已达成探针一致：{{agreeing}}/{{required}} 个探针一致（共 {{active}} 个活动探针）。",
  "Incident created: {{title}}": "已创建事件：{{title}}",
  'Incident triggered from criteria "{{criteria}}".':
    "由条件“{{criteria}}”触发的事件。",
  "{{text}} (Incident {{number}})": "{{text}}（事件 {{number}}）",
  "Created because the following criteria was met": "因满足以下条件而创建",
  "Criteria Name": "条件名称",
  "Filter Conditions Met": "满足的筛选条件",
  Actions: "操作",
  Met: "已满足",
};

const STATUS_FOUND: EvaluationSentence = translatableSentence(
  "{{observation}}, {{comparison}}.",
  {
    observation: translatableSentence("{{subject}} was {{value}}", {
      subject: evaluationTerm("Response Status Code"),
      value: "503",
    }),
    comparison: translatableSentence("above the {{threshold}} threshold", {
      threshold: "499",
    }),
  },
);

const STATUS_FOUND_ENGLISH: string = englishOfEvaluationSentence(STATUS_FOUND);

function filterResult(
  sentence: EvaluationSentence | undefined,
  message: string = STATUS_FOUND_ENGLISH,
): MonitorEvaluationFilterResult {
  const result: MonitorEvaluationFilterResult = {
    checkOn: CheckOn.ResponseStatusCode,
    filterType: FilterType.GreaterThan,
    value: 499,
    met: true,
    message: message,
  };

  if (sentence) {
    result.messageSentence = sentence;
  }

  return result;
}

function sentenceEvent(input: {
  type: MonitorEvaluationEvent["type"];
  title: EvaluationSentence;
  message: EvaluationSentence;
  incidentNumber?: number | undefined;
}): MonitorEvaluationEvent {
  return {
    type: input.type,
    title: englishOfEvaluationSentence(input.title),
    titleSentence: input.title,
    message: englishOfEvaluationSentence(input.message),
    messageSentence: input.message,
    relatedIncidentNumber: input.incidentNumber,
    at: AT,
  };
}

function summaryWith(input: {
  filters: Array<MonitorEvaluationFilterResult>;
  events?: Array<MonitorEvaluationEvent> | undefined;
}): MonitorEvaluationSummary {
  return {
    evaluatedAt: AT,
    criteriaResults: [
      {
        criteriaId: "criteria-1",
        criteriaName: "Website is down",
        filterCondition: FilterCondition.All,
        met: true,
        message: "All filters met.",
        filters: input.filters,
      },
    ],
    events: input.events || [],
  };
}

const PROBE_AGREEMENT: MonitorEvaluationEvent = sentenceEvent({
  type: "probe-agreement",
  title: translatableSentence("Probe Agreement Check"),
  message: translatableSentence(
    "Probe agreement reached: {{agreeing}}/{{required}} probes agree ({{active}} active probes total).",
    { agreeing: "3", required: "2", active: "3" },
  ),
});

const INCIDENT_CREATED: MonitorEvaluationEvent = sentenceEvent({
  type: "incident-created",
  title: translatableSentence("Incident created: {{title}}", {
    title: "Checkout API is down",
  }),
  message: translatableSentence(
    'Incident triggered from criteria "{{criteria}}".',
    { criteria: "Website is down" },
  ),
  incidentNumber: 42,
});

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: {} },
      "zh-CN": { translation: CHINESE },
    },
    interpolation: { escapeValue: false },
  });
});

afterEach(async () => {
  cleanup();
  await readIn("en");
});

describe("the evaluation log in the reader's language", () => {
  test("a filter's finding reads in Chinese, from the sentence stored beside it", async () => {
    await readIn("zh-CN");

    render(
      <EvaluationLogList
        evaluationSummary={summaryWith({
          filters: [filterResult(STATUS_FOUND)],
        })}
      />,
    );

    expect(
      screen.getByText("响应状态码为 503，高于阈值 499。"),
    ).toBeInTheDocument();
    expect(screen.queryByText(STATUS_FOUND_ENGLISH)).not.toBeInTheDocument();
  });

  test("a finding stored without a sentence reads as stored", async () => {
    await readIn("zh-CN");

    render(
      <EvaluationLogList
        evaluationSummary={summaryWith({
          filters: [
            filterResult(
              undefined,
              "Waiting for 15 minutes of data: 2 of 15 minutes so far",
            ),
          ],
        })}
      />,
    );

    expect(
      screen.getByText(
        "Waiting for 15 minutes of data: 2 of 15 minutes so far",
      ),
    ).toBeInTheDocument();
  });

  test("findings with the same English are one row, worded once", async () => {
    await readIn("zh-CN");

    render(
      <EvaluationLogList
        evaluationSummary={summaryWith({
          filters: [filterResult(undefined), filterResult(STATUS_FOUND)],
        })}
      />,
    );

    expect(screen.getAllByTestId("evaluation-filter-result")).toHaveLength(1);
    expect(
      screen.getByText("响应状态码为 503，高于阈值 499。"),
    ).toBeInTheDocument();
  });

  test("the probe agreement and the incident it opened read in Chinese", async () => {
    await readIn("zh-CN");

    render(
      <EvaluationLogList
        evaluationSummary={summaryWith({
          filters: [filterResult(STATUS_FOUND)],
          events: [PROBE_AGREEMENT, INCIDENT_CREATED],
        })}
      />,
    );

    expect(screen.getByText("探针一致性检查")).toBeInTheDocument();
    expect(
      screen.getByText("已达成探针一致：3/2 个探针一致（共 3 个活动探针）。"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("已创建事件：Checkout API is down（事件 #42）"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("由条件“Website is down”触发的事件。（事件 #42）"),
    ).toBeInTheDocument();
  });

  test("an event stored before sentences were reads as stored", async () => {
    await readIn("zh-CN");

    render(
      <EvaluationLogList
        evaluationSummary={summaryWith({
          filters: [],
          events: [
            {
              type: "probe-agreement",
              title: "Probe Agreement Check",
              message:
                "Probe agreement reached: 3/2 probes agree (3 active probes total).",
              at: AT,
            },
          ],
        })}
      />,
    );

    // The title is a key of its own: the list's translateText never ran on it.
    expect(screen.getByText("Probe Agreement Check")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Probe agreement reached: 3/2 probes agree (3 active probes total).",
      ),
    ).toBeInTheDocument();
  });

  test("an English reader reads what the server stored", async () => {
    render(
      <EvaluationLogList
        evaluationSummary={summaryWith({
          filters: [filterResult(STATUS_FOUND)],
          events: [PROBE_AGREEMENT, INCIDENT_CREATED],
        })}
      />,
    );

    expect(screen.getByText(STATUS_FOUND_ENGLISH)).toBeInTheDocument();
    expect(screen.getByText(PROBE_AGREEMENT.title)).toBeInTheDocument();
    expect(screen.getByText(PROBE_AGREEMENT.message!)).toBeInTheDocument();
    expect(
      screen.getByText("Incident created: Checkout API is down (Incident #42)"),
    ).toBeInTheDocument();
  });
});

describe("an incident's root cause in the reader's language", () => {
  const ROOT_CAUSE: string = [
    "",
    "**Created because the following criteria was met**:",
    "",
    "**Criteria Name**: Website is down",
    "",
    `**Filter Conditions Met**: ${STATUS_FOUND_ENGLISH}`,
    "",
  ].join("\n");

  const EVALUATION_DETAILS: Record<string, unknown> = {
    version: 1,
    evaluatedAt: AT.toISOString(),
    criteriaName: "Website is down",
    filters: [
      {
        checkOn: CheckOn.ResponseStatusCode,
        met: true,
        message: STATUS_FOUND_ENGLISH,
        messageSentence: STATUS_FOUND,
      },
    ],
  };

  test("reads OneUptime's labels and the finding in Chinese", async () => {
    await readIn("zh-CN");

    const view: ReturnType<typeof render> = render(
      <MonitorRootCauseValue
        rootCause={ROOT_CAUSE}
        evaluationDetails={EVALUATION_DETAILS as never}
        placeholder="No root cause identified for this incident."
      />,
    );

    expect(
      await screen.findByText("因满足以下条件而创建", { exact: false }),
    ).toBeInTheDocument();

    const text: string = view.container.textContent || "";

    expect(text).toContain("条件名称");
    expect(text).toContain("Website is down");
    expect(text).toContain("满足的筛选条件");
    expect(text).toContain("响应状态码为 503，高于阈值 499。");
    expect(text).not.toContain("Created because");
    expect(text).not.toContain(STATUS_FOUND_ENGLISH);
  });

  test("shows its placeholder when there is none", async () => {
    render(
      <MonitorRootCauseValue
        rootCause="  "
        placeholder="No root cause identified for this incident."
      />,
    );

    expect(
      screen.getByText("No root cause identified for this incident."),
    ).toBeInTheDocument();
  });
});
