/** @timezone UTC */

import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import i18next, { createInstance, i18n } from "i18next";
import React, { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import CodeTimeAgo from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTimeAgo";
import RelativeTime from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeView/RelativeTime";
import LiveDuration from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/LiveDuration";
import { LoadedAtTime } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOverviewActions";
import { getEventDurationText } from "../../../../App/FeatureSet/Dashboard/src/Utils/EventDuration";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import japaneseLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/ja.json";
import OneUptimeDate from "../../../Types/Date";
import {
  forgetRememberedDateTexts,
  getEnglishOf,
  setDateDisplayLanguage,
  withDateDisplayLanguage,
} from "../../../Types/DateLanguage";
import Timezone from "../../../Types/Timezone";
import TranslatedSentence from "../../../UI/Components/TranslatedSentence/TranslatedSentence";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * The Dashboard's dates in the reader's language, read from the real locale
 * files: a German page reads "vor 5 Stunden" and "06. Okt. 2026, 10:05 BST",
 * and a sentence German has not worded yet ("Last seen {{time}}") reads
 * wholly in English, its time too.
 *
 * Each time component a sentence draws in a slot - RelativeTime,
 * LiveDuration, LoadedAtTime, CodeTimeAgo - follows the sentence's language.
 */

const NOW: Date = new Date();
const FIVE_HOURS_AGO: Date = new Date(NOW.getTime() - 5 * 3600 * 1000);
const INSTANT: Date = new Date("2026-10-06T09:05:07Z");

const DAY: number = 24 * 3600 * 1000;
const HOUR: number = 3600 * 1000;

const instances: Record<string, i18n> = {};

const germanTranslator: () => Translator = (): Translator => {
  return createTranslator((text: string): string | undefined => {
    const value: unknown = (germanLocale as Record<string, unknown>)[text];

    return typeof value === "string" ? value : undefined;
  }, "de");
};

beforeAll(async () => {
  for (const [language, locale] of [
    ["en", englishLocale],
    ["de", germanLocale],
    ["ja", japaneseLocale],
  ] as Array<[string, Record<string, unknown>]>) {
    const instance: i18n = createInstance();

    // The Dashboard's own configuration (Utils/i18n.ts).
    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: englishLocale },
        [language]: { translation: locale },
      },
      interpolation: { escapeValue: false },
    });

    instances[language] = instance;
  }
});

beforeEach(() => {
  OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);
});

afterEach(() => {
  cleanup();
  setDateDisplayLanguage(null);
  OneUptimeDate.setUserTimezone(null);
  forgetRememberedDateTexts();
});

// What a German reader's page draws: dates and words in German.
const inLanguage: (language: string, element: ReactNode) => HTMLElement = (
  language: string,
  element: ReactNode,
): HTMLElement => {
  setDateDisplayLanguage(language);

  render(
    <I18nextProvider i18n={instances[language]!}>
      <p data-testid="drawn">{element}</p>
    </I18nextProvider>,
  );

  return screen.getByTestId("drawn");
};

const text: (element: HTMLElement) => string = (
  element: HTMLElement,
): string => {
  return (element.textContent || "").replace(/\s/g, " ");
};

describe("the locale files these cases read", () => {
  test("German words some time sentences and not others", () => {
    const german: Record<string, unknown> = germanLocale as Record<
      string,
      unknown
    >;

    expect(german["Added {{time}}"]).toBe("Hinzugefügt {{time}}");
    expect(german["Checked {{time}}"]).toBe("Geprüft {{time}}");
    // Not worded in German yet: these read in English.
    expect(german["Last seen {{time}}"]).toBe("Last seen {{time}}");
    expect(german["for {{duration}} · started {{time}}"]).toBe(
      "for {{duration}} · started {{time}}",
    );
  });
});

describe("RelativeTime", () => {
  test("alone, in the reader's language", () => {
    expect(text(inLanguage("de", <RelativeTime date={FIVE_HOURS_AGO} />))).toBe(
      "vor 5 Stunden",
    );
    cleanup();
    expect(text(inLanguage("ja", <RelativeTime date={FIVE_HOURS_AGO} />))).toBe(
      "5 時間前",
    );
  });

  test("in a sentence the language words, in the sentence's language", () => {
    expect(
      text(
        inLanguage(
          "de",
          <TranslatedSentence
            template="Added {{time}}"
            slots={{ time: <RelativeTime date={FIVE_HOURS_AGO} /> }}
          />,
        ),
      ),
    ).toBe("Hinzugefügt vor 5 Stunden");
  });

  test("in a sentence it has not worded, in English", () => {
    expect(
      text(
        inLanguage(
          "de",
          <TranslatedSentence
            template="Last seen {{time}}"
            slots={{ time: <RelativeTime date={FIVE_HOURS_AGO} /> }}
          />,
        ),
      ),
    ).toBe("Last seen 5 hours ago");
  });

  test("its hover is the whole date, in the reader's language", () => {
    inLanguage("de", <RelativeTime date={INSTANT} />);

    expect(
      (
        screen.getByText(/./, { selector: "time" }).getAttribute("title") || ""
      ).replace(/\s/g, " "),
    ).toContain("06. Okt. 2026");
  });
});

describe("LiveDuration", () => {
  const start: Date = new Date(NOW.getTime() - (10 * DAY + 23 * HOUR));

  test("alone, in the reader's language", () => {
    expect(
      text(inLanguage("de", <LiveDuration startDate={start} endDate={NOW} />)),
    ).toBe("10 Tage, 23 Stunden");
  });

  test("in a sentence it has not worded, in English", () => {
    expect(
      text(
        inLanguage(
          "de",
          <TranslatedSentence
            template="for {{duration}} · started {{time}}"
            slots={{
              duration: <LiveDuration startDate={start} endDate={NOW} />,
              time: <RelativeTime date={start} />,
            }}
          />,
        ),
      ),
    ).toBe("for 10 days, 23 hours · started 11 days ago");
  });

  test("in Japanese, which words that sentence, in Japanese", () => {
    expect(
      text(
        inLanguage(
          "ja",
          <TranslatedSentence
            template="for {{duration}} · started {{time}}"
            slots={{
              duration: <LiveDuration startDate={start} endDate={NOW} />,
              time: <RelativeTime date={start} />,
            }}
          />,
        ),
      ),
    ).toBe("10 日 23 時間 継続 · 11 日前に開始");
  });
});

describe("LoadedAtTime", () => {
  // A day ago: the date is said with the time.
  const yesterday: Date = new Date(NOW.getTime() - DAY - HOUR);

  test("alone, in the reader's language", () => {
    const english: string =
      OneUptimeDate.getDateAsLocalShortDateTimeString(yesterday);
    const drawn: string = text(
      inLanguage("de", <LoadedAtTime loadedAt={yesterday} />),
    );

    // A German month and day ("24. Okt."), not moment's English ("Oct 24").
    expect(drawn).not.toBe(english);
    expect(drawn).toBe(
      OneUptimeDate.getDateAsLocalShortDateTimeString(yesterday).replace(
        /\s/g,
        " ",
      ),
    );
    expect(drawn).toMatch(/^\d{1,2}\. /);
  });

  test("in the failed-refresh sentence, worded in German, in German", () => {
    const sentence: string =
      "Couldn't refresh. Showing what loaded at {{time}}. {{error}}";
    const german: string = (germanLocale as Record<string, string>)[sentence]!;

    expect(german).not.toBe(sentence);

    const drawn: string = text(
      inLanguage(
        "de",
        <TranslatedSentence
          template={sentence}
          values={{ error: "Timeout." }}
          slots={{ time: <LoadedAtTime loadedAt={yesterday} /> }}
        />,
      ),
    );
    const germanTime: string = withDateDisplayLanguage("de", (): string => {
      return OneUptimeDate.getDateAsLocalShortDateTimeString(yesterday);
    }).replace(/\s/g, " ");

    expect(drawn).toBe(
      german.replace("{{time}}", germanTime).replace("{{error}}", "Timeout."),
    );
  });

  test("in a sentence German has not worded, in English, its time too", () => {
    const english: string =
      OneUptimeDate.getDateAsLocalShortDateTimeString(yesterday);
    // No locale has this sentence.
    const sentence: string = "Still showing what loaded at {{time}}.";

    expect((germanLocale as Record<string, unknown>)[sentence]).toBeUndefined();
    expect(
      text(
        inLanguage(
          "de",
          <TranslatedSentence
            template={sentence}
            slots={{ time: <LoadedAtTime loadedAt={yesterday} /> }}
          />,
        ),
      ),
    ).toBe(`Still showing what loaded at ${english.replace(/\s/g, " ")}.`);
  });
});

describe("CodeTimeAgo", () => {
  test("alone and in a sentence, as its sentence reads", () => {
    expect(
      text(
        inLanguage("de", <CodeTimeAgo date={FIVE_HOURS_AGO.toISOString()} />),
      ),
    ).toBe("vor 5 Stunden");
    cleanup();
    expect(
      text(
        inLanguage(
          "de",
          <TranslatedSentence
            template="Last seen {{time}}"
            slots={{
              time: <CodeTimeAgo date={FIVE_HOURS_AGO.toISOString()} />,
            }}
          />,
        ),
      ),
    ).toBe("Last seen 5 hours ago");
  });
});

describe("a date a sentence is filled with", () => {
  test("'Checked {{time}}' reads in German, its date too", () => {
    setDateDisplayLanguage("de");

    expect(
      germanTranslator()
        .translateTemplate("Checked {{time}}", {
          time: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
            INSTANT,
          ),
        })
        .replace(/\s/g, " "),
    ).toMatch(/^Geprüft 06\. Okt\. 2026, \d{2}:05( [AP]M)? BST$/);
  });

  test("a sentence German has not worded reads English, its date too", () => {
    setDateDisplayLanguage("de");

    expect(
      germanTranslator().translateTemplate("Last seen {{time}}", {
        time: OneUptimeDate.fromNow(FIVE_HOURS_AGO),
      }),
    ).toBe("Last seen 5 hours ago");
  });

  test("an event's duration in German, and 'less than a minute' as German words it", async () => {
    // The Dashboard's own i18next, which the Dashboard's utilities read.
    await i18next.init({
      lng: "de",
      fallbackLng: "en",
      resources: {
        en: { translation: englishLocale },
        de: { translation: germanLocale },
      },
      interpolation: { escapeValue: false },
    });
    setDateDisplayLanguage("de");

    const start: Date = new Date(NOW.getTime() - (2 * DAY + 3 * HOUR));
    const lessThanAMinute: unknown = (germanLocale as Record<string, unknown>)[
      "less than a minute"
    ];

    expect(getEventDurationText(start, NOW)).toBe("2 Tage, 3 Stunden");
    expect(typeof lessThanAMinute).toBe("string");
    expect(lessThanAMinute).not.toBe("less than a minute");
    expect(getEventDurationText(NOW, NOW)).toBe(lessThanAMinute);
    // Remembered with its English, for a sentence still in English.
    expect(getEnglishOf(getEventDurationText(start, NOW))).toBe(
      "2 days, 3 hours",
    );
  });

  test("English pages read English, word for word", () => {
    const start: Date = new Date(NOW.getTime() - (2 * DAY + 3 * HOUR));

    expect(getEventDurationText(start, NOW)).toBe("2 days, 3 hours");
    expect(getEventDurationText(NOW, NOW)).toBe("less than a minute");
  });
});
