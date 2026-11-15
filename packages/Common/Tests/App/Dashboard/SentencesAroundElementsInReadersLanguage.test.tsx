import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import SecurityEventProviderTile, {
  CONNECT_PROVIDER,
  PROVIDER_SETUP_GUIDE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventProviderTile";
import {
  SUMMARY_COVERED_NOW,
  SUMMARY_GAPS_THIS_WEEK,
  SUMMARY_NO_ONE_ON_CALL_NOW,
  SUMMARY_SCHEDULES,
  SummaryBar,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ScheduleTimeline/TimelineToolbar";
import {
  AttentionFilter,
  TimelineSummary,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ScheduleTimeline/TimelineModel";
import {
  MY_OPEN_CASES_LABEL,
  STEPS_WAITING_LABEL,
  UNASSIGNED_OPEN_CASES_LABEL,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityOverview/SecurityOverviewStatusModel";
import { DECLARED_CODE_VIEW_PULL_REQUEST_NUMBER } from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/DeclaredCodeChangeWords";
import { IMPORT_PROBLEM_ITEM } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistsCopy";
import { TimelineViewMode } from "../../../Types/OnCallDutyPolicy/ScheduleTimelineLayout";
import {
  SecurityEventConnectorCatalog,
  SecurityEventConnectorDefinition,
} from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { PluralTemplate } from "../../../UI/Utils/TranslateTemplate";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
  readDashboardLocaleAsDrawn,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { preloadProviderLogoMarks } from "../../Helpers/ProviderLogoMarks";

/*
 * SENTENCES THAT HOLD AN ELEMENT, AS A READER SEES THEM (#8483).
 *
 * Each of these was drawn as a translated phrase beside an element - a bold
 * count before "covered now", "Connect" before a product's name for a
 * screen reader - and kept English's order whatever the phrase said. Each is
 * one sentence now, its element where the reader's language puts it, drawn
 * here by the real components in English, German, Arabic and Persian.
 */

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  await preloadProviderLogoMarks();

  for (const code of LANGUAGES) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: code,
      fallbackLng: "en",
      resources: {
        [code]: { translation: readDashboardLocaleAsDrawn(code) },
        en: { translation: readDashboardLocale("en") },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[code] = instance;
  }
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("dir");
});

function inLanguage(code: string, element: React.ReactElement): void {
  if (code === "ar" || code === "fa") {
    document.documentElement.setAttribute("dir", "rtl");
  }

  render(
    <I18nextProvider i18n={instances[code] as i18n}>{element}</I18nextProvider>,
  );
}

function flat(text: string | null): string {
  return withoutIsolateMarks(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

// What a language says for a template: its own words, or English's.
function wordsOf(code: string, key: string): string {
  return code === "en"
    ? key
    : (readDashboardLocaleAsDrawn(code)[key] as string);
}

// The form a language reads at a count: its "one" sentence, or its general one.
function formOf(code: string, template: PluralTemplate, count: number): string {
  const isOne: boolean =
    !["ja", "ko", "zh-CN", "zh-TW"].includes(code) &&
    new Intl.PluralRules(code).select(count) === "one";

  if (code === "en") {
    return isOne ? template.one : template.other;
  }

  const words: Record<string, string> = readDashboardLocaleAsDrawn(code);

  return (
    isOne ? words[`${template.other}_one`] : words[template.other]
  ) as string;
}

// A count in the language's own digits.
function digitsOf(code: string, count: number): string {
  return new Intl.NumberFormat(code === "fa" ? "fa" : "en").format(count);
}

const SUMMARY: TimelineSummary = {
  total: 3,
  coveredNow: 1,
  uncoveredNow: 2,
  withGaps: 4,
};

describe.each(LANGUAGES)(
  "the schedule timeline's summary in %s",
  (code: string) => {
    test("each chip is one sentence, its bold count where the language puts it", () => {
      inLanguage(
        code,
        <SummaryBar
          summary={SUMMARY}
          mode={TimelineViewMode.Week}
          attention={AttentionFilter.None}
          onAttentionChange={() => {}}
        />,
      );

      const chips: Array<[string, PluralTemplate, number]> = [
        ["timeline-summary-covered-now", SUMMARY_COVERED_NOW, 1],
        ["timeline-summary-uncovered-now", SUMMARY_NO_ONE_ON_CALL_NOW, 2],
        ["timeline-summary-gaps", SUMMARY_GAPS_THIS_WEEK, 4],
      ];

      for (const [testId, template, count] of chips) {
        const chip: HTMLElement = screen.getByTestId(testId);
        const form: string = formOf(code, template, count);

        expect(form).toContain("{{count}}");
        expect({ testId, text: flat(chip.textContent) }).toEqual({
          testId,
          text: flat(form.replace("{{count}}", digitsOf(code, count))),
        });

        // The count is the bold element, in the reader's digits.
        const bold: HTMLElement | null = chip.querySelector(".font-semibold");
        expect(flat(bold?.textContent || "")).toBe(digitsOf(code, count));
      }

      expect(
        flat(screen.getByTestId("timeline-summary").textContent),
      ).toContain(
        flat(
          formOf(code, SUMMARY_SCHEDULES, 3).replace(
            "{{count}}",
            digitsOf(code, 3),
          ),
        ),
      );
    });
  },
);

describe("the summary's words, language by language", () => {
  test("Arabic and Russian put a count of two after the words, as their general form says", () => {
    expect(formOf("ar", SUMMARY_NO_ONE_ON_CALL_NOW, 2)).toBe(
      "دون مناوب الآن: {{count}}",
    );
    expect(formOf("ru", SUMMARY_NO_ONE_ON_CALL_NOW, 2)).toBe(
      "Без дежурных сейчас: {{count}}",
    );
    expect(formOf("de", SUMMARY_COVERED_NOW, 1)).toBe(
      "{{count}} jetzt abgedeckt",
    );
    expect(formOf("fa", SUMMARY_SCHEDULES, 3)).toBe("{{count}} زمان‌بندی");
  });
});

function definitionFor(
  provider: SecurityEventConnectorProvider,
): SecurityEventConnectorDefinition {
  const definition: SecurityEventConnectorDefinition | undefined =
    SecurityEventConnectorCatalog.find(
      (candidate: SecurityEventConnectorDefinition): boolean => {
        return candidate.provider === provider;
      },
    );

  if (!definition) {
    throw new Error(`No catalog entry for ${provider}`);
  }

  return definition;
}

describe.each(LANGUAGES)("a security product's tile in %s", (code: string) => {
  test("its button and its guide link are each named by one sentence with the product in it", () => {
    const definition: SecurityEventConnectorDefinition = definitionFor(
      SecurityEventConnectorProvider.AwsSecurityHub,
    );

    inLanguage(
      code,
      <ul role="list">
        <SecurityEventProviderTile
          idPrefix="tile"
          definition={definition}
          canConnect={true}
          onConnect={() => {}}
        />
      </ul>,
    );

    const tile: HTMLElement = screen.getByTestId(
      `tile-provider-${definition.provider}`,
    );
    const connect: string = wordsOf(code, CONNECT_PROVIDER).replace(
      "{{provider}}",
      definition.title,
    );
    const guide: string = wordsOf(code, PROVIDER_SETUP_GUIDE).replace(
      "{{provider}}",
      definition.title,
    );

    expect(
      flat(
        within(tile).getByRole("button").querySelector(".sr-only")
          ?.textContent || "",
      ),
    ).toBe(flat(connect));

    const link: HTMLElement = within(tile).getByRole("link");
    const read: Array<string> = Array.from(
      link.querySelectorAll(".sr-only"),
    ).map((element: Element): string => {
      return flat(element.textContent);
    });

    expect(read).toEqual([
      flat(guide),
      flat(wordsOf(code, "(opens in a new tab)")),
    ]);

    // The tile shows the product as its vendor writes it, in every language.
    expect(
      flat(
        within(tile).getByRole("button").querySelector('[aria-hidden="true"]')
          ?.textContent || "",
      ),
    ).toBe(definition.title);
  });
});

describe("German puts the product before the verb, as English never does", () => {
  test("AWS Security Hub verbinden, Einrichtungsanleitung für AWS Security Hub", () => {
    expect(wordsOf("de", CONNECT_PROVIDER)).toBe("{{provider}} verbinden");
    expect(wordsOf("de", PROVIDER_SETUP_GUIDE)).toBe(
      "Einrichtungsanleitung für {{provider}}",
    );
  });
});

/*
 * The other sentences this issue made one, in every Dashboard language:
 * each keeps its placeholders, and says them in the language's words.
 */
const SENTENCES: ReadonlyArray<string> = [
  DECLARED_CODE_VIEW_PULL_REQUEST_NUMBER,
  IMPORT_PROBLEM_ITEM,
  CONNECT_PROVIDER,
  PROVIDER_SETUP_GUIDE,
  ...[
    SUMMARY_SCHEDULES,
    SUMMARY_COVERED_NOW,
    SUMMARY_NO_ONE_ON_CALL_NOW,
    SUMMARY_GAPS_THIS_WEEK,
    MY_OPEN_CASES_LABEL,
    UNASSIGNED_OPEN_CASES_LABEL,
    STEPS_WAITING_LABEL,
  ].flatMap((template: PluralTemplate): Array<string> => {
    return [template.other, `${template.other}_one`];
  }),
];

const PLACEHOLDER: RegExp = /\{\{\w+\}\}/g;

const HAS_LETTERS: RegExp = /[A-Za-z]/;

function placeholdersOf(text: string): Array<string> {
  return (text.match(PLACEHOLDER) || []).sort();
}

describe.each(DASHBOARD_LANGUAGES)(
  "the sentences of #8483 in %s",
  (code: string) => {
    test.each(SENTENCES)("%s keeps its placeholders", (key: string) => {
      const english: string = readDashboardLocale("en")[key] as string;
      const words: string = readDashboardLocale(code)[key] as string;

      expect(english).toBeDefined();
      expect(words).toBeDefined();
      expect(placeholdersOf(words)).toEqual(placeholdersOf(english));

      // A sentence with words is the language's own, not English's.
      if (HAS_LETTERS.test(english.replace(PLACEHOLDER, ""))) {
        expect({ key, words }).not.toEqual({ key, words: english });
      }
    });
  },
);

describe("a line left out of a watchlist import, with the language's own colon", () => {
  test("French spaces its colon, Chinese writes a full-width one", () => {
    expect(readDashboardLocale("fr")[IMPORT_PROBLEM_ITEM]).toBe(
      "{{line}} : {{value}} - {{problem}}",
    );
    expect(readDashboardLocale("zh-CN")[IMPORT_PROBLEM_ITEM]).toBe(
      "{{line}}：{{value}} - {{problem}}",
    );
  });
});
