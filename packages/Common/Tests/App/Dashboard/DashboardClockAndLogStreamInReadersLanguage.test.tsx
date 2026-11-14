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
import { Mock } from "jest-mock";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import React from "react";
import { initReactI18next } from "react-i18next";
import DashboardClockComponentElement, {
  CLOCK_DATE_TEST_ID,
  CLOCK_MERIDIEM_TEST_ID,
  CLOCK_TIME_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardClockComponent";
import DashboardLogStreamComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardLogStreamComponent";
import {
  PROPORTIONAL_NUMBERS_CLASS_NAME,
  TABULAR_NUMBERS_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetDigits";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import {
  PublicDashboardContext,
  setPublicDashboardContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardClockComponent, {
  ClockWidgetHourFormat,
} from "../../../Types/Dashboard/DashboardComponents/DashboardClockComponent";
import DashboardLogStreamComponent from "../../../Types/Dashboard/DashboardComponents/DashboardLogStreamComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * A CLOCK'S DATE AND AM/PM, AND A LOG STREAM'S COUNT, IN THE READER'S
 * LANGUAGE (#7093).
 *
 * The Clock widget wrote "Thu, Nov 12" and "PM" on every board, and Latin
 * digits beside Persian words on a Persian one; the Log stream's header
 * said "12 entries" in every language. Each is written in the reader's
 * words now: "Do., 12. Nov." in German, "پنجشنبه ۱۲ نوامبر" and "ب.ظ." in
 * Persian, "午後" before the time in Japanese, "2 Einträge" over a German
 * log stream. An English board reads as it always did, and so does a
 * public dashboard's clock, whose page is English whatever its visitor
 * speaks.
 */

type ListRequest = { query: JSONObject; limit: number };
type ListResponse = { data: Array<JSONObject>; count: number };

const analyticsListMock: Mock<(request: ListRequest) => Promise<ListResponse>> =
  jest.fn<(request: ListRequest) => Promise<ListResponse>>();

// Lazy dereference: jest.mock factories are hoisted above these assignments.
jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (request: ListRequest) => {
        return analyticsListMock(request);
      },
    },
  };
});

// Thursday 12 November 2026, 9:05:07 in the evening in UTC.
const EVENING: Date = new Date("2026-11-12T21:05:07.000Z");

let clockNow: Date = EVENING;

// The clock's own tick, held still so its words can be read.
jest.mock("../../../UI/Utils/UseClockTick", () => {
  return {
    __esModule: true,
    default: (): Date => {
      return clockNow;
    },
  };
});

const LATIN_DIGIT: RegExp = /[0-9]/;

// The English nouns a Log stream's count used to put after it.
const ENGLISH_ENTRY_NOUN: RegExp = /entr(y|ies)/i;

const COMPONENT_ID: ObjectID = new ObjectID(
  "c0000000-0000-4000-8000-0000000070f3",
);

const DASHBOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-11-12T20:00:00.000Z"),
    new Date("2026-11-12T21:00:00.000Z"),
  ),
};

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 60,
};

function baseProps(): DashboardBaseComponentProps {
  return {
    componentId: COMPONENT_ID,
    isEditMode: false,
    isSelected: false,
    key: "worded-widget",
    onComponentUpdate: (): void => {
      // The widgets never write back through this.
    },
    totalCurrentDashboardWidthInPx: 1280,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1280,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 240,
    dashboardComponentWidthInPx: 360,
    dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
    dashboardStartAndEndDate: DASHBOARD_RANGE,
    metricTypes: [],
    refreshTick: 0,
  };
}

async function inLanguage(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of ["en", ...DASHBOARD_LANGUAGES]) {
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
  clockNow = EVENING;
  analyticsListMock.mockReset();
  setPublicDashboardContext(null);
  await inLanguage("en");
});

afterEach(() => {
  cleanup();
  setPublicDashboardContext(null);
});

describe("a Clock's date and AM/PM, in the reader's language", () => {
  function clockComponent(
    hourFormat: ClockWidgetHourFormat = ClockWidgetHourFormat.TwelveHour,
  ): DashboardClockComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentId: COMPONENT_ID,
      componentType: DashboardComponentType.Clock,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      widthInDashboardUnits: 3,
      heightInDashboardUnits: 3,
      minWidthInDashboardUnits: 2,
      minHeightInDashboardUnits: 2,
      arguments: {
        timezone: "UTC",
        label: "Head office",
        hourFormat: hourFormat,
        showSeconds: true,
        showDate: true,
      },
    } as unknown as DashboardClockComponent;
  }

  function renderClock(
    hourFormat: ClockWidgetHourFormat = ClockWidgetHourFormat.TwelveHour,
  ): void {
    render(
      <DashboardClockComponentElement
        {...baseProps()}
        component={clockComponent(hourFormat)}
      />,
    );
  }

  function timeOf(): HTMLElement {
    return screen.getByTestId(CLOCK_TIME_TEST_ID);
  }

  function meridiemOf(): HTMLElement {
    return screen.getByTestId(CLOCK_MERIDIEM_TEST_ID);
  }

  function dateOf(): HTMLElement {
    return screen.getByTestId(CLOCK_DATE_TEST_ID);
  }

  // The meridiem is drawn after the time: "9:05:07 PM".
  function expectMeridiemAfterTheTime(): void {
    expect(timeOf().nextElementSibling).toBe(meridiemOf());
    expect(meridiemOf().style.marginInlineStart).toBe("0.25em");
    expect(meridiemOf().style.marginInlineEnd).toBe("");
  }

  test("an English board's clock reads as it always did", () => {
    renderClock();

    expect(timeOf()).toHaveTextContent("9:05:07");
    expect(timeOf()).toHaveAttribute("dir", "ltr");
    expect(meridiemOf()).toHaveTextContent(/^PM$/);
    expectMeridiemAfterTheTime();
    expect(dateOf()).toHaveTextContent(/^Thu, Nov 12$/);
  });

  test("a German board's clock writes the date in German", async () => {
    await inLanguage("de");
    renderClock();

    expect(dateOf()).toHaveTextContent(/^Do\., 12\. Nov\.$/);
    expect(timeOf()).toHaveTextContent("9:05:07");
    // German has no words of its own for it: Intl writes PM.
    expect(meridiemOf()).toHaveTextContent(/^PM$/);
    expectMeridiemAfterTheTime();
  });

  test("a Persian board's clock writes Persian digits and Persian words", async () => {
    await inLanguage("fa");
    renderClock();

    expect(timeOf()).toHaveTextContent("۹:۰۵:۰۷");
    // Read left to right, seconds last, on a board read from the right.
    expect(timeOf()).toHaveAttribute("dir", "ltr");
    expect(meridiemOf()).toHaveTextContent(/^ب\.ظ\.$/);
    expectMeridiemAfterTheTime();
    expect(dateOf()).toHaveTextContent(/^پنجشنبه ۱۲ نوامبر$/);

    for (const element of [timeOf(), meridiemOf(), dateOf()]) {
      expect(element.textContent).not.toMatch(LATIN_DIGIT);
    }
  });

  test("a Japanese board's clock writes 午後 before the time, and the Japanese date", async () => {
    await inLanguage("ja");
    renderClock();

    expect(meridiemOf()).toHaveTextContent(/^午後$/);
    expect(meridiemOf().nextElementSibling).toBe(timeOf());
    expect(meridiemOf().style.marginInlineEnd).toBe("0.25em");
    expect(meridiemOf().style.marginInlineStart).toBe("");
    expect(timeOf()).toHaveTextContent("9:05:07");
    expect(dateOf()).toHaveTextContent(/^11月12日\(木\)$/);
  });

  test("a Korean and a Chinese board's clocks write their meridiem first too", async () => {
    for (const [language, meridiem] of [
      ["ko", "오후"],
      ["zh-CN", "下午"],
      ["zh-TW", "下午"],
    ] as Array<[string, string]>) {
      await inLanguage(language);
      renderClock();

      expect(meridiemOf()).toHaveTextContent(meridiem);
      expect(meridiemOf().nextElementSibling).toBe(timeOf());
      cleanup();
    }
  });

  test("an Arabic board's clock writes Arabic words with Latin digits", async () => {
    await inLanguage("ar");
    renderClock();

    expect(timeOf()).toHaveTextContent("9:05:07");
    expect(timeOf()).toHaveAttribute("dir", "ltr");
    expect(meridiemOf()).toHaveTextContent(/^م$/);
    expectMeridiemAfterTheTime();
    expect(dateOf()).toHaveTextContent(/^الخميس، 12 نوفمبر$/);
  });

  test("a morning reads AM in the reader's words", async () => {
    clockNow = new Date("2026-11-12T09:05:07.000Z");

    for (const [language, meridiem] of [
      ["en", "AM"],
      ["fa", "ق.ظ."],
      ["ar", "ص"],
      ["ja", "午前"],
    ] as Array<[string, string]>) {
      await inLanguage(language);
      renderClock();

      expect(meridiemOf().textContent).toBe(meridiem);
      cleanup();
    }
  });

  test("a 24-hour clock draws no meridiem, in Persian digits on a Persian board", async () => {
    await inLanguage("fa");
    renderClock(ClockWidgetHourFormat.TwentyFourHour);

    expect(timeOf()).toHaveTextContent("۲۱:۰۵:۰۷");
    expect(screen.queryByTestId(CLOCK_MERIDIEM_TEST_ID)).toBeNull();
  });

  /*
   * Vazirmatn's Persian digits at one width are each as wide as its widest:
   * "۱۱:۲۹" read "۱ ۱:۲ ۹". The hours and minutes take each digit's own
   * width; the seconds, which tick, keep the row's one width, so the line
   * does not shift every second.
   */
  test("a Persian clock's hours and minutes take each digit's own width, its seconds one width", async () => {
    await inLanguage("fa");
    renderClock(ClockWidgetHourFormat.TwentyFourHour);

    const [hoursAndMinutes, seconds] = Array.from(
      timeOf().children,
    ) as Array<HTMLElement>;

    expect(hoursAndMinutes).toHaveTextContent(/^۲۱:۰۵$/);
    expect(hoursAndMinutes).toHaveClass(PROPORTIONAL_NUMBERS_CLASS_NAME);
    expect(seconds).toHaveTextContent(/^:۰۷$/);
    expect(seconds).not.toHaveClass(PROPORTIONAL_NUMBERS_CLASS_NAME);
    expect(timeOf().parentElement).toHaveClass(TABULAR_NUMBERS_CLASS_NAME);
  });

  test("a clock in Latin digits keeps them at one width, as it always did", async () => {
    for (const language of ["en", "ar"]) {
      await inLanguage(language);
      renderClock();

      expect(timeOf().firstElementChild).toHaveTextContent(/^9:05$/);
      expect(timeOf().firstElementChild).toHaveClass(
        TABULAR_NUMBERS_CLASS_NAME,
      );
      expect(timeOf().firstElementChild).not.toHaveClass(
        PROPORTIONAL_NUMBERS_CLASS_NAME,
      );
      cleanup();
    }
  });

  test("the clock follows the reader when they change language", async () => {
    renderClock();
    expect(dateOf()).toHaveTextContent(/^Thu, Nov 12$/);

    await inLanguage("de");
    expect(dateOf()).toHaveTextContent(/^Do\., 12\. Nov\.$/);

    await inLanguage("fa");
    expect(timeOf()).toHaveTextContent("۹:۰۵:۰۷");
    expect(meridiemOf()).toHaveTextContent(/^ب\.ظ\.$/);

    await inLanguage("en");
    expect(dateOf()).toHaveTextContent(/^Thu, Nov 12$/);
    expect(meridiemOf()).toHaveTextContent(/^PM$/);
  });

  test("a public dashboard's clock is English, whatever its visitor speaks", async () => {
    setPublicDashboardContext({
      dashboardId: new ObjectID("d0000000-0000-4000-8000-0000000070f3"),
    } as unknown as PublicDashboardContext);

    for (const language of ["de", "fa", "ja"]) {
      await inLanguage(language);
      renderClock();

      expect(timeOf()).toHaveTextContent("9:05:07");
      expect(meridiemOf()).toHaveTextContent(/^PM$/);
      expectMeridiemAfterTheTime();
      expect(dateOf()).toHaveTextContent(/^Thu, Nov 12$/);
      cleanup();
    }
  });

  test("every Dashboard language writes its own date, never the English one", async () => {
    for (const language of DASHBOARD_LANGUAGES) {
      await inLanguage(language);
      renderClock();

      expect(dateOf().textContent).not.toBe("Thu, Nov 12");
      expect((meridiemOf().textContent || "").trim()).not.toBe("");
      cleanup();
    }
  });
});

describe("a Log stream's count, in the reader's language", () => {
  async function renderLogStream(entries: number): Promise<HTMLElement> {
    const rows: Array<JSONObject> = [];

    for (let index: number = 0; index < entries; index++) {
      rows.push({
        time: new Date(EVENING.getTime() - index * 60_000).toISOString(),
        severityText: "Info",
        body: `Request ${index} served`,
      });
    }

    analyticsListMock.mockResolvedValue({ data: rows, count: entries });

    const component: DashboardLogStreamComponent = {
      _type: ObjectType.DashboardComponent,
      componentId: COMPONENT_ID,
      componentType: DashboardComponentType.LogStream,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 4,
      minWidthInDashboardUnits: 3,
      minHeightInDashboardUnits: 3,
      arguments: { title: "Checkout logs", maxRows: 10 },
    } as unknown as DashboardLogStreamComponent;

    render(
      <DashboardLogStreamComponentElement
        {...baseProps()}
        component={component}
      />,
    );

    await screen.findByText(`Request ${entries - 1} served`);

    // The count beside the title.
    const title: HTMLElement = screen.getByText("Checkout logs");
    const count: Element | null = title.nextElementSibling;

    expect(count).not.toBeNull();

    return count as HTMLElement;
  }

  test.each([
    ["en", 2, "2 entries"],
    ["en", 1, "1 entry"],
    ["de", 2, "2 Einträge"],
    ["de", 1, "1 Eintrag"],
    ["fa", 2, "۲ مورد"],
    ["ar", 2, "الإدخالات: 2"],
    ["ar", 1, "1 إدخال"],
    ["fr", 2, "2 entrées"],
    ["ja", 2, "2 件のエントリ"],
  ])(
    "on a %s board, %d of them read %s",
    async (language: string, entries: number, expected: string) => {
      await inLanguage(language);

      const count: HTMLElement = await renderLogStream(entries);

      expect(count.textContent).toBe(expected);
      // Still one line beside its title, as it was.
      expect(count).toHaveClass("whitespace-nowrap", "shrink-0");
    },
  );

  /*
   * As plain as the title beside it: gray-300 all but vanished on a light
   * board (1.5:1 on white) and outshone the title on a dark one.
   */
  test("the count is drawn in its title's gray", async () => {
    const count: HTMLElement = await renderLogStream(2);

    expect(screen.getByText("Checkout logs")).toHaveClass("text-gray-400");
    expect(count).toHaveClass("text-gray-400");
    expect(count).not.toHaveClass("text-gray-300");
  });

  test("no Dashboard language counts a Log stream's entries in English", async () => {
    for (const language of DASHBOARD_LANGUAGES) {
      await inLanguage(language);

      const many: HTMLElement = await renderLogStream(2);

      expect(many.textContent).not.toMatch(ENGLISH_ENTRY_NOUN);
      cleanup();
    }
  });

  test("every Dashboard language words both its forms, the count kept", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of ["{{count}} entries", "{{count}} entries_one"]) {
        expect({
          language,
          key,
          worded: isWordedInDashboardLocale(key, language),
          english: ENGLISH_ENTRY_NOUN.test(words[key] || ""),
          placeholders: placeholdersOf(words[key] || ""),
        }).toEqual({
          language,
          key,
          worded: true,
          english: false,
          placeholders: ["{{count}}"],
        });
      }
    }
  });
});
