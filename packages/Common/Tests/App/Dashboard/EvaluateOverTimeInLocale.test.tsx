import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import CriteriaFilterElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/CriteriaFilter";
import EventEvaluationDetails from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventEvaluationDetails";
import { WINDOW_SENTENCE } from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventEvaluationDetailsCopy";
import CriteriaFilterUiUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorEvaluationDetails, {
  MonitorEvaluationDetailsVersion,
} from "../../../Types/Monitor/MonitorEvaluationDetails";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * HOW A CRITERIA FILTER'S WINDOW IS JUDGED, IN THE READER'S LANGUAGE (#6473).
 *
 * "Evaluate this criteria over a period of time" offers six ways to judge
 * the window - Average, Sum, Maximum Value, Minimum Value, All Values, Any
 * Value - and an incident's evaluation details name the one it was judged
 * with. In German they read Alle Werte, Beliebiger Wert..., in the dropdown,
 * in the description under it (which named them in English beside a German
 * list until #6473, and in other words than the list's in Arabic), and in
 * the Window fact. From the shipped locale files; what is stored stays the
 * English value the engine reads.
 */

const WINDOW_TYPES: ReadonlyArray<EvaluateOverTimeType> = [
  EvaluateOverTimeType.Average,
  EvaluateOverTimeType.Sum,
  EvaluateOverTimeType.MaximumValue,
  EvaluateOverTimeType.MunimumValue,
  EvaluateOverTimeType.AllValues,
  EvaluateOverTimeType.AnyValue,
];

// The four every language words in other words than English's.
const NAMED_APART: ReadonlyArray<EvaluateOverTimeType> = [
  EvaluateOverTimeType.MaximumValue,
  EvaluateOverTimeType.MunimumValue,
  EvaluateOverTimeType.AllValues,
  EvaluateOverTimeType.AnyValue,
];

const CHECK_BY_CHECK: ReadonlyArray<EvaluateOverTimeType> = [
  EvaluateOverTimeType.AllValues,
  EvaluateOverTimeType.AnyValue,
];

const OVER_TIME_OPTIONS: string = "criteria-filter-over-time-options";

const RENDERED_LANGUAGES: ReadonlyArray<string> = ["de", "ar", "fa", "ja"];

// The two descriptions under the Evaluate dropdown, and the names each says.
const BODY_FILTER: CriteriaFilter = {
  checkOn: CheckOn.ResponseBody,
  filterType: FilterType.NotContains,
  value: "App Title",
  evaluateOverTime: true,
  evaluateOverTimeOptions: {
    timeValueInMinutes: 5,
    evaluateOverTimeType: EvaluateOverTimeType.AllValues,
  },
};

const TIME_FILTER: CriteriaFilter = {
  checkOn: CheckOn.ResponseTime,
  filterType: FilterType.GreaterThan,
  value: 3000,
  evaluateOverTime: true,
  evaluateOverTimeOptions: {
    timeValueInMinutes: 5,
    evaluateOverTimeType: EvaluateOverTimeType.Average,
  },
};

const DESCRIPTIONS: ReadonlyArray<{
  name: string;
  key: string;
  names: ReadonlyArray<EvaluateOverTimeType>;
}> = [
  {
    name: "check by check",
    key: CriteriaFilterUiUtil.getEvaluateOverTimeTypeDescription(
      BODY_FILTER,
      MonitorType.Website,
    ),
    names: CHECK_BY_CHECK,
  },
  {
    name: "a figure for the window",
    key: CriteriaFilterUiUtil.getEvaluateOverTimeTypeDescription(
      TIME_FILTER,
      MonitorType.Website,
    ),
    names: WINDOW_TYPES,
  },
];

function drawn(language: string, type: EvaluateOverTimeType): string {
  return readDashboardLocale(language)[type] as string;
}

async function inLanguage(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of ["en", ...RENDERED_LANGUAGES]) {
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

// The four a locale leaves in English, or does not word at all.
function leftInEnglish(locale: Record<string, string>): Array<string> {
  return NAMED_APART.filter((type: EvaluateOverTimeType): boolean => {
    return !locale[type] || locale[type] === type;
  });
}

// The English names of the four a text says.
function englishNamesIn(text: string): Array<string> {
  return NAMED_APART.filter((type: EvaluateOverTimeType): boolean => {
    return text.includes(type);
  });
}

describe("every language names the six window types", () => {
  test.each(DASHBOARD_LANGUAGES)(
    "%s words each of them",
    (language: string) => {
      const unworded: Array<string> = WINDOW_TYPES.filter(
        (type: EvaluateOverTimeType): boolean => {
          return !isWordedInDashboardLocale(type, language);
        },
      );

      expect({ language, unworded }).toEqual({ language, unworded: [] });
      expect({
        language,
        left: leftInEnglish(readDashboardLocale(language)),
      }).toEqual({ language, left: [] });

      // No two of them read alike.
      expect(
        new Set(
          WINDOW_TYPES.map((type: EvaluateOverTimeType): string => {
            return drawn(language, type);
          }),
        ).size,
      ).toBe(WINDOW_TYPES.length);
    },
  );

  test("a locale that kept one in English, or lost one, is caught (the control)", () => {
    const german: Record<string, string> = readDashboardLocale("de");
    const lost: Record<string, string> = { ...german };

    delete lost["Any Value"];

    expect(leftInEnglish({ ...german, "All Values": "All Values" })).toEqual([
      "All Values",
    ]);
    expect(leftInEnglish(lost)).toEqual(["Any Value"]);
    // The German description as it read before #6473.
    expect(
      englishNamesIn(
        "All Values trifft nur zu, wenn jede Prüfung im Zeitfenster zutraf. Any Value trifft zu, sobald eine Prüfung zutraf.",
      ),
    ).toEqual(["All Values", "Any Value"]);
  });
});

describe("the description under the Evaluate dropdown names them as the dropdown draws them", () => {
  test("the descriptions are English keys naming the six in English", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const description of DESCRIPTIONS) {
      expect(english[description.key]).toBe(description.key);

      for (const type of description.names) {
        expect(description.key).toContain(type);
      }
    }
  });

  test.each(DASHBOARD_LANGUAGES)("%s", (language: string) => {
    const locale: Record<string, string> = readDashboardLocale(language);

    for (const description of DESCRIPTIONS) {
      const worded: string = locale[description.key] as string;

      expect(isWordedInDashboardLocale(description.key, language)).toBe(true);

      for (const type of description.names) {
        expect({
          language,
          description: description.name,
          type,
          names: worded.includes(drawn(language, type)),
        }).toEqual({
          language,
          description: description.name,
          type,
          names: true,
        });
      }

      // Never an English name beside the reader's list.
      expect({ language, english: englishNamesIn(worded) }).toEqual({
        language,
        english: [],
      });
    }
  });
});

/*
 * All Values and Any Value are named inside a sentence ("All Values needs
 * every check to ..."), so in a translation they are set apart the way that
 * language quotes a label - „Alle Werte“, «Alle verdier», ”Alla värden”,
 * 「すべての値」 - or a reader takes "Alle verdier krever ..." for "all
 * values require ...". English writes them in Title Case instead. Norwegian
 * and Swedish named them bare until the UI review of #6993.
 */
const OPENING_QUOTES: string = "«»„“”\"'‘「『";
const CLOSING_QUOTES: string = "»«“”\"'’」』";
const SPACES_BESIDE_QUOTES: string = " \u00a0\u202f";

// Each place a text names `label` without quotes around it.
function bareNamings(text: string, label: string): Array<number> {
  const bare: Array<number> = [];
  let from: number = 0;

  for (;;) {
    const at: number = text.indexOf(label, from);

    if (at < 0) {
      return bare;
    }

    let before: number = at - 1;

    while (before >= 0 && SPACES_BESIDE_QUOTES.includes(text[before]!)) {
      before--;
    }

    let after: number = at + label.length;

    while (after < text.length && SPACES_BESIDE_QUOTES.includes(text[after]!)) {
      after++;
    }

    const isQuoted: boolean =
      before >= 0 &&
      OPENING_QUOTES.includes(text[before]!) &&
      after < text.length &&
      CLOSING_QUOTES.includes(text[after]!);

    if (!isQuoted) {
      bare.push(at);
    }

    from = at + label.length;
  }
}

describe("the descriptions set All Values and Any Value apart in quotes", () => {
  test.each(
    DASHBOARD_LANGUAGES.filter((language: string): boolean => {
      return language !== "en";
    }),
  )("%s", (language: string) => {
    const locale: Record<string, string> = readDashboardLocale(language);

    for (const description of DESCRIPTIONS) {
      const worded: string = locale[description.key] as string;

      for (const type of CHECK_BY_CHECK) {
        expect({
          language,
          description: description.name,
          type,
          bare: bareNamings(worded, drawn(language, type)),
        }).toEqual({
          language,
          description: description.name,
          type,
          bare: [],
        });
      }
    }
  });

  test("a bare name is caught (the control)", () => {
    // The Norwegian description as it read before the review.
    expect(
      bareNamings(
        "Gjennomsnitt, Sum, Maksimumsverdi og Minimumsverdi sammenligner ett tall for hele vinduet. Alle verdier krever at hver kontroll oppfyller betingelsen, Minst én verdi bare én.",
        "Minst én verdi",
      ),
    ).toHaveLength(1);
    expect(bareNamings("«Minst én verdi» bare én.", "Minst én verdi")).toEqual(
      [],
    );
    // French sets its guillemets a space apart.
    expect(
      bareNamings("« Au moins une valeur » une seule.", "Au moins une valeur"),
    ).toEqual([]);
    // Quoted on one side only is not quoted.
    expect(bareNamings("„Alle Werte verlangt", "Alle Werte")).toHaveLength(1);
  });
});

interface Rendered {
  emitted: Array<CriteriaFilter>;
}

function renderFilter(initial: CriteriaFilter): Rendered {
  const emitted: Array<CriteriaFilter> = [];

  const Parent: React.FunctionComponent = (): React.ReactElement => {
    const [criteriaFilter, setCriteriaFilter] =
      React.useState<CriteriaFilter>(initial);

    return (
      <CriteriaFilterElement
        monitorType={MonitorType.Website}
        monitorStep={new MonitorStep()}
        value={criteriaFilter}
        onChange={(value: CriteriaFilter) => {
          emitted.push(value);
          setCriteriaFilter(value);
        }}
      />
    );
  };

  render(<Parent />);

  return { emitted: emitted };
}

// The Evaluate dropdown's options, as the reader sees them.
async function evaluateOptions(): Promise<Array<string>> {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  const options: HTMLElement = screen.getByTestId(OVER_TIME_OPTIONS);

  await user.click(within(options).getAllByRole("combobox")[0]!);

  return screen.getAllByRole("option").map((option: HTMLElement): string => {
    return option.textContent || "";
  });
}

describe("the criteria form's Evaluate dropdown, in the reader's language", () => {
  test("in English, as before", async () => {
    renderFilter(TIME_FILTER);

    expect(await evaluateOptions()).toEqual([...WINDOW_TYPES]);
  });

  test.each(RENDERED_LANGUAGES)(
    "%s: the six, in order, and the description beside them",
    async (language: string) => {
      await inLanguage(language);
      renderFilter(TIME_FILTER);

      const options: HTMLElement = screen.getByTestId(OVER_TIME_OPTIONS);
      const description: string = readDashboardLocale(language)[
        DESCRIPTIONS[1]!.key
      ] as string;

      expect(within(options).getByText(description)).toBeInTheDocument();
      // The type the filter holds, as the reader reads it.
      expect(
        within(options).getAllByText(
          drawn(language, EvaluateOverTimeType.Average),
        ).length,
      ).toBe(1);

      expect(await evaluateOptions()).toEqual(
        WINDOW_TYPES.map((type: EvaluateOverTimeType): string => {
          return drawn(language, type);
        }),
      );

      for (const type of NAMED_APART) {
        expect(within(options).queryByText(type)).toBeNull();
        expect(options.textContent).not.toContain(type);
      }
    },
  );

  test.each(RENDERED_LANGUAGES)(
    "%s: a check-by-check filter offers its two, described in their words",
    async (language: string) => {
      await inLanguage(language);
      renderFilter(BODY_FILTER);

      const options: HTMLElement = screen.getByTestId(OVER_TIME_OPTIONS);
      const description: string = readDashboardLocale(language)[
        DESCRIPTIONS[0]!.key
      ] as string;

      expect(within(options).getByText(description)).toBeInTheDocument();

      expect(await evaluateOptions()).toEqual(
        CHECK_BY_CHECK.map((type: EvaluateOverTimeType): string => {
          return drawn(language, type);
        }),
      );
    },
  );

  test("picking Beliebiger Wert in German stores Any Value, the value the engine reads", async () => {
    await inLanguage("de");
    const rendered: Rendered = renderFilter(BODY_FILTER);

    await evaluateOptions();
    await userEvent.setup().click(screen.getByText("Beliebiger Wert"));

    expect(rendered.emitted.length).toBeGreaterThan(0);
    expect(
      rendered.emitted[rendered.emitted.length - 1]!.evaluateOverTimeOptions,
    ).toEqual({
      timeValueInMinutes: 5,
      evaluateOverTimeType: EvaluateOverTimeType.AnyValue,
    });
    expect(
      within(screen.getByTestId(OVER_TIME_OPTIONS)).getAllByText(
        "Beliebiger Wert",
      ).length,
    ).toBe(1);
  });
});

const EVALUATED_AT: Date = new Date("2026-11-12T08:00:00.000Z");

function windowDetails(
  windowType: EvaluateOverTimeType,
  windowMinutes: number,
): MonitorEvaluationDetails {
  return {
    version: MonitorEvaluationDetailsVersion,
    monitorType: MonitorType.Website,
    evaluatedAt: EVALUATED_AT,
    criteriaId: "criteria-1",
    criteriaName: "Title missing",
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: CheckOn.ResponseBody,
        filterType: FilterType.NotContains,
        value: "App Title",
        met: true,
        message: "Response Body did not contain App Title.",
        windowMinutes: windowMinutes,
        windowType: windowType,
      },
    ],
  };
}

describe("an incident's evaluation details name the window's type in the reader's language", () => {
  test("in English, as before", () => {
    render(
      <EventEvaluationDetails
        details={windowDetails(EvaluateOverTimeType.AllValues, 5)}
      />,
    );

    expect(screen.getByTestId("evaluation-filter-window")).toHaveTextContent(
      "The last 5 minutes, All Values",
    );
  });

  test.each(
    RENDERED_LANGUAGES.flatMap((language: string) => {
      return [...CHECK_BY_CHECK, EvaluateOverTimeType.MaximumValue].map(
        (type: EvaluateOverTimeType): [string, EvaluateOverTimeType] => {
          return [language, type];
        },
      );
    }),
  )("%s: %s", async (language: string, type: EvaluateOverTimeType) => {
    await inLanguage(language);

    for (const minutes of [1, 5]) {
      const { unmount }: { unmount: () => void } = render(
        <EventEvaluationDetails details={windowDetails(type, minutes)} />,
      );
      const window: string =
        screen.getByTestId("evaluation-filter-window").textContent || "";

      expect(window).toContain(drawn(language, type));
      expect(window).not.toContain(type);
      expect(window).not.toContain("minute");
      expect(window).not.toContain("The last");
      expect(
        i18next.exists(
          minutes === 1 ? WINDOW_SENTENCE.one : WINDOW_SENTENCE.other,
        ),
      ).toBe(true);

      unmount();
    }
  });
});
