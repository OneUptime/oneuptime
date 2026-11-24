/** @timezone UTC */
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import OneUptimeDate from "../../../Types/Date";
import { withDateDisplayLanguage } from "../../../Types/DateLanguage";
import { Translator } from "../../../Types/Translator";
import {
  MOMENT_ROLES,
  MomentRole,
  wordMoment,
  writeReaderMoment,
  WrittenMoment,
} from "../../../Utils/MomentPhrases";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
} from "../../Helpers/DashboardLocales";

/*
 * A MOMENT'S WORDS IN EVERY LANGUAGE, ON THE DAYS AND AT THE HOURS WHOSE
 * ARTICLE CHANGES (#10902).
 *
 * A moment is written as the reader's language writes it (writeReaderMoment,
 * under the reader's language) and worded with the Dashboard's own locale
 * files, at, since and until it: today, at a quarter past two and at
 * twenty-five past one and past midnight; on the 1st (Italian "il primo"),
 * the 8th and the 11th (Italian "l'8", "l'11"), and the 18th (diciotto, read
 * with a consonant); and on the 8th at twenty-five past one - on a 24-hour
 * clock and on a 12-hour one. Each is the language's own sentence, pinned
 * here word for word:
 *
 *   - Spanish takes the singular at one o'clock: "a la 1:25", "a las 14:25";
 *   - Portuguese too, and at midnight, a zero hora: "à 0:25", "às 14:25";
 *   - Italian elides its article at one o'clock, "all'1:25", and before the
 *     8th and the 11th, "l'8 dic", "dall'11 dic", "fino all'8 dic";
 *   - every other language words each the way it words any other.
 */

// When the cases are read: the 27th of December, 2026, in the evening.
const NOW: Date = new Date("2026-12-27T20:00:00.000Z");

const MOMENTS_ON_A_24_HOUR_CLOCK: Record<string, Date> = {
  "today 14:25": new Date("2026-12-27T14:25:00.000Z"),
  "today 01:25": new Date("2026-12-27T01:25:00.000Z"),
  "today 00:25": new Date("2026-12-27T00:25:00.000Z"),
  "1st 14:25": new Date("2026-12-01T14:25:00.000Z"),
  "8th 14:25": new Date("2026-12-08T14:25:00.000Z"),
  "11th 14:25": new Date("2026-12-11T14:25:00.000Z"),
  "18th 14:25": new Date("2026-12-18T14:25:00.000Z"),
  "8th 01:25": new Date("2026-12-08T01:25:00.000Z"),
};

const MOMENTS_ON_A_12_HOUR_CLOCK: Record<string, Date> = {
  "today 01:25": new Date("2026-12-27T01:25:00.000Z"),
  "today 00:25": new Date("2026-12-27T00:25:00.000Z"),
  "11th 13:25": new Date("2026-12-11T13:25:00.000Z"),
};

// Each moment at, since and until it, by language: what the reader reads.
type Readings = Record<string, [string, string, string]>;

const ON_A_24_HOUR_CLOCK: Record<string, Readings> = {
  en: {
    "today 14:25": ["at 14:25", "since 14:25", "until 14:25"],
    "today 01:25": ["at 01:25", "since 01:25", "until 01:25"],
    "today 00:25": ["at 00:25", "since 00:25", "until 00:25"],
    "1st 14:25": [
      "on 01 Dec at 14:25",
      "since 01 Dec at 14:25",
      "until 01 Dec at 14:25",
    ],
    "8th 14:25": [
      "on 08 Dec at 14:25",
      "since 08 Dec at 14:25",
      "until 08 Dec at 14:25",
    ],
    "11th 14:25": [
      "on 11 Dec at 14:25",
      "since 11 Dec at 14:25",
      "until 11 Dec at 14:25",
    ],
    "18th 14:25": [
      "on 18 Dec at 14:25",
      "since 18 Dec at 14:25",
      "until 18 Dec at 14:25",
    ],
    "8th 01:25": [
      "on 08 Dec at 01:25",
      "since 08 Dec at 01:25",
      "until 08 Dec at 01:25",
    ],
  },
  de: {
    "today 14:25": ["um 14:25", "seit 14:25", "bis 14:25"],
    "today 01:25": ["um 01:25", "seit 01:25", "bis 01:25"],
    "today 00:25": ["um 00:25", "seit 00:25", "bis 00:25"],
    "1st 14:25": [
      "am 1. Dez. um 14:25",
      "seit dem 1. Dez. um 14:25",
      "bis zum 1. Dez. um 14:25",
    ],
    "8th 14:25": [
      "am 8. Dez. um 14:25",
      "seit dem 8. Dez. um 14:25",
      "bis zum 8. Dez. um 14:25",
    ],
    "11th 14:25": [
      "am 11. Dez. um 14:25",
      "seit dem 11. Dez. um 14:25",
      "bis zum 11. Dez. um 14:25",
    ],
    "18th 14:25": [
      "am 18. Dez. um 14:25",
      "seit dem 18. Dez. um 14:25",
      "bis zum 18. Dez. um 14:25",
    ],
    "8th 01:25": [
      "am 8. Dez. um 01:25",
      "seit dem 8. Dez. um 01:25",
      "bis zum 8. Dez. um 01:25",
    ],
  },
  fr: {
    "today 14:25": ["à 14:25", "depuis 14:25", "jusqu'à 14:25"],
    "today 01:25": ["à 01:25", "depuis 01:25", "jusqu'à 01:25"],
    "today 00:25": ["à 00:25", "depuis 00:25", "jusqu'à 00:25"],
    "1st 14:25": [
      "le 1 déc. à 14:25",
      "depuis le 1 déc. à 14:25",
      "jusqu'au 1 déc. à 14:25",
    ],
    // French reads le huit, le onze: no elision.
    "8th 14:25": [
      "le 8 déc. à 14:25",
      "depuis le 8 déc. à 14:25",
      "jusqu'au 8 déc. à 14:25",
    ],
    "11th 14:25": [
      "le 11 déc. à 14:25",
      "depuis le 11 déc. à 14:25",
      "jusqu'au 11 déc. à 14:25",
    ],
    "18th 14:25": [
      "le 18 déc. à 14:25",
      "depuis le 18 déc. à 14:25",
      "jusqu'au 18 déc. à 14:25",
    ],
    "8th 01:25": [
      "le 8 déc. à 01:25",
      "depuis le 8 déc. à 01:25",
      "jusqu'au 8 déc. à 01:25",
    ],
  },
  es: {
    "today 14:25": ["a las 14:25", "desde las 14:25", "hasta las 14:25"],
    "today 01:25": ["a la 01:25", "desde la 01:25", "hasta la 01:25"],
    "today 00:25": ["a las 00:25", "desde las 00:25", "hasta las 00:25"],
    "1st 14:25": [
      "el 1 dic a las 14:25",
      "desde el 1 dic a las 14:25",
      "hasta el 1 dic a las 14:25",
    ],
    "8th 14:25": [
      "el 8 dic a las 14:25",
      "desde el 8 dic a las 14:25",
      "hasta el 8 dic a las 14:25",
    ],
    "11th 14:25": [
      "el 11 dic a las 14:25",
      "desde el 11 dic a las 14:25",
      "hasta el 11 dic a las 14:25",
    ],
    "18th 14:25": [
      "el 18 dic a las 14:25",
      "desde el 18 dic a las 14:25",
      "hasta el 18 dic a las 14:25",
    ],
    "8th 01:25": [
      "el 8 dic a la 01:25",
      "desde el 8 dic a la 01:25",
      "hasta el 8 dic a la 01:25",
    ],
  },
  it: {
    "today 14:25": ["alle 14:25", "dalle 14:25", "fino alle 14:25"],
    "today 01:25": ["all'01:25", "dall'01:25", "fino all'01:25"],
    "today 00:25": ["alle 00:25", "dalle 00:25", "fino alle 00:25"],
    "1st 14:25": [
      "il 1 dic alle 14:25",
      "dal 1 dic alle 14:25",
      "fino al 1 dic alle 14:25",
    ],
    "8th 14:25": [
      "l'8 dic alle 14:25",
      "dall'8 dic alle 14:25",
      "fino all'8 dic alle 14:25",
    ],
    "11th 14:25": [
      "l'11 dic alle 14:25",
      "dall'11 dic alle 14:25",
      "fino all'11 dic alle 14:25",
    ],
    "18th 14:25": [
      "il 18 dic alle 14:25",
      "dal 18 dic alle 14:25",
      "fino al 18 dic alle 14:25",
    ],
    "8th 01:25": [
      "l'8 dic all'01:25",
      "dall'8 dic all'01:25",
      "fino all'8 dic all'01:25",
    ],
  },
  pt: {
    "today 14:25": ["às 14:25", "desde as 14:25", "até as 14:25"],
    "today 01:25": ["à 01:25", "desde a 01:25", "até a 01:25"],
    "today 00:25": ["à 00:25", "desde a 00:25", "até a 00:25"],
    "1st 14:25": [
      "em 1 de dez. às 14:25",
      "desde 1 de dez. às 14:25",
      "até 1 de dez. às 14:25",
    ],
    "8th 14:25": [
      "em 8 de dez. às 14:25",
      "desde 8 de dez. às 14:25",
      "até 8 de dez. às 14:25",
    ],
    "11th 14:25": [
      "em 11 de dez. às 14:25",
      "desde 11 de dez. às 14:25",
      "até 11 de dez. às 14:25",
    ],
    "18th 14:25": [
      "em 18 de dez. às 14:25",
      "desde 18 de dez. às 14:25",
      "até 18 de dez. às 14:25",
    ],
    "8th 01:25": [
      "em 8 de dez. à 01:25",
      "desde 8 de dez. à 01:25",
      "até 8 de dez. à 01:25",
    ],
  },
  nl: {
    "today 14:25": ["om 14:25", "sinds 14:25", "tot 14:25"],
    "today 01:25": ["om 01:25", "sinds 01:25", "tot 01:25"],
    "today 00:25": ["om 00:25", "sinds 00:25", "tot 00:25"],
    "1st 14:25": [
      "op 1 dec om 14:25",
      "sinds 1 dec om 14:25",
      "tot 1 dec om 14:25",
    ],
    "8th 14:25": [
      "op 8 dec om 14:25",
      "sinds 8 dec om 14:25",
      "tot 8 dec om 14:25",
    ],
    "11th 14:25": [
      "op 11 dec om 14:25",
      "sinds 11 dec om 14:25",
      "tot 11 dec om 14:25",
    ],
    "18th 14:25": [
      "op 18 dec om 14:25",
      "sinds 18 dec om 14:25",
      "tot 18 dec om 14:25",
    ],
    "8th 01:25": [
      "op 8 dec om 01:25",
      "sinds 8 dec om 01:25",
      "tot 8 dec om 01:25",
    ],
  },
  da: {
    "today 14:25": ["kl. 14.25", "siden kl. 14.25", "indtil kl. 14.25"],
    "today 01:25": ["kl. 01.25", "siden kl. 01.25", "indtil kl. 01.25"],
    "today 00:25": ["kl. 00.25", "siden kl. 00.25", "indtil kl. 00.25"],
    "1st 14:25": [
      "den 1. dec. kl. 14.25",
      "siden den 1. dec. kl. 14.25",
      "indtil den 1. dec. kl. 14.25",
    ],
    "8th 14:25": [
      "den 8. dec. kl. 14.25",
      "siden den 8. dec. kl. 14.25",
      "indtil den 8. dec. kl. 14.25",
    ],
    "11th 14:25": [
      "den 11. dec. kl. 14.25",
      "siden den 11. dec. kl. 14.25",
      "indtil den 11. dec. kl. 14.25",
    ],
    "18th 14:25": [
      "den 18. dec. kl. 14.25",
      "siden den 18. dec. kl. 14.25",
      "indtil den 18. dec. kl. 14.25",
    ],
    "8th 01:25": [
      "den 8. dec. kl. 01.25",
      "siden den 8. dec. kl. 01.25",
      "indtil den 8. dec. kl. 01.25",
    ],
  },
  no: {
    "today 14:25": ["kl. 14:25", "siden kl. 14:25", "til kl. 14:25"],
    "today 01:25": ["kl. 01:25", "siden kl. 01:25", "til kl. 01:25"],
    "today 00:25": ["kl. 00:25", "siden kl. 00:25", "til kl. 00:25"],
    "1st 14:25": [
      "den 1. des. kl. 14:25",
      "siden 1. des. kl. 14:25",
      "til 1. des. kl. 14:25",
    ],
    "8th 14:25": [
      "den 8. des. kl. 14:25",
      "siden 8. des. kl. 14:25",
      "til 8. des. kl. 14:25",
    ],
    "11th 14:25": [
      "den 11. des. kl. 14:25",
      "siden 11. des. kl. 14:25",
      "til 11. des. kl. 14:25",
    ],
    "18th 14:25": [
      "den 18. des. kl. 14:25",
      "siden 18. des. kl. 14:25",
      "til 18. des. kl. 14:25",
    ],
    "8th 01:25": [
      "den 8. des. kl. 01:25",
      "siden 8. des. kl. 01:25",
      "til 8. des. kl. 01:25",
    ],
  },
  sv: {
    "today 14:25": ["kl. 14:25", "sedan kl. 14:25", "till kl. 14:25"],
    "today 01:25": ["kl. 01:25", "sedan kl. 01:25", "till kl. 01:25"],
    "today 00:25": ["kl. 00:25", "sedan kl. 00:25", "till kl. 00:25"],
    "1st 14:25": [
      "den 1 dec. kl. 14:25",
      "sedan den 1 dec. kl. 14:25",
      "till den 1 dec. kl. 14:25",
    ],
    "8th 14:25": [
      "den 8 dec. kl. 14:25",
      "sedan den 8 dec. kl. 14:25",
      "till den 8 dec. kl. 14:25",
    ],
    "11th 14:25": [
      "den 11 dec. kl. 14:25",
      "sedan den 11 dec. kl. 14:25",
      "till den 11 dec. kl. 14:25",
    ],
    "18th 14:25": [
      "den 18 dec. kl. 14:25",
      "sedan den 18 dec. kl. 14:25",
      "till den 18 dec. kl. 14:25",
    ],
    "8th 01:25": [
      "den 8 dec. kl. 01:25",
      "sedan den 8 dec. kl. 01:25",
      "till den 8 dec. kl. 01:25",
    ],
  },
  ru: {
    "today 14:25": ["в 14:25", "с 14:25", "до 14:25"],
    "today 01:25": ["в 01:25", "с 01:25", "до 01:25"],
    "today 00:25": ["в 00:25", "с 00:25", "до 00:25"],
    "1st 14:25": ["1 дек. в 14:25", "с 1 дек., 14:25", "до 1 дек., 14:25"],
    "8th 14:25": ["8 дек. в 14:25", "с 8 дек., 14:25", "до 8 дек., 14:25"],
    "11th 14:25": ["11 дек. в 14:25", "с 11 дек., 14:25", "до 11 дек., 14:25"],
    "18th 14:25": ["18 дек. в 14:25", "с 18 дек., 14:25", "до 18 дек., 14:25"],
    "8th 01:25": ["8 дек. в 01:25", "с 8 дек., 01:25", "до 8 дек., 01:25"],
  },
  ja: {
    "today 14:25": ["14:25 に", "14:25 から", "14:25 まで"],
    "today 01:25": ["01:25 に", "01:25 から", "01:25 まで"],
    "today 00:25": ["00:25 に", "00:25 から", "00:25 まで"],
    "1st 14:25": [
      "12月1日 14:25 に",
      "12月1日 14:25 から",
      "12月1日 14:25 まで",
    ],
    "8th 14:25": [
      "12月8日 14:25 に",
      "12月8日 14:25 から",
      "12月8日 14:25 まで",
    ],
    "11th 14:25": [
      "12月11日 14:25 に",
      "12月11日 14:25 から",
      "12月11日 14:25 まで",
    ],
    "18th 14:25": [
      "12月18日 14:25 に",
      "12月18日 14:25 から",
      "12月18日 14:25 まで",
    ],
    "8th 01:25": [
      "12月8日 01:25 に",
      "12月8日 01:25 から",
      "12月8日 01:25 まで",
    ],
  },
  ko: {
    "today 14:25": ["14:25에", "14:25부터", "14:25까지"],
    "today 01:25": ["01:25에", "01:25부터", "01:25까지"],
    "today 00:25": ["00:25에", "00:25부터", "00:25까지"],
    "1st 14:25": [
      "12월 1일 14:25에",
      "12월 1일 14:25부터",
      "12월 1일 14:25까지",
    ],
    "8th 14:25": [
      "12월 8일 14:25에",
      "12월 8일 14:25부터",
      "12월 8일 14:25까지",
    ],
    "11th 14:25": [
      "12월 11일 14:25에",
      "12월 11일 14:25부터",
      "12월 11일 14:25까지",
    ],
    "18th 14:25": [
      "12월 18일 14:25에",
      "12월 18일 14:25부터",
      "12월 18일 14:25까지",
    ],
    "8th 01:25": [
      "12월 8일 01:25에",
      "12월 8일 01:25부터",
      "12월 8일 01:25까지",
    ],
  },
  "zh-CN": {
    "today 14:25": ["于 14:25", "自 14:25 起", "直到 14:25"],
    "today 01:25": ["于 01:25", "自 01:25 起", "直到 01:25"],
    "today 00:25": ["于 00:25", "自 00:25 起", "直到 00:25"],
    "1st 14:25": [
      "于 12月1日 14:25",
      "自 12月1日 14:25 起",
      "直到 12月1日 14:25",
    ],
    "8th 14:25": [
      "于 12月8日 14:25",
      "自 12月8日 14:25 起",
      "直到 12月8日 14:25",
    ],
    "11th 14:25": [
      "于 12月11日 14:25",
      "自 12月11日 14:25 起",
      "直到 12月11日 14:25",
    ],
    "18th 14:25": [
      "于 12月18日 14:25",
      "自 12月18日 14:25 起",
      "直到 12月18日 14:25",
    ],
    "8th 01:25": [
      "于 12月8日 01:25",
      "自 12月8日 01:25 起",
      "直到 12月8日 01:25",
    ],
  },
  "zh-TW": {
    "today 14:25": ["於 14:25", "自 14:25 起", "直到 14:25"],
    "today 01:25": ["於 01:25", "自 01:25 起", "直到 01:25"],
    "today 00:25": ["於 00:25", "自 00:25 起", "直到 00:25"],
    "1st 14:25": [
      "於 12月1日 14:25",
      "自 12月1日 14:25 起",
      "直到 12月1日 14:25",
    ],
    "8th 14:25": [
      "於 12月8日 14:25",
      "自 12月8日 14:25 起",
      "直到 12月8日 14:25",
    ],
    "11th 14:25": [
      "於 12月11日 14:25",
      "自 12月11日 14:25 起",
      "直到 12月11日 14:25",
    ],
    "18th 14:25": [
      "於 12月18日 14:25",
      "自 12月18日 14:25 起",
      "直到 12月18日 14:25",
    ],
    "8th 01:25": [
      "於 12月8日 01:25",
      "自 12月8日 01:25 起",
      "直到 12月8日 01:25",
    ],
  },
  hi: {
    "today 14:25": ["14:25 पर", "14:25 से", "14:25 तक"],
    "today 01:25": ["01:25 पर", "01:25 से", "01:25 तक"],
    "today 00:25": ["00:25 पर", "00:25 से", "00:25 तक"],
    "1st 14:25": [
      "1 दिस॰ को 14:25 पर",
      "1 दिस॰ को 14:25 से",
      "1 दिस॰ को 14:25 तक",
    ],
    "8th 14:25": [
      "8 दिस॰ को 14:25 पर",
      "8 दिस॰ को 14:25 से",
      "8 दिस॰ को 14:25 तक",
    ],
    "11th 14:25": [
      "11 दिस॰ को 14:25 पर",
      "11 दिस॰ को 14:25 से",
      "11 दिस॰ को 14:25 तक",
    ],
    "18th 14:25": [
      "18 दिस॰ को 14:25 पर",
      "18 दिस॰ को 14:25 से",
      "18 दिस॰ को 14:25 तक",
    ],
    "8th 01:25": [
      "8 दिस॰ को 01:25 पर",
      "8 दिस॰ को 01:25 से",
      "8 दिस॰ को 01:25 तक",
    ],
  },
  fa: {
    "today 14:25": ["ساعت ۱۴:۲۵", "از ساعت ۱۴:۲۵", "تا ساعت ۱۴:۲۵"],
    "today 01:25": ["ساعت ۰۱:۲۵", "از ساعت ۰۱:۲۵", "تا ساعت ۰۱:۲۵"],
    "today 00:25": ["ساعت ۰۰:۲۵", "از ساعت ۰۰:۲۵", "تا ساعت ۰۰:۲۵"],
    "1st 14:25": [
      "۱ دسامبر ساعت ۱۴:۲۵",
      "از ۱ دسامبر ساعت ۱۴:۲۵",
      "تا ۱ دسامبر ساعت ۱۴:۲۵",
    ],
    "8th 14:25": [
      "۸ دسامبر ساعت ۱۴:۲۵",
      "از ۸ دسامبر ساعت ۱۴:۲۵",
      "تا ۸ دسامبر ساعت ۱۴:۲۵",
    ],
    "11th 14:25": [
      "۱۱ دسامبر ساعت ۱۴:۲۵",
      "از ۱۱ دسامبر ساعت ۱۴:۲۵",
      "تا ۱۱ دسامبر ساعت ۱۴:۲۵",
    ],
    "18th 14:25": [
      "۱۸ دسامبر ساعت ۱۴:۲۵",
      "از ۱۸ دسامبر ساعت ۱۴:۲۵",
      "تا ۱۸ دسامبر ساعت ۱۴:۲۵",
    ],
    "8th 01:25": [
      "۸ دسامبر ساعت ۰۱:۲۵",
      "از ۸ دسامبر ساعت ۰۱:۲۵",
      "تا ۸ دسامبر ساعت ۰۱:۲۵",
    ],
  },
  ar: {
    "today 14:25": ["في الساعة 14:25", "منذ الساعة 14:25", "حتى الساعة 14:25"],
    "today 01:25": ["في الساعة 01:25", "منذ الساعة 01:25", "حتى الساعة 01:25"],
    "today 00:25": ["في الساعة 00:25", "منذ الساعة 00:25", "حتى الساعة 00:25"],
    "1st 14:25": [
      "في 1 ديسمبر الساعة 14:25",
      "منذ 1 ديسمبر الساعة 14:25",
      "حتى 1 ديسمبر الساعة 14:25",
    ],
    "8th 14:25": [
      "في 8 ديسمبر الساعة 14:25",
      "منذ 8 ديسمبر الساعة 14:25",
      "حتى 8 ديسمبر الساعة 14:25",
    ],
    "11th 14:25": [
      "في 11 ديسمبر الساعة 14:25",
      "منذ 11 ديسمبر الساعة 14:25",
      "حتى 11 ديسمبر الساعة 14:25",
    ],
    "18th 14:25": [
      "في 18 ديسمبر الساعة 14:25",
      "منذ 18 ديسمبر الساعة 14:25",
      "حتى 18 ديسمبر الساعة 14:25",
    ],
    "8th 01:25": [
      "في 8 ديسمبر الساعة 01:25",
      "منذ 8 ديسمبر الساعة 01:25",
      "حتى 8 ديسمبر الساعة 01:25",
    ],
  },
};

const ON_A_12_HOUR_CLOCK: Record<string, Readings> = {
  en: {
    "today 01:25": ["at 1:25 AM", "since 1:25 AM", "until 1:25 AM"],
    "today 00:25": ["at 12:25 AM", "since 12:25 AM", "until 12:25 AM"],
    "11th 13:25": [
      "on 11 Dec at 1:25 PM",
      "since 11 Dec at 1:25 PM",
      "until 11 Dec at 1:25 PM",
    ],
  },
  de: {
    "today 01:25": ["um 1:25 AM", "seit 1:25 AM", "bis 1:25 AM"],
    "today 00:25": ["um 12:25 AM", "seit 12:25 AM", "bis 12:25 AM"],
    "11th 13:25": [
      "am 11. Dez. um 1:25 PM",
      "seit dem 11. Dez. um 1:25 PM",
      "bis zum 11. Dez. um 1:25 PM",
    ],
  },
  fr: {
    "today 01:25": ["à 1:25 AM", "depuis 1:25 AM", "jusqu'à 1:25 AM"],
    "today 00:25": ["à 12:25 AM", "depuis 12:25 AM", "jusqu'à 12:25 AM"],
    "11th 13:25": [
      "le 11 déc. à 1:25 PM",
      "depuis le 11 déc. à 1:25 PM",
      "jusqu'au 11 déc. à 1:25 PM",
    ],
  },
  es: {
    "today 01:25": [
      "a la 1:25 a. m.",
      "desde la 1:25 a. m.",
      "hasta la 1:25 a. m.",
    ],
    // Twelve o'clock is plural: las doce.
    "today 00:25": [
      "a las 12:25 a. m.",
      "desde las 12:25 a. m.",
      "hasta las 12:25 a. m.",
    ],
    "11th 13:25": [
      "el 11 dic a la 1:25 p. m.",
      "desde el 11 dic a la 1:25 p. m.",
      "hasta el 11 dic a la 1:25 p. m.",
    ],
  },
  it: {
    "today 01:25": ["all'1:25 AM", "dall'1:25 AM", "fino all'1:25 AM"],
    "today 00:25": ["alle 12:25 AM", "dalle 12:25 AM", "fino alle 12:25 AM"],
    "11th 13:25": [
      "l'11 dic all'1:25 PM",
      "dall'11 dic all'1:25 PM",
      "fino all'11 dic all'1:25 PM",
    ],
  },
  pt: {
    "today 01:25": ["à 1:25 AM", "desde a 1:25 AM", "até a 1:25 AM"],
    "today 00:25": ["às 12:25 AM", "desde as 12:25 AM", "até as 12:25 AM"],
    "11th 13:25": [
      "em 11 de dez. à 1:25 PM",
      "desde 11 de dez. à 1:25 PM",
      "até 11 de dez. à 1:25 PM",
    ],
  },
  nl: {
    "today 01:25": ["om 1:25 a.m.", "sinds 1:25 a.m.", "tot 1:25 a.m."],
    "today 00:25": ["om 12:25 a.m.", "sinds 12:25 a.m.", "tot 12:25 a.m."],
    "11th 13:25": [
      "op 11 dec om 1:25 p.m.",
      "sinds 11 dec om 1:25 p.m.",
      "tot 11 dec om 1:25 p.m.",
    ],
  },
  da: {
    "today 01:25": ["kl. 1.25 AM", "siden kl. 1.25 AM", "indtil kl. 1.25 AM"],
    "today 00:25": [
      "kl. 12.25 AM",
      "siden kl. 12.25 AM",
      "indtil kl. 12.25 AM",
    ],
    "11th 13:25": [
      "den 11. dec. kl. 1.25 PM",
      "siden den 11. dec. kl. 1.25 PM",
      "indtil den 11. dec. kl. 1.25 PM",
    ],
  },
  no: {
    "today 01:25": [
      "kl. 1:25 a.m.",
      "siden kl. 1:25 a.m.",
      "til kl. 1:25 a.m.",
    ],
    "today 00:25": [
      "kl. 12:25 a.m.",
      "siden kl. 12:25 a.m.",
      "til kl. 12:25 a.m.",
    ],
    "11th 13:25": [
      "den 11. des. kl. 1:25 p.m.",
      "siden 11. des. kl. 1:25 p.m.",
      "til 11. des. kl. 1:25 p.m.",
    ],
  },
  sv: {
    "today 01:25": ["kl. 1:25 fm", "sedan kl. 1:25 fm", "till kl. 1:25 fm"],
    "today 00:25": ["kl. 12:25 fm", "sedan kl. 12:25 fm", "till kl. 12:25 fm"],
    "11th 13:25": [
      "den 11 dec. kl. 1:25 em",
      "sedan den 11 dec. kl. 1:25 em",
      "till den 11 dec. kl. 1:25 em",
    ],
  },
  ru: {
    "today 01:25": ["в 1:25 AM", "с 1:25 AM", "до 1:25 AM"],
    "today 00:25": ["в 12:25 AM", "с 12:25 AM", "до 12:25 AM"],
    "11th 13:25": [
      "11 дек. в 1:25 PM",
      "с 11 дек., 1:25 PM",
      "до 11 дек., 1:25 PM",
    ],
  },
  ja: {
    "today 01:25": ["午前1:25 に", "午前1:25 から", "午前1:25 まで"],
    "today 00:25": ["午前12:25 に", "午前12:25 から", "午前12:25 まで"],
    "11th 13:25": [
      "12月11日 午後1:25 に",
      "12月11日 午後1:25 から",
      "12月11日 午後1:25 まで",
    ],
  },
  ko: {
    "today 01:25": ["오전 1:25에", "오전 1:25부터", "오전 1:25까지"],
    "today 00:25": ["오전 12:25에", "오전 12:25부터", "오전 12:25까지"],
    "11th 13:25": [
      "12월 11일 오후 1:25에",
      "12월 11일 오후 1:25부터",
      "12월 11일 오후 1:25까지",
    ],
  },
  "zh-CN": {
    "today 01:25": ["于 上午1:25", "自 上午1:25 起", "直到 上午1:25"],
    "today 00:25": ["于 上午12:25", "自 上午12:25 起", "直到 上午12:25"],
    "11th 13:25": [
      "于 12月11日 下午1:25",
      "自 12月11日 下午1:25 起",
      "直到 12月11日 下午1:25",
    ],
  },
  "zh-TW": {
    "today 01:25": ["於 上午1:25", "自 上午1:25 起", "直到 上午1:25"],
    "today 00:25": ["於 上午12:25", "自 上午12:25 起", "直到 上午12:25"],
    "11th 13:25": [
      "於 12月11日 下午1:25",
      "自 12月11日 下午1:25 起",
      "直到 12月11日 下午1:25",
    ],
  },
  hi: {
    "today 01:25": ["1:25 am पर", "1:25 am से", "1:25 am तक"],
    "today 00:25": ["12:25 am पर", "12:25 am से", "12:25 am तक"],
    "11th 13:25": [
      "11 दिस॰ को 1:25 pm पर",
      "11 दिस॰ को 1:25 pm से",
      "11 दिस॰ को 1:25 pm तक",
    ],
  },
  fa: {
    "today 01:25": ["ساعت ۱:۲۵ ق.ظ.", "از ساعت ۱:۲۵ ق.ظ.", "تا ساعت ۱:۲۵ ق.ظ."],
    "today 00:25": [
      "ساعت ۱۲:۲۵ ق.ظ.",
      "از ساعت ۱۲:۲۵ ق.ظ.",
      "تا ساعت ۱۲:۲۵ ق.ظ.",
    ],
    "11th 13:25": [
      "۱۱ دسامبر ساعت ۱:۲۵ ب.ظ.",
      "از ۱۱ دسامبر ساعت ۱:۲۵ ب.ظ.",
      "تا ۱۱ دسامبر ساعت ۱:۲۵ ب.ظ.",
    ],
  },
  ar: {
    "today 01:25": [
      "في الساعة 1:25 ص",
      "منذ الساعة 1:25 ص",
      "حتى الساعة 1:25 ص",
    ],
    "today 00:25": [
      "في الساعة 12:25 ص",
      "منذ الساعة 12:25 ص",
      "حتى الساعة 12:25 ص",
    ],
    "11th 13:25": [
      "في 11 ديسمبر الساعة 1:25 م",
      "منذ 11 ديسمبر الساعة 1:25 م",
      "حتى 11 ديسمبر الساعة 1:25 م",
    ],
  },
};

// A text with the no-break spaces a page sets read as plain spaces.
function plain(text: string): string {
  return text.replace(/[\u00a0\u202f]/gu, " ");
}

// What a reader of `language` reads for `time`, at, since and until it.
function readMoment(language: string, time: Date): [string, string, string] {
  const translator: Translator = dashboardTranslator(language);

  return withDateDisplayLanguage(language, (): [string, string, string] => {
    const moment: WrittenMoment = writeReaderMoment(time, NOW);
    const [at, since, until] = MOMENT_ROLES.map((role: MomentRole): string => {
      return plain(wordMoment({ role, moment, translator }));
    });

    return [at!, since!, until!];
  });
}

function onClock(isTwelveHour: boolean): void {
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(isTwelveHour);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("every language the Dashboard speaks is pinned", () => {
  test("on both clocks, English first", () => {
    const languages: Array<string> = ["en", ...DASHBOARD_LANGUAGES];

    expect(Object.keys(ON_A_24_HOUR_CLOCK).sort()).toEqual(
      [...languages].sort(),
    );
    expect(Object.keys(ON_A_12_HOUR_CLOCK).sort()).toEqual(
      [...languages].sort(),
    );
  });
});

describe("a moment on a 24-hour clock, in every language", () => {
  test.each(Object.keys(ON_A_24_HOUR_CLOCK))(
    "%s: today, at one o'clock and at midnight, and on the 1st, the 8th, the 11th and the 18th",
    (language: string) => {
      onClock(false);

      const read: Readings = {};

      for (const [name, time] of Object.entries(MOMENTS_ON_A_24_HOUR_CLOCK)) {
        read[name] = readMoment(language, time);
      }

      expect(read).toEqual(ON_A_24_HOUR_CLOCK[language]);
    },
  );
});

describe("a moment on a 12-hour clock, in every language", () => {
  test.each(Object.keys(ON_A_12_HOUR_CLOCK))(
    "%s: one in the morning, twelve past midnight, and one in the afternoon on the 11th",
    (language: string) => {
      onClock(true);

      const read: Readings = {};

      for (const [name, time] of Object.entries(MOMENTS_ON_A_12_HOUR_CLOCK)) {
        read[name] = readMoment(language, time);
      }

      expect(read).toEqual(ON_A_12_HOUR_CLOCK[language]);
    },
  );
});

/*
 * The words a reader of `language` reads around `time`, at, since and until
 * it: its day and its clock, as the language writes them, left out.
 */
function wordsAround(language: string, time: Date): string {
  const translator: Translator = dashboardTranslator(language);

  return withDateDisplayLanguage(language, (): string => {
    const moment: WrittenMoment = writeReaderMoment(time, NOW);

    return MOMENT_ROLES.map((role: MomentRole): string => {
      const phrase: string = plain(wordMoment({ role, moment, translator }));
      const withoutDay: string = moment.date
        ? phrase.split(plain(moment.date)).join("<day>")
        : phrase;

      return withoutDay.split(plain(moment.time)).join("<clock>");
    }).join(" | ");
  });
}

describe("the forms a moment takes, by language", () => {
  test("Spanish, Portuguese and Italian change their words at one o'clock, and every other language keeps them", () => {
    onClock(false);

    const changes: Array<string> = [];

    for (const language of ["en", ...DASHBOARD_LANGUAGES]) {
      for (const day of ["27", "26"]) {
        if (
          wordsAround(language, new Date(`2026-12-${day}T01:25:00.000Z`)) !==
          wordsAround(language, new Date(`2026-12-${day}T02:25:00.000Z`))
        ) {
          changes.push(`${language} ${day === "27" ? "today" : "another day"}`);
        }
      }
    }

    expect(changes).toEqual([
      "es today",
      "es another day",
      "it today",
      "it another day",
      "pt today",
      "pt another day",
    ]);
  });

  test("on a 12-hour clock too: one in the afternoon is one o'clock", () => {
    onClock(true);

    const changes: Array<string> = [];

    for (const language of ["en", ...DASHBOARD_LANGUAGES]) {
      if (
        wordsAround(language, new Date("2026-12-27T13:25:00.000Z")) !==
        wordsAround(language, new Date("2026-12-27T14:25:00.000Z"))
      ) {
        changes.push(language);
      }
    }

    expect(changes).toEqual(["es", "it", "pt"]);
  });

  test("only Portuguese counts midnight as one", () => {
    onClock(false);

    const changes: Array<string> = [];

    for (const language of ["en", ...DASHBOARD_LANGUAGES]) {
      if (
        wordsAround(language, new Date("2026-12-27T00:25:00.000Z")) !==
        wordsAround(language, new Date("2026-12-27T02:25:00.000Z"))
      ) {
        changes.push(language);
      }
    }

    expect(changes).toEqual(["pt"]);
  });

  test("only Italian changes its words on the days it reads with a vowel first, the 8th and the 11th", () => {
    onClock(false);

    const changes: Array<string> = [];

    for (const language of ["en", ...DASHBOARD_LANGUAGES]) {
      const anotherDay: string = wordsAround(
        language,
        new Date("2026-12-26T14:25:00.000Z"),
      );

      for (let day: number = 1; day <= 25; day++) {
        const date: string = String(day).padStart(2, "0");

        if (
          wordsAround(language, new Date(`2026-12-${date}T14:25:00.000Z`)) !==
          anotherDay
        ) {
          changes.push(`${language} ${day}`);
        }
      }
    }

    expect(changes).toEqual(["it 8", "it 11"]);
  });
});
