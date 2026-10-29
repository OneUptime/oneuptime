import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import { BrowserRouter } from "react-router-dom";
import TracePerformanceSuggestion from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceDetail/TracePerformanceSuggestion";
import {
  PerformanceFinding,
  PerformanceFindingType,
} from "../../../Types/AI/CodeFixTaskContext";
import Route from "../../../Types/API/Route";
import SuggestionOffer from "../../../Utils/Suggestions/SuggestionOffer";
import { TracePerformanceFixSuggestion } from "../../../Utils/Suggestions/TracePerformanceFixSuggestion";

/*
 * The finding strip in the reader's language, from the shipped locale
 * files: the counted headline (a plural template with the span names put
 * in as styled slots), the cost line and the actions. German moves the
 * count's suffix and keeps the parent's name in the sentence; Japanese puts
 * the parent first; Russian uses its count-neutral general form.
 *
 * The Dashboard sets i18next up once, globally, with react-i18next; so does
 * this file. Each jest file has its own module registry, so it reaches no
 * other suite.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

// Every language the Dashboard is translated into.
const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json") && file !== "en.json";
  })
  .map((file: string): string => {
    return path.basename(file, ".json");
  });

/*
 * The strip's own words around the finding: its button, its tooltip, its
 * links and its states. A language left any of them in English drew an
 * English button in a strip of its own words.
 */
const STRIP_ACTION_KEYS: Array<string> = [
  "Fix performance with AI",
  "OneUptime AI opens a pull request that fixes this, for you to review.",
  "Connect a repository to fix this with AI",
  "OneUptime AI is working on a fix.",
  "View task progress",
  "Show them",
  "Show it",
  "Could not start the fix: {{reason}}",
];

// Characters a wide script draws about twice as wide as a Latin letter.
const WIDE_CHARACTER: RegExp =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

// A mark drawn on the letter before it (a Devanagari vowel sign, a nukta).
const COMBINING_MARK: RegExp = /\p{M}/u;

/*
 * How wide a label draws, in Latin letters: one per letter, none for the
 * marks drawn on a letter, two for a Chinese, Japanese or Korean character.
 */
function labelWidth(label: string): number {
  let width: number = 0;

  for (const character of Array.from(label)) {
    if (COMBINING_MARK.test(character)) {
      continue;
    }
    width += WIDE_CHARACTER.test(character) ? 2 : 1;
  }

  return width;
}

/*
 * On a 390px phone the fix button spans the strip, and its label has about
 * 25 Latin letters of room before it breaks in two: the room "Åtgärda
 * prestandan med AI" (25) fills, measured in a browser with the product's
 * Inter, where "Corregir el rendimiento con IA" (30) broke.
 */
const PHONE_BUTTON_LABEL_ROOM: number = 25;

const FINDING: PerformanceFinding = {
  findingType: PerformanceFindingType.NPlusOneQuery,
  headline: "",
  evidence: "",
  spanCount: 40,
  combinedDurationMs: 960,
  traceDurationMs: 1720,
  percentOfTrace: 55.8,
  normalizedSpanName: "SELECT line_items WHERE invoice_id = {n}",
  parentSpanName: "ReportService.build",
  normalizedDbStatement: "SELECT * FROM line_items WHERE invoice_id = $1",
  dbSystem: "postgresql",
  implicatedSpans: [
    {
      spanId: "q0",
      name: "SELECT line_items WHERE invoice_id = $1",
      durationMs: 24,
    },
    {
      spanId: "q1",
      name: "SELECT line_items WHERE invoice_id = $1",
      durationMs: 24,
    },
  ],
};

const SUGGESTION: TracePerformanceFixSuggestion = {
  offer: SuggestionOffer.SetUp,
  finding: FINDING,
  findingCount: 1,
  fixOutcome: null,
  blocker: null,
  aiRunId: null,
  repositories: [],
};

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      de: { translation: readLocale("de") },
      ja: { translation: readLocale("ja") },
      ru: { translation: readLocale("ru") },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

async function renderIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });

  render(
    <BrowserRouter>
      <TracePerformanceSuggestion
        suggestion={SUGGESTION}
        taskRoute={null}
        connectRepositoryRoute={new Route("/dashboard/p/code")}
        isCreating={false}
        error={null}
        onFix={() => {}}
        onShowSpans={() => {}}
      />
    </BrowserRouter>,
  );
}

describe("the finding strip in the reader's language", () => {
  test("German: the counted headline, the cost and the connect link", async () => {
    await renderIn("de");

    expect(screen.getByTestId("trace-performance-finding")).toHaveTextContent(
      "Dieselbe Datenbankabfrage lief 40-mal in ReportService.build",
    );
    expect(screen.getByText("ReportService.build")).toHaveClass(
      "font-semibold",
    );
    expect(screen.getByTestId("trace-performance-detail")).toHaveTextContent(
      "Zusammen benötigen sie 960 ms dieser 1.72 s langen Anfrage.",
    );
    expect(
      screen.getByTestId("trace-fix-performance-connect"),
    ).toHaveTextContent("Repository verbinden, um das mit KI zu beheben");
    expect(
      screen.getByTestId("trace-performance-show-spans"),
    ).toHaveTextContent("Anzeigen");
  });

  test("Japanese: the parent first, as the language orders it", async () => {
    await renderIn("ja");

    expect(screen.getByTestId("trace-performance-finding")).toHaveTextContent(
      "ReportService.build で同じデータベースクエリが 40 回実行されました",
    );
    expect(
      screen.getByTestId("trace-fix-performance-connect"),
    ).toHaveTextContent("リポジトリを接続して AI で修正");
  });

  test("Russian: the count-neutral general form", async () => {
    await renderIn("ru");

    expect(screen.getByTestId("trace-performance-finding")).toHaveTextContent(
      "Повторов одного и того же запроса к базе данных в ReportService.build: 40",
    );
  });

  test.each(LANGUAGES)(
    "%s words the strip's button, links and states itself",
    (language: string) => {
      const locale: Record<string, string> = readLocale(language);

      for (const key of STRIP_ACTION_KEYS) {
        expect(locale[key]).toBeTruthy();
        expect({ key, value: locale[key] }).not.toEqual({ key, value: key });
      }
    },
  );

  test.each(["en", ...LANGUAGES])(
    "%s: the fix button's label fits a phone's full-width button on one line",
    (language: string) => {
      const label: string = readLocale(language)["Fix performance with AI"]!;

      // The label is in the comparison, so a failure names it.
      expect({
        label,
        fitsOnOneLine: labelWidth(label) <= PHONE_BUTTON_LABEL_ROOM,
      }).toEqual({ label, fitsOnOneLine: true });
    },
  );

  test("English, for a language with no translation of the sentence yet", async () => {
    await renderIn("en");

    expect(screen.getByTestId("trace-performance-finding")).toHaveTextContent(
      "The same database query ran 40 times in ReportService.build",
    );
  });
});
