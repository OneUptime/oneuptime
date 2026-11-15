import { formatDurationUnit } from "Common/Types/DateLanguage";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * A count of milliseconds as the reader's language writes the unit: "12 ms",
 * "12 мс", "۱۲ میلی‌ثانیه" (Intl's short unit). The health pages glued an
 * English "ms" to the number (#8599). An engine with no unit style writes
 * the number in the reader's digits and the unit's symbol.
 */
export const formatMillisecondsIn: (
  value: unknown,
  translator: Translator,
) => string = (value: unknown, translator: Translator): string => {
  const count: number = Number(value);

  if (value === null || value === undefined || isNaN(count)) {
    return "—";
  }

  return (
    formatDurationUnit({
      part: { count, unit: "millisecond" },
      locale: translator.language,
      unitDisplay: "short",
      maximumFractionDigits: 0,
    }) || translator.formatNumber(count) + MILLISECOND_SYMBOL
  );
};

// The unit's symbol, as SI writes it in every language.
const MILLISECOND_SYMBOL: string = "\u00A0ms";
