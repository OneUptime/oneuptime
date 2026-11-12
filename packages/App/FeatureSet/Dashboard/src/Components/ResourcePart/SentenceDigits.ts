import {
  ComposedValue,
  TemplateValues,
  Translator,
  composedValue,
} from "Common/UI/Utils/TranslateTemplate";
import {
  ReaderFigureOptions,
  formatReaderFigure,
} from "Common/Types/DateLanguage";

/*
 * A count in one of a part's sentences, written the way the sentence's
 * language writes numbers - "۲ از ۳ در دسترس" in Persian, as {{count}}
 * always is - and English digits in an English sentence, a fallback
 * included. A product's rules keep their values as plain digits (the
 * Kubernetes rules are React-free and run in the ingest too); a whole
 * number among them is drawn in the sentence's own digits, and so is a
 * figure with decimals or a percentage, with the decimals it was written
 * with and the language's own decimal and percent signs: a host's "/var
 * 96% full" reads "۹۶٪" in Persian under the Filesystem tile's "۹۶٫۴٪", its
 * "15-minute load 9.6" "۹٫۶", and German writes "96 %" and "9,6" beside its
 * tiles' "96,4 %" (#7106). Anything else (a state, a size, an address,
 * Kubernetes' own word) is drawn as written. So a rule never hands a
 * version as a bare "1.29": it would read as a figure, "۱٫۲۹".
 */
const WHOLE_NUMBER: RegExp = /^\d{1,15}$/;
const FIGURE: RegExp = /^\d{1,15}(?:\.(\d{1,6}))?(%?)$/;

export function withSentenceDigits(
  values: Record<string, string> | undefined,
): TemplateValues | undefined {
  if (!values) {
    return undefined;
  }

  const result: TemplateValues = {};

  for (const key of Object.keys(values)) {
    const value: string = values[key] as string;

    const figure: RegExpMatchArray | null = value.match(FIGURE);

    if (WHOLE_NUMBER.test(value)) {
      result[key] = composedValue((sentence: Translator): string => {
        return sentence.formatNumber(Number(value));
      });
    } else if (figure) {
      // "4.2%" keeps its one decimal: "۴٫۲٪", "4,2 %".
      const decimals: number = (figure[1] || "").length;
      const isPercent: boolean = figure[2] === "%";

      result[key] = composedValue((sentence: Translator): string => {
        return formatReaderFigure(
          Number(isPercent ? value.slice(0, -1) : value),
          {
            decimals: decimals,
            isPercent: isPercent,
            language: sentence.language,
          },
        );
      });
    } else {
      result[key] = value;
    }
  }

  return result;
}

/*
 * A figure with decimals in one of a part's sentences - an uptime's
 * "99.95" before the sentence's own "%" - in the sentence's language, as
 * withSentenceDigits writes a whole number: "99.95" in English (a fallback
 * included), "99,95" in German, "۹۹٫۹۵" in Persian (issue #7106).
 */
export function figureInSentence(
  value: number,
  options: Omit<ReaderFigureOptions, "language">,
): ComposedValue {
  return composedValue((sentence: Translator): string => {
    return formatReaderFigure(value, {
      ...options,
      language: sentence.language,
    });
  });
}
