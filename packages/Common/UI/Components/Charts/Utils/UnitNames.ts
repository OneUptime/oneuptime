import ValueFormatter, {
  ValueFormatterOptions,
} from "../../../../Utils/ValueFormatter";
import {
  translatableTerm,
  translationKey,
  Translator,
} from "../../../Utils/TranslateTemplate";

/*
 * A CHART'S UNIT, IN THE READER'S LANGUAGE.
 *
 * A metric chart says its unit in a badge above its lines ("Bytes",
 * "Milliseconds", "Bytes per Second"), and a metric's row and details say it
 * too. The name comes from ValueFormatter.getReadableUnit, in English, and
 * was drawn as it came in every language. These are its names, marked for
 * the locale files; getUnitNameInLanguage draws them in the reader's
 * language, a rate as one sentence of the two ("Bytes pro Sekunde"). A
 * unit the formatter does not know (a metric's own "{tasks}") reads as its
 * annotation's word, as written.
 */

// Every name ValueFormatter.getReadableUnit gives a unit (a test holds this).
export const UNIT_NAMES: ReadonlyArray<string> = [
  translationKey("Amperes"),
  translationKey("Bits"),
  translationKey("Bytes"),
  translationKey("Celsius"),
  translationKey("Days"),
  translationKey("Fahrenheit"),
  translationKey("Gibibytes"),
  translationKey("Gigabits"),
  translationKey("Gigabytes"),
  translationKey("Gigahertz"),
  translationKey("Hertz"),
  translationKey("Hours"),
  translationKey("Joules"),
  translationKey("Kelvin"),
  translationKey("Kibibytes"),
  translationKey("Kilobits"),
  translationKey("Kilobytes"),
  translationKey("Kilohertz"),
  translationKey("Kilowatts"),
  translationKey("Mebibytes"),
  translationKey("Megabits"),
  translationKey("Megabytes"),
  translationKey("Megahertz"),
  translationKey("Microseconds"),
  translationKey("Milliseconds"),
  translationKey("Minutes"),
  translationKey("Nanoseconds"),
  translationKey("Pebibytes"),
  translationKey("Percent"),
  translationKey("Petabytes"),
  translationKey("Seconds"),
  translationKey("Tebibytes"),
  translationKey("Terabytes"),
  translationKey("Volts"),
  translationKey("Watts"),
];

/*
 * The time a rate is counted over, as getReadableUnit writes it after
 * "per": the singular of a time unit ("Bytes per Second").
 */
export const RATE_PERIOD_NAMES: ReadonlyArray<string> = [
  translationKey("Nanosecond"),
  translationKey("Microsecond"),
  translationKey("Millisecond"),
  translationKey("Second"),
  translationKey("Minute"),
  translationKey("Hour"),
  translationKey("Day"),
];

// A rate, as one sentence: the reader's language orders the two its way.
export const UNIT_RATE_TEMPLATE: string = translationKey(
  "{{numerator}} per {{denominator}}",
);

/*
 * A rate of a dimensionless count ("1/s"), which has no numerator to
 * name: "per Second", "pro Sekunde" (#7518).
 */
export const UNIT_PER_TEMPLATE: string = translationKey("per {{denominator}}");

const RATE_SEPARATOR: string = " per ";

const RATE_PREFIX: string = "per ";

/*
 * The unit's name as getReadableUnit gives it, in the reader's language.
 * English reads exactly as getReadableUnit writes it, and so does a
 * language that has not worded a rate yet.
 */
export function getUnitNameInLanguage(
  unit: string,
  translator: Translator,
  options?: { metricName?: string },
): string {
  const english: string = ValueFormatter.getReadableUnit(unit, options);

  if (!english) {
    return "";
  }

  const isRate: boolean = (unit || "").includes("/");

  if (isRate && english.startsWith(RATE_PREFIX)) {
    if (!translator.hasTranslation(UNIT_PER_TEMPLATE)) {
      return english;
    }

    return translator.translateTemplate(UNIT_PER_TEMPLATE, {
      denominator: translatableTerm(english.slice(RATE_PREFIX.length), {
        inSentence: true,
      }),
    });
  }

  const rateAt: number = isRate ? english.indexOf(RATE_SEPARATOR) : -1;

  if (rateAt > 0) {
    if (!translator.hasTranslation(UNIT_RATE_TEMPLATE)) {
      return english;
    }

    return translator.translateTemplate(UNIT_RATE_TEMPLATE, {
      numerator: translatableTerm(english.slice(0, rateAt)),
      denominator: translatableTerm(
        english.slice(rateAt + RATE_SEPARATOR.length),
        { inSentence: true },
      ),
    });
  }

  return translator.translateText(english) || english;
}

/*
 * What a widget that writes a value for its reader hands ValueFormatter
 * (#7518): their language, for the number, its scale and a span of time's
 * words ("1,2 Mio.", "6,91 Stunden"), and their words for a unit the
 * formatter names in words ("50 هرتز", "230 Volt"). English reads
 * exactly as the formatter writes it.
 */
export function getValueFormatterOptionsForReader(
  translator: Translator,
  metricName?: string | undefined,
): ValueFormatterOptions {
  return {
    ...(metricName !== undefined ? { metricName: metricName } : {}),
    language: translator.language,
    unitName: (unit: string): string => {
      return getUnitNameInLanguage(
        unit,
        translator,
        metricName !== undefined ? { metricName: metricName } : undefined,
      );
    },
  };
}
