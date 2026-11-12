import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import EventEvaluationDetails from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventEvaluationDetails";
import { isFilterSentenceShown } from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventEvaluationDetailsCopy";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import {
  EvaluationSentence,
  wordStoredEvaluationText,
} from "../../../Types/Monitor/EvaluationSentence";
import MonitorEvaluationDetails, {
  MonitorEvaluationDetailsVersion,
  MonitorEvaluationFilterDetails,
} from "../../../Types/Monitor/MonitorEvaluationDetails";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * AN INCIDENT'S EVALUATION DETAILS SAY EACH FINDING IN THE READER'S LANGUAGE.
 *
 * The What happened card shows a monitor's root cause, then its Evaluation
 * details: each filter of the criteria, and - where nothing else says what
 * a filter found (a filter that did not match, a window opened under Show
 * details) - the filter's own finding. The engine stores that finding with
 * the sentence it was filled from, and the root cause above and the
 * monitor's evaluation log word it in the reader's language. Until the UI
 * review of #6993 the Evaluation details showed its stored English under a
 * German root cause. Here: the finding worded from its sentence in German,
 * Arabic, Persian and Japanese; one stored before #6581 reworded the engine
 * read in the current words; and English, and a finding stored without a
 * sentence, as stored.
 */

const LANGUAGES: ReadonlyArray<string> = ["de", "ar", "fa", "ja"];

const EVALUATED_AT: Date = new Date("2026-11-12T08:00:00.000Z");

// What the engine stores for a header found by its value (#6581).
const HEADER_VALUE: { english: string; sentence: EvaluationSentence } = {
  english: "A response header has the value miss.",
  sentence: {
    template: "A response header has the value {{text}}.",
    values: { text: "miss" },
  },
};

// The same finding as a record written before #6581 holds it.
const HEADER_VALUE_BEFORE: { english: string; sentence: EvaluationSentence } = {
  english: "Response header threshold contains miss.",
  sentence: {
    template: "Response header threshold contains {{text}}.",
    values: { text: "miss" },
  },
};

// A text comparison: what was read, then why it matched.
const COMPARISON: { english: string; sentence: EvaluationSentence } = {
  english: "Result Value is status: degraded, which contains degraded.",
  sentence: {
    template: "{{subject}} is {{values}}, which contains {{threshold}}.",
    values: {
      subject: { term: "Result Value" },
      values: "status: degraded",
      threshold: "degraded",
    },
  },
};

const COMPARISON_BEFORE: { english: string; sentence: EvaluationSentence } = {
  english: "Result Value is status: degraded which is contains degraded.",
  sentence: {
    ...COMPARISON.sentence,
    template: "{{subject}} is {{values}} which is contains {{threshold}}.",
  },
};

/*
 * A filter whose finding the section shows folded: one the section has no
 * value of its own for (no field, no actual, no excerpt).
 */
function filterSaying(
  finding: { english: string; sentence?: EvaluationSentence | undefined },
  overrides?: Partial<MonitorEvaluationFilterDetails>,
): MonitorEvaluationFilterDetails {
  const filter: MonitorEvaluationFilterDetails = {
    checkOn: CheckOn.ResponseHeaderValue,
    filterType: FilterType.Contains,
    value: "miss",
    met: true,
    message: finding.english,
    ...(overrides || {}),
  };

  if (finding.sentence) {
    filter.messageSentence = finding.sentence;
  }

  return filter;
}

function details(
  filters: Array<MonitorEvaluationFilterDetails>,
): MonitorEvaluationDetails {
  return {
    version: MonitorEvaluationDetailsVersion,
    monitorType: MonitorType.API,
    evaluatedAt: EVALUATED_AT,
    criteriaId: "criteria-1",
    criteriaName: "Checkout served from origin",
    filterCondition: FilterCondition.Any,
    filters: filters,
  };
}

// The findings the section shows, as a reader reads them.
function shownFindings(): Array<string> {
  return screen
    .queryAllByTestId("evaluation-filter-message")
    .map((node: HTMLElement): string => {
      return withoutIsolateMarks(node.textContent || "");
    });
}

// How the reader's language words a stored finding.
function worded(
  language: string,
  finding: { english: string; sentence: EvaluationSentence },
): string {
  return withoutIsolateMarks(
    wordStoredEvaluationText({
      english: finding.english,
      sentence: finding.sentence,
      translator: dashboardTranslator(language),
    }),
  );
}

async function inLanguage(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of ["en", ...LANGUAGES]) {
    resources[language] = { translation: readDashboardLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await inLanguage("en");
});

afterEach(() => {
  cleanup();
});

describe("the findings this suite renders are the ones the section shows folded", () => {
  test("a finding with nothing else to say what was found shows", () => {
    expect(isFilterSentenceShown(filterSaying(HEADER_VALUE), false)).toBe(true);
    expect(
      isFilterSentenceShown(
        filterSaying(COMPARISON, {
          checkOn: CheckOn.ResultValue,
        }),
        false,
      ),
    ).toBe(true);
  });
});

describe("in English, each finding reads as the engine wrote it", () => {
  test("a finding with its sentence", () => {
    render(
      <EventEvaluationDetails
        details={details([
          filterSaying(HEADER_VALUE),
          filterSaying(COMPARISON, {
            checkOn: CheckOn.ResultValue,
          }),
        ])}
      />,
    );

    expect(shownFindings()).toEqual([HEADER_VALUE.english, COMPARISON.english]);
  });

  test("a record from before #6581 reads in the current words", () => {
    render(
      <EventEvaluationDetails
        details={details([filterSaying(HEADER_VALUE_BEFORE)])}
      />,
    );

    expect(shownFindings()).toEqual([HEADER_VALUE.english]);
  });

  test("a finding stored without a sentence reads as stored", () => {
    render(
      <EventEvaluationDetails
        details={details([
          filterSaying({ english: "Monitor reported offline status." }),
        ])}
      />,
    );

    expect(shownFindings()).toEqual(["Monitor reported offline status."]);
  });
});

describe("in another language, each finding reads in that language", () => {
  test.each(LANGUAGES)("%s", async (language: string) => {
    await inLanguage(language);

    render(
      <EventEvaluationDetails
        details={details([
          filterSaying(HEADER_VALUE),
          filterSaying(COMPARISON, {
            checkOn: CheckOn.ResultValue,
          }),
        ])}
      />,
    );

    const shown: Array<string> = shownFindings();

    expect(shown).toEqual([
      worded(language, HEADER_VALUE),
      worded(language, COMPARISON),
    ]);

    // Not the stored English, nor any of its words but the values.
    expect(shown[0]).not.toBe(HEADER_VALUE.english);
    expect(shown[1]).not.toBe(COMPARISON.english);

    for (const line of shown) {
      for (const english of ["response", "header", "which", "contains"]) {
        expect({ language, line, english: line.includes(english) }).toEqual({
          language,
          line,
          english: false,
        });
      }
    }

    // The values the engine read stay as written.
    expect(shown[0]).toContain("miss");
    expect(shown[1]).toContain("status: degraded");
  });

  test("German, word for word", async () => {
    await inLanguage("de");

    render(
      <EventEvaluationDetails
        details={details([
          filterSaying(HEADER_VALUE),
          filterSaying(COMPARISON, {
            checkOn: CheckOn.ResultValue,
          }),
        ])}
      />,
    );

    expect(shownFindings()).toEqual([
      "Ein Antwort-Header hat den Wert miss.",
      "Ergebniswert ist status: degraded und enthält degraded.",
    ]);
  });

  test.each(LANGUAGES)(
    "%s: a record from before #6581 reads like a new one",
    async (language: string) => {
      await inLanguage(language);

      render(
        <EventEvaluationDetails
          details={details([
            filterSaying(HEADER_VALUE_BEFORE),
            filterSaying(COMPARISON_BEFORE, {
              checkOn: CheckOn.ResultValue,
            }),
          ])}
        />,
      );

      expect(shownFindings()).toEqual([
        worded(language, HEADER_VALUE),
        worded(language, COMPARISON),
      ]);
    },
  );

  test("a finding stored without a sentence reads as stored, in any language", async () => {
    await inLanguage("de");

    render(
      <EventEvaluationDetails
        details={details([
          filterSaying({ english: "Monitor reported offline status." }),
        ])}
      />,
    );

    expect(shownFindings()).toEqual(["Monitor reported offline status."]);
  });

  test("a sentence the reader's language cannot word whole reads in English, never half and half", async () => {
    await inLanguage("de");

    render(
      <EventEvaluationDetails
        details={details([
          filterSaying({
            english: "A finding no locale words.",
            sentence: {
              template: "A finding no locale words.",
              values: {},
            },
          }),
        ])}
      />,
    );

    expect(shownFindings()).toEqual(["A finding no locale words."]);
  });
});
