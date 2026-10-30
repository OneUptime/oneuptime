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
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ---------------------------------------------------------------------------
 * The charts' zoom hints, and the analytics charts' empty state, in every
 * Dashboard language
 * ---------------------------------------------------------------------------
 *
 * Traces > Analytics drew its zoom hint in English in every language - "Click
 * or drag to zoom", with " · double-click to reset" glued on while zoomed -
 * and so did its empty chart, "No data available for the selected query".
 * The hint's words are shared: the shared TimeRangeZoomHint every chart card
 * draws (resource overviews, SLOs, the AI chat's charts, network traffic,
 * exceptions...) and the dashboard widgets' hint drew them in English too,
 * and the whole lines ("Drag to zoom · double-click to reset") were English
 * in most locales, where the metric charts and the logs Analytics view
 * already looked them up.
 *
 * Each is translated where it is defined now: the shared hint and the
 * widgets' hint look their words up, the traces Analytics view words each
 * hint whole as the logs one does, and every locale has its own words for
 * every hint. The REAL components are mounted under an i18next instance per
 * language, built from the Dashboard's own locale files the way
 * Utils/i18n.ts builds the Dashboard's.
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

  const nothing: () => null = (): null => {
    return null;
  };

  return {
    __esModule: true,
    ResponsiveContainer: chart,
    BarChart: chart,
    LineChart: chart,
    AreaChart: chart,
    Bar: nothing,
    Line: nothing,
    Area: nothing,
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

import DashboardWidgetZoomHint, {
  DASHBOARD_WIDGET_ZOOM_HINT_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetZoomHint";
import TracesAnalyticsView, {
  TRACES_ANALYTICS_ZOOM_HINT_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesAnalyticsView";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import { TimeRangeZoomProvider } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import TimeRangeZoomHint, {
  TIME_RANGE_ZOOM_HINT_RESET_TEXT,
  TIME_RANGE_ZOOM_HINT_TEST_ID,
  TIME_RANGE_ZOOM_HINT_TEXT,
} from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";

jest.setTimeout(120000);

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

const DASHBOARD_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard",
);
const LOCALES_DIR: string = path.join(DASHBOARD_DIR, "src", "Locales");
const DOCS_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Docs/Content",
);

type Locale = Record<string, unknown>;

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
  LOCALES[language] = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Locale;
}
const ENGLISH: Locale = LOCALES["en"] as Locale;

// What the Dashboard draws for an English text: the locale's, or English.
const drawn: (language: string, english: string) => string = (
  language: string,
  english: string,
): string => {
  const value: unknown = (LOCALES[language] as Locale)[english];

  return typeof value === "string" && value.trim() ? value : english;
};

const DRAG: string = "Drag to zoom";
const CLICK_OR_DRAG: string = "Click or drag to zoom";
const RESET: string = "Double-click to reset";
const DRAG_AND_RESET: string = "Drag to zoom · double-click to reset";
const CLICK_OR_DRAG_AND_RESET: string =
  "Click or drag to zoom · double-click to reset";
// The way back alone, as the docs quote it: the second half of a whole line.
const RESET_HALF: string = " · double-click to reset";
const EMPTY: string = "No data available for the selected query";

const SEPARATOR: string = " · ";

const WORDS: Array<string> = [
  DRAG,
  CLICK_OR_DRAG,
  RESET,
  DRAG_AND_RESET,
  CLICK_OR_DRAG_AND_RESET,
  RESET_HALF,
  EMPTY,
];

// The two halves of a whole line, as the language says them.
const halvesOf: (line: string) => [string, string] = (
  line: string,
): [string, string] => {
  const at: number = line.indexOf(SEPARATOR);
  expect(at).toBeGreaterThan(0);

  return [line.slice(0, at), line.slice(at + SEPARATOR.length)];
};

const INSTANCES: Record<string, i18n> = {};

const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 20);
    });
  });
};

const inLanguage: (
  language: string,
  element: React.ReactElement,
) => React.ReactElement = (
  language: string,
  element: React.ReactElement,
): React.ReactElement => {
  return (
    <I18nextProvider i18n={INSTANCES[language] as i18n}>
      {element}
    </I18nextProvider>
  );
};

// A page's zoom, as useTimeRangeZoom hands it to the charts.
const pageZoom: (isZoomed: boolean) => {
  isZoomed: boolean;
  rangeBeforeZoom: { range: TimeRange } | null;
  zoomToTimeRange: () => void;
  resetZoom: () => void;
} = (isZoomed: boolean) => {
  return {
    isZoomed: isZoomed,
    rangeBeforeZoom: isZoomed ? { range: TimeRange.PAST_ONE_DAY } : null,
    zoomToTimeRange: (): void => {
      return undefined;
    },
    resetZoom: (): void => {
      return undefined;
    },
  };
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

let isAnswerEmpty: boolean = false;

beforeEach(() => {
  isAnswerEmpty = false;
  getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT_ID));
  getListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
  apiPostMock.mockImplementation(async () => {
    if (isAnswerEmpty) {
      return { data: { data: [] } };
    }

    return {
      data: {
        data: [
          {
            time: "2026-10-30T10:00:00.000Z",
            value: 5,
            groupValues: { name: "GET /orders" },
          },
          {
            time: "2026-10-30T10:05:00.000Z",
            value: 3,
            groupValues: { name: "GET /orders" },
          },
        ],
      },
    };
  });
});

afterEach(() => {
  cleanup();
  apiPostMock.mockReset();
  getListMock.mockReset();
  getCurrentProjectIdMock.mockReset();
});

describe("the zoom hints and the empty chart, in the Dashboard's locales", () => {
  test("every Dashboard language is read: English and the 16 others", () => {
    expect(LANGUAGES).toHaveLength(17);
  });

  test("each is a key of the Dashboard's English, drawn as itself", () => {
    expect(
      WORDS.filter((word: string): boolean => {
        return ENGLISH[word] !== word;
      }),
    ).toEqual([]);
    // The shared hint's own words are two of them.
    expect([
      TIME_RANGE_ZOOM_HINT_TEXT,
      TIME_RANGE_ZOOM_HINT_RESET_TEXT,
    ]).toEqual([DRAG, RESET]);
  });

  test.each(OTHER_LANGUAGES)(
    "%s has its own words for each",
    (language: string) => {
      const locale: Locale = LOCALES[language] as Locale;

      expect(
        WORDS.filter((word: string): boolean => {
          const value: unknown = locale[word];

          return typeof value !== "string" || !value.trim() || value === word;
        }),
      ).toEqual([]);
    },
  );

  /*
   * A whole line is the two hints it joins, as the language says each on
   * its own: the gesture first, then the way back - the words the docs
   * quote, so a reader finds on the chart what the page told them.
   */
  test.each(LANGUAGES)(
    "%s says each whole line in the words of the hints it joins",
    (language: string) => {
      const half: string = drawn(language, RESET_HALF).replace(/^\s*·\s*/, "");

      for (const [line, gesture] of [
        [DRAG_AND_RESET, DRAG],
        [CLICK_OR_DRAG_AND_RESET, CLICK_OR_DRAG],
      ] as Array<[string, string]>) {
        expect(halvesOf(drawn(language, line))).toEqual([
          drawn(language, gesture),
          half,
        ]);
      }

      // The way back reads as the standalone hint does, but for its capital.
      expect(half.toLocaleLowerCase(language)).toBe(
        drawn(language, RESET).toLocaleLowerCase(language),
      );
      expect(drawn(language, RESET_HALF).startsWith(SEPARATOR)).toBe(true);
    },
  );

  test.each(LANGUAGES)(
    "%s's docs quote the way back as the charts draw it",
    (language: string) => {
      const page: string = fs.readFileSync(
        path.join(DOCS_DIR, language, "telemetry", "charts-and-time-ranges.md"),
        "utf8",
      );
      const half: string = drawn(language, RESET_HALF).replace(/^\s*·\s*/, "");

      expect(page).toContain(`**${half}**`);
      expect(page).toContain(`**${drawn(language, DRAG)}**`);
      expect(page).toContain(`**${drawn(language, CLICK_OR_DRAG)}**`);
      if (language !== "en") {
        expect(page).not.toContain("**double-click to reset**");
      }
    },
  );
});

describe.each(LANGUAGES)("in %s", (language: string) => {
  test("the shared hint of every chart card says the gesture, and the way back while zoomed", () => {
    const { rerender } = render(
      inLanguage(
        language,
        <TimeRangeZoomProvider zoom={pageZoom(false)}>
          <TimeRangeZoomHint />
        </TimeRangeZoomProvider>,
      ),
    );

    expect(screen.getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)).toHaveTextContent(
      drawn(language, DRAG),
    );

    rerender(
      inLanguage(
        language,
        <TimeRangeZoomProvider zoom={pageZoom(true)}>
          <TimeRangeZoomHint />
        </TimeRangeZoomProvider>,
      ),
    );

    expect(screen.getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)).toHaveTextContent(
      drawn(language, RESET),
    );
  });

  test("a dashboard widget's hint names the gestures it has, as one line", () => {
    const noop: () => void = (): void => {
      return undefined;
    };

    const widgetHint: (
      zoom: {
        onTimeRangeSelect: (() => void) | undefined;
        onTimeRangeReset: (() => void) | undefined;
      },
      isChartShown: boolean,
    ) => string = (
      zoom: {
        onTimeRangeSelect: (() => void) | undefined;
        onTimeRangeReset: (() => void) | undefined;
      },
      isChartShown: boolean,
    ): string => {
      render(
        inLanguage(
          language,
          <DashboardWidgetZoomHint zoom={zoom} isChartShown={isChartShown} />,
        ),
      );
      const text: string =
        screen.getByTestId(DASHBOARD_WIDGET_ZOOM_HINT_TEST_ID).textContent ||
        "";
      cleanup();
      return text;
    };

    expect(
      widgetHint(
        { onTimeRangeSelect: noop, onTimeRangeReset: undefined },
        true,
      ),
    ).toBe(drawn(language, DRAG));
    expect(
      widgetHint({ onTimeRangeSelect: noop, onTimeRangeReset: noop }, true),
    ).toBe(drawn(language, DRAG_AND_RESET));
    expect(
      widgetHint({ onTimeRangeSelect: noop, onTimeRangeReset: noop }, false),
    ).toBe(drawn(language, RESET));
  });

  test("Traces > Analytics names the click, and the way back while zoomed, each as one line", async () => {
    const noop: () => void = (): void => {
      return undefined;
    };

    const { rerender } = render(
      inLanguage(
        language,
        <TracesAnalyticsView
          baseFilters={{}}
          attributeKeys={[]}
          serviceNameMap={{}}
          onTimeRangeSelect={noop}
        />,
      ),
    );

    await waitFor(() => {
      expect(
        screen.getByTestId(TRACES_ANALYTICS_ZOOM_HINT_TEST_ID),
      ).toHaveTextContent(drawn(language, CLICK_OR_DRAG));
    });
    expect(
      screen.getByTestId(TRACES_ANALYTICS_ZOOM_HINT_TEST_ID).textContent,
    ).toBe(drawn(language, CLICK_OR_DRAG));

    rerender(
      inLanguage(
        language,
        <TracesAnalyticsView
          baseFilters={{}}
          attributeKeys={[]}
          serviceNameMap={{}}
          onTimeRangeSelect={noop}
          onTimeRangeReset={noop}
        />,
      ),
    );
    await settle();

    expect(
      screen.getByTestId(TRACES_ANALYTICS_ZOOM_HINT_TEST_ID).textContent,
    ).toBe(drawn(language, CLICK_OR_DRAG_AND_RESET));
  });

  test("Traces > Analytics says there is no data in the language's words", async () => {
    isAnswerEmpty = true;

    render(
      inLanguage(
        language,
        <TracesAnalyticsView
          baseFilters={{}}
          attributeKeys={[]}
          serviceNameMap={{}}
        />,
      ),
    );

    expect(await screen.findByText(drawn(language, EMPTY))).toBeVisible();
    if (language !== "en") {
      expect(screen.queryByText(EMPTY)).toBeNull();
    }
  });
});
