import OneUptimeDate from "../Types/Date";
import Timezone from "../Types/Timezone";
import {
  ComposedValue,
  PluralTemplate,
  TemplateValues,
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
 *
 * WHAT THE MOMENT HOLDS CHOOSES ITS FORM (#10902). A word of the phrase can
 * change with the day or the hour it holds, the way a noun changes with a
 * count, so each phrase has forms a language words, chosen as a plural is:
 *
 *   - By the hour its clock starts with: a phrase is a plural, counted by
 *     that hour, since the hour is what its article agrees with. Spanish
 *     "a las 14:25" but "a la 1:25" (la una), Italian "alle 14:25" but
 *     "all'1:25" (l'una), Portuguese "às 14:25" but "à 1:25" (a uma) and
 *     "à 0:25" (a zero hora: Portuguese counts 0 as one). The "_one" form
 *     is read for the hours the language's plural rules call one, as every
 *     plural's is (Translator's translatePlural); a language whose article
 *     never changes words it as its general form.
 *   - By the day it starts with: a day the language reads with a vowel
 *     first takes a phrase of its own, {{vowelDay}} in place of {{day}}:
 *     Italian elides its article there, "l'8 dic", "dall'8 dic", "fino
 *     all'11 dic", where any other day reads "il 27 dic". Which days those
 *     are is the language's own (DAYS_READ_WITH_A_VOWEL); a language with
 *     none never reads the phrase, and words it as its day phrase.
 *
 * Both are read from what the moment's text starts with, as a reader
 * reads it: "8 dic" is the 8th, "01:25" and "1:25 PM" one o'clock, while a
 * day written "2026-11-08" or "Nov 8, 2026" starts with no day of the
 * month, and takes the general form. The forms are in the locale files,
 * and StepCheckMomentsReadRight holds each to its phrase's endings.
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

/*
 * What each part a moment plays reads as: with a time alone, with a day,
 * and with a day the language reads with a vowel first - each a plural,
 * counted by the hour its clock starts with. English words every form
 * alike.
 */
export interface MomentPhraseWords {
  time: PluralTemplate;
  day: PluralTemplate;
  vowelDay: PluralTemplate;
}

export const MOMENT_PHRASES: Record<MomentRole, MomentPhraseWords> = {
  [MomentRole.At]: {
    time: {
      one: translationKey("at {{clock}}"),
      other: translationKey("at {{clock}}"),
    },
    day: {
      one: translationKey("on {{day}} at {{clock}}"),
      other: translationKey("on {{day}} at {{clock}}"),
    },
    vowelDay: {
      one: translationKey("on {{vowelDay}} at {{clock}}"),
      other: translationKey("on {{vowelDay}} at {{clock}}"),
    },
  },
  [MomentRole.Since]: {
    time: {
      one: translationKey("since {{clock}}"),
      other: translationKey("since {{clock}}"),
    },
    day: {
      one: translationKey("since {{day}} at {{clock}}"),
      other: translationKey("since {{day}} at {{clock}}"),
    },
    vowelDay: {
      one: translationKey("since {{vowelDay}} at {{clock}}"),
      other: translationKey("since {{vowelDay}} at {{clock}}"),
    },
  },
  [MomentRole.Until]: {
    time: {
      one: translationKey("until {{clock}}"),
      other: translationKey("until {{clock}}"),
    },
    day: {
      one: translationKey("until {{day}} at {{clock}}"),
      other: translationKey("until {{day}} at {{clock}}"),
    },
    vowelDay: {
      one: translationKey("until {{vowelDay}} at {{clock}}"),
      other: translationKey("until {{vowelDay}} at {{clock}}"),
    },
  },
};

// Every form of each phrase, by its locale key: the general form, then the "_one" form.
export const MOMENT_PHRASE_FORMS: ReadonlyArray<keyof MomentPhraseWords> = [
  "time",
  "day",
  "vowelDay",
];

/*
 * The days of a month a language reads with a vowel first, where the word
 * before the day changes for them. Italian: 8 and 11, "l'8 dic" (otto),
 * "dall'11 dic" (undici) - the days among those CLDR's Italian ordinals
 * set apart for "l'" (8, 11, 80, 800). The 1st is "il primo", written
 * "il 1 dic", read with a consonant. A language not listed has none.
 */
export const DAYS_READ_WITH_A_VOWEL: Readonly<
  Record<string, ReadonlyArray<number>>
> = {
  it: [8, 11],
};

// A language's code without its region: "pt" of "pt-BR".
function baseLanguageOf(language: string): string {
  return (language.split("-")[0] || "").trim().toLowerCase();
}

// Whether `language` reads the day of the month `day` with a vowel first.
export function isDayReadWithAVowel(language: string, day: number): boolean {
  return (DAYS_READ_WITH_A_VOWEL[baseLanguageOf(language)] || []).includes(
    day,
  );
}

/*
 * The zero of each script a day or a clock is written in: Latin, as every
 * language with forms writes them, and the scripts some languages write
 * their digits in (Arabic-Indic, Persian, Devanagari, fullwidth).
 */
const DIGIT_ZEROS: ReadonlyArray<number> = [
  0x30, 0x660, 0x6f0, 0x966, 0xff10,
];

function digitValue(character: string): number | null {
  const code: number = character.codePointAt(0) ?? -1;

  for (const zero of DIGIT_ZEROS) {
    if (code >= zero && code <= zero + 9) {
      return code - zero;
    }
  }

  return null;
}

// Marks a page may set before a moment's text (a direction mark), and spaces.
const LEADING_MARKS: RegExp = /^[\s\p{Cf}]+/u;

/*
 * The number a moment's text starts with, as a reader reads it: 8 of
 * "8 dic", 1 of "01:25" and of "1:25 PM", 2026 of "2026-11-08". Null when
 * it starts with anything else - a month's name, "오후" - or holds no digit
 * of a script it knows.
 */
export function readLeadingNumber(text: string): number | null {
  const rest: string = text.replace(LEADING_MARKS, "");
  let value: number | null = null;

  for (const character of rest) {
    const digit: number | null = digitValue(character);

    if (digit === null) {
      break;
    }

    value = (value ?? 0) * 10 + digit;
  }

  return value;
}

/*
 * A phrase's form for the hour its clock starts with, or its general form
 * when the clock starts with no number.
 */
function wordForm(data: {
  phrase: PluralTemplate;
  hour: number | null;
  values: TemplateValues;
  translator: Translator;
}): string {
  return data.hour === null
    ? data.translator.translateTemplate(data.phrase.other, data.values)
    : data.translator.translatePlural(data.phrase, data.hour, data.values);
}

// The phrase a moment reads as, in the language of `translator`.
export function wordMoment(data: {
  role: MomentRole;
  moment: WrittenMoment;
  translator: Translator;
}): string {
  const words: MomentPhraseWords = MOMENT_PHRASES[data.role];
  const hour: number | null = readLeadingNumber(data.moment.time);

  if (!data.moment.date) {
    return wordForm({
      phrase: words.time,
      hour,
      values: { clock: data.moment.time },
      translator: data.translator,
    });
  }

  const day: number | null = readLeadingNumber(data.moment.date);

  /*
   * A day the language reads with a vowel first, in a language that words
   * its phrase: one that has not yet reads the day phrase, never English.
   */
  if (
    day !== null &&
    isDayReadWithAVowel(data.translator.language, day) &&
    data.translator.hasTranslation(words.vowelDay.other)
  ) {
    return wordForm({
      phrase: words.vowelDay,
      hour,
      values: { vowelDay: data.moment.date, clock: data.moment.time },
      translator: data.translator,
    });
  }

  return wordForm({
    phrase: words.day,
    hour,
    values: { day: data.moment.date, clock: data.moment.time },
    translator: data.translator,
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
