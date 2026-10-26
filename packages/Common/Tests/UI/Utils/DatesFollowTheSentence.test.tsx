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
import { createInstance, i18n } from "i18next";
import React, { FunctionComponent, ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import OneUptimeDate from "../../../Types/Date";
import {
  forgetRememberedDateTexts,
  getDateDisplayLanguage,
  setDateDisplayLanguage,
} from "../../../Types/DateLanguage";
import Timezone from "../../../Types/Timezone";
import TranslatedSentence from "../../../UI/Components/TranslatedSentence/TranslatedSentence";
import {
  useDateLanguage,
  useSentenceLanguage,
  useWriteDatesInSentenceLanguage,
} from "../../../UI/Utils/SentenceLanguage";
import {
  SentenceParts,
  Translator,
  createTranslator,
  getSentenceLanguage,
  getSentencePartsAndLanguage,
  translateTemplateAround,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * A date goes into a sentence in the language the sentence is read in.
 *
 * OneUptimeDate writes a date in the reader's language ("06. Okt. 2026,
 * 10:05 BST", "vor 5 Stunden"). A sentence is wholly in the reader's
 * language or wholly in English: while a language has not worded "Checked
 * {{time}}" yet, the reader sees the English sentence - and with it the
 * English date, never "Checked vor 5 Stunden". A translated sentence keeps
 * the reader's date; a sentence with no words of its own ("{{label}}
 * {{time}}") belongs to no language and keeps it too. A TranslatedSentence
 * tells the elements it draws in its slots which language it came out in,
 * so a time drawn there follows the sentence.
 */

const INSTANT: Date = new Date("2026-10-06T09:05:07Z");
const ENGLISH_DATE: string = "Oct 06 2026, 10:05 BST";
const GERMAN_DATE: string = "06. Okt. 2026, 10:05 BST";

// German words some sentences and not others.
const GERMAN: Record<string, string> = {
  "Generated {{date}}": "Erstellt: {{date}}",
  "{{count}} days ({{date}})": "{{count}} Tage ({{date}})",
  "{{count}} days ({{date}})_one": "{{count}} Tag ({{date}})",
  "Recorded {{time}}": "Aufgezeichnet {{time}}",
};

const germanTranslator: Translator = createTranslator(
  (text: string): string | undefined => {
    return GERMAN[text];
  },
  "de",
);

beforeEach(() => {
  OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);
  setDateDisplayLanguage("de");
});

afterEach(() => {
  cleanup();
  setDateDisplayLanguage(null);
  OneUptimeDate.setUserTimezone(null);
  forgetRememberedDateTexts();
});

const germanDate: () => string = (): string => {
  return OneUptimeDate.getDateAsLocalFormattedString(INSTANT);
};

describe("a date in a sentence filled with translateTemplate", () => {
  test("the dates are German in a German page", () => {
    expect(getDateDisplayLanguage()).toBe("de");
    expect(germanDate().replace(/\s/g, " ")).toBe(GERMAN_DATE);
  });

  test("a translated sentence keeps the reader's date", () => {
    expect(
      germanTranslator
        .translateTemplate("Generated {{date}}", { date: germanDate() })
        .replace(/\s/g, " "),
    ).toBe(`Erstellt: ${GERMAN_DATE}`);
  });

  test("a sentence the language has not worded reads English, its date too", () => {
    expect(
      germanTranslator.translateTemplate("Checked {{time}}", {
        time: germanDate(),
      }),
    ).toBe(`Checked ${ENGLISH_DATE}`);
    expect(
      germanTranslator.translateTemplate("Last seen {{when}}", {
        when: OneUptimeDate.fromNow(new Date(Date.now() - 5 * 3600000)),
      }),
    ).toBe("Last seen 5 hours ago");
  });

  test("a sentence with no words of its own keeps the reader's date", () => {
    expect(
      germanTranslator
        .translateTemplate("{{label}} {{time}}", {
          label: "Zuletzt",
          time: germanDate(),
        })
        .replace(/\s/g, " "),
    ).toBe(`Zuletzt ${GERMAN_DATE}`);
  });

  test("a value that is no date of ours goes in as it is", () => {
    expect(
      germanTranslator.translateTemplate("Checked {{time}}", {
        time: "Dienstag",
      }),
    ).toBe("Checked Dienstag");
  });

  test("count-dependent sentences follow the same rule", () => {
    expect(
      germanTranslator
        .translatePlural(
          {
            one: "{{count}} day ({{date}})",
            other: "{{count}} days ({{date}})",
          },
          12,
          { date: germanDate() },
        )
        .replace(/\s/g, " "),
    ).toBe(`12 Tage (${GERMAN_DATE})`);

    // Worded in German, but not this one: English throughout.
    expect(
      germanTranslator.translatePlural(
        {
          one: "{{count}} hour ({{date}})",
          other: "{{count}} hours ({{date}})",
        },
        2,
        { date: germanDate() },
      ),
    ).toBe(`2 hours (${ENGLISH_DATE})`);
  });

  test("the global functions an English page uses write English throughout", () => {
    setDateDisplayLanguage(null);

    expect(
      germanTranslator.translateTemplate("Checked {{time}}", {
        time: germanDate(),
      }),
    ).toBe(`Checked ${ENGLISH_DATE}`);
  });
});

describe("the language a sentence comes out in", () => {
  test.each([
    ["Generated {{date}}", "de"],
    ["Checked {{time}}", "en"],
    // No words of its own: the reader's.
    ["{{label}} {{time}}", "de"],
  ])("%s -> %s", (template: string, language: string) => {
    expect(getSentenceLanguage(germanTranslator, template)).toBe(language);
  });

  test("a plural sentence by its general form", () => {
    expect(
      getSentenceLanguage(germanTranslator, {
        one: "{{count}} day ({{date}})",
        other: "{{count}} days ({{date}})",
      }),
    ).toBe("de");
  });

  test("getSentencePartsAndLanguage reports it with the parts", () => {
    const worded: SentenceParts = getSentencePartsAndLanguage({
      translator: germanTranslator,
      template: "Recorded {{time}}",
      slots: ["time"],
    });
    const notWorded: SentenceParts = getSentencePartsAndLanguage({
      translator: germanTranslator,
      template: "Checked {{time}}",
      slots: ["time"],
    });

    expect(worded.language).toBe("de");
    expect(worded.parts).toEqual([
      { kind: "text", text: "Aufgezeichnet " },
      { kind: "slot", slot: "time" },
    ]);
    expect(notWorded.language).toBe("en");
    expect(notWorded.parts).toEqual([
      { kind: "text", text: "Checked " },
      { kind: "slot", slot: "time" },
    ]);
  });

  test("a translation that lost its slot reads English", () => {
    const lostSlot: Translator = createTranslator(
      (text: string): string | undefined => {
        return text === "Checked {{time}}" ? "Geprüft" : undefined;
      },
      "de",
    );

    const parts: SentenceParts = getSentencePartsAndLanguage({
      translator: lostSlot,
      template: "Checked {{time}}",
      slots: ["time"],
      values: {},
    });

    expect(parts.language).toBe("en");
  });

  test("the English sentence a slot is cut around puts its dates back in English", () => {
    expect(
      translateTemplateAround("Checked {{time}} by {{name}}", "name", {
        time: germanDate(),
      }),
    ).toEqual({ before: `Checked ${ENGLISH_DATE} by `, after: "" });
  });
});

describe("a time drawn inside a TranslatedSentence", () => {
  const instances: Record<string, i18n> = {};

  beforeAll(async () => {
    for (const language of ["en", "de"]) {
      const instance: i18n = createInstance();

      await instance.init({
        lng: language,
        fallbackLng: "en",
        resources: {
          en: { translation: {} },
          de: { translation: GERMAN },
        },
        interpolation: { escapeValue: false },
      });

      instances[language] = instance;
    }
  });

  // A time element as the Dashboard's RelativeTime draws one.
  const TimeSlot: FunctionComponent = (): ReactElement => {
    const writeDates: <T>(write: () => T) => T =
      useWriteDatesInSentenceLanguage();
    const sentenceLanguage: string | null = useSentenceLanguage();
    const dateLanguage: string = useDateLanguage();

    return (
      <time
        data-testid="slot"
        data-sentence-language={sentenceLanguage || "none"}
        data-date-language={dateLanguage}
      >
        {writeDates((): string => {
          return OneUptimeDate.getDateAsLocalFormattedString(INSTANT);
        })}
      </time>
    );
  };

  const draw: (language: string, template: string) => HTMLElement = (
    language: string,
    template: string,
  ): HTMLElement => {
    render(
      <I18nextProvider i18n={instances[language]!}>
        <p data-testid="sentence">
          <TranslatedSentence
            template={template}
            slots={{ time: <TimeSlot /> }}
          />
        </p>
      </I18nextProvider>,
    );

    return screen.getByTestId("slot");
  };

  test("a sentence the reader's language words draws the reader's date", () => {
    const slot: HTMLElement = draw("de", "Recorded {{time}}");

    expect(slot).toHaveAttribute("data-sentence-language", "de");
    expect(
      screen.getByTestId("sentence").textContent?.replace(/\s/g, " "),
    ).toBe(`Aufgezeichnet ${GERMAN_DATE}`);
  });

  test("a sentence it has not worded draws the English date", () => {
    const slot: HTMLElement = draw("de", "Checked {{time}}");

    expect(slot).toHaveAttribute("data-sentence-language", "en");
    expect(slot).toHaveAttribute("data-date-language", "en");
    expect(screen.getByTestId("sentence")).toHaveTextContent(
      `Checked ${ENGLISH_DATE}`,
    );
    // The page's dates stay German outside the sentence.
    expect(getDateDisplayLanguage()).toBe("de");
  });

  test("outside any sentence a time is written in the page's language", () => {
    render(
      <I18nextProvider i18n={instances["de"]!}>
        <TimeSlot />
      </I18nextProvider>,
    );

    const slot: HTMLElement = screen.getByTestId("slot");

    expect(slot).toHaveAttribute("data-sentence-language", "none");
    expect(slot).toHaveAttribute("data-date-language", "de");
    expect(slot.textContent?.replace(/\s/g, " ")).toBe(GERMAN_DATE);
  });

  test("an English page draws English everywhere", () => {
    setDateDisplayLanguage("en");

    const slot: HTMLElement = draw("en", "Recorded {{time}}");

    expect(slot).toHaveAttribute("data-sentence-language", "en");
    expect(screen.getByTestId("sentence")).toHaveTextContent(
      `Recorded ${ENGLISH_DATE}`,
    );
  });
});
