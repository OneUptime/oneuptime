import {
  TemplateValues,
  Translator,
  composedValue,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * A count in one of a part's sentences, written the way the sentence's
 * language writes numbers - "۲ از ۳ در دسترس" in Persian, as {{count}}
 * always is - and English digits in an English sentence, a fallback
 * included. A product's rules keep their values as plain digits (the
 * Kubernetes rules are React-free and run in the ingest too); a whole
 * number among them is drawn in the sentence's own digits, anything else
 * (a state, a percentage, Kubernetes' own word) as written.
 */
const WHOLE_NUMBER: RegExp = /^\d{1,15}$/;

export function withSentenceDigits(
  values: Record<string, string> | undefined,
): TemplateValues | undefined {
  if (!values) {
    return undefined;
  }

  const result: TemplateValues = {};

  for (const key of Object.keys(values)) {
    const value: string = values[key] as string;

    result[key] = WHOLE_NUMBER.test(value)
      ? composedValue((sentence: Translator): string => {
          return sentence.formatNumber(Number(value));
        })
      : value;
  }

  return result;
}
