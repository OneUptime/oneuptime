/** @timezone UTC */
import { describe, expect, jest, test } from "@jest/globals";
import OneUptimeDate from "../../Types/Date";
import {
  composedValue,
  createTranslator,
  isComposedValue,
  Translator,
} from "../../Types/Translator";
import {
  DAYS_READ_WITH_A_VOWEL,
  getMomentRole,
  isDayReadWithAVowel,
  momentPhrase,
  MOMENT_PHRASE_FORMS,
  MOMENT_PHRASES,
  MOMENT_ROLES,
  MomentPhraseWords,
  MomentRole,
  readLeadingNumber,
  wordMoment,
  writeMomentInTimezone,
  writeMomentInUtc,
  writeReaderMoment,
  WrittenMoment,
} from "../../Utils/MomentPhrases";

/*
 * A moment's words (#10622): "at 14:25" today, "on 27 Nov at 14:25" on
 * another day, since and until each way, composed with the translator its
 * sentence is worded by - so a sentence never puts a time's preposition
 * before a day, and an English sentence never holds another language's
 * phrase.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

const TODAY: WrittenMoment = { date: null, time: "14:25", whole: "14:25" };
const ANOTHER_DAY: WrittenMoment = {
  date: "27 Nov",
  time: "14:25",
  whole: "27 Nov, 14:25",
};

describe("a moment's words", () => {
  test.each([
    [MomentRole.At, "at 14:25", "on 27 Nov at 14:25"],
    [MomentRole.Since, "since 14:25", "since 27 Nov at 14:25"],
    [MomentRole.Until, "until 14:25", "until 27 Nov at 14:25"],
  ])(
    "%s: a time alone today, the day and its time on another day",
    (role: MomentRole, today: string, anotherDay: string) => {
      expect(wordMoment({ role, moment: TODAY, translator: ENGLISH })).toBe(
        today,
      );
      expect(
        wordMoment({ role, moment: ANOTHER_DAY, translator: ENGLISH }),
      ).toBe(anotherDay);
    },
  );

  test("each part a moment plays has a time's phrase, a day's and a vowel day's, each a plural English words alike", () => {
    expect(MOMENT_ROLES).toEqual([
      MomentRole.At,
      MomentRole.Since,
      MomentRole.Until,
    ]);
    expect(MOMENT_PHRASE_FORMS).toEqual(["time", "day", "vowelDay"]);

    for (const role of MOMENT_ROLES) {
      const words: MomentPhraseWords = MOMENT_PHRASES[role];

      for (const form of MOMENT_PHRASE_FORMS) {
        // English's article never changes with the hour.
        expect(words[form].one).toBe(words[form].other);
        expect(words[form].other).toContain("{{clock}}");
      }

      expect(words.time.other).not.toContain("{{day}}");
      expect(words.time.other).not.toContain("{{vowelDay}}");
      expect(words.day.other).toContain("{{day}}");
      expect(words.day.other).not.toContain("{{vowelDay}}");
      expect(words.vowelDay.other).toContain("{{vowelDay}}");
      expect(words.vowelDay.other).not.toContain("{{day}}");
      // The vowel day's phrase is the day's, its day named for what it holds.
      expect(words.vowelDay.other).toBe(
        words.day.other.replace("{{day}}", "{{vowelDay}}"),
      );
    }
  });

  test("the phrases' keys are theirs alone: no other place looks one up with something else in it", () => {
    // "until {{time}}" is also an on-call shift's end, a weekday and a time in it.
    expect(
      MOMENT_ROLES.flatMap((role: MomentRole): Array<string> => {
        return MOMENT_PHRASE_FORMS.map((form: keyof MomentPhraseWords) => {
          return MOMENT_PHRASES[role][form].other;
        });
      }),
    ).toEqual([
      "at {{clock}}",
      "on {{day}} at {{clock}}",
      "on {{vowelDay}} at {{clock}}",
      "since {{clock}}",
      "since {{day}} at {{clock}}",
      "since {{vowelDay}} at {{clock}}",
      "until {{clock}}",
      "until {{day}} at {{clock}}",
      "until {{vowelDay}} at {{clock}}",
    ]);
  });

  test("a placeholder's name says the part its moment plays", () => {
    expect(getMomentRole("since")).toBe(MomentRole.Since);
    expect(getMomentRole("until")).toBe(MomentRole.Until);

    for (const name of ["time", "ended", "latest", "confirmed", "askedAt"]) {
      expect(getMomentRole(name)).toBe(MomentRole.At);
    }
  });
});

describe("the number a moment's text starts with (#10902)", () => {
  test.each([
    // A day, as each language writes it.
    ["8 dic", 8],
    ["11 Dec", 11],
    ["01 Dec", 1],
    ["8. Dez.", 8],
    ["8 de dez.", 8],
    ["12月8日", 12],
    ["2026-11-08", 2026],
    // A clock: the hour, on a 24-hour clock and on a 12-hour one.
    ["01:25", 1],
    ["1:25 PM", 1],
    ["1:25 p. m.", 1],
    ["13:25", 13],
    ["12:25 AM", 12],
    ["00:25", 0],
    ["14.25", 14],
    ["14:25 UTC", 14],
    // In the digits Persian, Arabic and Hindi may write.
    ["۸ دسامبر", 8],
    ["٠١:٢٥", 1],
    ["१:२५", 1],
    ["１:２５", 1],
    // After a direction mark, or a space.
    ["‏۱۴:۲۵", 14],
    ["⁨ 8 dic⁩", 8],
  ])("%s starts with %s", (text: string, number: number) => {
    expect(readLeadingNumber(text)).toBe(number);
  });

  test.each([
    ["Nov 8, 2026"],
    ["오후 1:25"],
    ["午後2:25"],
    ["下午2:25"],
    [""],
    ["   "],
  ])("%s starts with no number", (text: string) => {
    expect(readLeadingNumber(text)).toBeNull();
  });
});

describe("the days a language reads with a vowel first (#10902)", () => {
  test("Italian reads the 8th and the 11th with one, and the 1st, il primo, with none", () => {
    expect(DAYS_READ_WITH_A_VOWEL).toEqual({ it: [8, 11] });

    for (let day: number = 1; day <= 31; day++) {
      expect(isDayReadWithAVowel("it", day)).toBe(day === 8 || day === 11);
    }
  });

  test("they are the days of a month CLDR's Italian ordinals set apart for l'", () => {
    const ordinals: Intl.PluralRules = new Intl.PluralRules("it", {
      type: "ordinal",
    });

    for (let day: number = 1; day <= 31; day++) {
      expect(isDayReadWithAVowel("it", day)).toBe(
        ordinals.select(day) === "many",
      );
    }
  });

  test("a language is known by its code without its region, and a language not listed reads none", () => {
    expect(isDayReadWithAVowel("it-IT", 8)).toBe(true);
    expect(isDayReadWithAVowel("IT", 11)).toBe(true);

    for (const language of ["en", "fr", "es", "pt", "de", "ca", ""]) {
      for (const day of [1, 8, 11, 18]) {
        expect(isDayReadWithAVowel(language, day)).toBe(false);
      }
    }
  });
});

describe("a moment's form is chosen by what it holds (#10902)", () => {
  // A language whose words change at one o'clock, as Spanish's do.
  const SPANISH_LIKE: Record<string, string> = {
    "at {{clock}}": "a las {{clock}}",
    "at {{clock}}_one": "a la {{clock}}",
    "on {{day}} at {{clock}}": "el {{day}} a las {{clock}}",
    "on {{day}} at {{clock}}_one": "el {{day}} a la {{clock}}",
    "on {{vowelDay}} at {{clock}}": "el {{vowelDay}} a las {{clock}}",
    "on {{vowelDay}} at {{clock}}_one": "el {{vowelDay}} a la {{clock}}",
  };
  // One whose words change on a day read with a vowel first too, as Italian's do.
  const ITALIAN_LIKE: Record<string, string> = {
    "until {{clock}}": "fino alle {{clock}}",
    "until {{clock}}_one": "fino all'{{clock}}",
    "until {{day}} at {{clock}}": "fino al {{day}} alle {{clock}}",
    "until {{day}} at {{clock}}_one": "fino al {{day}} all'{{clock}}",
    "until {{vowelDay}} at {{clock}}": "fino all'{{vowelDay}} alle {{clock}}",
    "until {{vowelDay}} at {{clock}}_one": "fino all'{{vowelDay}} all'{{clock}}",
  };

  function translatorOf(
    words: Record<string, string>,
    language: string,
  ): Translator {
    return createTranslator((key: string): string | undefined => {
      return words[key];
    }, language);
  }

  function moment(date: string | null, time: string): WrittenMoment {
    return {
      date,
      time,
      whole: date ? `${date}, ${time}` : time,
    };
  }

  const spanish: Translator = translatorOf(SPANISH_LIKE, "es");
  const italian: Translator = translatorOf(ITALIAN_LIKE, "it");

  test("the hour a clock starts with: one o'clock takes its one form, every other hour the general", () => {
    const at: (time: string) => string = (time: string): string => {
      return wordMoment({
        role: MomentRole.At,
        moment: moment(null, time),
        translator: spanish,
      });
    };

    expect(at("01:25")).toBe("a la 01:25");
    expect(at("1:25 p. m.")).toBe("a la 1:25 p. m.");
    expect(at("13:25")).toBe("a las 13:25");
    expect(at("00:25")).toBe("a las 00:25");
    expect(at("21:25")).toBe("a las 21:25");
    expect(at("12:25 a. m.")).toBe("a las 12:25 a. m.");
  });

  test("a clock that starts with no number takes the general form", () => {
    expect(
      wordMoment({
        role: MomentRole.At,
        moment: moment(null, "오후 1:25"),
        translator: spanish,
      }),
    ).toBe("a las 오후 1:25");
  });

  test("the hours a language's plurals call one: Portuguese counts 0 as one, a zero hora", () => {
    const portuguese: Translator = translatorOf(
      { "at {{clock}}": "às {{clock}}", "at {{clock}}_one": "à {{clock}}" },
      "pt",
    );
    const at: (time: string) => string = (time: string): string => {
      return wordMoment({
        role: MomentRole.At,
        moment: moment(null, time),
        translator: portuguese,
      });
    };

    expect(at("00:25")).toBe("à 00:25");
    expect(at("01:25")).toBe("à 01:25");
    expect(at("02:25")).toBe("às 02:25");
    expect(at("21:25")).toBe("às 21:25");
  });

  test("a day the language reads with a vowel first takes its vowel day's phrase, the hour its form too", () => {
    const until: (date: string, time: string) => string = (
      date: string,
      time: string,
    ): string => {
      return wordMoment({
        role: MomentRole.Until,
        moment: moment(date, time),
        translator: italian,
      });
    };

    expect(until("8 dic", "14:25")).toBe("fino all'8 dic alle 14:25");
    expect(until("11 dic", "14:25")).toBe("fino all'11 dic alle 14:25");
    expect(until("8 dic", "01:25")).toBe("fino all'8 dic all'01:25");
    expect(until("1 dic", "14:25")).toBe("fino al 1 dic alle 14:25");
    expect(until("18 dic", "01:25")).toBe("fino al 18 dic all'01:25");
    expect(until("27 dic", "14:25")).toBe("fino al 27 dic alle 14:25");
  });

  test("a day written with no day of the month first takes the day's phrase", () => {
    for (const date of ["2026-12-08", "Dec 8, 2026", "dicembre 8"]) {
      expect(
        wordMoment({
          role: MomentRole.Until,
          moment: moment(date, "14:25"),
          translator: italian,
        }),
      ).toBe(`fino al ${date} alle 14:25`);
    }
  });

  test("a language that reads no day with a vowel never takes the vowel day's phrase, though it words it", () => {
    expect(
      wordMoment({
        role: MomentRole.At,
        moment: moment("8 dic", "14:25"),
        translator: spanish,
      }),
    ).toBe("el 8 dic a las 14:25");
  });

  test("a language that has not worded its vowel day's phrase yet reads its day's, never English's", () => {
    const italianWithoutVowelDays: Translator = translatorOf(
      {
        "until {{day}} at {{clock}}": "fino al {{day}} alle {{clock}}",
        "until {{day}} at {{clock}}_one": "fino al {{day}} all'{{clock}}",
      },
      "it",
    );

    expect(
      wordMoment({
        role: MomentRole.Until,
        moment: moment("8 dic", "14:25"),
        translator: italianWithoutVowelDays,
      }),
    ).toBe("fino al 8 dic alle 14:25");
  });

  test("a language that has not worded its one o'clock form yet reads its general form", () => {
    const withoutOne: Translator = translatorOf(
      { "since {{clock}}": "desde las {{clock}}" },
      "es",
    );

    expect(
      wordMoment({
        role: MomentRole.Since,
        moment: moment(null, "01:25"),
        translator: withoutOne,
      }),
    ).toBe("desde las 01:25");
  });

  test("English reads every form alike, whatever the day or the hour", () => {
    for (const date of ["01 Dec", "08 Dec", "11 Dec"]) {
      for (const time of ["01:25", "1:25 AM", "00:25", "14:25"]) {
        expect(
          wordMoment({
            role: MomentRole.Until,
            moment: moment(date, time),
            translator: ENGLISH,
          }),
        ).toBe(`until ${date} at ${time}`);
      }
    }
  });

  test("a sentence the language words holds the form its moment takes", () => {
    const sentence: string = "Blocked {{until}}";
    const withSentence: Translator = translatorOf(
      { ...ITALIAN_LIKE, [sentence]: "Bloccato {{until}}" },
      "it",
    );

    expect(
      withSentence.translateTemplate(sentence, {
        until: momentPhrase(MomentRole.Until, moment("11 dic", "01:25")),
      }),
    ).toBe("Bloccato fino all'11 dic all'01:25");
  });
});

describe("a moment goes into its sentence worded with it", () => {
  // A language that words the phrases but not the sentence, and one that words both.
  const PHRASES_ONLY: Record<string, string> = {
    "at {{clock}}": "a las {{clock}}",
    "on {{day}} at {{clock}}": "el {{day}} a las {{clock}}",
  };
  const SENTENCE: string = "{{address}} got through again {{time}}.";

  test("a sentence the language words takes the language's phrase", () => {
    const spanish: Translator = createTranslator((key: string) => {
      return (
        {
          ...PHRASES_ONLY,
          [SENTENCE]: "{{address}} volvió a pasar {{time}}.",
        } as Record<string, string>
      )[key];
    }, "es");

    expect(
      spanish.translateTemplate(SENTENCE, {
        address: "1.2.3.4",
        time: momentPhrase(MomentRole.At, ANOTHER_DAY),
      }),
    ).toBe("1.2.3.4 volvió a pasar el 27 Nov a las 14:25.");
    expect(
      spanish.translateTemplate(SENTENCE, {
        address: "1.2.3.4",
        time: momentPhrase(MomentRole.At, TODAY),
      }),
    ).toBe("1.2.3.4 volvió a pasar a las 14:25.");
  });

  test("a sentence the language has not worded yet reads in English, its moment too", () => {
    const spanish: Translator = createTranslator((key: string) => {
      return PHRASES_ONLY[key];
    }, "es");

    expect(
      spanish.translateTemplate(SENTENCE, {
        address: "1.2.3.4",
        time: momentPhrase(MomentRole.At, ANOTHER_DAY),
      }),
    ).toBe("1.2.3.4 got through again on 27 Nov at 14:25.");
  });

  test("is a composed value, worded by whichever translator fills the sentence", () => {
    const phrase: ReturnType<typeof momentPhrase> = momentPhrase(
      MomentRole.Until,
      ANOTHER_DAY,
    );

    expect(isComposedValue(phrase)).toBe(true);
    expect(phrase.compose(ENGLISH)).toBe("until 27 Nov at 14:25");
    expect(
      composedValue((translator: Translator): string => {
        return phrase.compose(translator);
      }).compose(ENGLISH),
    ).toBe("until 27 Nov at 14:25");
  });
});

describe("where a moment is written", () => {
  const MOMENT: Date = new Date("2026-11-27T14:25:00.000Z");

  test("on the reader's clock: the time alone today", () => {
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(false);

    const today: WrittenMoment = writeReaderMoment(
      MOMENT,
      new Date("2026-11-27T20:00:00.000Z"),
    );

    expect(today).toEqual({ date: null, time: "14:25", whole: "14:25" });
    jest.restoreAllMocks();
  });

  test("on the reader's clock: the day and its time on another day", () => {
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(false);

    const before: WrittenMoment = writeReaderMoment(
      MOMENT,
      new Date("2026-11-30T09:00:00.000Z"),
    );

    expect(before.date).toBe(
      OneUptimeDate.getDateAsLocalDayMonthString(MOMENT),
    );
    expect(before.time).toBe("14:25");
    expect(before.whole).toBe(
      OneUptimeDate.getDateAsLocalDayMonthTimeString(MOMENT, {
        use12HourFormat: false,
      }),
    );
    jest.restoreAllMocks();
  });

  test("for OneUptime AI and its report: in UTC, the same for everyone", () => {
    expect(writeMomentInUtc(MOMENT)).toEqual({
      date: "2026-11-27",
      time: "14:25 UTC",
      whole: "2026-11-27 14:25 UTC",
    });
    expect(
      wordMoment({
        role: MomentRole.At,
        moment: writeMomentInUtc(MOMENT),
        translator: ENGLISH,
      }),
    ).toBe("on 2026-11-27 at 14:25 UTC");
  });

  test("for a timeline or an email: always the day with its year, the time in the zone named", () => {
    const utc: WrittenMoment = writeMomentInTimezone({
      time: MOMENT,
      timezone: "UTC",
    });

    expect(utc.date).toBe("Nov 27, 2026");
    expect(utc.time).toBe("14:25 UTC");

    const kolkata: WrittenMoment = writeMomentInTimezone({
      time: MOMENT,
      timezone: "Asia/Kolkata",
    });

    expect(kolkata.date).toBe("Nov 27, 2026");
    expect(kolkata.time).toBe("19:55 IST");
    expect(
      wordMoment({
        role: MomentRole.Since,
        moment: kolkata,
        translator: ENGLISH,
      }),
    ).toBe("since Nov 27, 2026 at 19:55 IST");
  });
});
