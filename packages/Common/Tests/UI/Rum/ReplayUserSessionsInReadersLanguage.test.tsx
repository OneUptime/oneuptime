/**
 * @timezone UTC
 */
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
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import {
  createTranslator,
  formatInline,
  Translator,
} from "../../../Types/Translator";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/* The menu's module reads nothing over the network in these tests. */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
    },
  };
});

import ReplayUserSessionsMenu from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayUserSessionsMenu";
import {
  REPLAY_DEVICE_TYPE_LABELS,
  ReplayUserSessionDescription,
  ReplayUserSessionItem,
  describeReplayDeviceType,
  describeReplayUserSession,
  formatReplayUserSessionAge,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayUserSessions";

/*
 * THE SAME PERSON'S OTHER SESSIONS, IN THE READER'S LANGUAGE (#8298).
 *
 * The header's "N sessions" menu and the ended card's next-session line
 * said when each session started and how long it ran in English with Latin
 * digits - "5 minutes ago", "4m 12s" - beside a player that is otherwise in
 * the reader's language and digits (#7318). Drawn here from the Dashboard's
 * shipped locale files: Persian in its own digits, German in its own words
 * and units, Arabic in Latin digits as OneUptime writes Arabic, and English
 * word for word as before.
 *
 * The fixture's pages, browsers and ids have no digits, so a Latin digit in
 * a Persian row is the menu's.
 */

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const LATIN_DIGIT: RegExp = /[0-9]/;
const PERSIAN_DIGIT: RegExp = /[\u{06F0}-\u{06F9}]/u;
const ARABIC_INDIC_DIGIT: RegExp = /[\u{0660}-\u{0669}]/u;

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;

// 13:47 UTC on a weekday, so every age below is a whole number of its unit.
const NOW: number = Date.UTC(2026, 8, 4, 13, 47, 0, 0);

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

// A translator over `language`'s shipped words, as the menu's own is.
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

function session(
  sessionId: string,
  startTimeUnixMs: number,
  overrides?: Partial<ReplayUserSessionItem>,
): ReplayUserSessionItem {
  return {
    sessionId: sessionId,
    startTimeUnixMs: startTimeUnixMs,
    durationMs: 252_000,
    entryUrl: "https://app.acme.com/checkout",
    browserName: "Chrome",
    deviceType: "desktop",
    hasError: false,
    errorCount: 0,
    isFinalized: true,
    identifiedUserKey: "user-key",
    visitorId: "visitor",
    identifiedUserLabel: "jane@acme.com",
    ...overrides,
  };
}

/*
 * Five sessions of one person: one that just started, one five minutes
 * ago with two errors, three hours ago, six days ago and three weeks ago -
 * every unit the menu counts in.
 */
function sessions(): Array<ReplayUserSessionItem> {
  return [
    session("now", NOW - 10 * 1000, { durationMs: 8_000 }),
    session("minutes", NOW - 5 * MINUTE_MS, {
      durationMs: 252_000,
      hasError: true,
      errorCount: 2,
    }),
    session("hours", NOW - 3 * HOUR_MS, { durationMs: 3_725_000 }),
    session("days", NOW - 6 * DAY_MS, { durationMs: 45_000 }),
    session("weeks", NOW - 21 * DAY_MS, { durationMs: 600_000 }),
  ];
}

function renderMenu(items: Array<ReplayUserSessionItem> = sessions()): void {
  render(
    <ReplayUserSessionsMenu
      kind="identified"
      sessions={items}
      currentSessionId="minutes"
      onOpenUserSession={(): void => {
        /* Choosing a row is not exercised here. */
      }}
      nowUnixMs={NOW}
    />,
  );

  fireEvent.click(screen.getByTestId("replay-user-sessions-button"));
}

function textsOf(testId: string): Array<string> {
  return screen.getAllByTestId(testId).map((element: HTMLElement): string => {
    return withoutIsolateMarks(element.textContent || "");
  });
}

// Every figure a row of the menu draws: its age, its timestamp, its length.
function rowFigures(): Array<string> {
  return [
    ...textsOf("replay-user-session-when"),
    ...textsOf("replay-user-session-absolute"),
    ...textsOf("replay-user-session-duration"),
    ...textsOf("replay-user-session-errors"),
  ];
}

describe("the sessions menu's rows, in each language's digits", () => {
  test("Persian: every age, timestamp, length and error count in Persian digits", async () => {
    await readIn("fa");
    renderMenu();

    const figures: Array<string> = rowFigures();

    expect(figures.length).toBeGreaterThan(10);
    expect(
      figures.filter((text: string): boolean => {
        return LATIN_DIGIT.test(text);
      }),
    ).toEqual([]);
    expect(
      figures.filter((text: string): boolean => {
        return PERSIAN_DIGIT.test(text);
      }).length,
    ).toBeGreaterThan(8);
  });

  test.each(["ar", "de", "en"])(
    "%s: Latin digits, never Persian or Arabic-Indic ones",
    async (language: string) => {
      await readIn(language);
      renderMenu();

      const figures: Array<string> = rowFigures();

      expect(figures.length).toBeGreaterThan(10);

      for (const text of figures) {
        expect({ text, persian: PERSIAN_DIGIT.test(text) }).toEqual({
          text,
          persian: false,
        });
        expect({ text, arabicIndic: ARABIC_INDIC_DIGIT.test(text) }).toEqual({
          text,
          arabicIndic: false,
        });
      }

      expect(
        textsOf("replay-user-session-duration").every((text: string) => {
          return LATIN_DIGIT.test(text);
        }),
      ).toBe(true);
    },
  );

  test("the check would find a Latin digit in a Persian row", () => {
    expect(LATIN_DIGIT.test("5\u00A0minutes ago")).toBe(true);
    expect(LATIN_DIGIT.test("۵ دقیقه پیش")).toBe(false);
  });
});

describe("the sessions menu's rows, word for word", () => {
  test("English reads exactly as it always did", async () => {
    renderMenu();

    expect(textsOf("replay-user-session-when")).toEqual([
      "just now",
      "5\u00A0minutes ago",
      "3\u00A0hours ago",
      "6\u00A0days ago",
      "3\u00A0weeks ago",
    ]);
    expect(textsOf("replay-user-session-duration")).toEqual([
      "8s",
      "4m 12s",
      "1h 2m",
      "45s",
      "10m",
    ]);
    expect(textsOf("replay-user-session-errors")).toEqual(["2"]);
  });

  test("German: its own words for when, and its own units for how long", async () => {
    await readIn("de");
    renderMenu();

    expect(textsOf("replay-user-session-when")).toEqual([
      translatorIn("de").translateText("just now"),
      "vor 5\u00A0Minuten",
      "vor 3\u00A0Stunden",
      "vor 6\u00A0Tagen",
      "vor 3\u00A0Wochen",
    ]);

    const lengths: Array<string> = textsOf("replay-user-session-duration");

    expect(lengths[0]).toBe("8\u00A0Sek.");
    expect(lengths[1]).toContain("4\u00A0Min.");
    expect(lengths[1]).toContain("12\u00A0Sek.");
    expect(lengths[2]).toContain("1\u00A0Std.");
    expect(lengths.join(" ")).not.toMatch(/\d[smh]\b/);
  });

  test("Persian: the ages and lengths in Persian words", async () => {
    await readIn("fa");
    renderMenu();

    const ages: Array<string> = textsOf("replay-user-session-when");

    expect(ages[0]).toBe(translatorIn("fa").translateText("just now"));
    expect(ages[1]).toBe("۵\u00A0دقیقه پیش");
    expect(ages[4]).toBe("۳\u00A0هفته پیش");

    const length: string = textsOf("replay-user-session-duration")[1]!;

    expect(length).toContain("۴");
    expect(length).toContain("دقیقه");
    expect(length).toContain("۱۲");
    expect(length).toContain("ثانیه");
    expect(textsOf("replay-user-session-errors")).toEqual(["۲"]);
  });

  test("Arabic: its own words, in Latin digits", async () => {
    await readIn("ar");
    renderMenu();

    const ages: Array<string> = textsOf("replay-user-session-when");

    expect(ages[1]).toBe("قبل 5\u00A0دقائق");
    expect(ages[4]).toBe("قبل 3\u00A0أسابيع");
    expect(textsOf("replay-user-session-duration")[0]).toBe("8\u00A0ث");
  });

  test("the menu's own words around the rows stay the locale's", async () => {
    await readIn("de");
    renderMenu();

    expect(screen.getByTestId("replay-user-sessions-menu")).toHaveTextContent(
      translatorIn("de").translateText("Watching") || "Watching",
    );
  });
});

describe("describeReplayUserSession, with the reader's translator", () => {
  test("a row with no start time says so in the reader's words", () => {
    const german: ReplayUserSessionDescription = describeReplayUserSession(
      session("unknown", 0),
      NOW,
      translatorIn("de"),
    );
    const persian: ReplayUserSessionDescription = describeReplayUserSession(
      session("unknown", 0),
      NOW,
      translatorIn("fa"),
    );

    expect(german.when).toBe("Unbekannte Zeit");
    expect(german.absolute).toBe(
      translatorIn("de").translateText("Start time unavailable"),
    );
    expect(persian.when).toBe("زمان نامعلوم");
    expect(persian.absolute).not.toBe("Start time unavailable");
  });

  test("without a translator it is English, as the node tests read it", () => {
    const english: ReplayUserSessionDescription = describeReplayUserSession(
      session("unknown", 0),
      NOW,
    );

    expect(english.when).toBe("Unknown time");
    expect(english.absolute).toBe("Start time unavailable");
    expect(
      describeReplayUserSession(session("a", NOW - 5 * MINUTE_MS), NOW)
        .duration,
    ).toBe("4m 12s");
  });

  test("the timestamp follows the translator, not the page's date language", () => {
    const persian: ReplayUserSessionDescription = describeReplayUserSession(
      session("a", NOW - 5 * MINUTE_MS),
      NOW,
      translatorIn("fa"),
    );
    const english: ReplayUserSessionDescription = describeReplayUserSession(
      session("a", NOW - 5 * MINUTE_MS),
      NOW,
      translatorIn("en"),
    );

    expect(LATIN_DIGIT.test(persian.absolute)).toBe(false);
    expect(PERSIAN_DIGIT.test(persian.absolute)).toBe(true);
    expect(PERSIAN_DIGIT.test(english.absolute)).toBe(false);
    expect(english.absolute).toContain("13:42");
  });

  /*
   * The ended card's next-session line is the same facts, set on one line
   * the reader's way (SessionReplayPlayer's nextUserSession).
   */
  test("the ended card's next-session line is wholly in Persian digits", () => {
    const translator: Translator = translatorIn("fa");
    const description: ReplayUserSessionDescription = describeReplayUserSession(
      session("next", NOW - 3 * HOUR_MS, { durationMs: 252_000 }),
      NOW,
      translator,
    );
    const line: string = formatInline(
      [description.when, description.path, description.duration],
      translator,
    );

    expect(line).toContain("/checkout");
    expect(LATIN_DIGIT.test(line)).toBe(false);
    expect(line).toContain("۳\u00A0ساعت پیش");
  });
});

describe("formatReplayUserSessionAge, bucket by bucket", () => {
  const AGES: ReadonlyArray<[number, string, string, string]> = [
    [10 * 1000, "just now", "", ""],
    [60 * 1000, "a minute ago", "vor 1\u00A0Minute", "۱\u00A0دقیقه پیش"],
    [5 * MINUTE_MS, "5\u00A0minutes ago", "vor 5\u00A0Minuten", "۵\u00A0دقیقه پیش"],
    [HOUR_MS, "an hour ago", "vor 1\u00A0Stunde", "۱\u00A0ساعت پیش"],
    [3 * HOUR_MS, "3\u00A0hours ago", "vor 3\u00A0Stunden", "۳\u00A0ساعت پیش"],
    [DAY_MS, "a day ago", "vor 1\u00A0Tag", "۱\u00A0روز پیش"],
    [6 * DAY_MS, "6\u00A0days ago", "vor 6\u00A0Tagen", "۶\u00A0روز پیش"],
    [21 * DAY_MS, "3\u00A0weeks ago", "vor 3\u00A0Wochen", "۳\u00A0هفته پیش"],
  ];

  test.each(AGES)(
    "%d ms ago: %s",
    (elapsedMs: number, english: string, german: string, persian: string) => {
      expect(formatReplayUserSessionAge(NOW - elapsedMs, NOW)).toBe(english);
      expect(
        formatReplayUserSessionAge(NOW - elapsedMs, NOW, translatorIn("en")),
      ).toBe(english);

      if (german) {
        expect(
          formatReplayUserSessionAge(NOW - elapsedMs, NOW, translatorIn("de")),
        ).toBe(german);
        expect(
          formatReplayUserSessionAge(NOW - elapsedMs, NOW, translatorIn("fa")),
        ).toBe(persian);
      }
    },
  );

  test("a start in the future, or none that can be read, is now in every language", () => {
    for (const language of LANGUAGES) {
      const translator: Translator = translatorIn(language);
      const now: string = translator.translateText("just now") || "just now";

      expect(
        formatReplayUserSessionAge(NOW + 5 * MINUTE_MS, NOW, translator),
      ).toBe(now);
      expect(formatReplayUserSessionAge(Number.NaN, NOW, translator)).toBe(now);
    }
  });

  test("a language Intl has no words for reads English, never a placeholder", () => {
    const klingon: Translator = createTranslator(undefined, "tlh");

    expect(formatReplayUserSessionAge(NOW - 5 * MINUTE_MS, NOW, klingon)).toBe(
      "5\u00A0minutes ago",
    );
  });
});

/*
 * A row's "Chrome · desktop" drew the recorder's raw device token in
 * English: the kind of device is named as the session list's Device filter
 * names it, in the reader's words, and the two facts are set apart the
 * reader's way (a bullet in Persian, whose zero is a dot).
 */
describe("a row's device, in the reader's words", () => {
  test("every kind the recorder reports is worded in German, Arabic and Persian", () => {
    for (const language of ["de", "ar", "fa"]) {
      for (const label of Object.values(REPLAY_DEVICE_TYPE_LABELS)) {
        expect(
          translatorIn(language).hasTranslation(label) ||
            readDashboardLocale(language)[label] === label,
        ).toBe(true);
      }
    }

    expect(describeReplayDeviceType("mobile", translatorIn("ar"))).toBe(
      "هاتف محمول",
    );
  });

  test("English names it as the Device filter does", () => {
    expect(describeReplayDeviceType("desktop")).toBe("Desktop");
    expect(describeReplayDeviceType("Tablet", translatorIn("en"))).toBe(
      "Tablet",
    );
  });

  test("a kind it does not know is the recorder's word, as written", () => {
    expect(describeReplayDeviceType("smart-tv", translatorIn("fa"))).toBe(
      "smart-tv",
    );
    expect(describeReplayDeviceType("", translatorIn("fa"))).toBe("");
  });

  test("drawn: the browser and the device set apart the Persian way", async () => {
    await readIn("fa");
    renderMenu([
      session("only", NOW - 5 * MINUTE_MS, {
        browserName: "Safari",
        deviceType: "mobile",
      }),
    ]);

    const row: string = withoutIsolateMarks(
      screen.getByTestId("replay-user-session-item").textContent || "",
    );

    expect(row).toContain(
      `Safari • ${translatorIn("fa").translateText("Mobile")}`,
    );
    expect(row).not.toContain("mobile");
  });
});
