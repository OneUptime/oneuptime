import OneUptimeDate from "../Types/Date";
import Timezone from "../Types/Timezone";
import {
  ComposedValue,
  Translator,
  composedValue,
  translationKey,
} from "../Types/Translator";

/*
 * A MOMENT IN A SENTENCE, WITH THE WORDS IT TAKES (#10622).
 *
 * A moment is written as a time alone when it falls today - "14:25" - and
 * as its day and its time on any other day - "27 Nov, 14:25" - the way the
 * rest of the product writes one (OneUptimeDate). A sentence that put its
 * own preposition before the moment read right for one of the two and
 * wrong for the other: Spanish "a las 27 nov, 14:25", Italian "alle 27 nov,
 * 14:25", French "à 27 nov., 14:25", for a fix watched over seven days.
 *
 * So a sentence names a moment with no preposition of its own -
 * "{{address}} got through again {{time}}: the block is not holding." -
 * and the moment brings its words with it, by what it holds and the part
 * it plays in the sentence (MomentRole):
 *
 *   At     at 14:25            on 27 Nov at 14:25
 *   Since  since 14:25         since 27 Nov at 14:25
 *   Until  until 14:25         until 27 Nov at 14:25
 *
 * each worded by the reader's language from its own key, so "el 27 nov a
 * las 14:25", "le 27 nov. à 14:25", "il 27 nov alle 14:25". The phrase is
 * a composed value: it is worded by the translator the sentence is worded
 * by, so an English sentence takes the English phrase.
 *
 * The keys name their parts {{clock}} and {{day}}, so they are these
 * phrases' alone: "until {{time}}" is also an on-call shift's end and a
 * story's, filled with a weekday and a time, and a language words a clock
 * time on its own differently ("fino alle 14:25", not "fino a 14:25").
 *
 * A sentence never starts with a moment in a language whose letters have a
 * case: the phrase is worded for the middle of a sentence ("seit 14:25"),
 * and would start it without its capital (StepCheckMomentsReadRight).
 */

export enum MomentRole {
  // When something happened, or happens: "at 14:25".
  At = "At",
  // Since when something holds: "since 14:25".
  Since = "Since",
  // Until when something holds: "until 14:25".
  Until = "Until",
}

export const MOMENT_ROLES: ReadonlyArray<MomentRole> = [
  MomentRole.At,
  MomentRole.Since,
  MomentRole.Until,
];

// A moment as the place it is drawn writes it.
export interface WrittenMoment {
  // Its day, when it is not today: "27 Nov". Null for a time today.
  date: string | null;
  // Its time of day: "14:25", "2:25 PM".
  time: string;
  // The two as one, as a sentence written before #10622 took it: "27 Nov, 14:25".
  whole: string;
}

// What each part a moment plays reads as: with a time alone, and with a day.
export interface MomentPhraseWords {
  time: string;
  day: string;
}

export const MOMENT_PHRASES: Record<MomentRole, MomentPhraseWords> = {
  [MomentRole.At]: {
    time: translationKey("at {{clock}}"),
    day: translationKey("on {{day}} at {{clock}}"),
  },
  [MomentRole.Since]: {
    time: translationKey("since {{clock}}"),
    day: translationKey("since {{day}} at {{clock}}"),
  },
  [MomentRole.Until]: {
    time: translationKey("until {{clock}}"),
    day: translationKey("until {{day}} at {{clock}}"),
  },
};

// The phrase a moment reads as, in the language of `translator`.
export function wordMoment(data: {
  role: MomentRole;
  moment: WrittenMoment;
  translator: Translator;
}): string {
  const words: MomentPhraseWords = MOMENT_PHRASES[data.role];

  return data.moment.date
    ? data.translator.translateTemplate(words.day, {
        day: data.moment.date,
        clock: data.moment.time,
      })
    : data.translator.translateTemplate(words.time, {
        clock: data.moment.time,
      });
}

/*
 * A moment as a sentence's value: worded with the sentence, by the
 * translator that words it.
 */
export function momentPhrase(
  role: MomentRole,
  moment: WrittenMoment,
): ComposedValue {
  return composedValue((translator: Translator): string => {
    return wordMoment({ role, moment, translator });
  });
}

/*
 * The part a sentence's moment plays, by the name of its placeholder:
 * {{since}} is since when, {{until}} until when, and every other moment -
 * {{time}}, {{ended}}, {{latest}}, {{confirmed}} - when.
 */
export function getMomentRole(placeholder: string): MomentRole {
  switch (placeholder) {
    case "since":
      return MomentRole.Since;
    case "until":
      return MomentRole.Until;
    default:
      return MomentRole.At;
  }
}

/*
 * A moment on the reader's clock, in their language: the time alone today,
 * the day and the time on any other day.
 */
export function writeReaderMoment(
  time: Date,
  now: Date = new Date(),
): WrittenMoment {
  const use12HourFormat: boolean = OneUptimeDate.getUserPrefers12HourFormat();
  const clock: string = OneUptimeDate.getLocalTimeString(time, {
    use12HourFormat,
  });
  const day: string = OneUptimeDate.getDateAsLocalDayMonthString(time);

  if (day === OneUptimeDate.getDateAsLocalDayMonthString(now)) {
    return { date: null, time: clock, whole: clock };
  }

  return {
    date: day,
    time: clock,
    whole: OneUptimeDate.getDateAsLocalDayMonthTimeString(time, {
      use12HourFormat,
    }),
  };
}

/*
 * A moment as OneUptime AI reads it, and its report: the same for everyone,
 * in UTC - "2026-11-27" and "14:25 UTC".
 */
export function writeMomentInUtc(time: Date): WrittenMoment {
  const iso: string = time.toISOString();
  const date: string = iso.slice(0, 10);
  const clock: string = `${iso.slice(11, 16)} UTC`;

  return { date, time: clock, whole: `${date} ${clock}` };
}

/*
 * A moment as a text read later, anywhere - a timeline entry, an email, a
 * report: always its day with its year, and its time on a 24-hour clock in
 * `timezone`, named: "Nov 27, 2026" and "14:25 UTC".
 */
export function writeMomentInTimezone(data: {
  time: Date;
  timezone: string;
}): WrittenMoment {
  const zone: string = OneUptimeDate.getZoneAbbrByTimezone(
    data.timezone as Timezone,
    data.time,
  );
  const clock: string = OneUptimeDate.getTimeStringInTimezone(data.time, {
    timezone: data.timezone,
    use12HourFormat: false,
  });

  return {
    date: OneUptimeDate.getDateAsFormattedStringInTimezone({
      date: data.time,
      timezone: data.timezone,
      onlyShowDate: true,
    }),
    time: zone ? `${clock} ${zone}` : clock,
    whole: OneUptimeDate.getDateAsFormattedStringInTimezone({
      date: data.time,
      timezone: data.timezone,
      use12HourFormat: false,
    }),
  };
}
