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
  getMomentRole,
  momentPhrase,
  MOMENT_PHRASES,
  MOMENT_ROLES,
  MomentRole,
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

  test("each part a moment plays has a time's form and a day's, each one key", () => {
    expect(MOMENT_ROLES).toEqual([
      MomentRole.At,
      MomentRole.Since,
      MomentRole.Until,
    ]);

    for (const role of MOMENT_ROLES) {
      expect(MOMENT_PHRASES[role].time).toContain("{{clock}}");
      expect(MOMENT_PHRASES[role].time).not.toContain("{{day}}");
      expect(MOMENT_PHRASES[role].day).toContain("{{day}}");
      expect(MOMENT_PHRASES[role].day).toContain("{{clock}}");
    }
  });

  test("the phrases' keys are theirs alone: no other place looks one up with something else in it", () => {
    // "until {{time}}" is also an on-call shift's end, a weekday and a time in it.
    expect(
      MOMENT_ROLES.flatMap((role: MomentRole): Array<string> => {
        return [MOMENT_PHRASES[role].time, MOMENT_PHRASES[role].day];
      }),
    ).toEqual([
      "at {{clock}}",
      "on {{day}} at {{clock}}",
      "since {{clock}}",
      "since {{day}} at {{clock}}",
      "until {{clock}}",
      "until {{day}} at {{clock}}",
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
    jest.spyOn(OneUptimeDate, "getUserPrefers12HourFormat").mockReturnValue(
      false,
    );

    const today: WrittenMoment = writeReaderMoment(
      MOMENT,
      new Date("2026-11-27T20:00:00.000Z"),
    );

    expect(today).toEqual({ date: null, time: "14:25", whole: "14:25" });
    jest.restoreAllMocks();
  });

  test("on the reader's clock: the day and its time on another day", () => {
    jest.spyOn(OneUptimeDate, "getUserPrefers12HourFormat").mockReturnValue(
      false,
    );

    const before: WrittenMoment = writeReaderMoment(
      MOMENT,
      new Date("2026-11-30T09:00:00.000Z"),
    );

    expect(before.date).toBe(OneUptimeDate.getDateAsLocalDayMonthString(MOMENT));
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
      wordMoment({ role: MomentRole.Since, moment: kolkata, translator: ENGLISH }),
    ).toBe("since Nov 27, 2026 at 19:55 IST");
  });
});
