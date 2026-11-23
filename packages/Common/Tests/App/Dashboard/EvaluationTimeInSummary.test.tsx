import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, within } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import { Translator } from "../../../Types/Translator";
import MonitorEvaluationTime from "../../../Utils/Monitor/MonitorEvaluationTime";
import EvaluationLogList from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/EvaluationLogList";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * HOW LONG AN EVALUATION TOOK, IN ITS SUMMARY (#10317).
 *
 * The evaluation summary - a check's View Summary in Monitoring Logs, and
 * the latest check on the monitor's Overview - says when the check was
 * evaluated, how long that took and how many series it judged, and warns
 * when it took too long for its monitor (MonitorEvaluationTime). These tests
 * draw the summary as a reader sees it: the facts in one line, set apart by
 * dots; the warning only when the evaluation was slow, saying what it is
 * weighed against and what to do; nothing new for a summary logged before
 * evaluations said how long they took; and all of it in every language the
 * Dashboard ships, with the reader's figures.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = [...DASHBOARD_LANGUAGES];

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;

const EVALUATED_AT: Date = new Date("2026-11-23T10:04:30.000Z");

// The sentences the warning words, in English.
const ENGLISH_SENTENCES: Array<string> = [
  "That is a lot for a monitor checked every",
  "That is a lot for one evaluation",
  "To make it faster, narrow its filters or group by fewer attributes.",
  "This evaluation took",
];

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

function summary(
  overrides: Partial<MonitorEvaluationSummary> = {},
): MonitorEvaluationSummary {
  return {
    evaluatedAt: EVALUATED_AT,
    criteriaResults: [
      {
        criteriaId: "criteria-too-many-tasks",
        criteriaName: "Too many tasks",
        filterCondition: FilterCondition.All,
        met: true,
        message: "A container runs too many tasks.",
        filters: [],
      },
    ],
    events: [],
    ...overrides,
  };
}

interface Drawn {
  // Each fact of the line, in order.
  facts: Array<string>;
  // The warning's text, or null when there is none.
  warning: string | null;
}

function draw(evaluation: MonitorEvaluationSummary): Drawn {
  const view: ReturnType<typeof render> = render(
    <EvaluationLogList evaluationSummary={evaluation} />,
  );
  const line: HTMLElement | null = view.queryByTestId("evaluation-facts");
  const warning: HTMLElement | null = view.queryByTestId("slow-evaluation");

  return {
    facts: line
      ? Array.from(line.children)
          .filter((child: Element): boolean => {
            return child.getAttribute("aria-hidden") !== "true";
          })
          .map((child: Element): string => {
            return child.textContent || "";
          })
      : [],
    warning: warning ? warning.textContent || "" : null,
  };
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {
    en: { translation: readLocale("en") },
  };

  for (const language of LANGUAGES) {
    resources[language] = { translation: readLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
});

afterEach(async () => {
  cleanup();
  await readIn("en");
});

describe("an evaluation summary, in English", () => {
  const en: Translator = dashboardTranslator("en");
  // When it ran, as the line has always said it.
  const evaluatedAtFact: () => unknown = (): unknown => {
    return expect.stringMatching(/^Evaluated at .+/);
  };

  test("says when it ran, how long it took and how many series it judged, in one line", () => {
    const drawn: Drawn = draw(
      summary({
        durationInMs: 2_400,
        seriesJudged: 16_250,
        intervalInMs: MINUTE,
      }),
    );

    expect(drawn.facts).toEqual([
      evaluatedAtFact(),
      `Took ${MonitorEvaluationTime.formatDuration(en, 2_400)}`,
      "Judged 16,250 series",
    ]);
    expect(drawn.facts[0]).toMatch(/^Evaluated at /);
    expect(drawn.facts[1]).toBe("Took 2.4\u00A0s");
  });

  test("an evaluation in time for its interval is not warned about", () => {
    expect(
      draw(
        summary({
          durationInMs: 2_400,
          seriesJudged: 16_250,
          intervalInMs: MINUTE,
        }),
      ).warning,
    ).toBeNull();
  });

  test("a slow grouped one is: what it took, what it is weighed against, and what to do", () => {
    const drawn: Drawn = draw(
      summary({
        durationInMs: 48 * SECOND,
        seriesJudged: 16_250,
        intervalInMs: MINUTE,
      }),
    );

    expect(drawn.warning).toBe(
      [
        "This evaluation took 48\u00A0s",
        "That is a lot for a monitor checked every 1\u00A0min: if its evaluations keep growing, its checks will fall behind.",
        "It judged 16,250 series. To make it faster, narrow its filters or group by fewer attributes.",
      ].join(""),
    );
  });

  test("a slow one with no interval - evaluated as its results arrive - says each holds up the next", () => {
    const drawn: Drawn = draw(summary({ durationInMs: 6 * SECOND }));

    expect(drawn.facts).toEqual([evaluatedAtFact(), "Took 6\u00A0s"]);
    expect(drawn.warning).toBe(
      [
        "This evaluation took 6\u00A0s",
        "That is a lot for one evaluation: if its evaluations keep growing, each will hold up the next.",
      ].join(""),
    );
  });

  test("the threshold weighs the interval: 25 s is slow every minute, not every five", () => {
    expect(
      draw(summary({ durationInMs: 25 * SECOND, intervalInMs: MINUTE }))
        .warning,
    ).not.toBeNull();
    cleanup();
    expect(
      draw(summary({ durationInMs: 25 * SECOND, intervalInMs: 5 * MINUTE }))
        .warning,
    ).toBeNull();
  });

  test("one series reads as one", () => {
    expect(draw(summary({ durationInMs: 900, seriesJudged: 1 })).facts).toEqual(
      [evaluatedAtFact(), "Took 900\u00A0ms", "Judged 1 series"],
    );
  });

  test("a summary logged before evaluations said how long they took says when it ran only", () => {
    const drawn: Drawn = draw(summary());

    expect(drawn.facts).toHaveLength(1);
    expect(drawn.facts[0]).toMatch(/^Evaluated at /);
    expect(drawn.warning).toBeNull();
  });

  test("the dots between the facts are not read out", () => {
    const view: ReturnType<typeof render> = render(
      <EvaluationLogList
        evaluationSummary={summary({ durationInMs: 900, seriesJudged: 3 })}
      />,
    );
    const separators: Array<HTMLElement> = within(
      view.getByTestId("evaluation-facts"),
    ).getAllByText("·");

    expect(separators).toHaveLength(2);
    for (const separator of separators) {
      expect(separator).toHaveAttribute("aria-hidden", "true");
    }
  });
});

describe.each(LANGUAGES)("an evaluation summary in %s", (language: string) => {
  test("words the time, the series and the warning in the language, with the reader's figures", async () => {
    await readIn(language);

    const reader: Translator = dashboardTranslator(language);
    const drawn: Drawn = draw(
      summary({
        durationInMs: 48 * SECOND,
        seriesJudged: 16_250,
        intervalInMs: MINUTE,
      }),
    );
    const took: string = MonitorEvaluationTime.formatDuration(
      reader,
      48 * SECOND,
    );
    const interval: string = MonitorEvaluationTime.formatDuration(
      reader,
      MINUTE,
    );

    expect(drawn.facts).toHaveLength(3);
    expect(drawn.facts[1]).toContain(took);
    expect(drawn.facts[1]).not.toMatch(/^Took /);
    expect(drawn.facts[2]).toContain(reader.formatNumber(16_250));
    expect(drawn.facts[2]).not.toMatch(/^Judged /);

    expect(drawn.warning).not.toBeNull();
    expect(drawn.warning).toContain(took);
    expect(drawn.warning).toContain(interval);
    expect(drawn.warning).toContain(reader.formatNumber(16_250));

    for (const english of ENGLISH_SENTENCES) {
      expect(drawn.warning).not.toContain(english);
    }
  });
});
