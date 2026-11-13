/** @timezone UTC */

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
  within,
} from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * An embedded logs list with nothing in it says each thing once, in the
 * reader's language.
 *
 * The empty list is the shared LogsTable's: the title "No logs found", and
 * under it the line the embedding page hands over. About twenty pages
 * handed over a line that said the title again ("No logs found / No logs
 * found for this host. Make sure your OTel collector..."), and the title and
 * the table's own hint were English in twelve of the sixteen languages.
 *
 * Drawn here by the real Dashboard LogsViewer over the real Common one, with
 * the Dashboard's shipped locale files and a mocked data layer that answers
 * an empty window. The App guard LogsEmptyHintsGuard holds every embed's line
 * to the same rule.
 */

const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const analyticsCountMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

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

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return analyticsGetListMock(...args);
      },
      count: (...args: Array<any>) => {
        return analyticsCountMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: Error) => {
        return error?.message || "error";
      },
      getFriendlyErrorMessage: (error: Error) => {
        return error?.message || "error";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock("../../../UI/Utils/Realtime", () => {
  return {
    __esModule: true,
    default: {
      listenToAnalyticsModelEvent: () => {
        return () => {};
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

jest.mock("recharts", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  const chart: (props: {
    children?: React.ReactNode;
  }) => React.ReactElement = (props: {
    children?: React.ReactNode;
  }): React.ReactElement => {
    return react.createElement("div", null, props.children);
  };

  const nothing: () => null = (): null => {
    return null;
  };

  return {
    __esModule: true,
    ResponsiveContainer: (props: { children: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
    AreaChart: chart,
    BarChart: chart,
    Area: nothing,
    Bar: nothing,
    XAxis: nothing,
    YAxis: nothing,
    CartesianGrid: nothing,
    Tooltip: nothing,
    ReferenceArea: nothing,
  };
});

import DashboardLogsViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer";
import {
  LOGS_TABLE_EMPTY_HINT,
  LOGS_TABLE_EMPTY_TITLE,
} from "../../../UI/Components/LogsViewer/components/LogsTable";
import { LOGS_VIEWER_TOOLBAR_TEST_ID } from "../../../UI/Components/LogsViewer/components/LogsViewerToolbar";
import {
  LOGS_NARROWED_EMPTY_HINT,
  LOGS_TIME_RANGE_EMPTY_HINT,
} from "../../../UI/Components/LogsViewer/LogsViewer";
import {
  getTimeRangeButtonLabel,
  getTimeRangeLabel,
} from "../../../UI/Components/Date/TimeRangePickerDropdown";
import Log from "../../../Models/AnalyticsModels/Log";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Query from "../../../Types/BaseDatabase/Query";
import OneUptimeDate from "../../../Types/Date";
import { setDateDisplayLanguage } from "../../../Types/DateLanguage";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const LANGUAGES: Array<string> = ["de", "it", "ja", "fa"];

// The explorer's time range sentence is read in these, Arabic among them.
const SENTENCE_LANGUAGES: Array<string> = [...LANGUAGES, "ar"];

// The line a host's Logs tab hands over (Pages/Host/View/Logs.tsx).
const HOST_HINT: string =
  "Make sure your OTel collector forwards logs with the host.name resource attribute.";

// The line a service's Logs tab hands over (Pages/Service/View/Logs.tsx).
const SERVICE_HINT: string =
  "Logs appear here as soon as this service sends them.";

const HOST_QUERY: Query<Log> = {
  attributes: { "resource.host.name": "web-01" },
} as unknown as Query<Log>;

const NOW: Date = new Date("2026-10-26T12:00:00.000Z");

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

const LOCALES: Record<string, Record<string, string>> = {
  en: readLocale("en"),
};

for (const language of SENTENCE_LANGUAGES) {
  LOCALES[language] = readLocale(language);
}

async function settle(): Promise<void> {
  for (let round: number = 0; round < 6; round++) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

// The empty block of a list the window left with no line in it.
async function mountEmpty(noLogsMessage: string): Promise<HTMLElement> {
  await act(async () => {
    render(
      <DashboardLogsViewer
        id="embedded-logs"
        logQuery={HOST_QUERY}
        showFilters={true}
        noLogsMessage={noLogsMessage}
      />,
    );
  });
  await waitFor(() => {
    expect(screen.getByTestId(LOGS_VIEWER_TOOLBAR_TEST_ID)).toBeInTheDocument();
  });
  await settle();

  return await screen.findByTestId("logs-table-empty");
}

// The block once a search the reader typed has emptied the list.
async function searchedEmpty(): Promise<HTMLElement> {
  const box: HTMLElement = screen.getByRole("textbox");
  fireEvent.change(box, { target: { value: "connection refused" } });
  fireEvent.keyDown(box, { key: "Enter", code: "Enter" });
  await settle();

  return await screen.findByTestId("logs-table-empty");
}

// Each line of the block, as a reader sees it.
function linesOf(block: HTMLElement): Array<string> {
  return Array.from(block.querySelectorAll("p")).map(
    (line: HTMLParagraphElement): string => {
      return (line.textContent || "").trim();
    },
  );
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const [language, values] of Object.entries(LOCALES)) {
    resources[language] = { translation: values };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();

  getListMock.mockReset();
  analyticsGetListMock.mockReset();
  analyticsCountMock.mockReset();
  postMock.mockReset();

  getListMock.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 0 };
  });
  analyticsGetListMock.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 100, hasMore: false };
  });
  analyticsCountMock.mockImplementation(async () => {
    return 0;
  });
  postMock.mockImplementation(async (args: unknown) => {
    const url: string = (
      args as { url: { toString: () => string } }
    ).url.toString();
    if (url.endsWith("/telemetry/logs/histogram")) {
      return { data: { bucketSizeInMinutes: 1, buckets: [] } };
    }
    if (url.endsWith("/telemetry/logs/facets")) {
      return { data: { facets: {} } };
    }
    return { data: {} };
  });
});

afterEach(async () => {
  cleanup();
  jest.useRealTimers();
  await readIn("en");
});

describe("an embedded logs list with nothing in it", () => {
  test("says the title once, then the page's own line", async () => {
    const block: HTMLElement = await mountEmpty(HOST_HINT);

    expect(linesOf(block)).toEqual([LOGS_TABLE_EMPTY_TITLE, HOST_HINT]);
    expect(
      within(block).getAllByText(LOGS_TABLE_EMPTY_TITLE, { exact: false }),
    ).toHaveLength(1);
  });

  test("a service's list says how its logs get here", async () => {
    const block: HTMLElement = await mountEmpty(SERVICE_HINT);

    expect(linesOf(block)).toEqual([LOGS_TABLE_EMPTY_TITLE, SERVICE_HINT]);
  });

  test("a line that only says the title again gives way to the table's hint", async () => {
    const block: HTMLElement = await mountEmpty("No logs found");

    expect(linesOf(block)).toEqual([
      LOGS_TABLE_EMPTY_TITLE,
      LOGS_TABLE_EMPTY_HINT,
    ]);
  });

  test("a search that empties the list says what to try, not how logs get here", async () => {
    await mountEmpty(HOST_HINT);

    const block: HTMLElement = await searchedEmpty();

    expect(linesOf(block)).toEqual([
      LOGS_TABLE_EMPTY_TITLE,
      LOGS_NARROWED_EMPTY_HINT,
    ]);
  });

  test("what to try is a key, translated in each language read here", () => {
    const untranslated: Array<string> = Object.keys(LOCALES).filter(
      (language: string): boolean => {
        return (
          language !== "en" &&
          LOCALES[language]![LOGS_NARROWED_EMPTY_HINT] ===
            LOGS_NARROWED_EMPTY_HINT
        );
      },
    );

    expect(LOCALES["en"]![LOGS_NARROWED_EMPTY_HINT]).toBe(
      LOGS_NARROWED_EMPTY_HINT,
    );
    expect(untranslated).toEqual([]);
  });

  for (const language of LANGUAGES) {
    test(`a search that empties the list says what to try in ${language}`, async () => {
      await readIn(language);

      await mountEmpty(HOST_HINT);
      const block: HTMLElement = await searchedEmpty();
      const words: Record<string, string> = LOCALES[language]!;

      expect(linesOf(block)).toEqual([
        words[LOGS_TABLE_EMPTY_TITLE],
        words[LOGS_NARROWED_EMPTY_HINT],
      ]);
      expect(words[LOGS_NARROWED_EMPTY_HINT]).not.toBe(
        LOGS_NARROWED_EMPTY_HINT,
      );
    });

    test(`reads wholly in ${language}: the title and the page's line`, async () => {
      await readIn(language);

      const block: HTMLElement = await mountEmpty(HOST_HINT);
      const lines: Array<string> = linesOf(block);
      const words: Record<string, string> = LOCALES[language]!;

      expect(lines).toEqual([words[LOGS_TABLE_EMPTY_TITLE], words[HOST_HINT]]);
      // Translated, not the English shown as a fallback.
      expect(lines[0]).not.toBe(LOGS_TABLE_EMPTY_TITLE);
      expect(lines[1]).not.toBe(HOST_HINT);
    });

    test(`the table's own hint reads in ${language} too`, async () => {
      await readIn(language);

      const block: HTMLElement = await mountEmpty("No logs found");
      const words: Record<string, string> = LOCALES[language]!;

      expect(linesOf(block)).toEqual([
        words[LOGS_TABLE_EMPTY_TITLE],
        words[LOGS_TABLE_EMPTY_HINT],
      ]);
      expect(words[LOGS_TABLE_EMPTY_HINT]).not.toBe(LOGS_TABLE_EMPTY_HINT);
    });
  }
});

/*
 * THE EXPLORER'S TIME RANGE SENTENCE, IN THE READER'S LANGUAGE (issue #7280).
 *
 * A list no page hands a line to says what window it searched and what to
 * try: "Time range: past 1 hour. Try adjusting filters or expanding the time
 * range." That sentence was English in every language. It is one key now,
 * worded in each of the Dashboard's languages, with the window as its value:
 * a preset named as the picker names it, a custom window written as the
 * picker's button writes it, in the reader's language and digits, and set
 * apart in a sentence read right to left so its two ends read in order.
 */

const NO_BREAK_SPACE: string = String.fromCharCode(0x00a0);
const ANY_SPACE: RegExp = /\s/g;
const LATIN_DIGIT: RegExp = /[0-9]/;

// A full stop, then another: "ق.ظ.." where the window ended the sentence.
const TWO_FULL_STOPS: RegExp = /\.\s*\./;

// Today, 08:00 to 09:30 UTC (NOW is 12:00): a window written without years.
const MORNING_WINDOW: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-10-26T08:00:00.000Z"),
    new Date("2026-10-26T09:30:00.000Z"),
  ),
};

function spaced(text: string): string {
  return text.replace(ANY_SPACE, " ");
}

// What a reader reads: no isolate marks, any space a space.
function readAs(text: string): string {
  return spaced(withoutIsolateMarks(text));
}

// The preset, as the shipped locale names it inside a sentence.
function presetIn(language: string, range: TimeRange): string {
  return dashboardTranslator(language).translateTerm(getTimeRangeLabel(range), {
    inSentence: true,
  });
}

// The sentence the shipped locale words, with `range` in its place.
function sentenceIn(language: string, range: string): string {
  const words: string | undefined =
    LOCALES[language]![LOGS_TIME_RANGE_EMPTY_HINT];

  expect({ language, worded: words !== LOGS_TIME_RANGE_EMPTY_HINT }).toEqual({
    language,
    worded: true,
  });

  return spaced(words!.replace("{{range}}", range));
}

// The custom window as the picker's button writes it in `language`.
function buttonLabelIn(
  language: string,
  value: RangeStartAndEndDateTime,
): string {
  setDateDisplayLanguage(language);

  try {
    return spaced(getTimeRangeButtonLabel(value));
  } finally {
    setDateDisplayLanguage(null);
  }
}

// The block of a list no page hands a line to, over `timeRangeOverride`.
async function mountUnhinted(
  timeRangeOverride?: RangeStartAndEndDateTime,
): Promise<HTMLElement> {
  await act(async () => {
    render(
      <DashboardLogsViewer
        id="explorer-logs"
        logQuery={HOST_QUERY}
        showFilters={true}
        timeRangeOverride={timeRangeOverride}
      />,
    );
  });
  await waitFor(() => {
    expect(screen.getByTestId(LOGS_VIEWER_TOOLBAR_TEST_ID)).toBeInTheDocument();
  });
  await settle();

  return await screen.findByTestId("logs-table-empty");
}

// The block's lines as drawn, isolate marks and all.
function drawnLinesOf(block: HTMLElement): Array<string> {
  return Array.from(block.querySelectorAll("p")).map(
    (line: HTMLParagraphElement): string => {
      return line.textContent || "";
    },
  );
}

describe("the explorer's time range sentence, with the shipped locale files", () => {
  beforeEach(() => {
    // A 24-hour reader: "08:00". The 12-hour one is below.
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    setDateDisplayLanguage(null);
  });

  test("English is as it was: the preset in English's words", async () => {
    const block: HTMLElement = await mountUnhinted();

    expect(linesOf(block)).toEqual([
      LOGS_TABLE_EMPTY_TITLE,
      "Time range: past 1 hour. Try adjusting filters or expanding the time range.",
    ]);
    // The English sentence is the key itself.
    expect(LOCALES["en"]![LOGS_TIME_RANGE_EMPTY_HINT]).toBe(
      LOGS_TIME_RANGE_EMPTY_HINT,
    );
  });

  test("English, a custom window: its two ends, each kept whole", async () => {
    const block: HTMLElement = await mountUnhinted(MORNING_WINDOW);
    const line: string = drawnLinesOf(block)[1]!;

    expect(spaced(line)).toBe(
      "Time range: Oct 26, 08:00 – Oct 26, 09:30. Try adjusting filters or expanding the time range.",
    );
    // A window too long for its line breaks only between its two ends.
    expect(line).toContain(
      `Oct${NO_BREAK_SPACE}26,${NO_BREAK_SPACE}08:00${NO_BREAK_SPACE}– Oct${NO_BREAK_SPACE}26,${NO_BREAK_SPACE}09:30`,
    );
    // Nothing set apart in a sentence read left to right.
    expect(line).toBe(withoutIsolateMarks(line));
  });

  for (const language of SENTENCE_LANGUAGES) {
    test(`${language}: the sentence and the preset in the reader's language`, async () => {
      await readIn(language);

      const block: HTMLElement = await mountUnhinted();
      const lines: Array<string> = drawnLinesOf(block).map(readAs);
      const preset: string = presetIn(language, TimeRange.PAST_ONE_HOUR);

      expect(lines).toEqual([
        LOCALES[language]![LOGS_TABLE_EMPTY_TITLE],
        sentenceIn(language, spaced(preset)),
      ]);
      // Neither the English sentence nor the English preset is left.
      expect(lines[1]).not.toContain("Try adjusting filters");
      expect(lines[1]).not.toContain("Time range");
      expect(lines[1]).not.toContain("past 1 hour");
      expect(preset).not.toBe("past 1 hour");
    });

    test(`${language}: a custom window as the picker's button writes it, in the sentence`, async () => {
      await readIn(language);

      const block: HTMLElement = await mountUnhinted(MORNING_WINDOW);
      const line: string = readAs(drawnLinesOf(block)[1]!);

      expect(line).toBe(
        sentenceIn(language, buttonLabelIn(language, MORNING_WINDOW)),
      );
      expect(line).not.toContain("Try adjusting filters");
      expect(line).not.toContain("Oct");
    });
  }

  test.each<[string, string]>([
    [
      "de",
      "Zeitraum: 26. Okt., 08:00 – 26. Okt., 09:30. Passen Sie die Filter an oder erweitern Sie den Zeitraum.",
    ],
    [
      "it",
      "Intervallo di tempo: 26 ott, 08:00 – 26 ott, 09:30. Prova a modificare i filtri o ad ampliare l'intervallo di tempo.",
    ],
    [
      "ja",
      "時間範囲: 10月26日 08:00 – 10月26日 09:30。フィルターを調整するか、時間範囲を広げてみてください。",
    ],
  ])("%s, word for word: %s", async (language: string, sentence: string) => {
    await readIn(language);

    const block: HTMLElement = await mountUnhinted(MORNING_WINDOW);

    expect(readAs(drawnLinesOf(block)[1]!)).toBe(sentence);
  });

  test("Persian: Persian digits, no Latin one, the window set apart and read start then end", async () => {
    await readIn("fa");

    const block: HTMLElement = await mountUnhinted(MORNING_WINDOW);
    const drawn: string = drawnLinesOf(block)[1]!;
    const read: string = readAs(drawn);

    expect(read.startsWith("بازهٔ زمانی: ")).toBe(true);
    expect(read).toContain("۰۸:۰۰");
    expect(read).toContain("۰۹:۳۰");
    expect(read).not.toMatch(LATIN_DIGIT);
    expect(read.indexOf("۰۸:۰۰")).toBeLessThan(read.indexOf("۰۹:۳۰"));

    // The whole window, in one isolate: its ends never swap places.
    const window: string = read.slice("بازهٔ زمانی: ".length).split(". ")[0]!;
    expect(spaced(drawn)).toContain(spaced(isolated(window)));
  });

  test("Arabic, on a 12-hour clock: Latin digits, no leading zero, the window set apart", async () => {
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(true);
    await readIn("ar");

    const block: HTMLElement = await mountUnhinted(MORNING_WINDOW);
    const drawn: string = drawnLinesOf(block)[1]!;

    expect(readAs(drawn)).toBe(
      "النطاق الزمني: 26 أكتوبر، 8:00 ص – 26 أكتوبر، 9:30 ص. جرّب تعديل عوامل التصفية أو توسيع النطاق الزمني.",
    );
    expect(spaced(drawn)).toContain(
      spaced(isolated("26 أكتوبر، 8:00 ص – 26 أكتوبر، 9:30 ص")),
    );
    expect(drawn).not.toContain("08:00");
  });

  test("Persian, on a 12-hour clock: the window's ق.ظ. ends the sentence, with one full stop", async () => {
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(true);
    await readIn("fa");

    const block: HTMLElement = await mountUnhinted(MORNING_WINDOW);
    const drawn: string = drawnLinesOf(block)[1]!;
    const read: string = readAs(drawn);

    // "ق.ظ.." read as a typo: one full stop, then the next sentence.
    expect(read).not.toMatch(TWO_FULL_STOPS);
    expect(read).toContain("۹:۳۰ ق.ظ. فیلترها");
    expect(read).toContain("۸:۰۰ ق.ظ. –");
    // The window is still set apart, its own letters inside, the stop after.
    expect(spaced(drawn)).toContain(
      spaced(`${isolated("۲۶ اکتبر، ۸:۰۰ ق.ظ. – ۲۶ اکتبر، ۹:۳۰ ق.ظ")}.`),
    );
  });

  test("the sentence is worded in every language read here, its window kept", () => {
    for (const language of SENTENCE_LANGUAGES) {
      const words: string = LOCALES[language]![LOGS_TIME_RANGE_EMPTY_HINT]!;

      expect({ language, words: words !== LOGS_TIME_RANGE_EMPTY_HINT }).toEqual(
        { language, words: true },
      );
      expect({ language, range: words.split("{{range}}").length }).toEqual({
        language,
        range: 2,
      });
    }
  });
});
