/** @timezone UTC */

import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import {
  getNoteFullTimeLabel,
  getNoteTimeLabel,
  getNotesCopy,
  getRelativeTimeLabel,
  NoteRecord,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/EventNotesUtil";
import NoteCard from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/NoteCard";
import User from "../../../Models/DatabaseModels/User";
import { withDateDisplayLanguage } from "../../../Types/DateLanguage";
import Name from "../../../Types/Name";
import { Translator } from "../../../Types/Translator";
import {
  drawLine,
  DrawnLine,
  getDrawnText,
  isDrawnAsWritten,
} from "../../Helpers/BidiLayout";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * A NOTE'S TIME, IN THE READER'S LANGUAGE (#7648).
 *
 * Beside a note's author, a note under six hours old read "20 minutes ago":
 * an English template filled in by hand, English on every language's page,
 * and on a Persian or Arabic page laid out from the right as "minutes ago
 * 20". Its age is now worded by Intl.RelativeTimeFormat in the reader's
 * language (HomeRelativeTime), with the language's own plural forms and
 * digits - Persian's own, Latin ones in Arabic, as getNumberLocale writes
 * every count - and a note under a minute old reads the Dashboard's own
 * "just now". The counting is the feed's, as before: whole minutes, then
 * whole hours, against the `now` the feed rendered with.
 *
 * An older note's clock time and the full date in the tooltip were already
 * written in the reader's language and digits (DateLanguage, which the
 * Dashboard sets from its language): that is pinned here too.
 */

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): ReactElement => {
      return <div data-testid="markdown">{props.text}</div>;
    },
  };
});

jest.mock("../../../UI/Components/Markdown.tsx/MarkdownEditor", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <textarea aria-label="Note text" />;
    },
  };
});

const NOW: Date = new Date("2026-09-14T18:20:00.000Z");
const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

const LATIN_DIGIT: RegExp = /[0-9]/;
const LATIN_LETTER: RegExp = /[A-Za-z]/;
const PERSIAN_DIGIT: RegExp = /[\u{06F0}-\u{06F9}]/u;
const ARABIC_INDIC_DIGIT: RegExp = /[\u{0660}-\u{0669}]/u;
// A word that is a count, in Latin or Persian digits.
const COUNT_WORD: RegExp = /^[\d\u{06F0}-\u{06F9}]+$/u;

// Every language the Dashboard is translated into, English aside, one a test.
const EVERY_LANGUAGE: Array<[string]> = DASHBOARD_LANGUAGES.map(
  (language: string): [string] => {
    return [language];
  },
);

// What the feed drew in every language: English, filled in by hand.
const ENGLISH_TEMPLATE_TWENTY_MINUTES: string = "20 minutes ago";

function labelIn(language: string, ageMs: number): string {
  return getNoteTimeLabel(ago(ageMs), NOW, dashboardTranslator(language));
}

/*
 * The words of `text` in the order a reader of a line laid out from the
 * right meets them: the word drawn furthest right first.
 */
function wordsReadFromTheRight(text: string): Array<string> {
  const line: DrawnLine = drawLine(text, "rtl");
  const words: Array<{ word: string; right: number }> = [];
  let start: number = 0;

  for (const word of text.split(" ")) {
    let right: number = -1;

    for (let index: number = start; index < start + word.length; index++) {
      right = Math.max(right, line.drawnAt[index] as number);
    }

    words.push({ word, right });
    start += word.length + 1;
  }

  return words
    .sort(
      (
        a: { word: string; right: number },
        b: { word: string; right: number },
      ): number => {
        return b.right - a.right;
      },
    )
    .map((entry: { word: string; right: number }): string => {
      return entry.word;
    });
}

describe("in English, as the feed always read", () => {
  test("whole minutes, then whole hours, and 'just now' under a minute", () => {
    const english: Translator = dashboardTranslator("en");

    expect(getRelativeTimeLabel(30 * SECOND, english)).toBe("just now");
    expect(getRelativeTimeLabel(MINUTE, english)).toBe("1 minute ago");
    expect(getRelativeTimeLabel(20 * MINUTE + 59 * SECOND, english)).toBe(
      "20 minutes ago",
    );
    expect(getRelativeTimeLabel(HOUR, english)).toBe("1 hour ago");
    expect(getRelativeTimeLabel(3 * HOUR + 59 * MINUTE, english)).toBe(
      "3 hours ago",
    );
  });
});

describe("in the reader's language: its words, its plural forms and its digits", () => {
  test.each([
    ["de", "vor 20 Minuten", "vor 3 Stunden"],
    ["fa", "۲۰ دقیقه پیش", "۳ ساعت پیش"],
    ["ar", "قبل 20 دقيقة", "قبل 3 ساعات"],
    ["ja", "20 分前", "3 時間前"],
  ])(
    "%s: a note 20 minutes old reads %p, one 3 hours old %p",
    (language: string, twentyMinutes: string, threeHours: string) => {
      expect(labelIn(language, 20 * MINUTE)).toBe(twentyMinutes);
      expect(labelIn(language, 3 * HOUR)).toBe(threeHours);
    },
  );

  test("one minute and one hour take the language's own singular", () => {
    expect(labelIn("de", MINUTE)).toBe("vor 1 Minute");
    expect(labelIn("de", HOUR)).toBe("vor 1 Stunde");
    expect(labelIn("fa", MINUTE)).toBe("۱ دقیقه پیش");
    expect(labelIn("ar", HOUR)).toBe("قبل ساعة واحدة");
  });

  test("Russian's three forms, which no one English template could give", () => {
    expect(labelIn("ru", 21 * MINUTE)).toBe("21 минуту назад");
    expect(labelIn("ru", 3 * HOUR)).toBe("3 часа назад");
    expect(labelIn("ru", 5 * HOUR)).toBe("5 часов назад");
  });

  test("counted as before: whole minutes and whole hours, against the feed's now", () => {
    expect(labelIn("de", 20 * MINUTE + 59 * SECOND)).toBe("vor 20 Minuten");
    expect(labelIn("de", 59 * MINUTE + 59 * SECOND)).toBe("vor 59 Minuten");
    expect(labelIn("de", 5 * HOUR + 59 * MINUTE)).toBe("vor 5 Stunden");
  });

  test.each(EVERY_LANGUAGE)(
    "%s words a note's age its own way, never the English template",
    (language: string) => {
      const twentyMinutes: string = labelIn(language, 20 * MINUTE);
      const threeHours: string = labelIn(language, 3 * HOUR);

      expect(twentyMinutes).not.toBe(ENGLISH_TEMPLATE_TWENTY_MINUTES);
      expect(twentyMinutes).not.toMatch(/minutes? ago/);
      expect(threeHours).not.toMatch(/hours? ago/);

      // The count, in the digits every count of the language is written in.
      expect(twentyMinutes).toContain(language === "fa" ? "۲۰" : "20");
      expect(threeHours).toContain(language === "fa" ? "۳" : "3");
    },
  );

  test.each(EVERY_LANGUAGE)(
    "%s: a note under a minute old reads the language's own 'just now'",
    (language: string) => {
      const justNow: string | undefined =
        readDashboardLocale(language)["just now"];

      expect(justNow).toBeTruthy();
      expect(justNow).not.toBe("just now");
      expect(labelIn(language, 10 * SECOND)).toBe(justNow);
      expect(labelIn(language, 59 * SECOND)).toBe(justNow);
    },
  );

  test("Persian: Persian digits, and no Latin digit or letter", () => {
    for (const label of [
      labelIn("fa", 20 * MINUTE),
      labelIn("fa", 3 * HOUR),
      labelIn("fa", 10 * SECOND),
    ]) {
      expect(label).not.toMatch(LATIN_DIGIT);
      expect(label).not.toMatch(LATIN_LETTER);
    }

    expect(labelIn("fa", 20 * MINUTE)).toMatch(PERSIAN_DIGIT);
  });

  test("Arabic: Latin digits, as every count in Arabic is written, and no Latin letter", () => {
    const label: string = labelIn("ar", 20 * MINUTE);

    expect(label).toMatch(LATIN_DIGIT);
    expect(label).not.toMatch(ARABIC_INDIC_DIGIT);
    expect(label).not.toMatch(PERSIAN_DIGIT);
    expect(label).not.toMatch(LATIN_LETTER);
  });
});

describe("on a page read from the right", () => {
  test.each([
    ["fa", 20 * MINUTE, ["۲۰", "دقیقه", "پیش"]],
    ["fa", 3 * HOUR, ["۳", "ساعت", "پیش"]],
    ["ar", 20 * MINUTE, ["قبل", "20", "دقيقة"]],
    ["ar", 3 * HOUR, ["قبل", "3", "ساعات"]],
  ])(
    "%s: the age is read from the right in the order it is written",
    (language: string, ageMs: number, written: Array<string>) => {
      const label: string = labelIn(language, ageMs);

      expect(label.split(" ")).toEqual(written);
      expect(wordsReadFromTheRight(label)).toEqual(written);

      // Its count is drawn as written: "۲۰", never "۰۲".
      const count: string = written.find((word: string) => {
        return COUNT_WORD.test(word);
      }) as string;
      const from: number = label.indexOf(count);

      expect(
        isDrawnAsWritten(drawLine(label, "rtl"), from, from + count.length),
      ).toBe(true);
    },
  );

  test("negative control: the English template the feed drew is read 'minutes ago 20'", () => {
    const line: DrawnLine = drawLine(ENGLISH_TEMPLATE_TWENTY_MINUTES, "rtl");

    expect(getDrawnText(line)).toBe("minutes ago 20");
    expect(wordsReadFromTheRight(ENGLISH_TEMPLATE_TWENTY_MINUTES)).not.toEqual([
      "20",
      "minutes",
      "ago",
    ]);
  });
});

describe("an older note's clock time, and the full date in the tooltip", () => {
  test("in Persian, they are written in Persian digits", () => {
    const older: Date = ago(DAY + 2 * HOUR);

    withDateDisplayLanguage("fa", () => {
      const clock: string = getNoteTimeLabel(
        older,
        NOW,
        dashboardTranslator("fa"),
      );
      const full: string = getNoteFullTimeLabel(older);

      for (const text of [clock, full]) {
        expect(text).toMatch(PERSIAN_DIGIT);
        expect(text).not.toMatch(LATIN_DIGIT);
      }

      expect(clock).toMatch(/^(۱۶:۲۰|۴:۲۰)/);
    });
  });

  test("in English, the clock time is as before", () => {
    expect(
      getNoteTimeLabel(ago(DAY + 2 * HOUR), NOW, dashboardTranslator("en")),
    ).toMatch(/^(16:20|4:20 PM)$/);
  });
});

describe("the time beside a note's author, on the page", () => {
  const instances: Map<string, i18n> = new Map();

  function instanceFor(language: string): i18n {
    const existing: i18n | undefined = instances.get(language);

    if (existing) {
      return existing;
    }

    const instance: i18n = createInstance();

    instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: readDashboardLocale("en") },
        [language]: { translation: readDashboardLocale(language) },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
      initImmediate: false,
    });
    instances.set(language, instance);

    return instance;
  }

  function noteWritten(ageMs: number): NoteRecord {
    const author: User = new User();
    author.name = new Name("Diego Ramos");

    return {
      _id: "a1b2c3d4-0000-4000-8000-000000000020",
      note: "Rolled back the 14:05 deploy.",
      createdAt: ago(ageMs),
      createdByUser: author,
    };
  }

  function renderNoteIn(language: string, ageMs: number): HTMLElement {
    render(
      <I18nextProvider i18n={instanceFor(language)}>
        <ul>
          <NoteCard
            note={noteWritten(ageMs)}
            visibility="private"
            copy={getNotesCopy(
              "private",
              "incident",
              dashboardTranslator(language),
            )}
            now={NOW}
            isLastInFeed={true}
            editGate={{ isShown: false, isDisabled: false }}
            deleteGate={{ isShown: false, isDisabled: false }}
            isEditing={false}
            onStartEdit={() => {}}
            onCancelEdit={() => {}}
            onSaveEdit={async () => {}}
            onDelete={async () => {}}
            isPostedAtEditable={false}
          />
        </ul>
      </I18nextProvider>,
    );

    return screen.getByTestId("note-time");
  }

  afterEach(() => {
    cleanup();
  });

  test("in Persian, a note 20 minutes old reads '۲۰ دقیقه پیش'", () => {
    expect(renderNoteIn("fa", 20 * MINUTE)).toHaveTextContent(/^۲۰ دقیقه پیش$/);
  });

  test("in Persian, a note under a minute old reads 'همین حالا'", () => {
    expect(renderNoteIn("fa", 10 * SECOND)).toHaveTextContent(/^همین حالا$/);
  });

  test("in Arabic and German, the same note in their words", () => {
    expect(renderNoteIn("ar", 20 * MINUTE)).toHaveTextContent(/^قبل 20 دقيقة$/);
    cleanup();
    expect(renderNoteIn("de", 3 * HOUR)).toHaveTextContent(/^vor 3 Stunden$/);
  });

  test("in English, as before", () => {
    expect(renderNoteIn("en", 20 * MINUTE)).toHaveTextContent(
      /^20 minutes ago$/,
    );
  });
});
