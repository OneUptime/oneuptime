// UX rule: Docs/ux/README.md#in-every-language
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
import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import ObjectID from "../../../Types/ObjectID";
import { createTranslator, Translator } from "../../../Types/Translator";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import MonitorCriteriaInstanceView, {
  ALL_FILTERS_SENTENCE,
  ANY_FILTERS_SENTENCE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorSteps/MonitorCriteriaInstance";
import CriteriaFilterUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";

/*
 * A CRITERIA'S FILTERS SAY HOW THEY COMBINE ONCE, ABOVE THEM (#8533).
 *
 * The criteria list ended every filter's line but the last with "and," or
 * "or," - `Check if "Response Time (in ms)" is greater than 3,000 ms and,` -
 * a broken sentence in English that every language had to word as one, and
 * the heading above the list said it again, misstating All as "All of these
 * can match". The heading now says it once, a whole sentence each way, and
 * each line is its filter's sentence and nothing more. Drawn with the
 * Dashboard's shipped locale files in English, German, Japanese, Chinese,
 * Arabic and Persian.
 */

const LANGUAGES: ReadonlyArray<string> = [
  "en",
  "de",
  "ja",
  "zh-CN",
  "ar",
  "fa",
];

// The words a joiner left at the end of a line were, in these languages.
const LEFT_JOINERS: RegExp =
  /(\band,|\bor,| und$| oder$|、かつ$|、または$|，且$|，或$| و$| أو$| یا$)\s*$/;

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

function translatorIn(language: string): Translator {
  const words: Record<string, string> = readDashboardLocale(language);

  return createTranslator((key: string): string | undefined => {
    return words[key];
  }, language);
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      LANGUAGES.map((language: string) => {
        return [language, { translation: readDashboardLocale(language) }];
      }),
    ),
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(async () => {
  await readIn("en");
});

afterEach(() => {
  cleanup();
});

const SLOW_RESPONSE: CriteriaFilter = {
  checkOn: CheckOn.ResponseTime,
  filterType: FilterType.GreaterThan,
  value: 3000,
};

const OFFLINE: CriteriaFilter = {
  checkOn: CheckOn.IsOnline,
  filterType: FilterType.False,
  value: undefined,
};

const ERROR_BODY: CriteriaFilter = {
  checkOn: CheckOn.ResponseBody,
  filterType: FilterType.Contains,
  value: "error",
};

const FILTERS: Array<CriteriaFilter> = [SLOW_RESPONSE, OFFLINE, ERROR_BODY];

function buildCriteria(
  filters: Array<CriteriaFilter>,
  filterCondition: FilterCondition | undefined,
): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: undefined,
    filterCondition: filterCondition as FilterCondition,
    filters: filters.map((filter: CriteriaFilter): CriteriaFilter => {
      return { ...filter };
    }),
    incidents: [],
    alerts: [],
    changeMonitorStatus: false,
    createIncidents: false,
    createAlerts: false,
    isEnabled: true,
    name: "Slow, offline or failing",
    description: "",
  };
  return instance;
}

function renderView(instance: MonitorCriteriaInstance): void {
  render(
    <MonitorCriteriaInstanceView
      monitorStatusOptions={[]}
      incidentSeverityOptions={[]}
      alertSeverityOptions={[]}
      isLastCriteria={true}
      monitorCriteriaInstance={instance}
      onCallPolicyOptions={[]}
      labelOptions={[]}
      teamOptions={[]}
      userOptions={[]}
      incidentRoleOptions={[]}
    />,
  );
}

function heading(): string {
  return withoutIsolateMarks(
    screen.getByTestId("monitor-criteria-filters-heading").textContent || "",
  );
}

function lines(): Array<string> {
  return screen
    .getAllByTestId("monitor-criteria-filter")
    .map((line: HTMLElement): string => {
      return withoutIsolateMarks(line.textContent || "").trim();
    });
}

describe("each filter's line is its sentence and nothing more", () => {
  test.each(
    LANGUAGES.flatMap((language: string) => {
      return [FilterCondition.All, FilterCondition.Any].map(
        (condition: FilterCondition): [string, FilterCondition] => {
          return [language, condition];
        },
      );
    }),
  )("%s, %s", async (language: string, condition: FilterCondition) => {
    await readIn(language);
    renderView(buildCriteria(FILTERS, condition));

    const translator: Translator = translatorIn(language);

    expect(lines()).toEqual(
      FILTERS.map((filter: CriteriaFilter): string => {
        return withoutIsolateMarks(
          CriteriaFilterUtil.translateFilterToText(
            filter,
            undefined,
            translator,
          ),
        ).trim();
      }),
    );

    for (const line of lines()) {
      expect({ line, joiner: LEFT_JOINERS.test(line) }).toEqual({
        line,
        joiner: false,
      });
    }
  });

  test("the check would find a joiner left at a line's end", () => {
    expect(
      LEFT_JOINERS.test(
        'Check if "Response Time (in ms)" is greater than 3,000 ms and,',
      ),
    ).toBe(true);
    expect(
      LEFT_JOINERS.test('Prüfen: "Antwortzeit" ist größer als 3.000 ms und'),
    ).toBe(true);
    expect(
      LEFT_JOINERS.test('確認: "応答時間" が 3,000 ms より大きい、かつ'),
    ).toBe(true);
    expect(LEFT_JOINERS.test('بررسی کنید که "زمان پاسخ" بیشتر است و')).toBe(
      true,
    );
  });
});

describe("the heading says once how they combine, in the reader's words", () => {
  test.each(
    LANGUAGES.map((language: string): [string] => {
      return [language];
    }),
  )(
    "%s: All and Any are two sentences of the locale",
    async (language: string) => {
      const translator: Translator = translatorIn(language);

      await readIn(language);
      renderView(buildCriteria(FILTERS, FilterCondition.All));
      const all: string = heading();
      cleanup();

      renderView(buildCriteria(FILTERS, FilterCondition.Any));
      const any: string = heading();

      expect(all).toContain(
        translator.translateText(ALL_FILTERS_SENTENCE) || ALL_FILTERS_SENTENCE,
      );
      expect(any).toContain(
        translator.translateText(ANY_FILTERS_SENTENCE) || ANY_FILTERS_SENTENCE,
      );
      expect(all).not.toBe(any);
    },
  );

  test("English: All must match, Any can", () => {
    renderView(buildCriteria(FILTERS, FilterCondition.All));
    expect(heading()).toBe(
      "Filters (All) All of these must match for this criteria to be met:",
    );
    cleanup();

    renderView(buildCriteria(FILTERS, FilterCondition.Any));
    expect(heading()).toBe(
      "Filters (Any) Any of these can match for this criteria to be met:",
    );
  });

  test("a criteria saved without a condition reads as All, as it is evaluated", () => {
    renderView(buildCriteria(FILTERS, undefined));

    expect(heading()).toContain(ALL_FILTERS_SENTENCE);
  });

  test("one filter says no word of how filters combine", async () => {
    await readIn("de");
    renderView(buildCriteria([SLOW_RESPONSE], FilterCondition.Any));

    const translator: Translator = translatorIn("de");

    expect(heading()).not.toContain(
      translator.translateText(ANY_FILTERS_SENTENCE) || ANY_FILTERS_SENTENCE,
    );
    expect(lines()).toHaveLength(1);
  });

  test("every Dashboard language words both sentences", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const sentence of [ALL_FILTERS_SENTENCE, ANY_FILTERS_SENTENCE]) {
        expect({
          language,
          sentence,
          worded: words[sentence] !== sentence,
        }).toEqual({ language, sentence, worded: true });
      }
    }
  });

  test("the locale files hold no joiner sentence any more", () => {
    for (const language of ["en", ...DASHBOARD_LANGUAGES]) {
      const words: Record<string, string> = readDashboardLocale(language);

      expect(words["Check if {{condition}} and,"]).toBeUndefined();
      expect(words["Check if {{condition}} or,"]).toBeUndefined();
    }
  });
});
