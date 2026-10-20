import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, within } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import MonitorEvaluationSummary, {
  MonitorEvaluationEvent,
  MonitorEvaluationGroupingNote,
} from "../../../Types/Monitor/MonitorEvaluationSummary";
import EvaluationLogList from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/EvaluationLogList";

/*
 * A grouping note among the Monitor Summary's Actions, in the reader's
 * language: what an Incoming Request criteria that groups by a payload field
 * did with a request - handled it for the whole monitor because it had no
 * value to group by, opened nothing new, or opened one per value while some
 * items had none.
 *
 * The server sends what the note says; the list words it with the shipped
 * Dashboard locales, every sentence whole, the grouping path drawn as code
 * and the criteria named in it - never an English sentence with a German
 * word in it, and never one that loses the path or the name.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

const AT: Date = new Date("2026-10-20T09:01:00.000Z");
const CRITERIA_ID: string = "6c1e1d6a-0001-4c00-8000-000000000001";
const PATH: string = "requestBody.alerts[*].labels.alertname";

interface Outcome {
  note: MonitorEvaluationGroupingNote;
  // The English title and sentence the list draws for it.
  englishTitle: string;
  englishMessage: string;
}

const OUTCOMES: Array<Outcome> = [
  {
    note: { outcome: "no-value", criteriaName: "Contains x", path: PATH },
    englishTitle: "No value to group by",
    englishMessage: `This request has no value at ${PATH}, so “Contains x” handled it without grouping, once for the whole monitor.`,
  },
  {
    note: { outcome: "no-request", criteriaName: "Contains x" },
    englishTitle: "No request to group by",
    englishMessage:
      "“Contains x” matched because requests stopped arriving, so it handled this without grouping, once for the whole monitor.",
  },
  {
    note: {
      outcome: "values-recovered",
      criteriaName: "Contains x",
      path: PATH,
    },
    englishTitle: "Nothing new to open",
    englishMessage: `Every value at ${PATH} in this request reported recovered, so “Contains x” opened nothing new.`,
  },
  {
    note: {
      outcome: "no-value-recovered",
      criteriaName: "Contains x",
      path: PATH,
    },
    englishTitle: "Nothing new to open",
    englishMessage: `This request has no value at ${PATH} and reported recovered, so “Contains x” opened nothing new.`,
  },
  {
    note: { outcome: "re-read", criteriaName: "Contains x" },
    englishTitle: "Nothing new to open",
    englishMessage:
      "The background check re-read the last request. “Contains x” opens one per value only when a request arrives.",
  },
  {
    note: {
      outcome: "some-without-value",
      criteriaName: "Contains x",
      path: PATH,
      itemsWithoutValue: 7,
    },
    englishTitle: "Not every item has a value to group by",
    englishMessage: `7 items in this request have no value at ${PATH}, so they opened nothing of their own.`,
  },
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

function event(note: MonitorEvaluationGroupingNote): MonitorEvaluationEvent {
  return {
    type: "grouping",
    title: "Stored English title",
    message: "Stored English message.",
    grouping: note,
    relatedCriteriaId: CRITERIA_ID,
    at: AT,
  };
}

// The title and message each note's row draws, in order.
function drawnNotes(
  notes: Array<MonitorEvaluationGroupingNote>,
): Array<{ title: string; message: HTMLElement }> {
  const summary: MonitorEvaluationSummary = {
    evaluatedAt: AT,
    criteriaResults: [
      {
        criteriaId: CRITERIA_ID,
        criteriaName: "Contains x",
        filterCondition: FilterCondition.All,
        met: true,
        message: "Request body contains x.",
        filters: [],
      },
    ],
    events: notes.map(event),
  };

  const view: ReturnType<typeof render> = render(
    <EvaluationLogList evaluationSummary={summary} />,
  );

  return within(view.container)
    .getAllByText((_content: string, element: Element | null): boolean => {
      return Boolean(
        element?.matches("div.break-words.font-medium") &&
          element.parentElement?.matches("div.min-w-0.flex-1"),
      );
    })
    .map((title: HTMLElement) => {
      return {
        title: title.textContent || "",
        message: title.nextElementSibling as HTMLElement,
      };
    });
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

describe("a grouping note in English", () => {
  test("reads each outcome as written, path and criteria in place", () => {
    const drawn: Array<{ title: string; message: HTMLElement }> = drawnNotes(
      OUTCOMES.map((outcome: Outcome) => {
        return outcome.note;
      }),
    );

    expect(
      drawn.map((row: { title: string; message: HTMLElement }) => {
        return [row.title, row.message.textContent];
      }),
    ).toEqual(
      OUTCOMES.map((outcome: Outcome) => {
        return [outcome.englishTitle, outcome.englishMessage];
      }),
    );
  });
});

describe.each(LANGUAGES)("a grouping note in %s", (language: string) => {
  test("words every outcome in the language, keeping the path, the criteria and the count", async () => {
    await readIn(language);

    const drawn: Array<{ title: string; message: HTMLElement }> = drawnNotes(
      OUTCOMES.map((outcome: Outcome) => {
        return outcome.note;
      }),
    );

    expect(drawn).toHaveLength(OUTCOMES.length);

    OUTCOMES.forEach((outcome: Outcome, index: number) => {
      const row: { title: string; message: HTMLElement } = drawn[index]!;
      const text: string = row.message.textContent || "";

      // Worded in the language, title and sentence alike.
      expect({ outcome: outcome.note.outcome, title: row.title }).not.toEqual({
        outcome: outcome.note.outcome,
        title: outcome.englishTitle,
      });
      expect({ outcome: outcome.note.outcome, text }).not.toEqual({
        outcome: outcome.note.outcome,
        text: outcome.englishMessage,
      });
      // Never the stored English beside it.
      expect(text).not.toContain("Stored English message.");

      // The criteria, by name, exactly once - the count of items names none.
      expect({
        outcome: outcome.note.outcome,
        names: text.split("“Contains x”").length - 1,
      }).toEqual({
        outcome: outcome.note.outcome,
        names: outcome.note.outcome === "some-without-value" ? 0 : 1,
      });

      // The path, as code, when the sentence names it.
      const paths: Array<HTMLElement> = within(row.message).queryAllByTestId(
        "evaluation-grouping-path",
      );
      expect({ outcome: outcome.note.outcome, paths: paths.length }).toEqual({
        outcome: outcome.note.outcome,
        paths: outcome.note.path ? 1 : 0,
      });
      paths.forEach((pathElement: HTMLElement) => {
        expect(pathElement).toHaveTextContent(PATH);
      });

      // The count of items without a value, in the language's digits.
      if (outcome.note.itemsWithoutValue) {
        expect(text).toContain((7).toLocaleString(language));
      }
    });
  });
});

describe("the count of items without a value picks the language's form", () => {
  function itemsSentence(count: number): string {
    const drawn: Array<{ title: string; message: HTMLElement }> = drawnNotes([
      {
        outcome: "some-without-value",
        criteriaName: "Contains x",
        path: PATH,
        itemsWithoutValue: count,
      },
    ]);
    const text: string = drawn[0]!.message.textContent || "";
    cleanup();
    return text;
  }

  test("English: one item, or several", () => {
    expect(itemsSentence(1)).toBe(
      `1 item in this request has no value at ${PATH}, so it opened nothing of its own.`,
    );
    expect(itemsSentence(2)).toBe(
      `2 items in this request have no value at ${PATH}, so they opened nothing of their own.`,
    );
  });

  test("German", async () => {
    await readIn("de");

    expect(itemsSentence(1)).toBe(
      `1 Element in dieser Anfrage hat keinen Wert unter ${PATH}, daher hat es nichts Eigenes eröffnet.`,
    );
    expect(itemsSentence(3)).toBe(
      `3 Elemente in dieser Anfrage haben keinen Wert unter ${PATH}, daher haben sie nichts Eigenes eröffnet.`,
    );
  });

  test("Russian puts 1 and 21 in one form, and 2, 5 and 11 in the general one", async () => {
    await readIn("ru");

    for (const count of [1, 21]) {
      expect(itemsSentence(count)).toBe(
        `${count} элемент в этом запросе не имеет значения по пути ${PATH}, поэтому отдельно для него ничего не открыто.`,
      );
    }

    for (const count of [2, 5, 11]) {
      expect(itemsSentence(count)).toBe(
        `Элементов в этом запросе без значения по пути ${PATH}: ${count}. Отдельно для них ничего не открыто.`,
      );
    }
  });

  test("Japanese has one form for every count", async () => {
    await readIn("ja");

    const one: string = itemsSentence(1);
    const four: string = itemsSentence(4);

    expect(one).toContain("1 個の項目");
    expect(one.replace("1 個", "N 個")).toBe(four.replace("4 個", "N 個"));
  });
});

describe("German, as a German reader sees the whole note", () => {
  test("a request with no value, handled for the whole monitor", async () => {
    await readIn("de");

    const drawn: Array<{ title: string; message: HTMLElement }> = drawnNotes([
      OUTCOMES[0]!.note,
    ]);

    expect(drawn[0]!.title).toBe("Kein Wert zum Gruppieren");
    expect(drawn[0]!.message).toHaveTextContent(
      `Diese Anfrage hat keinen Wert unter ${PATH}, daher hat das Kriterium “Contains x” sie ohne Gruppierung behandelt, einmal für den ganzen Monitor.`,
    );
  });
});
