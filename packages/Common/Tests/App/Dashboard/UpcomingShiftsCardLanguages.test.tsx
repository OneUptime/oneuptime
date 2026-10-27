/** @timezone America/New_York */
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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE UPCOMING SHIFTS CARD IN THE READER'S LANGUAGE, ZONE AND CLOCK.
 *
 * Rendered from the real locale files through a real i18next instance, the
 * way a reader in German, Russian, Japanese or Persian sees it: every word
 * is the locale's, the dates and lengths come from Intl in that language
 * (Russian's three plural forms included), and the digits stay Latin.
 *
 * The test process runs in New York (the docblock above): the browser's
 * zone. The reader's profile says London. The old card wrote a row's start
 * with moment in the BROWSER's zone and its end in the profile's - "05:00 –
 * Oct 15 2026, 18:00 BST" for a 10:00 shift in London. Every time here is
 * the profile's, both ends, and the description names it.
 *
 * The end of summer time in London (25 October 2026) falls inside the
 * window: a 17:20 hand-off still reads 17:20 on both sides of it, the turn
 * across it lasts "1 day", and its tooltip names BST at one end and GMT at
 * the other.
 */

const getMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<any>) => {
        return getMock(...args);
      },
      getFriendlyMessage: (): string => {
        return "Something went wrong";
      },
    },
  };
});

import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import russianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/ru.json";
import japaneseLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/ja.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import UpcomingShiftsCard from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/UpcomingShiftsCard";
import {
  UPCOMING_SHIFT_SEPARATOR,
  keepWithTime,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/UpcomingShiftRow";
import OneUptimeDate from "../../../Types/Date";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import { MaterializedShiftJson } from "../../../Types/OnCallDutyPolicy/MaterializedShift";
import Timezone from "../../../Types/Timezone";

type Locale = Record<string, string>;

const DE: Locale = germanLocale as unknown as Locale;
const RU: Locale = russianLocale as unknown as Locale;
const JA: Locale = japaneseLocale as unknown as Locale;
const FA: Locale = persianLocale as unknown as Locale;

const PROJECT: string = "0d700000-0000-4000-8000-000000000001";
const ME: string = "0d700000-0000-4000-8000-0000000000a1";

const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;

// 15:00 UTC on 14 October 2026: 16:00 in London, 17:00 in Berlin.
const NOW: Date = new Date("2026-10-14T15:00:00.000Z");

// Intl writes a no-break space (or a narrow one) in some languages.
const NO_BREAK_SPACES: RegExp = /[\u202f\u00a0]/g;

// Any digit outside ASCII: Persian, Arabic-Indic, Devanagari.
const NON_LATIN_DIGIT: RegExp = /[\u0660-\u0669\u06f0-\u06f9\u0966-\u096f]/u;

function plain(text: string | null | undefined): string {
  return (text || "").replace(NO_BREAK_SPACES, " ");
}

function at(offset: number): string {
  return new Date(NOW.getTime() + offset).toISOString();
}

function shift(
  overrides: Partial<MaterializedShiftJson> & { shiftKey: string },
): MaterializedShiftJson {
  return {
    contentHash: "hash",
    projectId: PROJECT,
    projectName: "OneUptime Telemetry",
    scheduleId: "0d700000-0000-4000-8000-000000000011",
    scheduleName: "Team AWeekly",
    scheduleTimezone: "Europe/London",
    userId: ME,
    userName: "Valeria",
    start: at(DAY),
    end: at(DAY + 8 * HOUR),
    coverageSeconds: 8 * 3600,
    layerId: "layer-1",
    layerName: "Layer 1",
    policies: [],
    isPast: false,
    lastModifiedAt: "2026-10-01T00:00:00.000Z",
    shiftConfigVersion: 1,
    ...overrides,
  };
}

function serve(shifts: Array<MaterializedShiftJson>): void {
  getMock.mockResolvedValue(
    new HTTPResponse<JSONObject>(
      200,
      {
        shifts: shifts as unknown as JSONArray,
        truncated: false,
        generatedAt: NOW.toISOString(),
      },
      {},
    ),
  );
}

// On call since 13:00 UTC for eight hours; tomorrow 09:00-17:00 UTC.
function today(): Array<MaterializedShiftJson> {
  return [
    shift({ shiftKey: "now", start: at(-2 * HOUR), end: at(6 * HOUR) }),
    shift({
      shiftKey: "tomorrow",
      start: at(DAY - 6 * HOUR),
      end: at(DAY + 2 * HOUR),
    }),
  ];
}

// `count` weekday-like shifts, one a day from tomorrow.
function daily(count: number): Array<MaterializedShiftJson> {
  const result: Array<MaterializedShiftJson> = [];

  for (let day: number = 1; day <= count; day++) {
    result.push(
      shift({
        shiftKey: `day-${day}`,
        start: at(day * DAY),
        end: at(day * DAY + 8 * HOUR),
      }),
    );
  }

  return result;
}

function instanceFor(language: string, locale: Locale): i18n {
  const instance: i18n = createInstance();

  instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      [language]: { translation: locale },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
    initImmediate: false,
  });

  return instance;
}

let english: i18n;
let german: i18n;
let russian: i18n;
let japanese: i18n;
let persian: i18n;

beforeAll(() => {
  english = instanceFor("en", englishLocale as unknown as Locale);
  german = instanceFor("de", DE);
  russian = instanceFor("ru", RU);
  japanese = instanceFor("ja", JA);
  persian = instanceFor("fa", FA);
});

beforeEach(() => {
  getMock.mockReset();
  window.history.pushState(
    {},
    "",
    `/dashboard/${PROJECT}/user-settings/calendar-feed`,
  );
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  OneUptimeDate.setUserTimezone(null);
  jest.restoreAllMocks();
});

async function renderIn(
  instance: i18n,
  timezone: Timezone,
  shifts: Array<MaterializedShiftJson>,
  expectedRows: number,
): Promise<Array<HTMLElement>> {
  OneUptimeDate.setUserTimezone(timezone);
  serve(shifts);

  render(
    <I18nextProvider i18n={instance}>
      <UpcomingShiftsCard now={NOW} />
    </I18nextProvider>,
  );

  await waitFor(() => {
    expect(screen.getAllByTestId("upcoming-shift-row")).toHaveLength(
      expectedRows,
    );
  });

  return screen.getAllByTestId("upcoming-shift-row");
}

function text(row: HTMLElement, testId: string): string {
  return plain(within(row).getByTestId(testId).textContent);
}

describe("in the reader's zone, not the browser's", () => {
  test("both ends of a row are London's when the profile says London and the browser is in New York", async () => {
    const [, tomorrow] = (await renderIn(
      english,
      Timezone.EuropeLondon,
      today(),
      2,
    )) as [HTMLElement, HTMLElement];

    // 09:00-17:00 UTC is 10:00-18:00 in London (05:00-13:00 in New York).
    expect(text(tomorrow, "upcoming-shift-times")).toBe("10:00 – 18:00");
    expect(plain(screen.getByTestId("card-description").textContent)).toBe(
      "Your shifts over the next 30 days. Times are in Europe/London.",
    );
  });

  test("the same shifts read in Tokyo's day and hours for a reader in Tokyo", async () => {
    const [now, tomorrow] = (await renderIn(
      english,
      Timezone.AsiaTokyo,
      today(),
      2,
    )) as [HTMLElement, HTMLElement];

    // Midnight has passed in Tokyo: 13:00-21:00 UTC is 22:00-06:00 there.
    expect(text(now, "upcoming-shift-times")).toBe("until 06:00");
    expect(text(now, "upcoming-shift-tile")).toBe("Oct15");
    // Tomorrow 09:00 UTC is 18:00 today in Tokyo.
    expect(text(tomorrow, "upcoming-shift-day-label")).toBe("Today");
    expect(text(tomorrow, "upcoming-shift-times")).toBe(
      "18:00 – Fri, Oct 16, 02:00",
    );
  });
});

describe("across the end of summer time", () => {
  const LONDON_TURNS: Array<MaterializedShiftJson> = [
    shift({
      shiftKey: "before",
      start: "2026-10-24T16:20:00.000Z",
      end: "2026-10-25T17:20:00.000Z",
    }),
    shift({
      shiftKey: "night",
      scheduleId: "0d700000-0000-4000-8000-000000000012",
      scheduleName: "Overnight support",
      start: "2026-10-24T23:00:00.000Z",
      end: "2026-10-25T08:00:00.000Z",
    }),
  ];

  test("a 17:20 hand-off reads 17:20 on both sides of the change, and the turn lasts a day", async () => {
    const [turn] = (await renderIn(
      english,
      Timezone.EuropeLondon,
      LONDON_TURNS,
      2,
    )) as [HTMLElement];

    expect(text(turn, "upcoming-shift-day-label")).toBe("Saturday");
    expect(text(turn, "upcoming-shift-times")).toBe(
      "17:20 – Sun, Oct 25, 17:20",
    );
    expect(text(turn, "upcoming-shift-length")).toBe("1 day");
    expect(
      plain(
        within(turn).getByTestId("upcoming-shift-when").getAttribute("title"),
      ),
    ).toBe(
      "Saturday, October 24, 2026 at 17:20 BST – Sunday, October 25, 2026 at 17:20 GMT",
    );
  });

  test("a night inside the change counts its real hours", async () => {
    const rows: Array<HTMLElement> = await renderIn(
      english,
      Timezone.EuropeLondon,
      LONDON_TURNS,
      2,
    );

    const night: HTMLElement = rows[1]!;

    expect(text(night, "upcoming-shift-day-label")).toBe("Sunday");
    expect(text(night, "upcoming-shift-times")).toBe("00:00 – 08:00");
    expect(text(night, "upcoming-shift-length")).toBe("9 hours");
  });
});

describe("in German", () => {
  test("every word is German, and the dates and lengths are Intl's German", async () => {
    const [now, tomorrow] = (await renderIn(
      german,
      Timezone.EuropeBerlin,
      today(),
      2,
    )) as [HTMLElement, HTMLElement];

    expect(screen.getByText("Bevorstehende Schichten")).toBeInTheDocument();
    expect(plain(screen.getByTestId("card-description").textContent)).toBe(
      "Ihre Schichten der nächsten 30 Tage. Alle Zeiten in Europe/Berlin.",
    );

    expect(text(now, "upcoming-shift-day-label")).toBe("Jetzt in Bereitschaft");
    expect(text(now, "upcoming-shift-times")).toBe("bis 23:00");
    expect(text(now, "upcoming-shift-length")).toBe("Noch 6 Stunden");

    expect(text(tomorrow, "upcoming-shift-tile")).toBe("Okt15");
    expect(text(tomorrow, "upcoming-shift-day-label")).toBe("Morgen");
    expect(text(tomorrow, "upcoming-shift-times")).toBe("11:00 – 19:00");
    expect(text(tomorrow, "upcoming-shift-length")).toBe("8 Stunden");
    expect(within(tomorrow).getByText("Vertretung finden")).toBeInTheDocument();

    expect(
      plain(screen.getByTestId("upcoming-shifts-footer").textContent),
    ).toBe(
      DE[
        "Only schedule shifts are listed. If an escalation policy names you or your team directly, it can page you at any time."
      ],
    );
  });

  test("the fold, in German", async () => {
    await renderIn(german, Timezone.EuropeBerlin, daily(22), 6);

    const fold: HTMLElement = screen.getByTestId("upcoming-shifts-fold");

    expect(plain(fold.textContent)).toBe("16 weitere Schichten anzeigen");

    fireEvent.click(fold);

    expect(plain(fold.textContent)).toBe("Weniger Schichten anzeigen");
  });

  test("a span that may continue says so in German", async () => {
    const turns: Array<MaterializedShiftJson> = [];

    for (let index: number = 0; index < 31; index++) {
      turns.push(
        shift({
          shiftKey: `turn-${index}`,
          start: at(-HOUR + index * DAY),
          end: at(-HOUR + (index + 1) * DAY),
        }),
      );
    }

    const [row] = (await renderIn(german, Timezone.EuropeBerlin, turns, 1)) as [
      HTMLElement,
    ];

    expect(text(row, "upcoming-shift-times")).toBe(
      "mindestens bis Sa., 14. Nov., 15:00",
    );
    expect(text(row, "upcoming-shift-length")).toBe("Noch mindestens 31 Tage");

    // Get cover says the same, to a reader who hears it, in German.
    expect(plain(within(row).getByRole("link").textContent)).toBe(
      "Vertretung finden (Jetzt in Bereitschaft, mindestens bis Sa., 14. Nov., 15:00)",
    );
  });

  /*
   * Each Get cover link names its shift for a screen reader (UI review):
   * the words after "Vertretung finden" are hidden, and German like the
   * rest of the row - the start's day and date from Intl, the phrases
   * from the locale.
   */
  test("Get cover names its shift to a screen reader in German", async () => {
    await renderIn(german, Timezone.EuropeBerlin, today(), 2);

    expect(
      screen.getAllByRole("link").map((link: HTMLElement): string => {
        return plain(link.textContent);
      }),
    ).toEqual([
      "Vertretung finden (Jetzt in Bereitschaft, bis 23:00)",
      "Vertretung finden (Do., 15. Okt., 11:00 – 19:00)",
    ]);
  });
});

describe("where a row's line may break", () => {
  const NO_BREAK_SPACE: string = "\u{00a0}";

  test("a time of day keeps the word next to it, and the dot the word before it", () => {
    expect(keepWithTime("bis ")).toBe(`bis${NO_BREAK_SPACE}`);
    expect(keepWithTime(" まで")).toBe(`${NO_BREAK_SPACE}まで`);
    // Only the space next to the time: the phrase's own words still break.
    expect(keepWithTime("как минимум до ")).toBe(
      `как минимум до${NO_BREAK_SPACE}`,
    );
    expect(keepWithTime("until")).toBe("until");
    expect(UPCOMING_SHIFT_SEPARATOR).toBe(`${NO_BREAK_SPACE}· `);
  });

  test("in German, 'bis' keeps to today's end; a later end, a whole date, may break from its words", async () => {
    const turns: Array<MaterializedShiftJson> = [];

    for (let index: number = 0; index < 31; index++) {
      turns.push(
        shift({
          shiftKey: `turn-${index}`,
          start: at(-HOUR + index * DAY),
          end: at(-HOUR + (index + 1) * DAY),
        }),
      );
    }

    const [today] = (await renderIn(
      german,
      Timezone.EuropeBerlin,
      [shift({ shiftKey: "now", start: at(-2 * HOUR), end: at(6 * HOUR) })],
      1,
    )) as [HTMLElement];

    expect(within(today).getByTestId("upcoming-shift-times").textContent).toBe(
      `bis${NO_BREAK_SPACE}23:00`,
    );

    cleanup();

    const [later] = (await renderIn(
      german,
      Timezone.EuropeBerlin,
      turns,
      1,
    )) as [HTMLElement];

    const laterText: string =
      within(later).getByTestId("upcoming-shift-times").textContent || "";

    expect(plain(laterText)).toBe("mindestens bis Sa., 14. Nov., 15:00");
    // A plain space after "bis": a whole date may go to the next line.
    expect(laterText.charAt("mindestens bis".length)).toBe(" ");
  });
});

describe("in Russian", () => {
  test("lengths take the form their number needs", async () => {
    const shifts: Array<MaterializedShiftJson> = [
      shift({ shiftKey: "one-day", start: at(DAY), end: at(2 * DAY) }),
      shift({
        shiftKey: "two-days",
        start: at(3 * DAY),
        end: at(5 * DAY),
        scheduleId: "0d700000-0000-4000-8000-000000000013",
      }),
      shift({
        shiftKey: "five-days",
        start: at(6 * DAY),
        end: at(11 * DAY),
        scheduleId: "0d700000-0000-4000-8000-000000000014",
      }),
    ];

    const rows: Array<HTMLElement> = await renderIn(
      russian,
      Timezone.EuropeMoscow,
      shifts,
      3,
    );

    expect(
      rows.map((row: HTMLElement): string => {
        return text(row, "upcoming-shift-length");
      }),
    ).toEqual(["1 день", "2 дня", "5 дней"]);
    expect(text(rows[0]!, "upcoming-shift-day-label")).toBe("Завтра");
    expect(screen.getByText("Ближайшие смены")).toBeInTheDocument();
  });

  test("the fold uses Russian's 'one' form for 21 and its general one otherwise", async () => {
    await renderIn(russian, Timezone.EuropeMoscow, daily(27), 6);

    // 21 hidden: Russian calls 21 "one".
    expect(plain(screen.getByTestId("upcoming-shifts-fold").textContent)).toBe(
      "Показать ещё 21 смену",
    );

    cleanup();

    await renderIn(russian, Timezone.EuropeMoscow, daily(22), 6);

    expect(plain(screen.getByTestId("upcoming-shifts-fold").textContent)).toBe(
      "Показать ещё смены (16)",
    );
  });
});

describe("in Japanese", () => {
  test("the words, the tile and the lengths are Japanese", async () => {
    const [now, tomorrow] = (await renderIn(
      japanese,
      Timezone.AsiaTokyo,
      today(),
      2,
    )) as [HTMLElement, HTMLElement];

    expect(screen.getByText("今後のシフト")).toBeInTheDocument();
    expect(text(now, "upcoming-shift-day-label")).toBe("現在のオンコール");
    expect(text(now, "upcoming-shift-times")).toBe("6:00 まで");
    expect(text(now, "upcoming-shift-length")).toBe("残り 6 時間");
    expect(text(tomorrow, "upcoming-shift-tile")).toBe("10月15");
    expect(text(tomorrow, "upcoming-shift-day-label")).toBe("今日");
    expect(text(tomorrow, "upcoming-shift-length")).toBe("8 時間");
  });
});

describe("in Persian", () => {
  test("the words are Persian, and every digit on a row is Persian", async () => {
    const rows: Array<HTMLElement> = await renderIn(
      persian,
      Timezone.AsiaTehran,
      today(),
      2,
    );

    expect(screen.getByText("نوبت‌های پیش‌رو")).toBeInTheDocument();
    expect(text(rows[0]!, "upcoming-shift-day-label")).toBe("اکنون آنکال");

    // No Latin digit beside the Persian ones anywhere on a row.
    for (const row of rows) {
      expect(NON_LATIN_DIGIT.test(plain(row.textContent))).toBe(true);
      expect(plain(row.textContent)).not.toMatch(/[0-9]/);
    }

    expect(text(rows[1]!, "upcoming-shift-length")).toBe("۸ ساعت");
  });
});
