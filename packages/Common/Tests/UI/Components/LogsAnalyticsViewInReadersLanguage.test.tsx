import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import {
  getShownDropdownPlaceholder,
  getShownDropdownValue,
  listDropdownOptions,
  pickDropdownOption,
} from "../../DropdownPicks";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * LOGS > ANALYTICS: THE QUERY BUILDER IN THE READER'S LANGUAGE (#9348).
 *
 * The query builder's captions (Chart, Measure, of, Group by, then by,
 * Limit) and its fixed choices (Timeseries, Top List, Table, Count, Unique
 * Count, a log's own fields, None, Select field...) were drawn as written,
 * English in every language. They are keys now, looked up where they are
 * drawn, as Traces > Analytics looks up its own; an attribute's key is
 * still drawn as written.
 *
 * Drawn from the Dashboard's own locale files, in German and Japanese, and
 * with every word worded as a probe that is itself a key reading TWICE: a
 * word looked up twice would say so.
 */

// The rows each analytics read answers with: none, unless a test sets some.
let mockAnalyticsRows: Array<unknown> = [];

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: async () => {
        return { data: { data: mockAnalyticsRows } };
      },
      getFriendlyMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/Telemetry/UseTelemetryEntityNames", () => {
  return {
    __esModule: true,
    default: () => {
      return new Map();
    },
  };
});

// Imported after the mocks so the view picks them up.
import LogsAnalyticsView, {
  LOGS_ANALYTICS_CAPTIONS,
  LOGS_ANALYTICS_CHART_OPTIONS,
  LOGS_ANALYTICS_CHOOSE_ATTRIBUTE,
  LOGS_ANALYTICS_CHOOSE_FIELD,
  LOGS_ANALYTICS_CHOOSE_FIELD_TEST_ID,
  LOGS_ANALYTICS_MEASURE_OPTIONS,
  LOGS_ANALYTICS_VALUE_LABELS,
} from "../../../UI/Components/LogsViewer/components/LogsAnalyticsView";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

const HOUR_WINDOW: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-09-28T11:00:00.000Z"),
    new Date("2026-09-28T12:00:00.000Z"),
  ),
};

// An attribute's key: drawn as written in every language.
const ATTRIBUTE: string = "http.method";

const LOG_FIELDS: Array<string> = [
  "Severity",
  "Service",
  "Trace ID",
  "Span ID",
];

const WORDS: Array<string> = [
  ...Object.values(LOGS_ANALYTICS_CAPTIONS),
  ...LOGS_ANALYTICS_CHART_OPTIONS.map((option: { label: string }) => {
    return option.label;
  }),
  ...LOGS_ANALYTICS_MEASURE_OPTIONS.map((option: { label: string }) => {
    return option.label;
  }),
  ...LOG_FIELDS,
  "None",
  "Select field...",
  /*
   * What the chart says it measures ("P95 of duration_ms"), and what to
   * pick while a measure has no field (#7716).
   */
  ...Object.values(LOGS_ANALYTICS_VALUE_LABELS),
  LOGS_ANALYTICS_CHOOSE_ATTRIBUTE,
  LOGS_ANALYTICS_CHOOSE_FIELD,
];

const TWICE: string = "TWICE";

const probeOf: (text: string) => string = (text: string): string => {
  return `DE› ${text}`;
};

const realI18n: i18n = createInstance();
const probedI18n: i18n = createInstance();

beforeAll(async () => {
  const probed: Record<string, string> = { ...readDashboardLocale("de") };

  for (const word of WORDS) {
    probed[word] = probeOf(word);
    probed[probeOf(word)] = TWICE;
  }

  await realI18n.init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      de: { translation: readDashboardLocale("de") },
      ja: { translation: readDashboardLocale("ja") },
    },
    interpolation: { escapeValue: false },
  });

  await probedI18n.init({
    lng: "de",
    fallbackLng: "en",
    resources: { de: { translation: probed } },
    interpolation: { escapeValue: false },
  });
});

afterEach(() => {
  cleanup();
  mockAnalyticsRows = [];
});

async function drawIn(instance: i18n, language: string): Promise<void> {
  await act(async () => {
    await instance.changeLanguage(language);
  });

  render(
    <I18nextProvider i18n={instance}>
      <LogsAnalyticsView
        timeRange={HOUR_WINDOW}
        appliedFacetFilters={new Map()}
        logAttributes={[ATTRIBUTE]}
      />
    </I18nextProvider>,
  );

  await waitFor(() => {
    expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0);
  });
}

function wordOf(language: string, text: string): string {
  return readDashboardLocale(language)[text] || text;
}

function picker(name: string): HTMLElement {
  return screen.getByRole("combobox", { name });
}

describe("every word of the query builder", () => {
  test("is worded in every language the Dashboard offers", () => {
    const unworded: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      for (const word of WORDS) {
        if (!isWordedInDashboardLocale(word, language)) {
          unworded.push(`${language}: ${word}`);
        }
      }
    }

    expect(unworded).toEqual([]);
  });

  test("is looked up once, where it is drawn", async () => {
    await drawIn(probedI18n, "de");

    for (const caption of [
      LOGS_ANALYTICS_CAPTIONS.chart,
      LOGS_ANALYTICS_CAPTIONS.measure,
      LOGS_ANALYTICS_CAPTIONS.groupBy,
      LOGS_ANALYTICS_CAPTIONS.thenBy,
    ]) {
      expect(screen.getByText(probeOf(caption))).toBeInTheDocument();
      expect(picker(probeOf(caption))).toBeInTheDocument();
    }

    expect(getShownDropdownValue(picker(probeOf("Chart")))).toBe(
      probeOf("Timeseries"),
    );
    expect(getShownDropdownValue(picker(probeOf("Measure")))).toBe(
      probeOf("Count"),
    );
    expect(getShownDropdownValue(picker(probeOf("Group by")))).toBe(
      probeOf("Severity"),
    );
    expect(getShownDropdownPlaceholder(picker(probeOf("then by")))).toBe(
      probeOf("None"),
    );
    expect(document.body).not.toHaveTextContent(TWICE);
  });
});

describe("in German", () => {
  test("the captions, the charts, the measures and a log's own fields read in German; an attribute as written", async () => {
    await drawIn(realI18n, "de");

    const chart: HTMLElement = picker(wordOf("de", "Chart"));

    expect(getShownDropdownValue(chart)).toBe(wordOf("de", "Timeseries"));
    expect(await listDropdownOptions(chart)).toEqual(
      ["Timeseries", "Top List", "Table"].map((text: string) => {
        return wordOf("de", text);
      }),
    );

    const measure: HTMLElement = picker(wordOf("de", "Measure"));

    expect(await listDropdownOptions(measure)).toEqual(
      LOGS_ANALYTICS_MEASURE_OPTIONS.map((option: { label: string }) => {
        return wordOf("de", option.label);
      }),
    );
    expect(wordOf("de", "Average")).not.toBe("Average");

    const groupBy: HTMLElement = picker(wordOf("de", "Group by"));

    expect(getShownDropdownValue(groupBy)).toBe(wordOf("de", "Severity"));
    expect(await listDropdownOptions(groupBy)).toEqual([
      ...LOG_FIELDS.map((text: string) => {
        return wordOf("de", text);
      }),
      ATTRIBUTE,
    ]);

    expect(getShownDropdownPlaceholder(picker(wordOf("de", "then by")))).toBe(
      wordOf("de", "None"),
    );

    // A Unique Count asks "of" which field, in German.
    await pickDropdownOption(measure, wordOf("de", "Unique Count"));

    expect(
      getShownDropdownPlaceholder(
        await screen.findByRole("combobox", {
          name: wordOf("de", "of"),
        }),
      ),
    ).toBe(wordOf("de", "Select field..."));

    // A top list's Limit, in German, over its numbers as written.
    await pickDropdownOption(chart, wordOf("de", "Top List"));

    const limit: HTMLElement = await screen.findByRole("combobox", {
      name: wordOf("de", "Limit"),
    });

    expect(await listDropdownOptions(limit)).toEqual(["5", "10", "25", "50"]);

    // None of the English a German reader used to meet.
    for (const english of ["Group by", "then by", "Timeseries", "Measure"]) {
      expect(document.body).not.toHaveTextContent(english);
    }
  });
});

/*
 * A measure of a number (#7716): what to pick while it has no attribute,
 * and what the chart says it measures, in German - the attribute's key as
 * written.
 */
describe("a measure of a number, in German", () => {
  test("asks for its attribute, then says it charts the P95 of it", async () => {
    mockAnalyticsRows = [
      { time: "2026-09-28 11:00:00", count: 182.25, groupValues: {} },
    ];

    await drawIn(realI18n, "de");

    await pickDropdownOption(picker(wordOf("de", "Measure")), "P95");

    expect(
      await screen.findByTestId(LOGS_ANALYTICS_CHOOSE_FIELD_TEST_ID),
    ).toHaveTextContent(wordOf("de", LOGS_ANALYTICS_CHOOSE_ATTRIBUTE));
    expect(wordOf("de", LOGS_ANALYTICS_CHOOSE_ATTRIBUTE)).not.toBe(
      LOGS_ANALYTICS_CHOOSE_ATTRIBUTE,
    );

    await pickDropdownOption(
      await screen.findByRole("combobox", { name: wordOf("de", "of") }),
      ATTRIBUTE,
    );

    const label: string = wordOf("de", "P95 of {{attribute}}").replace(
      "{{attribute}}",
      ATTRIBUTE,
    );

    expect(label).toBe(`P95 von ${ATTRIBUTE}`);
    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("P95 of");
  });
});

describe("in Japanese", () => {
  test("the captions and the chart read in Japanese", async () => {
    await drawIn(realI18n, "ja");

    expect(screen.getByText(wordOf("ja", "Group by"))).toBeInTheDocument();
    expect(getShownDropdownValue(picker(wordOf("ja", "Chart")))).toBe(
      wordOf("ja", "Timeseries"),
    );
    expect(getShownDropdownValue(picker(wordOf("ja", "Group by")))).toBe(
      wordOf("ja", "Severity"),
    );
    expect(wordOf("ja", "Group by")).not.toBe("Group by");
  });
});
