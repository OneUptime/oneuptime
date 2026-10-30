import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ---------------------------------------------------------------------------
 * The Traces > Analytics toolbar, in every Dashboard language
 * ---------------------------------------------------------------------------
 *
 * The toolbar over the analytics chart - Span Type, Chart, Measure, Split
 * by, then by, Top and Create metric… - drew English in every language: its
 * captions, the names its selects are read by and their choices were written
 * into the component and never looked up. They are keys of the Dashboard's
 * locales now, drawn in the reader's language as the rest of the Dashboard
 * is; so are the headers of the table under it, which name the same fields,
 * and the name of a chart's one series, which is its measure.
 *
 * What stays as written in every language: an attribute's key
 * (http.method), the Span Type's choices (named the same in the sidebar and
 * the docs: "Entry spans") and the numbers of Top.
 *
 * The REAL TracesAnalyticsView is mounted under an i18next instance per
 * language, built from the Dashboard's own locale files the way
 * Utils/i18n.ts builds the Dashboard's (as in
 * TracesFilterNamesInEveryLanguage.test.tsx), against a mocked analytics
 * endpoint; recharts is replaced by probes that print the series they are
 * handed (as in TracesAnalyticsSeriesLabels.test.tsx).
 */

const apiPostMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factories run.
 */
jest.mock("recharts", () => {
  const ReactInFactory: typeof React = jest.requireActual(
    "react",
  ) as typeof React;

  const chart: (props: any) => React.ReactElement = (
    props: any,
  ): React.ReactElement => {
    return ReactInFactory.createElement(
      "div",
      { "data-testid": "chart" },
      props.children,
    );
  };

  // A series prints the name it is drawn under: its dataKey.
  const series: (props: any) => React.ReactElement = (
    props: any,
  ): React.ReactElement => {
    return ReactInFactory.createElement("span", {
      "data-testid": "chart-series",
      "data-key": props.dataKey,
    });
  };

  const nothing: () => null = (): null => {
    return null;
  };

  return {
    __esModule: true,
    ResponsiveContainer: chart,
    BarChart: chart,
    LineChart: chart,
    AreaChart: chart,
    Bar: series,
    Line: series,
    Area: series,
    CartesianGrid: nothing,
    XAxis: nothing,
    YAxis: nothing,
    Tooltip: nothing,
    ReferenceArea: nothing,
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return apiPostMock(...args);
      },
      getFriendlyMessage: () => {
        return "error";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (...args: Array<any>) => {
        return getCurrentProjectIdMock(...args);
      },
    },
  };
});

import TracesAnalyticsView from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesAnalyticsView";
import ObjectID from "../../../Types/ObjectID";
import {
  TRACE_SPAN_TYPE_OPTIONS,
  TraceSpanType,
  TraceSpanTypeOption,
} from "../../../Types/Telemetry/TraceSpanType";

jest.setTimeout(120000);

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

const DASHBOARD_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard",
);
const LOCALES_DIR: string = path.join(DASHBOARD_DIR, "src", "Locales");
const PROGRESS_DIR: string = path.join(DASHBOARD_DIR, "i18n", "Progress");

type Locale = Record<string, unknown>;

const readJson: (file: string) => unknown = (file: string): unknown => {
  return JSON.parse(fs.readFileSync(file, "utf8"));
};

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json");
  })
  .map((file: string): string => {
    return file.slice(0, -".json".length);
  })
  .sort();

const OTHER_LANGUAGES: Array<string> = LANGUAGES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const LOCALES: Record<string, Locale> = {};
for (const language of LANGUAGES) {
  LOCALES[language] = readJson(
    path.join(LOCALES_DIR, `${language}.json`),
  ) as Locale;
}
const ENGLISH: Locale = LOCALES["en"] as Locale;

/*
 * The words a language says the same way as English, on record: its own
 * (i18n/Progress/<language>.json) and every language's (SameAsEnglish.json).
 */
const EVERY_LANGUAGE_SAME_AS_ENGLISH: Array<string> = readJson(
  path.join(DASHBOARD_DIR, "i18n", "SameAsEnglish.json"),
) as Array<string>;

const sameAsEnglish: (language: string) => Array<string> = (
  language: string,
): Array<string> => {
  const progress: { sameAsEnglish?: Array<string> } = readJson(
    path.join(PROGRESS_DIR, `${language}.json`),
  ) as { sameAsEnglish?: Array<string> };

  return [...EVERY_LANGUAGE_SAME_AS_ENGLISH, ...(progress.sameAsEnglish || [])];
};

// What the Dashboard draws for an English word: the locale's, or English.
const drawn: (language: string, english: string) => string = (
  language: string,
  english: string,
): string => {
  const value: unknown = (LOCALES[language] as Locale)[english];

  return typeof value === "string" && value.trim() ? value : english;
};

// The toolbar's controls, in the order it draws them, by their captions.
const CAPTIONS: Array<string> = [
  "Span Type",
  "Chart",
  "Measure",
  "Split by",
  "then by",
  "Top",
];

const CHART_CHOICES: Array<{ value: string; label: string }> = [
  { value: "timeseries", label: "Timeseries" },
  { value: "toplist", label: "Top List" },
  { value: "table", label: "Table" },
];

const MEASURE_CHOICES: Array<{ value: string; label: string }> = [
  { value: "count", label: "Request Count" },
  { value: "errorCount", label: "Error Count" },
  { value: "avgDuration", label: "Avg Response Time" },
  { value: "p50Duration", label: "Median Response Time (P50)" },
  { value: "p90Duration", label: "P90 Response Time" },
  { value: "p95Duration", label: "P95 Response Time" },
  { value: "p99Duration", label: "P99 Response Time" },
  { value: "minDuration", label: "Min Response Time" },
  { value: "maxDuration", label: "Max Response Time" },
];

// A span's own fields, to split by; the first is what a split starts on.
const SPAN_FIELDS: Array<{ value: string; label: string }> = [
  { value: "name", label: "Span Name" },
  { value: "primaryEntityId", label: "Service" },
  { value: "statusCode", label: "Status" },
  { value: "kind", label: "Span Kind" },
];

const NONE: string = "None";
const CREATE_METRIC: string = "Create metric…";
const CREATE_METRIC_TITLE: string =
  "Persist this analysis as a metric via a Trace Recording Rule";

// The table's columns after the ones it is split by.
const TABLE_MEASURE_HEADERS: Array<string> = [
  "Requests",
  "Errors",
  "Avg",
  "P50",
  "P90",
  "P95",
  "P99",
  "Min",
  "Max",
];

// Drawn as written in every language.
const ATTRIBUTE_KEYS: Array<string> = ["http.method", "deployment.environment"];
const TOP_CHOICES: Array<string> = ["5", "10", "25", "50", "100"];
const SPAN_TYPE_CHOICES: Array<string> = TRACE_SPAN_TYPE_OPTIONS.map(
  (option: TraceSpanTypeOption): string => {
    return option.label;
  },
);

const labelsOf: (choices: Array<{ label: string }>) => Array<string> = (
  choices: Array<{ label: string }>,
): Array<string> => {
  return choices.map((choice: { label: string }): string => {
    return choice.label;
  });
};

// Every word of the toolbar and its table that a language words its own way.
const TOOLBAR_WORDS: Array<string> = [
  ...CAPTIONS,
  ...labelsOf(CHART_CHOICES),
  ...labelsOf(MEASURE_CHOICES),
  NONE,
  ...labelsOf(SPAN_FIELDS),
  CREATE_METRIC,
  CREATE_METRIC_TITLE,
  ...TABLE_MEASURE_HEADERS,
];

const INSTANCES: Record<string, i18n> = {};

type AnalyticsRequest = {
  data: { chartType: string; groupBy?: Array<string> };
};

// One request a minute for two minutes, and a table split by name and status.
const installAnalyticsApi: () => void = (): void => {
  apiPostMock.mockImplementation(async (request: AnalyticsRequest) => {
    if (request.data.chartType === "table") {
      return {
        data: {
          data: [
            {
              groupValues: { name: "GET /orders", statusCode: "1" },
              count: 12,
              errorCount: 1,
              avgDurationMs: 21,
              p50DurationMs: 18,
              p90DurationMs: 40,
              p95DurationMs: 52,
              p99DurationMs: 90,
              minDurationMs: 3,
              maxDurationMs: 120,
            },
          ],
        },
      };
    }

    if (request.data.chartType === "toplist") {
      return { data: { data: [] } };
    }

    const groupValues: Record<string, string> = request.data.groupBy?.length
      ? { name: "GET /orders" }
      : {};

    return {
      data: {
        data: [
          { time: "2026-10-30T10:00:00.000Z", value: 5, groupValues },
          { time: "2026-10-30T10:01:00.000Z", value: 3, groupValues },
        ],
      },
    };
  });
};

const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 20);
    });
  });
};

const renderInLanguage: (language: string) => Promise<void> = async (
  language: string,
): Promise<void> => {
  await act(async () => {
    render(
      <I18nextProvider i18n={INSTANCES[language] as i18n}>
        <TracesAnalyticsView
          baseFilters={{}}
          attributeKeys={ATTRIBUTE_KEYS}
          serviceNameMap={{}}
          spanType={TraceSpanType.Entry}
          onSpanTypeChange={jest.fn()}
          onCreateMetric={jest.fn()}
        />
      </I18nextProvider>,
    );
  });
  await settle();
};

// The toolbar's selects, in the order it draws them.
const toolbarSelects: () => Array<HTMLSelectElement> =
  (): Array<HTMLSelectElement> => {
    return screen.getAllByRole("combobox") as Array<HTMLSelectElement>;
  };

// The caption a control draws before its select: the control's first child.
const captionOf: (select: HTMLSelectElement) => string = (
  select: HTMLSelectElement,
): string => {
  return select.parentElement?.firstElementChild?.textContent || "";
};

const choicesOf: (select: HTMLSelectElement) => Array<string> = (
  select: HTMLSelectElement,
): Array<string> => {
  return Array.from(select.options).map((option: HTMLOptionElement): string => {
    return option.textContent || "";
  });
};

const valuesOf: (select: HTMLSelectElement) => Array<string> = (
  select: HTMLSelectElement,
): Array<string> => {
  return Array.from(select.options).map((option: HTMLOptionElement): string => {
    return option.value;
  });
};

const selectCaptioned: (
  language: string,
  caption: string,
) => HTMLSelectElement = (
  language: string,
  caption: string,
): HTMLSelectElement => {
  return screen.getByRole("combobox", {
    name: drawn(language, caption),
  }) as HTMLSelectElement;
};

const seriesNames: () => Array<string> = (): Array<string> => {
  return screen
    .queryAllByTestId("chart-series")
    .map((element: HTMLElement): string => {
      return element.getAttribute("data-key") || "";
    });
};

beforeAll(async () => {
  for (const language of LANGUAGES) {
    const instance: i18n = createInstance();

    // The Dashboard's own configuration (Utils/i18n.ts): default separators.
    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: ENGLISH },
        [language]: { translation: LOCALES[language] as Locale },
      },
      interpolation: { escapeValue: false },
    });

    INSTANCES[language] = instance;
  }
});

beforeEach(() => {
  getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT_ID));
  getListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
  installAnalyticsApi();
});

afterEach(() => {
  cleanup();
  apiPostMock.mockReset();
  getListMock.mockReset();
  getCurrentProjectIdMock.mockReset();
});

describe("the words of the analytics toolbar, in the Dashboard's locales", () => {
  test("every Dashboard language is read: English and the 16 others", () => {
    expect(LANGUAGES).toHaveLength(17);
    expect(OTHER_LANGUAGES).toEqual(
      expect.arrayContaining(["de", "ja", "fa", "zh-TW"]),
    );
  });

  test("each is a key of the Dashboard's English, drawn as itself", () => {
    expect(
      TOOLBAR_WORDS.filter((word: string): boolean => {
        return ENGLISH[word] !== word;
      }),
    ).toEqual([]);
  });

  test.each(OTHER_LANGUAGES)(
    "%s has its own word for each, or says it as English does on record",
    (language: string) => {
      const kept: Array<string> = sameAsEnglish(language);
      const locale: Locale = LOCALES[language] as Locale;

      expect(
        TOOLBAR_WORDS.filter((word: string): boolean => {
          const value: unknown = locale[word];

          return (
            typeof value !== "string" ||
            !value.trim() ||
            (value === word && !kept.includes(word))
          );
        }),
      ).toEqual([]);
    },
  );

  test.each(LANGUAGES)(
    "%s tells every control apart, and every choice of one control from the others",
    (language: string) => {
      const groups: Array<Array<string>> = [
        CAPTIONS,
        labelsOf(CHART_CHOICES),
        labelsOf(MEASURE_CHOICES),
        [NONE, ...labelsOf(SPAN_FIELDS), ...ATTRIBUTE_KEYS],
        TABLE_MEASURE_HEADERS,
      ];

      for (const group of groups) {
        const words: Array<string> = group.map((word: string): string => {
          return drawn(language, word).toLocaleLowerCase(language);
        });

        expect(new Set(words).size).toBe(words.length);
      }
    },
  );
});

describe.each(LANGUAGES)("the analytics toolbar in %s", (language: string) => {
  test("captions each control, and names its select, in the language's words", async () => {
    await renderInLanguage(language);

    const selects: Array<HTMLSelectElement> = toolbarSelects();
    const captions: Array<string> = CAPTIONS.map((caption: string): string => {
      return drawn(language, caption);
    });

    expect(selects.map(captionOf)).toEqual(captions);
    expect(
      selects.map((select: HTMLSelectElement): string | null => {
        return select.getAttribute("aria-label");
      }),
    ).toEqual(captions);

    // The Span Type's (i) is named for the caption beside it.
    const spanType: string = drawn(language, "Span Type").toLocaleLowerCase(
      language,
    );
    expect(
      screen.getAllByRole("button").filter((button: HTMLElement): boolean => {
        return (button.getAttribute("aria-label") || "")
          .toLocaleLowerCase(language)
          .includes(spanType);
      }),
    ).toHaveLength(1);
  });

  test("draws each select's choices in the language's words, setting what they always set", async () => {
    await renderInLanguage(language);

    const words: (choices: Array<{ label: string }>) => Array<string> = (
      choices: Array<{ label: string }>,
    ): Array<string> => {
      return labelsOf(choices).map((label: string): string => {
        return drawn(language, label);
      });
    };

    const chart: HTMLSelectElement = selectCaptioned(language, "Chart");
    expect(choicesOf(chart)).toEqual(words(CHART_CHOICES));
    expect(valuesOf(chart)).toEqual(
      CHART_CHOICES.map((choice: { value: string }): string => {
        return choice.value;
      }),
    );

    const measure: HTMLSelectElement = selectCaptioned(language, "Measure");
    expect(choicesOf(measure)).toEqual(words(MEASURE_CHOICES));
    expect(valuesOf(measure)).toEqual(
      MEASURE_CHOICES.map((choice: { value: string }): string => {
        return choice.value;
      }),
    );

    const splitBy: HTMLSelectElement = selectCaptioned(language, "Split by");
    expect(choicesOf(splitBy)).toEqual([
      drawn(language, NONE),
      ...words(SPAN_FIELDS),
      ...ATTRIBUTE_KEYS,
    ]);
    expect(valuesOf(splitBy)).toEqual([
      "",
      ...SPAN_FIELDS.map((field: { value: string }): string => {
        return field.value;
      }),
      ...ATTRIBUTE_KEYS,
    ]);

    // Split by Span Name first, so then by offers every field but that one.
    const thenBy: HTMLSelectElement = selectCaptioned(language, "then by");
    expect(choicesOf(thenBy)).toEqual([
      drawn(language, NONE),
      ...words(SPAN_FIELDS.slice(1)),
      ...ATTRIBUTE_KEYS,
    ]);

    // As written: the Span Type's choices and Top's numbers.
    expect(choicesOf(selectCaptioned(language, "Span Type"))).toEqual(
      SPAN_TYPE_CHOICES,
    );
    expect(choicesOf(selectCaptioned(language, "Top"))).toEqual(TOP_CHOICES);
  });

  test("names Create metric… and what it does in the language's words", async () => {
    await renderInLanguage(language);

    expect(
      screen.getByRole("button", { name: drawn(language, CREATE_METRIC) }),
    ).toHaveAttribute("title", drawn(language, CREATE_METRIC_TITLE));
  });

  test("heads the table's columns with the split's names, as the toolbar words them, and the measures'", async () => {
    await renderInLanguage(language);

    fireEvent.change(selectCaptioned(language, "Chart"), {
      target: { value: "table" },
    });

    await waitFor(() => {
      expect(screen.getAllByRole("columnheader").length).toBeGreaterThan(1);
    });

    expect(
      screen.getAllByRole("columnheader").map((header: HTMLElement): string => {
        return (header.textContent || "").trim();
      }),
    ).toEqual([
      "#",
      drawn(language, "Span Name"),
      drawn(language, "Status"),
      ...TABLE_MEASURE_HEADERS.map((header: string): string => {
        return drawn(language, header);
      }),
    ]);
  });

  test("names a chart's one series for its measure, as the toolbar words it", async () => {
    await renderInLanguage(language);

    fireEvent.change(selectCaptioned(language, "Split by"), {
      target: { value: "" },
    });
    await waitFor(() => {
      expect(seriesNames()).toEqual([drawn(language, "Request Count")]);
    });

    fireEvent.change(selectCaptioned(language, "Measure"), {
      target: { value: "p95Duration" },
    });
    await waitFor(() => {
      expect(seriesNames()).toEqual([drawn(language, "P95 Response Time")]);
    });
  });
});

describe("REGRESSION: the toolbar drew English in every language", () => {
  /*
   * The captions as the four languages print them, written out - so a
   * drawn() that handed English back for every word could not pass the
   * tests above unseen.
   */
  test.each([
    {
      language: "de",
      captions: [
        "Span-Typ",
        "Diagramm",
        "Messung",
        "Aufteilen nach",
        "dann nach",
        "Top",
      ],
      createMetric: "Metrik erstellen…",
    },
    {
      language: "ja",
      captions: [
        "スパンタイプ",
        "チャート",
        "測定",
        "分割基準",
        "次に",
        "上位",
      ],
      createMetric: "メトリクスを作成…",
    },
    {
      language: "fr",
      captions: [
        "Catégorie de span",
        "Graphique",
        "Mesure",
        "Répartir par",
        "puis par",
        "Top",
      ],
      createMetric: "Créer une métrique…",
    },
    {
      language: "fa",
      captions: [
        "نوع اسپن",
        "نمودار",
        "سنجه",
        "تفکیک بر اساس",
        "سپس بر اساس",
        "برترین",
      ],
      createMetric: "ایجاد متریک…",
    },
  ])(
    "$language: $captions",
    async ({
      language,
      captions,
      createMetric,
    }: {
      language: string;
      captions: Array<string>;
      createMetric: string;
    }) => {
      await renderInLanguage(language);

      expect(toolbarSelects().map(captionOf)).toEqual(captions);
      expect(screen.getByRole("button", { name: createMetric })).toBeVisible();
      expect(screen.queryByText("Split by")).toBeNull();
      expect(screen.queryByText("Create metric…")).toBeNull();
    },
  );

  test("English reads as it always did", async () => {
    await renderInLanguage("en");

    expect(toolbarSelects().map(captionOf)).toEqual(CAPTIONS);
    expect(choicesOf(selectCaptioned("en", "Measure"))).toEqual(
      labelsOf(MEASURE_CHOICES),
    );
    expect(screen.getByRole("button", { name: CREATE_METRIC })).toBeVisible();
  });

  test("every word the English toolbar draws is one these tests check, or one drawn as written", async () => {
    await renderInLanguage("en");

    const drawnWords: Array<string> = [
      ...toolbarSelects().flatMap((select: HTMLSelectElement) => {
        return [captionOf(select), ...choicesOf(select)];
      }),
      CREATE_METRIC,
      screen
        .getByRole("button", { name: CREATE_METRIC })
        .getAttribute("title") || "",
    ];

    const asWritten: Array<string> = [
      ...SPAN_TYPE_CHOICES,
      ...ATTRIBUTE_KEYS,
      ...TOP_CHOICES,
    ];

    expect(
      drawnWords.filter((word: string): boolean => {
        return !asWritten.includes(word) && !TOOLBAR_WORDS.includes(word);
      }),
    ).toEqual([]);
  });
});
